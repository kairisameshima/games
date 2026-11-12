import { leadChicken, type Command, type GameEvent, type GameState } from "../sim/game.ts";

// The bible asks for a short hold so a stray click never strands the flock.
const RECALL_HOLD_MS = 500;
const EVENT_LOG_LENGTH = 6;
const SIMULATION_SPEEDS = [1, 2, 4, 8];

export class Hud {
  private readonly flockStatus: HTMLElement;
  private readonly depthStatus: HTMLElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly recallButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly eventLog: HTMLOListElement;
  private recallHoldTimer: number | undefined;
  private speedIndex = 0;

  constructor(enqueue: (command: Command) => void) {
    this.flockStatus = requireElement("flock-status", HTMLElement);
    this.depthStatus = requireElement("depth-status", HTMLElement);
    this.sendButton = requireElement("send-button", HTMLButtonElement);
    this.recallButton = requireElement("recall-button", HTMLButtonElement);
    this.speedButton = requireElement("speed-button", HTMLButtonElement);
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
  }

  /** Sim seconds per real second. The main loop scales elapsed time, so ticks stay fixed and the sim stays deterministic. */
  get simulationSpeed(): number {
    return SIMULATION_SPEEDS[this.speedIndex];
  }

  update(state: GameState): void {
    const deployed = state.chickens.filter((chicken) => chicken.activity !== "home");
    const lead = leadChicken(state);
    setText(this.flockStatus, `Flock ${state.chickens.length} · ${deployed.length} in dungeon`);
    const deepest = state.deepestDepth > 0 ? ` · Deepest B${state.deepestDepth}` : "";
    setText(this.depthStatus, lead ? `Viewing B${lead.depth}${deepest}` : `Flock at the coop${deepest}`);
    this.sendButton.disabled = deployed.length === state.chickens.length;
    this.recallButton.disabled = !deployed.some((chicken) => chicken.activity !== "recalled");
  }

  record(events: readonly GameEvent[], state: GameState): void {
    for (const event of events) {
      const chicken = state.chickens.find((candidate) => candidate.id === event.chickenId);
      if (!chicken) throw new Error(`Event references unknown chicken ${event.chickenId}`);
      const line = document.createElement("li");
      line.textContent = event.type === "reachedFloor" ? `${chicken.name} reached B${event.depth}.` : `${chicken.name} made it home.`;
      this.eventLog.prepend(line);
    }
    while (this.eventLog.children.length > EVENT_LOG_LENGTH) this.eventLog.lastElementChild?.remove();
  }

  private cancelRecallHold(): void {
    window.clearTimeout(this.recallHoldTimer);
    this.recallButton.classList.remove("holding");
  }
}

function requireElement<T extends HTMLElement>(id: string, elementType: { new (): T; prototype: T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Missing #${id} in index.html`);
  return element;
}

/** Writing identical text still invalidates layout, and update() runs every frame. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
