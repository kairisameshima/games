import { bloodlineMultiplier } from "../data/ancestry.ts";
import { MONSTER_KINDS } from "../data/bestiary.ts";
import type { GameState, RiteSummary } from "../sim/types.ts";
import { requireElement, setText } from "./dom.ts";

/**
 * The Rite of the Golden Yolk. Shown whenever a run has ended: the Roll of Feathers for this run, then the yolks
 * earned and the Bloodline they buy. Rebuilt only when a new Rite appears.
 */
export class RiteOverlay {
  private readonly overlay: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly rollOfFeathers: HTMLOListElement;
  private readonly beginButton: HTMLButtonElement;
  private shownRite: RiteSummary | null = null;

  constructor(beginNextRun: () => void) {
    this.overlay = requireElement("rite-overlay", HTMLElement);
    this.summary = requireElement("rite-summary", HTMLElement);
    this.rollOfFeathers = requireElement("roll-of-feathers", HTMLOListElement);
    this.beginButton = requireElement("begin-run-button", HTMLButtonElement);
    this.beginButton.addEventListener("click", beginNextRun);
  }

  update(state: GameState): void {
    this.overlay.hidden = state.rite === null;
    if (state.rite === null || state.rite === this.shownRite) return;
    this.shownRite = state.rite;
    const rite = state.rite;
    const { legacy } = state;
    const ending = rite.trigger === "extinction" ? "The last of the flock is gone." : "The Chicken-mancer calls the Rite.";
    const bloodlineAfter = Math.round((bloodlineMultiplier(legacy.lifetimeGoldenYolks + rite.goldenYolksEarned) - 1) * 100);
    setText(
      this.summary,
      `${ending} Deepest B${rite.deepestDepth} · ${rite.goldBanked} gold banked · +${rite.goldenYolksEarned} Golden Yolks · Bloodline +${bloodlineAfter}%`,
    );
    const fallen = legacy.rollOfFeathers.filter((entry) => entry.run === legacy.run);
    this.rollOfFeathers.replaceChildren(
      ...(fallen.length === 0
        ? [listItem("No chicken fell this run.")]
        : fallen.map((entry) => listItem(`${entry.name}, killed by a ${MONSTER_KINDS[entry.killer].name} on B${entry.depth}`))),
    );
    setText(this.beginButton, `BEGIN RUN ${legacy.run + 1}`);
  }
}

function listItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}
