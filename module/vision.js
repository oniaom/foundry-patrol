import { TP } from "./tp.js";
import { gridSize } from "./util.js";

/**
 * Sight checks while patrolling: when the guard token's vision spots a player
 * token (or, optionally, another NPC), the configured reactions fire — stop the
 * patrol, pause the game, create a combat, and/or say a "caught" quote.
 */
export class VisionHandler {
    async evaluateSight(tokenId) {
        if (!TP.tokenPatroller.getVisionChecking(tokenId)) return;

        const guardToken = canvas.tokens.get(tokenId);
        if (!guardToken) return;

        this._handlePC(tokenId, guardToken);

        if (TP.tokenPatroller.getOtherVisionChecking(tokenId) && TP.tokenPatroller.getEnableQuotes(tokenId))
            this._handleNPC(tokenId, guardToken);
    }

    async _handlePC(tokenId, guardToken) {
        const spottedTokens = this._visitVisibleTokens(guardToken, this._determinePCTokens(tokenId), (playerToken) => {
            if (TP.tokenPatroller.getStopWhenSeen(tokenId)) TP.tokenPatroller.stopPatrol(tokenId);
            if (TP.tokenPatroller.getPauseGame(tokenId)) game.togglePause(true, true);
        });

        if (TP.tokenPatroller.getCreateCombat(tokenId) && spottedTokens.length > 0 && !game.combat) {
            const combat = await Combat.create({ scene: canvas.scene.id, active: true });
            const combatants = [{ token: tokenId, hidden: false }];
            for (const spotted of spottedTokens) combatants.push({ token: spotted.id, hidden: false });
            await combat.createEmbeddedDocuments("Combatant", combatants);
        }

        if (TP.tokenPatroller.getEnableQuotes(tokenId) && spottedTokens.length > 0)
            TP.speechHandler.handleSpeech(tokenId, "caught", spottedTokens);
    }

    async _handleNPC(tokenId, guardToken) {
        const spottedTokens = this._visitVisibleTokens(guardToken, this._determineNPCTokens(tokenId));
        if (spottedTokens.length > 0) TP.speechHandler.handleSpeech(tokenId, "other", spottedTokens);
    }

    /**
     * Runs `onSpotted` for every candidate token the guard can currently see
     * (check -> react, in candidate order) and returns the spotted tokens.
     */
    _visitVisibleTokens(guardToken, candidateIds, onSpotted) {
        const spotted = [];
        for (const id of candidateIds) {
            const token = canvas.tokens.get(id);
            if (!token) continue;
            if (this._checkVision(guardToken, token.center.x, token.center.y)) {
                spotted.push(token);
                onSpotted?.(token);
            }
        }
        return spotted;
    }

    /**
     * Checks whether the guard token can see the given point, using its own
     * vision source (field of view + wall-limited line of sight) when available
     * and a manual range/angle/wall check otherwise.
     */
    _checkVision(guardToken, x, y) {
        try {
            const source = guardToken.visionSource;
            if (source?.fov?.contains && source?.los?.contains) {
                return source.fov.contains(x, y) && source.los.contains(x, y);
            }
        } catch (err) {
            // Fall through to the manual check below.
        }

        const doc = guardToken.document;
        const sight = doc.sight ?? {};
        if (sight.enabled === false) return false;
        const center = guardToken.center;
        const dX = x - center.x;
        const dY = y - center.y;
        const rangePx = (sight.range ?? 0) * (gridSize() / (canvas.grid.distance || 1));
        if (Math.hypot(dX, dY) > rangePx) return false;
        const angle = sight.angle ?? 360;
        if (angle < 360) {
            let relative = (Math.atan2(dY, dX) * 180) / Math.PI - (doc.rotation ?? 0);
            relative = ((relative % 360) + 360) % 360;
            if (relative > 180) relative = 360 - relative;
            if (relative > angle / 2) return false;
        }
        const RayCtor = foundry.canvas.geometry.Ray ?? globalThis.Ray;
        if (!RayCtor) return true;
        const blocked = canvas.walls.checkCollision(new RayCtor(center, { x, y }), { mode: "any", type: "sight" });
        return !blocked;
    }

    /** Ids of tokens with an actor owned by a non-GM user (player characters). */
    _determinePCTokens(tokenId) {
        return this._actorTokens(tokenId, true);
    }

    /** Ids of tokens with an actor NOT owned by a non-GM user (NPCs). */
    _determineNPCTokens(tokenId) {
        return this._actorTokens(tokenId, false);
    }

    _actorTokens(excludeId, wantPC) {
        return canvas.tokens.placeables
            .filter((t) => t.id != excludeId && t.actor && this._ownerIsPC(t.actor) === wantPC)
            .map((t) => t.id);
    }

    _ownerIsPC(actor) {
        for (const user of game.users) {
            if (user.isGM) continue;
            if (actor.testUserPermission?.(user, "OWNER") ?? actor.hasPerm?.(user, "OWNER")) return true;
        }
        return false;
    }
}
