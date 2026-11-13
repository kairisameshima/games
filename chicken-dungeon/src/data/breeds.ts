export interface BreedStats {
  maxHp: number;
  attack: number;
  defense: number;
  /** Tiles per second. */
  speed: number;
  /** Fraction of max HP below which the chicken flees. */
  courage: number;
  /** Sight radius in tiles. */
  vision: number;
  /** Slots for carried eggs. Gold never uses slots. */
  carry: number;
  /** Seconds between eggs while brooding in a nest. */
  layIntervalSeconds: number;
}

export const RHODE_ISLAND_RED: BreedStats = {
  maxHp: 30,
  attack: 5,
  defense: 2,
  speed: 2.0,
  courage: 0.3,
  vision: 5,
  carry: 3,
  layIntervalSeconds: 120,
};
