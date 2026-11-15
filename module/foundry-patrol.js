import { MODULE, SETTINGS } from "./config.js";
import { TP } from "./tp.js";
import { PatrolDataManager } from "./store.js";
import { TokenPatrollerManager } from "./patroller.js";
import { TokenHud } from "./hud.js";
import { RoutesLayer } from "./routes-layer.js";
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

Hooks.once("init", () => {
    registerSettings();
    registerKeybindings();
    registerHandlebarsHelpers();
    CONFIG.Canvas.layers.patrolRoutes = { layerClass: RoutesLayer, group: "primary" };
});

Hooks.once("ready", async () => {
    TP.patrolDataManager = new PatrolDataManager();
    if (!game.user.isGM) return;
    TP.tokenPatroller = await TokenPatrollerManager.create();
    TP.visionHandler = new VisionHandler();
    TP.audioHandler = new AudioHandler();
    TP.speechHandler = new SpeechHandler();
    const module = game.modules.get(MODULE);
    if (module) module.api = TP;
});

Hooks.on("renderTokenHUD", (tokenHUD, html, data) => {
    const token = tokenHUD.object ?? tokenHUD.document?.object ?? tokenHUD.document;
    if (!token) return;
    TokenHud.HUD(token, html, data);
});

Hooks.on("controlToken", async (token, controlled) => {
    if (!game.user.isGM || !TP.tokenPatroller) return;
    if (controlled) {
        await TP.tokenPatroller.livePlotUpdate(token.id);
    } else {
        await routesLayer()?.draw();
    }
});

Hooks.on("deleteToken", (tokenDocument) => {
    TP.tokenPatroller?.deleteToken(tokenDocument.id);
});

Hooks.on("preDeleteAmbientSound", (soundDocument) => {
    TP.tokenPatroller?.deleteAmbientSound(soundDocument.getFlag(MODULE, "tokenId"));
});
