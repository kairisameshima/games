import { ITEMS_SHEET_LAYOUT, ITEMS_SHEET_URL } from "./art.ts";
import { ITEM_NAMES, type LootReward } from "./loot.ts";
import { ITEM_KINDS, type ItemKind } from "./machine.ts";

const ICON_ZOOM = 2;
/** How long an item shakes after a click before it breaks open. */
const BREAK_DELAY_MS = 450;

function createItemIcon(kind: ItemKind): HTMLSpanElement {
  const { cellWidth, cellHeight, columns, rows } = ITEMS_SHEET_LAYOUT;
  const frame = ITEM_KINDS.indexOf(kind);
  const icon = document.createElement("span");
  icon.className = "loot-icon";
  icon.style.width = `${cellWidth * ICON_ZOOM}px`;
  icon.style.height = `${cellHeight * ICON_ZOOM}px`;
  icon.style.backgroundImage = `url(${ITEMS_SHEET_URL})`;
  icon.style.backgroundSize = `${columns * cellWidth * ICON_ZOOM}px ${rows * cellHeight * ICON_ZOOM}px`;
  icon.style.backgroundPosition = `-${(frame % columns) * cellWidth * ICON_ZOOM}px -${Math.floor(frame / columns) * cellHeight * ICON_ZOOM}px`;
  return icon;
}

/** Won items waiting to be broken open. Clicking one shakes it, then breaks it and pays out. */
export class LootTray {
  private readonly list: HTMLElement;
  private readonly getLoot: () => ItemKind[];
  private readonly open: (kind: ItemKind) => LootReward;
  private readonly announce: (text: string) => void;
  private shownCount = -1;
  private breaking = false;

  /** `open` removes nothing itself: the tray takes the item out of the loot list, then asks for its reward. */
  constructor(list: HTMLElement, getLoot: () => ItemKind[], open: (kind: ItemKind) => LootReward, announce: (text: string) => void) {
    this.list = list;
    this.getLoot = getLoot;
    this.open = open;
    this.announce = announce;
  }

  private breakOpen(index: number, button: HTMLButtonElement): void {
    if (this.breaking) return;
    this.breaking = true;
    button.classList.add("breaking");
    window.setTimeout(() => {
      const loot = this.getLoot();
      const [kind] = loot.splice(index, 1);
      const reward = this.open(kind);
      this.announce(`${ITEM_NAMES[kind]}: ${reward.label}`);
      this.breaking = false;
      this.update();
    }, BREAK_DELAY_MS);
  }

  update(): void {
    const loot = this.getLoot();
    if (loot.length === this.shownCount || this.breaking) return;
    this.shownCount = loot.length;
    this.list.replaceChildren();
    if (loot.length === 0) {
      const empty = document.createElement("p");
      empty.className = "loot-empty";
      empty.textContent = "Push piggy banks, geodes and capsules off the edge to win them.";
      this.list.append(empty);
      return;
    }
    loot.forEach((kind, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "loot-item";
      button.title = `Break open the ${ITEM_NAMES[kind]}`;
      button.append(createItemIcon(kind));
      button.addEventListener("click", () => this.breakOpen(index, button));
      this.list.append(button);
    });
  }
}
