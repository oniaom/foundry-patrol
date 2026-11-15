import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { gridSize } from "./util.js";

function toVolume(value) {
    const n = Number(value);
    const input = Number.isFinite(n) ? Math.clamped(0, n, 1) : 0.5;
    const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    return helper?.inputToVolume ? helper.inputToVolume(input) : input;
}

function toRadius(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n * (canvas.grid.distance || 1);
}

export class AudioHandler {
    async createPatrolAudio(tokenId, file, audioLocal, radius, volume) {
        const token = canvas.tokens.get(tokenId);
        if (!token || !canvas.scene) return;
        const halfGrid = gridSize() / 2;
        try {
            const [sound] = await canvas.scene.createEmbeddedDocuments("AmbientSound", [
                {
                    x: token.x + halfGrid,
                    y: token.y + halfGrid,
                    path: file,
                    radius: toRadius(radius),
                    volume: toVolume(volume),
                    walls: !!audioLocal,
                    loop: true,
                    paused: false,
                    flags: { [MODULE]: { tokenId: tokenId } },
                },
            ]);
            return sound;
        } catch (err) {
            console.log("Foundry-Patrol: Error in creating audio", err);
        }
    }

    async updateAmbientPosition(x, y, ambientSoundId) {
        const sound = canvas.sounds.get(ambientSoundId);
        if (!sound) return;
        const halfGrid = gridSize() / 2;
        await sound.document.update({ x: x + halfGrid, y: y + halfGrid });
    }

    async updateAudioInfo(ambientSoundId, file, audioLocal, radius, volume) {
        const sound = canvas.sounds.get(ambientSoundId);
        if (!sound) return;
        await sound.document.update({
            path: file,
            walls: !!audioLocal,
            radius: toRadius(radius),
            volume: toVolume(volume),
        });
    }

    hasAudio(tokenId) {
        return TP.tokenPatroller._hasAudio(tokenId);
    }
}
