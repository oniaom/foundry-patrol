import { MODULE, SETTINGS } from "./config.js";
import { TP } from "./tp.js";
import { PatrolDataManager } from "./store.js";
import { TokenPatrollerManager } from "./patroller.js";
import { TokenHud } from "./hud.js";
import { RoutesLayer } from "./routes-layer.js";
import { registerCanvasPointInteraction } from "./point-interaction.js";
import { registerKeybindings } from "./keys.js";
import { VisionHandler } from "./vision.js";
import { SpeechHandler } from "./speech.js";
import { AudioHandler } from "./audio.js";
import { routesLayer } from "./util.js";

globalThis.TP = TP;
TP.MODULENAME = MODULE;

function registerSettings() {
    for (const setting of SETTINGS) {
        game.settings.register(MODULE, setting.key, setting.settings);
    }
}

function registerHandlebarsHelpers() {
    const handlebars = globalThis.Handlebars;
    if (!handlebars) return;
    handlebars.registerHelper("determineChecked", function (currentValue) {
        return currentValue ? 'checked="checked"' : "";
    });
    handlebars.registerHelper("determineSelected", function (currentValue, tokenId) {
        return currentValue == TP.tokenPatroller?.getLanguage(tokenId) ? 'selected="selected"' : "";
    });
}

function onInit() {
    registerSettings();
    registerKeybindings();
    registerHandlebarsHelpers();
    CONFIG.Canvas.layers.patrolRoutes = { layerClass: RoutesLayer, group: "primary" };
    // Clicking a plotted point circle (delete / move options) is handled at the
    // DOM level on the canvas element, so it works no matter which canvas layer
    // is active. (Re)bind whenever the canvas is (re)drawn for a scene.
    Hooks.on("canvasReady", () => registerCanvasPointInteraction());
}

async function onReady() {
    TP.patrolDataManager = new PatrolDataManager();
    if (!game.user.isGM) return;
    TP.tokenPatroller = await TokenPatrollerManager.create();
    TP.visionHandler = new VisionHandler();
    TP.audioHandler = new AudioHandler();
    TP.speechHandler = new SpeechHandler();
    const module = game.modules.get(MODULE);
    if (module) module.api = TP;
}

function onRenderTokenHUD(tokenHUD, html, data) {
    const token = tokenHUD.object ?? tokenHUD.document?.object ?? tokenHUD.document;
    if (!token) return;
    TokenHud.HUD(token, html, data);
}

async function onControlToken(token, controlled) {
    if (!game.user.isGM || !TP.tokenPatroller) return;
    if (controlled) {
        await TP.tokenPatroller.livePlotUpdate(token.id);
    } else {
        await routesLayer()?.draw();
    }
}

Hooks.once("init", onInit);
Hooks.once("ready", onReady);
Hooks.on("renderTokenHUD", onRenderTokenHUD);
Hooks.on("controlToken", onControlToken);

Hooks.on("deleteToken", (tokenDocument) => {
    TP.tokenPatroller?.deleteToken(tokenDocument.id);
});

Hooks.on("preDeleteAmbientSound", (soundDocument) => {
    TP.tokenPatroller?.deleteAmbientSound(soundDocument.getFlag(MODULE, "tokenId"));
});
