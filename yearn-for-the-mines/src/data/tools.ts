export interface Tool {
  name: string;
  /** Multiplies how fast each kid in the gallery digs. */
  digMultiplier: number;
  /** Frame index in the tools icon sheet. */
  icon: number;
}

export const TOOLS: readonly Tool[] = [
  { name: "Bare Hands", digMultiplier: 1, icon: 0 },
  { name: "Wooden Spoon", digMultiplier: 2, icon: 1 },
  { name: "Pickaxe", digMultiplier: 5, icon: 2 },
  { name: "Hand Drill", digMultiplier: 12, icon: 3 },
  { name: "Dynamite", digMultiplier: 30, icon: 4 },
];

export const HARD_HAT_ICON = 5;
