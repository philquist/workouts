# 🏋️ Workout Log

A fast, mobile-first web app for logging your gym workouts and tracking your
strength trends over time. Built as an installable **Progressive Web App** —
add it to your phone's home screen and it works **offline**, right there at the
rack. Also looks great on your computer.

No accounts, no servers, no tracking. Your data is stored **locally on your
device**, with one-tap backup/transfer via an export file.

## Features

- **Quick logging** built for the gym — big touch targets, numeric keypads,
  exercise name autocomplete from your history, and "carry over" placeholders
  so logging your next set is one tap.
- **Sessions by day** — flip between days, edit anything, add session notes.
- **Trends** — per-exercise charts for estimated 1‑rep‑max (Epley), top-set
  weight, and total volume, plus automatic **personal records**.
- **Body-weight tracking** with its own trend chart.
- **History** with totals (sessions, exercises, sets, volume).
- **lb / kg** display toggle.
- **Backup & transfer** — export your data to a JSON file and import it on
  another device (merge or replace).
- **Program-aware** — load any day from your 86-week training plan with its
  set/rep/tempo targets, instead of retyping exercise names.
- **Offline-first PWA** — installable, works with no signal.

## Training program

This repo's Markdown plan (`Workout Tracker - Block #N ... .md`, 86 weeks) is
parsed into `data/program.json` so you can pull a prescribed day straight into
the logger:

1. On the **Log** tab, tap **📋 Load a day from your program**.
2. Pick the **week** and **session** (e.g. *Monday – 5x10 – Day 1*).
3. The day's exercises are added with their **set/rep/tempo targets**, and each
   shows what you lifted **last time** — just fill in weight and reps.

Exercise-name autocomplete also draws from the program, and the empty tables in
the Markdown are templates only (no weights are stored there).

### Rebuilding the program data

After editing the Markdown plan, regenerate the JSON the app reads:

```bash
python3 tools/import_program.py   # rewrites data/program.json
```

## Use it

### Option A — GitHub Pages (recommended)

1. Push this repo to GitHub (already done if you're reading this there).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** = *Deploy from a branch*,
   choose the branch (e.g. `main`) and folder `/ (root)`, then **Save**.
4. Wait a minute, then open the URL it gives you, e.g.
   `https://philquist.github.io/workouts/`.

> The included `.nojekyll` file makes sure GitHub Pages serves the app as-is.

### Option B — Run locally

It's all static files, so any static server works:

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000

# or Node
npx serve .
```

### Install to your phone

Open the site in your phone's browser, then:

- **iOS (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** menu **⋮** → **Install app** (or tap the **Install**
  button in the app's top bar).

It then launches full-screen like a native app and works offline.

## How your data works

Everything lives in your browser's `localStorage` on the device you're using —
nothing leaves your phone or computer. That means:

- Data is **per-device**. To move it, use **Data → Export** on one device and
  **Import** on the other.
- **Back up regularly** with Export. Clearing your browser data / site data
  will erase the log.

> Want automatic sync across devices later? The data layer (`js/db.js`) is
> isolated behind a small `DB` API specifically so a synced backend can be
> added without rewriting the UI.

## Project structure

```
index.html              app shell + bottom tab navigation
css/styles.css          mobile-first dark theme
js/db.js                data layer (localStorage) + analytics  ← swap for sync later
js/charts.js            tiny dependency-free SVG line chart
js/app.js               views + hash router (Log / History / Trends / Data)
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline caching)
icons/                  app icons (generated)
data/program.json       training program parsed from the Markdown logs
tools/import_program.py rebuilds data/program.json from the Markdown plan
tools/make_icons.py     regenerates the icon set (pure Python, no deps)
```

The app itself has **no build step and no dependencies** — just open
`index.html` via a static server. The `tools/` scripts (standard-library
Python only) are needed only to regenerate the program data or icons.

## Notes on the numbers

- **Estimated 1RM** uses the Epley formula: `weight × (1 + reps / 30)`
  (a single rep reports the weight itself).
- **Volume** is `Σ (weight × reps)` across all sets.
- The **lb/kg** setting is a display label only — it doesn't convert your
  stored numbers, so pick one and stay consistent.
