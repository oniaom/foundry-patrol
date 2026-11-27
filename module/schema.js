/** Random route color for a new patrol entry. */
export function randomColor() {
    return Math.floor(Math.random() * 0xffffff);
}

/**
 * Default per-token patrol data schema (one entry per tokenId inside the
 * "patrols" scene flag). `plots` holds `{x, y}` coordinates of the top-left
 * corner of the grid cell the point sits in.
 */
export function createDefaultPatrolData() {
    return {
        color: randomColor(),
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
        randomDelay: false, // true when delayPeriod is a randomized range pool (input contained a range like "1-3")
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
