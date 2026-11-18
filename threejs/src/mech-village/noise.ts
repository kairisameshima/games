export type Random = () => number;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(random: Random, min: number, max: number): number {
  return min + (max - min) * random();
}

export function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function hashLattice(x: number, y: number, seed: number): number {
  let hash = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise in [0, 1]. With a period, lattice coordinates wrap so the
 * result tiles seamlessly across [0, period) in both axes.
 */
export function valueNoise(x: number, y: number, seed = 0, period = 0): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = smootherstep(x - cellX);
  const fractionY = smootherstep(y - cellY);
  const wrap = (cell: number): number => (period > 0 ? ((cell % period) + period) % period : cell);
  const x0 = wrap(cellX);
  const x1 = wrap(cellX + 1);
  const y0 = wrap(cellY);
  const y1 = wrap(cellY + 1);
  const top = hashLattice(x0, y0, seed) * (1 - fractionX) + hashLattice(x1, y0, seed) * fractionX;
  const bottom = hashLattice(x0, y1, seed) * (1 - fractionX) + hashLattice(x1, y1, seed) * fractionX;
  return top * (1 - fractionY) + bottom * fractionY;
}

/** Fractal value noise in [0, 1]. A nonzero period makes every octave tile. */
export function fbm(x: number, y: number, octaves: number, seed = 0, period = 0): number {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 17, period * frequency) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / weight;
}
