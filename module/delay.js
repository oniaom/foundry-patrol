/**
 * Delay-period conversion. The user enters per-point delays in SECONDS as a
 * string (e.g. "2", "2,4,12", "2-4"); internally they are stored as an array of
 * MILLISECONDS (one entry per plot point). This module owns all parsing and
 * formatting of that format in both directions, so the HUD delay field, the
 * menu form and the patrol loop all agree on it.
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
 * @param {string|number|null} input raw user input
 * @param {boolean} [debug] log the parsed values
 * @returns {number[]|undefined} delays in milliseconds, or undefined for invalid input
 */
export function normalizeDelayInput(input, debug = false) {
    if (input == null || input === "") return undefined;
    let delay = String(input);
    if (/[^0-9\-,\s]/.test(delay)) return undefined;

    delay = parseDelayValues(delay, debug);
    if (!delay || delay.length == 0) return undefined;
    try {
        for (let i = 0; i < delay.length; ++i) {
            // Values <= 0 are invalid; flip them and fall back to the default seconds.
            if (delay[i] <= INVALID_NUMBER) delay[i] = delay[i] * -1 + DEFAULT_SECONDS;
            delay[i] = delay[i] * MILLISECONDS;
        }
    } catch (error) {
        return undefined;
    }
    return delay;
}

/**
 * Parses the string to generate a valid array of ints.
 * Excess commas are ignored.
 * @param {string} delay
 * @param {boolean} [debug]
 */
export function parseDelayValues(delay, debug = false) {
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
    if (debug) console.log(`Foundry-Patrol: Wait periods include: ${delay}`);
    return delay;
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
