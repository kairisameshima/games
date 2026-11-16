import { HARD_HAT_ICON, TOOLS } from "../data/tools.ts";
import { ZONES } from "../data/zones.ts";
import { TOOLS_SHEET_LAYOUT, TOOLS_SHEET_URL } from "../render/assets.ts";
import { galleryDigRate, totalDigRate } from "../sim/game.ts";
import { liftCapacity, liftSpeed, liftThroughput } from "../sim/lift.ts";
import {
  hireCost,
  hireKid,
  liftCapacityCost,
  liftSpeedCost,
  openGallery,
  openGalleryCost,
  toolUpgradeCost,
  upgradeLiftCapacity,
  upgradeLiftSpeed,
  upgradeTool,
} from "../sim/shop.ts";
import type { GameState } from "../sim/types.ts";
import { formatAmount, formatGold } from "./format.ts";

const ICON_ZOOM = 2;

interface BuyButton {
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  cost: HTMLSpanElement;
  icon: HTMLSpanElement | undefined;
}

interface GalleryCard {
  toolIcon: HTMLSpanElement;
  stats: HTMLParagraphElement;
  hire: BuyButton;
  tool: BuyButton;
}

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html is missing #${id}`);
  return element;
}

function createIcon(iconIndex: number): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "icon";
  setIcon(icon, iconIndex);
  return icon;
}

function setIcon(icon: HTMLSpanElement, iconIndex: number): void {
  const { cellWidth, cellHeight, columns, rows } = TOOLS_SHEET_LAYOUT;
  const column = iconIndex % columns;
  const row = Math.floor(iconIndex / columns);
  icon.style.width = `${cellWidth * ICON_ZOOM}px`;
  icon.style.height = `${cellHeight * ICON_ZOOM}px`;
  icon.style.backgroundImage = `url(${TOOLS_SHEET_URL})`;
  icon.style.backgroundSize = `${columns * cellWidth * ICON_ZOOM}px ${rows * cellHeight * ICON_ZOOM}px`;
  icon.style.backgroundPosition = `-${column * cellWidth * ICON_ZOOM}px -${row * cellHeight * ICON_ZOOM}px`;
}

function createBuyButton(iconIndex: number | undefined, onBuy: () => void): BuyButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "buy";
  const icon = iconIndex === undefined ? undefined : createIcon(iconIndex);
  if (icon) button.append(icon);
  const label = document.createElement("span");
  label.className = "buy-label";
  const cost = document.createElement("span");
  cost.className = "buy-cost";
  button.append(label, cost);
  button.addEventListener("click", onBuy);
  return { button, label, cost, icon };
}

function showPrice(buy: BuyButton, gold: number, label: string, cost: number | undefined): void {
  buy.label.textContent = label;
  buy.cost.textContent = cost === undefined ? "MAX" : formatGold(cost);
  buy.button.disabled = cost === undefined || gold < cost;
}

export class ShopPanel {
  private readonly goldStatus = requireElement("gold-status", HTMLSpanElement);
  private readonly digStatus = requireElement("dig-status", HTMLSpanElement);
  private readonly liftStatus = requireElement("lift-status", HTMLSpanElement);
  private readonly galleryList = requireElement("gallery-list", HTMLOListElement);
  private readonly liftCapacityBuy: BuyButton;
  private readonly liftSpeedBuy: BuyButton;
  private readonly openGalleryBuy: BuyButton;
  private galleryCards: GalleryCard[] = [];
  private readonly getState: () => GameState;
  private readonly onPurchase: () => void;

  /** `onPurchase` runs after every successful purchase, for example to save. */
  constructor(getState: () => GameState, onPurchase: () => void) {
    this.getState = getState;
    this.onPurchase = onPurchase;
    this.liftCapacityBuy = createBuyButton(undefined, () => this.buy(upgradeLiftCapacity));
    this.liftSpeedBuy = createBuyButton(undefined, () => this.buy(upgradeLiftSpeed));
    this.openGalleryBuy = createBuyButton(undefined, () => this.buy(openGallery));
    requireElement("lift-shop", HTMLDivElement).append(this.liftCapacityBuy.button, this.liftSpeedBuy.button);
    requireElement("open-gallery-slot", HTMLDivElement).append(this.openGalleryBuy.button);
  }

  private buy(purchase: (state: GameState) => boolean): void {
    if (!purchase(this.getState())) return;
    this.onPurchase();
    this.update();
  }

  private buildGalleryCards(state: GameState): void {
    this.galleryList.replaceChildren();
    this.galleryCards = state.galleries.map((_gallery, index) => {
      const item = document.createElement("li");
      item.className = "gallery-card";
      const title = document.createElement("h3");
      title.textContent = ZONES[index].name.toUpperCase();
      const toolIcon = createIcon(0);
      const stats = document.createElement("p");
      stats.className = "gallery-stats";
      const summary = document.createElement("div");
      summary.className = "gallery-summary";
      summary.append(toolIcon, stats);
      const hire = createBuyButton(HARD_HAT_ICON, () => this.buy((current) => hireKid(current, index)));
      const tool = createBuyButton(0, () => this.buy((current) => upgradeTool(current, index)));
      const buttons = document.createElement("div");
      buttons.className = "buy-row";
      buttons.append(hire.button, tool.button);
      item.append(title, summary, buttons);
      this.galleryList.append(item);
      return { toolIcon, stats, hire, tool };
    });
  }

  update(): void {
    const state = this.getState();
    if (this.galleryCards.length !== state.galleries.length) this.buildGalleryCards(state);
    const gold = state.gold;
    const digRate = totalDigRate(state);
    const liftRate = liftThroughput(state);

    this.goldStatus.textContent = formatGold(gold);
    this.digStatus.textContent = `DIG ${formatGold(digRate)}/s`;
    this.liftStatus.textContent = `LIFT ${formatGold(liftRate)}/s`;
    // The lift is the bottleneck when it hauls less than the kids dig.
    this.liftStatus.classList.toggle("bottleneck", liftRate < digRate);

    const lift = state.lift;
    showPrice(this.liftCapacityBuy, gold, `CAPACITY ${formatAmount(liftCapacity(lift))}`, liftCapacityCost(state));
    showPrice(this.liftSpeedBuy, gold, `SPEED ${liftSpeed(lift).toFixed(1)} floors/s`, liftSpeedCost(state));

    state.galleries.forEach((gallery, index) => {
      const card = this.galleryCards[index];
      const tool = TOOLS[gallery.toolTier];
      const nextTool = TOOLS[gallery.toolTier + 1];
      setIcon(card.toolIcon, tool.icon);
      const kids = gallery.crew === 1 ? "1 kid" : `${gallery.crew} kids`;
      card.stats.textContent = `${tool.name.toUpperCase()} · ${kids} · ${formatGold(galleryDigRate(state, index))}/s`;
      showPrice(card.hire, gold, "HIRE KID", hireCost(state, index));
      if (card.tool.icon) setIcon(card.tool.icon, (nextTool ?? tool).icon);
      showPrice(card.tool, gold, nextTool ? nextTool.name.toUpperCase() : "BEST TOOL", toolUpgradeCost(state, index));
    });

    const nextZone = ZONES[state.galleries.length];
    this.openGalleryBuy.button.hidden = nextZone === undefined;
    if (nextZone) showPrice(this.openGalleryBuy, gold, `OPEN ${nextZone.name.toUpperCase()}`, openGalleryCost(state));
  }
}
