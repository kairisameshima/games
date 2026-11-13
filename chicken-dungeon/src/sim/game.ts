import { RHODE_ISLAND_RED } from "../data/breeds.ts";
import { UPGRADES, upgradeCost, type UpgradeId } from "../data/upgrades.ts";
import { restAtCoop, updateChicken } from "./chickens.ts";
import { revealAround } from "./explore.ts";
import { spawnWanderers, updateMonsters } from "./monsters.ts";
import { currentTile } from "./movement.ts";
import { assignBroodingHens, startTeardowns, updateNests } from "./nests.ts";
import { chickenStats } from "./stats.ts";
import type { Command, FloorState, GameEvent, GameState } from "./types.ts";
import { ENTRANCE_DEPTH, floorStateAt, isInDungeon, placeChicken, spawnMonster } from "./world.ts";

const RECALL_RESPAWN_SHARE = 0.25;
const MAX_BROOD_QUOTA = 99;

export function tick(state: GameState, commands: readonly Command[]): GameEvent[] {
  state.tick += 1;
  const events: GameEvent[] = [];
  for (const command of commands) applyCommand(state, command, events);
  assignBroodingHens(state);
  for (const chicken of state.chickens) {
    if (chicken.activity === "home") restAtCoop(chicken);
    else if (chicken.activity !== "dead") updateChicken(state, chicken, events);
  }
  const occupiedDepths = new Set(state.chickens.filter(isInDungeon).map((chicken) => chicken.depth));
  for (const depth of occupiedDepths) updateMonsters(state, floorStateAt(state, depth), events);
  for (const floorState of state.floors.values()) spawnWanderers(state, floorState);
  updateNests(state, events);
  for (const chicken of state.chickens) {
    if (isInDungeon(chicken)) revealAround(floorStateAt(state, chicken.depth), currentTile(chicken), state.tick, chicken.vision);
  }
  return events;
}

function applyCommand(state: GameState, command: Command, events: GameEvent[]): void {
  switch (command.type) {
    case "send": {
      const entrance = floorStateAt(state, ENTRANCE_DEPTH).floor.stairsUp;
      for (const chicken of state.chickens) {
        if (chicken.activity === "home") placeChicken(state, chicken, ENTRANCE_DEPTH, entrance, "explore");
      }
      return;
    }
    case "recall":
      recallFlock(state);
      return;
    case "buyUpgrade":
      buyUpgrade(state, command.upgrade, events);
      return;
    case "setBroodQuota":
      state.broodQuota = Math.min(MAX_BROOD_QUOTA, Math.max(0, Math.floor(command.quota)));
      return;
  }
}

/** Upgrades are global: every living chicken gets the new stats at once, and hurt chickens keep their missing HP. */
function buyUpgrade(state: GameState, upgradeId: UpgradeId, events: GameEvent[]): void {
  const upgrade = UPGRADES[upgradeId];
  const level = state.upgradeLevels[upgradeId];
  const cost = upgradeCost(upgrade, level);
  // The UI can queue a second click before it sees the first purchase land, so a purchase that is no longer valid is skipped.
  if ((upgrade.maxLevel !== null && level >= upgrade.maxLevel) || state.bankedGold < cost) return;
  state.bankedGold -= cost;
  state.upgradeLevels[upgradeId] = level + 1;
  for (const chicken of state.chickens) {
    if (chicken.activity === "dead") continue;
    const stats = chickenStats(RHODE_ISLAND_RED, state.upgradeLevels, chicken.statBonus);
    const hpGained = stats.maxHp - chicken.maxHp;
    Object.assign(chicken, stats);
    chicken.hp += hpGained;
  }
  events.push({ type: "upgradeBought", upgrade: upgradeId, level: level + 1 });
}

/**
 * Brooding hens stop to tear down camp. Everyone else heads out. Every floor between the deepest chicken and the
 * coop gets back 25% of this expedition's kills, Agitated: the "fight your way out" pressure from the bible.
 */
function recallFlock(state: GameState): void {
  const deployed = state.chickens.filter(isInDungeon);
  const deepestOnRoute = Math.max(0, ...deployed.map((chicken) => chicken.depth));
  for (let depth = ENTRANCE_DEPTH; depth <= deepestOnRoute; depth++) stirFloor(state, floorStateAt(state, depth));
  for (const floorState of state.floors.values()) floorState.killedThisExpedition = [];
  startTeardowns(state);
  for (const chicken of deployed) {
    if (chicken.activity === "flee" || chicken.activity === "teardown") continue;
    chicken.activity = "recalled";
    chicken.exploreTarget = null;
    chicken.lootTargetId = null;
    chicken.fightTargetId = null;
    chicken.nestId = null;
    chicken.buildSite = null;
  }
}

function stirFloor(state: GameState, floorState: FloorState): void {
  const kills = floorState.killedThisExpedition;
  const respawnCount = Math.round(kills.length * RECALL_RESPAWN_SHARE);
  if (respawnCount === 0) return;
  for (const spawn of kills.slice(kills.length - respawnCount)) {
    floorState.monsters.push(spawnMonster(state, spawn, floorState.floor.depth, true));
  }
}
