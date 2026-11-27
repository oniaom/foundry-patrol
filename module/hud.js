import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { PatrolMenu } from "./menu.js";
import { isSquareGrid } from "./util.js";
import { normalizeDelayInput, isRangeExpansion } from "./delay.js";

/** Builds one HUD control icon (a div.control-icon wrapping an img/i element). */
function makeIconButton(innerHtml, title) {
    const el = document.createElement("div");
    el.classList.add("control-icon");
    el.style.marginLeft = "4px";
    el.innerHTML = innerHtml;
    const img = el.querySelector("img, i");
    if (img && title) img.title = title;
    return el;
}

/** Builds a flex row container holding a group of HUD buttons. */
function makeButtonRow(className, ...children) {
    const row = document.createElement("div");
    row.classList.add(className);
    Object.assign(row.style, {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        marginRight: "75px",
    });
    row.append(...children);
    return row;
}

/**
 * Flips a HUD toggle button between its active/inactive look: swaps the icon
 * classes (and the img src for image icons) and updates the button title.
 * @returns {boolean} the NEW state of `activeClass` on the icon.
 */
function flipIconToggle(ev, { activeClass, inactiveClass, activeSrc, inactiveSrc, activeTitle, inactiveTitle }) {
    const button = ev.currentTarget;
    const icon = button.querySelector("img, i");
    const wasActive = icon.classList.contains(activeClass);
    if (activeSrc && inactiveSrc) icon.src = wasActive ? inactiveSrc : activeSrc;
    icon.classList.toggle(activeClass, !wasActive);
    icon.classList.toggle(inactiveClass, wasActive);
    if (activeTitle !== undefined && inactiveTitle !== undefined) {
        button.title = wasActive ? inactiveTitle : activeTitle;
    }
    return !wasActive;
}

export class TokenHud {
    static async HUD(token, html, data) {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || !token) return;

        const tokenId = token.id;
        const tokenMap = (await TP.patrolDataManager?.getPatrols()) ?? {};
        const patrolData = tokenMap[tokenId];
        let isPatrolling = false;
        let isLinear = false;
        let isInverted = false;
        let delayPeriod = "2";
        if (patrolData) {
            isPatrolling = !!patrolData.isWalking;
            isLinear = !!patrolData.isLinear;
            isInverted = !!patrolData.inverted;
            const delays = await TP.tokenPatroller?.getDelayPeriod(tokenId);
            if (delays && delays.length > 0) {
                // A randomized range pool is shown back as its "min-max" range.
                delayPeriod =
                    patrolData.randomDelay && isRangeExpansion(patrolData.delayPeriod ?? [])
                        ? `${delays[0]}-${delays[delays.length - 1]}`
                        : delays.join(",");
            }
        }

        const left = root.querySelector(".col.left") ?? root.querySelector(".left");
        const right = root.querySelector(".col.right") ?? root.querySelector(".right");
        if (!left || !right) return;

        const svg = (name) => `modules/${MODULE}/imgs/svg/${name}`;

        const addPlotPoint = makeIconButton(`<img src="${svg("map.svg")}" width="36" height="36">`, "Add Point (records the token's current position)");
        const deletePlotPoint = makeIconButton(`<i class="fas fa-trash-alt"></i>`, "Delete points (all, or last)");
        const plotDirection = isInverted
            ? makeIconButton(`<i class="fas fa-arrows-alt-h"></i>`, "Forwards-Backwards Mode")
            : makeIconButton(`<i class="fas fa-recycle"></i>`, "Cycle Mode");
        const linearWalkHUD = isLinear
            ? makeIconButton(`<img class="linear-active" src="${svg("linear.svg")}" width="36" height="36">`, "Linear Walk")
            : makeIconButton(`<img class="linear-inactive" src="${svg("line.svg")}" width="36" height="36">`, "Plot Walk");
        const patrolWalkHUD = isPatrolling
            ? makeIconButton(`<i class="fas fa-times"></i>`, "Stop route")
            : makeIconButton(`<i class="fas fa-walking"></i>`, "Start route");

        const patrolDelayHUD = document.createElement("input");
        patrolDelayHUD.classList.add("control-icon");
        patrolDelayHUD.style.marginLeft = "4px";
        patrolDelayHUD.type = "text";
        patrolDelayHUD.id = "patrolWait";
        patrolDelayHUD.value = delayPeriod;
        patrolDelayHUD.title = "Delay period (seconds, dot decimals e.g. 1.5)";
        // Clicking out of the field with invalid input (letters, a second dot,
        // empty) reverts to the previously shown value. Commas stay list
        // separators, so decimals must use a dot.
        patrolDelayHUD.addEventListener("change", () => {
            if (normalizeDelayInput(patrolDelayHUD.value) === undefined) patrolDelayHUD.value = delayPeriod;
        });

        const patrolMenu = makeIconButton(`<i class="fas fa-caret-down"></i>`, "Patrol Menu");

        const plotDiv = makeButtonRow("plotDiv", addPlotPoint, deletePlotPoint, plotDirection);
        const patrolDiv = makeButtonRow("patrolDiv", linearWalkHUD, patrolWalkHUD, patrolDelayHUD);

        if (TP.tokenPatroller && (game.user.isGM || game.settings.get(MODULE, "enablePlayerPatrol"))) {
            if (!game.settings.get(MODULE, "disableHUD")) {
                left.append(plotDiv, patrolDiv);
            }
            right.append(patrolMenu);

            // Each HUD button and the action it triggers; bound in one loop below.
            const actions = [
                { el: addPlotPoint, onClick: () => TP.tokenPatroller?.addPlotPoint(tokenId) },
                { el: deletePlotPoint, onClick: () => TP.tokenPatroller?.deleteProcess(tokenId) },
                {
                    el: linearWalkHUD,
                    onClick: (ev) => {
                        if (!isSquareGrid()) {
                            ui.notifications.error("Linear path can only be used on square based maps.");
                            return;
                        }
                        flipIconToggle(ev, {
                            activeClass: "linear-active",
                            inactiveClass: "linear-inactive",
                            activeSrc: svg("linear.svg"),
                            inactiveSrc: svg("line.svg"),
                        });
                        if (patrolData) TP.tokenPatroller?._setLinear(tokenId);
                    },
                },
                {
                    el: plotDirection,
                    onClick: (ev) => {
                        flipIconToggle(ev, {
                            activeClass: "fa-arrows-alt-h",
                            inactiveClass: "fa-recycle",
                            activeTitle: "Forwards-Backwards Mode",
                            inactiveTitle: "Cycle Mode",
                        });
                        if (patrolData) TP.tokenPatroller?._setInverse(tokenId);
                    },
                },
                {
                    el: patrolWalkHUD,
                    onClick: (ev) => {
                        const starting = flipIconToggle(ev, {
                            activeClass: "fa-times",
                            inactiveClass: "fa-walking",
                            activeTitle: "Stop route",
                            inactiveTitle: "Start route",
                        });
                        if (starting) {
                            TP.tokenPatroller?.startPatrol(patrolDelayHUD.value, tokenId);
                        } else {
                            TP.tokenPatroller?.stopPatrol(tokenId);
                        }
                    },
                },
                { el: patrolMenu, onClick: () => new PatrolMenu(tokenId).render(true) },
            ];
            for (const { el, onClick } of actions) el.addEventListener("click", onClick);
        }
    }
}
