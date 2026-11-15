import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { gridSize, routesLayer } from "./util.js";

const Dialog = foundry.appv1?.api?.Dialog ?? globalThis.Dialog;

export class TokenPatrollerManager {
    constructor() {
        this.tokenMap = {};
        this.debug = false;
    }

    static async create() {
        const o = new TokenPatrollerManager();
        await o.initializeHashTable();
        await o._resetWalk();
        return o;
    }

    async _resetWalk() {
        for (const res of Object.values(this.tokenMap)) {
            res.isWalking = false;
        }
        await this._saveAndUpdate(this.tokenMap);
    }

    async _saveAndUpdate(data) {
        this.tokenMap = data;
        await TP.patrolDataManager.saveMap(this.tokenMap);
    }

    async initializeHashTable() {
        this.tokenMap = await TP.patrolDataManager.dataInit();
    }

    async addPlotPoint(tokenId) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        const coord = { x: token.x, y: token.y };
        this.updateTokenRoute(tokenId, coord);
        await this.livePlotUpdate(tokenId);
        await this.linearWalk(false, tokenId);
        await this.linearWalk(true, tokenId);
    }

    async startPatrol(delay = null, tokenId) {
        delay = delay ? delay : this.delayPeriod;
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        await this._handleDelayPeriod(delay, tokenId);
        const patrolData = this.tokenMap[tokenId];
        if (!patrolData) return;

        this._updatelastRecordedLocation(undefined, token);
        if (patrolData.isWalking) return;
        patrolData.isWalking = true;
        let cycle = this.tokenMap[tokenId].inverted == false ? 1 : 0;
        try {
            while (patrolData.isWalking && this._validatePatrol(token)) {
                await this._saveAndUpdate(this.tokenMap);
                const result = await this._navigationCycle(cycle, token);
                if (result) return;
                cycle = this.tokenMap[tokenId].inverted == false ? 1 : 0;
            }
            this._disableWalking(token);
        } catch (e) {
            console.log(`Foundry-Patrol: Unexpected error in patrol (was a token deleted during movement?):\n${e}\n${e.stack}`);
        }
    }

    async stopPatrol(tokenId) {
        if (!this.tokenMap[tokenId]) return;
        this.tokenMap[tokenId].isWalking = false;
        await this._saveAndUpdate(this.tokenMap);
    }

    async _navigationCycle(cycle, token) {
        const patrolData = this.tokenMap[token.id];
        if (!patrolData) return;
        let patrolPoints = patrolData.plots;

        if (patrolData.isLinear && canvas.grid.type == CONST.GRID_TYPES.SQUARE) {
            patrolPoints = patrolData.inverted ? patrolData.countinousRoutes : patrolData.linearPath;
        }

        let forceReturn;
        const settings = {
            INCREMENT: 1,
            DECREMENT: -1,
            PLOT_SIZE: patrolPoints.length,
            RETURN_SIZE: 0,
            ON_INVERSE_FALSE: false,
            ON_INVERSE_TRUE: true,
            OPERATOR_GREATER: function (a, b) {
                return a >= b;
            },
            OPERATOR_LESS: function (a, b) {
                return a < b;
            },
        };

        let lastPos = await this._determineLastPosition(cycle, patrolPoints, token);
        forceReturn = await this._navigationLoop(
            patrolPoints,
            lastPos,
            settings.PLOT_SIZE,
            settings.OPERATOR_LESS,
            settings.ON_INVERSE_FALSE,
            settings.INCREMENT,
            token
        );
        if (forceReturn) return;
        lastPos = await this._determineLastPosition(cycle, patrolPoints, token);
        forceReturn = await this._navigationLoop(
            patrolPoints,
            lastPos - 1,
            settings.RETURN_SIZE,
            settings.OPERATOR_GREATER,
            settings.ON_INVERSE_TRUE,
            settings.DECREMENT,
            token
        );
        if (forceReturn) return;
    }

    async _navigationLoop(patrolPoints, iterator, comparison, operation, onReturn, increment, token) {
        const patrolData = this.tokenMap[token.id];
        if (!patrolData) return;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        if (patrolData.onInverseReturn == onReturn) {
            for (iterator; operation(iterator, comparison); iterator = iterator + increment) {
                if (!patrolData.isWalking) return true;
                const combatStarted = game.settings.get(MODULE, "combatPause");
                if (game.settings.get(MODULE, "tokenRotation") || this.tokenMap[token.id].tokenRotation) {
                    const dX = patrolPoints[iterator].x - patrolData.lastRecordedLocation.x;
                    const dY = patrolPoints[iterator].y - patrolData.lastRecordedLocation.y;
                    this.rotateToken(dX, dY, token);
                }

                if (patrolData.delayPeriod.length == patrolPoints.length) {
                    await sleep(patrolData.delayPeriod[iterator]);
                } else {
                    await sleep(patrolData.delayPeriod[Math.floor(Math.random() * patrolData.delayPeriod.length)]);
                }
                if (!this.tokenMap[token.id]) return;

                if (
                    patrolData.isWalking &&
                    !game.paused &&
                    !(combatStarted && game.combat?.started) &&
                    !this._wasTokenMoved(token) &&
                    this._validatePatrol(token) &&
                    !patrolData.isDeleted
                ) {
                    await this._navigateToNextPoint(patrolPoints[iterator], token);
                    await this._ensureAnimationCompletion(token);
                    await TP.speechHandler.handleSpeech(token.id, "patrol");
                    await TP.visionHandler.evaluateSight(token.id);
                    this._storeLastPlotTaken(iterator, token);
                } else {
                    if (game.paused == true || (combatStarted && game.combat?.started)) {
                        iterator = iterator - increment;
                    } else {
                        return true;
                    }
                }
            }
            if (patrolData.onInverseReturn || patrolData.inverted) {
                this._setInverseReturn(token);
            }
        }
    }

    async _ensureAnimationCompletion(token) {
        try {
            const promise = token.movementAnimationPromise;
            if (promise) await Promise.race([promise, new Promise((r) => setTimeout(r, 15000))]);
        } catch (err) {
            if (this.debug) console.log(`Foundry-Patrol: Error waiting for movement animation\n${err}`);
        }
    }

    async _determineLastPosition(cycle, plots, token) {
        const patrolData = this.tokenMap[token.id];
        const lastPos = patrolData.lastPos;
        if (!patrolData.isInverted) {
            if (cycle != 0 && lastPos == plots.length - 1) {
                return 0;
            }
            return lastPos;
        }
        return lastPos;
    }

    async _navigateToNextPoint(plot, token) {
        try {
            if (this._hasAudio(token.id)) {
                await TP.audioHandler.updateAmbientPosition(plot.x, plot.y, this.tokenMap[token.id].audioId);
            }

            await token.document.update({ x: plot.x, y: plot.y });

            this._updatelastRecordedLocation(plot, token);
        } catch (error) {
            if (this.debug) console.log(`Foundry-Patrol: Error in token navigation\n${error}`);
        }
    }

    async _handleDelayPeriod(delay, tokenId) {
        const MILLISECONDS = 1000;
        const DEFAULT_SECONDS = 2;
        const INVALID_NUMBER = 0;
        if (delay == null || delay === "") {
            return;
        }
        delay = String(delay);
        if (/[^0-9\-,\s]/.test(delay)) return;

        delay = this._processDelayRegex(delay);
        if (!delay || delay.length == 0) return;
        try {
            for (let i = 0; i < delay.length; ++i) {
                if (delay[i] <= INVALID_NUMBER) delay[i] = delay[i] * -1 + DEFAULT_SECONDS;
                delay[i] = delay[i] * MILLISECONDS;
            }
            if (this.tokenMap[tokenId]) {
                this.tokenMap[tokenId].delayPeriod = delay;
            }
        } catch (error) {
            return;
        }
        await this._saveAndUpdate(this.tokenMap);
        return this.tokenMap[tokenId]?.delayPeriod;
    }

    /**
     * Parses the string to generate a valid array of ints.
     * Excess commas are ignored.
     * Acceptable: [1-5] --> 1,2,3,4,5
     * Acceptable: 1,2,3,4,5 --> 1,2,3,4,5
     * Acceptable: [1-5],6,7 --> 1,2,3,4,5,6,7
     * @param {string} delay
     */
    _processDelayRegex(delay) {
        delay = delay.replace(/\s/g, "");
        if (delay.length == 0) return [2];
        const singleValue = delay.match(/[0-9]+/g) ?? [];
        delay += ",";
        const commaSeperated = delay.match(/(\d+(?=,))/g);
        const rangeDelay = delay.match(/(\d+\-\d+)/g);
        delay = [];
        if (singleValue.length == 1) {
            delay.push(parseInt(singleValue[0]));
            return delay;
        }
        if (rangeDelay) {
            rangeDelay.forEach(function (rangeSet) {
                const rangeValues = rangeSet.split("-");
                for (let i = parseInt(rangeValues[0]); i <= parseInt(rangeValues[1]); i++) {
                    delay[delay.length] = i;
                }
            });
        }

        if (commaSeperated) {
            commaSeperated.forEach(function (csvValue) {
                delay[delay.length] = parseInt(csvValue);
            });
        }
        if (this.debug) console.log(`Foundry-Patrol: Wait periods include: ${delay}`);
        return delay;
    }

    rotateToken(dX, dY, token) {
        if (dX == 0 && dY == 0) return;
        const rotation = (Math.atan2(dY, dX) * 180) / Math.PI;
        token.document.update({ rotation: ((rotation % 360) + 360) % 360 });
    }

    async linearWalk(generateEnd, tokenId) {
        if (canvas.grid.type != CONST.GRID_TYPES.SQUARE) return;

        const plot = foundry.utils.duplicate(this._getPlotsFromId(tokenId));
        if (!plot) return;

        const len = plot.length - 1;
        if (generateEnd) {
            const ROUTE_START = 0;
            const xMod = plot[ROUTE_START].x >= plot[len].x ? 1 : -1;
            const yMod = plot[ROUTE_START].y >= plot[len].y ? 1 : -1;
            this._getGeneral(tokenId, "endCountinousRoutes").length = 0;
            if (await this._generateLinearRoute(this._getGeneral(tokenId, "endCountinousRoutes"), plot[len], plot[ROUTE_START], xMod, yMod))
                this._generateLinearPath(tokenId);
        } else if (plot.length < 2) {
            this._getGeneral(tokenId, "countinousRoutes").push(plot[0]);
            await this._saveAndUpdate(this.tokenMap);
        } else {
            const xMod = plot[len].x >= plot[len - 1].x ? 1 : -1;
            const yMod = plot[len].y >= plot[len - 1].y ? 1 : -1;
            await this._generateLinearRoute(this._getGeneral(tokenId, "countinousRoutes"), plot[len - 1], plot[len], xMod, yMod);
        }
    }

    async _generateLinearRoute(route, src, dest, xMod, yMod) {
        const GRID_SIZE = gridSize();

        if (src.x % GRID_SIZE != 0 && src.y % GRID_SIZE != 0 && dest.x % GRID_SIZE != 0 && dest.y % GRID_SIZE != 0) {
            ui.notifications.error("Can't process linear walk of the given coordinates. Please check the console output.");
            console.log(route);
            console.log(src);
            console.log(dest);
            return false;
        }
        if (src.x == dest.x && src.y == dest.y) {
            await this._saveAndUpdate(this.tokenMap);
            return true;
        } else if (src.x != dest.x && src.y != dest.y) {
            src.x += GRID_SIZE * xMod;
            src.y += GRID_SIZE * yMod;
            route.push({ x: src.x, y: src.y });
            return await this._generateLinearRoute(route, src, dest, xMod, yMod);
        } else if (src.x == dest.x && src.y != dest.y) {
            src.y += GRID_SIZE * yMod;
            route.push({ x: src.x, y: src.y });
            return await this._generateLinearRoute(route, src, dest, xMod, yMod);
        } else if (src.x != dest.x && src.y == dest.y) {
            src.x += GRID_SIZE * xMod;
            route.push({ x: src.x, y: src.y });
            return await this._generateLinearRoute(route, src, dest, xMod, yMod);
        }
        if (this.debug) console.log("Foundry-Patrol: Error in generating continuous route.");
    }

    _generateLinearPath(tokenId) {
        const result = [];
        const contRoutes = this.tokenMap[tokenId].countinousRoutes;
        const endRoutes = this.tokenMap[tokenId].endCountinousRoutes;

        Object.keys(contRoutes).forEach((key) => result.push(contRoutes[key]));
        Object.keys(endRoutes).forEach((key) => result.push(endRoutes[key]));

        this.tokenMap[tokenId].linearPath = result;
    }

    updateTokenRoute(tokenId, updateData) {
        if (this.tokenMap[tokenId]) {
            this.tokenMap[tokenId].plots.push(updateData);
        } else {
            this.tokenMap[tokenId] = this._defaultSchema();
            this.tokenMap[tokenId].plots.push(updateData);
        }
        this._saveAndUpdate(this.tokenMap);
    }

    generateTokenSchema(tokenId) {
        this.tokenMap[tokenId] = this._defaultSchema();
        this._saveAndUpdate(this.tokenMap);
        return this.tokenMap[tokenId];
    }

    _defaultSchema() {
        return {
            color: this._generateColor(),
            plots: [],
            linearPath: [],
            countinousRoutes: [],
            endCountinousRoutes: [],
            enabled: false,
            lastPos: 0,
            onInverseReturn: false,
            drawnPlots: [],
            isWalking: false,
            inverted: false,
            isLinear: false,
            lastRecordedLocation: {},
            delayPeriod: [2000],
            isDeleted: false,
            audioId: null,
            audioLocal: true,
            audioPath: null,
            audioVolume: null,
            audioRadius: null,
            tokenRotation: false,
            visionChecking: false,
            stopWhenSeen: false,
            createCombat: false,
            pauseGame: false,
            enableQuotes: false,
            patrolPercent: 25,
            patrolQuotes: [],
            catchQuotes: [],
            otherTokenVision: false,
            otherTokenVisionQuotes: [],
            language: "common",
        };
    }

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
            if (p1 && p2) this.tokenMap[tokenId].countinousRoutes.length -= this._adjustLength(p1, p2);
            await this.linearWalk(false, tokenId);
            await this.linearWalk(true, tokenId);
        }
        await this._saveAndUpdate(this.tokenMap);
        await this.livePlotUpdate(tokenId);
    }

    _adjustLength(p1, p2) {
        return Math.floor(Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) / gridSize());
    }

    async removeAllTokenRoutes() {
        await this._saveAndUpdate({});
        await this._removePlotDrawing(null);
    }

    _generateColor() {
        return Math.floor(Math.random() * 0xffffff);
    }

    deleteProcess(tokenId) {
        const deletePrompt = new Dialog({
            title: "Patrol Delete",
            content: "<p>What would you like to do with this token's route?</p>",
            buttons: {
                one: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Confirm: Yes, delete all",
                    callback: () => this.removeTokenRoute(tokenId, true),
                },
                two: {
                    icon: '<i class="fas fa-undo"></i>',
                    label: "Undo: Yes, but undo last",
                    callback: () => this.removeTokenRoute(tokenId, false),
                },
                three: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Reject: I do not want to delete",
                    callback: () => console.log("Foundry-Patrol: Mind changed, nothing deleted"),
                },
            },
            default: "three",
        });
        deletePrompt.render(true);
    }

    async deleteToken(tokenId) {
        if (!this.tokenMap[tokenId]) return;

        const audioId = this.tokenMap[tokenId].audioId;
        if (audioId) canvas.sounds.get(audioId)?.document.delete();

        delete this.tokenMap[tokenId];
        await this._removePlotDrawing(tokenId);
        await this._saveAndUpdate(this.tokenMap);
    }

    async deleteAmbientSound(tokenId) {
        if (!tokenId || !this.tokenMap[tokenId]) return;

        this.tokenMap[tokenId].audioId = null;
        this.tokenMap[tokenId].audioPath = null;
        this.tokenMap[tokenId].audioVolume = null;
        this.tokenMap[tokenId].audioRadius = null;

        await this._saveAndUpdate(this.tokenMap);
    }

    async livePlotUpdate(tokenId) {
        if (tokenId && !this.tokenMap[tokenId]) return;
        await this._removePlotDrawing(tokenId);
        if (tokenId) await this._displayPlot(tokenId, this.tokenMap[tokenId].inverted);
        await routesLayer()?.draw();
    }

    async _removePlotDrawing(tokenId) {
        const scene = canvas.scene;
        if (!scene) return;
        let routes = foundry.utils.duplicate(scene.getFlag(MODULE, "routes") ?? {});
        if (tokenId) delete routes[tokenId];
        else routes = {};
        await scene.setFlag(MODULE, "routes", routes);
    }

    async _displayPlot(tokenId, forwardsBackwards) {
        const scene = canvas.scene;
        const plots = this._getPlotsFromId(tokenId);
        if (!scene || !plots || plots.length == 0) return;

        const routes = foundry.utils.duplicate(scene.getFlag(MODULE, "routes") ?? {});
        routes[tokenId] = {
            points: plots,
            dash: 25,
            gap: 25,
            offset: 750,
            color: this._getGeneral(tokenId, "color"),
            fb: forwardsBackwards,
            tokenId: tokenId,
        };
        await scene.setFlag(MODULE, "routes", routes);
    }

    _getPlotsFromId(tokenId) {
        return this.tokenMap[tokenId]?.plots;
    }

    _getGeneral(tokenId, desiredProperty) {
        return this.tokenMap[tokenId]?.[desiredProperty];
    }

    _validatePatrol(token) {
        const patrolPoints = this._getPlotsFromId(token.id);
        if (!patrolPoints || patrolPoints.length <= 1) {
            return false;
        }
        return true;
    }

    _storeLastPlotTaken(plotNumber, token) {
        this.tokenMap[token.id].lastPos = plotNumber;
        this._saveAndUpdate(this.tokenMap);
    }

    _updatelastRecordedLocation(futurePlot, token) {
        const lastRecordedLocation = this.tokenMap[token.id].lastRecordedLocation;
        if (futurePlot != undefined) {
            lastRecordedLocation.x = futurePlot.x;
            lastRecordedLocation.y = futurePlot.y;
        } else {
            lastRecordedLocation.x = token.x;
            lastRecordedLocation.y = token.y;
        }
        this._saveAndUpdate(this.tokenMap);
    }

    _wasTokenMoved(token) {
        try {
            if (
                this.tokenMap[token.id].lastRecordedLocation.x != token.x ||
                this.tokenMap[token.id].lastRecordedLocation.y != token.y
            ) {
                this.tokenMap[token.id].isWalking = false;
                return true;
            }
            return false;
        } catch (error) {
            if (this.debug) console.log(`Foundry-Patrol: Error in validating patrol status -> \n ${error}`);
            return true;
        }
    }

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

    _setInverseReturn(token) {
        if (!this.tokenMap[token.id]) return;
        this.tokenMap[token.id].onInverseReturn = !this.tokenMap[token.id].onInverseReturn;
        this._saveAndUpdate(this.tokenMap);
    }

    _disableWalking(token) {
        if (!token || !this.tokenMap[token.id]) return;
        this.tokenMap[token.id].isWalking = false;
        this._saveAndUpdate(this.tokenMap);
    }

    async getDelayPeriod(tokenId) {
        if (!this.tokenMap[tokenId]) return;
        const patrolData = this.tokenMap[tokenId];
        const userDisplayDelay = [];
        for (let i = 0; i < patrolData.delayPeriod.length; ++i) {
            userDisplayDelay.push(patrolData.delayPeriod[i] / 1000);
        }
        return userDisplayDelay;
    }

    getLanguage(tokenId) {
        return this.tokenMap[tokenId]?.language;
    }

    getAudioPath(tokenId) {
        return this.tokenMap[tokenId]?.audioPath;
    }

    getPatrolPercent(tokenId) {
        return this.tokenMap[tokenId]?.patrolPercent;
    }

    getAudioLocal(tokenId) {
        return this.tokenMap[tokenId]?.audioLocal;
    }

    getAudioVolume(tokenId) {
        return this.tokenMap[tokenId]?.audioVolume;
    }

    getAudioRadius(tokenId) {
        return this.tokenMap[tokenId]?.audioRadius;
    }

    getAudioID(tokenId) {
        return this.tokenMap[tokenId]?.audioId;
    }

    getEnableQuotes(tokenId) {
        return this.tokenMap[tokenId]?.enableQuotes;
    }

    getVisionChecking(tokenId) {
        return this.tokenMap[tokenId]?.visionChecking;
    }

    getOtherVisionChecking(tokenId) {
        return this.tokenMap[tokenId]?.otherTokenVision;
    }

    getStopWhenSeen(tokenId) {
        return this.tokenMap[tokenId]?.stopWhenSeen;
    }

    getCreateCombat(tokenId) {
        return this.tokenMap[tokenId]?.createCombat;
    }

    getPauseGame(tokenId) {
        return this.tokenMap[tokenId]?.pauseGame;
    }

    getPatrolQuotes(tokenId) {
        return this.tokenMap[tokenId]?.patrolQuotes;
    }

    getCatchQuotes(tokenId) {
        return this.tokenMap[tokenId]?.catchQuotes;
    }

    getOtherTokenVisionQuotes(tokenId) {
        return this.tokenMap[tokenId]?.otherTokenVisionQuotes;
    }

    getTokenData(tokenId) {
        if (this.tokenMap[tokenId]) return this.tokenMap[tokenId];
        return this.generateTokenSchema(tokenId);
    }

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
}
