import { MODULE } from "./config.js";

/**
 * Persists the patrol data (routes, settings per token) in the viewed scene's
 * module flags instead of a journal entry file. Scene flags are namespaced,
 * JSON-serializable and automatically cleaned up when the scene is deleted.
 */
export class PatrolDataManager {
    get scene() {
        return canvas?.scene ?? null;
    }

    async dataInit() {
        return foundry.utils.duplicate(this.scene?.getFlag(MODULE, "patrols") ?? {});
    }

    async getMap() {
        return foundry.utils.duplicate(this.scene?.getFlag(MODULE, "patrols") ?? {});
    }

    async saveMap(data) {
        if (!this.scene) return;
        await this.scene.setFlag(MODULE, "patrols", data);
    }
}
