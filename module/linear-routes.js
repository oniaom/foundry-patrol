/**
 * Grid-path math for Linear Walk mode (square grids only). These functions are
 * pure with respect to the patrol data: they compute the intermediate grid cells
 * between plot points and write them into the given route arrays. Persistence
 * is left to the caller via the `onArrive` callback.
 */

/**
 * Walks from `src` to `dest` in grid-sized steps, pushing every intermediate
 * cell onto `route`. `src` is advanced (mutated) step by step.
 * @returns {Promise<boolean>} true when the destination was reached, false when
 *   the coordinates are not grid-aligned (nothing is pushed in that case).
 * @param {Array} route route array to append the walked cells to
 * @param {{x:number, y:number}} src start cell (mutated)
 * @param {{x:number, y:number}} dest target cell
 * @param {number} xMod +1/-1 direction on the x axis
 * @param {number} yMod +1/-1 direction on the y axis
 * @param {number} grid grid size in pixels
 * @param {() => Promise<void>} [onArrive] fired once when src == dest on entry
 */
export async function generateLinearRoute(route, src, dest, xMod, yMod, grid, onArrive) {
    if (src.x % grid != 0 && src.y % grid != 0 && dest.x % grid != 0 && dest.y % grid != 0) {
        ui.notifications.error("Can't process linear walk of the given coordinates. Please check the console output.");
        console.log(route);
        console.log(src);
        console.log(dest);
        return false;
    }
    if (src.x == dest.x && src.y == dest.y) {
        await onArrive?.();
        return true;
    }
    // Step one grid cell toward the destination on each axis that still differs.
    const dX = src.x != dest.x ? grid * xMod : 0;
    const dY = src.y != dest.y ? grid * yMod : 0;
    src.x += dX;
    src.y += dY;
    route.push({ x: src.x, y: src.y });
    return generateLinearRoute(route, src, dest, xMod, yMod, grid, onArrive);
}

/**
 * Rebuilds the continuous routes and the combined linear path from the current
 * plot points, mutating `countinousRoutes` and `endCountinousRoutes` in place.
 * @returns {Promise<Array|null>} the new linearPath, [] when there are no plots,
 *   or null when linearPath must be left untouched (exactly one plot point).
 */
export async function rebuildLinearPaths(plots, countinousRoutes, endCountinousRoutes, grid, onArrive) {
    countinousRoutes.length = 0;
    endCountinousRoutes.length = 0;
    if (plots.length == 0) return [];
    countinousRoutes.push({ x: plots[0].x, y: plots[0].y });
    for (let i = 1; i < plots.length; i++) {
        const src = { x: plots[i - 1].x, y: plots[i - 1].y };
        const dest = plots[i];
        const xMod = dest.x >= src.x ? 1 : -1;
        const yMod = dest.y >= src.y ? 1 : -1;
        await generateLinearRoute(countinousRoutes, src, dest, xMod, yMod, grid, onArrive);
    }
    if (plots.length >= 2) {
        const len = plots.length - 1;
        const xMod = plots[0].x >= plots[len].x ? 1 : -1;
        const yMod = plots[0].y >= plots[len].y ? 1 : -1;
        const arrived = await generateLinearRoute(
            endCountinousRoutes,
            { x: plots[len].x, y: plots[len].y },
            plots[0],
            xMod,
            yMod,
            grid,
            onArrive
        );
        if (arrived) return [...countinousRoutes, ...endCountinousRoutes];
    }
    return null;
}

/** Number of grid cells between two points (euclidean distance / grid size). */
export function segmentCount(p1, p2, grid) {
    return Math.floor(Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) / grid);
}
