# Who Dance Better · Pairwise Labeling 

![img](./img/Screenshot%20From%202025-11-18%2001-48-39.png)


Your team will use a web-based platform to watch pairs of short dance videos and decide, based on clear criteria, which performance is better. Some pairs have a known “correct answer” for quality control, while others help build up a global ranking from many local decisions. By practicing objective judging and learning how your votes contribute to AI model training, you’ll see firsthand how data annotation, gold standards, and simple fairness checks shape trustworthy machine learning.

## Requirements

- **Node.js** ≥ 18 (20 LTS recommended)
- **npm** (or pnpm/yarn)
- Modern browser (Chrome/Edge/Firefox)

---

## Quick Start


Download from the shared folder and put the files under `public/units/`
- Google Drive (shared folder):  
  https://drive.google.com/drive/folders/1dMYDJDsMgiVKmLmN5i46hdDGXdc_47f4?usp=sharing

```bash
# 1) Install dependencies
npm install

# 2) Run the dev server (default http://localhost:5173)
npm run dev

# (optional) Build for production and preview locally 
npm run build
npm run preview
```

---

## Labeling Workflow

### Sign‑in & passcodes

1. Open the app and **Sign in** as one of: Annotator **A / B / C / D**.
2. Enter your passcode (set in code; see [Security](#security--passcodes)).
3. You will only be served **pairs assigned to you** .


### Import/Export progress (JSON)

- **Export progress** — downloads a `.json` file with your current history and pointer.
- **Import progress** — load a previous file to **resume** exactly where you left off.
- Each annotator keeps their **own file**. You can merge results offline for training.
- The UI warns on page close if there are unsaved changes.

### “Before you label”: watch official scoring (recommended)

To build a shared understanding of what “better performance” means in dance, all annotators are encouraged to first watch several rounds from official competitions. These provide gold-standard references for execution quality, musicality, and overall performance impact.

We recommend starting with the Red Bull BC One World Final (2024):
https://www.youtube.com/playlist?list=PLFESWvkiXqSXn5A9PkHyJfywgx5-QewUf

These battles showcase some of the world’s top dancers and serve as calibration material for your intuition of quality.

1. Execution & Control

- Movements are clean, controlled, and intentional
- Balance is steady; transitions are smooth rather than shaky
- Power moves land cleanly without “heavy recovery” or visible instability
- No unnecessary pauses, hesitations, or loss of rhythm

2. Musicality

- Movements accent the beat, lyrics, or rhythm changes
- Good dancers “ride the music” instead of just doing moves
- Timing is precise—no drifting or performing off-beat

3. Flow & Structure
- The performance has a beginning, development, and finish—not random moves
- Transitions feel natural, not abrupt
- The dancer maintains energy and engagement throughout

4. Overall Impact

- Confidence, presence, and character
- The dancer commands the stage and engages the audience
- Energy matches the music and moment

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
│     ├─ 0_Kq3IQQMNA_16.mp4
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

