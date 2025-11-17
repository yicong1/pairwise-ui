import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MutableRefObject, RefObject } from "react";
import Papa from "papaparse";
import { DATA_CSV_URL, VIDEO_PREFIX_URL, FORCE_MP4 } from "./config";

/** =================== Config: 4 annotators & simple passcodes ===================
 * Edit these to your real annotators and passcodes (demo values below). */
const USERS = [
  { id: "A", name: "Annotator A", index: 0, passcode: "aaa" },
  { id: "B", name: "Annotator B", index: 1, passcode: "bbb" },
  { id: "C", name: "Annotator C", index: 2, passcode: "ccc" },
  { id: "D", name: "Annotator D", index: 3, passcode: "ddd" },
] as const;
type UserId = typeof USERS[number]["id"];
const OWNER_COUNT = 4; // 4 annotators split

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

export type Preference =
  | "A_better"
  | "A_slightly_better"
  | "tie"
  | "B_slightly_better"
  | "B_better";

type Submission = {
  preference: Preference;
  score: number;
  timestamp: number;
  watched: { A: number; B: number };
};

type HistoryItem = {
  A: Unit;   // shown on LEFT (A)
  B: Unit;   // shown on RIGHT (B)
  submission?: Submission;
};

/** File format persisted on export */
type PersistedState = {
  format: "pairwise-progress-v1";
  dataset: string;              // DATA_CSV_URL
  user: { id: UserId; name: string; index: number };
  salt: string;                  // used for pair assignment (DATA_CSV_URL)
  idx: number;                   // current pointer in history
  history: Array<{
    A: string;                   // unit.id
    B: string;                   // unit.id
    submission?: Submission;
  }>;
  createdAt: number;
  updatedAt: number;
};

/** =================== Utilities =================== */
function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function preferenceToScore(p: Preference): number {
  switch (p) {
    case "A_better": return  2;
    case "A_slightly_better": return 1;
    case "tie": return 0;
    case "B_slightly_better": return -1;
    case "B_better": return -2;
  }
}
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
/** Strict TS ref type */
type VideoRef = MutableRefObject<HTMLVideoElement | null> | RefObject<HTMLVideoElement | null>;
/** Simple djb2 hash → owner index (0..3) */
function hashStrDJB2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h | 0;
}
function ownerIndexForPair(pairKey: string, salt: string): number {
  const h = hashStrDJB2(pairKey + "::" + salt);
  const x = h % OWNER_COUNT;
  return (x + OWNER_COUNT) % OWNER_COUNT;
}
function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function downloadJSON(obj: any, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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

/** =================== Watch coverage hook =================== */
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

/** =================== PairwiseTask (with fixed bottom buttons) =================== */
function PairwiseTask({
  taskId, A, B,
  enforceWatch = false,
  minWatchRatio = 0.9,
  onSubmit,
}: {
  taskId: string;
  A: Unit; B: Unit;
  enforceWatch?: boolean; minWatchRatio?: number;
  onSubmit: (payload: {
    taskId: string;
    preference: Preference;
    score: number;
    A: Unit; B: Unit;
    watched: { A: number; B: number };
    timestamp: number;
  }) => void;
}) {
  const vA = useRef<HTMLVideoElement>(null);
  const vB = useRef<HTMLVideoElement>(null);
  const Acov = useWatchCoverage(vA, enforceWatch);
  const Bcov = useWatchCoverage(vB, enforceWatch);

  const [syncPlay, setSyncPlay] = useState(false);
  const canVote = enforceWatch
    ? (Acov.ratio >= minWatchRatio && Bcov.ratio >= minWatchRatio)
    : true;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !canVote) return;
      const k = e.key;
      if (k === "1") submit("A_better");
      else if (k === "2") submit("A_slightly_better");
      else if (k === "3") submit("tie");
      else if (k === "4") submit("B_slightly_better");
      else if (k === "5") submit("B_better");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canVote]);

  const playBoth = async () => { try { await vA.current?.play(); await vB.current?.play(); setSyncPlay(true); } catch {} };
  const pauseBoth = () => { vA.current?.pause(); vB.current?.pause(); setSyncPlay(false); };
  const restartBoth = () => {
    if (vA.current) vA.current.currentTime = 0;
    if (vB.current) vB.current.currentTime = 0;
    Acov.reset(); Bcov.reset(); Acov.tick(); Bcov.tick();
  };

  const submit = (preference: Preference) => {
    onSubmit?.({
      taskId, preference, score: preferenceToScore(preference),
      A, B, watched: { A: Acov.ratio, B: Bcov.ratio }, timestamp: Date.now(),
    });
  };

  const Gauge = ({ value }: { value: number }) => (
    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
      <div className="h-full bg-black/80 dark:bg-white/80" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );

  const Card = ({ unit, side, videoRef, ratio, tick }:{
    unit: Unit; side: "A" | "B"; videoRef: VideoRef; ratio: number; tick: () => void;
  }) => {
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
    return (
      <div className="relative rounded-2xl shadow-sm ring-1 ring-black/5 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="absolute left-3 top-3 z-10 text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-black/80 text-white dark:bg-white/90 dark:text-black">
          {side}
        </div>
        <div className="absolute right-3 top-3 z-10 text-xs backdrop-blur px-2 py-1 rounded-full bg-white/80 text-black dark:bg-black/50 dark:text-white border border-black/10 max-w-[70%] truncate">
          <span className="font-medium">{unit.dancer || unit.id}</span>
          {unit.videoId ? <span className="ml-1 opacity-70">· {unit.videoId}</span> : null}
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
            {unit.rawSrc && unit.rawSrc !== unit.src && (<div>Original: <span className="font-mono break-all">{unit.rawSrc}</span></div>)}
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
  };

  return (
    <div className="max-w-6xl mx-auto px-4 pb-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card unit={A} side="A" videoRef={vA} ratio={Acov.ratio} tick={Acov.tick} />
        <Card unit={B} side="B" videoRef={vB} ratio={Bcov.ratio} tick={Bcov.tick} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!syncPlay ? (
          <button onClick={playBoth} className="px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm">▶ Play both</button>
        ) : (
          <button onClick={pauseBoth} className="px-3 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-sm">⏸ Pause</button>
        )}
        <button onClick={restartBoth} className="px-3 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-sm">↺ Restart</button>
        <div className="ml-auto text-xs opacity-70">
          Hotkeys: 1=A better, 2=A slightly, 3=Tie, 4=B slightly, 5=B better
        </div>
      </div>

      {/* spacer for fixed bottom bar */}
      <div aria-hidden className="h-24 md:h-28" />

      {/* fixed bottom bar: five-level preference */}
      <div className="fixed inset-x-0 bottom-0 z-50 h-24 md:h-28 border-t border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-6xl mx-auto h-full px-4 py-3 flex flex-col md:flex-row items-center gap-3">
          <div className="text-sm opacity-80">
            {canVote ? <span>Select a preference or press 1–5.</span>
                     : <span className="text-red-600 dark:text-red-400">Please watch both sides to the threshold first.</span>}
          </div>
          <div className="flex gap-2 ml-auto w-full md:w-auto">
            <button
              disabled={!canVote}
              onClick={() => submit("A_better")}
              className={classNames("flex-1 md:flex-none px-3 py-3 rounded-2xl text-base font-medium",
                                    canVote ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed")}
            >
              1 · A better
            </button>
            <button
              disabled={!canVote}
              onClick={() => submit("A_slightly_better")}
              className={classNames("flex-1 md:flex-none px-3 py-3 rounded-2xl text-base font-medium",
                                    canVote ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed")}
            >
              2 · A slightly
            </button>
            <button
              disabled={!canVote}
              onClick={() => submit("tie")}
              className={classNames("flex-1 md:flex-none px-3 py-3 rounded-2xl text-base font-medium",
                                    canVote ? "bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed")}
            >
              3 · Tie
            </button>
            <button
              disabled={!canVote}
              onClick={() => submit("B_slightly_better")}
              className={classNames("flex-1 md:flex-none px-3 py-3 rounded-2xl text-base font-medium",
                                    canVote ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed")}
            >
              4 · B slightly
            </button>
            <button
              disabled={!canVote}
              onClick={() => submit("B_better")}
              className={classNames("flex-1 md:flex-none px-3 py-3 rounded-2xl text-base font-medium",
                                    canVote ? "bg-black text-white dark:bg-white dark:text-black" : "bg-neutral-200 dark:bg-neutral-800 cursor-not-allowed")}
            >
              5 · B better
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** =================== Sign-in =================== */
function SignIn({
  onSignedIn, onImportForPreload,
}: {
  onSignedIn: (user: { id: UserId; name: string; index: number }) => void;
  onImportForPreload: (file: File) => void;
}) {
  const [selectedId, setSelectedId] = useState<UserId>("A");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const user = USERS.find(u => u.id === selectedId)!;

  const signIn = () => {
    if (pw !== user.passcode) { setErr("Invalid passcode."); return; }
    setErr(null);
    onSignedIn({ id: user.id, name: user.name, index: user.index });
  };

  return (
    <div className="max-w-md mx-auto p-6 rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40">
      <h2 className="text-lg font-semibold mb-1">Sign in</h2>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="block mb-1 opacity-70">Annotator</span>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value as UserId)}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900">
            {USERS.map(u => <option key={u.id} value={u.id}>{u.id} · {u.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block mb-1 opacity-70">Passcode</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                 className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        </label>
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
        <div className="flex items-center gap-2">
          <button onClick={signIn}
                  className="px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm">
            Sign in
          </button>
          <label className="ml-auto text-sm">
            <span className="mr-2 opacity-70">Import progress</span>
            <input type="file" accept="application/json"
                   onChange={e => e.currentTarget.files?.[0] && onImportForPreload(e.currentTarget.files[0])} />
          </label>
        </div>
        <p className="text-xs opacity-70">
          Tip: importing here will pre-fill identity & history after dataset loads. You still must pass the correct passcode.
        </p>
      </div>
    </div>
  );
}

/** =================== Main: CSV + 4-annotator split + file import/export =================== */
export default function PairwiseWith4Annotators() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [signedIn, setSignedIn] = useState<{ id: UserId; name: string; index: number } | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [idx, setIdx] = useState<number>(-1);

  const preloadFileRef = useRef<File | null>(null);
  const [dirty, setDirty] = useState(false);

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

  /** Load CSV once */
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

  /** beforeunload warning when unsaved changes exist */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Assigned pairs total for current annotator */
  const assignedTotalPairs = useMemo(() => {
    if (!signedIn || units.length < 2) return 0;
    const salt = DATA_CSV_URL;
    let count = 0;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const key = `${units[i].id}|${units[j].id}`;
        if (ownerIndexForPair(key, salt) === signedIn.index) count++;
      }
    }
    return count;
  }, [signedIn, units]);

  /** Judgments & unique pair coverage (for this annotator only) */
  const { judgments, uniquePairs } = useMemo(() => {
    const submitted = history.filter(h => !!h.submission);
    const set = new Set<string>();
    for (const h of submitted) set.add(pairKey(h.A.id, h.B.id));
    return { judgments: submitted.length, uniquePairs: set.size };
  }, [history]);
  const coverage = assignedTotalPairs > 0 ? uniquePairs / assignedTotalPairs : 0;

  /** Preload (before login) */
  const handleImportPreload = async (file: File) => {
    preloadFileRef.current = file;
    alert("Progress file selected. After sign-in, it will be loaded.");
  };

  /** After sign-in: try preload file, else bootstrap first pair */
  useEffect(() => {
    (async () => {
      if (!signedIn) return;
      setDirty(false);
      setHistory([]); setIdx(-1);
      if (preloadFileRef.current) {
        try {
          const data = await readJSONFile(preloadFileRef.current);
          await restoreFromProgressFile(data, /*strictUser=*/true);
          preloadFileRef.current = null;
          return;
        } catch (e: any) {
          alert("Failed to import progress file: " + (e?.message || String(e)));
        }
      }
      // No file → create first assigned pair
      if (units.length >= 2) {
        const next = pickNextAssignedPair(units, signedIn.index, new Set());
        if (next) {
          setHistory([{ A: next.A, B: next.B }]);
          setIdx(0);
        } else {
          alert("No unlabelled pairs assigned to you.");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, units]);

  /** Restore from progress file */
  async function restoreFromProgressFile(json: any, strictUser = true) {
    if (!json || json.format !== "pairwise-progress-v1") {
      throw new Error("Invalid progress file format.");
    }
    if (json.dataset !== DATA_CSV_URL) {
      throw new Error("Progress file does not match current dataset.");
    }
    const userInFile = json.user as PersistedState["user"];
    if (strictUser) {
      if (!signedIn || userInFile?.id !== signedIn.id) {
        throw new Error("Progress file belongs to a different annotator.");
      }
    }

    const byId = new Map(units.map(u => [u.id, u]));
    const restored: HistoryItem[] = (json.history as PersistedState["history"])
      .map(h => {
        const A = byId.get(h.A); const B = byId.get(h.B);
        if (!A || !B) return null;
        return { A, B, submission: h.submission };
      })
      .filter(Boolean) as HistoryItem[];
    if (!restored.length) throw new Error("No valid pairs in progress file.");
    const restoredIdx = Math.max(0, Math.min(typeof json.idx === "number" ? json.idx : restored.length - 1, restored.length - 1));
    setHistory(restored);
    setIdx(restoredIdx);
    setDirty(false);
  }

  /** Choose next unlabelled pair assigned to current annotator */
  function pickNextAssignedPair(pool: Unit[], ownerIndex: number, already: Set<string>) {
    const salt = DATA_CSV_URL;
    // random attempts
    for (let t = 0; t < 500; t++) {
      let a = pool[Math.floor(Math.random() * pool.length)];
      let b = pool[Math.floor(Math.random() * pool.length)];
      if (a.id === b.id) continue;
      const key = pairKey(a.id, b.id);
      if (ownerIndexForPair(key, salt) !== ownerIndex) continue;
      if (already.has(key)) continue;
      if (Math.random() < 0.5) [a, b] = [b, a];
      return { A: a, B: b };
    }
    // full scan fallback
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const key = pairKey(pool[i].id, pool[j].id);
        if (ownerIndexForPair(key, salt) === ownerIndex && !already.has(key)) {
          const A = Math.random() < 0.5 ? pool[i] : pool[j];
          const B = A === pool[i] ? pool[j] : pool[i];
          return { A, B };
        }
      }
    }
    return null;
  }

  /** After submit: move forward if exists, else append a new assigned pair */
  const advanceOrAppend = () => {
    if (!signedIn) return;
    const submittedKeys = new Set(history.filter(h => !!h.submission).map(h => pairKey(h.A.id, h.B.id)));
    if (idx >= 0 && idx < history.length - 1) {
      setIdx(i => Math.min(i + 1, history.length - 1));
      return;
    }
    const next = pickNextAssignedPair(units, signedIn.index, submittedKeys);
    if (next) {
      setHistory(prev => [...prev, { A: next.A, B: next.B }]);
      setIdx(history.length);
    } else {
      alert("All assigned pairs have been labeled. Great job!");
    }
  };

  /** Receive submission from PairwiseTask */
  const handleSubmit = (p: {
    taskId: string;
    preference: Preference;
    score: number;
    A: Unit; B: Unit;
    watched: { A: number; B: number };
    timestamp: number;
  }) => {
    if (!signedIn) return;
    setHistory(prev => {
      if (idx < 0 || idx >= prev.length) return prev;
      const clone = prev.slice();
      const item = clone[idx];
      clone[idx] = { ...item, submission: {
        preference: p.preference, score: p.score, timestamp: p.timestamp, watched: p.watched
      }};
      return clone;
    });
    setDirty(true);
    advanceOrAppend();
  };

  /** Export JSON progress */
  const exportProgress = () => {
    if (!signedIn) return;
    const payload: PersistedState = {
      format: "pairwise-progress-v1",
      dataset: DATA_CSV_URL,
      user: signedIn,
      salt: DATA_CSV_URL,
      idx,
      history: history.map(h => ({ A: h.A.id, B: h.B.id, submission: h.submission })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `pairwise_${signedIn.id}_${ts}.json`;
    downloadJSON(payload, filename);
    setDirty(false);
  };

  /** Import after login */
  const handleImportAfterLogin = async (file: File) => {
    try {
      const data = await readJSONFile(file);
      await restoreFromProgressFile(data, /*strictUser=*/true);
      alert("Progress loaded.");
    } catch (e: any) {
      alert("Failed to import progress: " + (e?.message || String(e)));
    }
  };

  /** Progress bar */
  const ProgressBar = ({ value }: { value: number }) => (
    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
      <div className="h-full bg-black/80 dark:bg-white/80 transition-[width] duration-300"
           style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );

  const Toolbar = () => {
    const canGoBack = idx > 0;
    const canGoForward = idx >= 0 && idx < history.length - 1;
    return (
      <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-white/70 dark:bg-black/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <div className="font-medium">{signedIn?.id} · {signedIn?.name}</div>
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div>
              <div className="text-xs opacity-70">Judgments (submitted)</div>
              <div className="text-2xl font-semibold tabular-nums">{judgments}</div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>Assigned unique coverage</span>
                <span className="tabular-nums">{Math.round(coverage * 100)}%</span>
              </div>
              <ProgressBar value={coverage} />
              <div className="mt-1 text-xs opacity-70 tabular-nums">
                {uniquePairs} / {assignedTotalPairs} pairs
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => canGoBack && setIdx(i => Math.max(0, i - 1))}
                disabled={!canGoBack}
                className={classNames(
                  "px-3 py-2 rounded-xl text-sm",
                  canGoBack ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-100 dark:bg-neutral-900 cursor-not-allowed"
                )}
                title="Back to previous (relabel)"
              >
                ◀ Back (Relabel)
              </button>
              <button
                onClick={() => canGoForward && setIdx(i => Math.min(history.length - 1, i + 1))}
                disabled={!canGoForward}
                className={classNames(
                  "px-3 py-2 rounded-xl text-sm",
                  canGoForward ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-100 dark:bg-neutral-900 cursor-not-allowed"
                )}
                title="Next in history"
              >
                Next ▶
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <label className="text-sm">
              <span className="mr-2 opacity-70">Import progress</span>
              <input type="file" accept="application/json"
                     onChange={(e) => e.currentTarget.files?.[0] && handleImportAfterLogin(e.currentTarget.files[0])} />
            </label>
            <button onClick={exportProgress}
                    className="px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm">
              Export progress
            </button>
          </div>
        </div>
      </div>
    );
  };

  const current = idx >= 0 ? history[idx] : null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Who Dance Better</h1>
          <div className="text-xs opacity-70">2025@mocap</div>
        </div>

        {!signedIn ? (
          <SignIn
            onSignedIn={setSignedIn}
            onImportForPreload={handleImportPreload}
          />
        ) : (
          <>
            <Toolbar />
            {errorMsg && <div className="text-xs text-red-600 dark:text-red-400">{errorMsg}</div>}

            {current ? (
              <PairwiseTask
                taskId={"task-" + idx}
                A={current.A}
                B={current.B}
                enforceWatch={false}
                minWatchRatio={0.9}
                onSubmit={handleSubmit}
              />
            ) : (
              <div className="mt-2 text-sm opacity-70">
                {units.length > 1
                  ? "No active pair. If you imported a progress file, use Back/Next to navigate."
                  : "Waiting for dataset (need at least 2 units)."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
