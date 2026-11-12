import { MONSTER_KINDS } from "../data/bestiary.ts";
import { UPGRADES } from "../data/upgrades.ts";
import type { Command, GameEvent, GameState } from "../sim/types.ts";
import { isInDungeon, leadChicken } from "../sim/world.ts";
import { requireElement, setText } from "./dom.ts";

// The bible asks for a short hold so a stray click never strands the flock.
const RECALL_HOLD_MS = 500;
const EVENT_LOG_LENGTH = 6;
const SIMULATION_SPEEDS = [1, 2, 4, 8];

export class Hud {
  private readonly flockStatus: HTMLElement;
  private readonly depthStatus: HTMLElement;
  private readonly goldStatus: HTMLElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly recallButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly newRunButton: HTMLButtonElement;
  private readonly eventLog: HTMLOListElement;
  private recallHoldTimer: number | undefined;
  private speedIndex = 0;

  /** `startNewRun` is offered only once the whole flock is dead, until prestige replaces it. */
  constructor(enqueue: (command: Command) => void, startNewRun: () => void) {
    this.flockStatus = requireElement("flock-status", HTMLElement);
    this.depthStatus = requireElement("depth-status", HTMLElement);
    this.goldStatus = requireElement("gold-status", HTMLElement);
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
  }

  /** Sim seconds per real second. The main loop scales elapsed time, so ticks stay fixed and the sim stays deterministic. */
  get simulationSpeed(): number {
    return SIMULATION_SPEEDS[this.speedIndex];
  }

  update(state: GameState): void {
    const living = state.chickens.filter((chicken) => chicken.activity !== "dead");
    const deployed = living.filter(isInDungeon);
    const lead = leadChicken(state);
    setText(this.flockStatus, living.length === 0 ? "Flock lost" : `Flock ${living.length} · ${deployed.length} in dungeon`);
    const deepest = state.deepestDepth > 0 ? `Deepest B${state.deepestDepth}` : "";
    const whereabouts = lead ? `Viewing B${lead.depth}` : living.length > 0 ? "Flock at the coop" : "";
    setText(this.depthStatus, [whereabouts, deepest].filter(Boolean).join(" · "));
    const carried = deployed.reduce((total, chicken) => total + chicken.pouchGold, 0);
    setText(this.goldStatus, `Gold ${state.bankedGold} · In pouches ${carried}`);
    this.sendButton.disabled = !living.some((chicken) => chicken.activity === "home");
    this.recallButton.disabled = !deployed.some((chicken) => chicken.activity !== "recalled" && chicken.activity !== "flee");
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

function describeEvent(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case "reachedFloor":
      return `${chickenName(state, event.chickenId)} reached B${event.depth}.`;
    case "returnedHome": {
      const name = chickenName(state, event.chickenId);
      return event.goldBanked > 0 ? `${name} made it home with ${event.goldBanked} gold.` : `${name} made it home empty-handed.`;
    }
    case "chickenDied":
      return `${chickenName(state, event.chickenId)} was killed by a ${MONSTER_KINDS[event.killer].name} on B${event.depth}.`;
    case "upgradeBought":
      return `${UPGRADES[event.upgrade].name} is now level ${event.level}.`;
  }
}

function chickenName(state: GameState, chickenId: number): string {
  const chicken = state.chickens.find((candidate) => candidate.id === chickenId);
  if (!chicken) throw new Error(`Event references unknown chicken ${chickenId}`);
  return chicken.name;
}
