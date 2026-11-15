import { MODULE } from "./config.js";

/**
 * Scene-flag keys owned by this module. Every read/write of these flags goes
 * through PatrolDataManager, so the flag names live in exactly one place.
 */
export const FLAGS = {
    PATROLS: "patrols", // source of truth: the whole per-token patrol tokenMap
    ROUTES: "routes", // render cache of plotted points, consumed by RoutesLayer
};

/**
 * Single owner of the module's persistent storage. Everything lives in the
 * viewed scene's module flags instead of a journal entry file: scene flags are
 * namespaced, JSON-serializable and automatically cleaned up when the scene is
 * deleted.
 */
export class PatrolDataManager {
    get scene() {
        return canvas?.scene ?? null;
    }

    /** Loads the whole patrol tokenMap from the scene flag (returns a deep copy). */
    async getPatrols() {
        return foundry.utils.duplicate(this.scene?.getFlag(MODULE, FLAGS.PATROLS) ?? {});
    }

    /** Persists the whole patrol tokenMap into the scene flag. */
    async savePatrols(tokenMap) {
        if (!this.scene) return;
        await this.scene.setFlag(MODULE, FLAGS.PATROLS, tokenMap);
    }

    /** Loads the routes render cache from the scene flag (returns a deep copy). */
    async getRoutes() {
        return foundry.utils.duplicate(this.scene?.getFlag(MODULE, FLAGS.ROUTES) ?? {});
    }

    /** Persists the routes render cache into the scene flag. */
    async saveRoutes(routes) {
        if (!this.scene) return;
        await this.scene.setFlag(MODULE, FLAGS.ROUTES, routes);
    }
}
