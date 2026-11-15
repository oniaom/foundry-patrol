/**
 * Compatibility helpers for drawing with PIXI Graphics across PIXI v8 and v7.
 * v8 builds a path first and styles it afterwards via fill()/stroke(); v7
 * styles before drawing via lineStyle()/beginFill()/endFill(). The helpers
 * below pick the correct order so callers can stay API-agnostic.
 */

/** True when the Graphics object uses the PIXI v8 styling API. */
export function isV8Graphics(graphics) {
    return typeof graphics.fill === "function" && typeof graphics.stroke === "function";
}

// Adds a circle to the current path using whichever shape API the PIXI build provides:
// v8 circle()/drawShape(), v7 drawCircle(), or arc(), and finally a line-segment path.
export function addCirclePath(graphics, cx, cy, radius) {
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

/**
 * Strokes the path built by `buildPath` with the given style ({width, color, alpha}).
 * v8: build the path first, then stroke it. v7: lineStyle must be set before the path.
 */
export function strokePath(graphics, style, buildPath) {
    if (isV8Graphics(graphics)) {
        buildPath();
        graphics.stroke(style);
    } else {
        if (typeof graphics.lineStyle === "function") {
            graphics.lineStyle(style.width ?? 0, style.color ?? 0, style.alpha ?? 1);
        }
        buildPath();
    }
}

/**
 * Draws one filled/stroked circle in a single call.
 * v8: path first, then fill()/stroke(). v7: lineStyle()/beginFill() before, endFill() after.
 * @param {{fill?: {color:number, alpha:number}, stroke?: {width:number, color:number, alpha:number}}} styles
 */
export function drawStyledCircle(graphics, cx, cy, radius, { fill, stroke } = {}) {
    if (isV8Graphics(graphics)) {
        addCirclePath(graphics, cx, cy, radius);
        if (fill) graphics.fill(fill);
        if (stroke) graphics.stroke(stroke);
    } else {
        if (stroke && typeof graphics.lineStyle === "function") {
            graphics.lineStyle(stroke.width ?? 0, stroke.color ?? 0, stroke.alpha ?? 1);
        }
        if (fill && typeof graphics.beginFill === "function") graphics.beginFill(fill.color ?? 0, fill.alpha ?? 1);
        addCirclePath(graphics, cx, cy, radius);
        if (fill && typeof graphics.endFill === "function") graphics.endFill();
    }
}
