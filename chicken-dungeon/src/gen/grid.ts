export interface Point {
  x: number;
  y: number;
}

export interface Grid {
  side: number;
  tiles: Uint8Array;
}

export interface SearchResult {
  distance: Int32Array;
  parent: Int32Array;
}

export const TILE_WALL = 0;
export const TILE_FLOOR = 1;

const UNREACHED = -1;
const NEIGHBOR_OFFSETS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function toIndex(side: number, point: Point): number {
  return point.y * side + point.x;
}

export function toPoint(side: number, index: number): Point {
  const x = index % side;
  return { x, y: (index - x) / side };
}

export function isWalkable(grid: Grid, index: number): boolean {
  return grid.tiles[index] !== TILE_WALL;
}

export function breadthFirstSearch(grid: Grid, sources: readonly Point[], canEnter: (index: number) => boolean): SearchResult {
  const { side } = grid;
  const distance = new Int32Array(side * side).fill(UNREACHED);
  const parent = new Int32Array(side * side).fill(UNREACHED);
  const queue = new Int32Array(side * side);
  let head = 0;
  let tail = 0;
  for (const source of sources) {
    const index = toIndex(side, source);
    if (distance[index] !== UNREACHED) continue;
    distance[index] = 0;
    queue[tail++] = index;
  }
  while (head < tail) {
    const current = queue[head++];
    const currentX = current % side;
    const currentY = (current - currentX) / side;
    for (const offset of NEIGHBOR_OFFSETS) {
      const x = currentX + offset.x;
      const y = currentY + offset.y;
      if (x < 0 || y < 0 || x >= side || y >= side) continue;
      const neighbor = y * side + x;
      if (distance[neighbor] !== UNREACHED || !canEnter(neighbor)) continue;
      distance[neighbor] = distance[current] + 1;
      parent[neighbor] = current;
      queue[tail++] = neighbor;
    }
  }
  return { distance, parent };
}

/** Steps from the search source to `targetIndex`, excluding the source and including the target. */
export function pathTo(side: number, search: SearchResult, targetIndex: number): Point[] {
  const path: Point[] = [];
  for (let index = targetIndex; search.parent[index] !== UNREACHED; index = search.parent[index]) {
    path.push(toPoint(side, index));
  }
  return path.reverse();
}

/** A 4-neighbor of `point` that is one step closer to the distance map's source, or null at the source or off the map. */
export function stepDownhill(side: number, distance: Int32Array, point: Point): Point | null {
  const here = distance[toIndex(side, point)];
  if (here <= 0) return null;
  for (const offset of NEIGHBOR_OFFSETS) {
    const x = point.x + offset.x;
    const y = point.y + offset.y;
    if (x < 0 || y < 0 || x >= side || y >= side) continue;
    if (distance[y * side + x] === here - 1) return { x, y };
  }
  return null;
}
