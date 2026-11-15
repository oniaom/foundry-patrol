# ARCHITECTURE.md — how the foundry-patrol codebase works

> Read together with `AGENTS.md`. If you change any behavior described here, update
> this file in the same commit/PR.

## Big picture

```
scene flags (persistent storage)
   │  "patrols"  ── source of truth: PatrolDataManager (store.js) ↔ TokenPatrollerManager.tokenMap
   │  "routes"   ── render cache of plotted points, written by TokenPatrollerManager._syncRoutesFlag()
   ▼
RoutesLayer (custom canvas layer, CONFIG.Canvas.layers.patrolRoutes, group "primary")
   │  _draw() reads the "routes" flag → one RouteDrawing per token
   ▼
RouteDrawing: animated dashed Graphics line + one marker circle Graphics per point
   ▲
   │  mouse input does NOT go through PIXI — it is DOM-level:
canvas element pointerdown → registerCanvasPointInteraction() (routes-layer.js)
   │  clientToWorld() via stage.toLocal → RouteDrawing.hitTestMarker() →
   │  left: select (ring + popup) + arm drag · drag: move + snap + movePlotPoint() on release
   │  right: removePlotPoint() · empty click / Escape: clear selection
   ▼
controls.js popup (showPointMenu/closePointMenu) → patroller.js mutations → livePlotUpdate() → _syncRoutesFlag() + layer.draw() → back to top
```

## Entry point and wiring — `module/foundry-patrol.js`

- Exposes the global `TP` (`tp.js` is just `export const TP = {}`).
- `Hooks.once("init")`: registers settings (`config.js`), keybindings (`keys.js`),
  Handlebars helpers, the custom canvas layer
  (`CONFIG.Canvas.layers.patrolRoutes = { layerClass: RoutesLayer, group: "primary" }`),
  and `Hooks.on("canvasReady", registerCanvasPointInteraction)` — the DOM-level
  point-picking listener (re-bound on every canvas (re)draw; idempotent).
- `Hooks.once("ready")`: creates `TP.patrolDataManager`, and for GMs
  `TP.tokenPatroller`, `TP.visionHandler`, `TP.audioHandler`, `TP.speechHandler`.
- Hooks: `renderTokenHUD` → `TokenHud.HUD` (hud.js); `controlToken` →
  `livePlotUpdate(token.id)` on select, redraw on deselect; `deleteToken` /
  `preDeleteAmbientSound` → cleanup in patroller.

## Data model and persistence — `store.js`, `patroller.js`

- `PatrolDataManager` stores the whole `tokenMap` in the scene flag `patrols`
  (`dataInit()` / `saveMap()`).
- `TokenPatrollerManager.tokenMap[tokenId]` is the per-token schema (`_defaultSchema()`):
  `plots` (array of `{x,y}` top-left of grid cell), `linearPath`, `countinousRoutes`,
  `endCountinousRoutes`, `isLinear`, `inverted`, `isWalking`, `lastPos`,
  `lastRecordedLocation`, `delayPeriod` (ms array), `color`, quotes, vision/audio
  settings, etc.
- `_syncRoutesFlag()` copies every token's `plots` into the scene flag `routes`
  (`{ tokenId: { points, dash, gap, offset, color, fb, tokenId } }`) — this is what
  `RoutesLayer._draw()` renders. `livePlotUpdate()` = `_syncRoutesFlag()` +
  `routesLayer()?.draw()`; call it after every mutation.
- Public point API on `TP.tokenPatroller`: `addPlotPoint(tokenId)`,
  `removePlotPoint(tokenId, index)`, `movePlotPoint(tokenId, index, {x,y})`,
  `removeTokenRoute(tokenId, removeAll)`, `startPatrol(delay, tokenId)`,
  `stopPatrol(tokenId)`. `removePlotPoint`/`movePlotPoint` also rebuild linear
  routes (`_rebuildLinearRoutes`) when `isLinear`.

## Patrol engine — `patroller.js`

- `startPatrol` loops `_navigationCycle` → `_navigationLoop` over `plots` (or
  `linearPath`/`countinousRoutes` when `isLinear` on square grids), sleeping
  `delayPeriod[iterator]`, moving the token via `token.document.update({x,y})`,
  then `speechHandler.handleSpeech`, `visionHandler.evaluateSight`, storing
  `lastPos`. Stops when `isWalking` flips false (stopPatrol, token moved manually
  (`_wasTokenMoved`), combat pause, etc.).
- `linearWalk(generateEnd, tokenId)` + `_generateLinearRoute` fill the grid cells
  between plot points for Linear Walk mode; `_generateLinearPath` concatenates.

## Rendering and mouse interaction — `routes-layer.js`, `controls.js`, `util.js`

- `RoutesLayer extends CanvasLayer` (v13: `foundry.canvas.layers.CanvasLayer`).
  `_draw()` clears and rebuilds `this.objects` from the `routes` flag, creating one
  `RouteDrawing` per token, then calls `_restoreSelection()`. GM-only visibility.
- `RouteDrawing` owns `graphics` (animated dashed line, `_render`/`_animate` via
  requestAnimationFrame) and `markers` (one circle Graphics per point +
  `selection` ring Graphics). **Markers carry no PIXI event handlers on purpose.**
- Point picking is DOM-level (this is the load-bearing design decision — see
  AGENTS.md gotchas): `registerCanvasPointInteraction()` binds one `pointerdown`
  listener on `canvas.app.view`; `onCanvasPointerDown` converts the event with
  `clientToWorld()` (bounding rect → canvas bitmap px → `stage.toLocal`) and runs
  `drawing.hitTestMarker(world.x, world.y)` (distance ≤ markerRadius+6 around the
  point center at `point + grid/2`).
  - left button → `beginMarkerDrag(index, normalizedEvent)`: selects
    (`_selectPoint` → white ring + `showPointMenu` at client coords) and arms a
    drag via window `pointermove`/`pointerup`/`pointercancel`; `_dragMarkerMove`
    moves the point live (snapped by `_snapPointToGrid` unless gridless), redraws
    marker+ring+line; `_dragMarkerEnd` persists with `movePlotPoint` only if it
    actually dragged.
  - right button → `removePlotPoint(tokenId, index)`.
  - no hit → `clearAllSelections()` (clears rings + closes popup). Escape does the
    same via `controls.js`.
- `controls.js` also holds `patrolToolState = { selected: {tokenId, index} | null }`
  and the popup DOM (`showPointMenu`: **Delete point** → `removePlotPoint`,
  **Move point** → closes popup so you can drag; hint line). Popup closes on
  outside pointerdown or Escape.
- `util.js`: `gridSize()` (`canvas.grid.sizeX ?? size ?? 50`) and `routesLayer()`
  (v13: find `instanceof RoutesLayer` in the `canvas.layers` **array**; fallbacks
  `canvas.patrolRoutes` / `canvas.primary.patrolRoutes`).

## UI surfaces

- **Token HUD** (`hud.js`, on `renderTokenHUD`): Add Point (map icon) →
  `addPlotPoint`; trash → `deleteProcess` dialog; recycle/arrows → `_setInverse`
  (cycle vs forwards-backwards); line/linear → `_setLinear`; walking →
  `startPatrol`/`stopPatrol`; delay text field; caret → `PatrolMenu` (menu.js +
  `templates/patrol_menu.html`), which writes back through
  `updateFormRelatedData`.
- **Keybindings** (`keys.js`, GM, Ctrl+Shift+…): start/stop all, add plot point for
  selected tokens, clear routes, generate a macro. They call the same
  `TP.tokenPatroller` API.

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
foundry-patrol.js ──► config, tp, store, patroller, hud, routes-layer, keys, controls(no longer), vision, speech, audio, util
routes-layer.js ───► config, tp, util (gridSize, routesLayer), controls (patrolToolState, showPointMenu, closePointMenu)
controls.js ───────► tp, util (routesLayer)
patroller.js ──────► config, tp, util
util.js ───────────► routes-layer (RoutesLayer, for instanceof)   ← circular with routes-layer.js, safe: only used inside functions
hud.js ────────────► config, tp, menu
menu.js ───────────► config, tp
keys.js ───────────► config, tp
vision/speech/audio ► config|tp, util
store.js ──────────► config
```

The `routes-layer.js ↔ controls.js/util.js` cycle is fine because all cross-calls
happen at runtime inside functions, never at module-evaluation time. Don't add
top-level side effects to these modules.

## Common flows (function connection map)

- **Add a point:** HUD button / keybind → `TokenPatrollerManager.addPlotPoint` →
  `updateTokenRoute` (push to `plots`) → `livePlotUpdate` + `linearWalk` → layer redraw.
- **Click a point:** canvas `pointerdown` → `onCanvasPointerDown` → `clientToWorld` →
  `RouteDrawing.hitTestMarker` → `beginMarkerDrag` → `_selectPoint` → `showPointMenu`.
- **Move a point:** same pointerdown → window `pointermove` → `_dragMarkerMove`
  (snap, redraw) → `pointerup` → `_dragMarkerEnd` → `movePlotPoint` →
  `_saveAndUpdate` + `livePlotUpdate` → redraw (selection re-applied by `_restoreSelection`).
- **Delete a point:** right-click → `removePlotPoint`, or popup button → same.
- **Start patrol:** HUD/keybind/macro → `startPatrol` → `_navigationCycle/_navigationLoop`
  → per point: delay sleep, `token.document.update`, speech/vision/audio, `lastPos`.

## Gotchas (details in AGENTS.md)

- v13 `canvas.layers` is an array — use `routesLayer()`.
- PIXI v8 eventMode semantics make PIXI-layer hit-testing unreliable — point picking
  is DOM-level in `routes-layer.js`; keep it that way.
- v8 Graphics: build path first, then `fill()/stroke()`; v7: `lineStyle()/beginFill()`
  first — helpers in `RouteDrawing` handle both.
- Layer `_draw()` destroys and recreates all children on every redraw; re-apply
  selection state there.
