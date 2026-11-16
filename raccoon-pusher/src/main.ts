import "./style.css";
import { autoDropSeconds, createWallet, machineSettings, payoutPerWonCoin } from "./economy.ts";
import { initPhysics, PHYSICS_STEP_SECONDS, PusherMachine } from "./machine.ts";
import { PusherScene } from "./scene.ts";
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
const SHOP_REFRESH_MS = 200;

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html is missing #${id}`);
  return element;
}

const canvas = requireElement("machine-view", HTMLCanvasElement);
const bagStatus = requireElement("bag-status", HTMLSpanElement);
const wonStatus = requireElement("won-status", HTMLSpanElement);
const lostStatus = requireElement("lost-status", HTMLSpanElement);
const hint = requireElement("hint", HTMLParagraphElement);

async function main(): Promise<void> {
  await initPhysics();
  const wallet = createWallet();
  const machine = new PusherMachine(machineSettings(wallet), Math.random);
  const scene = new PusherScene(canvas);
  const slot = new SlotReels();
  const shop = new ShopPanel(requireElement("shop", HTMLElement), wallet, () => machine.applySettings(machineSettings(wallet)));
  let showerCoinsLeft = 0;
  let stepsSinceShowerCoin = 0;
  let won = 0;
  let lost = 0;
  let slotX = 0;
  let pointerNdc = { x: 0, y: 0 };
  let holding = false;
  let lastDropTime = -Infinity;
  let secondsSinceAutoDrop = 0;
  let secondsSinceScavenge = 0;

  const updateStatus = () => {
    bagStatus.textContent = `BAG ${Math.floor(wallet.bag)}`;
    wonStatus.textContent = `WON ${won}`;
    lostStatus.textContent = `GUTTER ${lost}`;
    hint.textContent =
      wallet.bombs > 0
        ? `Click the pile to toss a bomb (${wallet.bombs} left).`
        : wallet.bag < 1
          ? "Out of coins. The raccoon is digging under the machine..."
          : "Hold to drop coins. Time them through the ring for a spin.";
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
    scene.showBombTarget(wallet.bombs > 0 ? scene.floorPointFromPointer(pointerNdc.x, pointerNdc.y) : undefined);
  });
  canvas.addEventListener("pointerdown", (event) => {
    // With a bomb in hand a click tosses it; otherwise holding drops coins.
    if (wallet.bombs > 0) {
      const target = scene.floorPointFromPointer(pointerNdc.x, pointerNdc.y);
      if (!target) return;
      machine.tossBomb(target.x, target.z);
      wallet.bombs -= 1;
      if (wallet.bombs === 0) scene.showBombTarget(undefined);
      return;
    }
    holding = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => (holding = false));
  canvas.addEventListener("pointercancel", () => (holding = false));

  window.setInterval(() => shop.update(), SHOP_REFRESH_MS);
  shop.update();

  let unsimulatedMs = 0;
  let lastFrameTime = performance.now();
  const runFrame = (now: number) => {
    if (holding && wallet.bag >= 1 && now - lastDropTime >= DROP_INTERVAL_MS) {
      machine.dropCoin(slotX, Math.random);
      wallet.bag -= 1;
      lastDropTime = now;
    }
    const frameMs = now - lastFrameTime;
    lastFrameTime = now;
    unsimulatedMs = Math.min(unsimulatedMs + frameMs, MAX_STEPS_PER_FRAME * PHYSICS_STEP_SECONDS * MS_PER_SECOND);
    while (unsimulatedMs >= PHYSICS_STEP_SECONDS * MS_PER_SECOND) {
      const result = machine.step();
      wallet.bag += result.won * payoutPerWonCoin(wallet);
      won += result.won;
      lost += result.lost;
      result.explosions.forEach((explosion) => scene.addExplosion(explosion));
      if (result.gateHits > 0) {
        slot.addStock(result.gateHits);
        scene.flashGate();
      }
      const spin = slot.update(PHYSICS_STEP_SECONDS, Math.random);
      if (spin && spin.payout > 0) {
        showerCoinsLeft += spin.payout;
        scene.showSlotWin(spin.payout, now / MS_PER_SECOND);
      }
      stepsSinceShowerCoin += 1;
      if (showerCoinsLeft > 0 && stepsSinceShowerCoin >= STEPS_PER_SHOWER_COIN) {
        machine.dropShowerCoin(Math.random);
        showerCoinsLeft -= 1;
        stepsSinceShowerCoin = 0;
      }

      const autoDropInterval = autoDropSeconds(wallet);
      secondsSinceAutoDrop += PHYSICS_STEP_SECONDS;
      if (autoDropInterval !== undefined && secondsSinceAutoDrop >= autoDropInterval && wallet.bag >= 1) {
        machine.dropCoin(Math.random() * 2 - 1, Math.random);
        wallet.bag -= 1;
        secondsSinceAutoDrop = 0;
      }
      secondsSinceScavenge = wallet.bag < 1 ? secondsSinceScavenge + PHYSICS_STEP_SECONDS : 0;
      if (secondsSinceScavenge >= SCAVENGE_SECONDS) {
        wallet.bag += 1;
        secondsSinceScavenge = 0;
      }
      unsimulatedMs -= PHYSICS_STEP_SECONDS * MS_PER_SECOND;
    }
    updateStatus();
    scene.render(machine, slot, now / MS_PER_SECOND, frameMs / MS_PER_SECOND);
    requestAnimationFrame(runFrame);
  };
  requestAnimationFrame(runFrame);
}

void main();
