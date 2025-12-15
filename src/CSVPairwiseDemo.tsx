import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MutableRefObject, RefObject } from "react";
import Papa from "papaparse";
import { DATA_CSV_URL, VIDEO_PREFIX_URL, FORCE_MP4 } from "./config";

/**
 * Who Dance Better
 * - Dedicated GT account labels ALL battles (videoId with exactly 2 dancers)
 * - 4 annotators do QC labeling with intentional overlap for cross-checking
 * - File-based progress (JSON import/export). No localStorage persistence.
 * - After GT is complete, export full unit-level pairwise labels derived from GT.
 *
 * Notes:
 * - "Battle" = one videoId, containing exactly two dancers (two dancerId groups).
 * - GT is binary winner at battle-level, then expanded to unit-level labels via cross product.
 */

/** =================== Accounts ===================
 * Update passcodes for your team. */
const USERS = [
  { id: "GT", name: "GT Account", role: "gt" as const, index: -1, passcode: "0000" },
  { id: "A",  name: "Annotator A", role: "annotator" as const, index: 0, passcode: "1111" },
  { id: "B",  name: "Annotator B", role: "annotator" as const, index: 1, passcode: "2222" },
  { id: "C",  name: "Annotator C", role: "annotator" as const, index: 2, passcode: "3333" },
  { id: "D",  name: "Annotator D", role: "annotator" as const, index: 3, passcode: "4444" },
] as const;

type UserId = typeof USERS[number]["id"];
type Role = typeof USERS[number]["role"];
type User = { id: UserId; name: string; role: Role; index: number };

const OWNER_COUNT = 4;

/**
 * QC overlap rate:
 * - 0.0  => each battle assigned to exactly 1 annotator (no overlap)
 * - 1.0  => each battle assigned to exactly 2 annotators (full cross-check, ~2x workload)
 * Recommended: 0.25 ~ 0.5 for partial overlap
 */
const QC_OVERLAP_RATE = 0.5;

/** =================== Types =================== */
export type Unit = {
  id: string;
  dancer?: string;
  dancerId?: string;
  videoId?: string;
  src: string;
  rawSrc?: string;
  meta?: Record<string, any>;
};

type DancerGroup = { dancerKey: string; units: Unit[] };
type Battle = { videoId: string; dancers: [DancerGroup, DancerGroup] };

type WinnerDecision = {
  winnerDancerKey: string;
  decidedAt: number;
};

type GTProgressFile = {
  format: "gt-progress-v2";
  dataset: string;
  user: User;
  salt: string;
  gt: Record<string /*videoId*/, WinnerDecision>;
  createdAt: number;
  updatedAt: number;
};

type QCProgressFile = {
  format: "qc-progress-v1";
  dataset: string;
  user: User;
  salt: string;
  qc: Record<string /*videoId*/, WinnerDecision>;
  createdAt: number;
  updatedAt: number;
};

/** =================== Helpers =================== */
function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** clip_path → playable URL */
function resolveClipUrl(p0: string) {
  let p = (p0 ?? "").toString().trim().replace(/^file:\/\//i, "");
  if (!p) return "";
  if (/^https?:\/\//i.test(p) || p.startsWith("/")) {
    return encodeURI(FORCE_MP4 ? p.replace(/\.[A-Za-z0-9]{1,5}(\?.*)?$/, ".mp4$1") : p);
  }
  const nameRaw = p.split(/[\\/]/).pop() || p;
  const name = FORCE_MP4
    ? nameRaw.replace(/\.[A-Za-z0-9]{1,5}(\?.*)?$/, ".mp4$1")
    : nameRaw;
  const base = VIDEO_PREFIX_URL.replace(/\/$/, "");
  return `${base}/${encodeURIComponent(name)}`;
}

/** Strict ref type */
type VideoRef = MutableRefObject<HTMLVideoElement | null> | RefObject<HTMLVideoElement | null>;

/** djb2 hash (signed 32-bit) */
function hashStrDJB2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h | 0;
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

/** QC assignment: primary + optional secondary (overlap) */
function qcAssigneesForBattle(videoId: string, salt: string): number[] {
  const primary = mod(hashStrDJB2(`qc:pri:${videoId}:${salt}`), OWNER_COUNT);
  const secShift = 1 + mod(hashStrDJB2(`qc:sec:${videoId}:${salt}`), OWNER_COUNT - 1); // 1..3
  const secondary = (primary + secShift) % OWNER_COUNT;

  const bucket = mod(hashStrDJB2(`qc:over:${videoId}:${salt}`), 10000) / 10000; // 0..0.9999
  const includeSecondary = bucket < QC_OVERLAP_RATE;

  return includeSecondary ? [primary, secondary] : [primary];
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function downloadText(text: string, filename: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(obj: any, filename: string) {
  downloadText(JSON.stringify(obj, null, 2), filename, "application/json");
}

function readJSONFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try { resolve(JSON.parse(String(fr.result))); }
      catch (e) { reject(e); }
    };
    fr.onerror = reject;
    fr.readAsText(file, "utf-8");
  });
}

/** =================== Watch coverage (optional) =================== */
function useWatchCoverage(videoRef: VideoRef, enabled = true) {
  const visited = useRef<Set<number>>(new Set());
  const [ratio, setRatio] = useState(enabled ? 0 : 1);

  const tick = useCallback(() => {
    if (!enabled) return;
    const v = videoRef.current as HTMLVideoElement | null;
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    const sec = Math.floor(v.currentTime);
    visited.current.add(sec);
    const d = Math.max(1, Math.floor(v.duration));
    setRatio(Math.min(1, visited.current.size / d));
  }, [videoRef, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const v = videoRef.current as HTMLVideoElement | null;
    if (!v) return;
    const onTime = () => tick();
    v.addEventListener("loadedmetadata", onTime);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", onTime);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
    };
  }, [videoRef, enabled, tick]);

  useEffect(() => { if (!enabled) setRatio(1); }, [enabled]);

  const reset = () => { visited.current.clear(); setRatio(enabled ? 0 : 1); };
  return { ratio: enabled ? ratio : 1, reset, tick };
}

/** =================== Components =================== */

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-black/80 dark:bg-white/80 transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.round(value * 100))}%` }}
      />
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [selectedId, setSelectedId] = useState<UserId>("A");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const user = USERS.find(u => u.id === selectedId)!;

  const signIn = () => {
    if (pw !== user.passcode) { setErr("Invalid passcode."); return; }
    setErr(null);
    onSignedIn({ id: user.id, name: user.name, role: user.role, index: user.index });
  };

  return (
    <div className="max-w-md mx-auto p-6 rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40">
      <h2 className="text-lg font-semibold mb-1">Sign in</h2>
      <p className="text-xs opacity-70 mb-3">copyright@mocap</p>

      <div className="space-y-3">
        <label className="block text-sm">
          <span className="block mb-1 opacity-70">Account</span>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value as UserId)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900"
          >
            {USERS.map(u => (
              <option key={u.id} value={u.id}>
                {u.id} · {u.name}{u.role === "gt" ? " (GT)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="block mb-1 opacity-70">Passcode</span>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900"
          />
        </label>

        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}

        <button
          onClick={signIn}
          className="px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm"
        >
          Sign in
        </button>

        <div className="text-xs opacity-70 space-y-1">
          <div><strong>GT account</strong>: labels all battles (videoId winners) → export full labels.</div>
          <div><strong>Annotators A/B/C/D</strong>: QC labeling with intentional overlap → cross-check consistency.</div>
        </div>
      </div>
    </div>
  );
}

function VideoCard({
  sideLabel,
  title,
  subtitle,
  unit,
  units,
  selectedUnitId,
  onSelectUnitId,
  videoRef,
  enforceWatch,
  minWatchRatio,
  ratio,
  tick,
}: {
  sideLabel: "A" | "B";
  title: string;
  subtitle?: string;
  unit: Unit;
  units: Unit[];
  selectedUnitId: string;
  onSelectUnitId: (id: string) => void;
  videoRef: VideoRef;
  enforceWatch: boolean;
  minWatchRatio: number;
  ratio: number;
  tick: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);

  const explainMediaError = () => {
    const code = (videoRef.current as HTMLVideoElement | null)?.error?.code;
    switch (code) {
      case 1: return "ABORTED (stopped)";
      case 2: return "NETWORK (404/CORS)";
      case 3: return "DECODE (unsupported codec)";
      case 4: return "SRC_NOT_SUPPORTED (bad URL or unsupported type)";
      default: return null;
    }
  };

  const Gauge = ({ value }: { value: number }) => (
    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
      <div className="h-full bg-black/80 dark:bg-white/80" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );

  return (
    <div className="relative rounded-2xl shadow-sm ring-1 ring-black/5 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="absolute left-3 top-3 z-10 text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-black/80 text-white dark:bg-white/90 dark:text-black">
        {sideLabel}
      </div>

      <div className="absolute right-3 top-3 z-10 text-xs backdrop-blur px-2 py-1 rounded-full bg-white/80 text-black dark:bg-black/50 dark:text-white border border-black/10 max-w-[70%] truncate">
        <span className="font-medium">{title}</span>
        {subtitle ? <span className="ml-1 opacity-70">· {subtitle}</span> : null}
      </div>

      <div className="px-3 pt-12 pb-2">
        <label className="text-xs opacity-70">Clip</label>
        <select
          className="mt-1 w-full px-2 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-sm"
          value={selectedUnitId}
          onChange={(e) => onSelectUnitId(e.target.value)}
        >
          {units.map(u => (
            <option key={u.id} value={u.id}>
              {u.id}{u.videoId ? ` · ${u.videoId}` : ""}
            </option>
          ))}
        </select>
      </div>

      <video
        ref={videoRef as RefObject<HTMLVideoElement>}
        className="w-full bg-black block"
        src={unit.src}
        playsInline
        controls
        preload="metadata"
        onLoadedMetadata={tick}
        onTimeUpdate={tick}
        onSeeked={tick}
        onError={() => setErr(explainMediaError() || "Failed to load")}
      />

      {err && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300 space-y-1">
          <div>{err}</div>
          <div>URL: <span className="font-mono break-all">{unit.src}</span></div>
          {unit.rawSrc && unit.rawSrc !== unit.src && (
            <div>Original: <span className="font-mono break-all">{unit.rawSrc}</span></div>
          )}
          <a href={unit.src} target="_blank" rel="noreferrer" className="underline">Open in new tab</a>
        </div>
      )}

      {enforceWatch && (
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
            <span>Watch progress ≥ {Math.round(minWatchRatio * 100)}%</span>
            <span className="tabular-nums">{Math.round(ratio * 100)}%</span>
          </div>
          <Gauge value={ratio} />
        </div>
      )}
    </div>
  );
}

/** =================== Shared Winner Labeling Panel ===================
 * Used for both GT labeling and QC labeling.
 */
function WinnerLabelingPanel({
  headerTitle,
  headerSubtitle,
  dataset,
  user,
  battles,
  storageKey, // "gt" or "qc"
  map,
  setMap,
  fileFormat,
  exportFilenamePrefix,
}: {
  headerTitle: string;
  headerSubtitle: string;
  dataset: string;
  user: User;
  battles: Battle[];
  storageKey: "gt" | "qc";
  map: Record<string, WinnerDecision>;
  setMap: (m: Record<string, WinnerDecision>) => void;
  fileFormat: GTProgressFile["format"] | QCProgressFile["format"];
  exportFilenamePrefix: string;
}) {
  const salt = dataset;

  // UI state
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);

  const [selA, setSelA] = useState<string>("");
  const [selB, setSelB] = useState<string>("");
  const [syncPlay, setSyncPlay] = useState(false);

  // optional watch enforcement (default off)
  const enforceWatch = false;
  const minWatchRatio = 0.9;

  const vA = useRef<HTMLVideoElement>(null);
  const vB = useRef<HTMLVideoElement>(null);
  const Acov = useWatchCoverage(vA, enforceWatch);
  const Bcov = useWatchCoverage(vB, enforceWatch);
  const canSet = enforceWatch ? (Acov.ratio >= minWatchRatio && Bcov.ratio >= minWatchRatio) : true;

  const current = battles.length ? battles[Math.max(0, Math.min(cursor, battles.length - 1))] : null;

  const doneCount = useMemo(() => {
    let c = 0;
    for (const b of battles) if (map[b.videoId]) c++;
    return c;
  }, [battles, map]);

  const coverage = battles.length ? doneCount / battles.length : 0;

  useEffect(() => {
    if (!current) return;
    const a0 = current.dancers[0].units[0]?.id || "";
    const b0 = current.dancers[1].units[0]?.id || "";
    setSelA(a0);
    setSelB(b0);
    Acov.reset(); Bcov.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.videoId]);

  const unitA = useMemo(() => {
    if (!current) return null;
    return current.dancers[0].units.find(u => u.id === selA) || current.dancers[0].units[0] || null;
  }, [current, selA]);

  const unitB = useMemo(() => {
    if (!current) return null;
    return current.dancers[1].units.find(u => u.id === selB) || current.dancers[1].units[0] || null;
  }, [current, selB]);

  const currentWinner = current ? map[current.videoId]?.winnerDancerKey : undefined;

  const playBoth = async () => {
    try { await vA.current?.play(); await vB.current?.play(); setSyncPlay(true); } catch {}
  };
  const pauseBoth = () => { vA.current?.pause(); vB.current?.pause(); setSyncPlay(false); };
  const restartBoth = () => {
    if (vA.current) vA.current.currentTime = 0;
    if (vB.current) vB.current.currentTime = 0;
    Acov.reset(); Bcov.reset();
    Acov.tick();  Bcov.tick();
  };

  const goPrev = () => setCursor(c => Math.max(0, c - 1));
  const goNext = () => setCursor(c => Math.min(battles.length - 1, c + 1));

  const goNextUnlabeled = () => {
    if (!battles.length) return;
    const start = Math.max(0, Math.min(cursor, battles.length - 1));
    for (let step = 1; step <= battles.length; step++) {
      const i = (start + step) % battles.length;
      if (!map[battles[i].videoId]) { setCursor(i); return; }
    }
  };

  const setWinner = (side: 0 | 1) => {
    if (!current) return;
    if (!canSet) return;
    const winner = current.dancers[side].dancerKey;
    setMap({ ...map, [current.videoId]: { winnerDancerKey: winner, decidedAt: Date.now() } });
    setDirty(true);
    goNextUnlabeled();
  };

  const clearWinner = () => {
    if (!current) return;
    const copy = { ...map };
    delete copy[current.videoId];
    setMap(copy);
    setDirty(true);
  };

  const exportProgress = () => {
    const now = Date.now();
    const base = {
      format: fileFormat,
      dataset,
      user,
      salt,
      createdAt: now,
      updatedAt: now,
    };
    const payload = storageKey === "gt"
      ? ({ ...base, gt: map } as GTProgressFile)
      : ({ ...base, qc: map } as QCProgressFile);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJSON(payload, `${exportFilenamePrefix}_${user.id}_${ts}.json`);
    setDirty(false);
  };

  const importProgress = async (file: File) => {
    try {
      const json = await readJSONFile(file);
      if (!json || json.format !== fileFormat) throw new Error("Invalid progress format.");
      if (json.dataset !== dataset) throw new Error("Progress file does not match this dataset.");
      if (json.user?.id !== user.id) throw new Error("Progress file belongs to a different account.");

      const incoming = (storageKey === "gt" ? json.gt : json.qc) as Record<string, WinnerDecision>;
      if (!incoming || typeof incoming !== "object") throw new Error("Bad progress file payload.");
      setMap(incoming);
      setDirty(false);

      const firstUnlabeled = battles.findIndex(b => !incoming[b.videoId]);
      setCursor(firstUnlabeled >= 0 ? firstUnlabeled : 0);
      alert("Progress loaded.");
    } catch (e: any) {
      alert("Failed to import progress: " + (e?.message || String(e)));
    }
  };

  // Keyboard shortcuts: 1 => A wins, 2 => B wins, 0 => clear, u => next unlabeled, p/n => prev/next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "1") setWinner(0);
      else if (k === "2") setWinner(1);
      else if (k === "0") clearWinner();
      else if (k === "u") goNextUnlabeled();
      else if (k === "p") goPrev();
      else if (k === "n") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, canSet, cursor, battles, map]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <div className="font-medium">{headerTitle}</div>
            <div className="text-xs opacity-70">{headerSubtitle} · copyright@mocap</div>
          </div>

          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>Coverage</span>
              <span className="tabular-nums">{Math.round(coverage * 100)}%</span>
            </div>
            <ProgressBar value={coverage} />
            <div className="mt-1 text-xs opacity-70 tabular-nums">
              {doneCount} / {battles.length} battles labeled
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm">
              <span className="mr-2 opacity-70">Import</span>
              <input type="file" accept="application/json" onChange={(e) => e.currentTarget.files?.[0] && importProgress(e.currentTarget.files[0])} />
            </label>
            <button
              onClick={exportProgress}
              className={classNames("px-3 py-2 rounded-xl text-sm",
                dirty ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800")}
              title={dirty ? "You have unsaved changes. Export your file." : "Export progress."}
            >
              Export
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={goPrev} disabled={!battles.length || cursor <= 0}
                  className={classNames("px-3 py-2 rounded-xl text-sm",
                    cursor > 0 ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-100 dark:bg-neutral-900 cursor-not-allowed")}>
            ◀ Prev
          </button>
          <button onClick={goNext} disabled={!battles.length || cursor >= battles.length - 1}
                  className={classNames("px-3 py-2 rounded-xl text-sm",
                    cursor < battles.length - 1 ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-100 dark:bg-neutral-900 cursor-not-allowed")}>
            Next ▶
          </button>
          <button onClick={goNextUnlabeled} disabled={!battles.length}
                  className="px-3 py-2 rounded-xl text-sm bg-neutral-200 dark:bg-neutral-800">
            Next unlabeled (U)
          </button>

          <div className="ml-auto text-xs opacity-70 tabular-nums">
            {current ? <>Battle: <span className="font-mono">{current.videoId}</span> · {cursor + 1}/{battles.length}</> : "No battles."}
          </div>
        </div>
      </div>

      {current && unitA && unitB ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 max-w-6xl mx-auto px-4">
            <VideoCard
              sideLabel="A"
              title={current.dancers[0].dancerKey}
              subtitle={current.videoId}
              unit={unitA}
              units={current.dancers[0].units}
              selectedUnitId={selA}
              onSelectUnitId={setSelA}
              videoRef={vA}
              enforceWatch={enforceWatch}
              minWatchRatio={minWatchRatio}
              ratio={Acov.ratio}
              tick={Acov.tick}
            />
            <VideoCard
              sideLabel="B"
              title={current.dancers[1].dancerKey}
              subtitle={current.videoId}
              unit={unitB}
              units={current.dancers[1].units}
              selectedUnitId={selB}
              onSelectUnitId={setSelB}
              videoRef={vB}
              enforceWatch={enforceWatch}
              minWatchRatio={minWatchRatio}
              ratio={Bcov.ratio}
              tick={Bcov.tick}
            />
          </div>

          <div className="max-w-6xl mx-auto px-4">
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!syncPlay ? (
                <button onClick={playBoth} className="px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm">▶ Play both</button>
              ) : (
                <button onClick={pauseBoth} className="px-3 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-sm">⏸ Pause</button>
              )}
              <button onClick={restartBoth} className="px-3 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-sm">↺ Restart</button>

              <div className="ml-auto text-xs opacity-70">
                Hotkeys: <strong>1</strong>=A wins, <strong>2</strong>=B wins, <strong>0</strong>=Clear, <strong>U</strong>=Next unlabeled, <strong>P</strong>=Prev, <strong>N</strong>=Next
              </div>
            </div>
          </div>

          {/* fixed bottom bar: set winner */}
          <div className="fixed inset-x-0 bottom-0 z-50 h-20 md:h-24 border-t border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-white/60">
            <div className="max-w-6xl mx-auto h-full px-4 py-3 flex items-center gap-3">
              <div className="text-sm opacity-80 hidden md:block">
                {currentWinner ? (
                  <span>Current winner: <span className="font-semibold">{currentWinner}</span></span>
                ) : (
                  <span>No label yet. Please set the winner.</span>
                )}
              </div>

              <div className="flex gap-2 ml-auto w-full md:w-auto">
                <button
                  disabled={!canSet}
                  onClick={() => setWinner(0)}
                  className={classNames(
                    "flex-1 md:flex-none px-4 py-3 rounded-2xl text-base font-medium",
                    canSet ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed"
                  )}
                >
                  1 · A wins
                </button>
                <button
                  disabled={!canSet}
                  onClick={() => setWinner(1)}
                  className={classNames(
                    "flex-1 md:flex-none px-4 py-3 rounded-2xl text-base font-medium",
                    canSet ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed"
                  )}
                >
                  2 · B wins
                </button>
                <button
                  onClick={clearWinner}
                  className="flex-1 md:flex-none px-4 py-3 rounded-2xl text-base font-medium bg-neutral-200 dark:bg-neutral-800"
                >
                  0 · Clear
                </button>
              </div>
            </div>
          </div>

          <div aria-hidden className="h-24 md:h-28" />
        </>
      ) : (
        <div className="text-sm opacity-70 max-w-6xl mx-auto px-4">
          {battles.length === 0 ? "No battles available." : "Loading..."}
        </div>
      )}
    </div>
  );
}

/** =================== Finalize (GT only) ===================
 * - Uses GT map (binary winner per videoId)
 * - Exports full unit-level labels derived from GT (cross-product of winnerUnits × loserUnits per battle)
 * - Imports QC progress files and computes cross-check metrics
 */
function FinalizeTab({
  dataset,
  battles,
  gtMap,
  setGTMap,
}: {
  dataset: string;
  battles: Battle[];
  gtMap: Record<string, WinnerDecision>;
  setGTMap: (m: Record<string, WinnerDecision>) => void;
}) {
  const salt = dataset;

  // QC imports
  const [qcFiles, setQCFiles] = useState<QCProgressFile[]>([]);

  const battleById = useMemo(() => {
    const m = new Map<string, Battle>();
    for (const b of battles) m.set(b.videoId, b);
    return m;
  }, [battles]);

  // GT coverage
  const gtDone = useMemo(() => {
    let c = 0;
    for (const b of battles) if (gtMap[b.videoId]) c++;
    return c;
  }, [battles, gtMap]);

  const gtCoverage = battles.length ? gtDone / battles.length : 0;
  const gtComplete = battles.length > 0 && gtDone === battles.length;

  /** Import GT progress (for resume) */
  const importGT = async (file: File) => {
    try {
      const json = await readJSONFile(file);
      if (!json || json.format !== "gt-progress-v2") throw new Error("Invalid GT progress format.");
      if (json.dataset !== dataset) throw new Error("Dataset mismatch.");
      const incoming = (json.gt || {}) as Record<string, WinnerDecision>;
      setGTMap(incoming);
      alert("GT progress loaded.");
    } catch (e: any) {
      alert("Failed to import GT: " + (e?.message || String(e)));
    }
  };

  /** Export GT progress */
  const exportGT = () => {
    const now = Date.now();
    const payload: GTProgressFile = {
      format: "gt-progress-v2",
      dataset,
      user: { id: "GT", name: "GT Account", role: "gt", index: -1 },
      salt,
      gt: gtMap,
      createdAt: now,
      updatedAt: now,
    };
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJSON(payload, `gt_GT_${ts}.json`);
  };

  /** Import QC progress files (multiple) */
  const importQCFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const loaded: QCProgressFile[] = [];
    for (const file of Array.from(files)) {
      try {
        const json = await readJSONFile(file);
        if (!json || json.format !== "qc-progress-v1") throw new Error("Invalid QC progress format.");
        if (json.dataset !== dataset) throw new Error("Dataset mismatch.");
        loaded.push(json as QCProgressFile);
      } catch (e: any) {
        alert(`Failed to import ${file.name}: ` + (e?.message || String(e)));
      }
    }
    if (loaded.length) {
      setQCFiles(prev => {
        // replace by user.id if exists
        const byUser = new Map<string, QCProgressFile>();
        for (const p of prev) byUser.set(p.user.id, p);
        for (const n of loaded) byUser.set(n.user.id, n);
        return Array.from(byUser.values()).sort((a, b) => a.user.id.localeCompare(b.user.id));
      });
      alert(`Imported ${loaded.length} QC file(s).`);
    }
  };

  /** QC metrics: accuracy vs GT */
  const qcMetrics = useMemo(() => {
    const out: Array<{
      userId: string;
      labeled: number;
      comparable: number;
      correct: number;
      accuracy: number | null;
    }> = [];

    for (const f of qcFiles) {
      const qc = f.qc || {};
      const labeled = Object.keys(qc).length;
      let comparable = 0;
      let correct = 0;

      for (const [vid, dec] of Object.entries(qc)) {
        const gt = gtMap[vid];
        if (!gt) continue; // GT not set yet
        comparable++;
        if (gt.winnerDancerKey === dec.winnerDancerKey) correct++;
      }
      out.push({
        userId: f.user.id,
        labeled,
        comparable,
        correct,
        accuracy: comparable > 0 ? correct / comparable : null,
      });
    }
    return out;
  }, [qcFiles, gtMap]);

  /** Pairwise agreement among QC annotators */
  const qcAgreement = useMemo(() => {
    const ids = qcFiles.map(f => f.user.id).sort();
    const fileById = new Map(ids.map(id => [id, qcFiles.find(f => f.user.id === id)!]));

    const pairs: Array<{ a: string; b: string; both: number; agree: number; rate: number | null }> = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const fa = fileById.get(a);
        const fb = fileById.get(b);
        if (!fa || !fb) continue;

        const qa = fa.qc || {};
        const qb = fb.qc || {};

        let both = 0;
        let agree = 0;
        for (const vid of Object.keys(qa)) {
          const wa = qa[vid]?.winnerDancerKey;
          const wb = qb[vid]?.winnerDancerKey;
          if (!wa || !wb) continue;
          both++;
          if (wa === wb) agree++;
        }

        pairs.push({ a, b, both, agree, rate: both > 0 ? agree / both : null });
      }
    }
    return pairs;
  }, [qcFiles]);

  /** Export full labels derived from GT (requires complete GT) */
  const exportLabelsFromGT = () => {
    if (!gtComplete) {
      alert("GT is not complete yet. Please finish GT for all battles first.");
      return;
    }

    const rows: Array<Record<string, any>> = [];
    const battleRows: Array<Record<string, any>> = [];

    for (const b of battles) {
      const vid = b.videoId;
      const gt = gtMap[vid];
      if (!gt) continue;

      const d0 = b.dancers[0];
      const d1 = b.dancers[1];
      const winnerKey = gt.winnerDancerKey;
      const loserKey = winnerKey === d0.dancerKey ? d1.dancerKey : d0.dancerKey;

      const winnerUnits = (winnerKey === d0.dancerKey ? d0.units : d1.units);
      const loserUnits  = (loserKey  === d0.dancerKey ? d0.units : d1.units);

      battleRows.push({
        video_id: vid,
        winner_dancer: winnerKey,
        loser_dancer: loserKey,
        source: "gt",
      });

      // Full cross-product: every winner unit beats every loser unit
      for (const wu of winnerUnits) {
        for (const lu of loserUnits) {
          rows.push({
            video_id: vid,
            winner_dancer: winnerKey,
            loser_dancer: loserKey,
            winner_unit_id: wu.id,
            loser_unit_id: lu.id,
            score: 2,
            source: "gt",
          });
        }
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");

    // JSON exports
    downloadJSON({ format: "labels-from-gt-v1", dataset, createdAt: Date.now(), labels: rows }, `labels_from_gt_${ts}.json`);
    downloadJSON({ format: "gt-battles-v1", dataset, createdAt: Date.now(), battles: battleRows }, `gt_battles_${ts}.json`);

    // CSV exports
    try {
      const csv1 = Papa.unparse(rows);
      downloadText(csv1, `labels_from_gt_${ts}.csv`, "text/csv");
      const csv2 = Papa.unparse(battleRows);
      downloadText(csv2, `gt_battles_${ts}.csv`, "text/csv");
    } catch {
      // JSON already exported
    }

    alert("Exported labels_from_gt and gt_battles (CSV + JSON).");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <div className="font-medium">Finalize & Export</div>
            <div className="text-xs opacity-70">Requires GT to be complete. Import QC files to compute cross-check metrics. · copyright@mocap</div>
          </div>

          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>GT coverage</span>
              <span className="tabular-nums">{Math.round(gtCoverage * 100)}%</span>
            </div>
            <ProgressBar value={gtCoverage} />
            <div className="mt-1 text-xs opacity-70 tabular-nums">
              {gtDone} / {battles.length} battles labeled · {gtComplete ? "GT complete ✅" : "GT incomplete"}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm">
              <span className="mr-2 opacity-70">Import GT</span>
              <input type="file" accept="application/json" onChange={(e) => e.currentTarget.files?.[0] && importGT(e.currentTarget.files[0])} />
            </label>
            <button
              onClick={exportGT}
              className="px-3 py-2 rounded-xl text-sm bg-neutral-200 dark:bg-neutral-800"
              title="Export GT progress (for backup/resume)"
            >
              Export GT
            </button>
            <button
              onClick={exportLabelsFromGT}
              disabled={!gtComplete}
              className={classNames(
                "px-3 py-2 rounded-xl text-sm",
                gtComplete ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-100 dark:bg-neutral-900 cursor-not-allowed"
              )}
              title={gtComplete ? "Export full labels derived from GT" : "Finish GT first"}
            >
              Export full labels
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="mr-2 opacity-70">Import QC files</span>
            <input type="file" accept="application/json" multiple onChange={(e) => importQCFiles(e.currentTarget.files)} />
          </label>
          <div className="text-xs opacity-70">
            Imported QC: {qcFiles.length ? qcFiles.map(f => f.user.id).join(", ") : "none"}
          </div>
        </div>
      </div>

      {/* QC Metrics */}
      {qcFiles.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 space-y-4">
          <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30">
            <div className="text-sm font-medium mb-2">QC accuracy vs GT</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs opacity-70">
                  <tr>
                    <th className="text-left py-2">Annotator</th>
                    <th className="text-right py-2">Labeled</th>
                    <th className="text-right py-2">Comparable (GT exists)</th>
                    <th className="text-right py-2">Correct</th>
                    <th className="text-right py-2">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {qcMetrics.map(m => (
                    <tr key={m.userId} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-2">{m.userId}</td>
                      <td className="py-2 text-right tabular-nums">{m.labeled}</td>
                      <td className="py-2 text-right tabular-nums">{m.comparable}</td>
                      <td className="py-2 text-right tabular-nums">{m.correct}</td>
                      <td className="py-2 text-right tabular-nums">
                        {m.accuracy === null ? "—" : `${Math.round(m.accuracy * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs opacity-70">
              Note: accuracy uses only battles where GT is already labeled.
            </div>
          </div>

          <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30">
            <div className="text-sm font-medium mb-2">Pairwise agreement between QC annotators</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs opacity-70">
                  <tr>
                    <th className="text-left py-2">Pair</th>
                    <th className="text-right py-2">Both labeled</th>
                    <th className="text-right py-2">Agree</th>
                    <th className="text-right py-2">Agreement</th>
                  </tr>
                </thead>
                <tbody>
                  {qcAgreement.length === 0 ? (
                    <tr className="border-t border-black/5 dark:border-white/10">
                      <td className="py-2 opacity-70" colSpan={4}>Need at least 2 QC files to compute agreement.</td>
                    </tr>
                  ) : (
                    qcAgreement.map(p => (
                      <tr key={`${p.a}-${p.b}`} className="border-t border-black/5 dark:border-white/10">
                        <td className="py-2">{p.a} × {p.b}</td>
                        <td className="py-2 text-right tabular-nums">{p.both}</td>
                        <td className="py-2 text-right tabular-nums">{p.agree}</td>
                        <td className="py-2 text-right tabular-nums">
                          {p.rate === null ? "—" : `${Math.round(p.rate * 100)}%`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs opacity-70">
              Agreement is computed over battles that both annotators labeled (independent of GT).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** =================== App =================== */
export default function WhoDanceBetterApp() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // GT map lives in parent so GT labeling and Finalize share it
  const [gtMap, setGTMap] = useState<Record<string, WinnerDecision>>({});

  const [tab, setTab] = useState<"label" | "finalize">("label");

  const fromCSVRow = (row: any): Unit | null => {
    const unit_id   = row?.unit_id   ?? row?.UNIT_ID   ?? row?.UnitId;
    const video_id  = row?.video_id  ?? row?.VIDEO_ID  ?? row?.VideoId;
    const dancer_id = row?.dancer_id ?? row?.DANCER_ID ?? row?.DancerId;
    const clip_path = row?.clip_path ?? row?.CLIP_PATH ?? row?.ClipPath ?? (unit_id ? `${unit_id}.mp4` : "");
    if (!unit_id || !clip_path) return null;
    const raw = String(clip_path);
    return {
      id: String(unit_id),
      dancerId: dancer_id ? String(dancer_id) : undefined,
      videoId:  video_id  ? String(video_id)  : undefined,
      src: resolveClipUrl(raw),
      rawSrc: raw,
    };
  };

  useEffect(() => {
    setErrorMsg(null);
    Papa.parse(DATA_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const rows = Array.isArray(res?.data) ? (res.data as any[]) : [];
          const parsed = rows.map(fromCSVRow).filter(Boolean) as Unit[];
          setUnits(parsed);
          if (!parsed.length) setErrorMsg("CSV loaded, but no valid rows (need unit_id & clip_path).");
        } catch (e: any) {
          setErrorMsg("CSV handling failed: " + (e?.message || String(e)));
        }
      },
      error: (err) => setErrorMsg("Failed to load CSV: " + (err?.message || String(err))),
    });
  }, []);

  /** Build battles: group by videoId, then by dancerKey (expect exactly 2 dancers per videoId) */
  const { battles, invalidBattleCount } = useMemo(() => {
    const byVid: Record<string, Unit[]> = {};
    for (const u of units) {
      if (!u.videoId) continue;
      (byVid[u.videoId] ||= []).push(u);
    }

    const out: Battle[] = [];
    let invalid = 0;

    const vids = Object.keys(byVid).sort();
    for (const vid of vids) {
      const arr = byVid[vid];
      const byD: Record<string, Unit[]> = {};

      for (const u of arr) {
        const dk = u.dancerId || u.dancer || u.id;
        (byD[dk] ||= []).push(u);
      }

      const keys = Object.keys(byD);
      if (keys.length !== 2) { invalid++; continue; }
      keys.sort();

      out.push({
        videoId: vid,
        dancers: [
          { dancerKey: keys[0], units: byD[keys[0]] },
          { dancerKey: keys[1], units: byD[keys[1]] },
        ],
      });
    }

    return { battles: out, invalidBattleCount: invalid };
  }, [units]);

  /** QC assigned battles for a specific annotator */
  const qcAssignedBattles = useMemo(() => {
    if (!user || user.role !== "annotator") return [] as Battle[];
    const salt = DATA_CSV_URL;
    return battles.filter(b => qcAssigneesForBattle(b.videoId, salt).includes(user.index));
  }, [battles, user]);

  const qcSharedCount = useMemo(() => {
    if (!user || user.role !== "annotator") return 0;
    const salt = DATA_CSV_URL;
    let c = 0;
    for (const b of qcAssignedBattles) {
      if (qcAssigneesForBattle(b.videoId, salt).length > 1) c++;
    }
    return c;
  }, [qcAssignedBattles, user]);

  // QC map is per annotator (local state inside panel), but we keep it here only if needed later.
  const [qcMap, setQCMap] = useState<Record<string, WinnerDecision>>({});

  // Reset maps on sign-out
  const signOut = () => {
    setUser(null);
    setTab("label");
    setQCMap({});
    // Keep GT map in memory? Usually clear to avoid mixing sessions.
    setGTMap({});
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Who Dance Better</h1>
          <div className="text-xs opacity-70">copyright@mocap</div>
        </div>

        <div className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
          <div>Dataset: <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">{DATA_CSV_URL}</code></div>
          <div>
            Valid battles (videoId with exactly 2 dancers): <strong>{battles.length}</strong>
            {invalidBattleCount ? <span className="ml-2 opacity-70">(ignored invalid: {invalidBattleCount})</span> : null}
          </div>
          <div className="text-xs opacity-70">
            QC overlap rate: <strong>{Math.round(QC_OVERLAP_RATE * 100)}%</strong> (some battles assigned to 2 annotators for cross-check)
          </div>
        </div>

        {errorMsg && (
          <div className="text-sm text-red-600 dark:text-red-400">{errorMsg}</div>
        )}

        {!user ? (
          <SignIn onSignedIn={setUser} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab("label")}
                className={classNames(
                  "px-3 py-2 rounded-xl text-sm",
                  tab === "label" ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800"
                )}
              >
                {user.role === "gt" ? "GT Labeling" : "QC Labeling"}
              </button>

              {user.role === "gt" && (
                <button
                  onClick={() => setTab("finalize")}
                  className={classNames(
                    "px-3 py-2 rounded-xl text-sm",
                    tab === "finalize" ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800"
                  )}
                >
                  Finalize & Export
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <div className="text-xs opacity-70">
                  Signed in as <strong>{user.id}</strong> · {user.name}
                </div>
                <button
                  onClick={signOut}
                  className="px-3 py-2 rounded-xl text-sm bg-neutral-200 dark:bg-neutral-800"
                >
                  Sign out
                </button>
              </div>
            </div>

            {/* Role-specific header */}
            {user.role === "annotator" && tab === "label" && (
              <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30 text-sm">
                <div className="font-medium">QC assignment</div>
                <div className="text-xs opacity-70 mt-1">
                  You are assigned <strong>{qcAssignedBattles.length}</strong> battles; <strong>{qcSharedCount}</strong> are shared with another annotator (overlap cross-check).
                  Export your QC file regularly so the GT account can compute agreement metrics.
                </div>
              </div>
            )}

            {tab === "label" ? (
              user.role === "gt" ? (
                <WinnerLabelingPanel
                  headerTitle="GT labeling (official)"
                  headerSubtitle="Label ALL battles. This will be used to generate full unit-level labels."
                  dataset={DATA_CSV_URL}
                  user={user}
                  battles={battles}
                  storageKey="gt"
                  map={gtMap}
                  setMap={setGTMap}
                  fileFormat="gt-progress-v2"
                  exportFilenamePrefix="gt"
                />
              ) : (
                <WinnerLabelingPanel
                  headerTitle="QC labeling (overlapped cross-check)"
                  headerSubtitle="Label your assigned battles. Some battles overlap between annotators to measure consistency."
                  dataset={DATA_CSV_URL}
                  user={user}
                  battles={qcAssignedBattles}
                  storageKey="qc"
                  map={qcMap}
                  setMap={setQCMap}
                  fileFormat="qc-progress-v1"
                  exportFilenamePrefix="qc"
                />
              )
            ) : (
              <FinalizeTab dataset={DATA_CSV_URL} battles={battles} gtMap={gtMap} setGTMap={setGTMap} />
            )}
          </>
        )}
      </div>
    </div>
  );
}