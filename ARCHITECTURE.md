# ARCHITECTURE.md — how the foundry-patrol codebase works

> Read together with `AGENTS.md`. If you change any behavior described here, update
> this file in the same commit/PR.

## Big picture

```
scene flags (persistent storage — key names owned by FLAGS in store.js)
   │  "patrols"  ── source of truth: PatrolDataManager (store.js) ↔ TokenPatrollerManager.tokenMap
   │  "routes"   ── render cache of plotted points, written by TokenPatrollerManager._syncRoutesFlag()
   ▼
RoutesLayer (custom canvas layer, CONFIG.Canvas.layers.patrolRoutes, group "primary")
   │  _draw() reads the "routes" flag → one RouteDrawing per token (routes-layer.js)
   ▼
RouteDrawing: animated dashed Graphics line + one marker circle Graphics per point
   ▲
   │  mouse input does NOT go through PIXI — it is DOM-level:
canvas element pointerdown → registerCanvasPointInteraction() (point-interaction.js)
   │  (dropped when the press lands on a token — tokenAtWorldPoint)
   │  clientToWorld() (coords.js, via stage.toLocal) → RouteDrawing.hitTestMarker() →
   │  left: select (ring + popup) + arm drag · drag: move + snap + movePlotPoint() on release
   │  right: removePlotPoint() · empty click / Escape: clear selection
   ▼
controls.js popup (showPointMenu/closePointMenu) → patroller.js mutations → livePlotUpdate() → _syncRoutesFlag() + layer.draw() → back to top
```

## Entry point and wiring — `module/foundry-patrol.js`

- Exposes the global `TP` (`tp.js` is just `export const TP = {}`).
- `Hooks.once("init")`: registers settings (`config.js`), keybindings (`keys.js`),
  the Patrol Tool scene control (`scene-control.js` → `registerPatrolControl()`),
  Handlebars helpers, the custom canvas layer
  (`CONFIG.Canvas.layers.patrolRoutes = { layerClass: RoutesLayer, group: "primary" }`),
  and `Hooks.on("canvasReady", onCanvasReady)` — the DOM-level point-picking
  listener from `point-interaction.js` (re-bound on every canvas (re)draw;
  idempotent) plus, when the viewed scene actually changed, a reload of the
  patrol tokenMap from the new scene (`TP.tokenPatroller.reloadFromScene()`:
  halts old-scene patrol loops without persisting, re-reads the `patrols` flag,
  re-syncs the `routes` flag and redraws the layer). An in-place scene switch
  fires `canvasReady`, not `ready`, so without this the stale previous-scene
  tokenMap would be synced into the new scene's flags.
- `Hooks.once("ready")`: creates `TP.patrolDataManager`, and for GMs
  `TP.tokenPatroller`, `TP.visionHandler`, `TP.audioHandler`, `TP.speechHandler`;
  then runs `migrateAllSceneRoutes()` — the pre-3.3.2 migration that recomputes
  **every scene's** "routes" render cache from that scene's patrols flag,
  dropping stale entries left behind by the old merge-written flag (dead,
  unselectable circles), then redraws the viewed scene's layer.
- Hooks: `renderTokenHUD` → `TokenHud.HUD` (hud.js); `controlToken` →
  `livePlotUpdate(token.id)` on select, redraw on deselect; `deleteToken` /
  `preDeleteAmbientSound` → cleanup in patroller.

## Data model and persistence — `store.js`, `schema.js`, `patroller.js`

- `PatrolDataManager` (store.js) is the single owner of the scene flags; the key
  names live in its exported `FLAGS` (`patrols`, `routes`). It stores the whole
  `tokenMap` (`getPatrols()` / `savePatrols()`) and the routes render cache
  (`getRoutes()` / `saveRoutes()`).
- The per-token schema is `createDefaultPatrolData()` in `schema.js`:
  `TokenPatrollerManager.tokenMap[tokenId]` holds `plots` (array of `{x,y}`
  top-left of grid cell), `linearPath`, `countinousRoutes`,
  `endCountinousRoutes`, `isLinear`, `inverted`, `isWalking`, `lastPos`,
  `lastRecordedLocation`, `delayPeriod` (ms array), `color`, quotes, vision/audio
  settings, etc.
- `_syncRoutesFlag()` projects every token's `plots` into the scene flag `routes`
  via `routesFromTokenMap()` (routes-layer.js)
  (`{ tokenId: { points, dash, gap, offset, color, fb, tokenId } }`) — this is what
  `RoutesLayer._draw()` renders. `livePlotUpdate()` = `_syncRoutesFlag()` +
  `routesLayer()?.draw()`; call it after every mutation. `_syncRoutesFlag()`
  skips the flag write when it already matches the projection (`store.js`
  `saveRoutes()` unsets the flag first, because `setFlag` diff-merges objects and
  would otherwise keep entries of tokens whose points were all deleted).
- Public point API on `TP.tokenPatroller` (patroller.js, the facade): `addPlotPoint(tokenId)`,
  `removePlotPoint(tokenId, index)`, `movePlotPoint(tokenId, index, {x,y})`,
  `removeTokenRoute(tokenId, removeAll)`, `startPatrol(delay, tokenId)`,
  `stopPatrol(tokenId)`, plus the generated field getters (`getVisionChecking`,
  `getPatrolQuotes`, ... — see the `FIELD_GETTERS` table). `removePlotPoint`/
  `movePlotPoint` also rebuild linear routes when `isLinear`.
- The manager remembers which scene the tokenMap was loaded from (`sceneId`,
  set in `initializeHashTable()`/`reloadFromScene()`); `_ownsViewedScene()` gates
  `_saveAndUpdate()` and `_syncRoutesFlag()` so patrol data is never persisted
  into a different scene's flags (cross-scene pollution guard).

## Patrol engine — `patrol-engine.js` (driven by `patroller.js`)

- `TokenPatrollerManager` owns `tokenMap` and creates one `PatrolEngine`, injecting
  `getData`/`hasData`/`persist` accessors so the engine never touches storage itself.
- `startPatrol` parses the delay string (`delay.js` → `_handleDelayPeriod`), then
  `PatrolEngine.start(token)` loops `_navigationCycle` → `_navigationLoop` over
  `plots` (or `linearPath`/`countinousRoutes` when `isLinear` on square grids),
  sleeping `delayPeriod[iterator]`, moving the token via
  `token.document.update({x,y})`, then `speechHandler.handleSpeech`,
  `visionHandler.evaluateSight`, storing `lastPos`. Stops when `isWalking` flips
  false (stopPatrol, token moved manually (`_wasTokenMoved`), combat pause, etc.).
- `linearWalk(generateEnd, tokenId)` in patroller.js drives the pure grid-path
  functions in `linear-routes.js` (`generateLinearRoute`, `rebuildLinearPaths`,
  `segmentCount`) to fill the grid cells between plot points for Linear Walk mode.

## Rendering and mouse interaction — `routes-layer.js`, `point-interaction.js`, `coords.js`, `pixi-compat.js`, `controls.js`, `util.js`

- `RoutesLayer extends CanvasLayer` (v13: `foundry.canvas.layers.CanvasLayer`).
  `_draw()` clears and rebuilds `this.objects` from the `routes` flag (key from
  `FLAGS` in store.js), creating one `RouteDrawing` per token, then calls
  `_restoreSelection()`. GM-only visibility. `routesFromTokenMap()` (same file)
  builds the flag value from the tokenMap.
- `RouteDrawing` owns `graphics` (animated dashed line, `_render`/`_animate` via
  requestAnimationFrame) and `markers` (one circle Graphics per point +
  `selection` ring Graphics). All PIXI v7/v8 API differences are encapsulated in
  `pixi-compat.js` (`addCirclePath`, `strokePath`, `drawStyledCircle`).
  **Markers carry no PIXI event handlers on purpose.**
- Point picking is DOM-level (this is the load-bearing design decision — see
  AGENTS.md gotchas): `registerCanvasPointInteraction()` (point-interaction.js)
  binds one `pointerdown` listener on `canvas.app.view`; `onCanvasPointerDown`
  converts the event with `clientToWorld()` (coords.js: bounding rect → canvas
  bitmap px → **divided by `renderer.resolution`**, matching PIXI v8's
  `EventSystem.mapPositionToPoint` → `stage.toLocal`) and runs
  `drawing.hitTestMarker(world.x, world.y)`
  (distance ≤ markerRadius+6 around the point center at `point + grid/2`). Before
  hit-testing, the event is dropped when `tokenAtWorldPoint(world)` finds a token
  under the pointer — `canvas.tokens.hover` first (only when it is a live
  placeable of the current scene; a stale hover from a previous scene must not
  drop every press), else a geometric check
  (`token.bounds.contains`, falling back to the token document's grid-cell
  rectangle) while the token layer is the active layer. A press on a token belongs
  to Foundry's token layer, so a point under the token is never selected, dragged,
  or deleted (otherwise dragging a token on a point drags the point).
  - left button → `beginMarkerDrag(index, normalizedEvent)`: selects
    (`_selectPoint` → white ring + `showPointMenu` at client coords) and arms a
    drag via window `pointermove`/`pointerup`/`pointercancel`; `_dragMarkerMove`
    moves the point live (snapped by `_snapPointToGrid` unless gridless), redraws
    marker+ring+line; `_dragMarkerEnd` persists with `movePlotPoint` only if it
    actually dragged.
  - right button → `removePlotPoint(tokenId, index)`.
  - no hit → `clearAllSelections()` (clears rings + closes popup). Escape does the
    same via `controls.js`.
- `controls.js` also holds `patrolToolState = { selected: {tokenId, index} | null }`,
  the popup DOM (`showPointMenu`: **Delete point** → `removePlotPoint`,
  **Move point** → closes popup so you can drag; hint line) and the delete-route
  confirmation dialog (`showDeleteRouteDialog`, used by the HUD trash button).
  Popup closes on outside pointerdown or Escape.
- `util.js`: `gridSize()` (`canvas.grid.sizeX ?? size ?? 50`), `isSquareGrid()`,
  `sleep(ms)`, and `routesLayer()` (v13: find `instanceof RoutesLayer` in the
  `canvas.layers` **array**; fallbacks `canvas.patrolRoutes` /
  `canvas.primary.patrolRoutes`). `coords.js` holds `eventClient`/`eventGlobal`/
  `clientToWorld` shared by point-interaction.js and routes-layer.js.

## UI surfaces

- **Token HUD** (`hud.js`, on `renderTokenHUD`): Add Point (map icon) →
  `addPlotPoint`; trash → `deleteProcess` dialog; recycle/arrows → `_setInverse`
  (cycle vs forwards-backwards); line/linear → `_setLinear`; walking →
  `startPatrol`/`stopPatrol`; delay text field; caret → `PatrolMenu` (menu.js +
  `templates/patrol_menu.html`), which writes back through
  `updateFormRelatedData`.
- **Keybindings** (`keys.js`, GM, Ctrl+Shift+…): start/stop all, add plot point for
  selected tokens, generate a macro. They call the same
  `TP.tokenPatroller` API. (There is intentionally no clear-routes
  keybinding; deleting routes is done via the HUD trash dialog.)
- **Scene control** (`scene-control.js`, `getSceneControlButtons`, GM only): the
  **Patrol Tool** sidebar button (route icon) with two momentary buttons —
  **Start all patrols** / **Stop all patrols** — that call the exported
  `startAllRoutes`/`haltAllRoutes` from `keys.js`, i.e. exactly the
  start/stop-all keybindings, reachable by mouse. Tools are flagged `button: true`
  (v13/v14 only fire `onClick` for button tools) and the control keeps
  `activeTool: ""` so opening it never triggers an action. No `layer`
  association: point picking is DOM-level and must not switch the active
  canvas layer.

## Reactions while patrolling

- `vision.js` `evaluateSight(tokenId)`: if `visionChecking`, checks player tokens
  against the guard's vision (`_checkVision`); may stop patrol / pause game /
  create combat (`stopWhenSeen`, `pauseGame`, `createCombat`) and triggers
  "caught" quotes; optional NPC-vs-NPC checks (`otherTokenVision`).
- `speech.js`: builds IC `ChatMessage`s from `patrolQuotes`/`catchQuotes`/
  `otherTokenVisionQuotes` (single-quote delimited in the menu, `{token.name}`
  placeholder), with Polyglot language flags when present.
- `audio.js`: creates/moves/deletes an `AmbientSound` that follows the token
  (`updateAmbientPosition` on each navigation step).

## Import graph (who imports whom)

```
foundry-patrol.js ──► config, tp, store, patroller, hud, routes-layer, point-interaction, keys, scene-control, vision, speech, audio, util
scene-control.js ──► keys (startAllRoutes/haltAllRoutes)
patroller.js ──────► tp, util, schema, delay, linear-routes, patrol-engine, routes-layer (routesFromTokenMap), controls (dialog)
patrol-engine.js ──► config, tp, util
linear-routes.js ──► (leaf, no module imports)
delay.js ──────────► (leaf)
schema.js ─────────► (leaf)
coords.js ─────────► (leaf)
pixi-compat.js ────► (leaf, uses global PIXI)
routes-layer.js ───► config, tp, store (FLAGS), util (gridSize), coords, controls, pixi-compat
point-interaction.js ► tp, util, coords, controls (closePointMenu)
controls.js ───────► tp, util (routesLayer)
util.js ───────────► routes-layer (RoutesLayer, for instanceof)   ← circular with routes-layer.js, safe: only used inside functions
hud.js ────────────► config, tp, menu, util
menu.js ───────────► config, tp, util, delay
keys.js ───────────► config, tp
vision.js ─────────► tp, util
speech.js ─────────► config, tp
audio.js ──────────► config, tp, util
store.js ──────────► config
```

The `util.js ↔ routes-layer.js` cycle is fine because the cross-call happens at
runtime inside a function, never at module-evaluation time. Don't add top-level
side effects to these modules.

## Common flows (function connection map)

- **Add a point:** HUD button / keybind → `TokenPatrollerManager.addPlotPoint` →
  `updateTokenRoute` (push to `plots`) → `livePlotUpdate` + `linearWalk` (linear-routes.js) → layer redraw.
- **Click a point:** canvas `pointerdown` → `onCanvasPointerDown` (point-interaction.js)
  → `clientToWorld` (coords.js) → `RouteDrawing.hitTestMarker` → `beginMarkerDrag`
  → `_selectPoint` → `showPointMenu`.
- **Move a point:** same pointerdown → window `pointermove` → `_dragMarkerMove`
  (snap, redraw) → `pointerup` → `_dragMarkerEnd` → `movePlotPoint` →
  `_saveAndUpdate` + `livePlotUpdate` → redraw (selection re-applied by `_restoreSelection`).
- **Delete a point:** right-click → `removePlotPoint`, or popup button / HUD dialog → same.
- **Start patrol:** HUD/keybind/macro → `startPatrol` → `_handleDelayPeriod` (delay.js)
  → `PatrolEngine.start` → `_navigationCycle/_navigationLoop` → per point: delay
  sleep, `token.document.update`, speech/vision/audio, `lastPos`.

## Gotchas (details in AGENTS.md)

- v13 `canvas.layers` is an array — use `routesLayer()`.
- PIXI v8 eventMode semantics make PIXI-layer hit-testing unreliable — point picking
  is DOM-level in `point-interaction.js`; keep it that way.
- v8 Graphics: build path first, then `fill()/stroke()`; v7: `lineStyle()/beginFill()`
  first — helpers in `pixi-compat.js` handle both.
- Layer `_draw()` destroys and recreates all children on every redraw; re-apply
  selection state there.
