# Who Dance Better · Pairwise Labeling 

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

---

## Labeling Workflow

### Sign‑in & passcodes

1. Open the app and **Sign in** as one of: Annotator **A / B / C / D**.
2. Enter your passcode (set in code; see [Security](#security--passcodes)).
3. You will only be served **pairs assigned to you** (see [Task Split](#4-annotator-task-split)).



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

---


Download from the shared folder and put the files under `public/units/`
- Google Drive (shared folder):  
  https://drive.google.com/drive/folders/1dMYDJDsMgiVKmLmN5i46hdDGXdc_47f4?usp=sharing


---

## Security & Passcodes

Passcodes are defined in code for internal use. Update the `USERS` constant (IDs, names, passcodes) in the labeling component:

```ts
const USERS = [
  { id: "A", name: "Annotator A", index: 0, passcode: "aaa" },
  { id: "B", name: "Annotator B", index: 1, passcode: "bbb" },
  { id: "C", name: "Annotator C", index: 2, passcode: "ccc" },
  { id: "D", name: "Annotator D", index: 3, passcode: "ddd" }
] as const;
```

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
│  ├─ CSVPairwiseDemo.tsx        # Labeling UI
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

