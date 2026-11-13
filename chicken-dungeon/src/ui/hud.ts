import { MONSTER_KINDS } from "../data/bestiary.ts";
import { YOLK_MANA_CAP } from "../data/nests.ts";
import { UPGRADES } from "../data/upgrades.ts";
import { flockCap } from "../sim/stats.ts";
import type { ChickenActivity, Command, GameEvent, GameState } from "../sim/types.ts";
import { isAlive, isInDungeon, leadChicken } from "../sim/world.ts";
import { requireElement, setText } from "./dom.ts";

// The bible asks for a short hold so a stray click never strands the flock.
const RECALL_HOLD_MS = 500;
const EVENT_LOG_LENGTH = 6;
const SIMULATION_SPEEDS = [1, 2, 4, 8];
// Recall has nothing more to do for chickens already on their way out.
const LEAVING_ACTIVITIES: readonly ChickenActivity[] = ["recalled", "flee", "teardown"];

export class Hud {
  private readonly flockStatus: HTMLElement;
  private readonly depthStatus: HTMLElement;
  private readonly goldStatus: HTMLElement;
  private readonly eggStatus: HTMLElement;
  private readonly broodQuotaValue: HTMLElement;
  private readonly broodDownButton: HTMLButtonElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly recallButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly newRunButton: HTMLButtonElement;
  private readonly eventLog: HTMLOListElement;
  private recallHoldTimer: number | undefined;
  private speedIndex = 0;
  private shownBroodQuota = 0;

  /** `startNewRun` is offered only once the whole flock is dead, until prestige replaces it. */
  constructor(enqueue: (command: Command) => void, startNewRun: () => void) {
    this.flockStatus = requireElement("flock-status", HTMLElement);
    this.depthStatus = requireElement("depth-status", HTMLElement);
    this.goldStatus = requireElement("gold-status", HTMLElement);
    this.eggStatus = requireElement("egg-status", HTMLElement);
    this.broodQuotaValue = requireElement("brood-quota", HTMLElement);
    this.broodDownButton = requireElement("brood-down-button", HTMLButtonElement);
    const broodUpButton = requireElement("brood-up-button", HTMLButtonElement);
    this.sendButton = requireElement("send-button", HTMLButtonElement);
    this.recallButton = requireElement("recall-button", HTMLButtonElement);
    this.speedButton = requireElement("speed-button", HTMLButtonElement);
    this.newRunButton = requireElement("new-run-button", HTMLButtonElement);
    this.eventLog = requireElement("event-log", HTMLOListElement);

    this.sendButton.addEventListener("click", () => enqueue({ type: "send" }));
    this.recallButton.style.setProperty("--recall-hold", `${RECALL_HOLD_MS}ms`);
    this.recallButton.addEventListener("pointerdown", () => {
      this.recallButton.classList.add("holding");
      this.recallHoldTimer = window.setTimeout(() => {
        this.cancelRecallHold();
        enqueue({ type: "recall" });
      }, RECALL_HOLD_MS);
    });
    for (const eventName of ["pointerup", "pointerleave", "pointercancel"]) {
      this.recallButton.addEventListener(eventName, () => this.cancelRecallHold());
    }
    this.speedButton.addEventListener("click", () => {
      this.speedIndex = (this.speedIndex + 1) % SIMULATION_SPEEDS.length;
      this.speedButton.textContent = `SPEED ${this.simulationSpeed}x`;
    });
    this.newRunButton.addEventListener("click", startNewRun);
    this.broodDownButton.addEventListener("click", () => enqueue({ type: "setBroodQuota", quota: this.shownBroodQuota - 1 }));
    broodUpButton.addEventListener("click", () => enqueue({ type: "setBroodQuota", quota: this.shownBroodQuota + 1 }));
  }

  /** Sim seconds per real second. The main loop scales elapsed time, so ticks stay fixed and the sim stays deterministic. */
  get simulationSpeed(): number {
    return SIMULATION_SPEEDS[this.speedIndex];
  }

  update(state: GameState): void {
    const living = state.chickens.filter(isAlive);
    const deployed = living.filter(isInDungeon);
    const lead = leadChicken(state);
    const cap = flockCap(state.upgradeLevels);
    setText(this.flockStatus, living.length === 0 ? "Flock lost" : `Flock ${living.length}/${cap} · ${deployed.length} in dungeon`);
    const deepest = state.deepestDepth > 0 ? `Deepest B${state.deepestDepth}` : "";
    const whereabouts = lead ? `Viewing B${lead.depth}` : living.length > 0 ? "Flock at the coop" : "";
    setText(this.depthStatus, [whereabouts, deepest].filter(Boolean).join(" · "));
    const carried = deployed.reduce((total, chicken) => total + chicken.pouchGold, 0);
    setText(this.goldStatus, `Gold ${state.bankedGold} · In pouches ${carried}`);
    setText(this.eggStatus, `Eggs ${countEggs(state)} · Mana ${state.yolkMana}/${YOLK_MANA_CAP}`);
    this.shownBroodQuota = state.broodQuota;
    setText(this.broodQuotaValue, String(state.broodQuota));
    this.broodDownButton.disabled = state.broodQuota === 0;
    this.sendButton.disabled = !living.some((chicken) => chicken.activity === "home");
    this.recallButton.disabled = !deployed.some((chicken) => !LEAVING_ACTIVITIES.includes(chicken.activity));
    this.newRunButton.hidden = living.length > 0;
  }

  record(events: readonly GameEvent[], state: GameState): void {
    for (const event of events) this.note(describeEvent(event, state));
  }

  note(message: string): void {
    const line = document.createElement("li");
    line.textContent = message;
    this.eventLog.prepend(line);
    while (this.eventLog.children.length > EVENT_LOG_LENGTH) this.eventLog.lastElementChild?.remove();
  }

  private cancelRecallHold(): void {
    window.clearTimeout(this.recallHoldTimer);
    this.recallButton.classList.remove("holding");
  }
}

function countEggs(state: GameState): number {
  let eggs = state.coopEggs.length;
  for (const floorState of state.floors.values()) for (const nest of floorState.nests) eggs += nest.eggs.length;
  for (const chicken of state.chickens) eggs += chicken.carriedEggs.length;
  return eggs;
}

function describeEvent(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case "reachedFloor":
      return `${chickenName(state, event.chickenId)} reached B${event.depth}.`;
    case "returnedHome": {
      const name = chickenName(state, event.chickenId);
      const haul = [event.goldBanked > 0 ? `${event.goldBanked} gold` : "", event.eggsCarried > 0 ? plural(event.eggsCarried, "egg") : ""];
      const carried = haul.filter(Boolean).join(" and ");
      return carried ? `${name} made it home with ${carried}.` : `${name} made it home empty-handed.`;
    }
    case "chickenDied": {
      const broke = event.eggsLost > 0 ? ` ${plural(event.eggsLost, "egg")} broke.` : "";
      return `${chickenName(state, event.chickenId)} was killed by a ${MONSTER_KINDS[event.killer].name} on B${event.depth}.${broke}`;
    }
    case "upgradeBought":
      return `${UPGRADES[event.upgrade].name} is now level ${event.level}.`;
    case "denDestroyed":
      return `A Monster Den on B${event.depth} was destroyed.`;
    case "nestBuilt":
      return `${chickenName(state, event.chickenId)} built a nest on B${event.depth}.`;
    case "nestDestroyed":
      return `A nest on B${event.depth} was destroyed. ${plural(event.eggsLost, "egg")} broke.`;
    case "campStruck":
      return `Camp struck on B${event.depth}: ${plural(event.eggsPacked, "egg")} packed, ${event.eggsCracked} cracked for mana.`;
    case "chickHatched": {
      const where = event.depth === 0 ? "at the coop" : `on B${event.depth}`;
      const mutant = event.mutated ? " A mutant: +10% stats." : "";
      return `${chickenName(state, event.chickenId)} hatched ${where}.${mutant}`;
    }
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function chickenName(state: GameState, chickenId: number): string {
  const chicken = state.chickens.find((candidate) => candidate.id === chickenId);
  if (!chicken) throw new Error(`Event references unknown chicken ${chickenId}`);
  return chicken.name;
}
