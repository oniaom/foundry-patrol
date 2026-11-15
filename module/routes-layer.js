import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { gridSize } from "./util.js";

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
}

/**
 * Draws the animated dashed line that visualizes a single token's patrol route,
 * plus a clickable marker at every plotted point (left-click a marker to delete
 * that point). PIXI v8 compatible (stroke()/fill() instead of the removed lineStyle()).
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
        this.destroyed = false;
        this._drawMarkers();
        this._animate();
    }

    _drawMarkers() {
        const GRID_SIZE = gridSize() / 2;
        const radius = Math.max(8, gridSize() / 6);
        this.points.forEach((point, index) => {
            const cx = point.x + GRID_SIZE;
            const cy = point.y + GRID_SIZE;
            const marker = new PIXI.Graphics();
            this._drawCircle(marker, cx, cy, radius);
            marker.fill({ color: this.color, alpha: 0.9 }).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
            marker.eventMode = "static";
            marker.hitArea = new PIXI.Circle(cx, cy, radius + 6);
            marker.cursor = "pointer";
            marker.on("pointerdown", (event) => {
                if (event.button !== 0) return;
                TP.tokenPatroller?.removePlotPoint(this.tokenId, index);
            });
            this.markers.addChild(marker);
        });
    }

    // Graphics#circle() is not available on every PIXI build, so add the dot via
    // drawShape()/arc() when present and fall back to a line-segment path otherwise.
    _drawCircle(graphics, cx, cy, radius) {
        if (typeof graphics.circle === "function") {
            graphics.circle(cx, cy, radius);
        } else if (typeof graphics.drawShape === "function") {
            graphics.drawShape(new PIXI.Circle(cx, cy, radius));
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
        this._drawDashedLine(phase);
        this.graphics.stroke({ width: 5, color: this.color, alpha: 0.7 });
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
