import { UPGRADE_IDS, UPGRADES, upgradeCost, type UpgradeId } from "../data/upgrades.ts";
import type { Command, GameState } from "../sim/types.ts";
import { requireElement, setText } from "./dom.ts";

interface UpgradeRow {
  id: UpgradeId;
  level: HTMLElement;
  buyButton: HTMLButtonElement;
}

/** The coop's upgrade shop. Rows are built once; each frame only rewrites text and button state. */
export class UpgradesPanel {
  private readonly rows: UpgradeRow[];

  constructor(enqueue: (command: Command) => void) {
    const list = requireElement("upgrade-list", HTMLOListElement);
    this.rows = UPGRADE_IDS.map((id) => {
      const upgrade = UPGRADES[id];
      const item = document.createElement("li");
      item.className = "upgrade";
      const name = document.createElement("span");
      name.className = "upgrade-name";
      name.textContent = upgrade.name;
      const level = document.createElement("span");
      level.className = "upgrade-level";
      const effect = document.createElement("span");
      effect.className = "upgrade-effect";
      effect.textContent = upgrade.effect;
      const buyButton = document.createElement("button");
      buyButton.type = "button";
      buyButton.addEventListener("click", () => enqueue({ type: "buyUpgrade", upgrade: id }));
      item.append(name, level, effect, buyButton);
      list.append(item);
      return { id, level, buyButton };
    });
  }

  update(state: GameState): void {
    for (const row of this.rows) {
      const upgrade = UPGRADES[row.id];
      const level = state.upgradeLevels[row.id];
      const maxed = upgrade.maxLevel !== null && level >= upgrade.maxLevel;
      const cost = upgradeCost(upgrade, level);
      setText(row.level, `Lv ${level}`);
      setText(row.buyButton, maxed ? "MAX" : `BUY ${cost}`);
      row.buyButton.disabled = maxed || state.bankedGold < cost;
    }
  }
}
