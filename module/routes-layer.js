import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { gridSize } from "./util.js";
import { patrolToolState, showPointMenu, closePointMenu } from "./controls.js";

const CanvasLayer = foundry.canvas.layers.CanvasLayer ?? globalThis.CanvasLayer;

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
        const routes = canvas.scene?.getFlag(MODULE, "routes") ?? {};
        for (const data of Object.values(routes)) {
            const drawing = new RouteDrawing(data);
            this._drawings.push(drawing);
            this.objects.addChild(drawing.graphics);
            this.objects.addChild(drawing.markers);
        }
    }

    async _tearDown() {
        for (const drawing of this._drawings) drawing.destroy();
        this._drawings = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
    }

    // Enables/disables patrol-point editing (markers become selectable/draggable).
    setEditMode(active) {
        if (active) {
            if (this._savedEventMode === undefined) this._savedEventMode = this.eventMode;
            this.eventMode = "static";
            this.interactive = true;
            this.interactiveChildren = true;
            if (!this._editHandlerBound) {
                this._editHandler = (event) => this._handleLayerPointerDown(event);
                this.on("pointerdown", this._editHandler);
                this._editHandlerBound = true;
            }
        } else {
            this.eventMode = this._savedEventMode ?? "passive";
            this.interactive = false;
            if (this._editHandlerBound) {
                this.off("pointerdown", this._editHandler);
                this._editHandlerBound = false;
            }
        }
        for (const drawing of this._drawings) drawing.setEditMode(active);
    }

    // Layer-level hit-testing fallback: works even when per-object hit testing
    // doesn't reach the markers in the current PIXI build. The marker handlers
    // call stopPropagation(), so this only sees events the markers didn't consume.
    _handleLayerPointerDown(event) {
        if (!patrolToolState.active) return;
        if (event.button !== 0 && event.button !== 2) return;
        const g = event?.data?.global ?? { x: 0, y: 0 };
        for (const drawing of this._drawings) {
            const hit = drawing.hitTestMarker(g.x, g.y);
            if (!hit) continue;
            if (event.button === 2) {
                TP.tokenPatroller?.removePlotPoint(drawing.tokenId, hit.index);
            } else {
                drawing.beginMarkerDrag(hit.index, event);
            }
            return;
        }
        // clicked empty space: drop the current selection
        for (const drawing of this._drawings) drawing.clearSelection();
    }
}

/**
 * Draws the animated dashed line that visualizes a single token's patrol route,
 * plus a marker at every plotted point. When the Patrol Tool edit mode is active
 * the markers are interactive: left-click selects a point (options popup), dragging
 * moves it, right-click deletes it. Drawing supports both PIXI v8 (fill()/stroke())
 * and v7 (lineStyle()/beginFill()) styling APIs.
 */
class RouteDrawing {
    constructor(data) {
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
        const editable = patrolToolState.active;
        this.points.forEach((point, index) => {
            const cx = point.x + GRID_SIZE;
            const cy = point.y + GRID_SIZE;
            const marker = new PIXI.Graphics();
            this._drawMarkerDot(marker, cx, cy, radius);
            marker.eventMode = editable ? "static" : "none";
            marker.interactive = editable; // PIXI v7-style interactivity flag (no-op in v8)
            marker.hitArea = new PIXI.Circle(cx, cy, radius + 6);
            marker.cursor = "pointer";
            marker.on("pointerdown", (event) => {
                if (!patrolToolState.active) return;
                event.stopPropagation?.(); // keep the layer-level fallback from double-handling
                if (event.button === 2) {
                    // right-click: quick delete
                    TP.tokenPatroller?.removePlotPoint(this.tokenId, index);
                    return;
                }
                if (event.button !== 0) return;
                this.beginMarkerDrag(index, event);
            });
            this._markerEls.push(marker);
            this.markers.addChild(marker);
        });
    }

    setEditMode(active) {
        for (const marker of this._markerEls) {
            marker.eventMode = active ? "static" : "none";
            marker.interactive = active;
        }
        if (!active) this.clearSelection();
    }

    // Distance-based hit test of the plotted points (canvas coordinates), used by
    // the layer-level pointer fallback in RoutesLayer._handleLayerPointerDown.
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
        if (typeof s.stroke === "function") {
            this._addCirclePath(s, cx, cy, radius);
            s.stroke({ width: 3, color: 0xffffff, alpha: 1 });
        } else {
            if (typeof s.lineStyle === "function") s.lineStyle(3, 0xffffff, 1);
            this._addCirclePath(s, cx, cy, radius);
        }
    }

    // pointerdown on a marker (directly or via the layer fallback): select it and
    // start a potential drag. A plain click leaves the selection + options menu;
    // moving the pointer drags the point.
    beginMarkerDrag(index, event) {
        const marker = this._markerEls[index];
        if (!marker) return;
        const startGlobal = { x: event?.data?.global?.x ?? 0, y: event?.data?.global?.y ?? 0 };
        const startClient = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
        this._selectPoint(index, event?.clientX ?? 0, event?.clientY ?? 0);
        const drag = { marker, index, startGlobal, startClient, dragging: false };
        const onMove = (ev) => this._dragMarkerMove(drag, ev);
        const onUp = (ev) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            this._dragMarkerEnd(drag, ev);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }

    _dragMarkerMove(drag, ev) {
        if (!this.points[drag.index]) return;
        const scale = canvas.app?.stage?.scale?.x || 1;
        const gx = drag.startGlobal.x + ((ev.clientX ?? 0) - drag.startClient.x) / scale;
        const gy = drag.startGlobal.y + ((ev.clientY ?? 0) - drag.startClient.y) / scale;
        if (!drag.dragging) {
            const dx = (ev.clientX ?? 0) - drag.startClient.x;
            const dy = (ev.clientY ?? 0) - drag.startClient.y;
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
        drag.marker.hitArea = new PIXI.Circle(cx, cy, this._markerRadius + 6);
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

    // Draws one marker dot. PIXI v8 styles a built path afterwards via fill()/stroke(),
    // while PIXI v7 styles before drawing via lineStyle()/beginFill()/endFill(), so support both.
    _drawMarkerDot(marker, cx, cy, radius) {
        if (typeof marker.fill === "function" && typeof marker.stroke === "function") {
            this._addCirclePath(marker, cx, cy, radius);
            marker.fill({ color: this.color, alpha: 0.9 });
            marker.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
        } else {
            if (typeof marker.lineStyle === "function") marker.lineStyle(2, 0xffffff, 0.8);
            if (typeof marker.beginFill === "function") marker.beginFill(this.color, 0.9);
            this._addCirclePath(marker, cx, cy, radius);
            if (typeof marker.endFill === "function") marker.endFill();
        }
    }

    // Adds a circle to the current path using whichever shape API the PIXI build provides:
    // v8 circle()/drawShape(), v7 drawCircle(), or arc(), and finally a line-segment path.
    _addCirclePath(graphics, cx, cy, radius) {
        if (typeof graphics.circle === "function") {
            graphics.circle(cx, cy, radius);
        } else if (typeof graphics.drawShape === "function") {
            graphics.drawShape(new PIXI.Circle(cx, cy, radius));
        } else if (typeof graphics.drawCircle === "function") {
            graphics.drawCircle(cx, cy, radius);
        } else if (typeof graphics.arc === "function") {
            graphics.arc(cx, cy, radius, 0, Math.PI * 2);
        } else {
            const segments = 32;
            graphics.moveTo(cx + radius, cy);
            for (let i = 1; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                graphics.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            }
        }
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
        if (typeof this.graphics.stroke === "function") {
            // PIXI v8: build the path first, then stroke it
            this._drawDashedLine(phase);
            this.graphics.stroke({ width: 5, color: this.color, alpha: 0.7 });
        } else {
            // PIXI v7: lineStyle must be set before the path is drawn
            if (typeof this.graphics.lineStyle === "function") this.graphics.lineStyle(5, this.color, 0.7);
            this._drawDashedLine(phase);
        }
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
