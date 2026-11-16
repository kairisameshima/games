import { createWallet, type Wallet } from "./economy.ts";
import type { ItemKind } from "./machine.ts";

/** Everything that survives a reload. The coin pile itself is not saved: a reloaded machine starts freshly filled. */
export interface GameState {
  /** Coins, upgrades and bombs for the current machine. Reset when the raccoon moves on. */
  wallet: Wallet;
  /** Grand prizes won so far. Sets the current machine and the permanent payout bonus. */
  machinesBeaten: number;
  /** The current machine's prize has fallen and the player has not moved on yet. */
  prizeWon: boolean;
  /** Won items waiting to be broken open. Kept across machines. */
  loot: ItemKind[];
  /** Coins won and lost on the current machine. */
  won: number;
  lost: number;
}

export function createGameState(): GameState {
  return { wallet: createWallet(), machinesBeaten: 0, prizeWon: false, loot: [], won: 0, lost: 0 };
}

/** The raccoon takes the prize and moves to the next machine: a fresh wallet, a bigger permanent bonus, loot kept. */
export function moveToNextMachine(state: GameState): void {
  if (!state.prizeWon) throw new Error("Cannot move on before the prize is won");
  state.machinesBeaten += 1;
  state.prizeWon = false;
  state.wallet = createWallet();
  state.won = 0;
  state.lost = 0;
}
