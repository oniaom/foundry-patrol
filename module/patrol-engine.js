import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { isSquareGrid, sleep } from "./util.js";
import { pickDelayPeriod } from "./delay.js";

/**
 * PatrolEngine — the walking loop and nothing else. Given a token and its live
 * patrol-data entry it walks the plotted points (per-point delays, optional
 * rotation toward the movement direction, speech/vision/audio reactions on every
 * step) until the patrol is stopped. It never touches scene flags or the
 * tokenMap structure directly: data reads go through the injected
 * `getData`/`hasData` accessors and persistence through `persist`, both provided
 * by TokenPatrollerManager.
 */
export class PatrolEngine {
    constructor({ getData, hasData, persist, isDebug }) {
        this.getData = getData;
        this.hasData = hasData;
        this.persist = persist;
        this.isDebug = isDebug ?? (() => false);
    }

    /** Starts (or resumes) walking the token's route; resolves when the patrol ends. */
    async start(token) {
        const patrolData = this.getData(token.id);
        if (!patrolData) return;

        this._updateLastRecordedLocation(undefined, token);
        if (patrolData.isWalking) return;
        patrolData.isWalking = true;
        let cycle = this.getData(token.id).inverted == false ? 1 : 0;
        try {
            while (patrolData.isWalking && this._validatePatrol(token)) {
                await this.persist();
                const result = await this._navigationCycle(cycle, token);
                if (result) return;
                cycle = this.getData(token.id).inverted == false ? 1 : 0;
            }
            this.disableWalking(token);
        } catch (e) {
            console.log(`Foundry-Patrol: Unexpected error in patrol (was a token deleted during movement?):\n${e}\n${e.stack}`);
        }
    }

    /** Stops the token's patrol and persists the flag. */
    async stop(tokenId) {
        const patrolData = this.getData(tokenId);
        if (!patrolData) return;
        patrolData.isWalking = false;
        await this.persist();
    }

    /** Stops the patrol with a fire-and-forget save (used by keybindings). */
    disableWalking(token) {
        if (!token || !this.hasData(token.id)) return;
        this.getData(token.id).isWalking = false;
        this.persist();
    }

    /**
     * One full navigation cycle: walk the points forwards, then walk them back
     * down to the start (the return leg only runs when onInverseReturn/inverted).
     */
    async _navigationCycle(cycle, token) {
        const patrolData = this.getData(token.id);
        if (!patrolData) return;
        let patrolPoints = patrolData.plots;

        if (patrolData.isLinear && isSquareGrid()) {
            patrolPoints = patrolData.inverted ? patrolData.countinousRoutes : patrolData.linearPath;
        }

        let lastPos = await this._determineLastPosition(cycle, patrolPoints, token);
        let forceReturn = await this._navigationLoop({
            points: patrolPoints,
            iterator: lastPos,
            limit: patrolPoints.length, // forward leg: while iterator < points.length
            compare: (a, b) => a < b,
            onReturn: false,
            increment: 1,
            token,
        });
        if (forceReturn) return;
        lastPos = await this._determineLastPosition(cycle, patrolPoints, token);
        forceReturn = await this._navigationLoop({
            points: patrolPoints,
            iterator: lastPos - 1,
            limit: 0, // return leg: while iterator >= 0
            compare: (a, b) => a >= b,
            onReturn: true,
            increment: -1,
            token,
        });
        if (forceReturn) return;
    }

    /**
     * Walks `points` from `iterator` while `compare(iterator, limit)` holds,
     * stepping by `increment`. Returns true to force the caller to abort the
     * patrol (token moved manually, deleted, invalidated, ...).
     */
    async _navigationLoop({ points, iterator, limit, compare, onReturn, increment, token }) {
        const patrolData = this.getData(token.id);
        if (!patrolData) return;
        if (patrolData.onInverseReturn == onReturn) {
            for (iterator; compare(iterator, limit); iterator = iterator + increment) {
                if (!patrolData.isWalking) return true;
                const combatStarted = game.settings.get(MODULE, "combatPause");
                if (game.settings.get(MODULE, "tokenRotation") || this.getData(token.id).tokenRotation) {
                    const dX = points[iterator].x - patrolData.lastRecordedLocation.x;
                    const dY = points[iterator].y - patrolData.lastRecordedLocation.y;
                    this.rotateToken(dX, dY, token);
                }

                // Per-point delay when the pool matches the point count — unless the
                // pool is a randomized range ("1-3"), which picks a random value per step.
                await sleep(pickDelayPeriod(patrolData.delayPeriod, patrolData.randomDelay, iterator, points.length));
                if (!this.hasData(token.id)) return;

                if (
                    patrolData.isWalking &&
                    !game.paused &&
                    !(combatStarted && game.combat?.started) &&
                    !this._wasTokenMoved(token) &&
                    this._validatePatrol(token) &&
                    !patrolData.isDeleted
                ) {
                    await this._navigateToNextPoint(points[iterator], token);
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

    /** Waits for the token's movement animation, capped so a stuck animation can't hang the patrol. */
    async _ensureAnimationCompletion(token) {
        try {
            const promise = token.movementAnimationPromise;
            if (promise) await Promise.race([promise, new Promise((r) => setTimeout(r, 15000))]);
        } catch (err) {
            if (this.isDebug()) console.log(`Foundry-Patrol: Error waiting for movement animation\n${err}`);
        }
    }

    async _determineLastPosition(cycle, plots, token) {
        const patrolData = this.getData(token.id);
        const lastPos = patrolData.lastPos;
        // NOTE: reads the legacy `isInverted` field (never set; the schema uses
        // `inverted`), so this branch is always taken. Kept for behavior parity.
        if (!patrolData.isInverted) {
            if (cycle != 0 && lastPos == plots.length - 1) {
                return 0;
            }
            return lastPos;
        }
        return lastPos;
    }

    /** Moves the token to the given plot point and follows it with the ambient sound. */
    async _navigateToNextPoint(plot, token) {
        try {
            const patrolData = this.getData(token.id);
            if (patrolData?.audioId != null) {
                await TP.audioHandler.updateAmbientPosition(plot.x, plot.y, patrolData.audioId);
            }

            await token.document.update({ x: plot.x, y: plot.y });

            this._updateLastRecordedLocation(plot, token);
        } catch (error) {
            if (this.isDebug()) console.log(`Foundry-Patrol: Error in token navigation\n${error}`);
        }
    }

    /** Rotates the token to face the direction it is moving in. */
    rotateToken(dX, dY, token) {
        if (dX == 0 && dY == 0) return;
        const rotation = (Math.atan2(dY, dX) * 180) / Math.PI;
        token.document.update({ rotation: ((rotation % 360) + 360) % 360 });
    }

    /** True when the token no longer sits where the patrol last put it (moved manually). */
    _wasTokenMoved(token) {
        try {
            const patrolData = this.getData(token.id);
            if (
                patrolData.lastRecordedLocation.x != token.x ||
                patrolData.lastRecordedLocation.y != token.y
            ) {
                patrolData.isWalking = false;
                return true;
            }
            return false;
        } catch (error) {
            if (this.isDebug()) console.log(`Foundry-Patrol: Error in validating patrol status -> \n ${error}`);
            return true;
        }
    }

    /** A patrol needs at least two plot points to walk. */
    _validatePatrol(token) {
        const patrolPoints = this.getData(token.id)?.plots;
        if (!patrolPoints || patrolPoints.length <= 1) {
            return false;
        }
        return true;
    }

    _storeLastPlotTaken(plotNumber, token) {
        this.getData(token.id).lastPos = plotNumber;
        this.persist();
    }

    /** Remembers where the patrol last placed the token (used for move detection + rotation). */
    _updateLastRecordedLocation(futurePlot, token) {
        const lastRecordedLocation = this.getData(token.id).lastRecordedLocation;
        if (futurePlot != undefined) {
            lastRecordedLocation.x = futurePlot.x;
            lastRecordedLocation.y = futurePlot.y;
        } else {
            lastRecordedLocation.x = token.x;
            lastRecordedLocation.y = token.y;
        }
        this.persist();
    }

    _setInverseReturn(token) {
        const patrolData = this.getData(token.id);
        if (!patrolData) return;
        patrolData.onInverseReturn = !patrolData.onInverseReturn;
        this.persist();
    }
}
