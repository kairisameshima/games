export interface Gallery {
  crew: number;
  /** Index into TOOLS. */
  toolTier: number;
  /** Gold worth of dug ore waiting in the crate for the lift. */
  stockpile: number;
}

export type LiftPhase = "idle" | "descending" | "loading" | "ascending" | "unloading";

export interface Lift {
  capacityLevel: number;
  speedLevel: number;
  phase: LiftPhase;
  /** Distance below the surface in galleries: 0 is the surface, 1 is the first gallery. */
  depth: number;
  /** Gallery index the lift is heading to or loading at. */
  targetGallery: number;
  /** Gold worth of ore on board. */
  cargo: number;
  /** Seconds left in a loading or unloading stop. */
  stopSecondsLeft: number;
}

export interface GameState {
  gold: number;
  lifetimeGold: number;
  /** Open galleries, top to bottom. Index matches ZONES. */
  galleries: Gallery[];
  lift: Lift;
}
