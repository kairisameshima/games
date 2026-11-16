export type ZoneId = "topsoil" | "coal" | "copper" | "gold" | "crystal";

export interface Zone {
  id: ZoneId;
  name: string;
  oreName: string;
  /** Gold each unit of ore sells for at the surface. */
  oreValue: number;
  /** Price to open this gallery. The first gallery is open from the start. */
  openCost: number;
  /** Price of the first hired kid. Each later hire costs HIRE_COST_GROWTH times more. */
  hireBaseCost: number;
  /** Price of the first tool upgrade. Each later tier costs TOOL_COST_GROWTH times more. */
  toolBaseCost: number;
}

export const ZONES: readonly Zone[] = [
  { id: "topsoil", name: "Topsoil Tunnel", oreName: "pebbles", oreValue: 1, openCost: 0, hireBaseCost: 10, toolBaseCost: 25 },
  { id: "coal", name: "Coal Seam", oreName: "coal", oreValue: 6, openCost: 400, hireBaseCost: 120, toolBaseCost: 300 },
  { id: "copper", name: "Copper Vein", oreName: "copper", oreValue: 40, openCost: 6_000, hireBaseCost: 1_500, toolBaseCost: 4_000 },
  { id: "gold", name: "Gold Vein", oreName: "gold", oreValue: 300, openCost: 90_000, hireBaseCost: 22_000, toolBaseCost: 60_000 },
  { id: "crystal", name: "Crystal Grotto", oreName: "crystals", oreValue: 2_500, openCost: 1_500_000, hireBaseCost: 350_000, toolBaseCost: 900_000 },
];

export const HIRE_COST_GROWTH = 1.17;
export const TOOL_COST_GROWTH = 10;
/** Ore one kid digs per second with bare hands. */
export const KID_DIG_RATE = 1;
