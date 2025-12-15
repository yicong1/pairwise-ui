# Who Dance Better · Pairwise Labeling

![img](./img/Screenshot%20From%202025-11-18%2001-48-39.png)


- A dedicated **Ground Truth (GT)** account that labels the official winner for each battle
- Four **QC annotators** (A/B/C/D) with intentional task overlap to measure agreement and detect inconsistent labeling

This project uses file-based progress (JSON import/export) so each participant can save and resume work without a backend server.

---

## Requirements

- Node.js 18 or newer (20 LTS recommended)
- npm (or pnpm/yarn)
- Modern browser (Chrome/Edge/Firefox)

---

## Quick Start

### 1) Download videos

Download the clips from the shared folder and place them under `public/units/`:

- Google Drive (shared folder):  
  https://drive.google.com/drive/folders/1dMYDJDsMgiVKmLmN5i46hdDGXdc_47f4?usp=sharing

Your repository already includes the CSV manifest at:

- `public/data/dancer_units.csv`

### 2) Install and run

```bash
# Install dependencies
npm install

# Run the dev server (default http://localhost:5173)
npm run dev

# Optional: build for production and preview locally
npm run build
npm run preview
```

---

## Accounts and Roles

### GT account (official ground truth)
- Account ID: `GT`
- Labels the winner for every battle (each `videoId` with exactly two dancers)
- Can export:
  - GT progress file (backup / resume)
  - Full unit-level pairwise labels derived from GT

### QC annotators (cross-check labeling)
- Account IDs: `A`, `B`, `C`, `D`
- Each annotator labels a subset of battles for quality control
- Some battles are intentionally assigned to two annotators so we can measure agreement
- Each annotator exports their own QC progress file

---

## Labeling Workflow

### Sign in
1. Start the app in your browser.
2. Select your account (`GT` or `A/B/C/D`).
3. Enter your passcode (see Security section).

### What you label (battle definition)
A **battle** is identified by `videoId` and must contain exactly **two dancers**. The app groups clips by:

- `videoId`
- then `dancer_id` (or fallback keys if missing)

Battles with missing `videoId` or not exactly two dancers are ignored.

### How to label a battle
You will see two sides (A and B). Each side belongs to one dancer in this battle. You can switch which clip to view for each dancer using the clip dropdown on each side.

Set the winner using:
- Buttons in the fixed bottom bar, or
- Hotkeys:
  - `1` = A wins
  - `2` = B wins
  - `0` = Clear label
  - `U` = Next unlabeled
  - `P` = Previous
  - `N` = Next

Playback helpers:
- Play both
- Pause
- Restart

### Save and resume (Import/Export progress)
- Export downloads a `.json` file with your current progress.
- Import loads a previous file and resumes where you left off.
- Each account keeps its own file. Do not mix progress files across accounts.

Recommended practice:
- Export frequently (for example every 10–20 battles or at the end of a session).
- Keep backups (cloud drive or shared team folder).

---

## Quality Control (QC overlap)

The QC workflow uses overlap so you can detect inconsistent annotation behavior.

- Each battle is assigned to at least one QC annotator.
- A configurable fraction of battles is assigned to a second annotator for cross-checking.
- The overlap rate is controlled in code (search for `QC_OVERLAP_RATE`).

In the GT account’s “Finalize & Export” tab, you can import QC files and view:
- Accuracy vs GT (on battles where GT exists)
- Pairwise agreement between QC annotators on shared battles

---

## Before You Label: Watch Official Scoring (Recommended)

To build a shared understanding of what “better performance” means in dance, annotators should watch several rounds from official competitions first.

We recommend starting with the Red Bull BC One World Final playlist:
https://www.youtube.com/playlist?list=PLFESWvkiXqSXn5A9PkHyJfywgx5-QewUf

Use these battles as calibration material for judging consistency.

### Suggested judging criteria

1) Execution & Control
- Movements are clean, controlled, and intentional
- Balance is steady; transitions are smooth
- Power moves land cleanly without visible instability
- No unnecessary pauses or loss of rhythm

2) Musicality
- Movements accent the beat, lyrics, or rhythm changes
- Timing is precise (no drifting off-beat)
- The dancer “rides the music” instead of only doing moves

3) Flow & Structure
- Clear structure (opening, development, finish)
- Natural transitions rather than abrupt resets
- Energy and engagement are maintained

4) Overall Impact
- Confidence, presence, and character
- Stage control and audience engagement
- Energy matches the music and moment

---

## Security & Passcodes

Passcodes are defined in code for internal use. Update the `USERS` constant (IDs, names, passcodes) in the labeling component.

Example:

```ts
const USERS = [
  { id: "GT", name: "GT Account", role: "gt", index: -1, passcode: "0000" },
  { id: "A",  name: "Annotator A", role: "annotator", index: 0, passcode: "1111" },
  { id: "B",  name: "Annotator B", role: "annotator", index: 1, passcode: "2222" },
  { id: "C",  name: "Annotator C", role: "annotator", index: 2, passcode: "3333" },
  { id: "D",  name: "Annotator D", role: "annotator", index: 3, passcode: "4444" }
] as const;
```

Notes:
- The GT passcode should be shared only with the GT owner.
- If you need stronger security, add backend authentication instead of client-side passcodes.

---

## Project Structure

```
.
├─ public/
│  ├─ data/
│  │  └─ dancer_units.csv
│  └─ units/
│     ├─ 0_Kq3IQQMNA_16.mp4
│     └─ ...
├─ src/
│  ├─ CSVPairwiseDemo.tsx        # Labeling UI (GT account + QC overlap + finalize/export)
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

