import { BOMB_COST, buyBomb, buyUpgrade, upgradeCost, UPGRADES, type UpgradeId, type Wallet } from "./economy.ts";

interface ShopButton {
  button: HTMLButtonElement;
  detail: HTMLSpanElement;
  cost: HTMLSpanElement;
}

function createShopButton(name: string, onBuy: () => void): ShopButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "shop-button";
  const title = document.createElement("span");
  title.className = "shop-name";
  title.textContent = name;
  const detail = document.createElement("span");
  detail.className = "shop-detail";
  const cost = document.createElement("span");
  cost.className = "shop-cost";
  button.append(title, detail, cost);
  button.addEventListener("click", onBuy);
  return { button, detail, cost };
}

export class ShopPanel {
  private readonly getWallet: () => Wallet;
  private readonly upgradeButtons = new Map<UpgradeId, ShopButton>();
  private readonly bombButton: ShopButton;

  /**
   * `getWallet` returns the current machine's wallet, which is replaced when the raccoon moves on.
   * `onPurchase` runs after any purchase, so the machine can pick up new settings and the game can save.
   */
  constructor(container: HTMLElement, getWallet: () => Wallet, onPurchase: () => void) {
    this.getWallet = getWallet;
    for (const upgrade of UPGRADES) {
      const shopButton = createShopButton(upgrade.name, () => {
        if (!buyUpgrade(this.getWallet(), upgrade.id)) return;
        onPurchase();
        this.update();
      });
      this.upgradeButtons.set(upgrade.id, shopButton);
      container.append(shopButton.button);
    }
    this.bombButton = createShopButton("BOMB COIN", () => {
      if (!buyBomb(this.getWallet())) return;
      onPurchase();
      this.update();
    });
    this.bombButton.button.classList.add("bomb");
    container.append(this.bombButton.button);
  }

  update(): void {
    const wallet = this.getWallet();
    const bag = wallet.bag;
    for (const upgrade of UPGRADES) {
      const shopButton = this.upgradeButtons.get(upgrade.id);
      if (!shopButton) continue;
      const level = wallet.upgrades[upgrade.id];
      const cost = upgradeCost(wallet, upgrade.id);
      shopButton.detail.textContent = cost === undefined ? `Level ${level} · maxed` : `Level ${level} · ${upgrade.describeNext(level)}`;
      shopButton.cost.textContent = cost === undefined ? "" : `${cost} coins`;
      shopButton.button.disabled = cost === undefined || bag < cost;
    }
    this.bombButton.detail.textContent =
      wallet.bombs > 0 ? `${wallet.bombs} ready · click the pile to toss` : "Toss it on the pile, it blasts coins forward";
    this.bombButton.cost.textContent = `${BOMB_COST} coins`;
    this.bombButton.button.disabled = bag < BOMB_COST;
  }
}
