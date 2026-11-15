import { TP } from "./tp.js";
import { gridSize, routesLayer, isSquareGrid } from "./util.js";
import { createDefaultPatrolData } from "./schema.js";
import { normalizeDelayInput, delayToSeconds } from "./delay.js";
import { generateLinearRoute, rebuildLinearPaths, segmentCount } from "./linear-routes.js";
import { PatrolEngine } from "./patrol-engine.js";
import { routesFromTokenMap } from "./routes-layer.js";
import { showDeleteRouteDialog } from "./controls.js";

/**
 * TokenPatrollerManager — owns the per-token patrol data (tokenMap) and exposes
 * the module's public point/route API (`TP.tokenPatroller`). It coordinates the
 * focused collaborators, each of which owns one responsibility:
 *  - store.js (PatrolDataManager): persistence in scene flags
 *  - schema.js: the per-token data schema
 *  - delay.js: delay-string parsing/formatting
 *  - linear-routes.js: grid path math for Linear Walk mode
 *  - patrol-engine.js: the walking loop
 *  - routes-layer.js: the "routes" render cache + canvas layer
 *  - controls.js: popup/dialog UI
 * The manager itself only does: mutate tokenMap -> persist -> redraw.
 */
export class TokenPatrollerManager {
    constructor() {
        this.tokenMap = {};
        this.debug = false;
        this.engine = new PatrolEngine({
            getData: (tokenId) => this.tokenMap[tokenId],
            hasData: (tokenId) => Boolean(this.tokenMap[tokenId]),
            persist: () => this._saveAndUpdate(this.tokenMap),
            isDebug: () => this.debug,
        });
    }

    static async create() {
        const o = new TokenPatrollerManager();
        await o.initializeHashTable();
        await o._resetWalk();
        return o;
    }

    /** Marks every stored patrol as not walking (e.g. after a world reload) and persists. */
    async _resetWalk() {
        for (const res of Object.values(this.tokenMap)) {
            res.isWalking = false;
        }
        await this._saveAndUpdate(this.tokenMap);
    }

    /** Persists the tokenMap through the store and keeps the local reference. */
    async _saveAndUpdate(data) {
        this.tokenMap = data;
        await TP.patrolDataManager.savePatrols(this.tokenMap);
    }

    async initializeHashTable() {
        this.tokenMap = await TP.patrolDataManager.getPatrols();
    }

    // ------------------------------------------------------------------
    // Plot point / route mutations (public API)
    // ------------------------------------------------------------------

    /** Adds the token's current position as a new patrol point. */
    async addPlotPoint(tokenId) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        const coord = { x: token.x, y: token.y };
        this.updateTokenRoute(tokenId, coord);
        await this.livePlotUpdate(tokenId);
        await this.linearWalk(false, tokenId);
        await this.linearWalk(true, tokenId);
    }

    /** Appends a point to the token's route, creating the token's data entry if needed. */
    updateTokenRoute(tokenId, updateData) {
        if (this.tokenMap[tokenId]) {
            this.tokenMap[tokenId].plots.push(updateData);
        } else {
            this.tokenMap[tokenId] = createDefaultPatrolData();
            this.tokenMap[tokenId].plots.push(updateData);
        }
        this._saveAndUpdate(this.tokenMap);
    }

    generateTokenSchema(tokenId) {
        this.tokenMap[tokenId] = createDefaultPatrolData();
        this._saveAndUpdate(this.tokenMap);
        return this.tokenMap[tokenId];
    }

    /** Removes the plot point at `index` (right-click on a point / popup button). */
    async removePlotPoint(tokenId, index) {
        const data = this.tokenMap[tokenId];
        if (!data || !Array.isArray(data.plots)) return;
        if (!Number.isInteger(index) || index < 0 || index >= data.plots.length) return;
        data.plots.splice(index, 1);
        data.lastPos = 0;
        if (data.isLinear) await this._rebuildLinearRoutes(tokenId);
        await this._saveAndUpdate(this.tokenMap);
        await this.livePlotUpdate();
    }

    /**
     * Moves one plotted point to a new position (drag-and-drop on the map),
     * then persists and redraws the route.
     */
    async movePlotPoint(tokenId, index, point) {
        const data = this.tokenMap[tokenId];
        if (!data || !Array.isArray(data.plots)) return;
        if (!Number.isInteger(index) || index < 0 || index >= data.plots.length) return;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        data.plots[index] = { x: point.x, y: point.y };
        data.lastPos = 0;
        if (data.isLinear) await this._rebuildLinearRoutes(tokenId);
        await this._saveAndUpdate(this.tokenMap);
        await this.livePlotUpdate();
    }

    /**
     * Removes route data for a token: either everything (removeAll) or just the
     * last plotted point (the HUD dialog's "undo last" option).
     */
    async removeTokenRoute(tokenId, removeAll = false) {
        if (!this.tokenMap[tokenId]) return;

        this.tokenMap[tokenId].linearPath = [];

        if (removeAll) {
            this.tokenMap[tokenId].plots = [];
            this.tokenMap[tokenId].countinousRoutes = [];
            this.tokenMap[tokenId].endCountinousRoutes = [];
            this.tokenMap[tokenId].lastRecordedLocation = {};
            this.tokenMap[tokenId].lastPos = 0;
        } else {
            const len = this.tokenMap[tokenId].plots.length;
            const p1 = this.tokenMap[tokenId].plots[len - 1];
            const p2 = this.tokenMap[tokenId].plots[len - 2];
            this.tokenMap[tokenId].plots.pop();
            this.tokenMap[tokenId].lastPos = 0;
            if (p1 && p2) this.tokenMap[tokenId].countinousRoutes.length -= segmentCount(p1, p2, gridSize());
            await this.linearWalk(false, tokenId);
            await this.linearWalk(true, tokenId);
        }
        await this._saveAndUpdate(this.tokenMap);
        await this.livePlotUpdate(tokenId);
    }

    async removeAllTokenRoutes() {
        await this._saveAndUpdate({});
        await this.livePlotUpdate();
    }

    /** The HUD trash button: asks what to delete, then deletes all or undoes the last point. */
    deleteProcess(tokenId) {
        showDeleteRouteDialog({
            onDeleteAll: () => this.removeTokenRoute(tokenId, true),
            onDeleteLast: () => this.removeTokenRoute(tokenId, false),
        });
    }

    /** Cleans up a deleted token's patrol data and its ambient sound. */
    async deleteToken(tokenId) {
        if (!this.tokenMap[tokenId]) return;

        const audioId = this.tokenMap[tokenId].audioId;
        if (audioId) canvas.sounds.get(audioId)?.document.delete();

        delete this.tokenMap[tokenId];
        await this._saveAndUpdate(this.tokenMap);
        await this.livePlotUpdate();
    }

    /** Clears the audio settings when the token's ambient sound is deleted. */
    async deleteAmbientSound(tokenId) {
        if (!tokenId || !this.tokenMap[tokenId]) return;

        this.tokenMap[tokenId].audioId = null;
        this.tokenMap[tokenId].audioPath = null;
        this.tokenMap[tokenId].audioVolume = null;
        this.tokenMap[tokenId].audioRadius = null;

        await this._saveAndUpdate(this.tokenMap);
    }

    // ------------------------------------------------------------------
    // Patrol control (the walking loop itself lives in patrol-engine.js)
    // ------------------------------------------------------------------

    async startPatrol(delay = null, tokenId) {
        delay = delay ? delay : this.delayPeriod; // no delay given -> keep the stored delayPeriod
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        await this._handleDelayPeriod(delay, tokenId);
        await this.engine.start(token);
    }

    async stopPatrol(tokenId) {
        await this.engine.stop(tokenId);
    }

    _disableWalking(token) {
        this.engine.disableWalking(token);
    }

    // ------------------------------------------------------------------
    // Linear Walk route generation (the math lives in linear-routes.js)
    // ------------------------------------------------------------------

    /**
     * Extends the continuous route arrays for the token's current plots.
     * generateEnd=false appends the leg from the second-to-last to the last
     * point; generateEnd=true builds the return leg back to the first point.
     */
    async linearWalk(generateEnd, tokenId) {
        if (!isSquareGrid()) return;

        const plot = foundry.utils.duplicate(this._getPlotsFromId(tokenId));
        if (!plot) return;

        const onArrive = () => this._saveAndUpdate(this.tokenMap);
        const grid = gridSize();
        const len = plot.length - 1;
        if (generateEnd) {
            const xMod = plot[0].x >= plot[len].x ? 1 : -1;
            const yMod = plot[0].y >= plot[len].y ? 1 : -1;
            const endCountinousRoutes = this._getGeneral(tokenId, "endCountinousRoutes");
            endCountinousRoutes.length = 0;
            const arrived = await generateLinearRoute(endCountinousRoutes, plot[len], plot[0], xMod, yMod, grid, onArrive);
            if (arrived) {
                this.tokenMap[tokenId].linearPath = [...this._getGeneral(tokenId, "countinousRoutes"), ...endCountinousRoutes];
            }
        } else if (plot.length < 2) {
            this._getGeneral(tokenId, "countinousRoutes").push(plot[0]);
            await this._saveAndUpdate(this.tokenMap);
        } else {
            const xMod = plot[len].x >= plot[len - 1].x ? 1 : -1;
            const yMod = plot[len].y >= plot[len - 1].y ? 1 : -1;
            await generateLinearRoute(this._getGeneral(tokenId, "countinousRoutes"), plot[len - 1], plot[len], xMod, yMod, grid, onArrive);
        }
    }

    /** Rebuilds all linear route arrays from scratch after a point was moved/removed. */
    async _rebuildLinearRoutes(tokenId) {
        if (!isSquareGrid()) return;
        const data = this.tokenMap[tokenId];
        const plots = data?.plots ?? [];
        const linearPath = await rebuildLinearPaths(
            plots,
            data.countinousRoutes,
            data.endCountinousRoutes,
            gridSize(),
            () => this._saveAndUpdate(this.tokenMap)
        );
        if (linearPath !== null) data.linearPath = linearPath;
    }

    // ------------------------------------------------------------------
    // Delay period (parsing lives in delay.js)
    // ------------------------------------------------------------------

    /**
     * Parses a user-entered delay string (seconds) into milliseconds and stores
     * it as the token's delayPeriod. Returns the stored delayPeriod, or
     * undefined when the input was empty/invalid (nothing is stored then).
     */
    async _handleDelayPeriod(delay, tokenId) {
        const parsed = normalizeDelayInput(delay, this.debug);
        if (!parsed || parsed.length == 0) return;
        if (this.tokenMap[tokenId]) {
            this.tokenMap[tokenId].delayPeriod = parsed;
        }
        await this._saveAndUpdate(this.tokenMap);
        return this.tokenMap[tokenId]?.delayPeriod;
    }

    /** The token's delayPeriod converted to seconds (for the HUD delay field). */
    async getDelayPeriod(tokenId) {
        const patrolData = this.tokenMap[tokenId];
        if (!patrolData) return;
        return delayToSeconds(patrolData.delayPeriod);
    }

    // ------------------------------------------------------------------
    // Render sync: project plots into the "routes" flag and redraw the layer
    // ------------------------------------------------------------------

    /** After any mutation of plot points: sync the routes flag and redraw the layer. */
    async livePlotUpdate() {
        await this._syncRoutesFlag();
        await routesLayer()?.draw();
    }

    /**
     * Writes every token's plotted points into the scene "routes" flag, so the
     * RoutesLayer can render all routes persistently (not just the selected token).
     */
    async _syncRoutesFlag() {
        if (!canvas.scene) return;
        await TP.patrolDataManager.saveRoutes(routesFromTokenMap(this.tokenMap));
    }

    // ------------------------------------------------------------------
    // Toggles, form binding and small accessors
    // ------------------------------------------------------------------

    _setLinear(tokenId) {
        if (!this.tokenMap[tokenId]) return;
        this.tokenMap[tokenId].isLinear = !this.tokenMap[tokenId].isLinear;
        this.tokenMap[tokenId].lastPos = 0;
        this._saveAndUpdate(this.tokenMap);
    }

    _setInverse(tokenId) {
        if (!this.tokenMap[tokenId]) return;
        this.tokenMap[tokenId].inverted = !this.tokenMap[tokenId].inverted;
        this.tokenMap[tokenId].lastPos = 0;
        this._saveAndUpdate(this.tokenMap);
        this.livePlotUpdate(tokenId);
    }

    /** The token's patrol data, creating (and persisting) a default entry if missing. */
    getTokenData(tokenId) {
        if (this.tokenMap[tokenId]) return this.tokenMap[tokenId];
        return this.generateTokenSchema(tokenId);
    }

    /** Applies the PatrolMenu form data to the token's entry (toggles flip via their setters). */
    updateFormRelatedData(formData, tokenId) {
        if (!this.tokenMap[tokenId]) this.generateTokenSchema(tokenId);
        for (const key in formData) {
            if (key == "isLinear" && formData[key] != this.tokenMap[tokenId].isLinear) this._setLinear(tokenId);
            else if (key == "inverted" && formData[key] != this.tokenMap[tokenId].inverted) this._setInverse(tokenId);
            else this.tokenMap[tokenId][key] = formData[key];
        }
        this._saveAndUpdate(this.tokenMap);
        this._releaseToken(tokenId);
    }

    _releaseToken(tokenId) {
        canvas.tokens.get(tokenId)?.release();
    }

    _hasAudio(tokenId) {
        return this.tokenMap[tokenId]?.audioId != null;
    }

    _getPlotsFromId(tokenId) {
        return this.tokenMap[tokenId]?.plots;
    }

    _getGeneral(tokenId, desiredProperty) {
        return this.tokenMap[tokenId]?.[desiredProperty];
    }
}

/**
 * Read-only accessors for per-token settings, generated from this table so the
 * public API (used by vision.js, speech.js, menu.js, hud.js) stays stable without
 * copy-pasted one-line getters. Each entry maps a getter name to the tokenMap
 * field it reads.
 */
const FIELD_GETTERS = {
    getLanguage: "language",
    getAudioPath: "audioPath",
    getPatrolPercent: "patrolPercent",
    getAudioLocal: "audioLocal",
    getAudioVolume: "audioVolume",
    getAudioRadius: "audioRadius",
    getAudioID: "audioId",
    getEnableQuotes: "enableQuotes",
    getVisionChecking: "visionChecking",
    getOtherVisionChecking: "otherTokenVision",
    getStopWhenSeen: "stopWhenSeen",
    getCreateCombat: "createCombat",
    getPauseGame: "pauseGame",
    getPatrolQuotes: "patrolQuotes",
    getCatchQuotes: "catchQuotes",
    getOtherTokenVisionQuotes: "otherTokenVisionQuotes",
};
for (const [methodName, field] of Object.entries(FIELD_GETTERS)) {
    TokenPatrollerManager.prototype[methodName] = function (tokenId) {
        return this.tokenMap[tokenId]?.[field];
    };
}
