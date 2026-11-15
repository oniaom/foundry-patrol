import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { FLAGS } from "./store.js";
import { gridSize } from "./util.js";
import { eventClient, eventGlobal } from "./coords.js";
import { patrolToolState, showPointMenu, closePointMenu } from "./controls.js";
import { addCirclePath, strokePath, drawStyledCircle } from "./pixi-compat.js";

const CanvasLayer = foundry.canvas.layers.CanvasLayer ?? globalThis.CanvasLayer;

/**
 * Projects the tokenMap into the scene "routes" flag consumed by RoutesLayer:
 * one entry per token with plotted points, dash style and color. Written by
 * TokenPatrollerManager._syncRoutesFlag() after every point mutation.
 */
export function routesFromTokenMap(tokenMap) {
    const routes = {};
    for (const [tokenId, data] of Object.entries(tokenMap ?? {})) {
        const plots = data?.plots;
        if (!plots || plots.length == 0) continue;
        routes[tokenId] = {
            points: foundry.utils.duplicate(plots),
            dash: 25,
            gap: 25,
            offset: 750,
            color: data.color,
            fb: !!data.inverted,
            tokenId: tokenId,
        };
    }
    return routes;
}

/**
 * Custom canvas layer that renders every token's plotted patrol route (GM only).
 * _draw() rebuilds all children from the "routes" flag on every redraw, so any
 * selection state has to be re-applied afterwards (_restoreSelection()).
 * Mouse interaction with the points does NOT go through this layer — it is
 * DOM-level, see point-interaction.js.
 */
export class RoutesLayer extends CanvasLayer {
    constructor() {
        super();
        this.objects = null;
        this._drawings = [];
    }

    // v13+ draws layers through the template methods draw() -> _draw() and tearDown() -> _tearDown(),
    // so both canvas-driven draws and direct routesLayer().draw() redraws land here.
    async _draw() {
        for (const drawing of this._drawings) drawing.destroy();
        this._drawings = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.visible = game.user.isGM;
        this.objects = this.addChild(new PIXI.Container());
        const routes = canvas.scene?.getFlag(MODULE, FLAGS.ROUTES) ?? {};
        for (const data of Object.values(routes)) {
            const drawing = new RouteDrawing(data, this);
            this._drawings.push(drawing);
            this.objects.addChild(drawing.graphics);
            this.objects.addChild(drawing.markers);
        }
        // Redraws recreate all children, so repair the current selection afterwards.
        this._restoreSelection();
    }

    async _tearDown() {
        for (const drawing of this._drawings) drawing.destroy();
        this._drawings = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
    }

    // Drops the current selection on every route and closes the options popup.
    clearAllSelections() {
        patrolToolState.selected = null;
        for (const drawing of this._drawings) drawing.selection?.clear();
        closePointMenu();
    }

    // Clears the selection ring on every drawing except the given one.
    _clearOtherSelections(except) {
        for (const drawing of this._drawings) {
            if (drawing !== except) drawing.selection?.clear();
        }
    }

    // After a redraw, re-highlight the selected point if it still exists, or drop
    // the selection if its point was deleted/moved out of range.
    _restoreSelection() {
        const sel = patrolToolState.selected;
        if (!sel) return;
        const drawing = this._drawings.find((d) => d.tokenId === sel.tokenId);
        const point = drawing?.points?.[sel.index];
        if (!drawing || !point) {
            this.clearAllSelections();
            return;
        }
        const half = gridSize() / 2;
        drawing._drawSelection(point.x + half, point.y + half);
    }
}

/**
 * Draws the animated dashed line that visualizes a single token's patrol route,
 * plus a marker circle at every plotted point. Clicking a point circle (handled
 * at the DOM level, see point-interaction.js) selects it (options popup: delete /
 * move), dragging moves it, right-click deletes it. Drawing supports both PIXI v8
 * (fill()/stroke()) and v7 (lineStyle()/beginFill()) styling APIs via pixi-compat.js.
 */
class RouteDrawing {
    constructor(data, layer) {
        this.layer = layer ?? null;
        this.fb = !!data.fb;
        this.points = foundry.utils.duplicate(data.points ?? []);
        this.dash = data.dash ?? 25;
        this.gap = data.gap ?? 25;
        this.offset = data.offset ?? 750;
        this.color = Number(data.color ?? 0xffffff);
        this.tokenId = data.tokenId;
        this.graphics = new PIXI.Graphics();
        this.markers = new PIXI.Container();
        this.selection = new PIXI.Graphics();
        this._markerEls = [];
        this._markerRadius = Math.max(8, gridSize() / 6);
        this.destroyed = false;
        this._drawMarkers();
        this.markers.addChild(this.selection);
        this._animate();
    }

    _drawMarkers() {
        const GRID_SIZE = gridSize() / 2;
        const radius = this._markerRadius;
        this.points.forEach((point, index) => {
            const cx = point.x + GRID_SIZE;
            const cy = point.y + GRID_SIZE;
            const marker = new PIXI.Graphics();
            this._drawMarkerDot(marker, cx, cy, radius);
            this._markerEls.push(marker);
            this.markers.addChild(marker);
        });
    }

    // Distance-based hit test of the plotted points (scene coordinates), used by
    // the DOM-level pointer handler in point-interaction.js.
    hitTestMarker(gx, gy) {
        const half = gridSize() / 2;
        for (let index = 0; index < this.points.length; index++) {
            const cx = this.points[index].x + half;
            const cy = this.points[index].y + half;
            const dx = gx - cx;
            const dy = gy - cy;
            if (Math.sqrt(dx * dx + dy * dy) <= this._markerRadius + 6) return { index, cx, cy };
        }
        return null;
    }

    clearSelection() {
        patrolToolState.selected = null;
        this.selection?.clear();
        closePointMenu();
    }

    _selectPoint(index, clientX, clientY) {
        this.layer?._clearOtherSelections(this);
        patrolToolState.selected = { tokenId: this.tokenId, index };
        const half = gridSize() / 2;
        const point = this.points[index];
        if (point) this._drawSelection(point.x + half, point.y + half);
        showPointMenu({ tokenId: this.tokenId, index, clientX, clientY });
    }

    // White ring drawn around the currently selected plot point.
    _drawSelection(cx, cy) {
        const s = this.selection;
        if (!s) return;
        s.clear();
        const radius = this._markerRadius + 4;
        strokePath(s, { width: 3, color: 0xffffff, alpha: 1 }, () => addCirclePath(s, cx, cy, radius));
    }

    // pointerdown on a point circle (from the DOM handler): select it and start a
    // potential drag. A plain click leaves the selection + options menu; moving the
    // pointer drags the point.
    beginMarkerDrag(index, event) {
        const marker = this._markerEls[index];
        if (!marker) return;
        const startGlobal = eventGlobal(event) ?? { x: 0, y: 0 };
        const startClient = eventClient(event);
        this._selectPoint(index, startClient.x, startClient.y);
        const drag = { marker, index, startGlobal, startClient, dragging: false };
        const onMove = (ev) => this._dragMarkerMove(drag, ev);
        const onUp = (ev) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            this._dragMarkerEnd(drag, ev);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    }

    _dragMarkerMove(drag, ev) {
        if (!this.points[drag.index]) return;
        const c = eventClient(ev);
        const scale = canvas.app?.stage?.scale?.x || 1;
        const gx = drag.startGlobal.x + (c.x - drag.startClient.x) / scale;
        const gy = drag.startGlobal.y + (c.y - drag.startClient.y) / scale;
        if (!drag.dragging) {
            const dx = c.x - drag.startClient.x;
            const dy = c.y - drag.startClient.y;
            if (Math.sqrt(dx * dx + dy * dy) < 4) return;
            drag.dragging = true;
        }
        const point = this._snapPointToGrid(gx, gy);
        this.points[drag.index] = point;
        const half = gridSize() / 2;
        const cx = point.x + half;
        const cy = point.y + half;
        drag.marker.clear();
        this._drawMarkerDot(drag.marker, cx, cy, this._markerRadius);
        this._drawSelection(cx, cy);
        this._render();
    }

    _dragMarkerEnd(drag) {
        if (!drag.dragging) return; // plain click: keep the selection + options menu
        const point = this.points[drag.index];
        if (point) TP.tokenPatroller?.movePlotPoint(this.tokenId, drag.index, { x: point.x, y: point.y });
    }

    // Converts canvas coordinates to a stored point (top-left of the grid cell),
    // snapped to the grid unless the scene is gridless.
    _snapPointToGrid(gx, gy) {
        const half = gridSize() / 2;
        let x = gx - half;
        let y = gy - half;
        const gridType = canvas.grid?.type;
        if (gridType && gridType !== CONST.GRID_TYPES.GRIDLESS) {
            const g = gridSize();
            x = Math.round(x / g) * g;
            y = Math.round(y / g) * g;
        }
        return { x, y };
    }

    // Draws one marker dot (PIXI v8 and v7 styling handled by pixi-compat.js).
    _drawMarkerDot(marker, cx, cy, radius) {
        drawStyledCircle(marker, cx, cy, radius, {
            fill: { color: this.color, alpha: 0.9 },
            stroke: { width: 2, color: 0xffffff, alpha: 0.8 },
        });
    }

    _drawDashedLine(offset) {
        let dashSize = 0;
        let gapLength = 0;
        const GRID_SIZE = gridSize() / 2;
        if (offset > 0) {
            const progressiveOffset = (this.dash + this.gap) * offset;
            if (progressiveOffset < this.dash) dashSize = this.dash - progressiveOffset;
            else gapLength = this.gap - (progressiveOffset - this.dash);
        }

        for (let i = this.points.length - 1; i >= 0; --i) {
            const pointOne = this.points[i];
            const pointTwo = i == 0 ? (this.fb ? this.points[i] : this.points[this.points.length - 1]) : this.points[i - 1];
            const dX = pointTwo.x - pointOne.x;
            const dY = pointTwo.y - pointOne.y;
            const pointLen = Math.sqrt(dX * dX + dY * dY);
            if (pointLen === 0) continue;
            const seperatePoints = { x: dX / pointLen, y: dY / pointLen };
            let lineStart = 0;
            this.graphics.moveTo(
                pointOne.x + GRID_SIZE + gapLength * seperatePoints.x,
                pointOne.y + GRID_SIZE + gapLength * seperatePoints.y
            );
            while (lineStart <= pointLen) {
                lineStart += gapLength;
                if (dashSize > 0) lineStart += dashSize;
                else lineStart += this.dash;

                if (lineStart > pointLen) {
                    dashSize = lineStart - pointLen;
                    lineStart = pointLen;
                } else {
                    dashSize = 0;
                }
                this.graphics.lineTo(
                    pointOne.x + GRID_SIZE + lineStart * seperatePoints.x,
                    pointOne.y + GRID_SIZE + lineStart * seperatePoints.y
                );
                lineStart += this.gap;
                if (lineStart > pointLen && dashSize == 0) {
                    gapLength = lineStart - pointLen;
                } else {
                    gapLength = 0;
                    this.graphics.moveTo(
                        pointOne.x + GRID_SIZE + lineStart * seperatePoints.x,
                        pointOne.y + GRID_SIZE + lineStart * seperatePoints.y
                    );
                }
            }
        }
    }

    _render() {
        this.graphics.clear();
        const phase = ((Date.now() % this.offset) + 1) / this.offset;
        // v8 strokes the built path afterwards; v7 needs lineStyle before the path.
        strokePath(this.graphics, { width: 5, color: this.color, alpha: 0.7 }, () => this._drawDashedLine(phase));
    }

    _animate() {
        if (this.destroyed) return;
        try {
            this._render();
        } catch (err) {
            // Drawing while the canvas is mid-teardown is expected and harmless.
        }
        requestAnimationFrame(() => this._animate());
    }

    destroy() {
        this.destroyed = true;
        this.graphics.destroy();
        this.markers.destroy({ children: true });
    }
}
