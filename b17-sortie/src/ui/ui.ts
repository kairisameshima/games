import type { StopMotionRate } from '../scene/stop-motion';
import type { NoseArtChoice } from '../scene/textures';
import { BOMB_COUNT, PHASES, type IntercomCall, type SortieState } from '../sortie';
import { RouteMap } from './route-map';

export type ViewMode = 'lab' | 'studio';
/** How the lead ship is shown: whole, cut away to the crew, or exploded into its assemblies. */
export type ShowMode = 'exterior' | 'cutaway' | 'exploded';
/** The tilt-shift slider's range, as a multiple of the film's macro depth of field; 0 is all in focus. */
export const TILT_SHIFT_STRENGTH = { min: 0, max: 2, step: 0.05, initial: 1 } as const;

export interface UiCallbacks {
  onJumpToPhase: (index: number) => void;
  onViewChange: (view: ViewMode) => void;
  onShowChange: (mode: ShowMode) => void;
  onRecordLog: () => void;
  onNoseArtChange: (choice: NoseArtChoice) => void;
  /** Replays the prologue: boarding on the hardstand and the take-off onto the stand. */
  onHardstand: () => void;
  onSoundToggle: () => void;
  onPhoto: () => void;
  onKitBench: () => void;
  onFilmRateChange: (fps: StopMotionRate) => void;
  onJitterToggle: () => void;
  /** Strength of the macro depth of field, the tilt-shift look, in `TILT_SHIFT_STRENGTH`'s range. */
  onTiltShiftChange: (strength: number) => void;
}

/** Range diamonds round the K-3 reticle, and the circle they sit on, in the reticle's 200-unit drawing. */
const RETICLE = { diamonds: 6, radius: 62, diamond: 7 } as const;

/**
 * The K-3 computing sight's reticle as the engineer sees it in the reflector glass: a centre dot inside a ring of range
 * diamonds, which close in on a fighter to frame it. Shown in the gunner's view.
 */
function gunsightReticle(): HTMLElement {
  const reticle = element('div', 'gunsight');
  const { diamonds, radius, diamond } = RETICLE;
  const marks = Array.from({ length: diamonds }, (_, index) => {
    const angle = (index / diamonds) * Math.PI * 2 - Math.PI / 2;
    const x = 100 + Math.cos(angle) * radius;
    const y = 100 + Math.sin(angle) * radius;
    return `<path d="M${x} ${y - diamond}L${x + diamond * 0.6} ${y}L${x} ${y + diamond}L${x - diamond * 0.6} ${y}Z"/>`;
  }).join('');
  reticle.innerHTML = `<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="2.6"/>${marks}</svg>`;
  return reticle;
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
  private readonly routeMap = new RouteMap();
  /** The intercom caption: who is speaking and what. */
  private readonly intercom: HTMLElement;
  private readonly intercomSpeaker: HTMLElement;
  private readonly intercomLine: HTMLElement;
  private shownCall: IntercomCall | null = null;
  /** The strike photograph's print: the frame and the photograph in it. */
  private readonly strikePhoto: HTMLElement;
  private readonly strikePhotoImage: HTMLImageElement;
  private readonly progressBars: HTMLElement[] = [];
  private readonly detail: HTMLElement;
  private readonly viewButtons: Record<ViewMode, HTMLButtonElement>;
  private readonly showButtons: Record<ShowMode, HTMLButtonElement>;
  private readonly noseArtButtons: Record<NoseArtChoice, HTMLButtonElement>;
  private readonly soundButton: HTMLButtonElement;
  private readonly kitButton: HTMLButtonElement;
  private readonly filmRateButtons: Record<StopMotionRate, HTMLButtonElement>;
  private readonly jitterButton: HTMLButtonElement;
  private readonly tiltShiftSlider: HTMLInputElement;
  private readonly tiltShiftValue: HTMLElement;
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
    titlePanel.append(readoutGrid, this.routeMap.element);

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
    hintRow('F', '12 / 24 fps');
    hintRow('J', 'hand jitter on / off');
    hintRow('H', 'hardstand: board, take off');
    hintRow('M', 'sound on / off');
    hintRow('P', 'photo: save a still · Esc back');
    hintRow('K', 'kit box and turntable');
    hintRow('G', "gunner's view: top turret sight");
    hintRow('L', 'record render log');
    hintRow('Drag', 'orbit · scroll to zoom');
    hintRow('Click', 'crew label: walk there');
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
    const filmRateToggle = element('div', 'view-toggle');
    this.filmRateButtons = {
      12: makeToggleButton(filmRateToggle, '12 fps', () => callbacks.onFilmRateChange(12)),
      24: makeToggleButton(filmRateToggle, '24 fps', () => callbacks.onFilmRateChange(24)),
    };
    this.jitterButton = makeToggleButton(filmRateToggle, 'Jitter on', callbacks.onJitterToggle);
    const tiltShiftRow = element('label', 'slider-row');
    tiltShiftRow.append(element('span', 'slider-label', 'Tilt shift'));
    this.tiltShiftSlider = element('input', 'slider');
    Object.assign(this.tiltShiftSlider, { type: 'range', min: String(TILT_SHIFT_STRENGTH.min), max: String(TILT_SHIFT_STRENGTH.max), step: String(TILT_SHIFT_STRENGTH.step) });
    this.tiltShiftSlider.addEventListener('input', () => callbacks.onTiltShiftChange(this.tiltShiftSlider.valueAsNumber));
    this.tiltShiftValue = element('span', 'slider-value');
    tiltShiftRow.append(this.tiltShiftSlider, this.tiltShiftValue);
    const hardstandToggle = element('div', 'view-toggle');
    makeToggleButton(hardstandToggle, 'Hardstand · take off', callbacks.onHardstand);
    this.kitButton = makeToggleButton(hardstandToggle, 'Kit box', callbacks.onKitBench);
    const mediaToggle = element('div', 'view-toggle');
    this.soundButton = makeToggleButton(mediaToggle, 'Sound off', callbacks.onSoundToggle);
    makeToggleButton(mediaToggle, 'Photo', callbacks.onPhoto);
    hints.append(viewToggle, showToggle, noseArtToggle, filmRateToggle, tiltShiftRow, hardstandToggle, mediaToggle, this.meterSlot, logRow);

    this.intercom = element('div', 'intercom');
    this.intercomSpeaker = element('span', 'intercom-speaker');
    this.intercomLine = element('span', 'intercom-line');
    this.intercom.append(this.intercomSpeaker, this.intercomLine);
    // Hung from the phase panel, so it sits just above it however many lines the phase's detail runs to.
    phasePanel.append(this.intercom);
    this.strikePhoto = element('figure', 'strike-photo');
    this.strikePhotoImage = element('img', '');
    this.strikePhotoImage.alt = 'Strike photograph of the bombs bursting';
    this.strikePhoto.append(this.strikePhotoImage, element('figcaption', '', 'Strike photo · 91 BG · K-21'));
    // Laid just under the title panel, however tall the panel runs.
    titlePanel.append(this.strikePhoto);
    this.loading = element('div', 'loading', 'RIGGING THE FORMATION…');
    root.append(titlePanel, phasePanel, hints, this.loading, element('div', 'photo-hint', 'Photo mode · P saves another still · Esc returns'), gunsightReticle());
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
    this.routeMap.update(state.time);
    this.strikePhoto.classList.toggle('is-on', state.strikePhotoShown && this.strikePhotoImage.src !== '');
    if (state.intercom !== this.shownCall) {
      this.shownCall = state.intercom;
      this.intercom.classList.toggle('is-on', state.intercom !== null);
      if (state.intercom) {
        this.intercomSpeaker.textContent = state.intercom.speaker;
        this.intercomLine.textContent = state.intercom.line;
      }
    }
    this.progressBars.forEach((bar, index) => {
      const phase = PHASES[index];
      const progress = index < state.phaseIndex ? 1 : index > state.phaseIndex ? 0 : (state.time - phase.start) / (phase.end - phase.start);
      bar.style.width = `${(progress * 100).toFixed(1)}%`;
    });
  }

  /** Prints the strike photograph from `url`; it is shown while the film is in its window. */
  setStrikePhoto(url: string): void {
    // Each sortie's print replaces the last; the old one's object URL is let go.
    if (this.strikePhotoImage.src.startsWith('blob:')) URL.revokeObjectURL(this.strikePhotoImage.src);
    this.strikePhotoImage.src = url;
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

  setFilmRate(fps: StopMotionRate): void {
    this.filmRateButtons[12].classList.toggle('is-active', fps === 12);
    this.filmRateButtons[24].classList.toggle('is-active', fps === 24);
  }

  setTiltShift(strength: number): void {
    this.tiltShiftSlider.valueAsNumber = strength;
    this.tiltShiftValue.textContent = `${strength.toFixed(2)}×`;
  }

  setJitter(on: boolean): void {
    this.jitterButton.textContent = on ? 'Jitter on' : 'Jitter off';
    this.jitterButton.classList.toggle('is-active', on);
  }

  setKitBench(shown: boolean): void {
    this.kitButton.classList.toggle('is-active', shown);
  }

  setSound(on: boolean): void {
    this.soundButton.textContent = on ? 'Sound on' : 'Sound off';
    this.soundButton.classList.toggle('is-active', on);
  }

  setLogStatus(text: string): void {
    this.logStatus.textContent = text;
  }

  hideLoading(): void {
    this.loading.classList.add('is-done');
  }
}
