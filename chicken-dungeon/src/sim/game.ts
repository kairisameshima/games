import { restAtCoop, updateChicken } from "./chickens.ts";
import { revealAround } from "./explore.ts";
import { updateMonsters } from "./monsters.ts";
import { currentTile } from "./movement.ts";
import type { Command, FloorState, GameEvent, GameState } from "./types.ts";
import { ENTRANCE_DEPTH, floorStateAt, isInDungeon, placeChicken, spawnMonster } from "./world.ts";

const RECALL_RESPAWN_SHARE = 0.25;

export function tick(state: GameState, commands: readonly Command[]): GameEvent[] {
  state.tick += 1;
  const events: GameEvent[] = [];
  for (const command of commands) applyCommand(state, command);
  for (const chicken of state.chickens) {
    if (chicken.activity === "home") restAtCoop(chicken);
    else if (chicken.activity !== "dead") updateChicken(state, chicken, events);
  }
  const occupiedDepths = new Set(state.chickens.filter(isInDungeon).map((chicken) => chicken.depth));
  for (const depth of occupiedDepths) updateMonsters(state, floorStateAt(state, depth), events);
  for (const chicken of state.chickens) {
    if (isInDungeon(chicken)) revealAround(floorStateAt(state, chicken.depth), currentTile(chicken), state.tick);
  }
  return events;
}

function applyCommand(state: GameState, command: Command): void {
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
  }
}

/**
 * Every floor between the deepest chicken and the coop gets back 25% of this expedition's kills, Agitated.
 * This is the "fight your way out" pressure from the bible.
 */
function recallFlock(state: GameState): void {
  const deployed = state.chickens.filter(isInDungeon);
  const deepestOnRoute = Math.max(0, ...deployed.map((chicken) => chicken.depth));
  for (let depth = ENTRANCE_DEPTH; depth <= deepestOnRoute; depth++) stirFloor(state, floorStateAt(state, depth));
  for (const floorState of state.floors.values()) floorState.killedThisExpedition = [];
  for (const chicken of deployed) {
    if (chicken.activity === "flee") continue;
    chicken.activity = "recalled";
    chicken.exploreTarget = null;
    chicken.lootTargetId = null;
    chicken.fightTargetId = null;
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
