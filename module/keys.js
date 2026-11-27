import { MODULE } from "./config.js";
import { TP } from "./tp.js";

/** Tokens the keybindings act on: controlled tokens, else all owned tokens. */
function affectedTokens() {
    const controlled = canvas.tokens.controlled;
    return controlled.length > 0 ? controlled : canvas.tokens.placeables.filter((t) => t.isOwner);
}

function forEachAffectedToken(fn) {
    for (const token of affectedTokens()) fn(token);
}

// Exported so the Patrol Tool scene control (scene-control.js) can offer the
// same actions as buttons, not just as keybindings.
export function startAllRoutes() {
    forEachAffectedToken((token) => TP.tokenPatroller?.startPatrol(undefined, token.id));
    ui.notifications.info("Routes started for this scene");
}

export function haltAllRoutes() {
    forEachAffectedToken((token) => TP.tokenPatroller?._disableWalking(token));
    ui.notifications.info("Routes halted for this scene");
}

function addPlotSelectedToken() {
    for (const token of canvas.tokens.controlled) {
        TP.tokenPatroller?.addPlotPoint(token.id);
    }
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

// [setting key, name, hint, default key, onDown handler]
const KEYBINDINGS = [
    ["startRoute", "Start Routes", "Start all patrol routes on this scene (selected tokens, or all owned tokens).", "KeyG", startAllRoutes],
    ["stopRoute", "Stop Routes", "Halt all patrol routes on this scene.", "KeyH", haltAllRoutes],
    ["addTokenPoint", "Add Plot Point", "Add the current position of each selected token as a patrol point.", "KeyR", addPlotSelectedToken],
    ["generateMacro", "Generate Patrol Macro", "Create a macro that starts the patrols of the selected tokens.", "KeyM", generateMacro],
];

export function registerKeybindings() {
    for (const [key, name, hint, code, onDown] of KEYBINDINGS) {
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
