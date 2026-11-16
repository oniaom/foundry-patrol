import { startAllRoutes, haltAllRoutes } from "./keys.js";

// [name, title, icon, onClick] — the Patrol Tool's buttons, as a data table like
// KEYBINDINGS in keys.js. The handlers are the same ones the GM keybindings
// (Ctrl+Shift+G / Ctrl+Shift+H) use, so mouse and keyboard never diverge.
const PATROL_TOOLS = [
    ["start", "Start all patrols on this scene (selected tokens, or all owned tokens)", "fas fa-play", () => startAllRoutes()],
    ["stop", "Stop all patrols on this scene (selected tokens, or all owned tokens)", "fas fa-stop", () => haltAllRoutes()],
];

/**
 * Builds the tool map (keyed by tool name, with order) from the PATROL_TOOLS table.
 * Every tool gets `button: true`: in Foundry v13/v14 a tool's `onClick` only fires
 * on an actual button click when the tool is flagged as a button. Without it the
 * click just moves `activeTool` and the handler fires late — on the next control
 * activation — which is exactly the "nothing happens until I click another tool"
 * bug. All Patrol Tool actions are momentary, so all tools are buttons.
 */
function buildTools() {
    const tools = {};
    PATROL_TOOLS.forEach(([name, title, icon, onClick], index) => {
        tools[name] = { name, order: index + 1, title, icon, button: true, onClick };
    });
    return tools;
}

/**
 * Builds a fresh Patrol Tool control object. Fresh per call on purpose: Foundry
 * may mutate the control/tools it receives, so hook calls must not share one
 * instance. No `layer` association on purpose — point picking is DOM-level and
 * always active, and activating the routes layer here would steal the active
 * canvas layer from the token layer.
 */
function buildPatrolControl() {
    return {
        name: "patrol",
        order: 100,
        title: "Patrol Tool",
        icon: "fas fa-route",
        visible: true,
        activeTool: "",
        tools: buildTools(),
    };
}

/** Adds a control to the hook payload — a Record keyed by control name in v13+; tolerate an array. */
function addSceneControl(controls, control) {
    if (Array.isArray(controls)) controls.push(control);
    else controls[control.name] = control;
}

/**
 * Registers the "Patrol Tool" scene control on the left sidebar (route icon,
 * GM only): two momentary buttons — start all patrols / stop all patrols — so
 * the GM can trigger the keybinding actions with the mouse. Only wires the
 * hook; the control itself is built by buildPatrolControl(). `activeTool` stays
 * empty so that merely opening the control never fires a tool's onClick.
 */
export function registerPatrolControl() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        addSceneControl(controls, buildPatrolControl());
    });
}
