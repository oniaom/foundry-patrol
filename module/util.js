import { RoutesLayer } from "./routes-layer.js";

export function gridSize() {
    return canvas?.grid?.sizeX ?? canvas?.grid?.size ?? 50;
}

export function routesLayer() {
    // Foundry v13+ keeps the active layers in canvas.layers as an Array of instances,
    // so the old keyed lookup (canvas.layers.patrolRoutes) no longer resolves.
    const layers = canvas?.layers;
    if (Array.isArray(layers)) return layers.find((layer) => layer instanceof RoutesLayer) ?? null;
    return layers?.patrolRoutes ?? canvas?.patrolRoutes ?? null;
}
