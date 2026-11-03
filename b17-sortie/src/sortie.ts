import * as THREE from 'three';

export type PhaseId = 'cruise' | 'initial-point' | 'bomb-run' | 'bombs-away' | 'rally' | 'withdrawal';

export interface Phase {
  id: PhaseId;
  label: string;
  detail: string;
  start: number;
  end: number;
}

/** One loop of the middle of a mission: the run in from the initial point to the target and the turn for home. */
export const PHASES: readonly Phase[] = [
  { id: 'cruise', label: 'Formation cruise', detail: 'Combat box at altitude, gunners scanning for fighters.', start: 0, end: 16 },
  { id: 'initial-point', label: 'Initial point', detail: 'Turn onto the bomb-run heading. Bomb bay doors open.', start: 16, end: 24 },
  { id: 'bomb-run', label: 'Bomb run', detail: 'Bombardier flies the aircraft through the Norden sight. No evasive action through the flak.', start: 24, end: 36 },
  { id: 'bombs-away', label: 'Bombs away', detail: 'Twelve 500 lb bombs released in train.', start: 36, end: 40 },
  { id: 'rally', label: 'Rally', detail: 'Doors closed, diving turn off the target to re-form.', start: 40, end: 50 },
  { id: 'withdrawal', label: 'Withdrawal', detail: 'Heading home, flak thinning out behind.', start: 50, end: 64 },
];

export const SORTIE_LOOP_SECONDS = PHASES[PHASES.length - 1].end;
export const BOMB_COUNT = 12;
const BOMB_RELEASE_START = 36.3;
const BOMB_RELEASE_INTERVAL = 0.14;
const DOORS_OPEN = [18, 20.5] as const;
const DOORS_CLOSE = [41, 43.5] as const;
const RALLY_TURN = [41.5, 49.5] as const;
/** Mission clock reading when the loop starts: four hours and ten minutes after take-off. */
const MISSION_CLOCK_OFFSET_SECONDS = 4 * 3600 + 10 * 60;

export interface SortieState {
  time: number;
  phase: Phase;
  phaseIndex: number;
  /** 0 closed to 1 fully open. */
  bayDoors: number;
  bombsReleased: number;
  /** Flak bursts per second. */
  flakRate: number;
  /** Positive is right wing down. */
  bankRadians: number;
  pitchRadians: number;
  headingDegrees: number;
  altitudeFeet: number;
  airspeedMph: number;
  missionClockSeconds: number;
}

const smooth = (from: number, to: number, time: number) => THREE.MathUtils.smoothstep(time, from, to);

export function phaseIndexAt(time: number): number {
  const index = PHASES.findIndex((phase) => time >= phase.start && time < phase.end);
  return index < 0 ? PHASES.length - 1 : index;
}

export function sortieStateAt(time: number): SortieState {
  const phaseIndex = phaseIndexAt(time);
  const bayDoors = smooth(DOORS_OPEN[0], DOORS_OPEN[1], time) * (1 - smooth(DOORS_CLOSE[0], DOORS_CLOSE[1], time));
  const bombsReleased = THREE.MathUtils.clamp(Math.floor((time - BOMB_RELEASE_START) / BOMB_RELEASE_INTERVAL) + 1, 0, BOMB_COUNT);

  const flakRate = THREE.MathUtils.lerp(0, 0.9, smooth(17, 23, time))
    + THREE.MathUtils.lerp(0, 1.3, smooth(23, 27, time))
    - THREE.MathUtils.lerp(0, 1.5, smooth(40, 52, time))
    - THREE.MathUtils.lerp(0, 0.6, smooth(52, 58, time));

  // Formation-keeping wander, held level on the bomb run, then the banked rally turn.
  const levelHold = 1 - smooth(22, 24, time) * (1 - smooth(39, 41, time));
  const turn = Math.sin(Math.PI * THREE.MathUtils.clamp((time - RALLY_TURN[0]) / (RALLY_TURN[1] - RALLY_TURN[0]), 0, 1));
  const bankRadians = (Math.sin(time * 0.53) * 0.035 + Math.sin(time * 1.31) * 0.012) * levelHold + turn * THREE.MathUtils.degToRad(22);
  const pitchRadians = Math.sin(time * 0.41 + 1.2) * 0.012 * levelHold - turn * 0.03;

  const turnProgress = smooth(RALLY_TURN[0], RALLY_TURN[1], time);
  const ipTurn = smooth(16, 20, time);
  const headingDegrees = (95 + ipTurn * 17 + turnProgress * 168 + 360) % 360;

  return {
    time,
    phase: PHASES[phaseIndex],
    phaseIndex,
    bayDoors,
    bombsReleased,
    flakRate: Math.max(flakRate, 0),
    bankRadians,
    pitchRadians,
    headingDegrees,
    altitudeFeet: 25000 + Math.round(Math.sin(time * 0.2) * 40) - Math.round(turn * 300),
    airspeedMph: 150 + Math.round(smooth(22, 26, time) * 5 - smooth(40, 44, time) * 5 + turn * 12),
    missionClockSeconds: MISSION_CLOCK_OFFSET_SECONDS + time,
  };
}
