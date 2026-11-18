import assert from "node:assert/strict";
import { after, test } from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";

const server = await createServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
/** @type {typeof import('../src/ship-of-the-line/navigation.ts')} */
const { CrewNavigation } = await server.ssrLoadModule("/src/ship-of-the-line/navigation.ts");
/** @type {typeof import('../src/ship-of-the-line/layout.ts')} */
const { DECK_LADDERS, CREW_RADIUS } = await server.ssrLoadModule("/src/ship-of-the-line/layout.ts");
/** @type {typeof import('../src/ship-of-the-line/simulation.ts')} */
const { createSimulation } = await server.ssrLoadModule("/src/ship-of-the-line/simulation.ts");
const ladder = DECK_LADDERS[0];

after(async () => { await server.close(); });

/** @param {number} id @param {import('../src/ship-of-the-line/types.ts').Vec3} position @param {import('../src/ship-of-the-line/types.ts').CrewWaypoint[]} route @returns {import('../src/ship-of-the-line/types.ts').CrewMember} */
function createCrewMember(id, position, route) {
  const destination = route.at(-1) ?? position;
  return {
    id, name: `Sailor ${id}`, role: "sailor", task: "muster",
    position: { ...position }, destination: { x: destination.x, y: destination.y, z: destination.z },
    route, routeIndex: 0, velocity: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, gait: 0,
    locomotion: "walk", carrying: false, station: -1, health: 100, fatigue: 0, progress: 0, moving: true,
  };
}

/** @returns {import('../src/ship-of-the-line/types.ts').CrewWaypoint[]} */
function climbRoute() {
  return [
    { ...ladder.lower, kind: "walk" },
    ...[ladder.start, ladder.end, ladder.upper].map(position => ({ ...position, kind: /** @type {const} */ ("stairs"), passage: ladder.id, flow: 1 })),
  ];
}

/** @returns {import('../src/ship-of-the-line/types.ts').CrewWaypoint[]} */
function descentRoute() {
  return [
    { ...ladder.upper, kind: "walk" },
    ...[ladder.end, ladder.start, ladder.lower].map(position => ({ ...position, kind: /** @type {const} */ ("stairs"), passage: ladder.id, flow: -1 })),
  ];
}

/** @param {InstanceType<typeof CrewNavigation>} navigation @param {import('../src/ship-of-the-line/types.ts').CrewMember[]} crew @param {number} seconds @param {(time: number) => void} [observe] */
function run(navigation, crew, seconds, observe) {
  for (let frame = 1; frame <= seconds * 10; frame++) {
    navigation.step(crew, .1, frame * .1, 0);
    observe?.(frame * .1);
  }
}

test("sailors going opposite ways on one ladder both get through", () => {
  const navigation = new CrewNavigation([]);
  const climbing = createCrewMember(0, { ...ladder.lower, x: ladder.lower.x - 1 }, climbRoute());
  const descending = createCrewMember(1, { ...ladder.upper, x: ladder.upper.x + 1 }, descentRoute());
  run(navigation, [climbing, descending], 30);
  assert.equal(climbing.moving, false);
  assert.equal(descending.moving, false);
  assert.equal(climbing.position.y, ladder.upper.y);
  assert.equal(descending.position.y, ladder.lower.y);
});

test("sailors climbing one ladder keep single-file spacing on it", () => {
  const navigation = new CrewNavigation([]);
  const crew = [0, 1, 2].map(id => createCrewMember(id, { ...ladder.lower, x: ladder.lower.x - .6 - id * .5 }, climbRoute()));
  let closest = Infinity;
  run(navigation, crew, 40, () => {
    const onLadder = crew.filter(member => member.position.y > ladder.lower.y + .05 && member.position.y < ladder.upper.y - .05);
    for (let first = 0; first < onLadder.length; first++) {
      for (let second = first + 1; second < onLadder.length; second++) {
        const a = onLadder[first].position, b = onLadder[second].position;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
    }
  });
  assert.deepEqual(crew.map(member => member.moving), [false, false, false]);
  assert.ok(closest > .8, `two climbers came within ${closest.toFixed(2)}m on the ladder`);
});

test("a crowd converging on one landing waits apart instead of stacking", () => {
  const navigation = new CrewNavigation([]);
  const starts = [];
  for (let x = ladder.lower.x + 1.5; starts.length < 60; x += .7) {
    for (let z = -3.5; z <= 3.5 && starts.length < 60; z += .7) {
      const spot = { x, y: ladder.lower.y, z };
      if (navigation.isWalkable(spot)) starts.push(spot);
    }
  }
  const crew = starts.map((start, id) => createCrewMember(id, start, climbRoute()));
  let closest = Infinity;
  run(navigation, crew, 20, () => {
    const waiting = crew.filter(member => Math.abs(member.position.y - ladder.lower.y) < .05);
    for (let first = 0; first < waiting.length; first++) {
      for (let second = first + 1; second < waiting.length; second++) {
        const a = waiting[first].position, b = waiting[second].position;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
  });
  assert.ok(crew.some(member => !member.moving), "nobody got up the ladder");
  assert.ok(closest > CREW_RADIUS, `two waiting sailors came within ${closest.toFixed(2)}m`);
});

test("beating to quarters brings every gun crew to its station without stranding sailors", { timeout: 180_000 }, () => {
  const simulation = createSimulation();
  simulation.command({ type: "stations", active: true });
  const mustered = () => simulation.state.crew.every(member => !member.moving)
    && simulation.state.guns.every(gun => gun.phase === "ready");
  for (let frame = 0; frame < 30000 && !mustered(); frame++) simulation.update(.1);
  const stranded = simulation.state.crew.filter(member => member.moving).map(member => member.id);
  assert.deepEqual(stranded, [], `sailors still moving after ${simulation.state.time.toFixed(0)}s`);
  assert.equal(simulation.state.guns.filter(gun => gun.phase === "ready").length, simulation.state.guns.length);
});
