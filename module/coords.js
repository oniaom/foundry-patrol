/**
 * Coordinate helpers shared by canvas point-picking (point-interaction.js) and
 * route drawing (routes-layer.js): normalize PIXI federated events vs plain DOM
 * events, and convert client (screen) coordinates to world (scene) coordinates.
 */

// Normalizes client (screen) coordinates from either a PIXI federated event or a DOM event.
export function eventClient(event) {
    if (event?.client && typeof event.client.x === "number") return event.client;
    return { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
}

// Normalizes world (scene) coordinates from either a PIXI federated event or a DOM event.
export function eventGlobal(event) {
    return event?.global ?? event?.data?.global ?? null;
}

// Converts a DOM pointer event on the canvas element into scene/world coordinates.
// PIXI hit-testing is deliberately not relied upon for point picking (layer
// eventMode/interactiveChildren behavior differs across Foundry/PIXI builds and
// has proven unreliable), so we do the transform ourselves:
// client px -> canvas bitmap px -> renderer-resolution units (the space
// stage.toLocal expects, i.e. exactly what PIXI's EventSystem.mapPositionToPoint
// produces for event.global) -> stage-local (world) via the stage transform.
export function clientToWorld(event) {
    try {
        const app = canvas?.app;
        const view = app?.view ?? app?.canvas;
        const stage = app?.stage;
        if (!view || !stage || typeof stage.toLocal !== "function") return null;
        const rect = typeof view.getBoundingClientRect === "function" ? view.getBoundingClientRect() : null;
        const viewW = view.width || rect?.width || 1;
        const viewH = view.height || rect?.height || 1;
        const left = rect?.left ?? 0;
        const top = rect?.top ?? 0;
        const rectW = rect?.width || viewW;
        const rectH = rect?.height || viewH;
        // The renderer resolution must be divided out: on displays or browser
        // zoom where the canvas backing store is denser than its CSS size
        // (devicePixelRatio != 1), skipping this makes the computed world point
        // off by that factor and every point hit-test misses ("points not
        // selectable"). At resolution 1 this is identical to plain CSS px.
        const resolution = app?.renderer?.resolution || 1;
        const sx = ((event.clientX - left) * viewW) / rectW / resolution;
        const sy = ((event.clientY - top) * viewH) / rectH / resolution;
        const p = stage.toLocal({ x: sx, y: sy });
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    } catch (err) {
        // fall through
    }
    return null;
}
