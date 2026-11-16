/** One coin pusher in the raccoon's night out. Beating its grand prize moves the raccoon to the next one. */
export interface MachineTheme {
  name: string;
  prizeName: string;
  /** Felt colours: base and the small diamond print. */
  feltColor: string;
  feltPrintColor: string;
  /** Prize density relative to a coin's; heavier prizes take more coins to shove off the edge. */
  prizeDensity: number;
}

/**
 * Order matches the frames in the prize sheet. Densities come from headless runs at 3 drops a second: density 10
 * fell in 0.7 to 1.4 minutes over three seeds, density 18 in 0.8 minutes, 1.9 minutes, and once not within 20.
 */
export const MACHINES: readonly MachineTheme[] = [
  { name: "Corner Arcade", prizeName: "Golden Trash Can", feltColor: "#1f4a5a", feltPrintColor: "#3b8296", prizeDensity: 10 },
  { name: "Laundromat", prizeName: "Lucky Sock", feltColor: "#2f2a63", feltPrintColor: "#5a52a8", prizeDensity: 18 },
  { name: "Pizza Parlor", prizeName: "Pizza Trophy", feltColor: "#5c2424", feltPrintColor: "#a8483a", prizeDensity: 30 },
  { name: "Casino Royale", prizeName: "Diamond Raccoon", feltColor: "#174a2c", feltPrintColor: "#2f8a52", prizeDensity: 45 },
];

/** After the last machine the series starts over, and every prize gets this much heavier per lap. */
const PRIZE_DENSITY_GROWTH_PER_LAP = 0.5;

/** The machine the raccoon plays after beating `machinesBeaten` prizes. */
export function machineAt(machinesBeaten: number): { theme: MachineTheme; frame: number; prizeDensity: number } {
  const frame = machinesBeaten % MACHINES.length;
  const lap = Math.floor(machinesBeaten / MACHINES.length);
  const theme = MACHINES[frame];
  return { theme, frame, prizeDensity: theme.prizeDensity * (1 + lap * PRIZE_DENSITY_GROWTH_PER_LAP) };
}
