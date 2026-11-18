import { DEFAULT_QUERY_FILTER, createFindNearestPolyResult, findNearestPoly, findPath, type NavMesh, type Vec3 as NavVec3 } from "navcat";
import { crowd as navcatCrowd, generateSoloNavMesh } from "navcat/blocks";
import type { CrowdAgentDebug, Vec3 } from "./types";

// Deck walkability is sampled on this grid and handed to the navmesh generator as strips of floor.
const SAMPLE_SPACING = .2;
const SAMPLE_MIN_X = -28;
const SAMPLE_MAX_X = 29;
const SAMPLE_HALF_BEAM = 8;
const CELL_SIZE = .1;
const CELL_HEIGHT = .05;
const AGENT_HEIGHT = 1.7;
const MAX_STEP_HEIGHT = .2;
// Decks are flat, so the detail mesh needs only coarse height samples.
const DETAIL_SAMPLE_CELLS = 6;
const MAX_ACCELERATION = 8;
// Sailors only ever touch those within an arm's length; a short range keeps neighbour checks cheap.
const COLLISION_QUERY_RANGE = 1.2;
const PATH_OPTIMIZATION_RANGE = 6;
const { ANTICIPATE_TURNS, OBSTACLE_AVOIDANCE, OPTIMIZE_VIS, OPTIMIZE_TOPO } = navcatCrowd.CrowdUpdateFlags;
// Separation is left off: it pushes a walker away from the sailor beside his station as hard as he walks
// towards it, so gun crews stall short of their places. Collision resolution alone keeps sailors apart.
// Obstacle avoidance is left off for ordinary walkers: it never lets a walker touch a standing sailor, so a
// gap between two gun crewmen would stop him for good. Without it, collisions shoulder the standing sailors
// aside and they step back to their places.
const WALKING_FLAGS = ANTICIPATE_TURNS | OPTIMIZE_VIS | OPTIMIZE_TOPO;
// A walker who should wait his turn behind standing sailors steers around or stops at them instead.
const YIELDING_FLAGS = WALKING_FLAGS | OBSTACLE_AVOIDANCE;
// Standing sailors only get pushed aside; they do no steering of their own.
const STANDING_FLAGS = 0;
const STANDING_VELOCITY: NavVec3 = [0, 0, 0];
// Crowd steering is unstable over long steps, so long simulation steps are split.
const MAX_CROWD_STEP = .05;
const SNAP_EXTENTS: NavVec3 = [2, .4, 2];
const RETARGET_DISTANCE = .05;
// A path stops short of an unreachable goal; anything further off than this did not arrive.
const PATH_ARRIVAL_TOLERANCE = .5;
// Rounds of pairwise separation run after every crowd step; more rounds settle denser groups.
const SEPARATION_ROUNDS = 3;
// Pairs this much further apart than touching are still checked, as the rounds can push them together.
const SEPARATION_PAIR_MARGIN = 1.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Hash key spacing per deck and per cell row; the ship spans far fewer cells than this.
const HASH_SPAN = 4096;
// Waiting sailors only need to stop or step around, so Detour's medium avoidance sampling is enough.
const YIELDING_AVOIDANCE = { ...navcatCrowd.DEFAULT_OBSTACLE_AVOIDANCE_PARAMS, adaptiveDivs: 5, adaptiveDepth: 2 };

export interface DeckSurface {
  y: number;
  clear(x: number, z: number): boolean;
}

interface DeckAgent {
  agentId: string;
  target: Vec3 | null;
  // Where the agent is actually heading: the target moved onto the mesh.
  goal: Vec3 | null;
}

// One quad covering a run of clear walkability samples along x.
function addWalkableStrip(positions: number[], indices: number[], x0: number, x1: number, z: number, y: number): void {
  const half = SAMPLE_SPACING / 2;
  const base = positions.length / 3;
  positions.push(x0 - half, y, z - half, x0 - half, y, z + half, x1 + half, y, z - half, x1 + half, y, z + half);
  indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

function toNav(point: Vec3): NavVec3 {
  return [point.x, point.y, point.z];
}

function fromNav(point: NavVec3): Vec3 {
  return { x: point[0], y: point[1], z: point[2] };
}

// Owns the ship's navigation mesh and one crowd agent per sailor standing or walking on a deck.
// Positions are ship-local; the mesh never moves with the hull.
export class DeckCrowd {
  private readonly navMesh: NavMesh;
  private readonly crowd: navcatCrowd.Crowd;
  private readonly agentRadius: number;
  private readonly agents = new Map<number, DeckAgent>();
  private readonly sailorByAgent = new Map<string, number>();
  private readonly nearest = createFindNearestPolyResult();
  // Scratch space for separation, reused every step.
  private readonly separating: navcatCrowd.Agent[] = [];
  private readonly separationBuckets = new Map<number, number[]>();
  private readonly separationPairs: number[] = [];

  constructor(decks: readonly DeckSurface[], agentRadius: number) {
    const positions: number[] = [], indices: number[] = [];
    const columns = Math.round((SAMPLE_MAX_X - SAMPLE_MIN_X) / SAMPLE_SPACING);
    const rows = Math.round(SAMPLE_HALF_BEAM / SAMPLE_SPACING);
    for (const deck of decks) {
      for (let row = -rows; row <= rows; row++) {
        const z = row * SAMPLE_SPACING;
        let runStart: number | null = null;
        for (let column = 0; column <= columns + 1; column++) {
          const x = SAMPLE_MIN_X + column * SAMPLE_SPACING;
          const clear = column <= columns && deck.clear(x, z);
          if (clear && runStart === null) runStart = x;
          if (!clear && runStart !== null) {
            addWalkableStrip(positions, indices, runStart, x - SAMPLE_SPACING, z, deck.y);
            runStart = null;
          }
        }
      }
    }
    this.navMesh = generateSoloNavMesh({ positions, indices }, {
      cellSize: CELL_SIZE,
      cellHeight: CELL_HEIGHT,
      // The deck surfaces are already shrunk by a sailor's radius away from every obstacle.
      walkableRadiusWorld: 0,
      walkableRadiusVoxels: 0,
      walkableClimbWorld: MAX_STEP_HEIGHT,
      walkableClimbVoxels: Math.floor(MAX_STEP_HEIGHT / CELL_HEIGHT),
      walkableHeightWorld: AGENT_HEIGHT,
      walkableHeightVoxels: Math.ceil(AGENT_HEIGHT / CELL_HEIGHT),
      walkableSlopeAngleDegrees: 30,
      borderSize: 0,
      minRegionArea: 4,
      mergeRegionArea: 20,
      maxSimplificationError: 1.1,
      maxEdgeLength: 24,
      maxVerticesPerPoly: 6,
      detailSampleDistance: CELL_SIZE * DETAIL_SAMPLE_CELLS,
      detailSampleMaxError: CELL_HEIGHT,
    }).navMesh;
    this.crowd = navcatCrowd.create(agentRadius + .1);
    this.agentRadius = agentRadius;
  }

  snap(point: Vec3): Vec3 {
    findNearestPoly(this.nearest, this.navMesh, toNav(point), SNAP_EXTENTS, DEFAULT_QUERY_FILTER);
    return this.nearest.success ? fromNav(this.nearest.position) : { ...point };
  }

  // Walking distance along the deck, or Infinity when the deck offers no way through.
  pathLength(from: Vec3, to: Vec3): number {
    const end = this.snap(to);
    const { success, path } = findPath(this.navMesh, toNav(this.snap(from)), toNav(end), SNAP_EXTENTS, DEFAULT_QUERY_FILTER);
    if (!success || path.length === 0) return Infinity;
    const last = path[path.length - 1].position;
    if (Math.hypot(last[0] - end.x, last[1] - end.y, last[2] - end.z) > PATH_ARRIVAL_TOLERANCE) return Infinity;
    let length = Math.hypot(path[0].position[0] - from.x, path[0].position[2] - from.z);
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1].position, b = path[index].position;
      length += Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    return length;
  }

  has(id: number): boolean {
    return this.agents.has(id);
  }

  // Puts the sailor onto the deck mesh, standing still; returns where he actually stands.
  place(id: number, position: Vec3): Vec3 {
    this.remove(id);
    const snapped = this.snap(position);
    const agentId = navcatCrowd.addAgent(this.crowd, this.navMesh, toNav(snapped), {
      radius: this.agentRadius,
      height: AGENT_HEIGHT,
      maxAcceleration: MAX_ACCELERATION,
      maxSpeed: 1,
      collisionQueryRange: COLLISION_QUERY_RANGE,
      pathOptimizationRange: PATH_OPTIMIZATION_RANGE,
      separationWeight: 0,
      updateFlags: STANDING_FLAGS,
      queryFilter: DEFAULT_QUERY_FILTER,
      obstacleAvoidance: YIELDING_AVOIDANCE,
    });
    this.agents.set(id, { agentId, target: null, goal: null });
    this.sailorByAgent.set(agentId, id);
    return snapped;
  }

  remove(id: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    navcatCrowd.removeAgent(this.crowd, agent.agentId);
    this.agents.delete(id);
    this.sailorByAgent.delete(agent.agentId);
  }

  // A yielding walker stops short of standing sailors rather than shouldering through them.
  moveTo(id: number, target: Vec3, speed: number, yielding: boolean): void {
    const agent = this.agents.get(id)!;
    const crowdAgent = this.crowd.agents[agent.agentId];
    crowdAgent.updateFlags = yielding ? YIELDING_FLAGS : WALKING_FLAGS;
    crowdAgent.maxSpeed = speed;
    if (agent.target && Math.hypot(agent.target.x - target.x, agent.target.y - target.y,
      agent.target.z - target.z) <= RETARGET_DISTANCE) return;
    findNearestPoly(this.nearest, this.navMesh, toNav(target), SNAP_EXTENTS, DEFAULT_QUERY_FILTER);
    if (!this.nearest.success) return;
    agent.goal = fromNav(this.nearest.position);
    agent.target = { ...target };
    navcatCrowd.requestMoveTarget(this.crowd, agent.agentId, this.nearest.nodeRef, this.nearest.position);
  }

  // A target beside an obstacle can lie off the mesh; arrival is judged at the goal the agent can reach.
  goal(id: number): Vec3 | null {
    return this.agents.get(id)?.goal ?? null;
  }

  // navcat's resetMoveTarget keeps the old path corners and goes on steering along them, so a held sailor
  // would walk on; asking for zero velocity stops him and still lets the crowd push him aside.
  hold(id: number): void {
    const agent = this.agents.get(id)!;
    if (!agent.target) return;
    navcatCrowd.requestMoveVelocity(this.crowd, agent.agentId, STANDING_VELOCITY);
    this.crowd.agents[agent.agentId].updateFlags = STANDING_FLAGS;
    agent.target = null;
    agent.goal = null;
  }

  update(seconds: number): void {
    const steps = Math.max(1, Math.ceil(seconds / MAX_CROWD_STEP - 1e-9));
    for (let step = 0; step < steps; step++) {
      navcatCrowd.update(this.crowd, this.navMesh, seconds / steps);
      this.separateOverlaps();
    }
  }

  // The crowd's own collision pass averages each agent's pushes and runs only four damped rounds, so a crowd
  // pressing into one spot still compresses, and it cannot part two standing agents on the very same point.
  // A few rounds of full pairwise separation give every sailor his own room without ever stopping anyone.
  private separateOverlaps(): void {
    const minimum = this.agentRadius * 2;
    this.collectSeparationPairs(minimum * SEPARATION_PAIR_MARGIN);
    const pairs = this.separationPairs;
    for (let round = 0; round < SEPARATION_ROUNDS; round++) {
      for (let index = 0; index < pairs.length; index += 2) this.separatePair(pairs[index], pairs[index + 1], minimum);
    }
  }

  // Agents on the same deck close enough to touch within this step's separation rounds.
  private collectSeparationPairs(range: number): void {
    this.separating.length = 0;
    this.separationPairs.length = 0;
    for (const bucket of this.separationBuckets.values()) bucket.length = 0;
    for (const agentId in this.crowd.agents) {
      const agent = this.crowd.agents[agentId];
      const key = this.separationCell(agent.position, 0, 0, range);
      let bucket = this.separationBuckets.get(key);
      if (!bucket) { bucket = []; this.separationBuckets.set(key, bucket); }
      bucket.push(this.separating.length);
      this.separating.push(agent);
    }
    for (let index = 0; index < this.separating.length; index++) {
      const a = this.separating[index].position;
      for (let cellX = -1; cellX <= 1; cellX++) {
        for (let cellZ = -1; cellZ <= 1; cellZ++) {
          const bucket = this.separationBuckets.get(this.separationCell(a, cellX, cellZ, range));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other <= index) continue;
            const b = this.separating[other].position;
            const dx = b[0] - a[0], dz = b[2] - a[2];
            if (Math.abs(a[1] - b[1]) > MAX_STEP_HEIGHT || dx * dx + dz * dz >= range * range) continue;
            this.separationPairs.push(index, other);
          }
        }
      }
    }
  }

  private separationCell(position: NavVec3, offsetX: number, offsetZ: number, size: number): number {
    const deck = Math.round(position[1]);
    const cellX = Math.floor(position[0] / size) + offsetX + HASH_SPAN / 2;
    const cellZ = Math.floor(position[2] / size) + offsetZ + HASH_SPAN / 2;
    return (deck * HASH_SPAN + cellX) * HASH_SPAN + cellZ;
  }

  private separatePair(first: number, second: number, minimum: number): void {
    const a = this.separating[first].position, b = this.separating[second].position;
    let dx = b[0] - a[0], dz = b[2] - a[2];
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= minimum * minimum) return;
    const distance = Math.sqrt(distanceSquared);
    if (distance < 1e-4) {
      const angle = (first + second) * GOLDEN_ANGLE;
      dx = Math.cos(angle); dz = Math.sin(angle);
    } else {
      dx /= distance; dz /= distance;
    }
    const push = (minimum - distance) / 2;
    a[0] -= dx * push; a[2] -= dz * push;
    b[0] += dx * push; b[2] += dz * push;
  }

  position(id: number): Vec3 {
    return fromNav(this.crowd.agents[this.agents.get(id)!.agentId].position);
  }

  velocity(id: number): Vec3 {
    return fromNav(this.crowd.agents[this.agents.get(id)!.agentId].velocity);
  }

  debugState(id: number): CrowdAgentDebug | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    const crowdAgent = this.crowd.agents[agent.agentId];
    return {
      agentState: crowdAgent.state,
      targetState: crowdAgent.targetState,
      partialPath: crowdAgent.targetPathIsPartial,
      updateFlags: crowdAgent.updateFlags,
      maxSpeed: crowdAgent.maxSpeed,
      desiredSpeed: crowdAgent.desiredSpeed,
      velocity: fromNav(crowdAgent.velocity),
      desiredVelocity: fromNav(crowdAgent.desiredVelocity),
      target: agent.target,
      goal: agent.goal,
      corners: crowdAgent.corners.length,
      corridorPolygons: crowdAgent.corridor.path.length,
      neighbours: crowdAgent.neis.flatMap(neighbour => this.sailorByAgent.get(neighbour.agentId) ?? []),
    };
  }
}
