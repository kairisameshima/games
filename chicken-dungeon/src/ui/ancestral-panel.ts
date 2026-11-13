import {
  ANCESTRAL_NODE_IDS,
  ANCESTRAL_NODES,
  ancestralNodeCost,
  bloodlineMultiplier,
  VOLUNTARY_RITE_MIN_DEPTH,
  type AncestralNodeId,
} from "../data/ancestry.ts";
import { canPerformRite } from "../sim/prestige.ts";
import type { AutoRecallRules, Command, GameState } from "../sim/types.ts";
import { requireElement, setText } from "./dom.ts";

interface NodeRow {
  id: AncestralNodeId;
  rank: HTMLElement;
  buyButton: HTMLButtonElement;
}

type AutoRecallRuleKey = keyof AutoRecallRules;

const RULE_KEYS: readonly AutoRecallRuleKey[] = ["everyMinutes", "pouchGold", "flockHpPercent"];

/** Golden Yolk shop, Bloodline readout, voluntary Rite, and Dinner Bell rules. Rows are built once. */
export class AncestralPanel {
  private readonly yolkStatus: HTMLElement;
  private readonly riteButton: HTMLButtonElement;
  private readonly dinnerBellRules: HTMLElement;
  private readonly ruleInputs: Record<AutoRecallRuleKey, HTMLInputElement>;
  private readonly rows: NodeRow[];

  constructor(enqueue: (command: Command) => void) {
    this.yolkStatus = requireElement("yolk-status", HTMLElement);
    this.riteButton = requireElement("rite-button", HTMLButtonElement);
    this.dinnerBellRules = requireElement("dinner-bell-rules", HTMLElement);
    this.ruleInputs = {
      everyMinutes: requireElement("auto-recall-minutes", HTMLInputElement),
      pouchGold: requireElement("auto-recall-gold", HTMLInputElement),
      flockHpPercent: requireElement("auto-recall-hp", HTMLInputElement),
    };
    this.riteButton.addEventListener("click", () => enqueue({ type: "performRite" }));
    for (const key of RULE_KEYS) {
      this.ruleInputs[key].addEventListener("change", () => enqueue({ type: "setAutoRecall", rules: this.readRules() }));
    }

    const list = requireElement("ancestral-list", HTMLOListElement);
    this.rows = ANCESTRAL_NODE_IDS.map((id) => {
      const node = ANCESTRAL_NODES[id];
      const item = document.createElement("li");
      item.className = "upgrade";
      const name = document.createElement("span");
      name.className = "upgrade-name";
      name.textContent = node.name;
      const rank = document.createElement("span");
      rank.className = "upgrade-level";
      const effect = document.createElement("span");
      effect.className = "upgrade-effect";
      effect.textContent = node.effect;
      const buyButton = document.createElement("button");
      buyButton.type = "button";
      buyButton.addEventListener("click", () => enqueue({ type: "buyAncestralNode", node: id }));
      item.append(name, rank, effect, buyButton);
      list.append(item);
      return { id, rank, buyButton };
    });
  }

  update(state: GameState): void {
    const { legacy } = state;
    const bloodlinePercent = Math.round((bloodlineMultiplier(legacy.lifetimeGoldenYolks) - 1) * 100);
    setText(this.yolkStatus, `Run ${legacy.run} · Golden Yolks ${legacy.goldenYolks} · Bloodline +${bloodlinePercent}%`);
    for (const row of this.rows) {
      const node = ANCESTRAL_NODES[row.id];
      const rank = legacy.ancestralRanks[row.id];
      const maxed = rank >= node.maxRank;
      const cost = ancestralNodeCost(node, rank);
      setText(row.rank, `${rank}/${node.maxRank}`);
      setText(row.buyButton, maxed ? "MAX" : `${cost} GY`);
      row.buyButton.disabled = maxed || legacy.goldenYolks < cost;
    }
    this.riteButton.disabled = !canPerformRite(state);
    this.riteButton.title = canPerformRite(state) ? "" : `Opens once a chicken reaches B${VOLUNTARY_RITE_MIN_DEPTH} this run`;
    this.dinnerBellRules.hidden = legacy.ancestralRanks.dinnerBell === 0;
    for (const key of RULE_KEYS) {
      const input = this.ruleInputs[key];
      // Leave a field alone while the player is typing in it.
      if (document.activeElement === input) continue;
      const saved = legacy.autoRecall[key];
      const text = saved === null ? "" : String(saved);
      if (input.value !== text) input.value = text;
    }
  }

  private readRules(): AutoRecallRules {
    const read = (key: AutoRecallRuleKey) => {
      const value = this.ruleInputs[key].valueAsNumber;
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    return { everyMinutes: read("everyMinutes"), pouchGold: read("pouchGold"), flockHpPercent: read("flockHpPercent") };
  }
}
