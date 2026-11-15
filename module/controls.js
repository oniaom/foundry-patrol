import { TP } from "./tp.js";
import { routesLayer } from "./util.js";

/**
 * Shared state for the "Patrol Tool" scene control. When `active`, the plotted
 * point markers on the routes layer are interactive: click one to select it
 * (options popup with delete), drag it to move it, right-click to delete.
 */
export const patrolToolState = {
    active: false,
    selected: null, // { tokenId, index } of the currently selected plot point
};

let menuEl = null;

function onDocumentPointerDown(event) {
    if (menuEl && !menuEl.contains(event.target)) closePointMenu();
}

function onDocumentKeyDown(event) {
    if (event.key === "Escape") closePointMenu();
}

export function closePointMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
}

/**
 * Shows the small options popup for a selected plot point, anchored at the
 * pointer's client position: delete the point, or drag it on the map to move it.
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

    const hint = document.createElement("div");
    hint.textContent = "Drag the point on the map to move it.";
    hint.style.opacity = "0.8";

    el.append(title, deleteButton, hint);
    document.body.appendChild(el);
    menuEl = el;

    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
}

/** Turns the Patrol Tool edit mode on/off and updates marker interactivity. */
export function setPatrolEditMode(active) {
    patrolToolState.active = !!active;
    if (!patrolToolState.active) {
        patrolToolState.selected = null;
        closePointMenu();
    }
    routesLayer()?.setEditMode(patrolToolState.active);
}

/**
 * Registers the "Patrol Tool" scene control on the left toolbar (next to the
 * token/wall tools). Its single toggle tool activates patrol-point editing:
 * click a plotted point to select it (options popup), drag it to move it.
 */
export function registerPatrolControl() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        controls.patrol = {
            name: "patrol",
            title: "Patrol Tool",
            icon: "fas fa-route",
            // Associating the control with the routes layer makes Foundry activate
            // that layer when the tool is selected, so canvas pointer events are
            // dispatched to it (without this the markers are never hit-tested).
            layer: "patrolRoutes",
            visible: true,
            activeTool: "edit",
            tools: {
                edit: {
                    name: "edit",
                    title: "Edit patrol points (click a point to select/delete it, drag to move it)",
                    icon: "fas fa-map-marker-alt",
                    toggle: true,
                    active: patrolToolState.active,
                    onChange: (_event, active) => setPatrolEditMode(active),
                },
            },
        };
    });
}
