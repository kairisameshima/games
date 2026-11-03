import { DOCTRINE_GROUPS, DOCTRINES, ENEMY_KINDS, PART_LABELS, PARTS, PRESTIGE, STATIONS, TANK_MODELS } from "./data.js";
import { formatShort, formatWhole } from "./format.js";
import {
  alliesAtFront,
  BLUEPRINT_BY_MODEL,
  canBuyBlueprint,
  canBuyDoctrine,
  canLaunchOffensive,
  canPrestige,
  depotCap,
  doctrineCost,
  doctrineLevel,
  frontStrength,
  isDoctrineMaxed,
  isModelUnlocked,
  medalsForSector,
  MODEL_BY_ID,
  offensiveCost,
  offensiveTarget,
  powerDemand,
  powerFactor,
  powerSupply,
  previousModel,
  secondsSinceProgress,
  canFallBack,
  stationRate,
  stationUpgradeCost,
  storageCap,
  tankComplexity,
  tankStats,
  sectorPlan,
} from "./sim.js";

const STATUS_TEXT = {
  running: "Running",
  starved: "Starved",
  blocked: "Output full",
  underpowered: "Low power",
  idle: "Idle",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setDisabled(node, disabled) {
  if (node.disabled !== disabled) node.disabled = disabled;
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${Math.round(seconds % 60)}s`;
}

function medalText(count) {
  return `${formatWhole(count)} ${Math.floor(count) === 1 ? "medal" : "medals"}`;
}

function recipeText(model) {
  return PARTS.map((part) => `${model.parts[part]} ${PART_LABELS[part].toLowerCase().replace(/s$/, model.parts[part] === 1 ? "" : "s")}`).join(", ");
}

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.stationCards = {};
    this.doctrineItems = {};
    this.stallNotified = false;
    this.modelCards = {};
    this.labels = {};
    this.selectedStation = null;
    this.buildHud();
    this.buildFactoryPanel();
    this.buildCommandPanel();
    this.buildWaveBar();
    this.buildViewSwitch();
    this.buildMobileTabs();
    this.toasts = root.querySelector("#toasts");
    this.modal = root.querySelector("#modal");
  }

  buildHud() {
    const hud = this.root.querySelector("#hud");
    hud.innerHTML = `
      <div class="brand"><span class="brand-mark">TANK FOUNDRY</span><span class="brand-tag">build · advance · regroup</span></div>
      <div class="resources">
        <div class="resource salvage" title="Salvage: recovered from destroyed enemies. Pays for factory upgrades."><span class="resource-label">Salvage</span><span class="resource-value" data-field="salvage"></span><span class="resource-rate" data-field="salvageRate"></span></div>
        <div class="resource medals" title="Medals: earned by regrouping. Pay for permanent doctrine."><span class="resource-label">Medals</span><span class="resource-value" data-field="medals"></span></div>
        <div class="resource steel" title="Steel: smelted by the steel mill and used by the part shops."><span class="resource-label">Steel</span><span class="resource-value" data-field="steel"></span></div>
        <div class="resource front" title="Tanks at the front. The army grows as long as the factory outbuilds losses."><span class="resource-label">Front</span><span class="resource-value" data-field="front"></span></div>
        <div class="resource power" title="Power supply / demand"><span class="resource-label">Power</span><span class="resource-value" data-field="power"></span></div>
      </div>
      <div class="hud-actions"><span class="save-status" data-field="saveStatus">Saved</span><button type="button" class="ghost" data-action="help">How to play</button></div>`;
    this.hud = Object.fromEntries([...hud.querySelectorAll("[data-field]")].map((node) => [node.dataset.field, node]));
    hud.querySelector('[data-action="help"]').addEventListener("click", () => this.showHelp());
  }

  buildFactoryPanel() {
    const panel = this.root.querySelector("#factory-panel");
    panel.innerHTML = `<div class="panel-head"><h2>Factory</h2><label class="auto-toggle" data-auto="upgrades"><input type="checkbox"> Auto-upgrade</label></div><div class="panel-body"></div>`;
    const body = panel.querySelector(".panel-body");
    this.autoUpgrade = panel.querySelector('[data-auto="upgrades"]');
    this.autoUpgrade.querySelector("input").addEventListener("change", (event) => this.handlers.toggleAutoUpgrade(event.target.checked));
    for (const station of STATIONS) {
      const card = element("section", "station-card");
      card.dataset.station = station.id;
      card.innerHTML = `
        <header><h3>${station.name}</h3><span class="level"></span><span class="status-pill"></span></header>
        <p class="station-detail"></p>
        <div class="meter"><div class="meter-fill"></div><span class="meter-text"></span></div>
        <p class="station-hint"></p>
        ${station.id === "assembly" ? '<label class="production">Producing <select></select></label>' : ""}
        <button type="button" class="buy"></button>`;
      const refs = {
        card,
        level: card.querySelector(".level"),
        status: card.querySelector(".status-pill"),
        detail: card.querySelector(".station-detail"),
        fill: card.querySelector(".meter-fill"),
        meterText: card.querySelector(".meter-text"),
        hint: card.querySelector(".station-hint"),
        button: card.querySelector(".buy"),
        select: card.querySelector("select"),
        options: "",
      };
      refs.button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.handlers.upgrade(station.id);
      });
      refs.select?.addEventListener("change", (event) => this.handlers.produce(event.target.value));
      card.addEventListener("click", () => this.handlers.selectStation(station.id));
      this.stationCards[station.id] = refs;
      body.append(card);
    }
  }

  buildCommandPanel() {
    const panel = this.root.querySelector("#command-panel");
    panel.innerHTML = `
      <div class="panel-head tabs">
        <button type="button" data-tab="doctrine" class="active">Doctrine</button>
        <button type="button" data-tab="armory">Armory</button>
        <button type="button" data-tab="records">Records</button>
      </div>
      <div class="panel-body tab-body" data-body="doctrine"></div>
      <div class="panel-body tab-body" data-body="armory" hidden></div>
      <div class="panel-body tab-body" data-body="records" hidden></div>`;
    for (const tab of panel.querySelectorAll("[data-tab]")) {
      tab.addEventListener("click", () => this.showTab(tab.dataset.tab));
    }
    this.commandPanel = panel;

    const doctrineBody = panel.querySelector('[data-body="doctrine"]');
    const regroup = element("section", "regroup-card");
    regroup.innerHTML = `
      <header><h3>Regroup</h3><span class="regroup-medals"></span></header>
      <p class="regroup-text"></p>
      <button type="button" class="buy"></button>`;
    this.regroup = { card: regroup, medals: regroup.querySelector(".regroup-medals"), text: regroup.querySelector(".regroup-text"), button: regroup.querySelector(".buy") };
    this.regroup.button.addEventListener("click", () => {
      const medals = medalsForSector(this.state.battle.maxSector);
      if (window.confirm(`Regroup for ${medalText(medals)}? Stations, blueprints, salvage and the front reset to sector 1. Doctrine and medals stay.`)) this.handlers.prestige();
    });
    doctrineBody.append(regroup);
    doctrineBody.append(element("p", "panel-note", "Doctrine is permanent. It survives every regroup and makes each run reach further."));
    for (const group of DOCTRINE_GROUPS) {
      const section = element("section", "research-group");
      section.append(element("h3", "", group.name));
      for (const doctrine of DOCTRINES.filter((entry) => entry.group === group.id)) section.append(this.buildDoctrineItem(doctrine));
      doctrineBody.append(section);
    }

    const armoryBody = panel.querySelector('[data-body="armory"]');
    armoryBody.append(element("p", "panel-note", "Blueprints cost salvage and reset when you regroup. Better tanks cost more parts and assembly time."));
    for (const model of TANK_MODELS) {
      const card = element("section", "model-card");
      const blueprint = BLUEPRINT_BY_MODEL[model.id];
      card.innerHTML = `
        <header><h3>${model.name}</h3><span class="model-meta">${model.year} · ${model.role}</span></header>
        ${blueprint ? `<p class="model-recipe">${blueprint.desc}</p>` : ""}
        <dl class="model-stats"></dl>
        <p class="model-recipe">Needs ${recipeText(model)} · ${model.buildSeconds}s to assemble</p>
        <button type="button" class="buy"></button>`;
      const refs = { card, stats: card.querySelector(".model-stats"), button: card.querySelector(".buy"), statsText: "" };
      refs.button.addEventListener("click", () => {
        if (isModelUnlocked(this.state, model.id)) this.handlers.produce(model.id);
        else this.handlers.buyBlueprint(model.id);
      });
      this.modelCards[model.id] = refs;
      armoryBody.append(card);
    }

    const records = panel.querySelector('[data-body="records"]');
    records.innerHTML = `<dl class="records"></dl><button type="button" class="danger" data-action="reset">Reset all progress</button>`;
    this.recordsList = records.querySelector(".records");
    records.querySelector('[data-action="reset"]').addEventListener("click", () => {
      if (window.confirm("Erase everything, including medals and doctrine?")) this.handlers.reset();
    });
  }

  buildDoctrineItem(doctrine) {
    const item = element("article", "research-item");
    item.innerHTML = `<div class="research-text"><h4>${doctrine.name} <span class="research-level"></span></h4><p>${doctrine.desc}</p></div><button type="button" class="buy"></button>`;
    const refs = { item, level: item.querySelector(".research-level"), button: item.querySelector(".buy") };
    refs.button.addEventListener("click", () => this.handlers.buyDoctrine(doctrine.id));
    this.doctrineItems[doctrine.id] = refs;
    return item;
  }

  buildWaveBar() {
    const bar = this.root.querySelector("#wave-bar");
    bar.innerHTML = `
      <div class="wave-title"><span data-field="sector"></span><span class="boss-badge" data-field="landship" hidden>Landship</span></div>
      <div class="meter wave-meter"><div class="meter-fill"></div><span class="meter-text"></span></div>
      <div class="wave-foot"><span data-field="defenses"></span></div>
      <div class="assault-actions">
        <button type="button" class="offensive-button" data-field="offensive"></button>
        <button type="button" class="ghost" data-field="fallBack">Fall back</button>
      </div>`;
    this.sector = {
      title: bar.querySelector('[data-field="sector"]'),
      landship: bar.querySelector('[data-field="landship"]'),
      fill: bar.querySelector(".meter-fill"),
      text: bar.querySelector(".meter-text"),
      defenses: bar.querySelector('[data-field="defenses"]'),
      offensive: bar.querySelector('[data-field="offensive"]'),
      fallBack: bar.querySelector('[data-field="fallBack"]'),
      defensesKey: "",
    };
    this.sector.offensive.addEventListener("click", () => this.handlers.launchOffensive());
    this.sector.fallBack.addEventListener("click", () => this.handlers.fallBack());
  }

  buildViewSwitch() {
    const nav = this.root.querySelector("#view-switch");
    for (const [name, label] of [["factory", "Factory"], ["front", "Front line"], ["overview", "Overview"]]) {
      const button = element("button", "ghost", label);
      button.type = "button";
      button.addEventListener("click", () => this.handlers.setView(name));
      nav.append(button);
    }
  }

  buildMobileTabs() {
    const nav = this.root.querySelector("#mobile-tabs");
    for (const [panel, label] of [["factory-panel", "Factory"], ["command-panel", "Doctrine"], ["", "Map"]]) {
      const button = element("button", "", label);
      button.type = "button";
      button.dataset.panel = panel;
      button.addEventListener("click", () => this.showMobilePanel(panel));
      nav.append(button);
    }
    this.showMobilePanel("");
  }

  showMobilePanel(panelId) {
    this.root.dataset.mobilePanel = panelId || "map";
    for (const button of this.root.querySelectorAll("#mobile-tabs button")) button.classList.toggle("active", button.dataset.panel === panelId);
  }

  showTab(name) {
    for (const tab of this.commandPanel.querySelectorAll("[data-tab]")) tab.classList.toggle("active", tab.dataset.tab === name);
    for (const body of this.commandPanel.querySelectorAll("[data-body]")) body.hidden = body.dataset.body !== name;
  }

  selectStation(id) {
    this.selectedStation = id;
    for (const [stationId, refs] of Object.entries(this.stationCards)) refs.card.classList.toggle("selected", stationId === id);
    this.stationCards[id]?.card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (id) this.showMobilePanel("factory-panel");
  }

  stationView(state, station) {
    const runtime = state.stations[station.id];
    const rate = stationRate(state, station.id);
    if (station.id === "power") {
      const supply = powerSupply(state);
      const demand = powerDemand(state);
      const short = demand > supply;
      return {
        status: short ? "underpowered" : "running",
        detail: `${formatShort(supply)} MW supply`,
        meter: Math.min(1, demand / supply),
        meterText: `Demand ${formatShort(demand)} / ${formatShort(supply)} MW`,
        hint: short ? `Plant running at ${Math.round(powerFactor(state) * 100)}%. Upgrade power.` : "Every machine level draws power.",
        label: `${formatShort(demand)}/${formatShort(supply)} MW`,
      };
    }
    if (station.id === "assembly") {
      const model = MODEL_BY_ID[runtime.building ?? state.production];
      const progress = runtime.building ? runtime.progress / model.buildSeconds : 0;
      const missing = PARTS.filter((part) => state.parts[part] < MODEL_BY_ID[state.production].parts[part]).map((part) => PART_LABELS[part].toLowerCase());
      const complexity = tankComplexity(state);
      let hint = `One ${model.name} every ${formatShort(model.buildSeconds / Math.max(rate, 0.0001))}s`;
      if (complexity > 1.001) hint += ` · complexity ×${formatShort(complexity)} from gun and armor doctrine`;
      if (runtime.status === "starved") hint = `Waiting for ${missing.join(", ")}.`;
      if (runtime.status === "blocked") hint = "Depot full. The front is at its tank limit.";
      return {
        status: runtime.status,
        detail: runtime.building ? `Building ${model.name}` : `Next: ${MODEL_BY_ID[state.production].name}`,
        meter: progress,
        meterText: `Depot ${state.depot.length}/${depotCap(state)}`,
        hint,
        label: runtime.building ? `${model.name} ${Math.round(progress * 100)}%` : STATUS_TEXT[runtime.status],
      };
    }
    const stock = station.output === "steel" ? state.resources.steel : state.parts[station.output];
    const cap = storageCap(state, station.output);
    const inputs = Object.entries(station.inputs).map(([input, amount]) => `${amount} ${input}`).join(" + ");
    const output = PART_LABELS[station.output].toLowerCase();
    let hint = inputs ? `Uses ${inputs} per ${output.replace(/s$/, "")}.` : "Raw steel for the part shops.";
    if (runtime.status === "starved") hint = "Starved for steel. Upgrade the steel mill.";
    if (runtime.status === "blocked") hint = station.id === "mill" ? "Steel yard full. Part shops can't keep up." : "Shelf full. Assembly can't keep up.";
    return {
      status: runtime.status,
      detail: `${formatShort(rate)} ${output}/s`,
      meter: stock / cap,
      meterText: `${formatShort(Math.floor(stock))}/${formatShort(cap)} ${output}`,
      hint,
      label: `${formatShort(rate)}/s`,
    };
  }

  updateStations(state) {
    for (const station of STATIONS) {
      const refs = this.stationCards[station.id];
      const view = this.stationView(state, station);
      const cost = stationUpgradeCost(state, station.id);
      setText(refs.level, `Lv ${state.stations[station.id].level}`);
      setText(refs.status, STATUS_TEXT[view.status]);
      refs.status.dataset.status = view.status;
      setText(refs.detail, view.detail);
      refs.fill.style.width = `${Math.min(100, view.meter * 100).toFixed(1)}%`;
      setText(refs.meterText, view.meterText);
      setText(refs.hint, view.hint);
      setText(refs.button, `Upgrade · ${formatShort(cost)} salvage`);
      setDisabled(refs.button, state.resources.salvage < cost);
      if (refs.select) this.updateProductionSelect(state, refs);
      this.labels[station.id] = { title: `${station.name} · Lv ${state.stations[station.id].level}`, status: view.status, detail: view.label };
    }
  }

  updateProductionSelect(state, refs) {
    const unlocked = TANK_MODELS.filter((model) => isModelUnlocked(state, model.id));
    const key = unlocked.map((model) => model.id).join(",");
    if (refs.options !== key) {
      refs.options = key;
      refs.select.replaceChildren(...unlocked.map((model) => new Option(model.name, model.id)));
    }
    if (refs.select.value !== state.production) refs.select.value = state.production;
  }

  doctrineLevelText(state, doctrine) {
    const level = doctrineLevel(state, doctrine.id);
    return doctrine.max === 1 ? (level > 0 ? "Done" : "") : `Lv ${level}${doctrine.max < 999 ? `/${doctrine.max}` : ""}`;
  }

  updateDoctrine(state) {
    for (const doctrine of DOCTRINES) {
      const refs = this.doctrineItems[doctrine.id];
      const maxed = isDoctrineMaxed(state, doctrine.id);
      const affordable = canBuyDoctrine(state, doctrine.id);
      setText(refs.level, this.doctrineLevelText(state, doctrine));
      setText(refs.button, maxed ? "Complete" : `${medalText(doctrineCost(state, doctrine.id))}`);
      setDisabled(refs.button, !affordable);
      refs.item.classList.toggle("maxed", maxed);
      refs.item.classList.toggle("affordable", affordable);
    }
    this.autoUpgrade.hidden = doctrineLevel(state, "requisition") === 0;
    this.autoUpgrade.querySelector("input").checked = state.automation.upgrades;
    this.updateRegroup(state);
  }

  isStalled(state) {
    return canPrestige(state) && secondsSinceProgress(state) > PRESTIGE.stallSeconds;
  }

  updateRegroup(state) {
    const medals = medalsForSector(state.battle.maxSector);
    const stalled = this.isStalled(state);
    setText(this.regroup.medals, `${medalText(state.prestige.medals)}`);
    let text = `Reach sector ${PRESTIGE.minSector} to earn medals.`;
    if (canPrestige(state)) {
      text = `Best sector this run: ${state.battle.maxSector}. Regrouping now pays ${medalText(medals)}; each sector further pays ${Math.round((PRESTIGE.medalGrowth - 1) * 100)}% more.`;
    }
    if (stalled) text = `The front hasn't moved for ${formatSeconds(secondsSinceProgress(state))}. The factory has hit its limit. Regroup for ${medalText(medals)} and come back stronger.`;
    setText(this.regroup.text, text);
    setText(this.regroup.button, canPrestige(state) ? `Regroup · +${medalText(medals)}` : "Regroup");
    setDisabled(this.regroup.button, !canPrestige(state));
    this.regroup.card.classList.toggle("stalled", stalled);
    if (stalled && !this.stallNotified) {
      this.stallNotified = true;
      this.toast(`The assault on sector ${state.battle.sector} has stalled. Regroup for ${medalText(medals)}, or fall back.`, "info");
    }
    if (!stalled) this.stallNotified = false;
  }

  updateArmory(state) {
    for (const model of TANK_MODELS) {
      const refs = this.modelCards[model.id];
      const unlocked = isModelUnlocked(state, model.id);
      const stats = tankStats(state, model.id);
      const statsText = [
        ["HP", formatShort(stats.hp)],
        ["Armor", formatShort(stats.armor)],
        ["Damage", formatShort(stats.damage)],
        ["DPS", formatShort(stats.damage / stats.reload)],
        ["Range", formatShort(stats.range)],
        ["Speed", formatShort(stats.speed)],
      ];
      const key = statsText.map((entry) => entry.join(":")).join("|");
      if (refs.statsText !== key) {
        refs.statsText = key;
        refs.stats.innerHTML = statsText.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join("");
      }
      refs.card.classList.toggle("locked", !unlocked);
      refs.card.classList.toggle("producing", state.production === model.id);
      if (unlocked) {
        setText(refs.button, state.production === model.id ? "In production" : "Produce this model");
        setDisabled(refs.button, state.production === model.id);
        continue;
      }
      const previous = previousModel(model.id);
      const available = isModelUnlocked(state, previous.id);
      setText(refs.button, available ? `Buy blueprints · ${formatShort(BLUEPRINT_BY_MODEL[model.id].cost)} salvage` : `Requires ${previous.name}`);
      setDisabled(refs.button, !canBuyBlueprint(state, model.id));
    }
  }

  updateSector(state) {
    const battle = state.battle;
    setText(this.sector.title, `Sector ${battle.sector} · best ${battle.maxSector}`);
    const plan = sectorPlan(battle.sector);
    this.sector.landship.hidden = !plan.reserve.some((entry) => entry.kind === "landship");
    const standing = state.units.filter((unit) => unit.side === "enemy" && !unit.reinforcement).length;
    const progress = battle.active && battle.defensesTotal > 0 ? 1 - standing / battle.defensesTotal : battle.active ? 0 : 1;
    this.sector.fill.style.width = `${(progress * 100).toFixed(1)}%`;
    const base = state.units.find((unit) => unit.side === "enemy" && ENEMY_KINDS[unit.kind].base);
    let text = "Advancing to the next sector…";
    if (battle.active) text = `${standing} defenses standing · base ${base ? Math.ceil((base.hp / base.maxHp) * 100) : 0}%`;
    setText(this.sector.text, text);
    const defensesKey = `${battle.sector}`;
    if (this.sector.defensesKey !== defensesKey) {
      this.sector.defensesKey = defensesKey;
      const counts = {};
      for (const entry of [...plan.emplacements, ...plan.reserve]) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
      const parts = Object.entries(counts).map(([kind, count]) => `${count}× ${ENEMY_KINDS[kind].name}`);
      if (plan.trenches.length > 0) parts.unshift(`${plan.trenches.length} trench line${plan.trenches.length > 1 ? "s" : ""}`);
      setText(this.sector.defenses, parts.join(" · "));
    }
    const target = offensiveTarget(state);
    if (target <= battle.sector) {
      setText(this.sector.offensive, `Offensive · retakes sectors short of your best (${state.prestige.bestSector})`);
    } else {
      setText(this.sector.offensive, `Offensive to sector ${target} · commits ${formatWhole(offensiveCost(state))} of ${formatWhole(frontStrength(state))} strength`);
    }
    setDisabled(this.sector.offensive, !canLaunchOffensive(state));
    setDisabled(this.sector.fallBack, !canFallBack(state));
  }

  updateHud(state, rates) {
    setText(this.hud.salvage, formatShort(state.resources.salvage));
    setText(this.hud.medals, formatWhole(state.prestige.medals));
    setText(this.hud.steel, `${formatShort(Math.floor(state.resources.steel))}/${formatShort(storageCap(state, "steel"))}`);
    setText(this.hud.front, `${alliesAtFront(state)} tanks`);
    setText(this.hud.power, `${formatShort(powerDemand(state))}/${formatShort(powerSupply(state))} MW`);
    this.hud.power.parentElement.classList.toggle("warn", powerFactor(state) < 1);
    setText(this.hud.salvageRate, `+${formatShort(rates.salvage)}/min`);
  }

  updateRecords(state) {
    const rows = [
      ["Best sector this run", state.battle.maxSector],
      ["Best sector ever", state.prestige.bestSector],
      ["Regroups", state.prestige.count],
      ["Offensives", formatShort(state.stats.offensives)],
      ["Tanks built", formatShort(state.stats.tanksBuilt)],
      ["Tanks lost", formatShort(state.stats.tanksLost)],
      ["Defenses and tanks destroyed", formatShort(state.stats.kills)],
      ["Salvage earned", formatShort(state.stats.salvageEarned)],
      ["Time commanding", formatSeconds(state.time)],
    ];
    const html = rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join("");
    if (this.recordsList.dataset.html !== html) {
      this.recordsList.dataset.html = html;
      this.recordsList.innerHTML = html;
    }
  }

  update(state, rates) {
    this.state = state;
    this.updateHud(state, rates);
    this.updateStations(state);
    this.updateDoctrine(state);
    this.updateArmory(state);
    this.updateSector(state);
    this.updateRecords(state);
  }

  setSaveStatus(text, failed) {
    setText(this.hud.saveStatus, text);
    this.hud.saveStatus.classList.toggle("failed", failed);
  }

  toast(text, tone = "info") {
    const node = element("div", `toast ${tone}`, text);
    this.toasts.append(node);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild.remove();
    setTimeout(() => node.classList.add("leaving"), 3600);
    setTimeout(() => node.remove(), 4200);
  }

  handleEvents(events) {
    for (const event of events) {
      if (event.type === "sectorCaptured") {
        this.toast(`Sector ${event.sector} captured · +${formatShort(event.bonus)} salvage`, "good");
      } else if (event.type === "fallBack") {
        this.toast(`Falling back to sector ${event.sector}`, "bad");
      } else if (event.type === "blueprint") {
        this.toast(`${MODEL_BY_ID[event.model].name} enters production`, "good");
      } else if (event.type === "offensive") {
        this.toast(`Offensive breaks through to sector ${event.toSector} · +${formatShort(event.salvage)} salvage`, "good");
      }
    }
  }

  showModal(title, bodyHtml, buttonText = "Continue") {
    this.modal.innerHTML = `<div class="modal-card"><h2>${title}</h2>${bodyHtml}<button type="button" class="buy">${buttonText}</button></div>`;
    this.modal.hidden = false;
    this.modal.querySelector("button").addEventListener("click", () => {
      this.modal.hidden = true;
    });
  }

  showHelp() {
    this.showModal(
      "Tank Foundry",
      `<p>Your factory builds tanks that roll out on their own to assault an endless chain of fortified positions. Every sector is deeper and tougher than the last.</p>
      <ol>
        <li><strong>Steel Mill → part shops → Assembly Hall.</strong> Steel becomes hulls, turrets and engines. The hall bolts them into tanks.</li>
        <li><strong>Find the bottleneck.</strong> Every station shows if it is running, starved for input, or blocked by a full shelf. Upgrade the one holding the line back.</li>
        <li><strong>Watch the power.</strong> Each machine level draws power. Short on power, the whole plant slows down.</li>
        <li><strong>Salvage</strong> from kills pays for station upgrades and blueprints for new models, from the Stuart up to the Maus.</li>
        <li><strong>The army is your output.</strong> Every tank built joins the assault. Each sector has trench lines that slow and expose your tanks, pillboxes, AT guns and bunkers, armor held in reserve, and a fortified base. Destroy the base to capture the sector.</li>
        <li><strong>No retreat, only attrition.</strong> Damaged defenses repair themselves and the base keeps sending armor. If the factory can't keep up, the assault stalls. Fall back a sector any time.</li>
        <li><strong>Regroup</strong> when the factory can't push further. Stations, blueprints and sectors reset, and you earn <strong>medals</strong> for your best sector. Medals buy permanent <strong>doctrine</strong>: better guns, armor and machines for every future run.</li>
        <li><strong>Offensives</strong> commit tanks to skip sectors you've beaten before, so new runs catch up fast.</li>
      </ol>
      <p class="muted">Drag to pan, scroll or pinch to zoom, right-drag to rotate. Click a building to inspect it. The factory keeps running while you are away.</p>`,
      "To the factory",
    );
  }

  showAwaySummary(summary) {
    this.showModal(
      "While you were away",
      `<p>The factory ran for ${formatSeconds(summary.seconds)}.</p>
      <dl class="records">
        <div><dt>Tanks built</dt><dd>${formatShort(summary.built)}</dd></div>
        <div><dt>Enemies destroyed</dt><dd>${formatShort(summary.kills)}</dd></div>
        <div><dt>Salvage</dt><dd>+${formatShort(summary.salvage)}</dd></div>
        <div><dt>Tanks lost</dt><dd>${formatShort(summary.lost)}</dd></div>
        <div><dt>New best sectors</dt><dd>+${summary.sectorsGained}</dd></div>
      </dl>`,
    );
  }
}
