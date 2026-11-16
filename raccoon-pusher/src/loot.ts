import type { ItemKind } from "./machine.ts";

export interface LootReward {
  coins: number;
  bombs: number;
  /** Shown when the item breaks open. */
  label: string;
}

const PIGGY_MIN_COINS = 8;
const PIGGY_MAX_COINS = 30;
/** Geode outcomes from most to least likely; the chances add up to 1. */
const GEODE_OUTCOMES = [
  { chance: 0.6, coins: 3, label: "Just rubble" },
  { chance: 0.3, coins: 25, label: "Amethyst!" },
  { chance: 0.1, coins: 120, label: "DIAMOND!" },
] as const;
const CAPSULE_MIN_BOMBS = 1;
const CAPSULE_MAX_BOMBS = 3;
/** Coin rewards grow with every machine beaten, so loot keeps up with the bigger payouts. */
const LOOT_GROWTH_PER_MACHINE = 1;

export const ITEM_NAMES: Record<ItemKind, string> = { piggy: "Piggy Bank", geode: "Geode", capsule: "Toy Capsule" };

function randomInt(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** What breaking open an item gives, in the machine reached after `machinesBeaten` prizes. */
export function rollLoot(kind: ItemKind, machinesBeaten: number, random: () => number): LootReward {
  const scale = 1 + machinesBeaten * LOOT_GROWTH_PER_MACHINE;
  switch (kind) {
    case "piggy": {
      const coins = randomInt(PIGGY_MIN_COINS, PIGGY_MAX_COINS, random) * scale;
      return { coins, bombs: 0, label: `+${coins} coins` };
    }
    case "geode": {
      let roll = random();
      for (const outcome of GEODE_OUTCOMES) {
        roll -= outcome.chance;
        if (roll < 0) return { coins: outcome.coins * scale, bombs: 0, label: `${outcome.label} +${outcome.coins * scale}` };
      }
      const last = GEODE_OUTCOMES[GEODE_OUTCOMES.length - 1];
      return { coins: last.coins * scale, bombs: 0, label: `${last.label} +${last.coins * scale}` };
    }
    case "capsule": {
      const bombs = randomInt(CAPSULE_MIN_BOMBS, CAPSULE_MAX_BOMBS, random);
      return { coins: 0, bombs, label: bombs === 1 ? "+1 bomb coin" : `+${bombs} bomb coins` };
    }
  }
}
