import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { isSquareGrid } from "./util.js";
import { formatDelayForForm } from "./delay.js";

const FormApplication = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication;

/** Serializes stored quotes as the single-quote-delimited string shown in the form. */
function quotesToFormString(quotes) {
    if (!quotes || quotes.length <= 0) return null;
    let string = "";
    quotes.forEach((quote) => {
        string = string + "'" + quote + "'" + " ";
    });
    return string;
}

/** Parses the single-quote-delimited form string back into a quote array. */
function quotesFromFormString(value) {
    if (!value || value.length <= 0) return null;
    return (value.match(/'([^']*)'/g) || []).map((entry) => entry.slice(1, -1));
}

/** The menu's tab strip: nav-tab button class + body selector per tab. */
const TABS = [
    { name: "settings", buttonClass: "settings-button", bodySelector: "#patrol-settings" },
    { name: "quotes", buttonClass: "quotes-button", bodySelector: "#quotes" },
    { name: "vision", buttonClass: "vision-button", bodySelector: "#vision" },
    { name: "audio", buttonClass: "audio-button", bodySelector: "#audio" },
];

/** Languages the token's actor (or the user's character) knows, for the Polyglot dropdown. */
function collectKnownLanguages(tokenId) {
    const token = canvas.tokens.get(tokenId);
    const actors = [];
    if (token?.actor) actors.push(token.actor);
    if (actors.length == 0 && game.user.character) actors.push(game.user.character);
    const known = new Set();
    for (const actor of actors) {
        const languages = actor.system?.traits?.languages?.value;
        if (Array.isArray(languages)) languages.forEach((l) => known.add(l));
    }
    if (known.size == 0) {
        if (game.user.isGM && globalThis.PolyGlot?.languages) {
            Object.keys(globalThis.PolyGlot.languages).forEach((l) => known.add(l));
        } else {
            known.add("common");
        }
    }
    return [...known];
}

export class PatrolMenu extends FormApplication {
    constructor(tokenId, ...args) {
        super(...args);
        this.tokenId = tokenId;
        this.language = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: `modules/${MODULE}/templates/patrol_menu.html`,
            width: 600,
            height: "auto",
            title: "Patrol Menu Options",
            closeOnSubmit: true,
            id: "patrol-container",
        });
    }

    async getData() {
        const tokenData = TP.tokenPatroller.getTokenData(this.tokenId);
        const polyglotActive = game.modules.get("polyglot")?.active ?? false;
        return {
            tokenId: this.tokenId,
            polygot: polyglotActive,
            lang: polyglotActive ? collectKnownLanguages(this.tokenId) : [],
            audioPath: tokenData.audioPath ?? "",
            audioLocal: tokenData.audioLocal,
            audioRadius: tokenData.audioRadius ?? "",
            audioVolume: tokenData.audioVolume ?? "",
            catchQuotes: quotesToFormString(tokenData.catchQuotes),
            createCombat: tokenData.createCombat,
            pauseGame: tokenData.pauseGame,
            delayPeriod: formatDelayForForm(tokenData.delayPeriod, tokenData.randomDelay),
            inverted: tokenData.inverted,
            isLinear: tokenData.isLinear,
            tokenRotation: tokenData.tokenRotation,
            otherTokenVision: tokenData.otherTokenVision,
            otherTokenVisionQuotes: quotesToFormString(tokenData.otherTokenVisionQuotes),
            enableQuotes: tokenData.enableQuotes,
            patrolPercent: tokenData.patrolPercent,
            patrolQuotes: quotesToFormString(tokenData.patrolQuotes),
            stopWhenSeen: tokenData.stopWhenSeen,
            visionChecking: tokenData.visionChecking,
        };
    }

    async _updateObject(event, formData) {
        formData.language = this.language ?? TP.tokenPatroller.getLanguage(this.tokenId) ?? "common";

        this._handleDelete(formData);
        await this._processHUDSettings(formData);
        this._handleQuoteData(formData);
        await this._handleAudioData(formData);
        TP.tokenPatroller.updateFormRelatedData(formData, this.tokenId);
    }

    async _processHUDSettings(formData) {
        if (formData.isLinear && !isSquareGrid()) {
            formData.isLinear = false;
            ui.notifications.error("Linear path can only be used on square based maps, linear mode was disabled for you.");
        }

        const raw = String(formData.delayPeriod ?? "").replace(/"/g, "").trim();
        const parsed = await TP.tokenPatroller._handleDelayPeriod(raw.length ? raw : null, this.tokenId);
        formData.delayPeriod = parsed ?? TP.tokenPatroller.getTokenData(this.tokenId).delayPeriod;
    }

    _handleDelete(formData) {
        if (formData.delete) TP.tokenPatroller.removeTokenRoute(this.tokenId, true);
        delete formData.delete;
    }

    _handleQuoteData(formData) {
        formData.patrolQuotes = quotesFromFormString(formData.patrolQuotes);
        formData.catchQuotes = quotesFromFormString(formData.catchQuotes);
        formData.otherTokenVisionQuotes = quotesFromFormString(formData.otherTokenVisionQuotes);
    }

    async _handleAudioData(formData) {
        const audioPath = formData.audioPath ?? "";
        const audioRadius = Number(formData.audioRadius);
        const audioVolume = Number(formData.audioVolume);
        const audioLocal = !!formData.audioLocal;

        if (
            TP.audioHandler.hasAudio(this.tokenId) &&
            (audioPath != TP.tokenPatroller.getAudioPath(this.tokenId) ||
                audioRadius != TP.tokenPatroller.getAudioRadius(this.tokenId) ||
                audioVolume != TP.tokenPatroller.getAudioVolume(this.tokenId) ||
                audioLocal != TP.tokenPatroller.getAudioLocal(this.tokenId))
        ) {
            await TP.audioHandler.updateAudioInfo(TP.tokenPatroller.getAudioID(this.tokenId), audioPath, audioLocal, audioRadius, audioVolume);
            return;
        }
        if (TP.audioHandler.hasAudio(this.tokenId) || audioPath.length == 0 || !audioRadius || !audioVolume) return;

        const sound = await TP.audioHandler.createPatrolAudio(this.tokenId, audioPath, audioLocal, audioRadius, audioVolume);
        if (sound) formData.audioId = sound.id;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        // Tab strip: clicking a nav-tab shows its body and marks the button selected.
        let currentTab = "settings";
        const tabButton = (tab) => root.querySelector(`.${tab.buttonClass}`);
        const tabBody = (tab) => root.querySelector(tab.bodySelector);
        const showTab = (name) => {
            for (const tab of TABS) {
                tabBody(tab)?.classList.toggle("hide", tab.name !== name);
                tabButton(tab)?.classList.toggle("selected", tab.name === name);
            }
        };
        root.querySelectorAll(".nav-tab").forEach((button) => {
            button.addEventListener("click", () => {
                const next = TABS.find((tab) => button.classList.contains(tab.buttonClass));
                if (next) currentTab = next.name;
                showTab(currentTab);
            });
        });

        const langSelect = root.querySelector("#polyglot-patrol");
        langSelect?.addEventListener("change", () => {
            if (langSelect.value) this.language = langSelect.value;
        });
    }
}
