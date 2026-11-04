import type { NoseArtChoice } from '../scene/textures';
import { BOMB_COUNT, PHASES, type SortieState } from '../sortie';

export type ViewMode = 'lab' | 'studio';
/** How the lead ship is shown: whole, cut away to the crew, or exploded into its assemblies. */
export type ShowMode = 'exterior' | 'cutaway' | 'exploded';

export interface UiCallbacks {
  onJumpToPhase: (index: number) => void;
  onViewChange: (view: ViewMode) => void;
  onShowChange: (mode: ShowMode) => void;
  onRecordLog: () => void;
  onNoseArtChange: (choice: NoseArtChoice) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class Ui {
  private readonly readouts: Record<'clock' | 'altitude' | 'airspeed' | 'heading' | 'bay' | 'load', HTMLElement>;
  private readonly chips: HTMLButtonElement[] = [];
  private readonly progressBars: HTMLElement[] = [];
  private readonly detail: HTMLElement;
  private readonly viewButtons: Record<ViewMode, HTMLButtonElement>;
  private readonly showButtons: Record<ShowMode, HTMLButtonElement>;
  private readonly noseArtButtons: Record<NoseArtChoice, HTMLButtonElement>;
  private readonly loading: HTMLElement;
  private readonly playState: HTMLElement;
  /** Bottom row of the controls panel, for the frame-rate meter. */
  readonly meterSlot: HTMLElement;
  private readonly logStatus: HTMLElement;
  private shownPhase = -1;

  constructor(root: HTMLElement, callbacks: UiCallbacks) {
    const titlePanel = element('div', 'panel title-panel');
    titlePanel.append(
      element('div', 'eyebrow', '91st Bomb Group · mid sortie'),
      element('div', 'title', 'B-17G Flying Fortress'),
      element('div', 'subtitle', 'Built from the Kaboldy 3-view and wartime photographs. Olive Drab over Neutral Gray, Triangle A, 1944.'),
    );
    const readoutGrid = element('div', 'readouts');
    const addReadout = (label: string) => {
      const cell = element('div', '');
      const value = element('div', 'readout-value', '—');
      cell.append(element('div', 'readout-label', label), value);
      readoutGrid.append(cell);
      return value;
    };
    this.readouts = {
      clock: addReadout('Mission time'),
      altitude: addReadout('Altitude'),
      airspeed: addReadout('Indicated airspeed'),
      heading: addReadout('Heading'),
      bay: addReadout('Bomb bay'),
      load: addReadout('Bomb load'),
    };
    titlePanel.append(readoutGrid);

    const phasePanel = element('div', 'panel phase-panel');
    const phaseRow = element('div', 'phase-row');
    PHASES.forEach((phase, index) => {
      const chip = element('button', 'phase-chip');
      chip.type = 'button';
      chip.append(element('span', 'chip-index', String(index + 1).padStart(2, '0')), element('span', 'chip-label', phase.label));
      const progress = element('span', 'chip-progress');
      chip.append(progress);
      chip.addEventListener('click', () => callbacks.onJumpToPhase(index));
      phaseRow.append(chip);
      this.chips.push(chip);
      this.progressBars.push(progress);
    });
    this.detail = element('div', 'phase-detail');
    phasePanel.append(phaseRow, this.detail);

    const hints = element('div', 'panel hints');
    this.playState = element('span', '', 'pause');
    const hintRow = (key: string, label: HTMLElement | string) => {
      hints.append(element('span', 'key', key), typeof label === 'string' ? element('span', '', label) : label);
    };
    hintRow('Space', this.playState);
    hintRow('← →', 'previous / next phase');
    hintRow('V', 'lab / studio');
    hintRow('C', 'cutaway');
    hintRow('E', 'exploded');
    hintRow('N', 'nose art');
    hintRow('L', 'record render log');
    hintRow('Drag', 'orbit · scroll to zoom');
    const makeToggleButton = (toggle: HTMLElement, label: string, onClick: () => void) => {
      const button = element('button', '', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      toggle.append(button);
      return button;
    };
    const viewToggle = element('div', 'view-toggle');
    this.viewButtons = {
      lab: makeToggleButton(viewToggle, 'Lab', () => callbacks.onViewChange('lab')),
      studio: makeToggleButton(viewToggle, 'Studio', () => callbacks.onViewChange('studio')),
    };
    const showToggle = element('div', 'view-toggle');
    this.showButtons = {
      exterior: makeToggleButton(showToggle, 'Exterior', () => callbacks.onShowChange('exterior')),
      cutaway: makeToggleButton(showToggle, 'Cutaway', () => callbacks.onShowChange('cutaway')),
      exploded: makeToggleButton(showToggle, 'Exploded', () => callbacks.onShowChange('exploded')),
    };
    const noseArtToggle = element('div', 'view-toggle');
    this.noseArtButtons = {
      pinup: makeToggleButton(noseArtToggle, 'Pin-up', () => callbacks.onNoseArtChange('pinup')),
      card: makeToggleButton(noseArtToggle, 'Card', () => callbacks.onNoseArtChange('card')),
    };
    this.meterSlot = element('div', 'meter-slot');
    const logRow = element('div', 'log-row');
    const logToggle = element('div', 'view-toggle');
    makeToggleButton(logToggle, 'Record render log', callbacks.onRecordLog);
    this.logStatus = element('div', 'log-status', 'about 40 s, then saves a .json');
    logRow.append(logToggle, this.logStatus);
    hints.append(viewToggle, showToggle, noseArtToggle, this.meterSlot, logRow);

    this.loading = element('div', 'loading', 'RIGGING THE FORMATION…');
    root.append(titlePanel, phasePanel, hints, this.loading);
  }

  update(state: SortieState): void {
    this.readouts.clock.textContent = formatClock(state.missionClockSeconds);
    this.readouts.altitude.textContent = `${state.altitudeFeet.toLocaleString('en-US')} ft`;
    this.readouts.airspeed.textContent = `${state.airspeedMph} mph`;
    this.readouts.heading.textContent = `${String(Math.round(state.headingDegrees) % 360).padStart(3, '0')}°`;
    const bayLabel = state.bayDoors <= 0.001 ? 'Closed' : state.bayDoors >= 0.999 ? 'Open' : 'Moving';
    this.readouts.bay.textContent = bayLabel;
    this.readouts.bay.classList.toggle('is-alert', bayLabel !== 'Closed');
    this.readouts.load.textContent = `${BOMB_COUNT - state.bombsReleased} × 500 lb`;

    if (state.phaseIndex !== this.shownPhase) {
      this.shownPhase = state.phaseIndex;
      this.chips.forEach((chip, index) => chip.classList.toggle('is-active', index === state.phaseIndex));
      this.detail.textContent = state.phase.detail;
    }
    this.progressBars.forEach((bar, index) => {
      const phase = PHASES[index];
      const progress = index < state.phaseIndex ? 1 : index > state.phaseIndex ? 0 : (state.time - phase.start) / (phase.end - phase.start);
      bar.style.width = `${(progress * 100).toFixed(1)}%`;
    });
  }

  setPlaying(playing: boolean): void {
    this.playState.textContent = playing ? 'pause' : 'play';
  }

  setView(view: ViewMode): void {
    this.viewButtons.lab.classList.toggle('is-active', view === 'lab');
    this.viewButtons.studio.classList.toggle('is-active', view === 'studio');
  }

  setShow(mode: ShowMode): void {
    for (const [button, element] of Object.entries(this.showButtons)) element.classList.toggle('is-active', button === mode);
  }

  setNoseArt(choice: NoseArtChoice): void {
    for (const [button, element] of Object.entries(this.noseArtButtons)) element.classList.toggle('is-active', button === choice);
  }

  setLogStatus(text: string): void {
    this.logStatus.textContent = text;
  }

  hideLoading(): void {
    this.loading.classList.add('is-done');
  }
}
