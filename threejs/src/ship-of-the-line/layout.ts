import { DECK_HEIGHTS, MAST_X, YARD_HEIGHTS, type Vec3 } from "./types";

export const CREW_RADIUS = .23;
export const LAUNCH_OFFSET_Z = -1.9;
export const LAUNCH_OFFSET_X = 4;
export const LAUNCH_RISE = .2;
export const BOAT_SKID_X = [-3.4, 1.6] as const;
export const WALKABLE_DECKS = [...DECK_HEIGHTS, 10.4] as const;
export const RIGGING_LANE_X = .8;
export const RIGGING_LANE_Z = .3;
export const WORK_ROPE_OFFSET = .65;
export const RETURN_ROPE_OFFSET = 1.6;
export const SQUARE_SAIL_YARDS = [
  { mast: 0, level: 0 }, { mast: 1, level: 0 },
  { mast: 0, level: 1 }, { mast: 1, level: 1 }, { mast: 2, level: 1 },
  { mast: 0, level: 2 }, { mast: 1, level: 2 }, { mast: 2, level: 2 },
] as const;
// Distance the carriage/barrel pivot sits forward of the gun station, in model space;
// shared with the renderer so barrel geometry and shot origins agree.
export const GUN_MOUNT_FORWARD = .95;

// Sea surface in model-space: the rendered hull root is lowered by this much so the
// waterline sits at world y=0. Keep simulation-side model-to-world conversions in sync.
export const DESIGN_WATERLINE = 1.8;
// Weather deck (index 3) is a full-width platform fore of the forecastle break and aft of
// the quarterdeck break; between them the waist is open to the upper gun deck and only the
// side gangways (|z| >= GANGWAY_INNER_Z) carry a walkable/renderable surface.
export const QUARTERDECK_END = -4.5;
export const FORECASTLE_START = 15;
export const GANGWAY_INNER_Z = 4.4;
// Poop deck (index 4) only exists within this x-range.
export const POOP_BOUNDS = { minX: -28.5, maxX: -19.5 } as const;

export interface DeckLadder {
  id: number;
  lowerDeck: number;
  upperDeck: number;
  lower: Vec3;
  start: Vec3;
  end: Vec3;
  upper: Vec3;
  centerX: number;
  z: number;
  direction: number;
  halfWidth: number;
  // A lane of a two-way ladder only ever carries traffic in this direction (1 = up).
  flow?: 1 | -1;
  // A ladder that becomes one-way in this direction while the ship is at quarters.
  orderedFlow?: 1 | -1;
}
export interface DeckObstacle { minX: number; maxX: number; minZ: number; maxZ: number }
export interface GunDimensions { axisHeight: number; lengthScale: number; widthScale: number }
export interface GunStation {
  deck: number;
  side: "port" | "starboard";
  position: Vec3;
  calibre: 32 | 18 | 9;
  battery: "lower" | "upper" | "quarterdeck" | "forecastle";
}
export interface DeckFitting { kind: "grating" | "capstan"; x: number; y: number; deck: number; halfX: number; halfZ: number }

const HULL_STATIONS: readonly (readonly [number, number])[] = [
  [-31,.56],[-29,.73],[-25,.92],[-18,1],[-8,1.025],[6,1.025],
  [16,.995],[23,.88],[27,.58],[30,.19],[31.2,.015],
];

const LADDER_HALF_WIDTH = .65;
// Main-hatch ladders carry an up lane and a down lane side by side, so neither waits for the other.
const LANE_HALF_WIDTH = .4;
const UP_LANE_Z = 1.1;
const DOWN_LANE_Z = 1.9;
const AFT_LADDER_X = -18;
const MIDSHIP_LADDER_X = 1;
const FORE_LADDER_X = 19;

function ladderAt(
  id: number, lowerDeck: number, upperDeck: number, centerX: number, direction: number, z: number,
  halfWidth: number, flows: Pick<DeckLadder, "flow" | "orderedFlow"> = {},
): DeckLadder {
  return {
    id, lowerDeck, upperDeck, centerX, z, direction, halfWidth, ...flows,
    lower: { x: centerX - direction * 1.55, y: WALKABLE_DECKS[lowerDeck], z },
    start: { x: centerX - direction * .8, y: WALKABLE_DECKS[lowerDeck], z },
    end: { x: centerX + direction * .8, y: WALKABLE_DECKS[upperDeck], z },
    upper: { x: centerX + direction * 1.55, y: WALKABLE_DECKS[upperDeck], z },
  };
}
// Ids double as passage ids, so every ladder keeps a stable id below 100.
export const DECK_LADDERS: readonly DeckLadder[] = [
  // At quarters the aft ladders, beside the magazine, only go up and the forward ladders only go down.
  ...[0, 1].flatMap(deck => [
    ladderAt(deck * 3, deck, deck + 1, AFT_LADDER_X, 1, 1.5, LADDER_HALF_WIDTH, { orderedFlow: 1 }),
    ladderAt(deck * 3 + 1, deck, deck + 1, MIDSHIP_LADDER_X, 1, UP_LANE_Z, LANE_HALF_WIDTH, { flow: 1 }),
    ladderAt(deck * 3 + 2, deck, deck + 1, FORE_LADDER_X, 1, 1.5, LADDER_HALF_WIDTH, { orderedFlow: -1 }),
  ]),
  // Quarterdeck break (aft) and forecastle break (fore) ladders link the weather deck
  // gangways up from the upper gun deck, straddling the open waist.
  ladderAt(6, 2, 3, QUARTERDECK_END, -1, 1.5, LADDER_HALF_WIDTH),
  ladderAt(7, 2, 3, FORECASTLE_START, 1, 1.5, LADDER_HALF_WIDTH),
  // Poop ladder climbs from the quarterdeck at the forward edge of the poop.
  ladderAt(8, 3, 4, POOP_BOUNDS.maxX, -1, -1.5, LADDER_HALF_WIDTH),
  ...[0, 1].map(deck =>
    ladderAt(9 + deck, deck, deck + 1, MIDSHIP_LADDER_X, 1, DOWN_LANE_Z, LANE_HALF_WIDTH, { flow: -1 })),
];

export function hullSternX(y: number): number {
  const rise = Math.max(0, Math.min(1, (y + 4.45) / 7.85));
  return -28.1 - rise * 2.4;
}

export function hullBowX(y: number): number {
  const rise = Math.max(0, Math.min(1, (y + 4.45) / 6.25));
  return 26.6 + 4.2 * rise * rise * (3 - 2 * rise) + Math.max(0, y - DESIGN_WATERLINE) * .065;
}

export function hullPlankingThickness(y: number): number {
  return y < 4.8 ? .45 : y < 8.2 ? .32 : .22;
}

export function hullHalfWidth(x: number, y: number): number {
  let interval=0;
  while(interval<HULL_STATIONS.length-2&&x>HULL_STATIONS[interval+1][0])interval++;
  const left=HULL_STATIONS[interval],right=HULL_STATIONS[interval+1];
  const previous=HULL_STATIONS[Math.max(0,interval-1)],next=HULL_STATIONS[Math.min(HULL_STATIONS.length-1,interval+2)];
  const span=right[0]-left[0],t=Math.max(0,Math.min(1,(x-left[0])/span));
  const leftSlope=(right[1]-previous[1])/(right[0]-previous[0]),rightSlope=(next[1]-left[1])/(next[0]-left[0]);
  let beam=(2*t*t*t-3*t*t+1)*left[1]+(t*t*t-2*t*t+t)*span*leftSlope+(-2*t*t*t+3*t*t)*right[1]+(t*t*t-t*t)*span*rightSlope;
  if (x < -25) {
    const stern = hullSternX(y);
    const along = Math.max(0, Math.min(1, (x - stern) / (-25 - stern)));
    const counter = Math.max(0, Math.min(1, (y - DESIGN_WATERLINE) / (3.4 - DESIGN_WATERLINE)));
    const end = .035 + .585 * counter * counter * (3 - 2 * counter);
    beam = .92 * (end + (1 - end) * along * along * (3 - 2 * along));
  } else if (x > 23) {
    const along = Math.max(0, Math.min(1, (hullBowX(y) - x) / (hullBowX(y) - 23)));
    beam = .88 * along * along * (3 - 2 * along);
  }
  const immersion = Math.max(0, Math.min(1, (DESIGN_WATERLINE - y) / 6.25));
  const section = y <= DESIGN_WATERLINE
    ? Math.sqrt(Math.max(0, 1 - Math.pow(immersion, 2.7)))
    : 1 - .16 * Math.pow((y - DESIGN_WATERLINE) / (9.45 - DESIGN_WATERLINE), 1.2);
  return Math.max(.045, 6.95 * beam * section);
}

// Single source of truth (shared with the renderer) for whether a deck has a real floor at
// (x, z): hull-edge clearance for crew/frame/planking everywhere, the weather-deck waist
// cutout, and the poop's limited footprint.
export function deckContainsPoint(deckIndex: number, x: number, z: number): boolean {
  const y = WALKABLE_DECKS[deckIndex];
  if (Math.abs(z) > hullHalfWidth(x, y) - .8) return false;
  if (deckIndex === 4) return x >= POOP_BOUNDS.minX && x <= POOP_BOUNDS.maxX;
  if (deckIndex === 3 && x >= QUARTERDECK_END - CREW_RADIUS && x <= FORECASTLE_START + CREW_RADIUS)
    return Math.abs(z) >= GANGWAY_INNER_Z + CREW_RADIUS + .02;
  return true;
}

export const GUN_DIMENSIONS: Record<32 | 18 | 9, GunDimensions> = {
  32: { axisHeight: .78, lengthScale: 1, widthScale: 1 },
  18: { axisHeight: .72, lengthScale: .88, widthScale: .83 },
  9: { axisHeight: .62, lengthScale: .72, widthScale: .66 },
};

// Bore sits consistently inboard of the shell: half-width of the hull at the gun's deck
// height (sampled a little above the deck, at roughly bulwark height) less the carriage's
// inboard setback.
function gunStationZ(x: number, y: number): number {
  return hullHalfWidth(x, y + .78) - 1.6;
}
function heavyRow(deck: number, y: number, calibre: 32 | 18, battery: "lower" | "upper"): GunStation[] {
  const stations: GunStation[] = [];
  for (const side of ["port", "starboard"] as const) {
    for (let index = 0; index < 14; index++) {
      const x = -22.36 + index * 3.44;
      stations.push({ deck, side, calibre, battery,
        position: { x, y, z: (side === "port" ? -1 : 1) * gunStationZ(x, y) } });
    }
  }
  return stations;
}
// Per RMG's Bellona-class account: 14 quarterdeck 9-pounders aft of the break, 4 forecastle
// 9-pounders forward of it (7 + 2 per side).
const LIGHT_X = [-25, -22, -19, -16, -13, -10, -7, 21, 23.2] as const;
function lightRow(deck: number, y: number): GunStation[] {
  const stations: GunStation[] = [];
  for (const side of ["port", "starboard"] as const) {
    for (const x of LIGHT_X) {
      stations.push({
        deck, side, calibre: 9,
        battery: x > FORECASTLE_START ? "forecastle" : "quarterdeck",
        position: { x, y, z: (side === "port" ? -1 : 1) * gunStationZ(x, y) },
      });
    }
  }
  return stations;
}
export const GUN_STATIONS: readonly GunStation[] = [
  ...heavyRow(1, DECK_HEIGHTS[1], 32, "lower"),
  ...heavyRow(2, DECK_HEIGHTS[2], 18, "upper"),
  ...lightRow(3, DECK_HEIGHTS[3]),
];

export const DECK_FITTINGS: readonly DeckFitting[] = [
  { kind: "grating", x: 7, y: DECK_HEIGHTS[2], deck: 2, halfX: 2.6, halfZ: 1.8 },
  { kind: "grating", x: -15, y: DECK_HEIGHTS[3], deck: 3, halfX: 1.4, halfZ: .9 },
  { kind: "capstan", x: -7, y: DECK_HEIGHTS[2], deck: 2, halfX: 1.65, halfZ: 1.65 },
  { kind: "capstan", x: -10, y: DECK_HEIGHTS[3], deck: 3, halfX: 1.65, halfZ: 1.65 },
];

export function sailTrim(heading: number, windDirection: number): number {
  return Math.max(-.5,Math.min(.5,Math.sin((windDirection-heading)*Math.PI/180)*.5));
}

export function yardPosition(mast: number, level: number, lateral: number, trim: number): Vec3 {
  return {x:MAST_X[mast]+.25+Math.sin(trim)*lateral,y:YARD_HEIGHTS[mast][level]+.1,z:Math.cos(trim)*lateral};
}

export function footropePosition(mast: number, level: number, lateral: number, trim: number, returning = false): Vec3 {
  const position = yardPosition(mast, level, lateral, trim);
  const halfWidth = (mast === 2 ? 13 : 19) * (1 - level * .23) / 2;
  const fraction = Math.max(0, Math.min(1, (Math.abs(lateral) - .4) / (halfWidth - .4)));
  const offset = returning ? RETURN_ROPE_OFFSET : WORK_ROPE_OFFSET;
  position.x -= offset * Math.cos(trim);
  position.z += offset * Math.sin(trim);
  position.y -= .35 + Math.sin(fraction * Math.PI) * .8;
  return position;
}

export function mastClimbPosition(mast: number, level: number, side: number, ascending: boolean): Vec3 {
  return { x: MAST_X[mast] + (ascending ? RIGGING_LANE_X : -RIGGING_LANE_X),
    y: YARD_HEIGHTS[mast][level] + .1, z: side * RIGGING_LANE_Z };
}

export interface InteriorFixture {
  kind: "chart-table" | "chair" | "galley" | "flue" | "cot" | "surgery-table" | "workbench";
  deck: number;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  height: number;
}

export const INTERIOR_BULKHEAD = { deck: 2, x: -26.3, doorHalfWidth: 1 } as const;
export const INTERIOR_FIXTURES: readonly InteriorFixture[] = [
  { kind: "chart-table", deck: 2, x: -28.8, z: -1.25, halfX: .8, halfZ: .65, height: .78 },
  { kind: "chair", deck: 2, x: -27.65, z: -1.25, halfX: .32, halfZ: .32, height: .95 },
  { kind: "galley", deck: 2, x: 25, z: 0, halfX: 1.2, halfZ: .95, height: 1.3 },
  { kind: "flue", deck: 3, x: 25.4, z: 0, halfX: .24, halfZ: .24, height: 1.4 },
  { kind: "cot", deck: 0, x: 25.3, z: -1.55, halfX: 1.05, halfZ: .45, height: .7 },
  { kind: "cot", deck: 0, x: 25.3, z: 1.55, halfX: 1.05, halfZ: .45, height: .7 },
  { kind: "surgery-table", deck: 0, x: 27.4, z: 0, halfX: .55, halfZ: .7, height: .85 },
  { kind: "workbench", deck: 0, x: -26.5, z: 0, halfX: .85, halfZ: .5, height: .8 },
];

export function deckObstacles(deck: number): DeckObstacle[] {
  const obstacles:DeckObstacle[]=[];
  for(const x of MAST_X)obstacles.push({minX:x-.65,maxX:x+.65,minZ:-.65,maxZ:.65});
  for(const ladder of DECK_LADDERS) {
    if(ladder.lowerDeck===deck)obstacles.push({minX:ladder.centerX-1.02,maxX:ladder.centerX+1.02,minZ:ladder.z-ladder.halfWidth,maxZ:ladder.z+ladder.halfWidth});
    if(ladder.upperDeck===deck)obstacles.push({minX:ladder.centerX-1.2,maxX:ladder.centerX+1.2,minZ:ladder.z-ladder.halfWidth-.05,maxZ:ladder.z+ladder.halfWidth+.05});
  }
  for(const fitting of DECK_FITTINGS) {
    if(fitting.deck!==deck)continue;
    const { halfX, halfZ } = fitting;
    obstacles.push({minX:fitting.x-halfX,maxX:fitting.x+halfX,minZ:-halfZ,maxZ:halfZ});
  }
  for (const fixture of INTERIOR_FIXTURES) {
    if (fixture.deck !== deck) continue;
    obstacles.push({ minX: fixture.x - fixture.halfX, maxX: fixture.x + fixture.halfX,
      minZ: fixture.z - fixture.halfZ, maxZ: fixture.z + fixture.halfZ });
  }
  if (deck === INTERIOR_BULKHEAD.deck) {
    const width = hullHalfWidth(INTERIOR_BULKHEAD.x, WALKABLE_DECKS[deck]) - .3;
    for (const side of [-1, 1]) {
      obstacles.push({ minX: INTERIOR_BULKHEAD.x - .08, maxX: INTERIOR_BULKHEAD.x + .08,
        minZ: side > 0 ? INTERIOR_BULKHEAD.doorHalfWidth : -width,
        maxZ: side > 0 ? width : -INTERIOR_BULKHEAD.doorHalfWidth });
    }
  }
  if(deck===4)for(const z of [-.8,.8])obstacles.push({minX:-24.35,maxX:-23.65,minZ:z-.8,maxZ:z+.8});
  // Keep gun-deck passages clear around the hatch coamings during action.
  if(deck===0)for(let index=0;index<34;index++) {
    const x=-25+index%17*2.9,z=(index%2?1:-1)*3.5;
    if (blocksLadderApproach(deck,x,z,.36,.36)) continue;
    obstacles.push({minX:x-.36,maxX:x+.36,minZ:z-.36,maxZ:z+.36});
  }
  if(deck===0)for(let index=0;index<18;index++) {
    const x=-24+index%6*2,z=-1.9+Math.floor(index/6)*1.9;
    if (blocksLadderApproach(deck,x,z,.57,.42)) continue;
    obstacles.push({minX:x-.57,maxX:x+.57,minZ:z-.42,maxZ:z+.42});
  }
  return obstacles;
}

export function blocksLadderApproach(deck: number, x: number, z: number, halfX: number, halfZ: number): boolean {
  return DECK_LADDERS.some(ladder => {
    if (ladder.lowerDeck !== deck && ladder.upperDeck !== deck) return false;
    const minX = Math.min(ladder.lower.x,ladder.upper.x)-.4;
    const maxX = Math.max(ladder.lower.x,ladder.upper.x)+.4;
    return x+halfX > minX && x-halfX < maxX && z+halfZ > ladder.z-1 && z-halfZ < ladder.z+1;
  });
}

export function shroudAccess(mast: number, side: number, lane: number): { deck: Vec3; rail: Vec3; base: Vec3; top: Vec3 } {
  const desiredX=MAST_X[mast]+(lane-1)*2.4;
  const gapX=desiredX < -15.2 || desiredX > 15.2 ? desiredX : -15.48 + Math.round((desiredX+15.48)/3.44)*3.44;
  const topY=YARD_HEIGHTS[mast][0]-1, t=1/(topY-9), z=side*(6.5+(RIGGING_LANE_Z-6.5)*t);
  return {
    deck:{x:gapX,y:8.2,z:side*4.8},
    rail:{x:gapX,y:10,z},
    base:{x:MAST_X[mast]+(lane-1)*(2.4*(1-t)+RIGGING_LANE_X*t),y:10,z},
    top:{x:MAST_X[mast]+(lane-1)*RIGGING_LANE_X,y:topY,z:side*RIGGING_LANE_Z},
  };
}
