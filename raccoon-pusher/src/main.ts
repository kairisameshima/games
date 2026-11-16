import "./style.css";
import { loadPusherArt, type PusherArt } from "./art.ts";
import { autoDropSeconds, legacyMultiplier, machineSettings, offlineEarnings, payoutPerWonCoin } from "./economy.ts";
import { createGameState, type GameState, moveToNextMachine } from "./game-state.ts";
import { LootTray } from "./loot-tray.ts";
import { rollLoot } from "./loot.ts";
import { initPhysics, ITEM_KINDS, PHYSICS_STEP_SECONDS, PusherMachine } from "./machine.ts";
import { machineAt } from "./machines.ts";
import { loadGame, SaveFormatError, setAsideUnreadableSave, storeGame } from "./save.ts";
import { machineShapeFor, PusherScene } from "./scene.ts";
import { ShopPanel } from "./shop.ts";
import { SlotReels } from "./slot.ts";

const DROP_INTERVAL_MS = 160;
/** A stalled tab catches up at most this many physics steps per frame instead of freezing. */
const MAX_STEPS_PER_FRAME = 5;
const MS_PER_SECOND = 1_000;
/** Physics steps between payout coins in a slot shower: 60 / 3 = 20 coins per second. */
const STEPS_PER_SHOWER_COIN = 3;
/** When the bag is empty the raccoon digs a coin out from under the machine this often, so a run never dead-ends. */
const SCAVENGE_SECONDS = 6;
const BOMB_CHEER_SECONDS = 1.5;
const PRIZE_CHEER_SECONDS = 6;
const UI_REFRESH_MS = 200;
const AUTOSAVE_INTERVAL_MS = 10_000;
const NOTE_VISIBLE_MS = 5_000;

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html is missing #${id}`);
  return element;
}

const canvas = requireElement("machine-view", HTMLCanvasElement);
const machineStatus = requireElement("machine-status", HTMLSpanElement);
const bagStatus = requireElement("bag-status", HTMLSpanElement);
const wonStatus = requireElement("won-status", HTMLSpanElement);
const lostStatus = requireElement("lost-status", HTMLSpanElement);
const hint = requireElement("hint", HTMLParagraphElement);
const note = requireElement("note", HTMLParagraphElement);
const prizeOverlay = requireElement("prize-overlay", HTMLElement);
const prizeTitle = requireElement("prize-title", HTMLHeadingElement);
const prizeSummary = requireElement("prize-summary", HTMLParagraphElement);
const nextMachineButton = requireElement("next-machine-button", HTMLButtonElement);
let noteTimer: number | undefined;

function showNote(text: string): void {
  note.textContent = text;
  note.hidden = false;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (note.hidden = true), NOTE_VISIBLE_MS);
}

function payForTimeAway(state: GameState, millisecondsAway: number): void {
  const earned = offlineEarnings(state.wallet, state.machinesBeaten, millisecondsAway / MS_PER_SECOND);
  if (earned < 1) return;
  state.wallet.bag += earned;
  showNote(`While you were away, the Auto-Dropper won ${earned} coins.`);
}

/** Startup is the boundary for save errors: an unreadable save is set aside and a new night begins. */
function loadOrStartGame(): GameState {
  try {
    const loaded = loadGame();
    if (!loaded) return createGameState();
    payForTimeAway(loaded.state, Date.now() - loaded.savedAt);
    return loaded.state;
  } catch (error) {
    if (!(error instanceof SaveFormatError)) throw error;
    console.error(error);
    setAsideUnreadableSave();
    showNote("Your save could not be read. It was set aside and a new night started.");
    return createGameState();
  }
}

function buildMachine(state: GameState, art: PusherArt): PusherMachine {
  const { prizeDensity } = machineAt(state.machinesBeaten);
  return new PusherMachine(machineSettings(state.wallet), machineShapeFor(art, prizeDensity), !state.prizeWon, Math.random);
}

function showPrizeOverlay(state: GameState): void {
  const current = machineAt(state.machinesBeaten).theme;
  const next = machineAt(state.machinesBeaten + 1).theme;
  prizeTitle.textContent = `YOU WON THE ${current.prizeName.toUpperCase()}!`;
  prizeSummary.textContent = `Every coin you win from now on pays x${legacyMultiplier(state.machinesBeaten + 1).toFixed(1)}. Your upgrades stay behind, your loot comes with you.`;
  nextMachineButton.textContent = `SNEAK INTO THE ${next.name.toUpperCase()}`;
  prizeOverlay.hidden = false;
}

async function main(): Promise<void> {
  const [art] = await Promise.all([loadPusherArt(), initPhysics()]);
  const state = loadOrStartGame();
  let machine = buildMachine(state, art);
  const scene = new PusherScene(canvas, art);
  const slot = new SlotReels();
  const save = () => storeGame(state, Date.now());
  scene.setMachine(machineAt(state.machinesBeaten).theme, machineAt(state.machinesBeaten).frame);
  const shop = new ShopPanel(requireElement("shop-items", HTMLElement), () => state.wallet, () => {
    machine.applySettings(machineSettings(state.wallet));
    save();
  });
  const lootTray = new LootTray(
    requireElement("loot-list", HTMLElement),
    () => state.loot,
    (kind) => {
      const reward = rollLoot(kind, state.machinesBeaten, Math.random);
      state.wallet.bag += reward.coins;
      state.wallet.bombs += reward.bombs;
      save();
      return reward;
    },
    showNote,
  );
  if (state.prizeWon) showPrizeOverlay(state);

  nextMachineButton.addEventListener("click", () => {
    moveToNextMachine(state);
    machine.dispose();
    machine = buildMachine(state, art);
    const { theme, frame } = machineAt(state.machinesBeaten);
    scene.setMachine(theme, frame);
    prizeOverlay.hidden = true;
    save();
    showNote(`Welcome to the ${theme.name}. The ${theme.prizeName} is waiting.`);
  });

  let showerCoinsLeft = 0;
  let stepsSinceShowerCoin = 0;
  let slotX = 0;
  let pointerNdc = { x: 0, y: 0 };
  let holding = false;
  let lastDropTime = -Infinity;
  let secondsSinceAutoDrop = 0;
  let secondsSinceScavenge = 0;

  const updateStatus = () => {
    const { theme } = machineAt(state.machinesBeaten);
    machineStatus.textContent = `${theme.name.toUpperCase()} · PRIZE: ${theme.prizeName.toUpperCase()}`;
    bagStatus.textContent = `BAG ${Math.floor(state.wallet.bag)}`;
    wonStatus.textContent = `WON ${state.won}`;
    lostStatus.textContent = `GUTTER ${state.lost}`;
    hint.textContent =
      state.wallet.bombs > 0
        ? `Click the pile to toss a bomb (${state.wallet.bombs} left).`
        : state.wallet.bag < 1
          ? "Out of coins. The raccoon is digging under the machine..."
          : `Push the ${theme.prizeName} off the edge. Coins knocked off the shelf through the ring earn a spin.`;
  };

  const fitCanvas = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
  new ResizeObserver(fitCanvas).observe(canvas);
  fitCanvas();

  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    pointerNdc = {
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: -(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
    };
    slotX = scene.slotFromPointer(pointerNdc.x, pointerNdc.y);
    scene.showDropSlot(slotX);
    scene.showBombTarget(state.wallet.bombs > 0 ? scene.floorPointFromPointer(pointerNdc.x, pointerNdc.y) : undefined);
  });
  canvas.addEventListener("pointerdown", (event) => {
    // With a bomb in hand a click tosses it; otherwise holding drops coins.
    if (state.wallet.bombs > 0) {
      const target = scene.floorPointFromPointer(pointerNdc.x, pointerNdc.y);
      if (!target) return;
      machine.tossBomb(target.x, target.z);
      state.wallet.bombs -= 1;
      if (state.wallet.bombs === 0) scene.showBombTarget(undefined);
      return;
    }
    holding = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => (holding = false));
  canvas.addEventListener("pointercancel", () => (holding = false));

  // Browsers pause animation frames in hidden tabs, so hidden time is paid out like time away.
  let hiddenAt: number | undefined;
  let lastFrameTime = performance.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      save();
      return;
    }
    if (hiddenAt !== undefined) payForTimeAway(state, Date.now() - hiddenAt);
    hiddenAt = undefined;
    lastFrameTime = performance.now();
  });
  window.addEventListener("pagehide", save);
  window.setInterval(save, AUTOSAVE_INTERVAL_MS);
  window.setInterval(() => {
    shop.update();
    lootTray.update();
  }, UI_REFRESH_MS);
  shop.update();
  lootTray.update();

  let unsimulatedMs = 0;
  const runFrame = (now: number) => {
    const timeSeconds = now / MS_PER_SECOND;
    if (holding && state.wallet.bag >= 1 && now - lastDropTime >= DROP_INTERVAL_MS) {
      machine.dropCoin(slotX, Math.random);
      state.wallet.bag -= 1;
      lastDropTime = now;
    }
    const frameMs = now - lastFrameTime;
    lastFrameTime = now;
    unsimulatedMs = Math.min(unsimulatedMs + frameMs, MAX_STEPS_PER_FRAME * PHYSICS_STEP_SECONDS * MS_PER_SECOND);
    while (unsimulatedMs >= PHYSICS_STEP_SECONDS * MS_PER_SECOND) {
      const result = machine.step();
      state.wallet.bag += result.won * payoutPerWonCoin(state.wallet, state.machinesBeaten);
      state.won += result.won;
      state.lost += result.lost;
      state.loot.push(...result.wonItems);
      for (const explosion of result.explosions) {
        scene.addExplosion(explosion);
        scene.cheer(timeSeconds, BOMB_CHEER_SECONDS);
      }
      if (result.prizeWon) {
        state.prizeWon = true;
        scene.cheer(timeSeconds, PRIZE_CHEER_SECONDS);
        showPrizeOverlay(state);
        save();
      }
      if (result.gateHits > 0) {
        slot.addStock(result.gateHits);
        scene.flashGate();
      }
      const spin = slot.update(PHYSICS_STEP_SECONDS, Math.random);
      if (spin && spin.payout > 0) {
        showerCoinsLeft += spin.payout;
        scene.showSlotWin(spin.payout, timeSeconds);
        // Three of a kind also drops a loot item into the shower.
        if (spin.reels.every((symbol) => symbol === spin.reels[0])) {
          machine.dropShowerItem(ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)], Math.random);
        }
      }
      stepsSinceShowerCoin += 1;
      if (showerCoinsLeft > 0 && stepsSinceShowerCoin >= STEPS_PER_SHOWER_COIN) {
        machine.dropShowerCoin(Math.random);
        showerCoinsLeft -= 1;
        stepsSinceShowerCoin = 0;
      }

      const autoDropInterval = autoDropSeconds(state.wallet);
      secondsSinceAutoDrop += PHYSICS_STEP_SECONDS;
      if (autoDropInterval !== undefined && secondsSinceAutoDrop >= autoDropInterval && state.wallet.bag >= 1) {
        machine.dropCoin(Math.random() * 2 - 1, Math.random);
        state.wallet.bag -= 1;
        secondsSinceAutoDrop = 0;
      }
      secondsSinceScavenge = state.wallet.bag < 1 ? secondsSinceScavenge + PHYSICS_STEP_SECONDS : 0;
      if (secondsSinceScavenge >= SCAVENGE_SECONDS) {
        state.wallet.bag += 1;
        secondsSinceScavenge = 0;
      }
      unsimulatedMs -= PHYSICS_STEP_SECONDS * MS_PER_SECOND;
    }
    updateStatus();
    scene.render(machine, slot, timeSeconds, frameMs / MS_PER_SECOND);
    requestAnimationFrame(runFrame);
  };
  requestAnimationFrame(runFrame);
}

void main();
