export interface Rng {
  state: number;
}

const UINT32_RANGE = 4294967296;
const GOLDEN_RATIO_32 = 0x9e3779b1;

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

// mulberry32. The whole generator state is one uint32, so saves and replays only store a number.
function nextUint32(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let mixed = rng.state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return (mixed ^ (mixed >>> 14)) >>> 0;
}

export function nextInt(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor((nextUint32(rng) / UINT32_RANGE) * (maxInclusive - min + 1));
}

export function rollChance(rng: Rng, probability: number): boolean {
  return nextUint32(rng) / UINT32_RANGE < probability;
}

export function mixSeed(seed: number, salt: number): number {
  let hash = (seed ^ Math.imul(salt, GOLDEN_RATIO_32)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}
