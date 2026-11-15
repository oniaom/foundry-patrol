export function gridSize() {
    return canvas?.grid?.sizeX ?? canvas?.grid?.size ?? 50;
}

export function routesLayer() {
    return canvas?.layers?.patrolRoutes ?? canvas?.patrolRoutes ?? null;
}
