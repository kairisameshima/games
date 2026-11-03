/**
 * B-17G geometry traced from the Kaboldy 3-view (see reference/README.md for method and sources).
 * Units are metres. `d` is distance aft of the nose glazing tip, `h` is height above the nose-tip axis,
 * and `s` is spanwise distance from the centreline.
 */

export const FUSELAGE_LENGTH = 22.66;
export const WING_SEMISPAN = 15.81;

/** [d, top h, bottom h, half-width]. The cockpit roof is flush with the fuselage top line, so the windscreen step is part of the hull. */
export const FUSELAGE_STATIONS: readonly (readonly [number, number, number, number])[] = [
  [0.0, 0.05, -0.04, 0.05],
  [0.1, 0.2, -0.15, 0.18],
  [0.21, 0.295, -0.26, 0.28],
  [0.41, 0.42, -0.5, 0.39],
  [0.63, 0.53, -0.7, 0.49],
  [0.81, 0.618, -0.73, 0.56],
  [1.01, 0.696, -0.76, 0.62],
  [1.25, 0.752, -0.79, 0.69],
  [1.5, 0.823, -0.83, 0.777],
  [1.75, 0.865, -0.87, 0.83],
  [2.0, 0.908, -0.92, 0.855],
  [2.4, 0.984, -0.99, 0.914],
  [2.71, 1.02, -1.075, 0.955],
  [3.0, 1.03, -1.12, 0.99],
  [3.05, 1.17, -1.13, 1.0],
  [3.24, 1.335, -1.14, 1.025],
  [3.43, 1.43, -1.15, 1.045],
  [3.62, 1.476, -1.16, 1.06],
  [4.2, 1.476, -1.18, 1.095],
  [4.7, 1.476, -1.196, 1.099],
  [5.5, 1.476, -1.221, 1.06],
  [6.5, 1.476, -1.252, 1.005],
  [7.04, 1.476, -1.27, 1.02],
  [7.6, 1.452, -1.286, 1.06],
  [8.5, 1.374, -1.286, 1.12],
  [9.5, 1.265, -1.286, 1.148],
  [9.7, 1.2, -1.286, 1.148],
  [10.5, 1.02, -1.286, 1.142],
  [11.33, 0.97, -1.28, 1.11],
  [12.5, 0.905, -1.265, 1.029],
  [13.5, 0.851, -1.216, 0.942],
  [14.5, 0.798, -1.142, 0.862],
  [15.5, 0.744, -1.062, 0.79],
  [16.5, 0.68, -0.97, 0.724],
  [17.5, 0.616, -0.879, 0.66],
  [18.5, 0.551, -0.789, 0.6],
  [19.55, 0.485, -0.698, 0.53],
  [20.5, 0.42, -0.61, 0.46],
  [21.0, 0.38, -0.566, 0.42],
  [21.67, 0.337, -0.51, 0.375],
  [22.3, 0.262, -0.438, 0.317],
  [22.66, 0.225, -0.386, 0.288],
];

/** The plexiglass nose cone runs from the tip back to this frame. */
export const NOSE_GLAZING_END = 0.78;

export const WING = {
  /** Leading and trailing edges are straight lines in `d` against `s`. */
  leadingEdge: { slope: 0.1517, intercept: 4.469 },
  trailingEdge: { slope: -0.1058, intercept: 10.486 },
  rootSpan: 1.0,
  rootChordHeight: -0.09,
  /** Chord-line dihedral from the front view. */
  dihedralDegrees: 3.0,
  rootThicknessRatio: 0.18,
  tipThicknessRatio: 0.1,
  /** Traced tip rounding: [s, leading edge d, trailing edge d]. */
  tip: [
    [14.37, 6.647, 8.966],
    [14.81, 6.717, 8.888],
    [15.18, 6.78, 8.713],
    [15.47, 6.928, 8.453],
    [15.62, 7.069, 8.249],
    [15.72, 7.21, 8.06],
    [15.79, 7.42, 7.82],
  ],
} as const;

export interface NacelleSpec {
  span: number;
  propellerD: number;
  hubTipD: number;
  cowlFrontD: number;
  cowlRearD: number;
  /** Where the nacelle's upper fairing ends on top of the wing. */
  upperFairingEndD: number;
  /** Where the lower nacelle body ends under the wing. Inboard nacelles carry the main gear, so they run past the trailing edge. */
  lowerBodyEndD: number;
  thrustLineH: number;
}

export const COWL_RADIUS = 0.72;
export const PROPELLER_RADIUS = 1.77;

export const NACELLES: readonly NacelleSpec[] = [
  { span: 2.97, propellerD: 2.82, hubTipD: 2.4, cowlFrontD: 3.11, cowlRearD: 4.51, upperFairingEndD: 7.18, lowerBodyEndD: 9.9, thrustLineH: -0.07 },
  { span: 6.51, propellerD: 3.25, hubTipD: 2.82, cowlFrontD: 3.53, cowlRearD: 5.07, upperFairingEndD: 7.18, lowerBodyEndD: 8.6, thrustLineH: 0.02 },
];

export const TAILPLANE = {
  leadingEdge: { slope: 0.235, atRoot: 16.849, rootSpan: 0.844 },
  trailingEdge: { slope: -0.0814, atRoot: 19.955, rootSpan: 0.844 },
  chordHeight: 0.3,
  rootThicknessRatio: 0.12,
  tipThicknessRatio: 0.09,
  tip: [
    [5.6, 17.966, 19.568],
    [5.82, 18.044, 19.491],
    [5.93, 18.107, 19.421],
    [6.04, 18.198, 19.33],
    [6.15, 18.339, 19.196],
    [6.25, 18.6, 18.93],
  ],
} as const;

/** Side outline of the fin: [d, h] from the dorsal fillet's start, over the top, down the rudder trailing edge. */
export const FIN_OUTLINE: readonly (readonly [number, number])[] = [
  [11.33, 1.04],
  [13.56, 1.33],
  [15.72, 1.61],
  [16.53, 1.93],
  [17.2, 2.42],
  [17.65, 2.94],
  [17.91, 3.39],
  [18.06, 3.76],
  [18.17, 4.02],
  [18.39, 4.32],
  [18.77, 4.54],
  [19.29, 4.65],
  [19.81, 4.58],
  [20.25, 4.28],
  [20.48, 3.91],
  [20.59, 3.61],
  [21.15, 0.86],
];

/** Stations of the smaller fittings, read off the side and plan views. */
export const STATIONS = {
  /**
   * Bendix chin turret, from the 3-view side and front views: a squat, round-cornered drum under the nose glazing
   * with a flat bottom and twin gun slots in its front face, and a fixed fairing tapering aft into the belly.
   */
  chinTurret: {
    d: 1.21, top: -0.7, bottom: -1.28, halfLength: 0.41, halfWidth: 0.5, bottomCornerRadius: 0.18, gunSpacing: 0.21,
    fairing: { start: 1.55, end: 2.75, bottomStart: -1.22, bottomEnd: -1.08, halfWidthStart: 0.46, halfWidthEnd: 0.12 },
  },
  cheekWindows: { start: 0.88, end: 1.41, top: 0.32, bottom: -0.25 },
  navigatorWindows: [[1.85, 2.17], [2.28, 2.59]] as const,
  navigatorWindowBand: { top: 0.32, bottom: 0.08 },
  astrodome: { d: 1.99, radius: 0.245 },
  windscreen: { start: 3.0, end: 3.62 },
  cockpitSideWindow: { start: 3.62, end: 4.67, top: 1.24, bottom: 0.9 },
  /** `gunSpacing`: centre to centre of the twin guns, whose receivers run back either side of the engineer's head. */
  topTurret: { d: 5.17, radius: 0.52, domeHeight: 0.44, gunSpacing: 0.4 },
  /** Doors span the bay between the spar bulkheads (interior/layout.ts BULKHEADS), less the bulkhead flanges. */
  bombBay: { start: 5.84, end: 8.41, halfWidth: 0.56 },
  radioHatch: { start: 8.95, end: 10.05, width: 0.62 },
  /** Sperry ball turret station, just aft of the radio-room bulkhead; its geometry lives in `ball-turret.ts`. */
  ballTurret: { d: 11.12 },
  waistWindowStarboard: { start: 13.1, end: 14.2 },
  waistWindowPort: { start: 13.6, end: 14.7 },
  waistWindowBand: { top: 0.49, bottom: -0.25 },
  fuselageInsignia: { d: 15.7, h: -0.12 },
  tailTurretHousing: { start: 19.45, end: 21.9, top: 0.86 },
  tailTurretWindows: { start: 20.6, end: 21.6, top: 0.78, bottom: 0.39 },
  antennaMast: { d: 4.1 },
} as const;
