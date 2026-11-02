import * as THREE from "three";
import { PARTS } from "./data.js";
import { createTankMesh, paintMaterial } from "./models.js";
import { block, canvasTexture, column, contactShadow, mesh, seeded, SHARED } from "./scene-kit.js";
import { MODEL_BY_ID, STATION_BY_ID, storageCap } from "./sim.js";

export const FLOOR_Y = 0.2;
const BELT_HEIGHT = 0.75;
const BELT_SPEED = 4.5;
const BELT_TILE = 1.4;
const ITEM_SPAWNS_PER_SECOND = 5;
const MAX_BELT_ITEMS = 140;
const STOCK_PILE_SLOTS = 24;
const WORKER_SPEED = 1.3;
const FORKLIFT_SPEED = 3.2;
const ASSEMBLY_PLATFORM_HEIGHT = 0.2;
export const RAIL_Z = 15.2;
const RAIL_START_X = -100;
const RAIL_END_X = -31;
/** Seconds for each leg of the supply train's run: arrive, unload, leave, then wait off-screen. */
const TRAIN_SCHEDULE = { arrive: 14, unload: 10, depart: 12, away: 12 };

export const STATION_LAYOUT = {
  power: { x: -14, z: -14.5 },
  mill: { x: -58, z: -6 },
  hull: { x: -44, z: -6 },
  turret: { x: -36, z: -6 },
  engine: { x: -28, z: -6 },
  assembly: { x: -18, z: 0 },
};

const SHOP_IDS = ["hull", "turret", "engine"];
const SHOP_SIZE = { width: 7, depth: 7, height: 5.2 };
const ASSEMBLY_SIZE = { width: 12, depth: 13, height: 8 };
/** New machines appear in a shop's bays at these levels, so upgrades are visible on the floor. */
const SHOP_BAY_LEVELS = [1, 5, 12];
const SHOP_BAY_X = [0, -2.3, 2.3];
const FURNACE_LEVELS = [1, 8, 18];
const COOLING_TOWER_LEVELS = [5, 12];
const EXTRA_CRANE_LEVEL = 6;
const WELDER_LEVELS = [1, 4, 9, 16];

const STATUS_COLORS = {
  running: 0x6dff7a,
  underpowered: 0xffb030,
  starved: 0xffb030,
  blocked: 0x4ab8ff,
  idle: 0x8a8a8a,
};

const RING_RADIUS = { power: 7, mill: 6.5, hull: 4.8, turret: 4.8, engine: 4.8, assembly: 8 };
const LABEL_HEIGHT = { power: 17, mill: 13, hull: 7.5, turret: 7.5, engine: 7.5, assembly: 11 };
const ACCENTS = { hull: 0x7d8a3c, turret: 0x4f7896, engine: 0xb0452e, assembly: 0xd8b13a };

function brickTexture() {
  const texture = canvasTexture(128, 128, (context) => {
    context.fillStyle = "#6b5d52";
    context.fillRect(0, 0, 128, 128);
    const random = seeded(7);
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 === 0 ? 0 : 32;
      for (let column = -1; column < 3; column += 1) {
        const shade = 0.82 + random() * 0.3;
        context.fillStyle = `rgb(${Math.round(150 * shade)},${Math.round(78 * shade)},${Math.round(56 * shade)})`;
        context.fillRect(column * 64 + offset + 2, row * 32 + 2, 60, 28);
      }
    }
  });
  texture.repeat.set(1 / 1.2, 1 / 0.9);
  return texture;
}

function concreteTexture() {
  return canvasTexture(256, 256, (context) => {
    const random = seeded(19);
    context.fillStyle = "#a3a093";
    context.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 1400; index += 1) {
      const light = random() > 0.5;
      context.fillStyle = light ? "rgba(255,255,245,0.08)" : "rgba(40,36,30,0.09)";
      const size = 1 + random() * 3;
      context.fillRect(random() * 256, random() * 256, size, size);
    }
    for (let index = 0; index < 5; index += 1) {
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 30);
      gradient.addColorStop(0, "rgba(50,44,36,0.16)");
      gradient.addColorStop(1, "rgba(50,44,36,0)");
      context.save();
      context.translate(random() * 256, random() * 256);
      context.scale(1 + random(), 0.6 + random() * 0.6);
      context.fillStyle = gradient;
      context.fillRect(-30, -30, 60, 60);
      context.restore();
    }
    context.strokeStyle = "rgba(70,66,58,0.32)";
    context.lineWidth = 2;
    for (const offset of [0, 128]) {
      context.beginPath();
      context.moveTo(offset + 1, 0);
      context.lineTo(offset + 1, 256);
      context.moveTo(0, offset + 1);
      context.lineTo(256, offset + 1);
      context.stroke();
    }
  });
}

function hazardTexture() {
  return canvasTexture(64, 64, (context) => {
    context.fillStyle = "#e0b63a";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#26241f";
    for (let offset = -64; offset < 64; offset += 32) {
      context.beginPath();
      context.moveTo(offset, 64);
      context.lineTo(offset + 16, 64);
      context.lineTo(offset + 80, 0);
      context.lineTo(offset + 64, 0);
      context.fill();
    }
  });
}

function windowTexture() {
  return canvasTexture(64, 64, (context) => {
    context.fillStyle = "#ffcf7a";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#2c2a26";
    context.fillRect(0, 0, 64, 5);
    context.fillRect(0, 59, 64, 5);
    context.fillRect(0, 0, 5, 64);
    context.fillRect(59, 0, 5, 64);
    context.fillRect(30, 0, 4, 64);
    context.fillRect(0, 30, 64, 4);
  });
}

function corrugatedTexture() {
  const texture = canvasTexture(32, 8, (context) => {
    for (let x = 0; x < 32; x += 1) {
      const shade = 0.75 + 0.25 * Math.cos((x / 32) * Math.PI * 4);
      context.fillStyle = `rgb(${Math.round(112 * shade)},${Math.round(116 * shade)},${Math.round(112 * shade)})`;
      context.fillRect(x, 0, 1, 8);
    }
  });
  texture.repeat.set(1 / 1.2, 1);
  return texture;
}

function beltTexture() {
  return canvasTexture(64, 16, (context) => {
    context.fillStyle = "#2c2d2a";
    context.fillRect(0, 0, 64, 16);
    context.fillStyle = "#4a4b46";
    for (let x = 0; x < 64; x += 16) context.fillRect(x, 0, 6, 16);
  });
}

/** Box whose UVs are in world units, so tiled textures keep one scale on any size. */
function worldUvBox(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const faces = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  faces.forEach(([u, v], face) => {
    for (let corner = 0; corner < 4; corner += 1) {
      const index = face * 4 + corner;
      uv.setXY(index, uv.getX(index) * u, uv.getY(index) * v);
    }
  });
  return geometry;
}

function texturedBlock(parent, width, height, depth, material, x, y, z) {
  const item = mesh(worldUvBox(width, height, depth), material, x, y + height / 2, z);
  parent.add(item);
  return item;
}

function createMaterials() {
  const windowMap = windowTexture();
  const hazard = hazardTexture();
  const concrete = concreteTexture();
  concrete.repeat.set(1 / 10, 1 / 10);
  return {
    brick: new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.95 }),
    brickDark: paintMaterial(0x6d3828),
    concrete: new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 }),
    concreteDark: paintMaterial(0x77746b),
    asphalt: paintMaterial(0x4d4c48),
    roof: new THREE.MeshStandardMaterial({ map: corrugatedTexture(), roughness: 0.7, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9ec4d0, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.3, depthWrite: false }),
    window: new THREE.MeshStandardMaterial({ map: windowMap, emissive: 0xffb050, emissiveMap: windowMap, emissiveIntensity: 0.7, roughness: 0.4 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8 }),
    stripe: paintMaterial(0xd8b13a),
    paintWhite: paintMaterial(0xe8e4d6),
    steelBeam: paintMaterial(0x4f5a62),
    steelDark: paintMaterial(0x33393d),
    machine: paintMaterial(0x4d6a6f),
    machineLight: paintMaterial(0x8aa3a1),
    rust: paintMaterial(0x7a4d2e),
    rustDark: paintMaterial(0x5a3a26),
    glow: paintMaterial(0xff8a2a, { emissive: 0xff6a10 }),
    molten: paintMaterial(0xffb84a, { emissive: 0xff8a20 }),
    lampBulb: paintMaterial(0xfff2c0, { emissive: 0xffe0a0 }),
    coal: paintMaterial(0x26252a),
    ballast: paintMaterial(0x6f6a62),
    ore: paintMaterial(0x8a6a52),
    wood: paintMaterial(0x7a5a3a),
    pallet: paintMaterial(0x9a7a50),
    tire: paintMaterial(0x1e1e1e),
    olive: paintMaterial(0x5b6634),
    canvasCover: paintMaterial(0x8b8a64),
    forklift: paintMaterial(0xd9a22c),
    skin: paintMaterial(0xe0b48c),
    insulator: paintMaterial(0xd8d2c0),
    ingot: paintMaterial(0x9aa3a8, { roughness: 0.5 }),
    hullPart: paintMaterial(0x5d6a3a),
    turretPart: paintMaterial(0x6f7b48),
    enginePart: paintMaterial(0x4a4440),
    engineTop: paintMaterial(0xb2452e),
    beltFrame: paintMaterial(0x6c6f68),
  };
}

function pathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += points[index].distanceTo(points[index - 1]);
  return length;
}

function pointOnPath(points, distance, target) {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const segment = points[index].distanceTo(points[index - 1]);
    if (remaining <= segment) return target.lerpVectors(points[index - 1], points[index], segment === 0 ? 0 : remaining / segment);
    remaining -= segment;
  }
  return target.copy(points[points.length - 1]);
}

/** Position and heading along a closed loop of points. */
function pointOnLoop(points, distance, target) {
  const closed = [...points, points[0]];
  const length = pathLength(closed);
  const wrapped = ((distance % length) + length) % length;
  let remaining = wrapped;
  for (let index = 1; index < closed.length; index += 1) {
    const from = closed[index - 1];
    const to = closed[index];
    const segment = from.distanceTo(to);
    if (remaining <= segment) {
      target.lerpVectors(from, to, segment === 0 ? 0 : remaining / segment);
      return Math.atan2(-(to.z - from.z), to.x - from.x);
    }
    remaining -= segment;
  }
  target.copy(points[0]);
  return 0;
}

function beltPoint(x, z) {
  return new THREE.Vector3(x, BELT_HEIGHT, z);
}

function groundPoint(x, z) {
  return new THREE.Vector3(x, FLOOR_Y, z);
}

/** A small hard-hat figure facing +x. Limbs pivot at hip and shoulder. */
function buildWorker(materials, random) {
  const group = new THREE.Group();
  const overalls = paintMaterial([0x3d5a80, 0x5a4a3a, 0x4d5a3a, 0x6a5a48][Math.floor(random() * 4)]);
  const helmet = random() > 0.4 ? materials.stripe : paintMaterial(0x6b6a4a);
  const limb = (x, y, z, height, material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    block(pivot, 0.12, height, 0.12, material, 0, -height, 0);
    group.add(pivot);
    return pivot;
  };
  const leftLeg = limb(0, 0.46, 0.08, 0.46, overalls);
  const rightLeg = limb(0, 0.46, -0.08, 0.46, overalls);
  block(group, 0.24, 0.42, 0.34, overalls, 0, 0.44, 0);
  const leftArm = limb(0, 0.84, 0.23, 0.38, overalls);
  const rightArm = limb(0, 0.84, -0.23, 0.38, overalls);
  const head = mesh(SHARED.sphere, materials.skin, 0, 1.0, 0);
  head.scale.setScalar(0.12);
  group.add(head);
  const hat = mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), helmet, 0, 1.05, 0);
  group.add(hat);
  group.add(contactShadow(0.7, 0.7, 0.4));
  return { group, leftLeg, rightLeg, leftArm, rightArm };
}

function animateWalk(worker, time, speed) {
  const swing = Math.sin(time * 7 * speed) * 0.6;
  worker.leftLeg.rotation.z = swing;
  worker.rightLeg.rotation.z = -swing;
  worker.leftArm.rotation.z = -swing * 0.8;
  worker.rightArm.rotation.z = swing * 0.8;
}

function buildPress(materials, paint) {
  const group = new THREE.Group();
  block(group, 2.1, 0.6, 1.7, paint, 0, 0, 0);
  block(group, 0.3, 2.8, 0.3, materials.machineLight, -0.9, 0.6, -0.5);
  block(group, 0.3, 2.8, 0.3, materials.machineLight, 0.9, 0.6, -0.5);
  block(group, 0.3, 2.8, 0.3, materials.machineLight, -0.9, 0.6, 0.5);
  block(group, 0.3, 2.8, 0.3, materials.machineLight, 0.9, 0.6, 0.5);
  block(group, 2.3, 0.6, 1.5, paint, 0, 3.4, 0);
  column(group, 0.25, 0.25, 0.9, materials.steelDark, 0, 4.0, 0, 10);
  const ram = block(group, 1.6, 0.45, 1.2, materials.steelBeam, 0, 2.3, 0);
  const plate = block(group, 1.5, 0.1, 1.1, materials.hullPart, 0, 0.6, 0);
  block(group, 0.35, 0.9, 0.35, materials.stripe, 1.35, 0, 0.75);
  const ramRestY = ram.position.y;
  return {
    group,
    sparkOffset: new THREE.Vector3(0, 0.9, 0),
    animate(activity, time, phase) {
      const stroke = Math.max(0, Math.sin(time * 4 + phase)) ** 3 * activity;
      ram.position.y = ramRestY - stroke * 1.6;
      plate.visible = activity > 0;
      return stroke > 0.95;
    },
  };
}

function buildLathe(materials, paint) {
  const group = new THREE.Group();
  block(group, 3.2, 0.9, 1.2, paint, 0, 0, 0);
  block(group, 0.8, 1.6, 1.1, materials.machineLight, -1.3, 0.9, 0);
  block(group, 0.5, 0.9, 0.9, materials.machineLight, 1.35, 0.9, 0);
  const chuck = new THREE.Group();
  chuck.position.set(0.1, 1.75, 0);
  chuck.add(mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.7, 8).rotateZ(Math.PI / 2), materials.turretPart));
  chuck.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8).rotateZ(Math.PI / 2), materials.steelBeam, 0.9, 0, 0));
  group.add(chuck);
  const tool = block(group, 0.25, 0.35, 0.25, materials.glow, 0.1, 1.2, 0.7);
  return {
    group,
    sparkOffset: new THREE.Vector3(0.1, 1.5, 0.75),
    animate(activity, time, phase) {
      chuck.rotation.x += 0.15 * activity;
      tool.position.x = Math.sin(time * 1.5 + phase) * 0.7;
      tool.visible = activity > 0;
      this.sparkOffset.x = tool.position.x;
      return activity > 0 && Math.random() < 0.08;
    },
  };
}

function buildEngineBench(materials, paint) {
  const group = new THREE.Group();
  block(group, 2.6, 0.5, 1.6, paint, 0, 0, 0);
  block(group, 1.8, 1.0, 1.1, materials.enginePart, -0.3, 0.5, 0);
  block(group, 1.6, 0.3, 0.9, materials.engineTop, -0.3, 1.5, 0);
  const pistons = [];
  for (let index = 0; index < 4; index += 1) pistons.push(block(group, 0.22, 0.4, 0.22, materials.machineLight, -0.95 + index * 0.43, 1.7, 0));
  const gear = new THREE.Group();
  gear.position.set(1.0, 1.1, 0.35);
  gear.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 14).rotateX(Math.PI / 2), materials.steelBeam));
  for (let tooth = 0; tooth < 10; tooth += 1) {
    const angle = (tooth / 10) * Math.PI * 2;
    const cog = mesh(SHARED.box, materials.steelBeam, Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0);
    cog.scale.set(0.18, 0.18, 0.2);
    cog.rotation.z = angle;
    gear.add(cog);
  }
  group.add(gear);
  column(group, 0.08, 0.1, 1.6, materials.steelDark, -1.1, 1.5, -0.4, 8);
  return {
    group,
    exhaustOffset: new THREE.Vector3(-1.1, 3.2, -0.4),
    animate(activity, time, phase) {
      gear.rotation.z += 0.1 * activity;
      pistons.forEach((piston, index) => {
        piston.position.y = 1.9 + Math.sin(time * 12 + phase + index * Math.PI * 0.5) * 0.18 * activity;
      });
      return false;
    },
  };
}

const MACHINE_BUILDERS = { hull: buildPress, turret: buildLathe, engine: buildEngineBench };

function buildTruck(materials) {
  const group = new THREE.Group();
  block(group, 1.3, 1.1, 1.6, materials.olive, 1.6, 0.45, 0);
  block(group, 0.8, 0.6, 1.4, materials.olive, 2.6, 0.45, 0);
  block(group, 0.06, 0.4, 1.2, materials.glass, 2.27, 1.0, 0);
  block(group, 3.0, 0.25, 1.7, materials.olive, -0.6, 0.55, 0);
  block(group, 2.9, 0.9, 1.65, materials.canvasCover, -0.6, 0.8, 0);
  group.add(contactShadow(5.2, 2.4, 0.5));
  for (const x of [2.3, -0.2, -1.4]) {
    for (const side of [-1, 1]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12).rotateX(Math.PI / 2), materials.tire, x, 0.38, side * 0.85);
      group.add(wheel);
    }
  }
  return group;
}

function buildForklift(materials, random) {
  const group = new THREE.Group();
  block(group, 1.2, 0.5, 0.9, materials.forklift, 0, 0.2, 0);
  block(group, 0.4, 0.55, 0.9, materials.steelDark, -0.5, 0.45, 0);
  for (const z of [-0.3, 0.3]) block(group, 0.08, 1.6, 0.08, materials.steelDark, 0.7, 0.2, z);
  for (const z of [-0.25, 0.25]) block(group, 0.7, 0.05, 0.1, materials.steelDark, 1.05, 0.25, z);
  for (const x of [-0.4, 0.4]) {
    for (const side of [-1, 1]) group.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 10).rotateX(Math.PI / 2), materials.tire, x, 0.2, side * 0.45));
  }
  group.add(contactShadow(2.4, 1.5, 0.45));
  const cage = new THREE.Group();
  for (const [x, z] of [[-0.45, -0.38], [-0.45, 0.38], [0.3, -0.38], [0.3, 0.38]]) block(cage, 0.05, 0.9, 0.05, materials.steelDark, x, 0.7, z);
  block(cage, 0.85, 0.05, 0.85, materials.steelDark, -0.08, 1.6, 0);
  group.add(cage);
  const driver = buildWorker(materials, random);
  driver.group.position.set(-0.1, 0.2, 0);
  driver.leftLeg.rotation.z = 1.3;
  driver.rightLeg.rotation.z = 1.3;
  driver.leftArm.rotation.z = 1.1;
  driver.rightArm.rotation.z = 1.1;
  group.add(driver.group);
  const load = new THREE.Group();
  block(load, 0.8, 0.12, 0.8, materials.pallet, 0, 0, 0);
  for (let index = 0; index < 4; index += 1) block(load, 0.36, 0.2, 0.3, materials.ingot, (index % 2) * 0.38 - 0.19, 0.12 + Math.floor(index / 2) * 0.2, 0);
  load.position.set(1.1, 0.3, 0);
  group.add(load);
  return { group, load };
}

/**
 * The plant: buildings, machines, belts, stock, workers and traffic. It only reads simulation state,
 * so it can be rebuilt or redrawn at any time without affecting the game.
 */
export class Factory {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.materials = createMaterials();
    this.random = seeded(1234);
    this.time = 0;
    this.stations = {};
    this.beltItems = [];
    this.beltTextures = [];
    this.walkers = [];
    this.forklifts = [];
    this.spawnBudget = { mill: 0, hull: 0, turret: 0, engine: 0 };
    this.millBranch = 0;
    this.assemblyView = { modelId: null, object: null, turretBaseY: 0 };

    this.addFloor();
    this.addPerimeter();
    this.addPowerStation();
    this.addSteelMill();
    for (const id of SHOP_IDS) this.addShop(id);
    this.addAssemblyHall();
    this.addBelts();
    this.addStockpiles();
    this.addPowerLines();
    this.addYard();
    this.addRailway();
    this.addSurroundings();
    this.addWorkers();
  }

  addFloor() {
    const materials = this.materials;
    const floor = texturedBlock(this.scene, 70, FLOOR_Y, 40, materials.concrete, -33, 0, 0);
    floor.castShadow = false;
    const road = block(this.scene, 24, 0.01, 6.5, materials.asphalt, -3, FLOOR_Y, 0);
    road.castShadow = false;
    for (let x = -13; x < 9; x += 2.4) {
      const dash = block(this.scene, 1.2, 0.012, 0.16, materials.paintWhite, x, FLOOR_Y, 0);
      dash.castShadow = false;
    }
    for (const z of [8.2, 12.8]) {
      const line = block(this.scene, 60, 0.012, 0.22, materials.stripe, -36, FLOOR_Y, z);
      line.castShadow = false;
    }
    const crossing = new THREE.Mesh(worldUvBox(1.2, 0.014, 6.5), materials.hazard);
    crossing.position.set(-1.3, FLOOR_Y + 0.007, 0);
    this.scene.add(crossing);
  }

  addPerimeter() {
    const materials = this.materials;
    const postGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6);
    const posts = [];
    for (let x = -67; x <= -1; x += 3) posts.push([x, -20], [x, 20]);
    for (let z = -20; z <= 20; z += 3) {
      if (Math.abs(z - RAIL_Z) > 1.5) posts.push([-68, z]);
      if (Math.abs(z) > 5) posts.push([-1, z]);
    }
    const instanced = new THREE.InstancedMesh(postGeometry, materials.steelDark, posts.length);
    const matrix = new THREE.Matrix4();
    posts.forEach(([x, z], index) => {
      matrix.makeTranslation(x, 1.1, z);
      instanced.setMatrixAt(index, matrix);
    });
    instanced.castShadow = true;
    this.scene.add(instanced);
    for (const z of [-20, 20]) {
      for (const y of [1.0, 1.9]) block(this.scene, 67, 0.06, 0.05, materials.steelDark, -34.5, y, z);
    }
    for (const y of [1.0, 1.9]) {
      block(this.scene, 0.05, 0.06, RAIL_Z - 1.5 + 20, materials.steelDark, -68, y, (RAIL_Z - 1.5 - 20) / 2);
      block(this.scene, 0.05, 0.06, 20 - RAIL_Z - 1.5, materials.steelDark, -68, y, (RAIL_Z + 1.5 + 20) / 2);
    }
    for (const z of [-12.5, 12.5]) {
      for (const y of [1.0, 1.9]) block(this.scene, 0.05, 0.06, 15, materials.steelDark, -1, y, z);
    }
    for (let x = -68; x <= -1; x += 11) {
      for (const z of [-20, 20]) texturedBlock(this.scene, 0.8, 2.6, 0.8, materials.brick, x, 0, z);
    }

    const gate = new THREE.Group();
    for (const z of [-5.5, 5.5]) {
      texturedBlock(gate, 1.1, 5.2, 1.1, materials.brick, 0, 0, z);
      block(gate, 1.3, 0.3, 1.3, materials.brickDark, 0, 5.2, z);
      const lamp = mesh(SHARED.sphere, materials.lampBulb, 0, 5.85, z);
      lamp.scale.setScalar(0.25);
      gate.add(lamp);
    }
    texturedBlock(gate, 0.9, 1.1, 12, materials.brick, 0, 4.4, 0);
    block(gate, 0.95, 0.5, 6, materials.stripe, 0, 4.7, 0);
    const barrier = new THREE.Group();
    barrier.position.set(0.2, 1.1, -4.9);
    const arm = new THREE.Mesh(worldUvBox(0.18, 0.18, 9), materials.hazard);
    arm.position.z = 4.5;
    barrier.add(arm);
    gate.add(barrier);
    gate.position.x = -1;
    this.scene.add(gate);
    this.gateBarrier = barrier;

    const guardHut = new THREE.Group();
    texturedBlock(guardHut, 2, 2.4, 2, materials.brick, 0, 0, 0);
    block(guardHut, 2.4, 0.2, 2.4, materials.brickDark, 0, 2.4, 0);
    block(guardHut, 0.06, 0.7, 1.2, materials.window, 1.01, 1.2, 0);
    guardHut.position.set(-3.5, FLOOR_Y, -16);
    this.scene.add(guardHut);
  }

  registerStation(id, group, { animate, tiers = [] }) {
    const layout = STATION_LAYOUT[id];
    group.position.set(layout.x, FLOOR_Y, layout.z);
    group.traverse((child) => {
      child.userData.stationId = id;
    });
    this.scene.add(group);
    const ring = new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS[id] - 0.5, RING_RADIUS[id], 48), new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(layout.x, FLOOR_Y + 0.06, layout.z);
    ring.visible = false;
    this.scene.add(ring);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: STATUS_COLORS.idle, emissiveIntensity: 1.2 });
    const beacon = mesh(new THREE.SphereGeometry(0.28, 12, 8), beaconMaterial);
    beacon.position.copy(group.userData.beacon ?? new THREE.Vector3(0, 6, 0));
    group.add(beacon);
    for (const tier of tiers) for (const object of tier.objects) object.visible = false;
    this.stations[id] = {
      group,
      ring,
      beaconMaterial,
      animate,
      tiers,
      shownLevel: 0,
      anchor: new THREE.Vector3(layout.x, LABEL_HEIGHT[id], layout.z),
    };
  }

  /**
   * Dresses the outside of a back wall so the plant also reads from behind: brick piers, a concrete plinth,
   * lit windows, a painted name sign, downpipes and a service hatch. `outer` is the z of the outside face,
   * which faces -z. Window rows are { y, height } and skip the hatch.
   */
  decorateBack(group, { width, height, outer, title, accent, windowRows, hatch, piers = true }) {
    const materials = this.materials;
    const face = outer - 0.03;
    block(group, width + 0.1, 0.5, 0.14, materials.concreteDark, 0, 0, outer - 0.07);
    if (piers) {
      const pierCount = Math.max(2, Math.round(width / 2.4) + 1);
      for (let index = 0; index < pierCount; index += 1) {
        const x = -width / 2 + 0.2 + ((width - 0.4) * index) / (pierCount - 1);
        texturedBlock(group, 0.4, height - 0.1, 0.2, materials.brick, x, 0, outer - 0.1);
        block(group, 0.5, 0.18, 0.26, materials.brickDark, x, height - 0.1, outer - 0.12);
      }
    }
    block(group, width + 0.1, 0.22, 0.22, materials.brickDark, 0, height - 0.95, outer - 0.1);
    const hatchHalf = hatch ? hatch.width / 2 + 0.3 : -1;
    for (const row of windowRows) {
      for (let x = -width / 2 + 1.1; x <= width / 2 - 1.0; x += 1.6) {
        if (hatch && Math.abs(x - hatch.x) < hatchHalf && row.y < hatch.height + 0.2) continue;
        block(group, 0.95, row.height, 0.06, materials.window, x, row.y, face);
        block(group, 1.1, 0.1, 0.16, materials.concreteDark, x, row.y - 0.1, face - 0.05);
      }
    }
    const signWidth = Math.min(width * 0.62, 6.5);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signWidth * 0.18).rotateY(Math.PI), this.signMaterial(title, accent));
    sign.position.set(0, height - 0.45, outer - 0.215);
    group.add(sign);
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.1);
      column(group, 0.07, 0.07, height - 0.2, materials.steelDark, x, 0, outer - 0.12, 8);
      block(group, 0.3, 0.16, 0.3, materials.steelDark, x, height - 0.25, outer - 0.12);
    }
    if (!hatch) return;
    block(group, hatch.width, hatch.height, 0.06, materials.steelDark, hatch.x, 0, face);
    const frame = new THREE.Mesh(worldUvBox(hatch.width + 0.5, 0.3, 0.12), materials.hazard);
    frame.position.set(hatch.x, hatch.height + 0.15, outer - 0.08);
    group.add(frame);
    for (const side of [-1, 1]) block(group, 0.18, hatch.height, 0.14, materials.stripe, hatch.x + side * (hatch.width / 2 + 0.09), 0, outer - 0.08);
    block(group, 0.5, 0.08, 0.3, materials.steelDark, hatch.x, hatch.height + 0.55, outer - 0.2);
    const lamp = mesh(SHARED.sphere, materials.lampBulb, hatch.x, hatch.height + 0.5, outer - 0.3);
    lamp.scale.setScalar(0.1);
    group.add(lamp);
  }

  signMaterial(title, accent) {
    const texture = canvasTexture(512, 92, (context, width, height) => {
      context.fillStyle = `#${new THREE.Color(accent).multiplyScalar(0.7).getHexString()}`;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#e8e2cc";
      context.lineWidth = 6;
      context.strokeRect(6, 6, width - 12, height - 12);
      context.fillStyle = "#f1ead6";
      context.font = "bold 58px Impact, 'Arial Narrow', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(title.toUpperCase(), width / 2, height / 2 + 3, width - 40);
    });
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  }

  /** Brick hall cut away toward the camera: full back wall, side walls that slope down to the open front. */
  buildHall(group, { width, depth, height, accent, title }) {
    const materials = this.materials;
    const back = -depth / 2;
    texturedBlock(group, width + 0.8, 0.14, depth + 0.6, materials.concreteDark, 0, -0.06, 0).castShadow = false;
    texturedBlock(group, width, height, 0.35, materials.brick, 0, 0, back);
    const shape = new THREE.Shape([
      new THREE.Vector2(-depth / 2, 0),
      new THREE.Vector2(depth / 2, 0),
      new THREE.Vector2(depth / 2, height),
      new THREE.Vector2(depth / 2 - depth * 0.38, height),
      new THREE.Vector2(-depth / 2, height * 0.28),
    ]);
    const sideGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
    sideGeometry.rotateY(Math.PI / 2);
    sideGeometry.translate(-0.175, 0, 0);
    for (const side of [-1, 1]) {
      const wall = mesh(sideGeometry, materials.brick, side * (width / 2 - 0.175), 0, 0);
      group.add(wall);
    }
    for (let x = -width / 2 + 1.1; x <= width / 2 - 1.0; x += 1.6) {
      block(group, 1.0, 1.4, 0.06, materials.window, x, height * 0.45, back + 0.2);
    }
    block(group, width + 0.1, 0.4, 0.45, materials.brickDark, 0, height - 0.4, back);
    const roofDepth = depth * 0.38;
    const roof = new THREE.Mesh(worldUvBox(width + 0.4, 0.12, roofDepth), materials.roof);
    roof.position.set(0, height + 0.06, back + roofDepth / 2);
    roof.castShadow = true;
    group.add(roof);
    const skylight = block(group, width * 0.7, 0.9, 0.06, materials.glass, 0, height + 0.1, back + roofDepth);
    skylight.rotation.x = -0.5;
    skylight.castShadow = false;
    block(group, width + 0.5, 0.5, 0.14, paintMaterial(accent), 0, height - 0.3, back + roofDepth + 0.05);
    const slopeStart = back + roofDepth;
    for (const fraction of [0.3, 0.62, 0.94]) {
      const z = slopeStart + (depth - roofDepth) * fraction;
      const wallTop = height - (height - height * 0.28) * ((z - slopeStart) / (depth - roofDepth));
      block(group, width, 0.18, 0.18, materials.steelBeam, 0, wallTop - 0.18, z);
    }
    for (let x = -width / 2 + 1.8; x < width / 2 - 1; x += 3.4) {
      block(group, 0.04, 1.2, 0.04, materials.steelDark, x, height - 1.2, back + roofDepth + 1);
      const shade = mesh(new THREE.ConeGeometry(0.35, 0.3, 10, 1, true), materials.steelDark, x, height - 1.35, back + roofDepth + 1);
      group.add(shade);
      const bulb = mesh(SHARED.sphere, materials.lampBulb, x, height - 1.5, back + roofDepth + 1);
      bulb.scale.setScalar(0.12);
      group.add(bulb);
    }
    const hazard = new THREE.Mesh(worldUvBox(width, 0.02, 0.4), materials.hazard);
    hazard.position.set(0, 0.02, depth / 2 - 0.2);
    group.add(hazard);
    group.userData.beacon = new THREE.Vector3(width / 2 - 0.3, height + 0.45, back);
    block(group, 0.18, 0.3, 0.18, materials.steelDark, width / 2 - 0.3, height, back);
    this.decorateBack(group, {
      width,
      height,
      outer: back - 0.175,
      title,
      accent,
      windowRows: [{ y: height * 0.45, height: 1.4 }],
      hatch: { x: 0, width: 1.5, height: 1.5 },
    });
    for (const x of [-width / 4, width / 4]) {
      column(group, 0.28, 0.32, 0.5, materials.steelBeam, x, height + 0.12, back + 1.2, 10);
      group.add(mesh(new THREE.ConeGeometry(0.45, 0.35, 10), materials.steelDark, x, height + 0.8, back + 1.2));
    }
  }

  addShop(id) {
    const group = new THREE.Group();
    this.buildHall(group, { ...SHOP_SIZE, accent: ACCENTS[id], title: STATION_BY_ID[id].name });
    const builder = MACHINE_BUILDERS[id];
    const machinePaint = paintMaterial(new THREE.Color(ACCENTS[id]).lerp(new THREE.Color(0x4d6a6f), 0.45).getHex());
    const machines = [];
    const tiers = [];
    SHOP_BAY_LEVELS.forEach((level, bay) => {
      const machine = builder(this.materials, machinePaint);
      machine.group.scale.setScalar(bay === 0 ? 1.0 : 0.8);
      machine.group.add(contactShadow(3.6, 2.6, 0.55));
      machine.group.position.set(SHOP_BAY_X[bay], 0, bay === 0 ? -0.4 : -1.6);
      if (bay > 0) machine.group.rotation.y = Math.PI / 2;
      group.add(machine.group);
      const operator = buildWorker(this.materials, this.random);
      operator.group.position.set(SHOP_BAY_X[bay] + (bay === 0 ? 0.3 : 0), 0, bay === 0 ? 1.4 : -0.1);
      operator.group.rotation.y = Math.PI / 2;
      group.add(operator.group);
      machines.push({ machine, operator, phase: bay * 1.7 });
      if (bay > 0) tiers.push({ level, objects: [machine.group, operator.group] });
    });
    const sparkPoint = new THREE.Vector3();
    this.registerStation(id, group, {
      tiers,
      animate: (dt, activity) => {
        for (const { machine, operator, phase } of machines) {
          if (!machine.group.visible) continue;
          const sparked = machine.animate(activity, this.time, phase);
          operator.rightArm.rotation.x = -0.6 - (activity > 0 ? Math.abs(Math.sin(this.time * 5 + phase)) * 0.7 : 0);
          operator.leftArm.rotation.x = 0.3;
          if (sparked) {
            machine.group.updateMatrixWorld();
            sparkPoint.copy(machine.sparkOffset).applyMatrix4(machine.group.matrixWorld);
            this.effects.spark(sparkPoint, id === "hull" ? 0xffe08a : 0xffc46a);
          }
          if (machine.exhaustOffset && activity > 0 && Math.random() < dt * 1.5) {
            machine.group.updateMatrixWorld();
            sparkPoint.copy(machine.exhaustOffset).applyMatrix4(machine.group.matrixWorld);
            this.effects.puff(sparkPoint, { color: 0x555250, size: 0.25, grow: 2.5, life: 1.6, rise: 1.5, drift: 0.6, opacity: 0.5 });
          }
        }
      },
    });
  }

  buildFurnace(group, x, z, scale) {
    const materials = this.materials;
    const furnace = new THREE.Group();
    furnace.position.set(x, 0, z);
    furnace.scale.setScalar(scale);
    column(furnace, 1.5, 2.1, 7.5, materials.rust, 0, 0, 0, 16);
    for (const y of [1.5, 3.5, 5.5]) column(furnace, 2.12 - y * 0.08, 2.14 - y * 0.08, 0.25, materials.rustDark, 0, y, 0, 16);
    const glowRing = column(furnace, 1.55, 1.55, 0.5, materials.glow, 0, 7.5, 0, 16);
    column(furnace, 0.6, 0.8, 1.4, materials.rustDark, 0, 8, 0, 10);
    column(furnace, 0.35, 0.4, 3.2, materials.rustDark, 0, 9.4, 0, 8);
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
      block(furnace, 0.3, 7, 0.3, materials.steelBeam, Math.cos(angle) * 2.5, 0, Math.sin(angle) * 2.5);
    }
    const tap = block(furnace, 1.2, 0.18, 0.5, materials.molten, 2.3, 0.4, 0);
    furnace.add(contactShadow(6.5, 6.5, 0.5));
    group.add(furnace);
    return { glowRing, tap, chimneyTop: new THREE.Vector3(x, 12.6 * scale, z) };
  }

  addSteelMill() {
    const materials = this.materials;
    const group = new THREE.Group();
    texturedBlock(group, 15, 0.14, 13, materials.concreteDark, 0, -0.06, -1).castShadow = false;
    const furnaces = [
      this.buildFurnace(group, 0, -2.5, 1),
      this.buildFurnace(group, -4.6, 0.5, 0.8),
      this.buildFurnace(group, -4.4, -5.2, 0.75),
    ];
    for (const z of [-6.2, -4.2]) {
      column(group, 0.85, 0.85, 7.2, materials.brickDark, 4, 0, z, 14);
      const dome = mesh(new THREE.SphereGeometry(0.85, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.brickDark, 4, 7.2, z);
      group.add(dome);
    }
    const incline = block(group, 0.5, 0.35, 7.5, materials.steelBeam, 0, 0, 0);
    incline.position.set(0, 4.1, 2.2);
    incline.rotation.x = -0.95;
    const skip = block(group, 0.8, 0.6, 0.9, materials.steelDark, 0, 0, 0);
    const castHouse = new THREE.Group();
    texturedBlock(castHouse, 5, 2.2, 2.6, materials.brick, 0, 0, 0);
    block(castHouse, 5.4, 0.25, 3, materials.roof, 0, 2.2, 0);
    block(castHouse, 2.4, 0.9, 0.06, materials.glow, 0, 0.3, 1.31);
    castHouse.position.set(1.8, 0, 2.2);
    group.add(castHouse);
    const ladle = new THREE.Group();
    ladle.add(mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.75, 12), materials.steelDark, 0, 0.4, 0));
    const melt = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 12), materials.molten, 0, 0.77, 0);
    ladle.add(melt);
    group.add(ladle);
    const molds = [];
    for (let index = 0; index < 5; index += 1) {
      block(group, 0.8, 0.35, 0.5, materials.steelDark, 5.2, 0, 3.6 - index * 0.6);
      molds.push(block(group, 0.62, 0.06, 0.34, materials.molten, 5.2, 0.35, 3.6 - index * 0.6));
    }
    const ore = mesh(new THREE.ConeGeometry(2.0, 1.9, 9), materials.ore, -5, 0.95, 3.4);
    group.add(ore);
    group.userData.beacon = new THREE.Vector3(1.8, 3.0, 2.2);

    const light = new THREE.PointLight(0xff8a3a, 30, 16, 2);
    light.position.set(STATION_LAYOUT.mill.x + 1.8, 2.2, STATION_LAYOUT.mill.z + 4.5);
    this.scene.add(light);

    const origin = new THREE.Vector3(STATION_LAYOUT.mill.x, FLOOR_Y, STATION_LAYOUT.mill.z);
    const smokePoint = new THREE.Vector3();
    this.registerStation("mill", group, {
      tiers: FURNACE_LEVELS.slice(1).map((level, index) => ({ level, objects: [furnaces[index + 1].glowRing.parent] })),
      animate: (dt, activity) => {
        const pulse = 0.7 + Math.sin(this.time * 6) * 0.3 * activity;
        for (const furnace of furnaces) {
          if (!furnace.glowRing.parent.visible) continue;
          furnace.glowRing.scale.set(1, 0.6 + pulse * 0.6, 1);
          furnace.tap.visible = activity > 0;
          furnace.smoke = (furnace.smoke ?? Math.random()) - dt * activity;
          if (furnace.smoke <= 0) {
            furnace.smoke = 0.8 + Math.random() * 0.4;
            smokePoint.copy(furnace.chimneyTop).add(origin);
            this.effects.puff(smokePoint, { color: 0x7e7a74, size: 0.8, grow: 2.2, life: 4, rise: 2.6, drift: 1.2 });
          }
        }
        const skipT = (Math.sin(this.time * 0.8) + 1) / 2;
        skip.position.set(0, 1.0 + skipT * 6.0, 4.6 - skipT * 4.4);
        const ladleT = (Math.sin(this.time * 0.9) + 1) / 2;
        ladle.position.set(1.5 + ladleT * 3.0, 0, 4.4 - ladleT * 0.4);
        ladle.rotation.z = ladleT > 0.92 ? -(ladleT - 0.92) * 8 : 0;
        melt.visible = activity > 0;
        molds.forEach((mold, index) => {
          mold.material = (Math.floor(this.time * 1.2) + index) % 5 < 3 && activity > 0 ? materials.molten : materials.steelDark;
        });
        light.intensity = activity > 0 ? 24 + Math.random() * 14 : 4;
      },
    });
  }

  buildCoolingTower(group, x, z) {
    const points = [];
    for (let index = 0; index <= 10; index += 1) {
      const t = index / 10;
      points.push(new THREE.Vector2(1.6 + 0.9 * (2 * t - 1) ** 2 - 0.15 * t, t * 6.5));
    }
    const tower = mesh(new THREE.LatheGeometry(points, 20), new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.95, side: THREE.DoubleSide, flatShading: true }), x, 0, z);
    tower.add(contactShadow(6, 6, 0.45));
    group.add(tower);
    return { tower, top: new THREE.Vector3(x, 6.8, z) };
  }

  addPowerStation() {
    const materials = this.materials;
    const group = new THREE.Group();
    texturedBlock(group, 10, 5.5, 5.5, materials.brick, 0, 0, 0);
    block(group, 10.4, 0.45, 5.9, materials.brickDark, 0, 5.5, 0);
    texturedBlock(group, 4, 3.4, 3.2, materials.brick, -6.5, 0, 0.6);
    block(group, 4.3, 0.3, 3.5, materials.roof, -6.5, 3.4, 0.6);
    for (let x = -3.8; x <= 3.8; x += 1.9) block(group, 1.0, 2.2, 0.06, materials.window, x, 1.8, 2.78);
    this.decorateBack(group, {
      width: 10,
      height: 5.5,
      outer: -2.75,
      title: STATION_BY_ID.power.name,
      accent: 0x8e4b35,
      windowRows: [{ y: 1.6, height: 2.2 }],
      hatch: null,
    });
    texturedBlock(group, 2.6, 3.2, 1.6, materials.brick, 2.6, 0, -3.5);
    block(group, 2.8, 0.25, 1.8, materials.roof, 2.6, 3.2, -3.5);
    block(group, 1.4, 2.0, 0.06, materials.steelDark, 2.6, 0, -4.31);
    for (const [x, y] of [[-4.2, 3.6], [-1.2, 3.6]]) {
      const pipe = mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 10).rotateX(Math.PI / 2), materials.steelBeam, x, y, -3.9);
      group.add(pipe);
      column(group, 0.22, 0.22, y, materials.steelBeam, x, 0, -5.05, 10);
    }
    const stackPositions = [[-2.6, -0.8], [0.4, -0.8], [3.4, -0.8]];
    const stacks = stackPositions.map(([x, z]) => {
      const stack = new THREE.Group();
      texturedBlock(stack, 1.3, 10, 1.3, materials.brick, 0, 5.5, 0);
      block(stack, 1.5, 0.35, 1.5, materials.brickDark, 0, 15.2, 0);
      stack.position.set(x, 0, z);
      group.add(stack);
      return { stack, top: new THREE.Vector3(x, 16, z) };
    });
    const coal = mesh(new THREE.ConeGeometry(2.3, 1.8, 9), materials.coal, -7.5, 0.9, 3.6);
    group.add(coal);
    const yard = new THREE.Group();
    yard.position.set(7.8, 0, 1);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      block(yard, 0.9, 1.2, 0.9, materials.machine, x, 0, z);
      for (const offset of [-0.25, 0.25]) column(yard, 0.07, 0.12, 0.7, materials.insulator, x + offset, 1.2, z, 8);
    }
    group.add(yard);
    const towers = [this.buildCoolingTower(group, 8.5, -2.5), this.buildCoolingTower(group, -10.5, -2.5)];
    group.userData.beacon = new THREE.Vector3(4.6, 6.3, 2.6);
    const origin = new THREE.Vector3(STATION_LAYOUT.power.x, FLOOR_Y, STATION_LAYOUT.power.z);
    const point = new THREE.Vector3();
    this.registerStation("power", group, {
      tiers: [
        { level: COOLING_TOWER_LEVELS[0], objects: [towers[0].tower] },
        { level: COOLING_TOWER_LEVELS[1], objects: [towers[1].tower] },
      ],
      animate: (dt, activity, state) => {
        const strain = Math.min(2, state.stations.power.level / 4);
        for (const entry of stacks) {
          entry.timer = (entry.timer ?? Math.random()) - dt * (0.5 + strain * 0.6);
          if (entry.timer > 0) continue;
          entry.timer = 1;
          point.copy(entry.top).add(origin);
          this.effects.puff(point, { color: 0x5e5b58, size: 1.0, grow: 2.4, life: 4.5, rise: 2.4, drift: 1.4 });
        }
        for (const entry of towers) {
          if (!entry.tower.visible) continue;
          entry.timer = (entry.timer ?? Math.random()) - dt * 1.4;
          if (entry.timer > 0) continue;
          entry.timer = 1;
          point.copy(entry.top).add(origin);
          this.effects.puff(point, { color: 0xf2f0ea, size: 1.4, grow: 1.8, life: 3.5, rise: 2.2, drift: 1, opacity: 0.6 });
        }
      },
    });
  }

  addAssemblyHall() {
    const materials = this.materials;
    const { width, depth, height } = ASSEMBLY_SIZE;
    const group = new THREE.Group();
    const back = -depth / 2;
    texturedBlock(group, width + 0.8, 0.14, depth + 0.6, materials.concreteDark, 0, -0.06, 0).castShadow = false;
    texturedBlock(group, width, height, 0.4, materials.brick, 0, 0, back);
    this.decorateBack(group, {
      width,
      height,
      outer: back - 0.2,
      title: STATION_BY_ID.assembly.name,
      accent: ACCENTS.assembly,
      windowRows: [{ y: height * 0.2, height: 1.0 }, { y: height * 0.5, height: 1.6 }],
      hatch: { x: 2.5, width: 3.6, height: 3.4 },
    });
    for (let x = -width / 2 + 1.2; x <= width / 2 - 1.0; x += 1.7) {
      block(group, 1.1, 1.6, 0.06, materials.window, x, height * 0.5, back + 0.22);
      block(group, 1.1, 1.0, 0.06, materials.window, x, height * 0.2, back + 0.22);
    }
    block(group, width + 0.1, 0.45, 0.5, paintMaterial(ACCENTS.assembly), 0, height - 0.45, back);
    const westShape = new THREE.Shape([
      new THREE.Vector2(-depth / 2, 0),
      new THREE.Vector2(depth / 2, 0),
      new THREE.Vector2(depth / 2, height),
      new THREE.Vector2(depth / 2 - depth * 0.35, height),
      new THREE.Vector2(-depth / 2, height * 0.3),
    ]);
    const westGeometry = new THREE.ExtrudeGeometry(westShape, { depth: 0.4, bevelEnabled: false });
    westGeometry.rotateY(Math.PI / 2);
    group.add(mesh(westGeometry, materials.brick, -width / 2, 0, 0));
    for (const [z0, z1] of [[back, -2.8], [2.8, depth / 2]]) {
      const length = z1 - z0;
      texturedBlock(group, 0.4, height * (z0 < 0 ? 0.85 : 0.3), length, materials.brick, width / 2 - 0.2, 0, (z0 + z1) / 2);
    }
    texturedBlock(group, 0.45, 1.4, 5.6, materials.brick, width / 2 - 0.2, height * 0.85 - 1.4, 0);
    const door = new THREE.Mesh(worldUvBox(0.5, 0.25, 5.6), materials.hazard);
    door.position.set(width / 2 - 0.2, height * 0.85 - 1.5, 0);
    group.add(door);
    for (const x of [-width / 2 + 0.3, width / 2 - 0.3]) block(group, 0.45, height, 0.45, materials.steelBeam, x, 0, depth / 2 - 0.3);
    for (const z of [-depth / 2 + 0.8, depth / 2 - 0.8]) block(group, width, 0.45, 0.45, materials.steelBeam, 0, height - 1.4, z);
    const roofDepth = depth * 0.35;
    const roof = new THREE.Mesh(worldUvBox(width + 0.4, 0.14, roofDepth), materials.roof);
    roof.position.set(0, height + 0.07, back + roofDepth / 2);
    roof.castShadow = true;
    group.add(roof);

    const platform = block(group, 7.4, ASSEMBLY_PLATFORM_HEIGHT, 4.8, materials.concreteDark, 0.5, 0, 0);
    platform.castShadow = false;
    for (const z of [-2.5, 2.5]) {
      const edge = new THREE.Mesh(worldUvBox(7.4, 0.02, 0.3), materials.hazard);
      edge.position.set(0.5, ASSEMBLY_PLATFORM_HEIGHT + 0.01, z);
      group.add(edge);
    }
    for (const x of [-3, 4]) {
      block(group, 0.2, 2.6, 0.2, materials.stripe, x, 0, -3.1);
      block(group, 0.2, 2.6, 0.2, materials.stripe, x, 0, 3.1);
    }

    const buildCrane = () => {
      const crane = new THREE.Group();
      block(crane, 0.55, 0.55, depth - 1.6, materials.stripe, 0, 0, 0);
      const trolley = block(crane, 1.0, 0.55, 1.0, materials.machine, 0, -0.55, 0);
      const cable = block(crane, 0.05, 2.2, 0.05, materials.steelDark, 0, -2.75, 0);
      const hook = block(crane, 0.35, 0.25, 0.35, materials.steelDark, 0, -3.0, 0);
      crane.position.set(0, height - 1.4 + 0.45, 0);
      group.add(crane);
      return { crane, trolley, cable, hook };
    };
    const cranes = [buildCrane(), buildCrane()];

    const welders = WELDER_LEVELS.map((_, index) => {
      const worker = buildWorker(materials, this.random);
      const side = index % 2 === 0 ? 1 : -1;
      worker.group.position.set(-2.2 + Math.floor(index / 2) * 3.6, ASSEMBLY_PLATFORM_HEIGHT, side * 2.0);
      worker.group.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(worker.group);
      return worker;
    });

    const parts = new THREE.Group();
    parts.position.set(-2.2, 0, 5.2);
    for (const [index, material] of [materials.hullPart, materials.turretPart, materials.enginePart].entries()) {
      block(parts, 1.6, 0.08, 0.9, materials.pallet, index * 1.7 - 1.7, 0, 0);
      block(parts, 1.2, 0.45, 0.7, material, index * 1.7 - 1.7, 0.08, 0);
    }
    group.add(parts);
    group.userData.beacon = new THREE.Vector3(width / 2 - 0.3, height + 0.5, back);

    const light = new THREE.PointLight(0x9fd8ff, 0, 12, 2);
    light.position.set(STATION_LAYOUT.assembly.x, 2.4, STATION_LAYOUT.assembly.z);
    this.scene.add(light);

    const origin = new THREE.Vector3(STATION_LAYOUT.assembly.x, FLOOR_Y, STATION_LAYOUT.assembly.z);
    const sparkPoint = new THREE.Vector3();
    this.registerStation("assembly", group, {
      tiers: [
        { level: EXTRA_CRANE_LEVEL, objects: [cranes[1].crane] },
        ...WELDER_LEVELS.slice(1).map((level, index) => ({ level, objects: [welders[index + 1].group] })),
      ],
      animate: (dt, activity) => {
        cranes.forEach((entry, index) => {
          const sway = Math.sin(this.time * 0.5 + index * 2.1);
          entry.crane.position.x = (index === 0 ? -1 : 2.5) + sway * 2.2 * (activity > 0 ? 1 : 0.15);
          entry.trolley.position.z = Math.sin(this.time * 0.7 + index) * 2.5 * (activity > 0 ? 1 : 0.1);
          entry.cable.position.z = entry.trolley.position.z;
          entry.hook.position.z = entry.trolley.position.z;
        });
        let welding = false;
        for (const welder of welders) {
          if (!welder.group.visible) continue;
          welder.rightArm.rotation.x = -1.2 + Math.sin(this.time * 3 + welder.group.position.x) * 0.15;
          if (activity > 0 && Math.random() < dt * 3) {
            welding = true;
            sparkPoint.set(welder.group.position.x, 1.1, welder.group.position.z * 0.6).add(origin);
            for (let index = 0; index < 3; index += 1) this.effects.spark(sparkPoint, 0x9fd8ff);
          }
        }
        light.intensity = welding ? 18 + Math.random() * 14 : Math.max(0, light.intensity - dt * 80);
      },
    });
  }

  addBelts() {
    const materials = this.materials;
    const trunkZ = -14;
    const partsZ = 3;
    const millOut = { x: -51, z: -3.5 };
    const shopBack = -6 - SHOP_SIZE.depth / 2 - 0.2;
    const shopFront = -6 + SHOP_SIZE.depth / 2 + 0.2;
    const assemblyWest = STATION_LAYOUT.assembly.x - ASSEMBLY_SIZE.width / 2 - 0.1;
    this.millPaths = SHOP_IDS.map((id) => {
      const x = STATION_LAYOUT[id].x;
      return [beltPoint(-55, millOut.z), beltPoint(millOut.x, millOut.z), beltPoint(millOut.x, trunkZ), beltPoint(x, trunkZ), beltPoint(x, shopBack)];
    });
    this.shopPaths = {};
    for (const id of SHOP_IDS) {
      const x = STATION_LAYOUT[id].x + 1.6;
      this.shopPaths[id] = [beltPoint(x, shopFront), beltPoint(x, partsZ), beltPoint(assemblyWest, partsZ)];
    }
    const furthestShop = Math.min(...SHOP_IDS.map((id) => STATION_LAYOUT[id].x));
    const nearestShop = Math.max(...SHOP_IDS.map((id) => STATION_LAYOUT[id].x));
    const segments = [
      [beltPoint(-55, millOut.z), beltPoint(millOut.x, millOut.z)],
      [beltPoint(millOut.x, millOut.z), beltPoint(millOut.x, trunkZ)],
      [beltPoint(millOut.x, trunkZ), beltPoint(nearestShop, trunkZ)],
      ...SHOP_IDS.map((id) => [beltPoint(STATION_LAYOUT[id].x, trunkZ), beltPoint(STATION_LAYOUT[id].x, shopBack)]),
      ...SHOP_IDS.map((id) => [beltPoint(STATION_LAYOUT[id].x + 1.6, shopFront), beltPoint(STATION_LAYOUT[id].x + 1.6, partsZ)]),
      [beltPoint(furthestShop + 1.6, partsZ), beltPoint(assemblyWest, partsZ)],
    ];
    const baseTexture = beltTexture();
    for (const [from, to] of segments) {
      const length = from.distanceTo(to) + 1.2;
      const texture = baseTexture.clone();
      texture.repeat.set(length / BELT_TILE, 1);
      texture.needsUpdate = true;
      this.beltTextures.push(texture);
      const surface = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
      const group = new THREE.Group();
      group.add(mesh(new THREE.BoxGeometry(length, 0.1, 1.0), [materials.beltFrame, materials.beltFrame, surface, materials.beltFrame, materials.beltFrame, materials.beltFrame], 0, BELT_HEIGHT - FLOOR_Y - 0.08, 0));
      block(group, length, 0.22, 1.2, materials.beltFrame, 0, BELT_HEIGHT - FLOOR_Y - 0.36, 0);
      for (const side of [-0.62, 0.62]) block(group, length, 0.12, 0.06, materials.stripe, 0, BELT_HEIGHT - FLOOR_Y - 0.08, side);
      for (let leg = -length / 2 + 0.5; leg < length / 2; leg += 2.2) {
        for (const side of [-0.5, 0.5]) block(group, 0.1, BELT_HEIGHT - FLOOR_Y - 0.3, 0.1, materials.steelDark, leg, 0, side);
      }
      group.position.set((from.x + to.x) / 2, FLOOR_Y, (from.z + to.z) / 2);
      group.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
      this.scene.add(group);
    }
    this.itemGeometry = {
      steel: new THREE.BoxGeometry(0.7, 0.28, 0.38),
      hull: new THREE.BoxGeometry(0.95, 0.38, 0.72),
      turret: new THREE.CylinderGeometry(0.33, 0.4, 0.34, 8),
      engine: new THREE.BoxGeometry(0.58, 0.52, 0.52),
    };
    this.itemMaterial = { steel: materials.ingot, hull: materials.hullPart, turret: materials.turretPart, engine: materials.enginePart };
  }

  addStockpiles() {
    const materials = this.materials;
    const pile = (resource, origin, columns, rows) => {
      for (let row = 0; row < rows; row += 1) {
        for (let columnIndex = 0; columnIndex < columns; columnIndex += 2) {
          const pallet = block(this.scene, 1.9, 0.12, 0.85, materials.pallet, origin.x + columnIndex * 0.95 + 0.45, FLOOR_Y, origin.z + row * 0.95);
          pallet.castShadow = false;
        }
      }
      const instanced = new THREE.InstancedMesh(this.itemGeometry[resource], this.itemMaterial[resource], STOCK_PILE_SLOTS);
      instanced.castShadow = true;
      instanced.count = 0;
      const matrix = new THREE.Matrix4();
      const perLayer = columns * rows;
      for (let index = 0; index < STOCK_PILE_SLOTS; index += 1) {
        const layer = Math.floor(index / perLayer);
        const inLayer = index % perLayer;
        matrix.makeTranslation(origin.x + (inLayer % columns) * 0.95, FLOOR_Y + 0.32 + layer * 0.45, origin.z + Math.floor(inLayer / columns) * 0.95);
        instanced.setMatrixAt(index, matrix);
      }
      this.scene.add(instanced);
      return instanced;
    };
    this.stockpiles = {
      steel: pile("steel", { x: -62.5, z: 3.2 }, 4, 2),
      hull: pile("hull", { x: STATION_LAYOUT.hull.x - 3, z: 5.2 }, 4, 2),
      turret: pile("turret", { x: STATION_LAYOUT.turret.x - 3, z: 5.2 }, 4, 2),
      engine: pile("engine", { x: STATION_LAYOUT.engine.x - 3, z: 5.2 }, 4, 2),
    };
  }

  addPowerLines() {
    const materials = this.materials;
    const top = 8;
    const power = STATION_LAYOUT.power;
    const hub = new THREE.Vector3(power.x - 4, top, power.z + 4.2);
    const poles = [
      hub,
      new THREE.Vector3(-26, top, -11.5),
      new THREE.Vector3(-34, top, -11.5),
      new THREE.Vector3(-42, top, -11.5),
      new THREE.Vector3(-51, top, -11.5),
    ];
    const points = [];
    for (let index = 1; index < poles.length; index += 1) {
      for (const offset of [-0.55, 0.55]) {
        points.push(poles[index - 1].clone().setZ(poles[index - 1].z + offset), poles[index].clone().setZ(poles[index].z + offset));
      }
    }
    for (const pole of poles) {
      column(this.scene, 0.12, 0.16, top, materials.wood, pole.x, FLOOR_Y, pole.z, 6);
      block(this.scene, 0.12, 0.12, 1.5, materials.wood, pole.x, FLOOR_Y + top - 0.3, pole.z);
      for (const offset of [-0.55, 0.55]) column(this.scene, 0.05, 0.07, 0.25, materials.insulator, pole.x, FLOOR_Y + top - 0.18, pole.z + offset, 6);
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points.map((point) => point.clone().setY(point.y + FLOOR_Y))), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.scene.add(wires);
  }

  addYard() {
    const materials = this.materials;
    [[-23, 16.2, 0.08], [-19.2, 16.6, -0.12]].forEach(([x, z, angle]) => {
      const truck = buildTruck(materials);
      truck.scale.setScalar(0.7);
      truck.position.set(x, FLOOR_Y, z);
      truck.rotation.y = Math.PI / 2 + angle;
      this.scene.add(truck);
    });
    const tower = new THREE.Group();
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(tower, 0.2, 7, 0.2, materials.steelDark, x, 0, z);
    column(tower, 1.7, 1.7, 2.4, materials.rust, 0, 7, 0, 14);
    tower.add(mesh(new THREE.ConeGeometry(1.8, 0.9, 14), materials.rustDark, 0, 9.85, 0));
    tower.position.set(-65, FLOOR_Y, -16.5);
    this.scene.add(tower);
    const office = new THREE.Group();
    texturedBlock(office, 9, 2.6, 3, materials.brick, 0, 0, 0);
    block(office, 9.4, 0.25, 3.4, materials.brickDark, 0, 2.6, 0);
    for (let x = -3.6; x <= 3.6; x += 1.8) {
      for (const z of [-1.52, 1.52]) block(office, 0.9, 0.9, 0.06, materials.window, x, 1.1, z);
    }
    block(office, 1.1, 1.9, 0.08, materials.steelDark, -0.0, 0, 1.55);
    block(office, 0.08, 4.5, 0.08, materials.steelDark, 4.2, 2.85, 1.1);
    const flag = block(office, 1.4, 0.8, 0.04, paintMaterial(0xb03a2a), 4.95, 6.4, 1.1);
    office.position.set(-11, FLOOR_Y, 16.8);
    this.scene.add(office);
    this.flag = flag;
    for (let index = 0; index < 6; index += 1) {
      const drum = column(this.scene, 0.3, 0.3, 0.85, paintMaterial(index % 2 ? 0x3e5a3a : 0x8a2f22), -27.5 + (index % 3) * 0.65, FLOOR_Y, 15.2 + Math.floor(index / 3) * 0.65, 10);
      drum.castShadow = true;
    }
  }

  addRailway() {
    const materials = this.materials;
    const length = RAIL_END_X - RAIL_START_X;
    const sleepers = new THREE.InstancedMesh(SHARED.box, materials.wood, Math.floor(length / 0.7));
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Matrix4().makeScale(0.28, 0.12, 2.0);
    for (let index = 0; index < sleepers.count; index += 1) {
      const x = RAIL_START_X + index * 0.7;
      matrix.makeTranslation(x, FLOOR_Y + 0.06, RAIL_Z).multiply(scale);
      sleepers.setMatrixAt(index, matrix);
    }
    sleepers.receiveShadow = true;
    this.scene.add(sleepers);
    const ballast = block(this.scene, -68 - RAIL_START_X, FLOOR_Y, 3, materials.ballast, (RAIL_START_X - 68) / 2, 0, RAIL_Z);
    ballast.castShadow = false;
    for (const side of [-0.55, 0.55]) {
      block(this.scene, length, 0.12, 0.09, materials.steelBeam, (RAIL_START_X + RAIL_END_X) / 2, FLOOR_Y + 0.1, RAIL_Z + side);
    }
    const bumper = new THREE.Group();
    block(bumper, 0.6, 0.9, 2.0, materials.steelDark, 0, 0, 0);
    block(bumper, 0.25, 0.3, 1.8, materials.hazard, 0.35, 0.55, 0);
    bumper.position.set(RAIL_END_X + 0.3, FLOOR_Y, RAIL_Z);
    this.scene.add(bumper);
    const hopper = new THREE.Group();
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) block(hopper, 0.25, 4.2, 0.25, materials.steelDark, x, 0, z);
    block(hopper, 3.6, 0.3, 3.6, materials.steelBeam, 0, 4.2, 0);
    const bin = mesh(new THREE.CylinderGeometry(1.7, 0.5, 1.6, 4, 1, true).rotateY(Math.PI / 4), materials.rust, 0, 3.4, 0);
    hopper.add(bin);
    block(hopper, 0.8, 0.6, 0.8, materials.steelDark, 0, 2.2, 0);
    hopper.position.set(RAIL_END_X - 10, FLOOR_Y, RAIL_Z);
    this.scene.add(hopper);

    const train = new THREE.Group();
    const wheels = [];
    const addWheels = (x0, count) => {
      for (let index = 0; index < count; index += 1) {
        for (const side of [-0.6, 0.6]) {
          const wheel = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 12).rotateX(Math.PI / 2), materials.steelDark, x0 + index * 1.0, 0.45, side);
          train.add(wheel);
          wheels.push(wheel);
        }
      }
    };
    const loco = new THREE.Group();
    loco.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.2, 14).rotateZ(Math.PI / 2), materials.steelDark, 0.4, 1.55, 0));
    block(loco, 1.6, 1.9, 1.9, materials.steelDark, -2.3, 0.75, 0);
    block(loco, 1.9, 0.18, 2.1, materials.rustDark, -2.3, 2.65, 0);
    block(loco, 6, 0.3, 1.9, materials.steelBeam, -0.4, 0.55, 0);
    column(loco, 0.22, 0.3, 0.8, materials.steelDark, 2.0, 2.2, 0, 10);
    column(loco, 0.25, 0.25, 0.35, materials.steelDark, 0.6, 2.2, 0, 10);
    block(loco, 0.06, 0.5, 1.0, materials.window, -1.48, 1.6, 0);
    block(loco, 0.15, 0.6, 1.9, paintMaterial(0xb03a2a), 2.65, 0.55, 0);
    const locoShadow = contactShadow(7, 2.8, 0.5);
    locoShadow.position.set(-0.4, -0.08, 0);
    loco.add(locoShadow);
    train.add(loco);
    addWheels(-1.8, 4);
    const loads = [];
    for (let car = 0; car < 3; car += 1) {
      const wagon = new THREE.Group();
      const x = -6 - car * 4.6;
      wagon.position.x = x;
      block(wagon, 4, 0.25, 1.8, materials.steelBeam, 0, 0.55, 0);
      texturedBlock(wagon, 4, 1.2, 0.1, materials.rust, 0, 0.8, 0.85);
      texturedBlock(wagon, 4, 1.2, 0.1, materials.rust, 0, 0.8, -0.85);
      block(wagon, 0.1, 1.2, 1.8, materials.rust, 2, 0.8, 0);
      block(wagon, 0.1, 1.2, 1.8, materials.rust, -2, 0.8, 0);
      const heap = mesh(new THREE.ConeGeometry(1.1, 0.8, 8), car === 1 ? materials.coal : materials.ore, 0, 2.0, 0);
      heap.scale.set(1.7, 1, 0.75);
      wagon.add(heap);
      loads.push(heap);
      const wagonShadow = contactShadow(4.8, 2.6, 0.45);
      wagonShadow.position.y = -0.08;
      wagon.add(wagonShadow);
      train.add(wagon);
      addWheels(x - 1.5, 2);
      addWheels(x + 0.6, 2);
    }
    train.position.set(RAIL_START_X, FLOOR_Y + 0.15, RAIL_Z);
    this.scene.add(train);
    this.train = { group: train, wheels, loads, chimney: new THREE.Vector3(2.0, 3.2, 0), smokeTimer: 0 };
  }

  updateTrain(dt) {
    const train = this.train;
    const { arrive, unload, depart, away } = TRAIN_SCHEDULE;
    const cycle = arrive + unload + depart + away;
    const t = this.time % cycle;
    const stopX = RAIL_END_X - 3.2;
    const ease = (value) => value * value * (3 - 2 * value);
    let x = RAIL_START_X;
    let loaded = 1;
    if (t < arrive) x = RAIL_START_X + (stopX - RAIL_START_X) * (1 - (1 - t / arrive) ** 2);
    else if (t < arrive + unload) {
      x = stopX;
      loaded = 1 - ease((t - arrive) / unload);
    } else if (t < arrive + unload + depart) {
      x = stopX - (stopX - RAIL_START_X) * ((t - arrive - unload) / depart) ** 2;
      loaded = 0;
    }
    const moved = x - train.group.position.x;
    train.group.position.x = x;
    train.group.visible = x > RAIL_START_X + 1;
    for (const wheel of train.wheels) wheel.rotation.z -= moved / 0.38;
    for (const load of train.loads) load.scale.y = Math.max(0.05, loaded);
    train.smokeTimer -= dt * (Math.abs(moved) > 0.001 ? 3 : 0.6);
    if (train.group.visible && train.smokeTimer <= 0) {
      train.smokeTimer = 1;
      this.effects.puff(train.chimney.clone().add(train.group.position), { color: 0x5a5753, size: 0.6, grow: 2.4, life: 3, rise: 2, drift: 1.2 });
    }
  }

  /** Tree belts around the plant so the grass outside the fence reads as countryside rather than an empty plane. */
  addSurroundings() {
    const random = seeded(77);
    const trunk = paintMaterial(0x5b4430);
    const crowns = [paintMaterial(0x4f6e31), paintMaterial(0x3f5c2a), paintMaterial(0x5d7a36)];
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6);
    const roundCrown = new THREE.IcosahedronGeometry(1.5, 0);
    const pointedCrown = new THREE.ConeGeometry(1.4, 3.6, 7);
    const plant = (x, z) => {
      const tree = new THREE.Group();
      tree.add(mesh(trunkGeometry, trunk, 0, 0.8, 0));
      const round = random() > 0.45;
      const crown = mesh(round ? roundCrown : pointedCrown, crowns[Math.floor(random() * crowns.length)], 0, round ? 2.6 : 3.2, 0);
      if (round) crown.scale.set(1, 0.9 + random() * 0.3, 1);
      tree.add(crown);
      tree.position.set(x, 0, z);
      tree.rotation.y = random() * Math.PI;
      tree.scale.setScalar(0.8 + random() * 0.6);
      this.scene.add(tree);
    };
    for (let index = 0; index < 70; index += 1) plant(-72 + random() * 70, -23 - random() * 22);
    for (let index = 0; index < 45; index += 1) plant(-72 + random() * 62, 23 + random() * 16);
  }

  addWorkers() {
    const loops = [
      [groundPoint(-64, 10.5), groundPoint(-26, 10.5), groundPoint(-26, 11.2), groundPoint(-64, 11.2)],
      [groundPoint(-64, 0.6), groundPoint(-53, 0.6), groundPoint(-53, 2.2), groundPoint(-64, 2.2)],
      [groundPoint(-53, -17.5), groundPoint(-29, -17.5), groundPoint(-29, -16.8), groundPoint(-53, -16.8)],
      [groundPoint(-47, 7.3), groundPoint(-25, 7.3), groundPoint(-25, 7.8), groundPoint(-47, 7.8)],
    ];
    const counts = [4, 2, 2, 3];
    loops.forEach((points, loopIndex) => {
      const length = pathLength([...points, points[0]]);
      for (let index = 0; index < counts[loopIndex]; index += 1) {
        const worker = buildWorker(this.materials, this.random);
        this.scene.add(worker.group);
        this.walkers.push({ worker, points, distance: (index / counts[loopIndex]) * length + this.random() * 3, speed: WORKER_SPEED * (0.8 + this.random() * 0.4) });
      }
    });
    const route = [groundPoint(-60, 6.5), groundPoint(-30, 9.4), groundPoint(-25.5, 9.4), groundPoint(-25.5, 6.4), groundPoint(-58, 9.4)];
    for (let index = 0; index < 2; index += 1) {
      const forklift = buildForklift(this.materials, this.random);
      this.scene.add(forklift.group);
      this.forklifts.push({ ...forklift, points: route, distance: index * 30 });
    }
  }

  stationActivity(state, id) {
    if (id === "power") return 1;
    const status = state.stations[id].status;
    if (status === "running") return 1;
    if (status === "underpowered") return 0.5;
    return 0;
  }

  spawnBeltItems(stationId, count) {
    const allowance = Math.min(count, Math.floor(this.spawnBudget[stationId]));
    for (let index = 0; index < allowance && this.beltItems.length < MAX_BELT_ITEMS; index += 1) {
      this.spawnBudget[stationId] -= 1;
      const resource = stationId === "mill" ? "steel" : stationId;
      const path = stationId === "mill" ? this.millPaths[this.millBranch++ % this.millPaths.length] : this.shopPaths[stationId];
      const item = mesh(this.itemGeometry[resource], this.itemMaterial[resource]);
      item.position.copy(path[0]);
      item.visible = false;
      this.scene.add(item);
      this.beltItems.push({ mesh: item, path, length: pathLength(path), distance: -index * 0.9 });
    }
  }

  selectStation(id) {
    for (const [stationId, station] of Object.entries(this.stations)) station.ring.visible = stationId === id;
  }

  pickTargets() {
    return Object.values(this.stations).map((station) => station.group);
  }

  updateStations(state, dt) {
    for (const [id, station] of Object.entries(this.stations)) {
      const level = state.stations[id].level;
      if (level !== station.shownLevel) {
        const grew = station.shownLevel > 0 && level > station.shownLevel;
        for (const tier of station.tiers) {
          const visible = level >= tier.level;
          for (const object of tier.objects) {
            if (visible && !object.visible && grew) this.celebrate(object);
            object.visible = visible;
          }
        }
        if (grew) this.effects.flash(station.anchor.clone().setY(LABEL_HEIGHT[id] - 2), 0xffe7a0, 1.2, 0.5);
        station.shownLevel = level;
      }
      station.animate(dt, this.stationActivity(state, id), state);
      const status = id === "power" ? (state.stations.power.level > 0 ? "running" : "idle") : state.stations[id].status;
      station.beaconMaterial.emissive.setHex(STATUS_COLORS[status] ?? STATUS_COLORS.idle);
      station.beaconMaterial.emissiveIntensity = 0.9 + Math.sin(this.time * (status === "running" ? 2 : 6)) * 0.5;
      if (station.ring.visible) station.ring.material.opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
    }
  }

  /** Dust and sparks around a newly installed machine. */
  celebrate(object) {
    object.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    for (let index = 0; index < 8; index += 1) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 3, 0.3, (Math.random() - 0.5) * 3);
      this.effects.puff(center.clone().setY(FLOOR_Y + 0.4).add(offset), { color: 0xcfc6b0, size: 0.6, grow: 2, life: 1.6, rise: 0.8, drift: 2, opacity: 0.6 });
      this.effects.spark(center, 0xffe08a);
    }
  }

  updateBelts(dt) {
    for (const texture of this.beltTextures) texture.offset.x -= (dt * BELT_SPEED) / BELT_TILE;
    for (const key of Object.keys(this.spawnBudget)) this.spawnBudget[key] = Math.min(ITEM_SPAWNS_PER_SECOND, this.spawnBudget[key] + dt * ITEM_SPAWNS_PER_SECOND);
    const keep = [];
    for (const item of this.beltItems) {
      item.distance += dt * BELT_SPEED;
      item.mesh.visible = item.distance >= 0;
      pointOnPath(item.path, Math.max(0, item.distance), item.mesh.position);
      item.mesh.position.y += 0.18;
      if (item.distance < item.length) keep.push(item);
      else this.scene.remove(item.mesh);
    }
    this.beltItems = keep;
  }

  updateStockpiles(state) {
    const fill = (resource, amount) => {
      const fraction = Math.min(1, amount / storageCap(state, resource));
      this.stockpiles[resource].count = Math.ceil(fraction * STOCK_PILE_SLOTS);
    };
    fill("steel", state.resources.steel);
    for (const part of PARTS) fill(part, state.parts[part]);
  }

  updateAssembly(state) {
    const runtime = state.stations.assembly;
    const view = this.assemblyView;
    if (runtime.building !== view.modelId) {
      if (view.object) this.scene.remove(view.object);
      view.modelId = runtime.building;
      view.object = null;
      if (runtime.building) {
        view.object = createTankMesh(runtime.building, "ally", MODEL_BY_ID[runtime.building].paint);
        view.object.position.set(ASSEMBLY_PLATFORM.x, ASSEMBLY_PLATFORM.y, ASSEMBLY_PLATFORM.z);
        view.turretBaseY = view.object.userData.turret.position.y;
        this.scene.add(view.object);
      }
    }
    if (!view.object) return;
    const progress = runtime.progress / MODEL_BY_ID[runtime.building].buildSeconds;
    const turret = view.object.userData.turret;
    const lift = Math.max(0, 1 - Math.max(0, progress - 0.35) / 0.4);
    turret.visible = progress > 0.25;
    turret.position.y = view.turretBaseY + lift * 9;
    view.object.userData.lower.scale.y = Math.min(1, 0.2 + progress * 3);
  }

  updateTraffic(dt) {
    const heading = new THREE.Vector3();
    for (const walker of this.walkers) {
      walker.distance += dt * walker.speed;
      const angle = pointOnLoop(walker.points, walker.distance, heading);
      walker.worker.group.position.copy(heading);
      walker.worker.group.rotation.y = angle;
      animateWalk(walker.worker, this.time + walker.distance, walker.speed);
    }
    for (const forklift of this.forklifts) {
      forklift.distance += dt * FORKLIFT_SPEED;
      const angle = pointOnLoop(forklift.points, forklift.distance, heading);
      forklift.group.position.copy(heading);
      forklift.group.rotation.y += Math.atan2(Math.sin(angle - forklift.group.rotation.y), Math.cos(angle - forklift.group.rotation.y)) * Math.min(1, dt * 6);
      const loopLength = pathLength([...forklift.points, forklift.points[0]]);
      forklift.load.visible = (forklift.distance % loopLength) < loopLength * 0.5;
    }
    this.flag.rotation.y = Math.sin(this.time * 2.2) * 0.25;
  }

  update(state, dt) {
    this.time += dt;
    this.updateStations(state, dt);
    this.updateBelts(dt);
    this.updateStockpiles(state);
    this.updateAssembly(state);
    this.updateTraffic(dt);
    this.updateTrain(dt);
  }

  /** Raises the gate arm while a tank is close to it. */
  setGateOpen(open, dt) {
    const target = open ? -1.3 : 0;
    this.gateBarrier.rotation.x += (target - this.gateBarrier.rotation.x) * Math.min(1, dt * 5);
  }
}

export const ASSEMBLY_PLATFORM = {
  x: STATION_LAYOUT.assembly.x + 0.5,
  y: FLOOR_Y + ASSEMBLY_PLATFORM_HEIGHT,
  z: STATION_LAYOUT.assembly.z,
};
