# Who Dance Better · Pairwise Labeling 
*4 annotators · file‑based progress · five‑level preference*

A lightweight web app for **pairwise dance quality judgments**. It supports:

- **Five-level preference**: `1=A better, 2=A slightly, 3=Tie, 4=B slightly, 5=B better)`
- **Four annotators** with **deterministic, non‑overlapping** task split
- **Identity verification** (passcode gate)
- **File‑based progress** (JSON **export/import**) to resume labeling later
- **Back (Relabel)** and **Next** navigation, plus per‑annotator **coverage metrics**
- Page title **“Who Dance Better”** and header tag **copyright@mocap**

> Stack: Vite · React · TypeScript · Tailwind CSS · PapaParse

---

## TL;DR

**No dataset preparation required.** This repository already contains the default CSV and clips:

- CSV: `public/data/dancer_units.csv`
- Videos: `public/units/*.mp4`

Just install dependencies and start the dev server.

If you ever want to refresh the packaged clips, you may re‑download from the shared folder (see “Optional: refresh packaged videos”).

---

## Requirements

- **Node.js** ≥ 18 (20 LTS recommended)
- **npm** (or pnpm/yarn)
- Modern browser (Chrome/Edge/Firefox)

---

## Quick Start

```bash
# 1) Install dependencies
npm install

# 2) Run the dev server (default http://localhost:5173)
npm run dev

# 3) Build for production and preview locally (optional)
npm run build
npm run preview
```

You should see the app titled **“Who Dance Better”**. Sign in as one of the four annotators to start labeling.

---

## What’s already packaged in this repo?

- `public/data/dancer_units.csv` — the dataset manifest the app reads by default.
- `public/units/*.mp4` — the clips referenced by the CSV (MP4/H.264/AAC).

The app is preconfigured to use these paths via `src/config.ts`:

```ts
export const DATA_CSV_URL = "/data/dancer_units.csv";
export const VIDEO_PREFIX_URL = "/units";
export const FORCE_MP4 = true;
```

> You typically **do not need to change** these. If you maintain multiple datasets in the same repo, you can point `DATA_CSV_URL` to another CSV and put its clips under `public/units/` (or adjust `VIDEO_PREFIX_URL`).

---

## Labeling Workflow

### Sign‑in & passcodes

1. Open the app and **Sign in** as one of: Annotator **A / B / C / D**.
2. Enter your passcode (set in code; see [Security](#security--passcodes)).
3. You will only be served **pairs assigned to you** (see [Task Split](#4-annotator-task-split)).

### Hotkeys & judgments

- Bottom fixed bar offers **five-level preference** buttons.
- Hotkeys: **`1=A better, 2=A slightly, 3=Tie, 4=B slightly, 5=B better`**
- Playback controls: **Play both / Pause / Restart**.
- Navigation: **Back (Relabel)** to revise the previous pair, **Next** to move forward.
- The progress panel shows: **Judgments (submitted)** and **Assigned unique coverage**.

### Import/Export progress (JSON)

- **Export progress** — downloads a `.json` file with your current history and pointer.
- **Import progress** — load a previous file to **resume** exactly where you left off.
- Each annotator keeps their **own file**. You can merge results offline for training.
- The UI warns on page close if there are unsaved changes.

### “Before you label”: watch official scoring (recommended)

For shared calibration on what “better” means, annotators are encouraged to watch the **official competition playlist**:

- YouTube (full competition):  
  https://www.youtube.com/playlist?list=PLFESWvkiXqSXn5A9PkHyJfywgx5-QewUf

---

## 4‑Annotator Task Split

- The set of unique pairs `C(n,2)` is partitioned among **4 annotators** using a **deterministic salted hash** (salt = `DATA_CSV_URL`).  
- Result: **no overlap**, **balanced load**, and fully **reproducible** (same dataset → same split).  
- Orientation (A/B) is fixed once a pair is added to your history (to avoid left/right bias).

---

## Progress File Format (JSON)

Example produced by **Export progress**:

```json
{
  "format": "pairwise-progress-v1",
  "dataset": "/data/dancer_units.csv",
  "user": { "id": "A", "name": "Annotator A", "index": 0 },
  "salt": "/data/dancer_units.csv",
  "idx": 12,
  "history": [
    {
      "A": "u001",
      "B": "u007",
      "submission": {
        "preference": "A_better",
        "score": 2,
        "timestamp": 1730000000000,
        "watched": { "A": 0.95, "B": 0.90 }
      }
    },
    { "A": "u003", "B": "u010" }
  ],
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

- `score` mapping: `A_better=+2`, `A_slightly_better=+1`, `tie=0`, `B_slightly_better=-1`, `B_better=-2`.
- On import, both `dataset` and `user.id` must match the current run.

---

## Optional: refresh packaged videos

The repository already **packages** the clips under `public/units/`. If you need to **refresh** them with a newer drop, download from the shared folder and replace the files:

- Google Drive (shared folder):  
  https://drive.google.com/drive/folders/1dMYDJDsMgiVKmLmN5i46hdDGXdc_47f4?usp=sharing

CLI (optional) with `gdown`:

```bash
pip install gdown
gdown --folder 'https://drive.google.com/drive/folders/1dMYDJDsMgiVKmLmN5i46hdDGXdc_47f4?usp=sharing' -O public/units
```

---

## Security & Passcodes

Passcodes are defined in code for internal use. Update the `USERS` constant (IDs, names, passcodes) in the labeling component:

```ts
const USERS = [
  { id: "A", name: "Annotator A", index: 0, passcode: "change-me-1" },
  { id: "B", name: "Annotator B", index: 1, passcode: "change-me-2" },
  { id: "C", name: "Annotator C", index: 2, passcode: "change-me-3" },
  { id: "D", name: "Annotator D", index: 3, passcode: "change-me-4" }
] as const;
```

For production, consider moving to hashed passcodes or a backend auth flow.

---

## Troubleshooting

**Videos won’t play**  
- Use MP4 (H.264/AAC). If `FORCE_MP4=true`, your filenames should resolve to `.mp4`.  
- If `clip_path` is an external URL, ensure **CORS** and **HTTP Range** support.

**“CSV loaded, but no valid rows”**  
- Ensure `unit_id` is present and `clip_path` is resolvable (or defaults to `unit_id.mp4`).  
- Keep a header row; the app accepts common case variants.

**Performance**  
- Clips are under `public/units/` and served statically. For very large corpora, consider external storage/CDN and updating `VIDEO_PREFIX_URL`.

---

## Project Structure

```
.
├─ public/
│  ├─ data/
│  │  └─ dancer_units.csv
│  └─ units/
│     ├─ u001.mp4
│     └─ ...
├─ src/
│  ├─ Pairwise.tsx        # Labeling UI (4 annotators, file-based progress)
│  ├─ App.tsx             # Renders the Pairwise component
│  ├─ config.ts           # DATA_CSV_URL / VIDEO_PREFIX_URL / FORCE_MP4
│  ├─ index.css           # Tailwind entry
│  └─ main.tsx            # React entry
├─ index.html
├─ package.json
├─ tailwind.config.js
├─ postcss.config.js
└─ tsconfig*.json
```

---

## License & Credits

- Frontend is intended for internal labeling/research.
- **Videos** and **data** belong to their respective rightsholders; use only as permitted.
- UI header tag: **copyright@mocap**.

**References**  
- Clips (for refresh, optional): Google Drive shared folder above.  
- Official competition playlist (calibration):  
  https://www.youtube.com/playlist?list=PLFESWvkiXqSXn5A9PkHyJfywgx5-QewUf