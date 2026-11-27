import { MODULE } from "./config.js";
import { TP } from "./tp.js";

// v13+ namespaced document class — the bare `ChatMessage` global is deprecated
// since v13 (removal in v15), so prefer foundry.documents and only fall back.
const ChatMessage = foundry.documents?.BaseChatMessage ?? globalThis.ChatMessage;

/** Which per-token quote list each speech type draws from (methods on TP.tokenPatroller). */
const QUOTE_GETTERS = {
    patrol: "getPatrolQuotes",
    caught: "getCatchQuotes",
    other: "getOtherTokenVisionQuotes",
};

/**
 * Chat quotes while patrolling / when spotted. Messages are IC ChatMessages
 * with Polyglot language flags when the Polyglot module is active; `{token.name}`
 * in a quote is replaced with the first spotted token's name.
 */
export class SpeechHandler {
    async createChat(tokenId, message) {
        if (message == undefined) return;
        const token = canvas.tokens.get(tokenId);
        if (!token) return;

        const tokenLanguage = TP.tokenPatroller.getLanguage(tokenId) || "common";
        const speaker = ChatMessage.getSpeaker({ scene: canvas.scene, actor: token.actor, token: token.document });
        const flags = { [MODULE]: { language: tokenLanguage } };
        if (game.modules.get("polyglot")?.active) flags.polyglot = { language: tokenLanguage, skip: true };

        await ChatMessage.create({
            speaker: speaker,
            user: game.userId,
            content: message,
            type: CONST.CHAT_MESSAGE_TYPES.IC,
            flags: flags,
        });
    }

    async handleSpeech(tokenId, type, spottedTokens = []) {
        if (!TP.tokenPatroller.getEnableQuotes(tokenId)) return;
        const getter = QUOTE_GETTERS[type];
        if (!getter) return;
        let messages;
        if (type === "patrol") {
            if (this._determineIfPatrolDisplay(tokenId)) messages = TP.tokenPatroller[getter](tokenId);
        } else {
            messages = TP.tokenPatroller[getter](tokenId);
        }

        if (!messages || messages.length <= 0) return;

        let message = messages[Math.floor(Math.random() * messages.length)];

        if (spottedTokens.length > 0) {
            message = this._parseTokenName(message, spottedTokens[0].name);
        }

        this.createChat(tokenId, message);
    }

    /** Patrol quotes only fire on a percent roll (patrolPercent), 0-100. */
    _determineIfPatrolDisplay(tokenId) {
        const percentChance = TP.tokenPatroller.getPatrolPercent(tokenId) ?? 0;
        const percentRoll = Math.random();
        if (percentChance >= 100) return true;
        else if (percentChance <= 0) return false;
        else if (percentRoll <= percentChance / 100) return true;
        return false;
    }

    _parseTokenName(quote, replacement) {
        const regex = /{\s*token.name\s*}/gm;
        return quote.replace(regex, replacement);
    }
}
