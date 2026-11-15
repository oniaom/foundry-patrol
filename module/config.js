export const MODULE = "foundry-patrol";

export const SETTINGS = [
    {
        key: "tokenRotation",
        settings: {
            name: "Enable GLOBAL Token Rotation",
            hint: "Enables tokens to face the direction their route moves them. Good with topdown tokens.",
            type: Boolean,
            default: false,
            scope: "world",
            config: true,
        },
    },
    {
        key: "disableHUD",
        settings: {
            name: "Disable the tokenPatroller HUD",
            hint: "Disables the HUD icons to allow for a clear menu. Optimal when used with keybindings. The caret menu remains available.",
            type: Boolean,
            default: false,
            scope: "client",
            config: true,
        },
    },
    {
        key: "combatPause",
        settings: {
            name: "Pause patrols on combat start",
            hint: "When an encounter is started, patrolling tokens will wait until it ends.",
            type: Boolean,
            default: false,
            scope: "client",
            config: true,
        },
    },
    {
        key: "enablePlayerPatrol",
        settings: {
            name: "Player Access",
            hint: "Enables the patrol HUD buttons for players on tokens they own.",
            type: Boolean,
            default: false,
            scope: "world",
            config: true,
        },
    },
];
