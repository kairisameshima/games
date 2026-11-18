import "./style.css";
import { createSimulation } from "./simulation";
import { ShipScene } from "./ship";
import {
  CREW_COUNT,
  type Aim,
  type Ammo,
  type Command,
  type CrewDebug,
  type CrewMember,
  type SailOrder,
  type Side,
  type ViewMode,
} from "./types";

const emblem = `<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M22 3v27M11 13h23M8 25h29M22 5L10 23h11M25 8l9 14h-9M4 30h36l-8 9H14L4 30Z" stroke="currentColor" stroke-width="1.3"/><path d="M8 42q5-4 10 0t10 0t10 0" stroke="currentColor"/></svg>`;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div id="viewport" aria-label="Interactive three-dimensional ship. Drag to orbit, scroll to zoom, click a sailor to inspect."></div>
  <header class="masthead">
    <a class="brand" href="../" title="Back to scenes">${emblem}<span><span class="eyebrow">THE WOODEN WALL</span><strong>HMS Resolute</strong><span class="ship-class">74-gun third rate · 1786</span></span></a>
    <div class="voyage"><span class="voyage-line">THE CAPTAIN’S COMMAND</span><span id="voyage-status">Under way · English Channel</span></div>
    <div class="header-actions"><span class="live-dot"></span><span id="watch-clock">08:00:00</span><a class="text-button" href="./animations/" title="Open the animation review gallery">Animation gallery ↗</a><button id="help" class="icon-button" title="Controls and simulation guide" aria-label="Controls and simulation guide">?</button></div>
  </header>
  <div class="view-toolbar" role="group" aria-label="Ship inspection view">
    <span class="toolbar-label">INSPECT</span>
    <button data-view="exterior" class="active" aria-pressed="true">Exterior</button>
    <button data-view="cutaway" aria-pressed="false">Cutaway <kbd>C</kbd></button>
    <button data-view="xray" aria-pressed="false">X-ray <kbd>X</kbd></button>
    <span class="toolbar-divider"></span>
    <label class="deck-select"><span class="sr-only">Deck inspection</span><select id="deck"><option value="0">All decks</option><option value="4">Weather deck</option><option value="3">Upper gun deck</option><option value="2">Lower gun deck</option><option value="1">Orlop & hold</option></select></label>
    <button id="reset-view" class="icon-button" title="Reset camera" aria-label="Reset camera">↺</button>
  </div>
  <aside class="orders panel" aria-label="Captain’s orders">
    <div class="panel-title"><span class="eyebrow">01 / COMMAND</span><span class="tiny-rule"></span></div>
    <nav class="order-tabs" aria-label="Command category"><button data-tab="sailing" class="active">Sailing</button><button data-tab="gunnery">Gunnery</button><button data-tab="crew">Crew</button></nav>
    <section id="sailing" class="order-section">
      <div class="section-heading"><h2>Make sail</h2><span id="canvas-percent">62% canvas</span></div>
      <p class="muted">Orders are carried out by the topmen.</p>
      <div class="sail-options">
        <button data-sail="full"><span class="sail-symbol">▱</span><span><strong>Full sail</strong><small>All plain sail set</small></span><span class="order-mark"></span></button>
        <button data-sail="battle" class="active"><span class="sail-symbol">▱</span><span><strong>Battle sail</strong><small>Topsails & courses</small></span><span class="order-mark"></span></button>
        <button data-sail="reef"><span class="sail-symbol">▱</span><span><strong>Reef sails</strong><small>Reduce the canvas</small></span><span class="order-mark"></span></button>
        <button data-sail="furl"><span class="sail-symbol">―</span><span><strong>Furl all sails</strong><small>Take the way off her</small></span><span class="order-mark"></span></button>
      </div>
      <div class="section-heading heading-title"><h2>Helm</h2><span id="target-heading">COURSE 090°</span></div>
      <div class="helm-controls"><button id="port-helm" title="Turn 15 degrees to port">−15°</button><label><span class="sr-only">Ordered heading in degrees</span><input id="heading-input" type="number" min="0" max="359" value="90" /></label><button id="starboard-helm" title="Turn 15 degrees to starboard">+15°</button><button id="set-heading" class="primary">Set</button></div>
      <p id="sailing-note" class="footnote">The helm needs steerageway. Wind and canvas determine speed.</p>
    </section>
    <section id="gunnery" class="order-section" hidden>
      <div class="section-heading"><h2>Clear for action</h2><span id="gun-ready">0 / 74 ready</span></div>
      <button id="stations-gun" class="wide primary stations-action">Beat to quarters <kbd>B</kbd></button>
      <div class="form-row"><label for="ammo">Shot</label><select id="ammo"><option value="round">Round shot</option><option value="chain">Chain shot</option><option value="grape">Grapeshot</option></select></div>
      <div class="form-row"><label for="aim">Aim at</label><select id="aim"><option value="hull">Hull & gun decks</option><option value="rigging">Masts & rigging</option><option value="crew">Exposed crew</option></select></div>
      <p class="footnote">New shot is loaded on the next gun cycle. Broadside arc ±25°, range 600 m. Grape is effective inside 180 m.</p>
      <div class="broadside-buttons"><button data-fire="port"><span>PORT</span>Fire broadside</button><button data-fire="starboard"><span>STARBOARD</span>Fire broadside</button></div>
      <button id="fire-at-will" class="wide" aria-pressed="false">Fire at will <span class="toggle"></span></button>
      <div class="magazine"><span>MAGAZINE</span><strong id="magazine">— charges · — shot</strong></div>
      <div id="battery-readiness" class="battery-readiness" aria-label="Battery loading status"></div>
    </section>
    <section id="crew" class="order-section" hidden>
      <div class="section-heading"><h2>Ship’s company</h2><span>${CREW_COUNT} souls</span></div>
      <p class="muted">Every sailor has a station, a route, and a job.</p>
      <button id="stations-crew" class="wide primary stations-action">Beat to quarters <kbd>B</kbd></button>
      <button id="repair" class="wide" aria-pressed="false">Damage control <span class="toggle"></span></button>
      <p class="footnote">Carpenters repair the hull. Sailors man the pumps, fight fires, and tend the wounded.</p>
      <div id="role-summary" class="role-summary"></div>
      <button id="open-manifest" class="wide">Open crew manifest <span>↗</span></button>
    </section>
    <div id="orders-bottom" class="orders-bottom"><span class="status-pip"></span><span id="order-status">Watch on deck</span></div>
  </aside>
  <aside class="starboard-panels" aria-label="Tactical and crew information">
    <section class="panel tactical">
      <div class="panel-title"><span class="eyebrow">02 / TACTICAL</span><span id="wind-label">WIND — KN</span></div>
      <canvas id="tactical-chart" width="440" height="320" aria-label="Tactical plot of ship, wind, and enemy contact"></canvas>
      <div class="navigation-readings"><div><span>HEADING</span><strong id="heading">090<span>°</span></strong></div><div><span>SPEED</span><strong id="speed">0.0 <span>kn</span></strong></div></div>
      <button id="engage" class="wide encounter-button">Signal enemy encounter <span>↗</span></button>
      <div id="contact-info" hidden><div class="contact-title"><span class="hostile-dot"></span><strong id="enemy-name">L’Indomptable</strong><span id="enemy-range">— m</span></div><div class="contact-health"><span id="enemy-health"></span></div><p id="enemy-note" class="footnote">Maneuver to bring a broadside to bear.</p><button id="focus-enemy" class="text-button">Observe contact ↗</button></div>
    </section>
    <section class="panel crew-watch">
      <div class="panel-title"><span class="eyebrow">03 / LIVING CREW</span><span id="crew-alive">540</span></div>
      <div id="crew-preview"></div>
      <button id="manifest-shortcut" class="text-button">View all crew & assignments <span>↗</span></button>
    </section>
    <section id="crew-inspector" class="panel" hidden aria-live="polite"></section>
  </aside>
  <div class="scene-caption"><span class="caption-line"></span><span id="view-caption">A SEVENTY-FOUR AT SEA</span><p id="view-hint">Drag to orbit · Scroll to explore · Click a sailor to inspect</p></div>
  <footer class="instrument-deck">
    <div class="condition-group"><div class="condition"><span>HULL INTEGRITY</span><strong id="hull-value">100<small>%</small></strong><div class="meter"><i id="hull-meter"></i></div></div><div class="condition"><span>RIGGING</span><strong id="rig-value">100<small>%</small></strong><div class="meter"><i id="rig-meter"></i></div></div><div class="condition"><span>GUNS READY</span><strong id="ready-value">0<small> / 74</small></strong><div class="meter"><i id="ready-meter"></i></div></div><div class="condition"><span>CREW AT STATION</span><strong id="station-value">0<small> / 540</small></strong><div class="meter"><i id="station-meter"></i></div></div></div>
    <div class="dispatch"><span class="eyebrow">SHIP’S LOG</span><p id="last-dispatch">The morning watch has the deck.</p><button id="open-log" class="text-button" title="Open ship’s log">Read log ↗</button></div>
    <div class="time-controls"><button id="pause" title="Pause simulation (Space)" aria-label="Pause simulation">Ⅱ</button><div class="time-rates" aria-label="Simulation speed"><button data-rate="1" class="active">1×</button><button data-rate="4">4×</button><button data-rate="12">12×</button></div><span id="sim-state">LIVE SIMULATION</span></div>
  </footer>
  <button id="mobile-orders" class="mobile-toggle">Captain’s orders</button>
  <dialog id="manifest-dialog"><div class="dialog-header"><div><span class="eyebrow">HMS RESOLUTE / MUSTER BOOK</span><h2>Ship’s company</h2></div><button data-close="manifest-dialog" aria-label="Close crew manifest">×</button></div><div class="manifest-filters"><input id="crew-search" placeholder="Search name, job, or task…" aria-label="Search crew" /><label><span class="sr-only">Filter by role</span><select id="crew-role"><option value="all">All roles</option><option>gunner</option><option>topman</option><option>marine</option><option>carpenter</option><option>powder runner</option><option>officer</option><option>sailor</option></select></label></div><div class="manifest-table-wrap"><table><thead><tr><th>Sailor</th><th>Rating</th><th>Assignment</th><th>Health</th><th>Fatigue</th></tr></thead><tbody id="manifest-body"></tbody></table></div><div class="manifest-pagination"><button id="previous-page">← Previous</button><span id="manifest-count"></span><button id="next-page">Next →</button></div></dialog>
  <dialog id="log-dialog"><div class="dialog-header"><div><span class="eyebrow">HMS RESOLUTE / CAPTAIN’S RECORD</span><h2>Ship’s log</h2></div><button data-close="log-dialog" aria-label="Close ship’s log">×</button></div><div id="log-entries"></div></dialog>
  <dialog id="help-dialog"><div class="dialog-header"><div><span class="eyebrow">THE WOODEN WALL</span><h2>You have the ship.</h2></div><button data-close="help-dialog" aria-label="Close guide">×</button></div><div class="guide"><p>Command a 74-gun third rate with 540 individual crew. Orders take time: sailors walk through the decks, climb the rigging, haul canvas, and work their guns.</p><h3>Sail the ship</h3><p>Order canvas and a heading in Sailing. The wind, damage, and point of sail determine speed. Topmen must reach their yards before canvas changes. Heading is a compass bearing in degrees.</p><h3>Fight an action</h3><p>Signal an enemy encounter, then beat to quarters. Gun crews muster and work through their loading cycle. Powder runners carry charges from the magazine. Keep the contact on your beam, inside 600 metres. Order a port or starboard broadside, or fire at will. Shot type is used on the next load. Chain attacks rigging. Grape attacks crew at short range. The enemy returns fire.</p><h3>Look inside</h3><p>Cutaway opens the camera-facing side of the hull. X-ray makes the structure translucent. Select a deck to remove the levels above it. Click a visible sailor, or a manifest row, to inspect their job, destination, health, and fatigue.</p><h3>Keep her afloat</h3><p>Damage control assigns repair parties, pumps, firefighting, and care for wounded crew. Casualties reduce working crews. A shattered enemy can strike its colours. A sinking ship cannot fight.</p><div class="key-guide"><span><kbd>Space</kbd> Pause</span><span><kbd>B</kbd> Battle stations</span><span><kbd>C</kbd> Cutaway</span><span><kbd>X</kbd> X-ray</span><span><kbd>R</kbd> Reset camera</span></div><p class="footnote">A real-time, task-based simulation. Sailing and gunnery are accelerated approximations, not a naval engineering model.</p></div></dialog>
`;

export const simulation = createSimulation();
export const shipScene = new ShipScene(
  document.querySelector<HTMLDivElement>("#viewport")!,
);
Object.assign(window, { naval: { simulation, shipScene } });
let paused = false;
let rate = 1;
let selectedCrew: number | null = null;
// Result of the last debug-log copy, shown on the button for a moment.
let debugCopy: { at: number; ok: boolean } | null = null;
const DEBUG_COPY_NOTICE_MS = 2000;
let manifestPage = 0;
let lastUiTime = -1;
let lastFrame = performance.now();
const PAGE_SIZE = 40;
const chart = document.querySelector<HTMLCanvasElement>("#tactical-chart")!;
const chartContext = chart.getContext("2d")!;
const roleColors: Record<string, string> = {
  gunner: "#c77a57",
  topman: "#639aa2",
  marine: "#a45c55",
  carpenter: "#d3ae60",
  "powder runner": "#a295b8",
  officer: "#e0c17c",
  sailor: "#8aab9b",
};
const elementCache = new Map<string, HTMLElement>();

function element(id: string): HTMLElement {
  let found = elementCache.get(id);
  if (!found) {
    found = document.getElementById(id)!;
    elementCache.set(id, found);
  }
  return found;
}
function text(id: string, value: string): void {
  element(id).textContent = value;
}
function command(order: Command): void {
  simulation.command(order);
  updateInterface();
}
function headingString(value: number): string {
  return Math.round((value + 360) % 360)
    .toString()
    .padStart(3, "0");
}
function clockString(time: number): string {
  const seconds = Math.floor(time + 8 * 3600);
  return (
    `${Math.floor(seconds / 3600) % 24}`.padStart(2, "0") +
    ":" +
    `${Math.floor(seconds / 60) % 60}`.padStart(2, "0") +
    ":" +
    `${seconds % 60}`.padStart(2, "0")
  );
}
function setView(mode: ViewMode): void {
  const wasSliced = shipScene.deckLevel > 0;
  shipScene.setView(mode);
  if (mode === "exterior") {
    shipScene.setDeck(0);
    (element("deck") as HTMLSelectElement).value = "0";
    if (wasSliced) shipScene.focus("ship");
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((button) => {
      const active = button.dataset.view === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  text(
    "view-caption",
    mode === "exterior"
      ? "A SEVENTY-FOUR AT SEA"
      : mode === "cutaway"
        ? "THE WORKING SHIP / LONGITUDINAL SECTION"
        : "BENEATH THE TIMBERS / X-RAY INSPECTION",
  );
}
function selectCrew(id: number | null): void {
  const crew = simulation.state.crew.find((member) => member.id === id) ?? null;
  selectedCrew = crew?.id ?? null;
  if (crew) {
    shipScene.setDeck(0);
    (element("deck") as HTMLSelectElement).value = "0";
    setView("xray");
  }
  shipScene.selectCrew(crew);
  document.querySelectorAll<HTMLButtonElement>("#crew-preview [data-crew]").forEach((row) => {
    row.setAttribute("aria-pressed", String(Number(row.dataset.crew) === selectedCrew));
  });
  updateCrewInspector();
}

function renderCrewPreview(preview: readonly CrewMember[]): void {
  const panel = element("crew-preview");
  for (let index = 0; index < preview.length; index++) {
    const crew = preview[index];
    let row = panel.children.item(index) as HTMLButtonElement | null;
    if (!row) {
      // Periodic refreshes must not replace a button between pointer down and click.
      row = document.createElement("button");
      row.className = "crew-row";
      row.innerHTML = '<span class="role-dot"></span><span><strong></strong><small></small></span><span class="crew-moving"></span>';
      panel.append(row);
    }
    row.dataset.crew = String(crew.id);
    row.setAttribute("aria-pressed", String(crew.id === selectedCrew));
    row.querySelector<HTMLElement>(".role-dot")!.style.background = roleColors[crew.role];
    row.querySelector("strong")!.textContent = crew.name;
    row.querySelector("small")!.textContent = taskLabel(crew);
    row.querySelector(".crew-moving")!.textContent = crew.moving ? "↗" : "·";
  }
  while (panel.children.length > preview.length) panel.lastElementChild!.remove();
}
function toggleStations(): void {
  command({ type: "stations", active: !simulation.state.stations });
}
function togglePause(): void {
  paused = !paused;
  text("pause", paused ? "▶" : "Ⅱ");
  element("pause").setAttribute(
    "aria-label",
    paused ? "Resume simulation" : "Pause simulation",
  );
  text("sim-state", paused ? "SIMULATION PAUSED" : "LIVE SIMULATION");
  document.body.classList.toggle("paused", paused);
}
function orderHeading(value: number): void {
  if (!Number.isFinite(value)) return;
  const heading = ((value % 360) + 360) % 360;
  (element("heading-input") as HTMLInputElement).value = String(
    Math.round(heading),
  );
  command({ type: "heading", degrees: heading });
}
function openDialog(id: string): void {
  if (id === "manifest-dialog") renderManifest();
  if (id === "log-dialog") renderLog();
  (element(id) as HTMLDialogElement).showModal();
}

app.addEventListener("click", (event: MouseEvent): void => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button) return;
  if (button.dataset.view) setView(button.dataset.view as ViewMode);
  if (button.dataset.tab) {
    document
      .querySelectorAll<HTMLElement>(".order-section")
      .forEach((section) => {
        section.hidden = section.id !== button.dataset.tab;
      });
    document
      .querySelectorAll<HTMLButtonElement>("[data-tab]")
      .forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
  }
  if (button.dataset.sail)
    command({ type: "sails", order: button.dataset.sail as SailOrder });
  if (button.dataset.fire)
    command({ type: "fire", side: button.dataset.fire as Side });
  if (button.dataset.rate) {
    rate = Number(button.dataset.rate);
    document
      .querySelectorAll<HTMLButtonElement>("[data-rate]")
      .forEach((item) => {
        item.classList.toggle("active", item === button);
      });
  }
  if (button.dataset.close)
    (element(button.dataset.close) as HTMLDialogElement).close();
});
element("stations-gun").addEventListener("click", toggleStations);
element("stations-crew").addEventListener("click", toggleStations);
element("fire-at-will").addEventListener("click", () =>
  command({ type: "fireAtWill", active: !simulation.state.fireAtWill }),
);
element("repair").addEventListener("click", () =>
  command({ type: "repair", active: !simulation.state.repairing }),
);
element("engage").addEventListener("click", () =>
  command({ type: "engage", active: !simulation.state.enemy.active }),
);
element("ammo").addEventListener("change", (event: Event) =>
  command({
    type: "ammo",
    ammo: (event.target as HTMLSelectElement).value as Ammo,
  }),
);
element("aim").addEventListener("change", (event: Event) =>
  command({
    type: "aim",
    aim: (event.target as HTMLSelectElement).value as Aim,
  }),
);
element("deck").addEventListener("change", (event: Event): void => {
  const deck = Number((event.target as HTMLSelectElement).value);
  if (deck && shipScene.viewMode === "exterior") setView("cutaway");
  shipScene.setDeck(deck);
});
element("pause").addEventListener("click", togglePause);
element("reset-view").addEventListener("click", () => shipScene.focus("ship"));
element("focus-enemy").addEventListener("click", () =>
  shipScene.focus("enemy"),
);
element("set-heading").addEventListener("click", () =>
  orderHeading(Number((element("heading-input") as HTMLInputElement).value)),
);
element("heading-input").addEventListener(
  "keydown",
  (event: KeyboardEvent): void => {
    if (event.key === "Enter")
      orderHeading(Number((event.target as HTMLInputElement).value));
  },
);
element("port-helm").addEventListener("click", () =>
  orderHeading(simulation.state.ship.targetHeading - 15),
);
element("starboard-helm").addEventListener("click", () =>
  orderHeading(simulation.state.ship.targetHeading + 15),
);
element("help").addEventListener("click", () => openDialog("help-dialog"));
element("open-manifest").addEventListener("click", () =>
  openDialog("manifest-dialog"),
);
element("manifest-shortcut").addEventListener("click", () =>
  openDialog("manifest-dialog"),
);
element("open-log").addEventListener("click", () => openDialog("log-dialog"));
element("crew-search").addEventListener("input", (): void => {
  manifestPage = 0;
  renderManifest();
});
element("crew-role").addEventListener("change", (): void => {
  manifestPage = 0;
  renderManifest();
});
element("previous-page").addEventListener("click", (): void => {
  manifestPage = Math.max(0, manifestPage - 1);
  renderManifest();
});
element("next-page").addEventListener("click", (): void => {
  manifestPage++;
  renderManifest();
});
element("mobile-orders").addEventListener("click", (): void => {
  document.body.classList.toggle("orders-open");
});
element("manifest-body").addEventListener(
  "click",
  (event: MouseEvent): void => {
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>(
      "[data-crew]",
    );
    if (!row) return;
    selectCrew(Number(row.dataset.crew));
    (element("manifest-dialog") as HTMLDialogElement).close();
  },
);
element("manifest-body").addEventListener(
  "keydown",
  (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>(
      "[data-crew]",
    );
    if (!row) return;
    event.preventDefault();
    row.click();
  },
);
element("crew-preview").addEventListener("click", (event: MouseEvent): void => {
  const row = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-crew]",
  );
  if (row) selectCrew(Number(row.dataset.crew));
});
element("crew-inspector").addEventListener(
  "click",
  (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest("[data-deselect]"))
      selectCrew(null);
    if ((event.target as HTMLElement).closest("[data-copy-debug]") && selectedCrew !== null)
      void copyCrewDebug(selectedCrew);
  },
);
let pointerStart = { x: 0, y: 0 };
element("viewport").addEventListener(
  "pointerdown",
  (event: PointerEvent): void => {
    pointerStart = { x: event.clientX, y: event.clientY };
  },
);
element("viewport").addEventListener(
  "pointerup",
  (event: PointerEvent): void => {
    if (
      Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      ) < 5
    ) {
      const id = shipScene.pickCrew(event.clientX, event.clientY);
      if (id !== null) selectCrew(id);
    }
  },
);
document.addEventListener("keydown", (event: KeyboardEvent): void => {
  if (
    (event.target as HTMLElement).matches("input,select,textarea") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  }
  if (event.code === "KeyB") toggleStations();
  if (event.code === "KeyC")
    setView(shipScene.viewMode === "cutaway" ? "exterior" : "cutaway");
  if (event.code === "KeyX")
    setView(shipScene.viewMode === "xray" ? "exterior" : "xray");
  if (event.code === "KeyR") shipScene.focus("ship");
});
new ResizeObserver(() => shipScene.resize()).observe(element("viewport"));

function updateCrewInspector(): void {
  const panel = element("crew-inspector");
  const sailor = simulation.state.crew.find((crew) => crew.id === selectedCrew);
  panel.hidden = !sailor;
  if (!sailor) return;
  panel.innerHTML = `<div class="panel-title"><span class="eyebrow">SAILOR / ${String(sailor.id + 1).padStart(3, "0")}</span><button class="text-button" data-deselect aria-label="Deselect sailor">×</button></div><h3>${sailor.name}</h3><p class="selected-rating" style="color:${roleColors[sailor.role]}">${sailor.role}</p><div class="crew-assignment"><span>${crewActivity(sailor)}</span><strong>${sailor.health <= 0 ? "Killed in action" : sailor.task}</strong></div><div class="crew-vitals"><span>Health <b>${Math.round(sailor.health)}%</b></span><span>Fatigue <b>${Math.round(sailor.fatigue)}%</b></span></div><p class="footnote">Position ${sailor.position.x.toFixed(1)}, ${sailor.position.y.toFixed(1)}, ${sailor.position.z.toFixed(1)} m<br>Station ${sailor.station >= 0 ? sailor.station + 1 : "watch duty"} · ${sailor.speed.toFixed(1)} m/s<br>Task ${Math.round(sailor.progress * 100)}%</p>${crewDebugHtml(simulation.debugCrew(sailor.id))}`;
}
// What navigation is doing with the sailor, and every rule currently holding him back.
function crewDebugHtml(debug: CrewDebug): string {
  const { crowd, route, routeIndex } = debug.navigation;
  const waypoint = route[routeIndex];
  const lines: string[] = [];
  if (!crowd) lines.push(`Off the deck mesh · ${debug.locomotion}`);
  else if (crowd.goal) {
    const left = Math.hypot(crowd.goal.x - debug.position.x, crowd.goal.z - debug.position.z);
    lines.push(`Walking to ${crowd.goal.x.toFixed(2)}, ${crowd.goal.z.toFixed(2)} · ${left.toFixed(2)} m left · ${debug.speed.toFixed(2)} m/s`);
  } else lines.push(`Standing on deck · ${debug.speed.toFixed(2)} m/s`);
  lines.push(waypoint
    ? `Route ${routeIndex + 1}/${route.length}: ${waypoint.kind}${waypoint.passage !== undefined ? ` onto passage ${waypoint.passage}` : ""}`
    : "Route finished");
  lines.push(`${debug.nearby.length} ${debug.nearby.length === 1 ? "sailor" : "sailors"} nearby${crowd ? ` · ${crowd.neighbours.length} crowd neighbours` : ""}`);
  const holds = crewHolds(debug);
  const label = debugCopy && performance.now() - debugCopy.at < DEBUG_COPY_NOTICE_MS
    ? debugCopy.ok ? "Copied debug log" : "Copy failed, see console"
    : "Copy debug log";
  return `<div class="crew-debug">${lines.map((line) => `<p>${line}</p>`).join("")}${holds.map((hold) => `<p class="debug-hold">${hold}</p>`).join("")}<button class="debug-copy" data-copy-debug>${label}</button></div>`;
}
function crewHolds(debug: CrewDebug): string[] {
  const navigation = debug.navigation;
  const holds: string[] = [];
  if (navigation.heldForSingleFile) holds.push(`Held for single file · ${navigation.blockedSeconds.toFixed(0)} s`);
  if (navigation.landing && navigation.landing.leaderId !== debug.id) {
    const leader = navigation.landing.leaderId === null ? "nobody" : `sailor ${String(navigation.landing.leaderId + 1).padStart(3, "0")}`;
    holds.push(`Waiting for landing · ${leader} goes first · ${navigation.landing.waiting} waiting`);
  }
  if (navigation.settling) holds.push("Stepping back to his post");
  if (navigation.pendingDestination) holds.push(`No route yet · retry in ${navigation.replanInSeconds.toFixed(1)} s`);
  if (navigation.crowd?.partialPath) holds.push("Path stops short of the goal");
  return holds;
}
async function copyCrewDebug(id: number): Promise<void> {
  // Three decimals keep positions exact enough to reproduce while keeping the dump readable.
  const dump = JSON.stringify(simulation.debugCrew(id),
    (_key, value: unknown) => typeof value === "number" ? Math.round(value * 1000) / 1000 : value, 2);
  try {
    await navigator.clipboard.writeText(dump);
    debugCopy = { at: performance.now(), ok: true };
  } catch (error) {
    console.error("Copying the sailor debug log failed", error, dump);
    debugCopy = { at: performance.now(), ok: false };
  }
  updateCrewInspector();
}
function crewActivity(crew: CrewMember): string {
  if (crew.health <= 0) return "Killed in action";
  switch (crew.locomotion) {
    case "wait": return "Waiting for passage";
    case "climb": return "Climbing rigging";
    case "stairs": return "Using ladder";
    case "yard": return "Along the yard";
    case "walk": return crew.carrying ? "Carrying powder" : "On the move";
    default: return crew.task === "off watch" ? "Resting" : "At station";
  }
}
function taskLabel(crew: CrewMember): string {
  if (crew.health <= 0) return "Killed in action";
  return `${crew.moving ? crewActivity(crew) + " · " : ""}${crew.task}`;
}
function renderManifest(): void {
  const query = (
    element("crew-search") as HTMLInputElement
  ).value.toLowerCase();
  const role = (element("crew-role") as HTMLSelectElement).value;
  const crew = simulation.state.crew.filter(
    (sailor) =>
      (role === "all" || sailor.role === role) &&
      `${sailor.name} ${sailor.role} ${sailor.task} ${crewActivity(sailor)}`
        .toLowerCase()
        .includes(query),
  );
  manifestPage = Math.min(
    manifestPage,
    Math.max(0, Math.ceil(crew.length / PAGE_SIZE) - 1),
  );
  const start = manifestPage * PAGE_SIZE;
  element("manifest-body").innerHTML = crew
    .slice(start, start + PAGE_SIZE)
    .map(
      (sailor) =>
        `<tr data-crew="${sailor.id}" tabindex="0"><td><span class="role-dot" style="background:${roleColors[sailor.role]}"></span>${sailor.name}<small>No. ${String(sailor.id + 1).padStart(3, "0")}</small></td><td>${sailor.role}</td><td>${taskLabel(sailor)}<small>${sailor.station >= 0 ? `Gun ${sailor.station + 1}` : "Ship’s service"}</small></td><td>${Math.round(sailor.health)}%</td><td>${Math.round(sailor.fatigue)}%</td></tr>`,
    )
    .join("");
  text(
    "manifest-count",
    crew.length
      ? `${start + 1}–${Math.min(start + PAGE_SIZE, crew.length)} of ${crew.length} crew`
      : "No matching crew",
  );
  (element("previous-page") as HTMLButtonElement).disabled = manifestPage === 0;
  (element("next-page") as HTMLButtonElement).disabled =
    start + PAGE_SIZE >= crew.length;
}
function renderLog(): void {
  element("log-entries").innerHTML =
    [...simulation.state.log]
      .reverse()
      .map(
        (entry) =>
          `<div class="log-entry ${entry.kind}"><time>${clockString(entry.time)}</time><p>${entry.text}</p></div>`,
      )
      .join("") || '<p class="muted">The captain’s log is open.</p>';
}
function drawChart(): void {
  const context = chartContext;
  const state = simulation.state;
  const width = chart.width;
  const height = chart.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 122;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#65827c38";
  context.lineWidth = 1;
  for (const factor of [0.35, 0.7, 1]) {
    context.beginPath();
    context.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(cx - radius - 10, cy);
  context.lineTo(cx + radius + 10, cy);
  context.moveTo(cx, cy - radius - 10);
  context.lineTo(cx, cy + radius + 10);
  context.stroke();
  context.font = "15px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillStyle = "#a7b8af";
  context.fillText("N", cx, 17);
  context.fillText("S", cx, height - 5);
  context.fillText("W", cx - radius - 28, cy + 5);
  context.fillText("E", cx + radius + 28, cy + 5);
  const angle = ((state.ship.heading - 90) * Math.PI) / 180;
  context.save();
  context.translate(cx, cy);
  context.rotate(angle);
  if (state.stations) {
    context.fillStyle = "#bda47718";
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(
        0,
        0,
        radius,
        (side * Math.PI) / 2 - 0.44,
        (side * Math.PI) / 2 + 0.44,
      );
      context.closePath();
      context.fill();
    }
  }
  context.fillStyle = "#e9d5a7";
  context.beginPath();
  context.moveTo(16, 0);
  context.lineTo(-10, -7);
  context.lineTo(-14, -4);
  context.lineTo(-14, 4);
  context.lineTo(-10, 7);
  context.closePath();
  context.fill();
  context.restore();
  if (state.enemy.active) {
    const dx = state.enemy.position.x - state.ship.position.x;
    const dz = state.enemy.position.z - state.ship.position.z;
    const scale = radius / 650;
    const distance = Math.hypot(dx, dz);
    const clip = Math.min(1, 620 / Math.max(1, distance));
    const x = cx + dz * scale * clip;
    const y = cy - dx * scale * clip;
    context.fillStyle = "#dc876d";
    context.save();
    context.translate(x, y);
    context.rotate(((state.enemy.heading - 90) * Math.PI) / 180);
    context.beginPath();
    context.moveTo(11, 0);
    context.lineTo(-8, -5);
    context.lineTo(-8, 5);
    context.closePath();
    context.fill();
    context.restore();
    context.strokeStyle = "#dc876d55";
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(x, y);
    context.stroke();
    context.setLineDash([]);
  }
  const wind = ((state.wind.direction - 90) * Math.PI) / 180;
  const windX = cx + Math.cos(wind) * 96;
  const windY = cy + Math.sin(wind) * 96;
  context.save();
  context.translate(windX, windY);
  context.rotate(wind + Math.PI);
  context.strokeStyle = "#73aeb2";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-12, 0);
  context.lineTo(12, 0);
  context.lineTo(5, -5);
  context.moveTo(12, 0);
  context.lineTo(5, 5);
  context.stroke();
  context.restore();
}
function updateInterface(): void {
  const state = simulation.state;
  const ship = state.ship;
  const ready = state.guns.filter((gun) => gun.phase === "ready").length;
  const alive = state.crew.filter((crew) => crew.health > 0).length;
  const arrived = state.crew.filter(
    (crew) => crew.health > 0 && !crew.moving && crew.task !== "off watch",
  ).length;
  text("watch-clock", clockString(state.time));
  text("heading", `${headingString(ship.heading)}°`);
  text("speed", `${ship.speed.toFixed(1)} kn`);
  text("target-heading", `COURSE ${headingString(ship.targetHeading)}°`);
  if (document.activeElement !== element("heading-input")) {
    (element("heading-input") as HTMLInputElement).value = String(
      Math.round(ship.targetHeading),
    );
  }
  text("canvas-percent", `${Math.round(ship.sail * 100)}% canvas`);
  text("wind-label", `WIND ${Math.round(state.wind.speed)} KN`);
  text("hull-value", `${Math.max(0, Math.round(ship.hull))}%`);
  text("rig-value", `${Math.max(0, Math.round(ship.rigging))}%`);
  text("ready-value", `${ready} / ${state.guns.length}`);
  text("station-value", `${arrived} / ${alive}`);
  element("hull-meter").style.width = `${Math.max(0, ship.hull)}%`;
  element("rig-meter").style.width = `${Math.max(0, ship.rigging)}%`;
  element("ready-meter").style.width = `${(ready / state.guns.length) * 100}%`;
  element("station-meter").style.width = `${(arrived / CREW_COUNT) * 100}%`;
  text("gun-ready", `${ready} / ${state.guns.length} ready`);
  element("battery-readiness").innerHTML = (["port", "starboard"] as const)
    .map((side) => {
      const guns = state.guns.filter((gun) => gun.side === side);
      const sideReady = guns.filter((gun) => gun.phase === "ready").length;
      return `<div><span>${side}</span><div class="battery-dots">${guns.map((gun) => `<i class="${gun.phase === "ready" ? "ready" : gun.phase === "unmanned" ? "unmanned" : "loading"}" title="Gun ${gun.id + 1}: ${gun.phase}, ${Math.round(gun.progress * 100)}%"></i>`).join("")}</div><b>${sideReady}/${guns.length}</b></div>`;
    })
    .join("");
  text("crew-alive", `${alive} / ${CREW_COUNT}`);
  text(
    "magazine",
    `${Math.floor(state.powder)} charges · ${Math.floor(state.shot)} shot`,
  );
  text(
    "order-status",
    ship.sunk
      ? "Ship lost"
      : state.stations
        ? "General quarters"
        : "Watch on deck",
  );
  element("orders-bottom").classList.toggle("battle", state.stations);
  document
    .querySelectorAll<HTMLButtonElement>(".stations-action")
    .forEach((button) => {
      button.innerHTML = `${state.stations ? "Stand down" : "Beat to quarters"} <kbd>B</kbd>`;
      button.classList.toggle("danger", state.stations);
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-sail]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.sail === ship.sailOrder),
    );
  for (const [id, active] of [
    ["fire-at-will", state.fireAtWill],
    ["repair", state.repairing],
  ] as const) {
    element(id).classList.toggle("enabled", active);
    element(id).setAttribute("aria-pressed", String(active));
  }
  text(
    "voyage-status",
    ship.sunk
      ? "Resolute is sinking"
      : state.enemy.surrendered
        ? "The enemy has struck her colours"
        : state.enemy.active
          ? "Enemy in sight · Action stations"
          : "Under way · English Channel",
  );
  element("contact-info").hidden = !state.enemy.active;
  element("engage").hidden = state.enemy.active;
  if (state.enemy.active) {
    const range = Math.hypot(
      state.enemy.position.x - ship.position.x,
      state.enemy.position.z - ship.position.z,
    );
    text("enemy-name", state.enemy.name);
    text("enemy-range", `${Math.round(range)} m`);
    element("enemy-health").style.width = `${Math.max(0, state.enemy.hull)}%`;
    text(
      "enemy-note",
      state.enemy.surrendered
        ? "Colours struck. The action is won."
        : state.enemy.sunk
          ? "Enemy sinking."
          : `Hull ${Math.round(state.enemy.hull)}% · Rig ${Math.round(state.enemy.rigging)}% · ${state.hits} hits`,
    );
  }
  const preview = [
    state.crew.find((crew) => crew.role === "officer" && crew.health > 0),
    state.crew.find(
      (crew) =>
        crew.role === "topman" &&
        crew.health > 0 &&
        (crew.moving || crew.task === "aloft"),
    ) ?? state.crew.find((crew) => crew.role === "topman"),
    state.crew.find((crew) => crew.role === "gunner" && crew.health > 0),
    state.crew.find((crew) => crew.role === "powder runner" && crew.health > 0),
  ].filter((crew): crew is CrewMember => Boolean(crew));
  renderCrewPreview(preview);
  const roles = Object.keys(roleColors);
  element("role-summary").innerHTML = roles
    .map(
      (role) =>
        `<div><span><i class="role-dot" style="background:${roleColors[role]}"></i>${role}</span><b>${state.crew.filter((crew) => crew.role === role && crew.health > 0).length}</b></div>`,
    )
    .join("");
  if (state.log.length)
    text("last-dispatch", state.log[state.log.length - 1].text);
  text(
    "sailing-note",
    ship.fire > 0.1 || ship.flooding > 0.1
      ? `Fire ${ship.fire.toFixed(1)} · Flooding ${ship.flooding.toFixed(1)}. Order damage control.`
      : ship.sail !== ship.targetSail
        ? "Topmen are carrying out your sail order."
        : "The helm needs steerageway. Wind and canvas determine speed.",
  );
  updateCrewInspector();
  if ((element("manifest-dialog") as HTMLDialogElement).open) renderManifest();
  if ((element("log-dialog") as HTMLDialogElement).open) renderLog();
  drawChart();
}
function animate(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (!paused) {
    let remaining = delta * rate;
    while (remaining > 0) {
      const step = Math.min(0.1, remaining);
      simulation.update(step);
      remaining -= step;
    }
  }
  shipScene.update(simulation.state, paused ? 0 : delta * rate);
  if (now - lastUiTime > 250) {
    updateInterface();
    lastUiTime = now;
  }
  requestAnimationFrame(animate);
}
updateInterface();
requestAnimationFrame(animate);
