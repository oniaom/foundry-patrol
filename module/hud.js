import { MODULE } from "./config.js";
import { TP } from "./tp.js";
import { PatrolMenu } from "./menu.js";

export class TokenHud {
    static async HUD(token, html, data) {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || !token) return;

        const tokenId = token.id;
        const tokenMap = (await TP.patrolDataManager?.getMap()) ?? {};
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
            if (delays && delays.length > 0) delayPeriod = delays.join(",");
        }

        const left = root.querySelector(".col.left") ?? root.querySelector(".left");
        const right = root.querySelector(".col.right") ?? root.querySelector(".right");
        if (!left || !right) return;

        const iconDiv = (inner, title) => {
            const el = document.createElement("div");
            el.classList.add("control-icon");
            el.style.marginLeft = "4px";
            el.innerHTML = inner;
            const img = el.querySelector("img, i");
            if (img && title) img.title = title;
            return el;
        };

        const addPlotPoint = iconDiv(`<img src="modules/${MODULE}/imgs/svg/map.svg" width="36" height="36">`, "Add Point (records the token's current position)");
        const deletePlotPoint = iconDiv(`<i class="fas fa-trash-alt"></i>`, "Delete points (all, or last)");
        const plotDirection = isInverted
            ? iconDiv(`<i class="fas fa-arrows-alt-h"></i>`, "Forwards-Backwards Mode")
            : iconDiv(`<i class="fas fa-recycle"></i>`, "Cycle Mode");
        const linearWalkHUD = isLinear
            ? iconDiv(`<img class="linear-active" src="modules/${MODULE}/imgs/svg/linear.svg" width="36" height="36">`, "Linear Walk")
            : iconDiv(`<img class="linear-inactive" src="modules/${MODULE}/imgs/svg/line.svg" width="36" height="36">`, "Plot Walk");
        const patrolWalkHUD = isPatrolling
            ? iconDiv(`<i class="fas fa-times"></i>`, "Stop route")
            : iconDiv(`<i class="fas fa-walking"></i>`, "Start route");

        const patrolDelayHUD = document.createElement("input");
        patrolDelayHUD.classList.add("control-icon");
        patrolDelayHUD.style.marginLeft = "4px";
        patrolDelayHUD.type = "text";
        patrolDelayHUD.id = "patrolWait";
        patrolDelayHUD.value = delayPeriod;
        patrolDelayHUD.title = "Delay period";

        const patrolMenu = iconDiv(`<i class="fas fa-caret-down"></i>`, "Patrol Menu");

        const plotDiv = document.createElement("div");
        plotDiv.classList.add("plotDiv");
        Object.assign(plotDiv.style, {
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            marginRight: "75px",
        });
        plotDiv.append(addPlotPoint, deletePlotPoint, plotDirection);

        const patrolDiv = document.createElement("div");
        patrolDiv.classList.add("patrolDiv");
        Object.assign(patrolDiv.style, {
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            marginRight: "75px",
        });
        patrolDiv.append(linearWalkHUD, patrolWalkHUD, patrolDelayHUD);

        if (TP.tokenPatroller && (game.user.isGM || game.settings.get(MODULE, "enablePlayerPatrol"))) {
            if (!game.settings.get(MODULE, "disableHUD")) {
                left.append(plotDiv, patrolDiv);
            }
            right.append(patrolMenu);

            addPlotPoint.addEventListener("click", () => {
                TP.tokenPatroller?.addPlotPoint(tokenId);
            });

            deletePlotPoint.addEventListener("click", () => {
                TP.tokenPatroller?.deleteProcess(tokenId);
            });

            linearWalkHUD.addEventListener("click", (ev) => {
                if (canvas.grid.type != CONST.GRID_TYPES.SQUARE) {
                    ui.notifications.error("Linear path can only be used on square based maps.");
                    return;
                }
                const img = ev.currentTarget.querySelector("img");
                const active = img.classList.contains("linear-active");
                img.src = active
                    ? `modules/${MODULE}/imgs/svg/line.svg`
                    : `modules/${MODULE}/imgs/svg/linear.svg`;
                img.classList.toggle("linear-active", !active);
                img.classList.toggle("linear-inactive", active);
                if (patrolData) TP.tokenPatroller?._setLinear(tokenId);
            });

            plotDirection.addEventListener("click", (ev) => {
                const icon = ev.currentTarget.querySelector("i");
                const backwards = icon.classList.contains("fa-arrows-alt-h");
                icon.classList.toggle("fa-arrows-alt-h", !backwards);
                icon.classList.toggle("fa-recycle", backwards);
                ev.currentTarget.title = backwards ? "Cycle Mode" : "Forwards-Backwards Mode";
                if (patrolData) TP.tokenPatroller?._setInverse(tokenId);
            });

            patrolWalkHUD.addEventListener("click", (ev) => {
                const icon = ev.currentTarget.querySelector("i");
                const starting = icon.classList.contains("fa-walking");
                icon.classList.toggle("fa-walking", !starting);
                icon.classList.toggle("fa-times", starting);
                ev.currentTarget.title = starting ? "Stop route" : "Start route";
                if (starting) {
                    TP.tokenPatroller?.startPatrol(patrolDelayHUD.value, tokenId);
                } else {
                    TP.tokenPatroller?.stopPatrol(tokenId);
                }
            });

            patrolMenu.addEventListener("click", () => {
                new PatrolMenu(tokenId).render(true);
            });
        }
    }
}
