export const MODULE = "foundry-patrol";

/**
 * Builds one game.settings entry. All module settings are Boolean toggles with
 * config UI; only the scope differs per setting.
 */
function defineSetting(key, name, hint, extra = {}) {
    return {
        key: key,
        settings: {
            name: name,
            hint: hint,
            type: Boolean,
            default: false,
            scope: "client",
            config: true,
            ...extra,
        },
    };
}

export const SETTINGS = [
    defineSetting(
        "tokenRotation",
        "Enable GLOBAL Token Rotation",
        "Enables tokens to face the direction their route moves them. Good with topdown tokens.",
        { scope: "world" }
    ),
    defineSetting(
        "disableHUD",
        "Disable the tokenPatroller HUD",
        "Disables the HUD icons to allow for a clear menu. Optimal when used with keybindings. The caret menu remains available."
    ),
    defineSetting(
        "combatPause",
        "Pause patrols on combat start",
        "When an encounter is started, patrolling tokens will wait until it ends."
    ),
    defineSetting(
        "enablePlayerPatrol",
        "Player Access",
        "Enables the patrol HUD buttons for players on tokens they own.",
        { scope: "world" }
    ),
];
