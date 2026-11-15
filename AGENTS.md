# AGENTS.md — Foundry Token Patroller (foundry-patrol)

> **Mandatory reading rule:** Before starting ANY task in this repo, read this file
> (`AGENTS.md`) **and** `ARCHITECTURE.md` in full. They are written for someone with
> zero context. After ANY change you make (code, behavior, structure, docs), update
> both files in the same commit/PR so they never go stale. If you change how something
> works, change the docs in the same change — do not leave doc updates "for later".

## What this is

A Foundry VTT module (id `foundry-patrol`) for **V13/V14 only** (PIXI v8). It lets a GM
plot patrol points for tokens; tokens then walk their route automatically. Plain ES
modules under `module/`, entry point `module/foundry-patrol.js` (see `module.json` →
`esmodules`). No build step, no test runner, no package.json — edit and reload Foundry.

## First 5 minutes (read in this order)

1. This file.
2. `ARCHITECTURE.md` — how the codebase works and which files/functions connect.
3. `module/foundry-patrol.js` — entry point, hooks, layer registration.
4. `module/routes-layer.js` — rendering of routes (layer + per-token drawing).
5. `module/point-interaction.js` — **all mouse interaction with points** (DOM-level picking).
6. `module/patroller.js` + `module/patrol-engine.js` — the public API/facade and the patrol loop.

## Repo layout

```
module.json            manifest (id, version, compatibility 13/14, esmodules entry)
module/
  foundry-patrol.js    entry point: settings, hooks, CONFIG.Canvas.layers registration
  config.js            MODULE id + world/client settings definitions (data-driven table)
  tp.js                the global TP object all modules share (assigned in entry point)
  util.js              gridSize(), isSquareGrid(), sleep(), routesLayer() lookup helpers
  store.js             PatrolDataManager — the ONLY module touching scene flags (FLAGS keys)
  schema.js            default per-token patrol data schema (createDefaultPatrolData)
  delay.js             delay string <-> milliseconds parsing/formatting (delayPeriod)
  linear-routes.js     grid-path math for Linear Walk mode (pure functions)
  patroller.js         TokenPatrollerManager — tokenMap + plot/route CRUD + public API facade
  patrol-engine.js     PatrolEngine — the walking loop only (data via injected accessors)
  routes-layer.js      RoutesLayer (custom canvas layer) + RouteDrawing + routes flag projection
  point-interaction.js DOM-level point picking on the canvas element (registerCanvasPointInteraction)
  coords.js            event/PIXI coordinate normalization + clientToWorld conversion
  pixi-compat.js       PIXI v7/v8 Graphics helpers (circle path, fill/stroke ordering)
  controls.js          selection state + point popup menu + delete-route dialog
  hud.js               token HUD buttons (add point, delete, start/stop, linear, menu)
  menu.js              PatrolMenu FormApplication (templates/patrol_menu.html)
  keys.js              GM keybindings (start/stop/add/clear/macro)
  vision.js            sight checks while patrolling (stop/pause/combat on spotted)
  speech.js            chat quotes (Polyglot-aware) while patrolling / when spotted
  audio.js             ambient sound that follows the patrolling token
templates/patrol_menu.html
css/foundry-menu.css(.scss)   menu styles
README.md            user docs — update when behavior changes
CHANGELOG            Keep-a-Changelog; every release has an entry here
ARCHITECTURE.md      codebase map — read with this file, keep in sync
```

## Hard rules / gotchas (Foundry v13/v14 + PIXI v8)

- **`canvas.layers` is an Array in v13+**, not a keyed object. Always use
  `routesLayer()` from `util.js` to get the routes layer — never `canvas.layers.x`.
- **Never pick patrol points via PIXI layer hit-testing.** It has never worked
  reliably here (depends on layer `eventMode`/`interactiveChildren`/active layer —
  v13 `CanvasLayer` defaults `interactiveChildren = false`, and PIXI v8 prunes
  `passive` + `!interactiveChildren` subtrees). Point picking is **DOM-level**:
  `registerCanvasPointInteraction()` in `point-interaction.js` listens on the
  canvas element and converts client→world coords via `coords.js` (`clientToWorld`,
  `stage.toLocal`). Keep it that way.
- **Point picking must never hijack a press on a token.** `onCanvasPointerDown`
  in `point-interaction.js` drops the event when `tokenAtWorldPoint(world)` finds
  a token under the pointer (`canvas.tokens.hover` first, then a bounds/document
  rectangle check while the token layer is active). Without this, dragging a
  token on top of a point selects and drags the point too. Keep this guard.
- PIXI v8 events: `event.global` / `event.client` are direct; `event.data` is a
  deprecated getter returning the event itself. Graphics styling: v8 `fill()/stroke()`
  after building the path; the code supports both v8 and v7 APIs — keep it that way.
- All persistent data lives in **scene flags** (key names owned by `FLAGS` in
  `store.js`): `patrols` (source of truth, `PatrolDataManager`) and `routes`
  (render cache synced by `TokenPatrollerManager._syncRoutesFlag`). Never add new
  storage without updating `ARCHITECTURE.md`.
- Route rendering is **GM-only** (`RoutesLayer._draw` sets `visible = game.user.isGM`).
- After any mutation of plot points call `livePlotUpdate()` (syncs the `routes` flag
  and redraws the layer). The layer's `_draw()` recreates all children, so any
  per-frame/selection state must be re-applied there (`_restoreSelection()`).

## Conventions

- **Every change bumps the version** in `module.json` and gets a `CHANGELOG` entry
  (Keep a Changelog format, newest on top). This is strictly followed in git history.
- **PRs:** branch from `master` named `fix/...` or `feat/...`, one logical change per
  PR. In this session, local `git commit`/`git push` may be blocked by policy — use
  the GitHub connector tools (`create_branch`, `push_files`, `create_pull_request`,
  `pull_request_read`) against owner `oniaom`, repo `foundry-patrol`.
- **No test runner / no Foundry client available.** Verify by: (a) syntax-checking
  every file in `module/` (strip `import`/`export` lines, parse with `new Function`),
  (b) a mocked behavioral test (mock PIXI/foundry/canvas/window/document, eval the
  real module sources, drive the flow — see the scratchpad test pattern used for
  `routes-layer.js`), (c) `git diff` review. Say explicitly when something was NOT
  run in a live Foundry client.
- Match existing code style: 4-space indent, double quotes, JSDoc-ish comments on
  non-obvious behavior. Minimal diffs; don't refactor what wasn't asked.

## Task → where to look

| Task | Files |
| --- | --- |
| Change point rendering | `module/routes-layer.js`, `module/pixi-compat.js` |
| Change click / drag / delete interaction with points | `module/point-interaction.js`, `module/routes-layer.js`, `module/controls.js`, `module/coords.js` |
| Change patrol walking logic | `module/patrol-engine.js`, `module/patroller.js` (facade) |
| Change delays (parse/format) | `module/delay.js` |
| Change linear walk math | `module/linear-routes.js` |
| Change data storage / flags / schema | `module/store.js`, `module/schema.js`, `patroller.js` (`_syncRoutesFlag`, `livePlotUpdate`) |
| Token HUD buttons | `module/hud.js` |
| Patrol Menu form | `module/menu.js`, `templates/patrol_menu.html`, `css/foundry-menu.scss` |
| Keybindings | `module/keys.js` |
| Vision/speech/audio reactions | `module/vision.js`, `module/speech.js`, `module/audio.js` |
| Layer registration / hooks / canvas lookups | `module/foundry-patrol.js`, `module/util.js` |
| User-facing behavior docs | `README.md` |
