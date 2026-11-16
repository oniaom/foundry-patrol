import { startAllRoutes, haltAllRoutes } from "./keys.js";

/**
 * Registers the "Patrol Tool" scene control on the left sidebar (route icon,
 * GM only). It carries two momentary buttons — start all patrols / stop all
 * patrols — that run the same actions as the GM keybindings (Ctrl+Shift+G /
 * Ctrl+Shift+H), so the GM can trigger them with the mouse. The control has
 * no `layer` association on purpose: point picking is DOM-level and always
 * active, and activating the routes layer here would steal the active canvas
 * layer from the token layer.
 */
export function registerPatrolControl() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        const control = {
            name: "patrol",
            order: 100,
            title: "Patrol Tool",
            icon: "fas fa-route",
            visible: true,
            activeTool: "",
            tools: {
                start: {
                    name: "start",
                    order: 1,
                    title: "Start all patrols on this scene (selected tokens, or all owned tokens)",
                    icon: "fas fa-play",
                    onClick: () => startAllRoutes(),
                },
                stop: {
                    name: "stop",
                    order: 2,
                    title: "Stop all patrols on this scene (selected tokens, or all owned tokens)",
                    icon: "fas fa-stop",
                    onClick: () => haltAllRoutes(),
                },
            },
        };
        // v13+ passes a Record keyed by control name; tolerate an array just in case.
        if (Array.isArray(controls)) controls.push(control);
        else controls.patrol = control;
    });
}
