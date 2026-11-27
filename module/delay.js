/**
 * Delay-period conversion. The user enters per-point delays in SECONDS as a
 * string (e.g. "2", "1.5", "2,4,12", "2-4"); internally they are stored as an
 * array of MILLISECONDS (one entry per plot point). This module owns all parsing
 * and formatting of that format in both directions, so the HUD delay field, the
 * menu form and the patrol loop all agree on it.
 *
 * Decimals use a DOT ("1.5" = 1.5 seconds). Commas are always the list separator
 * ("1,5" = the two delays 1s and 5s), never a decimal separator.
 */

const MILLISECONDS = 1000;
const DEFAULT_SECONDS = 2;
const INVALID_NUMBER = 0;

/**
 * Parses a user-entered delay string into an array of millisecond delays.
 * Returns undefined when the input is empty or contains invalid characters.
 * Non-positive values are treated as "use the default" (see below).
 *
 * Acceptable: [1-5] --> 1,2,3,4,5
 * Acceptable: 1,2,3,4,5 --> 1,2,3,4,5
 * Acceptable: [1-5],6,7 --> 1,2,3,4,5,6,7
 * Acceptable: 1.5 --> 1.5 (dot decimals; "1.5,2.5" --> 1.5,2.5)
 * @param {string|number|null} input raw user input
 * @param {boolean} [debug] log the parsed values
 * @returns {number[]|undefined} delays in milliseconds, or undefined for invalid input
 */
export function normalizeDelayInput(input, debug = false) {
    if (input == null || input === "") return undefined;
    let delay = String(input);
    if (/[^0-9.,\-\s]/.test(delay)) return undefined;

    delay = parseDelayValues(delay, debug);
    if (!delay || delay.length == 0) return undefined;
    try {
        for (let i = 0; i < delay.length; ++i) {
            // Values <= 0 are invalid; flip them and fall back to the default seconds.
            if (delay[i] <= INVALID_NUMBER) delay[i] = delay[i] * -1 + DEFAULT_SECONDS;
            // Round to whole milliseconds so float artifacts (e.g. 1.1 * 1000) never
            // leak into the stored delayPeriod or the HUD/menu display.
            delay[i] = Math.round(delay[i] * MILLISECONDS);
        }
    } catch (error) {
        return undefined;
    }
    return delay;
}

// One number per comma-separated part: an int or a dot-decimal float ("2", "1.5").
const NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;
// A range part ("2-4", "1.5-3"); expanded with step 1 starting at the start value.
const RANGE_PATTERN = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;

/**
 * Parses the string to generate a valid array of numbers (ints or floats).
 * Excess commas are ignored. A malformed part (e.g. "1.2.3", "2-") makes the
 * whole input invalid: an empty array is returned, which the caller treats as
 * invalid input.
 * @param {string} delay
 * @param {boolean} [debug]
 */
export function parseDelayValues(delay, debug = false) {
    delay = delay.replace(/\s/g, "");
    if (delay.length == 0) return [DEFAULT_SECONDS];
    const values = [];
    for (const part of delay.split(",")) {
        if (part.length == 0) continue; // excess commas are ignored
        const range = part.match(RANGE_PATTERN);
        if (range) {
            const start = parseFloat(range[1]);
            const end = parseFloat(range[2]);
            const steps = Math.floor(end - start + 1e-9);
            for (let i = 0; i <= steps; i++) values.push(start + i);
            continue;
        }
        if (!NUMBER_PATTERN.test(part)) return [];
        values.push(parseFloat(part));
    }
    if (debug) console.log(`Foundry-Patrol: Wait periods include: ${values}`);
    return values;
}

/** Converts stored millisecond delays to seconds (shown in the HUD delay field). */
export function delayToSeconds(delayPeriod) {
    const seconds = [];
    for (let i = 0; i < delayPeriod.length; ++i) {
        seconds.push(delayPeriod[i] / 1000);
    }
    return seconds;
}

/** Formats stored millisecond delays as the quoted string shown in the menu form. */
export function formatDelayForForm(delayPeriod) {
    if (!delayPeriod || delayPeriod.length <= 0) return null;
    let string = '"';
    delayPeriod.forEach((delay) => {
        string = string + delay / 1000 + ",";
    });
    return string.slice(0, -1) + '"';
}
