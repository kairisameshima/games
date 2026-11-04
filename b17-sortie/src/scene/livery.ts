export type Finish = 'oliveDrab' | 'naturalMetal';

/**
 * The tail gun position: the original B-17G "stinger" (guns through the tapered tail end in canvas boots, a small
 * glazed cab over the gunner), or the Cheyenne turret that replaced it from 1944 (see `STATIONS.tailGunMount`).
 */
export type TailGunPosition = 'stinger' | 'cheyenne';

/** One ship's markings and the production features that differ between 1944 B-17Gs. */
export interface Livery {
  /** Squadron code letters, forward of the waist windows. */
  codes: string;
  /** Radio call letter, aft of the waist windows and under the tail serial. */
  letter: string;
  /** Tail serial as painted: the full serial without its first digit and hyphen (42-31909 is 231909). */
  tailSerial: string;
  finish: Finish;
  tailGunPosition: TailGunPosition;
  /** Whether the ship carries the switchable nose art and the mission tally. */
  noseArt: boolean;
}

/**
 * The lead ship carries the kit's illustrative markings: 322nd BS codes, and the serial of 42-97261, the first B-17G
 * to be fitted with the Cheyenne tail (United Air Lines' Cheyenne modification centre, 15 February 1944). Its Olive
 * Drab is the kit's choice: that block was delivered as camouflage gave way to bare metal.
 */
export const LEAD_LIVERY: Livery = {
  codes: 'LG', letter: 'K', tailSerial: '297261', finish: 'oliveDrab', tailGunPosition: 'cheyenne', noseArt: true,
};

/**
 * The wingmen are real 91st BG aircraft (b17flyingfortress.de records, from "The B-17 Flying Fortress Story"):
 * - 42-31909 "Nine-O-Nine", B-17G-30-BO, 323rd BS OR-R: delivered in January 1944, before the Cheyenne tail and the
 *   end of camouflage, so Olive Drab with the stinger.
 * - 42-102509 "The Liberty Run", B-17G-50-BO, 401st BS LL-A: unpainted aluminium with the stinger, as photographed
 *   (reference/photo-91bg-b17g-42-102509.jpg).
 */
export const WINGMAN_LIVERIES: Livery[] = [
  { codes: 'OR', letter: 'R', tailSerial: '231909', finish: 'oliveDrab', tailGunPosition: 'stinger', noseArt: false },
  { codes: 'LL', letter: 'A', tailSerial: '2102509', finish: 'naturalMetal', tailGunPosition: 'stinger', noseArt: false },
];
