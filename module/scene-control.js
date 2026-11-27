import { startAllRoutes, haltAllRoutes } from "./keys.js";

// [name, title, icon, handler] — the Patrol Tool's buttons, as a data table like
// KEYBINDINGS in keys.js. The handlers are the same ones the GM keybindings
// (Ctrl+Shift+G / Ctrl+Shift+H) use, so mouse and keyboard never diverge.
const PATROL_TOOLS = [
    ["start", "Start all patrols on this scene (selected tokens, or all owned tokens)", "fas fa-play", () => startAllRoutes()],
    ["stop", "Stop all patrols on this scene (selected tokens, or all owned tokens)", "fas fa-stop", () => haltAllRoutes()],
];

/**
 * Builds the tool map (keyed by tool name, with order) from the PATROL_TOOLS table.
 * Every tool gets `button: true` (momentary button, never moves `activeTool`) and
 * BOTH `onChange` and `onClick` pointing at the same handler: the v13/v14
 * `SceneControlTool` schema fires `onChange(event, active)` for button tools —
 * `onClick` alone is silently ignored there, which is why the buttons used to do
 * nothing. The handlers are idempotent (starting an already-walking patrol and
 * halting a halted one are no-ops), so a build that fires both is harmless.
 */
function buildTools() {
    const tools = {};
    PATROL_TOOLS.forEach(([name, title, icon, handler], index) => {
        tools[name] = { name, order: index + 1, title, icon, button: true, onClick: handler, onChange: handler };
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
