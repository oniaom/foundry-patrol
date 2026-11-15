import { RoutesLayer } from "./routes-layer.js";

/** Current grid size in pixels (square grid width), with sane fallbacks. */
export function gridSize() {
    return canvas?.grid?.sizeX ?? canvas?.grid?.size ?? 50;
}

/** True when the active scene uses a square grid (required for Linear Walk mode). */
export function isSquareGrid() {
    return canvas?.grid?.type === CONST.GRID_TYPES.SQUARE;
}

/** Promise-based delay used by the patrol loop between plot points. */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds the custom routes layer. Foundry v13+ keeps the active layers in
 * `canvas.layers` as an Array of instances, so the layer is located by class;
 * direct-property lookups remain as fallbacks for other builds.
 */
export function routesLayer() {
    // Foundry v13+ keeps the active layers in canvas.layers as an Array of instances,
    // so the old keyed lookup (canvas.layers.patrolRoutes) no longer resolves.
    const layers = canvas?.layers;
    if (Array.isArray(layers)) {
        const found = layers.find((layer) => layer instanceof RoutesLayer);
        if (found) return found;
    } else if (layers?.patrolRoutes) {
        return layers.patrolRoutes;
    }
    // Fallbacks: direct canvas property (v14 control `layer` lookup) and group property.
    return canvas?.patrolRoutes ?? canvas?.primary?.patrolRoutes ?? null;
}
