import { MODULE } from "./config.js";
import { TP } from "./tp.js";

function affectedTokens() {
    const controlled = canvas.tokens.controlled;
    return controlled.length > 0 ? controlled : canvas.tokens.placeables.filter((t) => t.isOwner);
}

function startAllRoutes() {
    for (const token of affectedTokens()) {
        TP.tokenPatroller?.startPatrol(undefined, token.id);
    }
    ui.notifications.info("Routes started for this scene");
}

function haltAllRoutes() {
    for (const token of affectedTokens()) {
        TP.tokenPatroller?._disableWalking(token);
    }
    ui.notifications.info("Routes halted for this scene");
}

function addPlotSelectedToken() {
    for (const token of canvas.tokens.controlled) {
        TP.tokenPatroller?.addPlotPoint(token.id);
    }
}

function clearAllRoutes() {
    for (const token of affectedTokens()) {
        TP.tokenPatroller?.removeTokenRoute(token.id, true);
    }
    ui.notifications.info("Routes cleared for this scene");
}

async function generateMacro() {
    const selectedTokens = canvas.tokens.controlled;
    if (selectedTokens.length == 0) return -1;
    const tokenIds = selectedTokens.map((t) => `"${t.id}"`).join(",");
    const command = `[${tokenIds}].forEach(tokenId => {
    TP.tokenPatroller.startPatrol("2", tokenId);
    /*
    Where the 2 is, is where you want to put the delay.
    Comma separated for multiple.
    EX: TP.tokenPatroller.startPatrol("2, 4, 12", tokenId);
    If you want a macro to stop the patrols,
    swap startPatrol for stopPatrol and remove the delay.
    EX: TP.tokenPatroller.stopPatrol(tokenId);
    */
})`;
    const macro = await Macro.create({
        name: "Patrol Route Macro (Make a better name)",
        type: "script",
        command: command,
    });
    macro?.sheet?.render(true);
    return macro;
}

export function registerKeybindings() {
    const bindings = [
        ["startRoute", "Start Routes", "Start all patrol routes on this scene (selected tokens, or all owned tokens).", "KeyG", startAllRoutes],
        ["stopRoute", "Stop Routes", "Halt all patrol routes on this scene.", "KeyH", haltAllRoutes],
        ["addTokenPoint", "Add Plot Point", "Add the current position of each selected token as a patrol point.", "KeyR", addPlotSelectedToken],
        ["clearRoute", "Clear Routes", "Clear the patrol routes of the selected (or all owned) tokens.", "KeyD", clearAllRoutes],
        ["generateMacro", "Generate Patrol Macro", "Create a macro that starts the patrols of the selected tokens.", "KeyM", generateMacro],
    ];
    for (const [key, name, hint, code, onDown] of bindings) {
        game.keybindings.register(MODULE, key, {
            name: name,
            hint: hint,
            editable: [{ key: code, modifiers: ["Control", "Shift"] }],
            onDown: () => {
                if (game.user.isGM) return onDown();
            },
            restricted: true,
        });
    }
}
