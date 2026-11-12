import { createRng, mixSeed, nextInt, type Rng } from "../rng.ts";
import { breadthFirstSearch, isWalkable, toIndex, TILE_FLOOR, type Grid, type Point } from "./grid.ts";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Floor extends Grid {
  depth: number;
  rooms: Rect[];
  stairsUp: Point;
  stairsDown: Point;
}

const BASE_ROOMS = 6;
const MAX_ROOMS = 30;
const BASE_SIDE = 40;
const MAX_SIDE = 120;
const MIN_LEAF_SIZE = 9;
const MIN_ROOM_SIZE = 4;
const ROOM_MARGIN = 1;
const ROOMS_PER_EXTRA_LOOP = 5;

export function roomCount(depth: number): number {
  return Math.min(MAX_ROOMS, BASE_ROOMS + Math.floor(depth / 2));
}

export function mapSide(depth: number): number {
  return Math.min(MAX_SIDE, BASE_SIDE + 2 * depth);
}

export function roomCenter(room: Rect): Point {
  return { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) };
}

/** Same `runSeed` and `depth` always produce the same floor, so floors never need to be saved. */
export function generateFloor(runSeed: number, depth: number): Floor {
  const rng = createRng(mixSeed(runSeed, depth));
  const side = mapSide(depth);
  const tiles = new Uint8Array(side * side);
  const leaves = splitIntoLeaves(rng, { x: 1, y: 1, width: side - 2, height: side - 2 }, roomCount(depth));
  const rooms = leaves.map((leaf) => carveRoom(rng, tiles, side, leaf));
  connectRooms(rng, tiles, side, rooms);

  const grid: Grid = { side, tiles };
  const stairsUp = roomCenter(rooms[nextInt(rng, 0, rooms.length - 1)]);
  const fromStairsUp = breadthFirstSearch(grid, [stairsUp], (index) => isWalkable(grid, index));
  const stairsDown = farthestRoomCenter(rooms, side, fromStairsUp.distance);
  return { depth, side, tiles, rooms, stairsUp, stairsDown };
}

function splitIntoLeaves(rng: Rng, area: Rect, targetCount: number): Rect[] {
  const leaves = [area];
  while (leaves.length < targetCount) {
    const index = largestSplittableLeaf(leaves);
    if (index === -1) break;
    leaves.splice(index, 1, ...splitLeaf(rng, leaves[index]));
  }
  return leaves;
}

function largestSplittableLeaf(leaves: readonly Rect[]): number {
  let bestIndex = -1;
  let bestArea = -1;
  leaves.forEach((leaf, index) => {
    const area = leaf.width * leaf.height;
    if (Math.max(leaf.width, leaf.height) >= 2 * MIN_LEAF_SIZE && area > bestArea) {
      bestIndex = index;
      bestArea = area;
    }
  });
  return bestIndex;
}

function splitLeaf(rng: Rng, leaf: Rect): [Rect, Rect] {
  if (leaf.width >= leaf.height) {
    const cut = nextInt(rng, MIN_LEAF_SIZE, leaf.width - MIN_LEAF_SIZE);
    return [
      { ...leaf, width: cut },
      { x: leaf.x + cut, y: leaf.y, width: leaf.width - cut, height: leaf.height },
    ];
  }
  const cut = nextInt(rng, MIN_LEAF_SIZE, leaf.height - MIN_LEAF_SIZE);
  return [
    { ...leaf, height: cut },
    { x: leaf.x, y: leaf.y + cut, width: leaf.width, height: leaf.height - cut },
  ];
}

function carveRoom(rng: Rng, tiles: Uint8Array, side: number, leaf: Rect): Rect {
  const width = nextInt(rng, MIN_ROOM_SIZE, leaf.width - 2 * ROOM_MARGIN);
  const height = nextInt(rng, MIN_ROOM_SIZE, leaf.height - 2 * ROOM_MARGIN);
  const x = nextInt(rng, leaf.x + ROOM_MARGIN, leaf.x + leaf.width - ROOM_MARGIN - width);
  const y = nextInt(rng, leaf.y + ROOM_MARGIN, leaf.y + leaf.height - ROOM_MARGIN - height);
  for (let row = y; row < y + height; row++) tiles.fill(TILE_FLOOR, row * side + x, row * side + x + width);
  return { x, y, width, height };
}

/** Joins each room to its nearest already-joined room, then adds a few extra corridors so floors have loops. */
function connectRooms(rng: Rng, tiles: Uint8Array, side: number, rooms: readonly Rect[]): void {
  const centers = rooms.map(roomCenter);
  const joined = [0];
  const unjoined = centers.map((_, index) => index).slice(1);
  while (unjoined.length > 0) {
    let bestFrom = 0;
    let bestSlot = 0;
    let bestDistance = Infinity;
    for (const from of joined) {
      unjoined.forEach((candidate, slot) => {
        const distance = Math.abs(centers[from].x - centers[candidate].x) + Math.abs(centers[from].y - centers[candidate].y);
        if (distance < bestDistance) {
          bestFrom = from;
          bestSlot = slot;
          bestDistance = distance;
        }
      });
    }
    const [to] = unjoined.splice(bestSlot, 1);
    carveCorridor(rng, tiles, side, centers[bestFrom], centers[to]);
    joined.push(to);
  }
  const extraLoops = Math.floor(rooms.length / ROOMS_PER_EXTRA_LOOP);
  for (let loop = 0; loop < extraLoops; loop++) {
    const from = nextInt(rng, 0, rooms.length - 1);
    const to = nextInt(rng, 0, rooms.length - 1);
    if (from !== to) carveCorridor(rng, tiles, side, centers[from], centers[to]);
  }
}

function carveCorridor(rng: Rng, tiles: Uint8Array, side: number, from: Point, to: Point): void {
  const corner = nextInt(rng, 0, 1) === 0 ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  carveStraightLine(tiles, side, from, corner);
  carveStraightLine(tiles, side, corner, to);
}

function carveStraightLine(tiles: Uint8Array, side: number, from: Point, to: Point): void {
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  tiles[y * side + x] = TILE_FLOOR;
  while (x !== to.x || y !== to.y) {
    x += stepX;
    y += stepY;
    tiles[y * side + x] = TILE_FLOOR;
  }
}

function farthestRoomCenter(rooms: readonly Rect[], side: number, distance: Int32Array): Point {
  let farthest = roomCenter(rooms[0]);
  let farthestDistance = -1;
  for (const room of rooms) {
    const center = roomCenter(room);
    const centerDistance = distance[toIndex(side, center)];
    if (centerDistance > farthestDistance) {
      farthest = center;
      farthestDistance = centerDistance;
    }
  }
  return farthest;
}
