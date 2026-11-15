import { MODULE } from "./config.js";
import { TP } from "./tp.js";

const FormApplication = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication;

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
        let lang = [];
        if (polyglotActive) {
            const token = canvas.tokens.get(this.tokenId);
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
            lang = [...known];
        }
        return {
            tokenId: this.tokenId,
            polygot: polyglotActive,
            lang: lang,
            audioPath: tokenData.audioPath ?? "",
            audioLocal: tokenData.audioLocal,
            audioRadius: tokenData.audioRadius ?? "",
            audioVolume: tokenData.audioVolume ?? "",
            catchQuotes: this._quoteHelper(tokenData.catchQuotes),
            createCombat: tokenData.createCombat,
            pauseGame: tokenData.pauseGame,
            delayPeriod: this._delayHelper(tokenData.delayPeriod),
            inverted: tokenData.inverted,
            isLinear: tokenData.isLinear,
            tokenRotation: tokenData.tokenRotation,
            otherTokenVision: tokenData.otherTokenVision,
            otherTokenVisionQuotes: this._quoteHelper(tokenData.otherTokenVisionQuotes),
            enableQuotes: tokenData.enableQuotes,
            patrolPercent: tokenData.patrolPercent,
            patrolQuotes: this._quoteHelper(tokenData.patrolQuotes),
            stopWhenSeen: tokenData.stopWhenSeen,
            visionChecking: tokenData.visionChecking,
        };
    }

    _delayHelper(delayPeriod) {
        if (!delayPeriod || delayPeriod.length <= 0) return null;
        let string = '"';
        delayPeriod.forEach((delay) => {
            string = string + delay / 1000 + ",";
        });
        return string.slice(0, -1) + '"';
    }

    _quoteHelper(quotes) {
        if (!quotes || quotes.length <= 0) return null;
        let string = "";
        quotes.forEach((quote) => {
            string = string + "'" + quote + "'" + " ";
        });
        return string;
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
        if (formData.isLinear && canvas.grid.type != CONST.GRID_TYPES.SQUARE) {
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
        const parse = (value) => {
            if (!value || value.length <= 0) return null;
            return (value.match(/'([^']*)'/g) || []).map((entry) => entry.slice(1, -1));
        };
        formData.patrolQuotes = parse(formData.patrolQuotes);
        formData.catchQuotes = parse(formData.catchQuotes);
        formData.otherTokenVisionQuotes = parse(formData.otherTokenVisionQuotes);
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

        const tabs = {
            settings: root.querySelector(".settings-button"),
            quotes: root.querySelector(".quotes-button"),
            vision: root.querySelector(".vision-button"),
            audio: root.querySelector(".audio-button"),
        };
        const bodies = {
            settings: root.querySelector("#patrol-settings"),
            quotes: root.querySelector("#quotes"),
            vision: root.querySelector("#vision"),
            audio: root.querySelector("#audio"),
        };
        let currentTab = "settings";

        root.querySelectorAll(".nav-tab").forEach((button) => {
            button.addEventListener("click", () => {
                if (bodies[currentTab]) bodies[currentTab].classList.add("hide");
                if (tabs[currentTab]) tabs[currentTab].classList.remove("selected");
                if (button.classList.contains("settings-button")) currentTab = "settings";
                else if (button.classList.contains("quotes-button")) currentTab = "quotes";
                else if (button.classList.contains("vision-button")) currentTab = "vision";
                else if (button.classList.contains("audio-button")) currentTab = "audio";
                if (bodies[currentTab]) bodies[currentTab].classList.remove("hide");
                if (tabs[currentTab]) tabs[currentTab].classList.add("selected");
            });
        });

        const langSelect = root.querySelector("#polyglot-patrol");
        langSelect?.addEventListener("change", () => {
            if (langSelect.value) this.language = langSelect.value;
        });
    }
}
