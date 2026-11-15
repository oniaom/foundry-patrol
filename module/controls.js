import { TP } from "./tp.js";
import { routesLayer } from "./util.js";

const Dialog = foundry.appv1?.api?.Dialog ?? globalThis.Dialog;

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

// Base style of the point options popup; position is set per-open.
const MENU_STYLE = {
    position: "fixed",
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
};

function makeMenuButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
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
    Object.assign(el.style, MENU_STYLE, {
        left: `${(clientX ?? 0) + 14}px`,
        top: `${(clientY ?? 0) + 14}px`,
    });

    const title = document.createElement("div");
    title.textContent = `Patrol point #${index + 1}`;
    title.style.fontWeight = "bold";

    const deleteButton = makeMenuButton("Delete point", () => {
        TP.tokenPatroller?.removePlotPoint(tokenId, index);
        closePointMenu();
    });

    const moveButton = makeMenuButton("Move point", () => {
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

/**
 * Confirmation dialog shown by the HUD trash button: delete the token's whole
 * route, undo only the last plotted point, or do nothing.
 */
export function showDeleteRouteDialog({ onDeleteAll, onDeleteLast }) {
    const deletePrompt = new Dialog({
        title: "Patrol Delete",
        content: "<p>What would you like to do with this token's route?</p>",
        buttons: {
            one: {
                icon: '<i class="fas fa-check"></i>',
                label: "Confirm: Yes, delete all",
                callback: () => onDeleteAll(),
            },
            two: {
                icon: '<i class="fas fa-undo"></i>',
                label: "Undo: Yes, but undo last",
                callback: () => onDeleteLast(),
            },
            three: {
                icon: '<i class="fas fa-times"></i>',
                label: "Reject: I do not want to delete",
                callback: () => console.log("Foundry-Patrol: Mind changed, nothing deleted"),
            },
        },
        default: "three",
    });
    deletePrompt.render(true);
}
