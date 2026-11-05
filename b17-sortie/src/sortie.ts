import * as THREE from 'three';

export type PhaseId = 'cruise' | 'fighters' | 'initial-point' | 'bomb-run' | 'flak-hit' | 'bombs-away' | 'rally' | 'withdrawal' | 'landing' | 'debrief';

export interface Phase {
  id: PhaseId;
  label: string;
  detail: string;
  start: number;
  end: number;
}

/**
 * The mission from the cruise in: the fighters, the run in from the initial point to the target, the turn for home, and
 * the landing back at the hardstand; after the debrief the film goes round to the boarding again.
 */
export const PHASES: readonly Phase[] = [
  { id: 'cruise', label: 'Formation cruise', detail: 'Combat box at altitude, gunners scanning for fighters.', start: 0, end: 10 },
  { id: 'fighters', label: 'Fighter attack', detail: 'Fighters press in on the box. Every gun that bears answers; the box holds formation for mutual fire.', start: 10, end: 24 },
  { id: 'initial-point', label: 'Initial point', detail: 'Turn onto the bomb-run heading. Bomb bay doors open.', start: 24, end: 32 },
  { id: 'bomb-run', label: 'Bomb run', detail: 'Bombardier flies the aircraft through the Norden sight. No evasive action through the flak.', start: 32, end: 39 },
  { id: 'flak-hit', label: 'Flak hit', detail: 'A burst under the right wing holes the skin and sets No. 3 engine on fire. The co-pilot leans to the panel and holds its feathering button in, then its extinguisher is fired; it trails black smoke. The run holds.', start: 39, end: 44 },
  { id: 'bombs-away', label: 'Bombs away', detail: 'Twelve 500 lb bombs released in train.', start: 44, end: 48 },
  { id: 'rally', label: 'Rally', detail: 'Doors closed, diving turn off the target to re-form.', start: 48, end: 58 },
  { id: 'withdrawal', label: 'Withdrawal', detail: 'Heading home, flak thinning out behind.', start: 58, end: 72 },
  { id: 'landing', label: 'Landing', detail: 'Home on three engines: gear down over the field, a long flat approach with No. 3 feathered, and the taxi back to the hardstand.', start: 72, end: 86 },
  { id: 'debrief', label: 'Debrief', detail: 'Engines cut on the hardstand. The crew go in to interrogation; the crew chief adds one more bomb to the mission tally.', start: 86, end: 94 },
];

export const SORTIE_LOOP_SECONDS = PHASES[PHASES.length - 1].end;
export const BOMB_COUNT = 12;
const BOMB_RELEASE_START = 44.3;
/** The first fighters close in a second into the attack; the last break away just before the turn at the IP. */
const GUNFIRE = { opens: [10.6, 11.6], ceases: [22.4, 23.6] } as const;
const BOMB_RELEASE_INTERVAL = 0.14;
const DOORS_OPEN = [26, 28.5] as const;
/**
 * The burst that hits the lead; No. 3 catches fire at once, is feathered, and its fire extinguisher puts the flames out
 * over `fireOut`; the smoke trails on until `smokeUntil`.
 */
const FLAK_HIT = { at: 39.3, catches: 0.4, featheredAt: 40.8, fireOut: [43.5, 45.5], smokeUntil: 49, streaksBuild: 5 } as const;
/** Film time of the burst that hits the lead. */
export const FLAK_HIT_SECONDS = FLAK_HIT.at;
/** When No. 3's fire extinguisher is fired. */
export const EXTINGUISHER_SECONDS = FLAK_HIT.fireOut[0];

const DOORS_CLOSE = [49, 51.5] as const;
/** The landing: when the lead leaves its stand for the field, and when it is down; altitude and speed run off over it. */
const LANDING = { start: 72, down: 81 } as const;
/** When chaff goes down the chute: through the flak, from the IP to bombs away. */
const CHAFF = { from: 28, to: 45 } as const;
/** When the crew chief has the new bomb on the tally. */
const TALLY_ADDED_AT = 89.5;
const RALLY_TURN = [49.5, 57.5] as const;
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
  /** 0..1: how hard the formation's gunners are firing at the attacking fighters. */
  gunfire: number;
  /** The lead has been hit: its skin is holed. */
  flakHit: boolean;
  /** No. 3 engine trails smoke. */
  engineSmoking: boolean;
  /** How hard No. 3 is burning, 0 out to 1 well alight. */
  engineFire: number;
  /** How far the oil and soot from No. 3 have built up over its nacelle and the wing, 0 clean to 1. */
  oilStreaks: number;
  /** No. 3 engine's propeller is feathered and stopped. */
  propellerFeathered: boolean;
  /** Hit and not yet feathered, No. 3 runs rough. */
  engineSputtering: boolean;
  /** Positive is right wing down. */
  bankRadians: number;
  pitchRadians: number;
  headingDegrees: number;
  altitudeFeet: number;
  airspeedMph: number;
  missionClockSeconds: number;
  /** Seconds since the lead left its stand to land, or null while the mission is still in the air. */
  landingSeconds: number | null;
  /** The bomb for this mission is on the tally. */
  tallyAdded: boolean;
  /** The radio operator is throwing chaff down the chute: from the turn at the IP to bombs away. */
  chaffing: boolean;
  /** The intercom call being heard, if any. */
  intercom: IntercomCall | null;
}

/** One call on the intercom: who, what, and when in the film it is heard. */
export interface IntercomCall { at: number; speaker: string; line: string }

/** How long a call stays up as a caption, film seconds. */
const INTERCOM_SECONDS = 3.4;

/**
 * The crew's calls through the mission, in the 8th Air Force's intercom form (station to station, clock positions for
 * fighters), timed to what the film shows.
 */
export const INTERCOM: readonly IntercomCall[] = [
  { at: 1.5, speaker: 'Navigator', line: 'Navigator to pilot: forty minutes to the IP.' },
  { at: 5.5, speaker: 'Pilot', line: 'Pilot to crew: oxygen check. Call in.' },
  { at: 10.3, speaker: 'Top turret', line: 'Bandits, twelve o\'clock high! Coming through!' },
  { at: 14.5, speaker: 'Ball turret', line: 'One going under us, low at six.' },
  { at: 21.4, speaker: 'Tail', line: 'Got him! He\'s smoking, he\'s going down!' },
  { at: 25, speaker: 'Navigator', line: 'IP. Turning onto the bomb run.' },
  { at: 28.6, speaker: 'Bombardier', line: 'Bomb doors open.' },
  { at: 32.2, speaker: 'Pilot', line: 'She\'s all yours, bombardier.' },
  { at: 35.6, speaker: 'Radio operator', line: 'Chaff going out the chute.' },
  { at: 39.5, speaker: 'Co-pilot', line: 'Number three\'s hit, she\'s burning! Feathering three.' },
  { at: 43.4, speaker: 'Engineer', line: 'Fire\'s out on three.' },
  { at: 44.3, speaker: 'Bombardier', line: 'Bombs away!' },
  { at: 49.3, speaker: 'Pilot', line: 'Doors closed. Rallying right.' },
  { at: 58.4, speaker: 'Navigator', line: 'Heading home, two-eight-zero.' },
  { at: 74.5, speaker: 'Pilot', line: 'Gear coming down. Three engines, we\'ll make it.' },
  { at: 81.4, speaker: 'Co-pilot', line: 'We\'re down.' },
  { at: 89.5, speaker: 'Crew chief', line: 'One more on the tally.' },
];

const smooth = (from: number, to: number, time: number) => THREE.MathUtils.smoothstep(time, from, to);

export function phaseIndexAt(time: number): number {
  const index = PHASES.findIndex((phase) => time >= phase.start && time < phase.end);
  return index < 0 ? PHASES.length - 1 : index;
}

export function sortieStateAt(time: number): SortieState {
  const phaseIndex = phaseIndexAt(time);
  const bayDoors = smooth(DOORS_OPEN[0], DOORS_OPEN[1], time) * (1 - smooth(DOORS_CLOSE[0], DOORS_CLOSE[1], time));
  const bombsReleased = THREE.MathUtils.clamp(Math.floor((time - BOMB_RELEASE_START) / BOMB_RELEASE_INTERVAL) + 1, 0, BOMB_COUNT);

  const flakRate = THREE.MathUtils.lerp(0, 0.9, smooth(25, 31, time))
    + THREE.MathUtils.lerp(0, 1.3, smooth(31, 35, time))
    - THREE.MathUtils.lerp(0, 1.5, smooth(48, 60, time))
    - THREE.MathUtils.lerp(0, 0.6, smooth(60, 66, time));

  // Formation-keeping wander, held level on the bomb run, then the banked rally turn.
  const levelHold = 1 - smooth(30, 32, time) * (1 - smooth(47, 49, time));
  const turn = Math.sin(Math.PI * THREE.MathUtils.clamp((time - RALLY_TURN[0]) / (RALLY_TURN[1] - RALLY_TURN[0]), 0, 1));
  const bankRadians = (Math.sin(time * 0.53) * 0.035 + Math.sin(time * 1.31) * 0.012) * levelHold + turn * THREE.MathUtils.degToRad(22);
  const pitchRadians = Math.sin(time * 0.41 + 1.2) * 0.012 * levelHold - turn * 0.03;

  const turnProgress = smooth(RALLY_TURN[0], RALLY_TURN[1], time);
  const ipTurn = smooth(24, 28, time);
  const headingDegrees = (95 + ipTurn * 17 + turnProgress * 168 + 360) % 360;

  return {
    time,
    phase: PHASES[phaseIndex],
    phaseIndex,
    bayDoors,
    bombsReleased,
    flakRate: Math.max(flakRate, 0),
    gunfire: smooth(GUNFIRE.opens[0], GUNFIRE.opens[1], time) * (1 - smooth(GUNFIRE.ceases[0], GUNFIRE.ceases[1], time)),
    flakHit: time >= FLAK_HIT.at,
    engineSmoking: time >= FLAK_HIT.at && time < FLAK_HIT.smokeUntil,
    engineFire: smooth(FLAK_HIT.at, FLAK_HIT.at + FLAK_HIT.catches, time) * (1 - smooth(FLAK_HIT.fireOut[0], FLAK_HIT.fireOut[1], time)),
    propellerFeathered: time >= FLAK_HIT.featheredAt,
    engineSputtering: time >= FLAK_HIT.at && time < FLAK_HIT.featheredAt,
    oilStreaks: smooth(FLAK_HIT.at, FLAK_HIT.at + FLAK_HIT.streaksBuild, time),
    bankRadians,
    pitchRadians,
    headingDegrees,
    altitudeFeet: Math.round((25000 + Math.sin(time * 0.2) * 40 - turn * 300) * (1 - smooth(LANDING.start, LANDING.down, time))),
    airspeedMph: Math.round((150 + smooth(30, 34, time) * 5 - smooth(48, 52, time) * 5 + turn * 12) * (1 - smooth(LANDING.start + 4, LANDING.down + 3, time))),
    missionClockSeconds: MISSION_CLOCK_OFFSET_SECONDS + time,
    landingSeconds: time >= LANDING.start ? time - LANDING.start : null,
    tallyAdded: time >= TALLY_ADDED_AT,
    chaffing: time >= CHAFF.from && time < CHAFF.to,
    intercom: INTERCOM.find((call) => time >= call.at && time < call.at + INTERCOM_SECONDS) ?? null,
  };
}
