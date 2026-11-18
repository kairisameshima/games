import {
  CREW_COUNT,
  MAST_X,
  YARD_HEIGHTS,
  type CrewMember,
  type CrewWaypoint,
  type Gun,
  type NavigationDebug,
  type Vec3,
} from "./types";
import {
  CREW_RADIUS,
  DECK_LADDERS,
  WALKABLE_DECKS,
  GUN_DIMENSIONS,
  FORECASTLE_START,
  GANGWAY_INNER_Z,
  QUARTERDECK_END,
  deckContainsPoint,
  deckObstacles,
  footropePosition,
  mastClimbPosition,
  shroudAccess,
  WORK_ROPE_OFFSET,
  RETURN_ROPE_OFFSET,
  yardPosition,
  type DeckLadder,
  type DeckObstacle,
} from "./layout";
import { DeckCrowd } from "./deck-crowd";

// Berths are allocated on this grid; walking itself happens on the navcat navigation mesh.
const GRID = 0.55;
const ALOFT_THRESHOLD = 15;
const LATERAL_STEP = 0.5;
const BODY_CLEARANCE = CREW_RADIUS * 2;
const REPLAN_DELAY = 1.5;
// How close a walker must come to a deck waypoint; at a ladder he steps onto its own lane before the
// scripted ladder movement takes over.
const ARRIVAL_DISTANCE = .2;
const LANDING_ARRIVAL_DISTANCE = .3;
// Within this distance of a landing, walkers other than the nearest stand and wait.
const LANDING_WAIT_RADIUS = 2;
// Floor each waiting sailor takes up; the waiting area grows to hold everyone already waiting there.
const LANDING_WAIT_AREA = .5;
// Sailors standing at a station who are pushed this far by passing traffic walk back to it.
const SETTLE_DISTANCE = .25;
const SETTLED_DISTANCE = .08;
const WALKING_SPEED_THRESHOLD = .05;
const LADDERS_BY_ID = new Map(DECK_LADDERS.map(ladder => [ladder.id, ladder]));
const NEIGHBOR_X = [1, -1, 0, 0] as const;
const NEIGHBOR_Z = [0, 0, 1, -1] as const;
// grid rows are offset half a cell off z=0 so a .55m grid still resolves narrow
// off-centre aisles (e.g. the gap beside the port launch) instead of straddling them
const Z_OFFSET = GRID / 2;
function zToIz(z: number): number { return Math.round((z - Z_OFFSET) / GRID); }
function izToZ(iz: number): number { return iz * GRID + Z_OFFSET; }

// ---- small math helpers ----
function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.3 && Math.abs(a.z - b.z) < 0.05;
}

function passageFlow(from: Vec3, to: Vec3): number {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  if (Math.abs(dy) > Math.max(Math.abs(dx), Math.abs(dz))) return Math.sign(dy);
  return Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) || 1 : Math.sign(dz);
}

function setPassageFlow(route: CrewWaypoint[], origin: Vec3): void {
  for (let index = 0; index < route.length; index++) {
    const passage = route[index].passage;
    if (passage === undefined) continue;
    const start = index, entry = index > 0 ? route[index - 1] : origin;
    while (index + 1 < route.length && route[index + 1].passage === passage) index++;
    const exit = route[index];
    const first = route[start];
    const flow = passageFlow(samePoint(first, exit) ? entry : first, exit);
    for (let point = start; point <= index; point++) route[point].flow ??= flow;
  }
}

function yardLateral(position: Vec3, mast: number, trim: number): number {
  return (position.x - MAST_X[mast] - .25) * Math.sin(trim) + position.z * Math.cos(trim);
}
function yardNormal(position: Vec3, mast: number, trim: number): number {
  return (position.x - MAST_X[mast] - .25) * Math.cos(trim) - position.z * Math.sin(trim);
}
function nearestDeckIndex(y: number): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < WALKABLE_DECKS.length; i++) {
    const diff = Math.abs(y - WALKABLE_DECKS[i]);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}
function nearestMast(x: number): number {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < MAST_X.length; i++) {
    const diff = Math.abs(x - MAST_X[i]);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}
function baseSpeedFor(kind: CrewWaypoint["kind"]): number {
  switch (kind) {
    case "stairs": return 0.75;
    case "climb": return 0.55;
    case "yard": return 0.45;
    case "walk": return 1.3;
    default: return 1.3;
  }
}

function yardWaypoint(mast: number, level: number, lateral: number, trim: number, onFootrope = false, returning = false): CrewWaypoint {
  const position = onFootrope
    ? footropePosition(mast, level, lateral, trim, returning)
    : yardPosition(mast, level, lateral, trim);
  return { ...position, kind: "yard", mast, level, lateral, onFootrope, returning };
}
function shroudPassageId(mast: number, side: number, lane: number): number {
  return 100 + mast * 10 + (side > 0 ? 0 : 5) + lane;
}
function boardingAscent(mast: number, side: number, lane: number): CrewWaypoint[] {
  const access = shroudAccess(mast, side, lane);
  const passage = shroudPassageId(mast, side, lane);
  return [
    { ...access.rail, kind: "climb", mast, passage },
    { ...access.base, kind: "climb", mast, passage },
    { ...access.top, kind: "climb", mast, passage },
    { ...mastClimbPosition(mast, 0, side, true), kind: "climb", mast, passage, level: 0 },
    { x: MAST_X[mast] + .8, y: YARD_HEIGHTS[mast][0] + .1, z: side * .8, kind: "climb", mast, passage, level: 0 },
  ];
}
function boardingDescent(mast: number, side: number, lane: number): CrewWaypoint[] {
  const access = shroudAccess(mast, side, lane);
  const passage = shroudPassageId(mast, side, lane);
  return [
    { ...access.top, kind: "climb", mast, passage },
    { ...access.base, kind: "climb", mast, passage },
    { ...access.rail, kind: "climb", mast, passage },
    { ...access.deck, kind: "climb", passage },
  ];
}
function buildAloftLeg(
  mast: number, side: number,
  fromLevel: number, fromLateral: number,
  toLevel: number, toLateral: number, trim: number,
): CrewWaypoint[] {
  if (fromLevel === toLevel) return toLevel < 0 ? [] : [
    yardWaypoint(mast, fromLevel, fromLateral, trim),
    yardWaypoint(mast, toLevel, toLateral, trim),
    yardWaypoint(mast, toLevel, toLateral, trim, true),
  ];
  const points: CrewWaypoint[] = [];
  const direction = Math.sign(toLevel - fromLevel);
  if (fromLevel >= 0) {
    if (direction < 0) {
      points.push(yardWaypoint(mast, fromLevel, fromLateral, trim, true, true));
      points.push(yardWaypoint(mast, fromLevel, side * .8, trim, true, true));
    } else {
      points.push(yardWaypoint(mast, fromLevel, fromLateral, trim));
      points.push(yardWaypoint(mast, fromLevel, side * .8, trim));
      points.push({ x: MAST_X[mast] + .8, y: YARD_HEIGHTS[mast][fromLevel] + .1,
        z: side * .8, kind: "climb", mast, level: fromLevel,
        passage: 300 + mast * 10 + fromLevel * 2 + (side > 0 ? 0 : 1) });
    }
    points.push({ ...mastClimbPosition(mast, fromLevel, side, direction > 0), kind: "climb", mast, level: fromLevel,
      passage: 300 + mast * 10 + fromLevel * 2 + (side > 0 ? 0 : 1) });
  }
  for (let level = fromLevel; level !== toLevel; level += direction) {
    const nextLevel = level + direction;
    if (level === -1) points.push(...boardingAscent(mast, side, 2));
    else if (nextLevel === -1) points.push(...boardingDescent(mast, side, 0));
    else {
      const passage = 200 + mast * 20 + Math.max(level, nextLevel) * 4 + (side > 0 ? 0 : 2) + (direction > 0 ? 0 : 1);
      points.push({ ...mastClimbPosition(mast, nextLevel, side, direction > 0),
        kind: "climb", mast, level: nextLevel, passage });
      if (nextLevel === toLevel) points.push({
        x: MAST_X[mast] + (direction > 0 ? .8 : -.8), y: YARD_HEIGHTS[mast][nextLevel] + .1,
        z: side * .8, kind: "climb", mast, level: nextLevel, passage,
      });
    }
  }
  if (toLevel >= 0) points.push(
    yardWaypoint(mast, toLevel, toLateral, trim),
    yardWaypoint(mast, toLevel, toLateral, trim, true),
  );
  return points;
}

type DeckAnchor = { kind: "deck"; deck: number; pos: Vec3 };
type AloftAnchor = { kind: "aloft"; mast: number; level: number; lateral: number };
type Anchor = DeckAnchor | AloftAnchor;

function anchorFromWaypoint(waypoint: CrewWaypoint): Anchor {
  if (waypoint.mast !== undefined && waypoint.level !== undefined) {
    return {
      kind: "aloft", mast: waypoint.mast, level: waypoint.level,
      lateral: waypoint.lateral ?? Math.sign(waypoint.z) * .8,
    };
  }
  return { kind: "deck", deck: nearestDeckIndex(waypoint.y), pos: waypoint };
}
function anchorFromMember(member: CrewMember, trim: number): Anchor {
  if (member.position.y >= ALOFT_THRESHOLD) {
    const current = member.route[Math.min(member.routeIndex, member.route.length - 1)];
    const mast = current?.mast ?? nearestMast(member.position.x);
    let level = 0, nearest = Infinity;
    for (let index = 0; index < YARD_HEIGHTS[mast].length; index++) {
      const distance = Math.abs(member.position.y - YARD_HEIGHTS[mast][index] - .1);
      if (distance < nearest) { nearest = distance; level = index; }
    }
    const lateral = (member.position.x - MAST_X[mast] - .25) * Math.sin(trim) + member.position.z * Math.cos(trim);
    return { kind: "aloft", mast, level, lateral };
  }
  return { kind: "deck", deck: nearestDeckIndex(member.position.y), pos: member.position };
}
function corridorKey(waypoint: CrewWaypoint): string | null {
  if (waypoint.passage !== undefined) return `p${waypoint.passage}`;
  if (waypoint.returning) return `r${waypoint.mast}:${waypoint.level}:${Math.sign(waypoint.lateral ?? waypoint.z)}`;
  if (waypoint.kind === "yard" && !waypoint.onFootrope) return `y${waypoint.mast}:${waypoint.level}:${Math.sign(waypoint.lateral ?? waypoint.z)}`;
  return null;
}
function corridorSpan(member: CrewMember, trim: number): { key: string; dir: number; remain: number } | null {
  const route = member.route;
  let start = member.routeIndex;
  const key = corridorKey(route[start]);
  if (!key) return null;
  let end = start;
  let remain = dist3(member.position, route[start]);
  while (end + 1 < route.length && corridorKey(route[end + 1]) === key) {
    remain += dist3(route[end], route[end + 1]);
    end++;
  }
  while (start > 0 && corridorKey(route[start - 1]) === key) start--;
  const entry = start > 0 ? route[start - 1] : member.position;
  const exit = route[end];
  if (route[start].kind === "yard") {
    const mast = route[start].mast!;
    const entryLateral = "lateral" in entry ? (entry as CrewWaypoint).lateral! : yardLateral(entry, mast, trim);
    const dir = Math.sign((exit as CrewWaypoint).lateral! - entryLateral) || Math.sign((exit as CrewWaypoint).lateral!) || 1;
    return { key, dir, remain: -dir * yardLateral(member.position, mast, trim) };
  }
  const dir = route[member.routeIndex].flow ?? passageFlow(entry, exit);
  return { key, dir, remain };
}
function forcedPrefix(member: CrewMember): CrewWaypoint[] {
  const current = member.route[member.routeIndex];
  if (!current || (current.kind !== "stairs" && current.kind !== "climb" && current.kind !== "yard" && current.passage === undefined)) return [];
  const key = corridorKey(current);
  const prefix: CrewWaypoint[] = [];
  if ((current.kind === "climb" || current.kind === "yard") && current.mast !== undefined) {
    // Change orders only at a work perch or the deck, never by cutting across a mast mid-climb.
    for (let index = member.routeIndex; index < member.route.length; index++) {
      const waypoint = member.route[index];
      prefix.push(waypoint);
      if (waypoint.onFootrope || (waypoint.y < 11 && waypoint.mast === undefined)) break;
    }
    return prefix;
  }
  for (let index = member.routeIndex; index < member.route.length && corridorKey(member.route[index]) === key; index++) {
    prefix.push(member.route[index]);
  }
  return prefix;
}

// ---- berth grid ----
interface DeckGrid {
  index: number;
  y: number;
  minIX: number; maxIX: number; minIZ: number; maxIZ: number;
  cols: number; rows: number;
  // Cells in narrow aisles and on the waist gangways, where an idle sailor would block traffic.
  transit: Uint8Array;
  walkable: Uint8Array;
  obstacles: readonly DeckObstacle[];
}
function cellIndex(grid: DeckGrid, ix: number, iz: number): number {
  if (ix < grid.minIX || ix > grid.maxIX || iz < grid.minIZ || iz > grid.maxIZ) return -1;
  return (ix - grid.minIX) + (iz - grid.minIZ) * grid.cols;
}
function ringSearch(maxRing: number, cx: number, cz: number, accept: (ix: number, iz: number) => boolean): { ix: number; iz: number } | null {
  if (accept(cx, cz)) return { ix: cx, iz: cz };
  for (let r = 1; r <= maxRing; r++) {
    for (let dx = -r; dx <= r; dx++) {
      if (accept(cx + dx, cz - r)) return { ix: cx + dx, iz: cz - r };
      if (accept(cx + dx, cz + r)) return { ix: cx + dx, iz: cz + r };
    }
    for (let dz = -r + 1; dz <= r - 1; dz++) {
      if (accept(cx - r, cz + dz)) return { ix: cx - r, iz: cz + dz };
      if (accept(cx + r, cz + dz)) return { ix: cx + r, iz: cz + dz };
    }
  }
  return null;
}

function floorPointClear(deck: number, obstacles: readonly DeckObstacle[], x: number, z: number): boolean {
  if (x < -27.75 || x > 28.75) return false;
  if (!deckContainsPoint(deck, x, z)) return false;
  for (const obstacle of obstacles) {
    if (x >= obstacle.minX - CREW_RADIUS && x <= obstacle.maxX + CREW_RADIUS
      && z >= obstacle.minZ - CREW_RADIUS && z <= obstacle.maxZ + CREW_RADIUS) return false;
  }
  return true;
}

function retainConnectedDeck(grid: DeckGrid): void {
  const labels = new Int32Array(grid.walkable.length);
  const queue = new Int32Array(grid.walkable.length);
  let component = 0, largest = 0, largestSize = 0;
  for (let cell = 0; cell < grid.walkable.length; cell++) {
    if (!grid.walkable[cell] || labels[cell]) continue;
    component++;
    let read = 0, count = 1;
    queue[0] = cell;
    labels[cell] = component;
    while (read < count) {
      const current = queue[read++];
      const ix = grid.minIX + current % grid.cols;
      const iz = grid.minIZ + Math.floor(current / grid.cols);
      for (let direction = 0; direction < 4; direction++) {
        const neighbor = cellIndex(grid, ix + NEIGHBOR_X[direction], iz + NEIGHBOR_Z[direction]);
        if (neighbor < 0 || !grid.walkable[neighbor] || labels[neighbor]) continue;
        labels[neighbor] = component;
        queue[count++] = neighbor;
      }
    }
    if (count > largestSize) { largest = component; largestSize = count; }
  }
  for (let cell = 0; cell < grid.walkable.length; cell++) {
    if (labels[cell] !== largest) grid.walkable[cell] = 0;
  }
}

function markNarrowTransit(grid: DeckGrid): void {
  for (let cell = 0; cell < grid.walkable.length; cell++) {
    if (!grid.walkable[cell]) continue;
    const ix = grid.minIX + cell % grid.cols, iz = grid.minIZ + Math.floor(cell / grid.cols);
    let exits = 0;
    for (let direction = 0; direction < 4; direction++) {
      const neighbor = cellIndex(grid, ix + NEIGHBOR_X[direction], iz + NEIGHBOR_Z[direction]);
      if (neighbor >= 0 && grid.walkable[neighbor]) exits++;
    }
    if (exits > 2) continue;
    grid.transit[cell] = 1;
    for (let direction = 0; direction < 4; direction++) {
      const neighbor = cellIndex(grid, ix + NEIGHBOR_X[direction], iz + NEIGHBOR_Z[direction]);
      if (neighbor >= 0) grid.transit[neighbor] = 1;
    }
  }
}

function markWeatherGangways(grid: DeckGrid): void {
  for (let cell = 0; cell < grid.walkable.length; cell++) {
    if (!grid.walkable[cell]) continue;
    const x = (grid.minIX + cell % grid.cols) * GRID;
    const z = izToZ(grid.minIZ + Math.floor(cell / grid.cols));
    if (x < QUARTERDECK_END - GRID || x > FORECASTLE_START + GRID) continue;
    if (Math.abs(z) < GANGWAY_INNER_Z - GRID) continue;
    // Idle berths at either end would block the only route through the open waist.
    grid.transit[cell] = 1;
  }
}

// Sailors going the same way along one passage keep a single file; each direction is its own file.
function fileKey(span: { key: string; dir: number }): string {
  return `${span.key}:${span.dir}`;
}
function fileHeadway(key: string): number {
  return key.startsWith("y") || key.startsWith("r") ? .6 : key.startsWith("p2") ? 1.3 : .9;
}
// A walker whose next step is onto a ladder or shroud, keyed by the landing he is walking to.
function landingKey(member: CrewMember): string | null {
  const target = member.route[member.routeIndex];
  const next = member.route[member.routeIndex + 1];
  if (target?.kind !== "walk" || next?.passage === undefined) return null;
  return `${next.passage}:${target.x}:${target.z}`;
}

export class CrewNavigation {
  private readonly guns: readonly Gun[];
  private readonly decks: DeckGrid[] = [];
  private readonly crowd: DeckCrowd;
  private readonly floorOwner = new Map<string, number>();
  private readonly memberFloorSlot = new Map<number, string>();
  private readonly aloftOwner = new Map<string, number>();
  private readonly memberAloftSlot = new Map<number, string>();
  private readonly lastRequested = new Map<number, Vec3>();
  private readonly corridorScratch = new Map<string, { id: number; dir: number; remain: number }[]>();
  // Distance left to go for the last sailor in each single file, as of this step.
  private readonly fileTail = new Map<string, number>();
  // The walker nearest each ladder or shroud landing, the only one heading onto it this step.
  private readonly landingLeader = new Map<string, { id: number; distance: number }>();
  // How many sailors wait for each landing, as of the last step and as counted this step.
  private landingWaiting = new Map<string, number>();
  private nextLandingWaiting = new Map<string, number>();
  private readonly blockedIds = new Set<number>();
  private crewById: (CrewMember | undefined)[] = [];
  private readonly pending = new Map<number, Vec3>();
  private readonly blockedFor = new Float64Array(CREW_COUNT);
  private readonly retryAt = new Float64Array(CREW_COUNT);
  private previousTrim = Number.NaN;
  private frameTime = 0;
  private ladderOrdersActive = false;
  private readonly settling = new Set<number>();

  constructor(guns: readonly Gun[]) {
    this.guns = guns;
    for (let index = 0; index < WALKABLE_DECKS.length; index++) {
      this.decks.push(this.buildDeckGrid(index, WALKABLE_DECKS[index], this.buildObstaclesFor(index)));
    }
    this.crowd = new DeckCrowd(this.decks.map(grid => ({
      y: grid.y,
      clear: (x: number, z: number) => floorPointClear(grid.index, grid.obstacles, x, z),
    })), CREW_RADIUS);
  }

  place(member: CrewMember): void {
    this.releaseFloorSlot(member.id);
    this.crewById[member.id] = member;
    this.releaseAloftSlot(member.id);
    this.lastRequested.delete(member.id);
    const deck = nearestDeckIndex(member.position.y);
    const grid = this.decks[deck];
    const cell = this.findFreeCell(grid, deck, member.position.x, member.position.z, member.id);
    if (!cell) throw new RangeError(`No free crew berth on deck ${deck}`);
    const pos = { x: cell.x, y: grid.y, z: cell.z };
    this.reserveFloorAt(deck, pos, member.id);
    member.position.x = pos.x; member.position.y = pos.y; member.position.z = pos.z;
    this.enterCrowd(member);
    member.destination.x = member.position.x; member.destination.y = pos.y; member.destination.z = member.position.z;
    member.route = [];
    member.routeIndex = 0;
    member.velocity.x = 0; member.velocity.y = 0; member.velocity.z = 0;
    member.heading = 0;
    member.speed = 0;
    member.gait = 0;
    member.locomotion = "idle";
    member.carrying = false;
    member.moving = false;
  }

  planRoute(member: CrewMember, destination: Vec3, trim: number): void {
    if (member.health <= 0) return;
    const cached = this.lastRequested.get(member.id);
    if (cached && samePoint(cached, destination)) return;

    const aloftTarget = destination.y >= ALOFT_THRESHOLD;
    const destAnchor: Anchor | null = aloftTarget
      ? this.resolveAloftAnchor(member, destination, trim)
      : this.resolveDeckAnchor(destination, member.id);
    if (!destAnchor) { this.deferRoute(member, destination); return; }

    const prefix = forcedPrefix(member);
    const startAnchor = prefix.length > 0 ? anchorFromWaypoint(prefix[prefix.length - 1]) : anchorFromMember(member, trim);

    const path = this.connectAnchors(startAnchor, destAnchor, trim);
    if (!path) { this.deferRoute(member, destination); return; }
    setPassageFlow(path, prefix[prefix.length - 1] ?? member.position);
    this.lastRequested.set(member.id, { ...destination });
    this.pending.delete(member.id);
    this.blockedFor[member.id] = 0;

    this.releaseFloorSlot(member.id);
    this.releaseAloftSlot(member.id);
    if (destAnchor.kind === "deck") this.reserveFloorAt(destAnchor.deck, destAnchor.pos, member.id);
    else this.reserveAloftAt(destAnchor.mast, destAnchor.level, destAnchor.lateral, member.id);

    member.route = prefix.length > 0 ? [...prefix, ...path] : path;
    member.routeIndex = 0;
    member.destination = destAnchor.kind === "deck"
      ? { x: destAnchor.pos.x, y: destAnchor.pos.y, z: destAnchor.pos.z }
      : footropePosition(destAnchor.mast, destAnchor.level, destAnchor.lateral, trim);
    member.moving = member.route.length > 0;
    if (!member.moving) member.locomotion = "idle";
  }

  private deferRoute(member: CrewMember, destination: Vec3): void {
    this.pending.set(member.id, { ...destination });
    this.lastRequested.delete(member.id);
    member.route = forcedPrefix(member);
    member.routeIndex = 0;
    member.destination = { ...destination };
    member.moving = true;
    member.locomotion = "wait";
    this.retryAt[member.id] = this.frameTime + REPLAN_DELAY;
  }

  step(crew: readonly CrewMember[], seconds: number, time: number, trim: number): void {
    this.frameTime = time;
    this.moveWithYards(crew, trim);
    for (const member of crew) this.crewById[member.id] = member;
    for (const [id, destination] of this.pending) {
      const member = this.crewById[id];
      if (member && time >= this.retryAt[id]) this.planRoute(member, destination, trim);
    }
    this.rebuildCorridors(crew);
    this.findLandingLeaders(crew);
    for (const member of crew) this.stepMember(member, seconds, trim);
    this.crowd.update(seconds);
    for (const member of crew) this.followCrowd(member, seconds);
  }

  isWalkable(position: Vec3): boolean {
    const index = nearestDeckIndex(position.y);
    const grid = this.decks[index];
    if (Math.abs(position.y - grid.y) > 0.4) return false;
    return floorPointClear(index, grid.obstacles, position.x, position.z);
  }

  // Everything that decides where this sailor is going and what is holding him back.
  debugReport(member: CrewMember): NavigationDebug {
    const pending = this.pending.get(member.id);
    const landing = landingKey(member);
    return {
      crowd: this.crowd.debugState(member.id),
      pendingDestination: pending ? { ...pending } : null,
      replanInSeconds: pending ? Math.max(0, this.retryAt[member.id] - this.frameTime) : 0,
      settling: this.settling.has(member.id),
      heldForSingleFile: this.blockedIds.has(member.id),
      blockedSeconds: this.blockedFor[member.id],
      landing: landing ? {
        key: landing,
        leaderId: this.landingLeader.get(landing)?.id ?? null,
        waiting: this.landingWaiting.get(landing) ?? 0,
      } : null,
      floorSlot: this.memberFloorSlot.get(member.id) ?? null,
      routeIndex: member.routeIndex,
      route: member.route.map(waypoint => ({ ...waypoint })),
    };
  }

  setLadderOrders(active: boolean, trim: number): void {
    if (this.ladderOrdersActive === active) return;
    this.ladderOrdersActive = active;
    for (const member of this.crewById) {
      if (member && member.health > 0 && this.routeBreaksLadderOrders(member)) this.replanFromHere(member, trim);
    }
  }

  private replanFromHere(member: CrewMember, trim = this.previousTrim): void {
    const destination = this.lastRequested.get(member.id) ?? this.pending.get(member.id) ?? member.destination;
    this.lastRequested.delete(member.id);
    this.planRoute(member, destination, trim);
  }

  private routeBreaksLadderOrders(member: CrewMember): boolean {
    for (let index = member.routeIndex; index < member.route.length; index++) {
      const waypoint = member.route[index];
      const ladder = waypoint.kind === "stairs" && waypoint.passage !== undefined ? LADDERS_BY_ID.get(waypoint.passage) : undefined;
      if (ladder && waypoint.flow !== undefined && !this.ladderAllows(ladder, waypoint.flow)) return true;
    }
    return false;
  }

  private ladderAllows(ladder: DeckLadder, direction: number): boolean {
    if (ladder.flow !== undefined) return ladder.flow === direction;
    if (this.ladderOrdersActive && ladder.orderedFlow !== undefined) return ladder.orderedFlow === direction;
    return true;
  }

  // ---- berth grid construction ----
  private buildObstaclesFor(deckIndex: number): DeckObstacle[] {
    const obstacles: DeckObstacle[] = deckObstacles(deckIndex);
    if (deckIndex >= 1 && deckIndex <= 3) {
      for (const gun of this.guns) {
        if (gun.deck !== deckIndex) continue;
        const outboard = gun.side === "port" ? -1 : 1;
        const halfWidth = .85 * GUN_DIMENSIONS[gun.calibre].widthScale;
        obstacles.push({
          minX: gun.position.x - halfWidth, maxX: gun.position.x + halfWidth,
          minZ: outboard < 0 ? gun.position.z - 2.4 : gun.position.z - .75,
          maxZ: outboard < 0 ? gun.position.z + .75 : gun.position.z + 2.4,
        });
      }
    }
    return obstacles;
  }
  private buildDeckGrid(index: number, y: number, obstacles: DeckObstacle[]): DeckGrid {
    const minIX = Math.floor(-33 / GRID), maxIX = Math.ceil(33 / GRID);
    const minIZ = Math.floor(-9 / GRID), maxIZ = Math.ceil(9 / GRID);
    const cols = maxIX - minIX + 1, rows = maxIZ - minIZ + 1;
    const walkable = new Uint8Array(cols * rows);
    for (let ix = minIX; ix <= maxIX; ix++) {
      for (let iz = minIZ; iz <= maxIZ; iz++) {
        if (floorPointClear(index, obstacles, ix * GRID, izToZ(iz))) {
          walkable[(ix - minIX) + (iz - minIZ) * cols] = 1;
        }
      }
    }
    const grid: DeckGrid = {
      transit: new Uint8Array(cols * rows),
      index, y, minIX, maxIX, minIZ, maxIZ, cols, rows, walkable, obstacles,
    };
    retainConnectedDeck(grid);
    markNarrowTransit(grid);
    if (index === 3) markWeatherGangways(grid);
    return grid;
  }

  // ---- floor / aloft slot reservation ----
  private findFreeCell(grid: DeckGrid, deckIndex: number, x: number, z: number, excludeId: number): { x: number; z: number } | null {
    const cx = Math.round(x / GRID), cz = zToIz(z);
    const hit = ringSearch(80, cx, cz, (ix, iz) => {
      const c = cellIndex(grid, ix, iz);
      if (c < 0 || grid.walkable[c] !== 1 || grid.transit[c]) return false;
      const member = this.crewById[excludeId];
      const gun = member?.role === "gunner" && member.station >= 0 ? this.guns[member.station] : undefined;
      if (gun && gun.deck === deckIndex && Math.hypot(x - gun.position.x, z - gun.position.z) < 3.5
        && Math.hypot(ix * GRID - gun.position.x, izToZ(iz) - gun.position.z) > 3.4) return false;
      let exits = 0;
      for (let direction = 0; direction < 4; direction++) {
        const neighbor = cellIndex(grid, ix + NEIGHBOR_X[direction], iz + NEIGHBOR_Z[direction]);
        if (neighbor >= 0 && grid.walkable[neighbor]) exits++;
      }
      if (exits < 3) return false;
      for (const ladder of DECK_LADDERS) {
        const landing = ladder.lowerDeck === deckIndex ? ladder.lower : ladder.upperDeck === deckIndex ? ladder.upper : null;
        if (landing && Math.hypot(ix * GRID - landing.x, izToZ(iz) - landing.z) < 1.1) return false;
      }
      const owner = this.floorOwner.get(`${deckIndex}:${ix}:${iz}`);
      return owner === undefined || owner === excludeId;
    });
    return hit ? { x: hit.ix * GRID, z: izToZ(hit.iz) } : null;
  }
  private reserveFloorAt(deck: number, pos: Vec3, id: number): void {
    const key = `${deck}:${Math.round(pos.x / GRID)}:${zToIz(pos.z)}`;
    this.floorOwner.set(key, id);
    this.memberFloorSlot.set(id, key);
  }
  private releaseFloorSlot(id: number): void {
    const key = this.memberFloorSlot.get(id);
    if (key !== undefined) { this.floorOwner.delete(key); this.memberFloorSlot.delete(id); }
  }
  private findFreeLateral(mast: number, level: number, desired: number, excludeId: number): number | null {
    const limit = (mast === 2 ? 13 : 19) * (1 - level * .23) / 2 - .15;
    const base = Math.round((clamp(desired, -limit, limit) - .25) / LATERAL_STEP);
    for (let offset = 0; offset <= Math.ceil(limit * 2 / LATERAL_STEP); offset++) {
      for (let sign = 1; sign >= -1; sign -= 2) {
        if (!offset && sign < 0) continue;
        const quantized = base + sign * offset;
        const lateral = quantized * LATERAL_STEP + .25;
        if ((desired !== 0 && Math.sign(lateral) !== Math.sign(desired)) || Math.abs(lateral) < 1.25 || Math.abs(lateral) > limit) continue;
        const owner = this.aloftOwner.get(`${mast}:${level}:${quantized}`);
        let physicallyOccupied = false;
        for (const other of this.crewById) {
          if (!other || other.id === excludeId || other.health <= 0) continue;
          if (Math.abs(other.position.y - YARD_HEIGHTS[mast][level]) > 1.5) continue;
          const trim = Number.isFinite(this.previousTrim) ? this.previousTrim : 0;
          const otherLateral = (other.position.x - MAST_X[mast] - .25) * Math.sin(trim) + other.position.z * Math.cos(trim);
          if (nearestMast(other.position.x) === mast && Math.abs(otherLateral - lateral) < BODY_CLEARANCE) {
            physicallyOccupied = true;
            break;
          }
        }
        if (physicallyOccupied) continue;
        if (owner === undefined || owner === excludeId) return lateral;
      }
    }
    return null;
  }
  private reserveAloftAt(mast: number, level: number, lateral: number, id: number): void {
    const q = Math.round((lateral - .25) / LATERAL_STEP);
    const key = `${mast}:${level}:${q}`;
    this.aloftOwner.set(key, id);
    this.memberAloftSlot.set(id, key);
  }
  private releaseAloftSlot(id: number): void {
    const key = this.memberAloftSlot.get(id);
    if (key !== undefined) { this.aloftOwner.delete(key); this.memberAloftSlot.delete(id); }
  }

  // ---- destination resolution ----
  private resolveDeckAnchor(destination: Vec3, excludeId: number): DeckAnchor | null {
    const deck = nearestDeckIndex(destination.y);
    const grid = this.decks[deck];
    const cell = this.findFreeCell(grid, deck, destination.x, destination.z, excludeId);
    if (!cell) return null;
    return { kind: "deck", deck, pos: { x: cell.x, y: grid.y, z: cell.z } };
  }
  private resolveAloftAnchor(member: CrewMember, destination: Vec3, trim: number): AloftAnchor | null {
    const mast = nearestMast(destination.x);
    const levels = YARD_HEIGHTS[mast];
    let level = 0, bestDiff = Infinity;
    for (let i = 0; i < levels.length; i++) {
      const diff = Math.abs(destination.y - (levels[i] + 0.1));
      if (diff < bestDiff) { bestDiff = diff; level = i; }
    }
    const cosTrim = Math.cos(trim);
    const rawLateral = Math.abs(cosTrim) > 0.05 ? destination.z / cosTrim : destination.z;
    const lateral = this.findFreeLateral(mast, level, rawLateral, member.id);
    return lateral === null ? null : { kind: "aloft", mast, level, lateral };
  }

  // ---- route construction ----
  private connectAnchors(from: Anchor, to: Anchor, trim: number): CrewWaypoint[] | null {
    if (from.kind === "deck" && to.kind === "deck") {
      if (from.deck === to.deck && samePoint(from.pos, to.pos)) return [];
      return this.deckRoute(from.pos, from.deck, to.pos, to.deck);
    }
    if (from.kind === "deck" && to.kind === "aloft") {
      const side = to.lateral < 0 ? -1 : 1;
      const access = shroudAccess(to.mast, side, 2);
      const deckPart = this.deckRoute(from.pos, from.deck, access.deck, 3);
      if (!deckPart) return null;
      const leg = buildAloftLeg(to.mast, side, -1, 0, to.level, to.lateral, trim);
      return [...deckPart, ...leg];
    }
    if (from.kind === "aloft" && to.kind === "deck") {
      const side = from.lateral < 0 ? -1 : 1;
      const access = shroudAccess(from.mast, side, 0);
      const leg = buildAloftLeg(from.mast, side, from.level, from.lateral, -1, 0, trim);
      const deckPart = this.deckRoute(access.deck, 3, to.pos, to.deck);
      if (!deckPart) return null;
      return [...leg, ...deckPart];
    }
    if (from.kind === "aloft" && to.kind === "aloft") {
      if (from.mast === to.mast) {
        if (from.level === to.level && Math.abs(from.lateral - to.lateral) < 0.05) return [];
        const side = from.lateral < 0 ? -1 : 1;
        return buildAloftLeg(from.mast, side, from.level, from.lateral, to.level, to.lateral, trim);
      }
      const sideFrom = from.lateral < 0 ? -1 : 1;
      const descend = buildAloftLeg(from.mast, sideFrom, from.level, from.lateral, -1, 0, trim);
      const accessFrom = shroudAccess(from.mast, sideFrom, 0);
      const sideTo = to.lateral < 0 ? -1 : 1;
      const accessTo = shroudAccess(to.mast, sideTo, 2);
      const deckPart = this.deckRoute(accessFrom.deck, 3, accessTo.deck, 3);
      if (!deckPart) return null;
      const ascend = buildAloftLeg(to.mast, sideTo, -1, 0, to.level, to.lateral, trim);
      return [...descend, ...deckPart, ...ascend];
    }
    return null;
  }
  // Each deck leg is a single target; the crowd finds the way across the deck.
  private deckRoute(fromPos: Vec3, fromDeck: number, toPos: Vec3, toDeck: number): CrewWaypoint[] | null {
    const waypoints: CrewWaypoint[] = [];
    let currentPos = fromPos;
    let currentDeck = fromDeck;
    const direction = Math.sign(toDeck - fromDeck);
    while (currentDeck !== toDeck) {
      let bestLadder: DeckLadder | null = null;
      let bestLength = Infinity;
      for (const ladder of DECK_LADDERS) {
        if ((direction > 0 ? ladder.lowerDeck : ladder.upperDeck) !== currentDeck || !this.ladderAllows(ladder, direction)) continue;
        const length = this.crowd.pathLength(currentPos, direction > 0 ? ladder.lower : ladder.upper);
        if (length < bestLength) { bestLength = length; bestLadder = ladder; }
      }
      if (!bestLadder) return null;
      const entry = direction > 0 ? bestLadder.lower : bestLadder.upper;
      if (!samePoint(currentPos, entry)) waypoints.push({ ...entry, kind: "walk" });
      if (direction > 0) {
        waypoints.push({ x: bestLadder.start.x, y: bestLadder.start.y, z: bestLadder.start.z, kind: "stairs", passage: bestLadder.id });
        waypoints.push({ x: bestLadder.end.x, y: bestLadder.end.y, z: bestLadder.end.z, kind: "stairs", passage: bestLadder.id });
        currentPos = bestLadder.upper;
        waypoints.push({ ...bestLadder.upper, kind: "stairs", passage: bestLadder.id });
      } else {
        waypoints.push({ x: bestLadder.end.x, y: bestLadder.end.y, z: bestLadder.end.z, kind: "stairs", passage: bestLadder.id });
        waypoints.push({ x: bestLadder.start.x, y: bestLadder.start.y, z: bestLadder.start.z, kind: "stairs", passage: bestLadder.id });
        currentPos = bestLadder.lower;
        waypoints.push({ ...bestLadder.lower, kind: "stairs", passage: bestLadder.id });
      }
      currentDeck += direction;
    }
    if (this.crowd.pathLength(currentPos, toPos) === Infinity) return null;
    if (!samePoint(currentPos, toPos)) waypoints.push({ ...toPos, kind: "walk" });
    return waypoints;
  }

  private moveWithYards(crew: readonly CrewMember[], trim: number): void {
    const delta = Number.isFinite(this.previousTrim) ? trim - this.previousTrim : 0;
    this.previousTrim = trim;
    const cosine = Math.cos(delta), sine = Math.sin(delta);
    for (const member of crew) {
      const target = member.route[member.routeIndex];
      const last = member.route[member.route.length - 1];
      const support = target?.kind === "yard" ? target : !member.moving && last?.kind === "yard" ? last : undefined;
      if (support?.mast !== undefined && delta) {
        const x = member.position.x - MAST_X[support.mast] - .25;
        const z = member.position.z;
        member.position.x = MAST_X[support.mast] + .25 + cosine * x + sine * z;
        member.position.z = cosine * z - sine * x;
        member.heading += delta;
      }
      if (last?.kind === "yard" && last.mast !== undefined && last.level !== undefined && last.lateral !== undefined) {
        const position = last.onFootrope
          ? footropePosition(last.mast, last.level, last.lateral, trim, last.returning)
          : yardPosition(last.mast, last.level, last.lateral, trim);
        Object.assign(last, position);
        Object.assign(member.destination, position);
      }
    }
  }

  private rebuildCorridors(crew: readonly CrewMember[]): void {
    this.blockedIds.clear();
    this.fileTail.clear();
    for (const bucket of this.corridorScratch.values()) bucket.length = 0;
    for (const member of crew) {
      const target = member.route[member.routeIndex];
      if (member.health <= 0 || !target) continue;
      if (target.returning && target.mast !== undefined
        && yardNormal(member.position, target.mast, this.previousTrim) > -(WORK_ROPE_OFFSET + RETURN_ROPE_OFFSET) / 2) continue;
      const span = corridorSpan(member, this.previousTrim);
      if (!span) continue;
      const key = fileKey(span);
      let bucket = this.corridorScratch.get(key);
      if (!bucket) { bucket = []; this.corridorScratch.set(key, bucket); }
      bucket.push({ id: member.id, dir: span.dir, remain: span.remain });
    }
    for (const [key, bucket] of this.corridorScratch) {
      if (!bucket.length) continue;
      // The sailor nearest the far end never waits, so a file can always move.
      bucket.sort((a, b) => a.remain - b.remain);
      const headway = fileHeadway(key);
      let ahead = -Infinity;
      for (const entry of bucket) {
        if (entry.remain - ahead < headway) this.blockedIds.add(entry.id);
        ahead = entry.remain;
      }
      this.fileTail.set(key, ahead);
    }
  }

  private stopMotion(member: CrewMember, waiting: boolean): void {
    member.locomotion = waiting ? "wait" : "idle";
    member.speed = 0;
    member.velocity.x = 0;
    member.velocity.y = 0;
    member.velocity.z = 0;
  }

  private walkingSpeed(member: CrewMember, kind: CrewWaypoint["kind"]): number {
    const fatigue = clamp(1 - member.fatigue / 140, .4, 1);
    const health = clamp(member.health / 100, 0, 1);
    return baseSpeedFor(kind) * fatigue * health * (member.carrying ? .78 : 1);
  }

  private onDeck(position: Vec3): boolean {
    return position.y < ALOFT_THRESHOLD && Math.abs(position.y - WALKABLE_DECKS[nearestDeckIndex(position.y)]) < .3;
  }

  private enterCrowd(member: CrewMember): void {
    const placed = this.crowd.place(member.id, member.position);
    member.position.x = placed.x;
    member.position.y = WALKABLE_DECKS[nearestDeckIndex(member.position.y)];
    member.position.z = placed.z;
  }

  private stepMember(member: CrewMember, seconds: number, trim: number): void {
    if (member.health <= 0) {
      this.releaseFloorSlot(member.id);
      this.releaseAloftSlot(member.id);
      this.pending.delete(member.id);
      this.crowd.remove(member.id);
      this.settling.delete(member.id);
      member.moving = false;
      this.stopMotion(member, false);
      return;
    }
    const target = member.route[member.routeIndex];
    if (!target) {
      this.standOnDeck(member);
      return;
    }
    if (target.kind === "walk") {
      this.steerOnDeck(member, target);
      return;
    }
    if (target.kind === "yard" && target.mast !== undefined && target.level !== undefined && target.lateral !== undefined) {
      Object.assign(target, target.onFootrope
        ? footropePosition(target.mast, target.level, target.lateral, trim, target.returning)
        : yardPosition(target.mast, target.level, target.lateral, trim));
    }
    if (target.returning && target.mast !== undefined && target.lateral !== undefined
      && yardNormal(member.position, target.mast, trim) > -(WORK_ROPE_OFFSET + RETURN_ROPE_OFFSET) / 2) {
      const side = Math.sign(target.lateral);
      for (const other of this.crewById) {
        if (!other || other.id === member.id || other.health <= 0 || Math.abs(other.position.y - target.y) > 1.4) continue;
        if (yardNormal(other.position, target.mast, trim) > -(WORK_ROPE_OFFSET + RETURN_ROPE_OFFSET) / 2) continue;
        const gap = (yardLateral(other.position, target.mast, trim) - target.lateral) * side;
        if (gap > -.65 && gap < 1.4) {
          this.stopMotion(member, true);
          return;
        }
      }
    }
    if (this.blockedIds.has(member.id)) {
      this.blockedFor[member.id] += seconds;
      this.stopMotion(member, true);
      return;
    }
    if (target.kind === "climb" && target.mast !== undefined
      && (target.passage ?? 0) >= 300 && (target.passage ?? 0) < 400 && target.x < MAST_X[target.mast]) {
      for (const other of this.crewById) {
        if (!other || other.id === member.id || other.health <= 0) continue;
        if (other.position.y > Math.min(member.position.y, target.y) - BODY_CLEARANCE
          && other.position.y < target.y + 2
          && Math.hypot(other.position.x - target.x, other.position.z - target.z) < .45) {
          this.stopMotion(member, true);
          return;
        }
      }
    }
    const dx = target.x - member.position.x, dy = target.y - member.position.y, dz = target.z - member.position.z;
    const distance = Math.hypot(dx, dy, dz);
    const travel = Math.min(distance, this.walkingSpeed(member, target.kind) * seconds);
    const fraction = distance > 1e-6 ? travel / distance : 0;
    const px = member.position.x + dx * fraction, py = member.position.y + dy * fraction, pz = member.position.z + dz * fraction;
    const reached = distance <= travel + 1e-6;
    const actualDx = px - member.position.x, actualDy = py - member.position.y, actualDz = pz - member.position.z;
    member.position.x = px; member.position.y = py; member.position.z = pz;
    if (reached) member.routeIndex++;
    if (Math.hypot(actualDx, actualDy, actualDz) > 1e-6) {
      this.blockedFor[member.id] = 0;
      const heading = target.kind === "climb" && target.mast !== undefined
        ? Math.atan2(MAST_X[target.mast] - px, -pz)
        : Math.atan2(actualDx, actualDz);
      this.smoothMotion(member, actualDx, actualDy, actualDz, seconds, heading);
    } else this.stopMotion(member, false);
    member.moving = member.routeIndex < member.route.length || this.pending.has(member.id);
    member.locomotion = member.moving ? target.kind : "idle";
    // Stepping off a ladder or shroud onto a deck hands the sailor back to the crowd.
    const next = member.route[member.routeIndex];
    if (reached && (!next || next.kind === "walk") && this.onDeck(member.position)) this.enterCrowd(member);
  }

  private standOnDeck(member: CrewMember): void {
    member.moving = this.pending.has(member.id);
    if (!this.onDeck(member.position)) {
      this.stopMotion(member, member.moving);
      return;
    }
    if (!this.crowd.has(member.id)) this.enterCrowd(member);
    // A sailor pushed off his spot by passing traffic walks back to it.
    const home = member.destination;
    const drift = Math.abs(home.y - member.position.y) < .3 && !member.moving
      ? Math.hypot(member.position.x - home.x, member.position.z - home.z) : 0;
    if (drift > SETTLE_DISTANCE) this.settling.add(member.id);
    else if (drift < SETTLED_DISTANCE) this.settling.delete(member.id);
    // He gives way while stepping back, or he and the sailor who pushed him would shove at each other for good.
    if (this.settling.has(member.id)) this.crowd.moveTo(member.id, home, this.walkingSpeed(member, "walk"), true);
    else this.crowd.hold(member.id);
  }

  private steerOnDeck(member: CrewMember, target: CrewWaypoint): void {
    if (!this.crowd.has(member.id)) this.enterCrowd(member);
    this.settling.delete(member.id);
    const key = landingKey(member);
    const following = key !== null && this.landingLeader.get(key)?.id !== member.id;
    if (key && following) {
      const distance = Math.hypot(member.position.x - target.x, member.position.z - target.z);
      const waiting = this.landingWaiting.get(key) ?? 0;
      if (distance < Math.max(LANDING_WAIT_RADIUS, Math.sqrt(waiting * LANDING_WAIT_AREA / Math.PI))) {
        this.nextLandingWaiting.set(key, (this.nextLandingWaiting.get(key) ?? 0) + 1);
        this.crowd.hold(member.id);
        return;
      }
    }
    // Sailors headed for a busy landing stop at the edge of those waiting there instead of crushing in.
    this.crowd.moveTo(member.id, target, this.walkingSpeed(member, "walk"), following);
  }

  // Near a ladder or shroud only the nearest walker heads for its landing; the rest stand where they are,
  // and newcomers stop at the edge of those already waiting. Pressing on together, they would crush into
  // one spot faster than the crowd can push them apart. The nearest always walks on, so the wait always moves.
  private findLandingLeaders(crew: readonly CrewMember[]): void {
    this.landingLeader.clear();
    [this.landingWaiting, this.nextLandingWaiting] = [this.nextLandingWaiting, this.landingWaiting];
    this.nextLandingWaiting.clear();
    for (const member of crew) {
      const key = member.health > 0 && this.crowd.has(member.id) ? landingKey(member) : null;
      if (!key) continue;
      const target = member.route[member.routeIndex];
      const distance = Math.hypot(member.position.x - target.x, member.position.z - target.z);
      const leader = this.landingLeader.get(key);
      if (!leader || distance < leader.distance) this.landingLeader.set(key, { id: member.id, distance });
    }
  }

  private followCrowd(member: CrewMember, seconds: number): void {
    if (member.health <= 0 || !this.crowd.has(member.id)) return;
    const position = this.crowd.position(member.id), velocity = this.crowd.velocity(member.id);
    const moved = Math.hypot(position.x - member.position.x, position.z - member.position.z);
    // The navmesh reports heights on its own voxel grid; sailors stand on the true deck.
    member.position.x = position.x;
    member.position.y = WALKABLE_DECKS[nearestDeckIndex(position.y)];
    member.position.z = position.z;
    member.velocity.x = velocity.x; member.velocity.y = 0; member.velocity.z = velocity.z;
    member.speed = Math.hypot(velocity.x, velocity.z);
    member.gait += moved;
    const walking = member.speed > WALKING_SPEED_THRESHOLD;
    const alpha = Math.min(1, seconds / .18);
    if (walking) member.heading = lerpAngle(member.heading, Math.atan2(velocity.x, velocity.z), alpha);
    const target = member.route[member.routeIndex];
    if (target?.kind === "walk") {
      const next = member.route[member.routeIndex + 1];
      const tolerance = next?.passage !== undefined ? LANDING_ARRIVAL_DISTANCE : ARRIVAL_DISTANCE;
      const goal = this.crowd.goal(member.id) ?? target;
      if (Math.hypot(position.x - goal.x, position.z - goal.z) < tolerance && (!next || next.kind === "walk" || this.joinFile(member))) {
        member.routeIndex++;
        if (next && next.kind !== "walk") this.crowd.remove(member.id);
      }
    }
    member.moving = member.routeIndex < member.route.length || this.pending.has(member.id);
    member.locomotion = walking ? "walk" : member.moving ? "wait" : "idle";
  }

  // A walker steps onto a ladder or shroud only once the last sailor going his way has moved a spacing
  // ahead. Until then he waits on deck, where the crowd keeps waiting sailors apart instead of stacking
  // them on the landing.
  private joinFile(member: CrewMember): boolean {
    member.routeIndex++;
    const span = corridorSpan(member, this.previousTrim);
    member.routeIndex--;
    if (!span) return true;
    const key = fileKey(span);
    const tail = this.fileTail.get(key);
    if (tail !== undefined && span.remain - tail < fileHeadway(key)) return false;
    this.fileTail.set(key, span.remain);
    return true;
  }

  private smoothMotion(member: CrewMember, dx: number, dy: number, dz: number, seconds: number, heading: number): void {
    const alpha = Math.min(1, seconds / .18);
    const distance = Math.hypot(dx, dy, dz);
    member.velocity.x = lerp(member.velocity.x, dx / seconds, alpha);
    member.velocity.y = lerp(member.velocity.y, dy / seconds, alpha);
    member.velocity.z = lerp(member.velocity.z, dz / seconds, alpha);
    member.speed = lerp(member.speed, distance / seconds, alpha);
    member.gait += distance;
    member.heading = lerpAngle(member.heading, heading, alpha);
  }
}
