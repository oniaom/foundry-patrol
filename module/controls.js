import { TP } from "./tp.js";
import { routesLayer } from "./util.js";

/**
 * Shared state for patrol-point selection. `selected` is the
 * { tokenId, index } of the currently selected plot point.
 */
export const patrolToolState = {
    selected: null, // { tokenId, index } of the currently selected plot point
};

let menuEl = null;

function onDocumentPointerDown(event) {
    if (menuEl && !menuEl.contains(event.target)) closePointMenu();
}

function onDocumentKeyDown(event) {
    if (event.key === "Escape") {
        routesLayer()?.clearAllSelections();
        closePointMenu();
    }
}

export function closePointMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
}

/**
 * Shows the small options popup for a clicked plot point, anchored at the
 * pointer's client position: delete the point, or move it by dragging it on
 * the map.
 */
export function showPointMenu({ tokenId, index, clientX, clientY }) {
    closePointMenu();
    const el = document.createElement("div");
    el.className = "foundry-patrol-point-menu";
    Object.assign(el.style, {
        position: "fixed",
        left: `${(clientX ?? 0) + 14}px`,
        top: `${(clientY ?? 0) + 14}px`,
        zIndex: "1000",
        background: "rgba(24, 24, 24, 0.96)",
        color: "#eee",
        border: "1px solid #555",
        borderRadius: "4px",
        padding: "6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontFamily: "Signika, sans-serif",
        fontSize: "12px",
        whiteSpace: "nowrap",
    });

    const title = document.createElement("div");
    title.textContent = `Patrol point #${index + 1}`;
    title.style.fontWeight = "bold";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete point";
    deleteButton.addEventListener("click", () => {
        TP.tokenPatroller?.removePlotPoint(tokenId, index);
        closePointMenu();
    });

    const moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.textContent = "Move point";
    moveButton.addEventListener("click", () => {
        // close the popup so it doesn't cover the map; the point can now be
        // dragged directly (any press on the point circle arms a drag)
        closePointMenu();
    });

    const hint = document.createElement("div");
    hint.textContent = "Or drag the point on the map to move it (snaps to grid). Right-click deletes.";
    hint.style.opacity = "0.8";

    el.append(title, deleteButton, moveButton, hint);
    document.body.appendChild(el);
    menuEl = el;

    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
}
