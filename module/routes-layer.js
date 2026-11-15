import { MODULE } from "./config.js";
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
        }
    }

    async _tearDown() {
        for (const drawing of this._drawings) drawing.destroy();
        this._drawings = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
}

/**
 * Draws the animated dashed line that visualizes a single token's patrol route.
 * PIXI v8 compatible (stroke() instead of the removed lineStyle()).
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
        this.destroyed = false;
        this._animate();
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
    }
}
