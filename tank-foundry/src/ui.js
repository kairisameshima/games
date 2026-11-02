import { BATTLE, ENEMY_KINDS, PART_LABELS, PARTS, RESEARCH, RESEARCH_GROUPS, STATIONS, TANK_MODELS } from "./data.js";
import { formatShort } from "./format.js";
import {
  alliesAtFront,
  canBuyResearch,
  deployCap,
  depotCap,
  isBossWave,
  isModelUnlocked,
  isResearchMaxed,
  MODEL_BY_ID,
  powerDemand,
  powerFactor,
  powerSupply,
  researchCost,
  researchLevel,
  researchRequirementsMet,
  RESEARCH_BY_ID,
  stationRate,
  stationUpgradeCost,
  storageCap,
  tankComplexity,
  tankStats,
  waveComposition,
} from "./sim.js";

const STATUS_TEXT = {
  running: "Running",
  starved: "Starved",
  blocked: "Output full",
  underpowered: "Low power",
  idle: "Idle",
};

const MODEL_UNLOCK = Object.fromEntries(RESEARCH.filter((project) => project.unlocksModel).map((project) => [project.unlocksModel, project]));

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

function recipeText(model) {
  return PARTS.map((part) => `${model.parts[part]} ${PART_LABELS[part].toLowerCase().replace(/s$/, model.parts[part] === 1 ? "" : "s")}`).join(", ");
}

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.stationCards = {};
    this.researchItems = {};
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
      <div class="brand"><span class="brand-mark">TANK FOUNDRY</span><span class="brand-tag">build · research · advance</span></div>
      <div class="resources">
        <div class="resource salvage" title="Salvage: recovered from destroyed enemies. Pays for factory upgrades."><span class="resource-label">Salvage</span><span class="resource-value" data-field="salvage"></span><span class="resource-rate" data-field="salvageRate"></span></div>
        <div class="resource intel" title="Intel: captured from enemy wrecks. Pays for research."><span class="resource-label">Intel</span><span class="resource-value" data-field="intel"></span><span class="resource-rate" data-field="intelRate"></span></div>
        <div class="resource steel" title="Steel: smelted by the steel mill and used by the part shops."><span class="resource-label">Steel</span><span class="resource-value" data-field="steel"></span></div>
        <div class="resource front" title="Tanks at the front / allowed by Logistics"><span class="resource-label">Front</span><span class="resource-value" data-field="front"></span></div>
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
    this.autoUpgrade.querySelector("input").addEventListener("change", (event) => this.handlers.toggleAutomation("upgrades", event.target.checked));
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
        <button type="button" data-tab="research" class="active">Research</button>
        <button type="button" data-tab="armory">Armory</button>
        <button type="button" data-tab="records">Records</button>
      </div>
      <div class="panel-body tab-body" data-body="research"><label class="auto-toggle" data-auto="research"><input type="checkbox"> Auto-research cheapest project</label></div>
      <div class="panel-body tab-body" data-body="armory" hidden></div>
      <div class="panel-body tab-body" data-body="records" hidden></div>`;
    for (const tab of panel.querySelectorAll("[data-tab]")) {
      tab.addEventListener("click", () => this.showTab(tab.dataset.tab));
    }
    this.commandPanel = panel;
    this.autoResearch = panel.querySelector('[data-auto="research"]');
    this.autoResearch.querySelector("input").addEventListener("change", (event) => this.handlers.toggleAutomation("research", event.target.checked));

    const researchBody = panel.querySelector('[data-body="research"]');
    for (const group of RESEARCH_GROUPS) {
      if (group.id === "armory") continue;
      const section = element("section", "research-group");
      section.append(element("h3", "", group.name));
      for (const project of RESEARCH.filter((entry) => entry.group === group.id)) section.append(this.buildResearchItem(project));
      researchBody.append(section);
    }

    const armoryBody = panel.querySelector('[data-body="armory"]');
    armoryBody.append(element("p", "panel-note", "Each blueprint is a new production model. Better tanks cost more parts and assembly time."));
    for (const model of TANK_MODELS) {
      const card = element("section", "model-card");
      card.innerHTML = `
        <header><h3>${model.name}</h3><span class="model-meta">${model.year} · ${model.role}</span></header>
        <dl class="model-stats"></dl>
        <p class="model-recipe">Needs ${recipeText(model)} · ${model.buildSeconds}s to assemble</p>
        <button type="button" class="buy"></button>`;
      const refs = { card, stats: card.querySelector(".model-stats"), button: card.querySelector(".buy"), statsText: "" };
      refs.button.addEventListener("click", () => {
        if (isModelUnlocked(this.state, model.id)) this.handlers.produce(model.id);
        else this.handlers.research(MODEL_UNLOCK[model.id].id);
      });
      this.modelCards[model.id] = refs;
      armoryBody.append(card);
    }

    const records = panel.querySelector('[data-body="records"]');
    records.innerHTML = `<dl class="records"></dl><button type="button" class="danger" data-action="reset">Reset all progress</button>`;
    this.recordsList = records.querySelector(".records");
    records.querySelector('[data-action="reset"]').addEventListener("click", () => {
      if (window.confirm("Erase the factory and start from wave 1?")) this.handlers.reset();
    });
  }

  buildResearchItem(project) {
    const item = element("article", "research-item");
    item.innerHTML = `<div class="research-text"><h4>${project.name} <span class="research-level"></span></h4><p>${project.desc}</p><p class="research-lock"></p></div><button type="button" class="buy"></button>`;
    const refs = { item, level: item.querySelector(".research-level"), lock: item.querySelector(".research-lock"), button: item.querySelector(".buy") };
    refs.button.addEventListener("click", () => this.handlers.research(project.id));
    this.researchItems[project.id] = refs;
    return item;
  }

  buildWaveBar() {
    const bar = this.root.querySelector("#wave-bar");
    bar.innerHTML = `
      <div class="wave-title"><span data-field="wave"></span><span class="boss-badge" hidden>Boss wave</span></div>
      <div class="meter wave-meter"><div class="meter-fill"></div><span class="meter-text"></span></div>
      <div class="wave-foot"><span data-field="enemies"></span><label class="auto-toggle"><input type="checkbox" data-field="advance"> Auto-advance</label></div>`;
    this.wave = {
      title: bar.querySelector('[data-field="wave"]'),
      boss: bar.querySelector(".boss-badge"),
      fill: bar.querySelector(".meter-fill"),
      text: bar.querySelector(".meter-text"),
      enemies: bar.querySelector('[data-field="enemies"]'),
      advance: bar.querySelector('[data-field="advance"]'),
      enemiesKey: "",
    };
    this.wave.advance.addEventListener("change", (event) => this.handlers.toggleAdvance(event.target.checked));
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
    for (const [panel, label] of [["factory-panel", "Factory"], ["command-panel", "Research"], ["", "Map"]]) {
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
      if (complexity > 1.001) hint += ` · complexity ×${formatShort(complexity)} from gun and armor research`;
      if (runtime.status === "starved") hint = `Waiting for ${missing.join(", ")}.`;
      if (runtime.status === "blocked") hint = "Depot full. The front is at its Logistics limit.";
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

  researchEffect(state, project) {
    const level = researchLevel(state, project.id);
    return project.max === 1 ? (level > 0 ? "Done" : "") : `Lv ${level}${project.max < 999 ? `/${project.max}` : ""}`;
  }

  updateResearch(state) {
    for (const project of RESEARCH) {
      if (project.unlocksModel) continue;
      const refs = this.researchItems[project.id];
      const requirementsMet = researchRequirementsMet(state, project.id);
      const maxed = isResearchMaxed(state, project.id);
      const cost = researchCost(state, project.id);
      setText(refs.level, this.researchEffect(state, project));
      setText(refs.lock, requirementsMet ? "" : `Requires ${project.requires.map((id) => RESEARCH_BY_ID[id].name).join(", ")}`);
      setText(refs.button, maxed ? "Complete" : `${formatShort(cost)} intel`);
      setDisabled(refs.button, maxed || !canBuyResearch(state, project.id));
      refs.item.classList.toggle("maxed", maxed);
      refs.item.classList.toggle("affordable", !maxed && canBuyResearch(state, project.id));
    }
    this.autoResearch.hidden = researchLevel(state, "bureau") === 0;
    this.autoResearch.querySelector("input").checked = state.automation.research;
    this.autoUpgrade.hidden = researchLevel(state, "requisition") === 0;
    this.autoUpgrade.querySelector("input").checked = state.automation.upgrades;
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
      const project = MODEL_UNLOCK[model.id];
      const available = researchRequirementsMet(state, project.id);
      setText(refs.button, available ? `Research blueprints · ${formatShort(project.cost)} intel` : `Requires ${RESEARCH_BY_ID[project.requires[0]].name}`);
      setDisabled(refs.button, !canBuyResearch(state, project.id));
    }
  }

  updateWave(state) {
    const battle = state.battle;
    setText(this.wave.title, `Wave ${battle.wave} · best ${battle.maxWave}`);
    this.wave.boss.hidden = !isBossWave(battle.wave);
    const enemiesLeft = state.units.filter((unit) => unit.side === "enemy").length + battle.queue.length;
    const progress = battle.active && battle.waveSize > 0 ? 1 - enemiesLeft / battle.waveSize : battle.active ? 0 : 1;
    this.wave.fill.style.width = `${(progress * 100).toFixed(1)}%`;
    const timeLeft = Math.max(0, BATTLE.waveTimeLimitSeconds - battle.elapsed);
    setText(this.wave.text, battle.active ? `${enemiesLeft} enemies left · ${Math.ceil(timeLeft)}s before the attack stalls` : "Next wave forming up…");
    const counts = {};
    for (const kind of waveComposition(battle.wave)) counts[kind] = (counts[kind] ?? 0) + 1;
    const enemiesKey = `${battle.wave}`;
    if (this.wave.enemiesKey !== enemiesKey) {
      this.wave.enemiesKey = enemiesKey;
      setText(this.wave.enemies, Object.entries(counts).map(([kind, count]) => `${count}× ${ENEMY_KINDS[kind].name}`).join(" · "));
    }
    this.wave.advance.checked = battle.autoAdvance;
  }

  updateHud(state, rates) {
    setText(this.hud.salvage, formatShort(state.resources.salvage));
    setText(this.hud.intel, formatShort(state.resources.intel));
    setText(this.hud.steel, `${formatShort(Math.floor(state.resources.steel))}/${formatShort(storageCap(state, "steel"))}`);
    setText(this.hud.front, `${alliesAtFront(state)}/${deployCap(state)}`);
    setText(this.hud.power, `${formatShort(powerDemand(state))}/${formatShort(powerSupply(state))} MW`);
    this.hud.power.parentElement.classList.toggle("warn", powerFactor(state) < 1);
    setText(this.hud.salvageRate, `+${formatShort(rates.salvage)}/min`);
    setText(this.hud.intelRate, `+${formatShort(rates.intel)}/min`);
  }

  updateRecords(state) {
    const rows = [
      ["Best wave", state.battle.maxWave],
      ["Tanks built", formatShort(state.stats.tanksBuilt)],
      ["Tanks lost", formatShort(state.stats.tanksLost)],
      ["Enemies destroyed", formatShort(state.stats.kills)],
      ["Salvage earned", formatShort(state.stats.salvageEarned)],
      ["Intel earned", formatShort(state.stats.intelEarned)],
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
    this.updateResearch(state);
    this.updateArmory(state);
    this.updateWave(state);
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
      if (event.type === "waveClear" && (isBossWave(event.wave) || event.wave % 5 === 0)) {
        this.toast(`Wave ${event.wave} cleared · +${formatShort(event.bonus)} salvage`, "good");
      } else if (event.type === "retreat") {
        const where = Math.max(1, event.wave - 1);
        this.toast(event.reason === "breach" ? `Line breached at wave ${event.wave}. Falling back to wave ${where}.` : `Attack on wave ${event.wave} stalled. Regrouping at wave ${where}.`, "bad");
      } else if (event.type === "research") {
        const project = RESEARCH_BY_ID[event.id];
        if (project.unlocksModel) this.toast(`${MODEL_BY_ID[project.unlocksModel].name} enters production`, "good");
      } else if (event.type === "kill" && event.boss) {
        this.toast("Landship destroyed!", "good");
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
      `<p>Your factory builds tanks that roll out to the front on their own. The enemy attacks in endless waves, and every wave is tougher than the last.</p>
      <ol>
        <li><strong>Steel Mill → part shops → Assembly Hall.</strong> Steel becomes hulls, turrets and engines. The hall bolts them into tanks.</li>
        <li><strong>Find the bottleneck.</strong> Every station shows if it is running, starved for input, or blocked by a full shelf. Upgrade the one holding the line back.</li>
        <li><strong>Watch the power.</strong> Each machine level draws power. Short on power, the whole plant slows down.</li>
        <li><strong>Salvage</strong> from kills pays for upgrades. <strong>Intel</strong> pays for research: stronger guns and armor, more tanks at the front, and blueprints for new models from the Stuart up to the Maus.</li>
        <li>If the enemy breaks through or the attack stalls, the front falls back one wave and keeps farming it. Bosses come every ${BATTLE.bossEvery} waves.</li>
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
        <div><dt>Intel</dt><dd>+${formatShort(summary.intel)}</dd></div>
        <div><dt>New best waves</dt><dd>+${summary.wavesGained}</dd></div>
      </dl>`,
    );
  }
}
