import { TP } from "./tp.js";
import { gridSize } from "./util.js";

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
        const playerTokens = this._determinePCTokens(tokenId);
        const spottedTokens = [];

        for (const id of playerTokens) {
            const playerToken = canvas.tokens.get(id);
            if (!playerToken) continue;

            if (this._checkVision(guardToken, playerToken.center.x, playerToken.center.y)) {
                spottedTokens.push(playerToken);
                if (TP.tokenPatroller.getStopWhenSeen(tokenId)) TP.tokenPatroller.stopPatrol(tokenId);
                if (TP.tokenPatroller.getPauseGame(tokenId)) game.togglePause(true, true);
            }
        }

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
        const npcTokens = this._determineNPCTokens(tokenId);
        const spottedTokens = [];

        for (const id of npcTokens) {
            const npcToken = canvas.tokens.get(id);
            if (npcToken && this._checkVision(guardToken, npcToken.center.x, npcToken.center.y)) {
                spottedTokens.push(npcToken);
            }
        }
        if (spottedTokens.length > 0) TP.speechHandler.handleSpeech(tokenId, "other", spottedTokens);
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

    _determinePCTokens(tokenId) {
        return canvas.tokens.placeables.filter((t) => t.id != tokenId && t.actor && this._ownerIsPC(t.actor)).map((t) => t.id);
    }

    _determineNPCTokens(tokenId) {
        return canvas.tokens.placeables.filter((t) => t.id != tokenId && t.actor && !this._ownerIsPC(t.actor)).map((t) => t.id);
    }

    _ownerIsPC(actor) {
        for (const user of game.users) {
            if (user.isGM) continue;
            if (actor.testUserPermission?.(user, "OWNER") ?? actor.hasPerm?.(user, "OWNER")) return true;
        }
        return false;
    }
}
