/**
 * Interior arrangement of the B-17G, in metres along the fuselage (`d`, aft of the nose glazing tip) and height above
 * the nose-tip axis, the same frame as `b17-dimensions.ts`.
 *
 * Sources (see reference/README.md):
 * - Compartment boundaries from the inboard profile of the USAF Standard Aircraft Characteristics sheet (27 April 1949),
 *   scaled to the 22.66 m fuselage: nose to 2.85, pilots' compartment to 5.76, bomb bay to 8.49, radio room to 10.6,
 *   waist to 16.7, tail gunner aft of that. The bomb bay lies between the wing spars, as the profile shows.
 * - The weight-and-balance arms in the EAA B-17G flight manual (pilots at arm 167.6 in, waist at 559 in, tail wheel at
 *   665 in, datum 205 in ahead of the wing root leading edge) confirm the pilot seat and waist stations to ~0.15 m.
 * - Station equipment from the B-17 Pilot's Manual (figures 21–81): panel layout, pedestal, turret, catwalk, radio
 *   operator's table, liaison set on the aft bulkhead, waist gun mounts, tail gunner's knee pads and seat.
 */

export const BULKHEADS = {
  /** No. 4: nose compartment / pilots' compartment (the crawlway passes under the cockpit floor). */
  noseToCockpit: 2.85,
  /** No. 5: front wing spar, forward end of the bomb bay. */
  frontSpar: 5.76,
  /** No. 6: rear wing spar, aft end of the bomb bay. */
  rearSpar: 8.49,
  /** No. 7: radio room / waist. */
  radioToWaist: 10.6,
  /** Waist / tail wheel well and tail gunner's crawlway. */
  waistToTail: 16.7,
} as const;

export const FLOORS = {
  /** Nose compartment floor, laid over the chin turret housing. */
  nose: { start: 0.72, end: 2.85, y: -0.66 },
  /** Crawlway from the nose under the cockpit floor up to the flight deck. */
  crawlway: { start: 2.85, end: 4.75, y: -0.66 },
  cockpit: { start: 3.05, end: 4.75, y: 0.0 },
  /** Behind the pilots, round the top turret, up to the bomb bay bulkhead. */
  flightDeck: { start: 4.75, end: 5.76, y: -0.04 },
  radioRoom: { start: 8.49, end: 10.6, y: -0.82 },
} as const;

/** Waist and tail floors follow the hull bottom up toward the tail at this clearance. */
export const WAIST_FLOOR_CLEARANCE = 0.22;
export const TAIL_FLOOR_CLEARANCE = 0.08;

export const NOSE = {
  /** Norden M-9 bombsight on its mount over the optically flat panel low in the nose glazing. */
  bombsight: { d: 0.58, eyepieceD: 0.67, eyepieceY: 0.13 },
  bombardierSeat: { d: 1.06, cushionY: -0.22 },
  /** Chin turret remote control unit, stowed against the starboard wall on its swinging arm. */
  chinControl: { d: 0.96, y: -0.14, z: 0.42 },
  navigatorTable: { start: 1.84, end: 2.62, topY: 0.06, innerZ: -0.42 },
  navigatorSeat: { d: 2.24, cushionY: -0.2, z: -0.18 },
  /** Cheek guns: the guns themselves are on the exterior list; these are their spade grips inside. */
  cheekGuns: { starboardD: 1.1, portD: 1.45 },
} as const;

export const COCKPIT = {
  panelD: 3.13,
  panel: { bottomY: 0.56, topY: 1.08, halfWidth: 0.62 },
  pedestal: { startD: 3.18, endD: 3.58, topY: 0.56, halfWidth: 0.13 },
  /** Control column base and the wheel's centre. */
  column: { d: 3.38, z: 0.38 },
  wheel: { d: 3.44, y: 0.78, radius: 0.17 },
  pedals: { d: 3.18, y: 0.24 },
  seat: { d: 3.86, cushionY: 0.45, z: 0.38 },
  armourD: 4.08,
} as const;

export const FLIGHT_DECK = {
  /** The engineer stands on the turret's platform; the dome is the exterior top turret. */
  platformY: 0.02,
  oxygenBottlesD: 6.2,
} as const;

export const BOMB_BAY = {
  catwalkY: -0.86,
  catwalkHalfWidth: 0.11,
  /** Bombs stack in two vertical racks, one each side of the catwalk: rack at `rackFrameZ`, bomb axes at `rackZ`. */
  rackFrameZ: 0.11,
  rackZ: 0.31,
  lowestTierY: -1.0,
  tierSpacing: 0.39,
  tiers: 6,
} as const;

export const RADIO_ROOM = {
  table: { start: 8.56, end: 9.22, topY: -0.07, innerZ: -0.18 },
  operatorSeat: { d: 9.5, cushionY: -0.36, z: -0.42 },
  /** Liaison transmitter on the aft bulkhead, port side. */
  transmitter: { d: 10.45, z: -0.45 },
} as const;

export const WAIST = {
  starboardGunD: 13.65,
  portGunD: 14.15,
  gunY: 0.12,
  /** Crew entrance door, starboard side aft of the waist window. */
  door: { start: 15.4, end: 16.25 },
  tailwheelD: 16.62,
} as const;

export const TAIL = {
  /** Where the tail gunner kneels: knee pads on the floor, a bicycle-type seat under him. */
  gunnerD: 21.12,
  /** Grips of the twin guns, which pivot in the Cheyenne turret at the tail. */
  gripD: 21.6,
  /** Armour plate in front of him, below the sighting window. */
  armourD: 21.48,
  /** Forward end of the two ammunition boxes on the floor either side, ahead of the gunner. */
  /** Forward end of the two ammunition boxes on the floor either side, ahead of the gunner. */
  ammunitionD: 20.05,
  /** Cheyenne mount: the muzzles stand 0.82 m beyond the tail cone, the receivers just inside it. */
  gunMuzzleD: 23.48,
  gunY: -0.06,
  gunSpacing: [-0.11, 0.11],
} as const;
