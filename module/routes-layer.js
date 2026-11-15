import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { gridSize, routesLayer } from "./util.js";
import { patrolToolState, showPointMenu, closePointMenu } from "./controls.js";

const CanvasLayer = foundry.canvas.layers.CanvasLayer ?? globalThis.CanvasLayer;

// Normalizes client (screen) coordinates from either a PIXI federated event or a DOM event.
function eventClient(event) {
    if (event?.client && typeof event.client.x === "number") return event.client;
    return { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
}

// Normalizes world (scene) coordinates from either a PIXI federated event or a DOM event.
function eventGlobal(event) {
    return event?.global ?? event?.data?.global ?? null;
}

// Converts a DOM pointer event on the canvas element into scene/world coordinates.
// PIXI hit-testing is deliberately not relied upon for point picking (layer
// eventMode/interactiveChildren behavior differs across Foundry/PIXI builds and
// has proven unreliable), so we do the transform ourselves:
// client px -> canvas bitmap px -> stage-local (world) via the stage transform.
function clientToWorld(event) {
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
        const sx = ((event.clientX - left) * viewW) / rectW;
        const sy = ((event.clientY - top) * viewH) / rectH;
        const p = stage.toLocal({ x: sx, y: sy });
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    } catch (err) {
        // fall through
    }
    return null;
}

// ---------------------------------------------------------------------------
// DOM-level mouse interaction with the plotted patrol points.
// A single pointerdown listener on the canvas element hit-tests every plotted
// point (circle) and opens the edit popup / starts a drag / deletes the point.
// This works regardless of which canvas layer is active or how PIXI dispatches
// events, because it only needs the DOM event + the stage transform.
// ---------------------------------------------------------------------------

// Returns the token (if any) under the given world point. A press that lands on a
// token belongs to Foundry's token layer (select / drag / context menu), so the
// patrol-point handler must leave it alone.
function tokenAtWorldPoint(world) {
    const tokenLayer = canvas?.tokens;
    if (!tokenLayer) return null;
    // Foundry's own hover tracking already respects token visibility and layer
    // interactivity.
    if (tokenLayer.hover) return tokenLayer.hover;
    // Geometric fallback for a pointerdown that happens before any pointermove at
    // this spot (e.g. the token was moved under a stationary cursor). Only applies
    // while the token layer is the active layer, so other tools can still reach
    // points that happen to sit under a token.
    const tokensActive = canvas?.activeLayer === tokenLayer || tokenLayer.active === true;
    if (!tokensActive) return null;
    const placeables = tokenLayer.placeables ?? tokenLayer.objects?.children ?? [];
    const g = gridSize();
    for (const token of placeables) {
        if (!token || token.visible === false) continue;
        const bounds = token.bounds;
        if (bounds && typeof bounds.contains === "function") {
            if (bounds.contains(world.x, world.y)) return token;
            continue;
        }
        const doc = token.document ?? token;
        const x0 = doc.x ?? 0;
        const y0 = doc.y ?? 0;
        if (
            world.x >= x0 &&
            world.x <= x0 + (doc.width ?? 1) * g &&
            world.y >= y0 &&
            world.y <= y0 + (doc.height ?? 1) * g
        ) {
            return token;
        }
    }
    return null;
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
 * at the DOM level, see registerCanvasPointInteraction) selects it (options popup:
 * delete / move), dragging moves it, right-click deletes it. Drawing supports both
 * PIXI v8 (fill()/stroke()) and v7 (lineStyle()/beginFill()) styling APIs.
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
    // the DOM-level pointer handler in onCanvasPointerDown.
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
        if (typeof s.stroke === "function") {
            this._addCirclePath(s, cx, cy, radius);
            s.stroke({ width: 3, color: 0xffffff, alpha: 1 });
        } else {
            if (typeof s.lineStyle === "function") s.lineStyle(3, 0xffffff, 1);
            this._addCirclePath(s, cx, cy, radius);
        }
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
