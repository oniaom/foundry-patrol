import { TP } from "./tp.js";
import { gridSize, routesLayer } from "./util.js";
import { eventGlobal, clientToWorld } from "./coords.js";
import { closePointMenu } from "./controls.js";

// ---------------------------------------------------------------------------
// DOM-level mouse interaction with the plotted patrol points.
// A single pointerdown listener on the canvas element hit-tests every plotted
// point (circle) and opens the edit popup / starts a drag / deletes the point.
// This works regardless of which canvas layer is active or how PIXI dispatches
// events, because it only needs the DOM event + the stage transform.
// ---------------------------------------------------------------------------

// True when the token's footprint covers the world point: prefer the placeable's
// world-space bounds, fall back to its document rectangle in grid cells.
function tokenContainsPoint(token, world, g) {
    const bounds = token.bounds;
    if (bounds && typeof bounds.contains === "function") return bounds.contains(world.x, world.y);
    const doc = token.document ?? token;
    const x0 = doc.x ?? 0;
    const y0 = doc.y ?? 0;
    return (
        world.x >= x0 && world.x <= x0 + (doc.width ?? 1) * g &&
        world.y >= y0 && world.y <= y0 + (doc.height ?? 1) * g
    );
}

// Returns the token (if any) under the given world point. A press that lands on a
// token belongs to Foundry's token layer (select / drag / context menu), so the
// patrol-point handler must leave it alone.
function tokenAtWorldPoint(world) {
    const tokenLayer = canvas?.tokens;
    if (!tokenLayer) return null;
    // Foundry's own hover tracking already respects token visibility and layer
    // interactivity. Ignore a stale hover (e.g. left over from the previous
    // scene before the first pointermove): it would drop every press.
    const hover = tokenLayer.hover;
    if (hover && hover.destroyed !== true && tokenLayer.get?.(hover.id) === hover) return hover;
    // Geometric fallback for a pointerdown that happens before any pointermove at
    // this spot (e.g. the token was moved under a stationary cursor). Only applies
    // while the token layer is the active layer, so other tools can still reach
    // points that happen to sit under a token.
    if (canvas?.activeLayer !== tokenLayer && tokenLayer.active !== true) return null;
    const g = gridSize();
    const placeables = tokenLayer.placeables ?? tokenLayer.objects?.children ?? [];
    return placeables.find((token) => token && token.visible !== false && tokenContainsPoint(token, world, g)) ?? null;
}

let boundView = null;

/** Binds the canvas pointerdown handler (idempotent; re-binds if the canvas element was recreated). */
export function registerCanvasPointInteraction() {
    const view = canvas?.app?.view ?? canvas?.app?.canvas;
    if (!view || typeof view.addEventListener !== "function") return;
    if (boundView === view) return;
    if (boundView) boundView.removeEventListener("pointerdown", onCanvasPointerDown);
    boundView = view;
    view.addEventListener("pointerdown", onCanvasPointerDown);
}

function onCanvasPointerDown(event) {
    if (!game.user?.isGM) return;
    if (event.button !== 0 && event.button !== 2) return;
    const world = eventGlobal(event) ?? clientToWorld(event);
    if (!world) return;
    // A press on a token is a token interaction (select / drag / context menu).
    // Never let it also select, drag, or delete a patrol point under the token.
    if (tokenAtWorldPoint(world)) return;
    const layer = routesLayer();
    if (layer) {
        for (const drawing of layer._drawings) {
            const hit = drawing.hitTestMarker(world.x, world.y);
            if (!hit) continue;
            if (event.button === 2) {
                // right-click: delete the point immediately
                layer.clearAllSelections();
                TP.tokenPatroller?.removePlotPoint(drawing.tokenId, hit.index);
            } else {
                // left-click: select the point (ring + options popup) and arm a potential drag
                drawing.beginMarkerDrag(hit.index, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    global: world,
                    button: event.button,
                });
            }
            return;
        }
    }
    // clicked empty space: drop the current selection and close the popup
    if (layer) layer.clearAllSelections();
    else closePointMenu();
}
