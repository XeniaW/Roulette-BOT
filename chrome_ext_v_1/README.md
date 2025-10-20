# Spins Logger — README

A Chrome extension that **tracks roulette spins** and can **auto-bet** on multiple markets (Dozens, Rows, Six-Lines, and a Rows+Dozens Combo) using configurable streak triggers and multi-step (Martingale-like) progressions.

---

## Features

* **Four auto-bet markets**

  * **Dozens (1–12, 13–24, 25–36)** with streak trigger on a single dozen; places on the **other two**. 
  * **Rows (top/middle/bottom)** with streak trigger on a single row; places on the **other two**. Robust row indexer and safety checks. 
  * **Six-Lines (6-number lines)** with trigger on any **two repeated six-lines**; places on the **remaining four**.
* **Configurable per-market logic**

  * `triggerStreak` (K), `steps` array (multi-step progression), `autoContinue`, `includeZero`. Sanitized and persisted in `chrome.storage.local`. 
* **Deterministic bet placement engine**

  * Click-safe, mutex-guarded sequence; chip selection by template; per-step amount computation (`chip` index × `times`) for **each target**. 
* **State machine with 3 phases**

  * `idle` → `armed` (entry/stepping) → optional `waiting` (hold until target appears), with auto status updates in the popup. 
* **Spin/bet logs**

  * Appends to `chrome.storage.local` with trimming; per-market status text (“armed”, “win → reset”, etc.). 

---

## How it works (architecture)

### Core engine (`src/auto/engine.js`)

* Global chip config key: `abGlobalChips`. Defaults:

  * `chipSelectorTemplate`: `[data-e2e="chip-{{value}}"]`
  * `chipValues`: `[0.2, 1, 5, 20]`
* Public helpers (exposed on `window.BET`):

  * `Mutex` — serializes click flows
  * `tryPlace({ step, targets, steps, getTargetNode, mutex })` — picks chip buttons, then clicks target cells for each `(chip,times)` in the current step
  * `perTargetAmountForStep(step, steps, chipValues)` — calculates amount per target for logging/analytics
  * `loadGlobalChips()/saveGlobalChips()` — read/write chip template & values
  * `setBetStatus(key, state, message)` — status line in the UI
    All above are used by each market module. 

### Market base (`src/auto/market-base.js`)

* Unifies per-market lifecycle: config I/O, enable flag, state (`execKey`), phase transitions, and “ready/off/armed” status wiring.
* `sanitizeCfg` enforces valid `triggerStreak ≥ 2`, normalizes `steps` (`chip ≥ 1`, `times ≥ 1`) and booleans. 

### Market modules

Each market:

1. Maps spin number `n` to a **market index** (`getIndex`), e.g. dozen/row/sixline.
2. On each spin:

   * If `idle`: scans `spinLogs` tail to detect **trigger** window (length `K = triggerStreak`) and arms on the **complement** set of indices.
   * If `armed`: checks for **win** (any target hits) → reset; else advances step or goes to `waiting`/auto-continue.
   * If `waiting`: re-arms the next step immediately when a target appears.
3. Places bets via `BET.tryPlace` with the per-market DOM node resolver.
   Dozens: `#index-800/801/802`, Rows: `#index-700/701/702`, Six-Lines: computed under `#index-600+`.

* **Dozens** — trigger when the last `K` spins all index to the **same dozen** (optionally counting zero in the window if `includeZero`). Then target the **two other dozens**. Phases/steps and logging as described above. 
* **Rows** — precise row indexer (`n % 3 → [top,middle,bottom]`) and conservative zero handling: zero can extend the window only if a reference row already exists. Targets always **two rows** (never 1 or 3, validated). 
* **Six-Lines** — trigger when, scanning back, you see **at most two unique six-lines** across `K` spins (i.e., a repeated pair). Targets are the **other four** six-lines. 
* **Combo** — builds a compound key `dozen:row` for each spin; arms only if the **same pair repeats `K` times**. Then places on both markets in parallel with a shared mutex. 

---

## Configuration

### Steps (progression)

Example default (per market):

```json
[
  [{ "chip": 1, "times": 1 }],
  [{ "chip": 1, "times": 3 }],
  [{ "chip": 2, "times": 2 }],
  [{ "chip": 3, "times": 1 }, { "chip": 2, "times": 1 }]
]
```

* `chip` — **index** (1-based) into `chipValues`
* `times` — how many clicks (units) per target for that `chip`
  Sanitized and applied by MarketBase; amount math by `BET.perTargetAmountForStep`.

### Chips (global)

* Change `chipSelectorTemplate` or `chipValues` via UI storage or programmatically using `BET.saveGlobalChips({ chipSelectorTemplate, chipValues })`. The engine auto-discovers the actual chip buttons and validates they’re clickable. 

### Flags

* `autoContinue` — automatically place the **next** step after a loss
* `includeZero` — whether `0` **extends** the trigger window (market-specific handling)
  Both are persisted per market key. 

---

## Build & Run

### Prerequisites

* **Node.js ≥ 16** (dev deps require modern Node)
* Chrome/Chromium for loading unpacked extension

### Install deps

```bash
npm i
```

### Build (production, obfuscated)

```bash
npm run build
```

* Steps:

  1. `prebuild` bumps **`src/manifest.json` version** (patch auto-increment). 
  2. Bundles all entries to `dist/` targeting **Chrome 120**, **iife** format. 
  3. If `OBFUSCATE=1` (default in script), runs **javascript-obfuscator** on built files. 

> Build script copies `manifest.html/css` and compiles JS entries: `content.js`, `bg.js`, `popup.js`, and all auto modules to `dist/` mirroring `src/` tree. 

### Dev watch (fast rebuilds, no obfuscation)

```bash
npm run watch
```

* Writes sourcemaps, watches files, instructs you to “Load `dist/` as the extension”. 

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder

### Project metadata

* `package.json` — scripts & toolchain (esbuild, fs-extra, javascript-obfuscator). 
* `.gitignore` — excludes `dist/`, `node_modules/`, `*.zip`, `/builds`. 

---

## Using the extension

1. Open the popup and enable **Tracking** (spin listener).
2. Toggle a market (Dozens/Rows/Six/Six+Dozens) **ON**.
3. Set:

   * `Trigger streak (K)`
   * `Steps` progression
   * `Auto-continue` and/or `Include zero`
4. Watch **status lines** per market:

   * “READY / OFF / armed / win → reset / loss → next step / waiting…” (driven by `setBetStatus`). 
5. Review **logs** for placed amounts and steps; amounts are computed as:

   ```
   total_amount = sum_over_step_items( chipValue[chipIndex-1] * times ) * number_of_targets
   ```

   (per market targets differ: 2 for Dozens/Rows, 4 for Six-Lines, mixed for Combo). 

---

## File map (key runtime modules)

* `src/auto/engine.js` — click engine, chips config, logging, status API. 
* `src/auto/market-base.js` — shared market lifecycle & config sanitizer. 
* `src/auto/dozens.js` — dozens strategy. 
* `src/auto/rows.js` — rows strategy with strict safety checks. 
* `src/auto/sixlines.js` — six-lines strategy. 
* `src/auto/combo.js` — rows+dozens combo strategy. 
* `build.js` — bundling + optional obfuscation. 
* `bump-version.js` — auto patch-version bump in `manifest.json`. 
* `package.json` / `package-lock.json` — scripts & pinned toolchain.

---

## Notes & Tips

* **Mutex matters:** multiple markets can try to place simultaneously. The engine serializes clicks with a shared `Mutex` (Combo also uses an extra one internally). If a table is slow to render, `tryPlace` retries until a hard timeout.
* **Zero handling is market-specific:** for example, Rows only let `0` extend an already established series; otherwise `0` **breaks** the window. Tune `includeZero` to your venue. 
* **Targets are validated:** Rows module refuses invalid target sets (must be **exactly two** rows). Helpful for debugging UI selector mismatches. 

---

That’s it. If you want, I can also drop this into a `README.md` file with a neat badge block and a quickstart diagram.
