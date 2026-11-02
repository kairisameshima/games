import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BATTLE, PARTS } from "./data.js";
import { charTank, createTankMesh, MODEL_SCALE, paintMaterial } from "./models.js";
import { formatShort } from "./format.js";
import { MODEL_BY_ID, storageCap } from "./sim.js";

const SKY = 0xb7cad3;
const BELT_HEIGHT = 0.55;
const BELT_SPEED = 4.5;
const ITEM_SPAWNS_PER_SECOND = 5;
const MAX_BELT_ITEMS = 140;
const MAX_EFFECTS = 320;
const WRECK_SECONDS = 9;
const TRACER_SPEED = 110;
const STOCK_PILE_SLOTS = 20;
const GROUND_OFFSET_X = 40;

export const STATION_LAYOUT = {
  power: { x: -50, z: -14 },
  mill: { x: -57, z: 0 },
  hull: { x: -37, z: -7.5 },
  turret: { x: -37, z: 0 },
  engine: { x: -37, z: 7.5 },
  assembly: { x: -18, z: 0 },
};

// Parking bays on both sides of the hall-to-gate road, nose toward the road. The back rank sits
// behind the gaps of the front rank so every bay can drive out without passing through another.
const DEPOT_SLOTS = [
  { x: -3, z: 4.5 },
  { x: -3, z: -4.5 },
  { x: -7, z: 4.5 },
  { x: -7, z: -4.5 },
  { x: -11, z: 4.5 },
  { x: -11, z: -4.5 },
  { x: -5, z: 9.5 },
  { x: -5, z: -9.5 },
  { x: -9, z: 9.5 },
  { x: -9, z: -9.5 },
];
const ROAD_Z = 0;
const HALL_START = { x: STATION_LAYOUT.assembly.x + 0.5, z: STATION_LAYOUT.assembly.z };
const DRIVE_SPEED = 7;
const TURN_RATE = 3.2;
const PIVOT_ANGLE = 0.35;
const ARRIVE_DISTANCE = 0.05;
const HANDOFF_DISTANCE = 0.3;

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function parkedHeading(slot) {
  return slot.z > ROAD_Z ? Math.PI / 2 : -Math.PI / 2;
}

function groundHeight(x, z) {
  const onPlatform = Math.abs(x - HALL_START.x) < 3.5 && Math.abs(z - HALL_START.z) < 2.2;
  if (onPlatform) return 0.4;
  return x < 2 ? 0.2 : 0;
}

/** Pivot-steers like a tank: turns in place until roughly aligned, then drives. Returns true on arrival. */
function driveToward(object, x, z, reverse, speed, dt) {
  const dx = x - object.position.x;
  const dz = z - object.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < ARRIVE_DISTANCE) return true;
  const heading = Math.atan2(-dz, dx) + (reverse ? Math.PI : 0);
  const diff = angleDelta(object.rotation.y, heading);
  const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
  object.rotation.y += turn;
  for (const wheel of object.userData.wheels) wheel.rotation.z -= dt * speed * 1.6 * (reverse ? -1 : 1);
  if (Math.abs(diff) > PIVOT_ANGLE) return false;
  const step = Math.min(distance, speed * dt);
  object.position.x += (dx / distance) * step;
  object.position.z += (dz / distance) * step;
  return distance - step < ARRIVE_DISTANCE;
}

/** Follows route.points in order. Returns true once the last point is reached. */
function driveRoute(object, route, speed, dt) {
  while (route.index < route.points.length) {
    const point = route.points[route.index];
    if (!driveToward(object, point.x, point.z, point.reverse === true, speed, dt)) return false;
    route.index += 1;
  }
  return true;
}

function routeToSlot(slot) {
  return { index: 0, points: [{ x: slot.x, z: ROAD_Z }, { x: slot.x, z: slot.z, reverse: true }] };
}

function routeToGate(position) {
  return { index: 0, points: [{ x: position.x, z: ROAD_Z }, { x: BATTLE.gateX, z: ROAD_Z }] };
}

const CAMERA_VIEWS = {
  factory: { target: new THREE.Vector3(-33, 0, 0), offset: new THREE.Vector3(0, 40, 44) },
  front: { target: new THREE.Vector3(58, 0, 0), offset: new THREE.Vector3(0, 32, 40) },
  overview: { target: new THREE.Vector3(20, 0, 2), offset: new THREE.Vector3(0, 100, 92) },
};

const SHARED = {
  sphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
};

const MATERIALS = {
  concrete: paintMaterial(0x9a968a),
  concreteDark: paintMaterial(0x7b786f),
  stripe: paintMaterial(0xd8b13a),
  brick: paintMaterial(0x8e4b35),
  brickDark: paintMaterial(0x6d3828),
  steelBeam: paintMaterial(0x4f5a62),
  machine: paintMaterial(0x4d6a6f),
  machineLight: paintMaterial(0x8aa3a1),
  rust: paintMaterial(0x7a4d2e),
  roof: paintMaterial(0x5c5f5a),
  glow: paintMaterial(0xff8a2a, { emissive: 0xff6a10 }),
  window: paintMaterial(0xffd47a, { emissive: 0xc98a2a }),
  belt: paintMaterial(0x2f302d),
  beltFrame: paintMaterial(0x6c6f68),
  wood: paintMaterial(0x7a5a3a),
  sandbag: paintMaterial(0xb3a173),
  trunk: paintMaterial(0x5b4430),
  leaves: paintMaterial(0x47652f),
  leavesDark: paintMaterial(0x3a5527),
  rubble: paintMaterial(0x8d8577),
  crater: paintMaterial(0x6e5c40),
  hedgehog: paintMaterial(0x3b3a36),
  ingot: paintMaterial(0x9aa3a8, { roughness: 0.5 }),
  hullPart: paintMaterial(0x5d6a3a),
  turretPart: paintMaterial(0x6f7b48),
  enginePart: paintMaterial(0x4a4440),
  engineTop: paintMaterial(0xb2452e),
  ring: new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.8 }),
};

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function block(parent, w, h, d, material, x, y, z) {
  const item = mesh(SHARED.box, material, x, y + h / 2, z);
  item.scale.set(w, h, d);
  parent.add(item);
  return item;
}

function column(parent, radiusTop, radiusBottom, h, material, x, y, z, segments = 12) {
  const item = mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), material, x, y + h / 2, z);
  parent.add(item);
  return item;
}

function beltTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  context.fillStyle = "#2c2d2a";
  context.fillRect(0, 0, 64, 16);
  context.fillStyle = "#4a4b46";
  for (let x = 0; x < 64; x += 16) context.fillRect(x, 0, 6, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function v(x, z) {
  return new THREE.Vector3(x, BELT_HEIGHT, z);
}

export class World {
  constructor(canvas, labelLayer) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 120, 300);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 170;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = 1.22;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.cameraTween = null;

    this.units = new Map();
    this.wrecks = [];
    this.effects = [];
    this.beltItems = [];
    this.beltTextures = [];
    this.stations = {};
    this.floaters = [];
    this.spawnBudget = { mill: 0, hull: 0, turret: 0, engine: 0 };
    this.millBranch = 0;
    this.assemblyView = { modelId: null, object: null };
    /** One entry per tank in state.depot: { modelId, object, slotIndex, route }. Overflow entries have no object. */
    this.depotViews = [];
    this.selectedStation = null;
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
    this.scratch = new THREE.Vector3();
    this.scratchB = new THREE.Vector3();

    this.addLights();
    this.addGround();
    this.addFactory();
    this.addBattlefield();
    this.resize();
    this.setView("factory", true);
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xe6eef5, 0x5d5338, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    sun.position.set(-30, 90, 55);
    sun.target.position.set(10, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const camera = sun.shadow.camera;
    camera.left = -110;
    camera.right = 110;
    camera.top = 60;
    camera.bottom = -60;
    camera.near = 10;
    camera.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
  }

  addGround() {
    const random = seeded(11);
    const field = new THREE.PlaneGeometry(700, 400, 140, 80);
    field.rotateX(-Math.PI / 2);
    const colors = [];
    const grass = new THREE.Color(0x6f8a3f);
    const mud = new THREE.Color(0x8a7650);
    const color = new THREE.Color();
    const position = field.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index) + GROUND_OFFSET_X;
      const z = position.getZ(index);
      const inLane = x > -4 && x < 112 && Math.abs(z) < BATTLE.laneHalfWidth + 3;
      const lane = inLane ? Math.min(1, (BATTLE.laneHalfWidth + 3 - Math.abs(z)) / 3) : 0;
      color.copy(grass).lerp(mud, lane * 0.85).multiplyScalar(0.88 + random() * 0.18);
      colors.push(color.r, color.g, color.b);
      if (!inLane && x > -2 && Math.abs(z) > 14) position.setY(index, random() * 0.6);
    }
    field.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    field.computeVertexNormals();
    const ground = new THREE.Mesh(field, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.position.x = GROUND_OFFSET_X;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const floor = block(this.scene, 70, 0.2, 40, MATERIALS.concrete, -33, 0, 0);
    floor.castShadow = false;
    for (const z of [-11.2, 11.2]) block(this.scene, 52, 0.22, 0.25, MATERIALS.stripe, -32, 0, z);
    block(this.scene, 22, 0.21, 8, MATERIALS.concreteDark, -2, 0, 0);
  }

  addFence() {
    const posts = [];
    for (let x = -67; x <= -1; x += 3) posts.push([x, -20], [x, 20]);
    for (let z = -20; z <= 20; z += 3) {
      posts.push([-68, z]);
      if (Math.abs(z) > 5) posts.push([-1, z]);
    }
    const geometry = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6);
    const instanced = new THREE.InstancedMesh(geometry, MATERIALS.steelBeam, posts.length);
    const matrix = new THREE.Matrix4();
    posts.forEach(([x, z], index) => {
      matrix.makeTranslation(x, 1.1, z);
      instanced.setMatrixAt(index, matrix);
    });
    instanced.castShadow = true;
    this.scene.add(instanced);
    for (const z of [-20, 20]) block(this.scene, 67, 0.12, 0.06, MATERIALS.steelBeam, -34.5, 1.8, z);
    block(this.scene, 0.06, 0.12, 40, MATERIALS.steelBeam, -68, 1.8, 0);
    const gate = new THREE.Group();
    block(gate, 0.8, 5, 0.8, MATERIALS.brick, 0, 0, -5.5);
    block(gate, 0.8, 5, 0.8, MATERIALS.brick, 0, 0, 5.5);
    block(gate, 0.9, 0.9, 12, MATERIALS.brickDark, 0, 5, 0);
    gate.position.x = -1;
    this.scene.add(gate);
  }

  registerStation(id, group, animate) {
    const layout = STATION_LAYOUT[id];
    group.position.set(layout.x, 0, layout.z);
    group.traverse((child) => {
      child.userData.stationId = id;
    });
    this.scene.add(group);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.8, 40), MATERIALS.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(layout.x, 0.25, layout.z);
    ring.visible = false;
    this.scene.add(ring);
    const label = document.createElement("button");
    label.type = "button";
    label.className = "station-label";
    label.dataset.station = id;
    this.labelLayer.append(label);
    this.stations[id] = { group, animate, ring, label, anchor: new THREE.Vector3(layout.x, group.userData.labelHeight ?? 8, layout.z), labelText: "" };
  }

  addFactory() {
    this.addFence();
    this.addPowerStation();
    this.addSteelMill();
    this.addHullWorks();
    this.addTurretShop();
    this.addEnginePlant();
    this.addAssemblyHall();
    this.addBelts();
    this.addStockpiles();
    this.addPowerLines();
  }

  addPowerStation() {
    const group = new THREE.Group();
    block(group, 10, 5.5, 6, MATERIALS.brick, 0, 0, 0);
    block(group, 10.4, 0.5, 6.4, MATERIALS.brickDark, 0, 5.5, 0);
    for (let x = -3.6; x <= 3.6; x += 1.8) block(group, 0.9, 1.4, 0.1, MATERIALS.window, x, 2.2, 3.02);
    const stacks = [column(group, 0.55, 0.8, 9, MATERIALS.brickDark, -3, 5.5, -1), column(group, 0.55, 0.8, 9, MATERIALS.brickDark, 0.2, 5.5, -1)];
    for (const x of [3.2, 4.6]) {
      block(group, 1, 1.6, 1.2, MATERIALS.machine, x, 0, 4.2);
      column(group, 0.08, 0.08, 1.2, MATERIALS.machineLight, x, 1.6, 4.2, 6);
    }
    group.userData.labelHeight = 16;
    this.registerStation("power", group, (dt, activity) => {
      for (const stack of stacks) {
        stack.userData.timer = (stack.userData.timer ?? Math.random()) - dt * (0.6 + activity * 1.4);
        if (stack.userData.timer > 0) continue;
        stack.userData.timer = 1;
        const top = stack.position.clone();
        top.y += 4.8;
        top.add(group.position);
        this.puff(top, { color: 0x6d6a66, size: 0.9, grow: 2.2, life: 4, rise: 2.2, drift: 1.2 });
      }
    });
  }

  addSteelMill() {
    const group = new THREE.Group();
    const furnace = column(group, 1.7, 2.6, 8, MATERIALS.rust, 0, 0, 0, 14);
    furnace.castShadow = true;
    const glowRing = column(group, 1.75, 1.75, 0.6, MATERIALS.glow, 0, 8, 0, 14);
    column(group, 0.5, 0.6, 4, MATERIALS.brickDark, 0, 8.6, 0);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      block(group, 0.3, 7, 0.3, MATERIALS.steelBeam, Math.cos(angle) * 2.8, 0, Math.sin(angle) * 2.8);
    }
    block(group, 3, 2.2, 3, MATERIALS.brick, 3.2, 0, -2.5);
    const ore = mesh(new THREE.ConeGeometry(2.2, 2.2, 8), MATERIALS.rubble, -3.6, 1.1, 3.2);
    group.add(ore);
    const ladle = column(group, 0.7, 0.55, 0.9, MATERIALS.steelBeam, 2.4, 0.2, 1.8, 10);
    const melt = column(group, 0.62, 0.62, 0.1, MATERIALS.glow, 2.4, 1.05, 1.8, 10);
    group.userData.labelHeight = 14;
    this.registerStation("mill", group, (dt, activity) => {
      const pulse = 0.7 + Math.sin(this.time * 6) * 0.3 * activity;
      glowRing.scale.set(1, 0.6 + pulse * 0.6, 1);
      melt.visible = activity > 0;
      ladle.rotation.z = Math.sin(this.time * 2) * 0.15 * activity;
      group.userData.smoke = (group.userData.smoke ?? 0) - dt * activity;
      if (group.userData.smoke <= 0 && activity > 0) {
        group.userData.smoke = 0.9;
        this.puff(new THREE.Vector3(group.position.x, 12.6, group.position.z), { color: 0x8a8580, size: 0.8, grow: 2, life: 3.5, rise: 2.5, drift: 1 });
      }
    });
  }

  addShed(group, width, depth, height) {
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-depth / 2, depth / 2]) block(group, 0.35, height, 0.35, MATERIALS.steelBeam, x, 0, z);
    }
    for (const z of [-depth / 2, depth / 2]) block(group, width + 0.4, 0.35, 0.35, MATERIALS.steelBeam, 0, height, z);
    for (const x of [-width / 2, 0, width / 2]) block(group, 0.3, 0.3, depth, MATERIALS.steelBeam, x, height, 0);
    block(group, width, height * 0.45, 0.2, MATERIALS.brick, 0, 0, -depth / 2);
  }

  addHullWorks() {
    const group = new THREE.Group();
    this.addShed(group, 6, 5.5, 5.2);
    block(group, 3.2, 0.8, 2.6, MATERIALS.machine, 0, 0, 0);
    block(group, 0.4, 4, 0.4, MATERIALS.machineLight, -1.4, 0, 0);
    block(group, 0.4, 4, 0.4, MATERIALS.machineLight, 1.4, 0, 0);
    block(group, 3.4, 0.5, 1.2, MATERIALS.machine, 0, 4, 0);
    const ram = block(group, 2.4, 0.6, 2, MATERIALS.steelBeam, 0, 2.6, 0);
    const plate = block(group, 2.2, 0.15, 1.8, MATERIALS.hullPart, 0, 0.8, 0);
    this.registerStation("hull", group, (dt, activity) => {
      const stroke = Math.max(0, Math.sin(this.time * 5)) * activity;
      ram.position.y = 3.0 - stroke * 2.0;
      plate.visible = activity > 0;
      if (activity > 0 && stroke > 0.97 && Math.random() < 0.3) this.spark(new THREE.Vector3(group.position.x, 1.1, group.position.z), 0xffe08a);
    });
  }

  addTurretShop() {
    const group = new THREE.Group();
    this.addShed(group, 6, 5.5, 5.2);
    block(group, 4, 1, 1.6, MATERIALS.machine, 0, 0, 0);
    block(group, 0.9, 1.6, 1.4, MATERIALS.machineLight, -1.8, 1, 0);
    const chuck = new THREE.Group();
    chuck.position.set(0.2, 1.9, 0);
    const turretBlank = mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.9, 8).rotateZ(Math.PI / 2), MATERIALS.turretPart);
    const barrel = mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8).rotateZ(Math.PI / 2), MATERIALS.steelBeam, 1.4, 0, 0);
    chuck.add(turretBlank, barrel);
    group.add(chuck);
    const tool = block(group, 0.3, 0.5, 0.3, MATERIALS.glow, 0.2, 1.0, 1.05);
    this.registerStation("turret", group, (dt, activity) => {
      chuck.rotation.x += dt * 8 * activity;
      tool.position.x = Math.sin(this.time * 1.5) * 0.8;
      tool.visible = activity > 0;
      if (activity > 0 && Math.random() < dt * 6) this.spark(new THREE.Vector3(group.position.x + tool.position.x, 1.6, group.position.z + 0.9), 0xffc46a);
    });
  }

  addEnginePlant() {
    const group = new THREE.Group();
    this.addShed(group, 6, 5.5, 5.2);
    block(group, 2.6, 1.5, 1.8, MATERIALS.enginePart, -0.4, 0, 0);
    block(group, 2.4, 0.4, 1.4, MATERIALS.engineTop, -0.4, 1.5, 0);
    const pistons = [];
    for (let index = 0; index < 4; index += 1) pistons.push(block(group, 0.3, 0.6, 0.3, MATERIALS.machineLight, -1.3 + index * 0.6, 1.6, 0));
    const gears = [];
    for (const [x, y, radius] of [[1.6, 1.4, 0.9], [1.6, 3.0, 0.55]]) {
      const gear = new THREE.Group();
      gear.position.set(x, y, 0.4);
      gear.add(mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 14).rotateX(Math.PI / 2), MATERIALS.steelBeam));
      for (let tooth = 0; tooth < 10; tooth += 1) {
        const angle = (tooth / 10) * Math.PI * 2;
        const cog = mesh(SHARED.box, MATERIALS.steelBeam, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        cog.scale.set(0.25, 0.25, 0.3);
        cog.rotation.z = angle;
        gear.add(cog);
      }
      group.add(gear);
      gears.push({ gear, radius });
    }
    this.registerStation("engine", group, (dt, activity) => {
      gears[0].gear.rotation.z += dt * 2.5 * activity;
      gears[1].gear.rotation.z -= dt * 2.5 * activity * (gears[0].radius / gears[1].radius);
      pistons.forEach((piston, index) => {
        piston.position.y = 1.9 + Math.sin(this.time * 10 + index * Math.PI * 0.5) * 0.25 * activity;
      });
    });
  }

  addAssemblyHall() {
    const group = new THREE.Group();
    const width = 11;
    const depth = 12;
    const height = 8;
    for (const x of [-width / 2, 0, width / 2]) {
      for (const z of [-depth / 2, depth / 2]) block(group, 0.45, height, 0.45, MATERIALS.steelBeam, x, 0, z);
    }
    for (const x of [-width / 2, 0, width / 2]) block(group, 0.4, 0.6, depth, MATERIALS.steelBeam, x, height - 0.6, 0);
    block(group, width, 0.3, 0.5, MATERIALS.steelBeam, 0, height, -depth / 2);
    block(group, width, 3, 0.2, MATERIALS.brick, 0, 0, -depth / 2);
    block(group, 7, 0.4, 4.4, MATERIALS.concreteDark, 0.5, 0, 0);
    const crane = new THREE.Group();
    block(crane, 0.5, 0.5, depth, MATERIALS.stripe, 0, 0, 0);
    block(crane, 0.9, 0.6, 0.9, MATERIALS.machine, 0, -0.6, 0);
    block(crane, 0.06, 2.5, 0.06, MATERIALS.steelBeam, 0, -3.1, 0);
    crane.position.set(0, height - 1.1, 0);
    group.add(crane);
    group.userData.labelHeight = 12;
    this.registerStation("assembly", group, (dt, activity) => {
      crane.position.x = Math.sin(this.time * 0.6) * 3 * (activity > 0 ? 1 : 0.2);
      if (activity > 0 && Math.random() < dt * 5) {
        this.spark(new THREE.Vector3(group.position.x + 0.5 + (Math.random() - 0.5) * 3, 1.4, group.position.z + (Math.random() - 0.5) * 2), 0x9fd8ff);
      }
    });
  }

  addBelts() {
    const shopZ = { hull: STATION_LAYOUT.hull.z, turret: STATION_LAYOUT.turret.z, engine: STATION_LAYOUT.engine.z };
    const millX = STATION_LAYOUT.mill.x + 3;
    this.millPaths = Object.values(shopZ).map((z) => [v(millX, 0), v(-45, 0), v(-45, z), v(-40.5, z)]);
    this.shopPaths = {};
    for (const [part, z] of Object.entries(shopZ)) {
      this.shopPaths[part] = [v(-33.5, z), v(-27, z), v(-27, z * 0.3), v(-23.5, z * 0.3)];
    }
    const segments = [];
    const seen = new Set();
    for (const path of [...this.millPaths, ...Object.values(this.shopPaths)]) {
      for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1];
        const to = path[index];
        const key = `${from.x},${from.z},${to.x},${to.z}`;
        if (seen.has(key) || from.distanceTo(to) < 0.01) continue;
        seen.add(key);
        segments.push([from, to]);
      }
    }
    const baseTexture = beltTexture();
    for (const [from, to] of segments) {
      const length = from.distanceTo(to) + 1.1;
      const texture = baseTexture.clone();
      texture.repeat.set(length / 1.4, 1);
      texture.needsUpdate = true;
      this.beltTextures.push(texture);
      const surface = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
      const group = new THREE.Group();
      const top = mesh(new THREE.BoxGeometry(length, 0.12, 1.1), [MATERIALS.beltFrame, MATERIALS.beltFrame, surface, MATERIALS.beltFrame, MATERIALS.beltFrame, MATERIALS.beltFrame], 0, BELT_HEIGHT - 0.1, 0);
      group.add(top);
      block(group, length, 0.35, 1.3, MATERIALS.beltFrame, 0, 0.05, 0);
      for (let leg = -length / 2 + 0.5; leg < length / 2; leg += 2.5) block(group, 0.15, 0.3, 1.2, MATERIALS.steelBeam, leg, 0, 0);
      group.position.set((from.x + to.x) / 2, 0, (from.z + to.z) / 2);
      group.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
      this.scene.add(group);
    }
    this.itemGeometry = {
      steel: new THREE.BoxGeometry(0.7, 0.3, 0.4),
      hull: new THREE.BoxGeometry(0.95, 0.4, 0.75),
      turret: new THREE.CylinderGeometry(0.35, 0.42, 0.35, 8),
      engine: new THREE.BoxGeometry(0.6, 0.55, 0.55),
    };
    this.itemMaterial = { steel: MATERIALS.ingot, hull: MATERIALS.hullPart, turret: MATERIALS.turretPart, engine: MATERIALS.enginePart };
  }

  addStockpiles() {
    const pile = (resource, origin, columns) => {
      const geometry = this.itemGeometry[resource];
      const instanced = new THREE.InstancedMesh(geometry, this.itemMaterial[resource], STOCK_PILE_SLOTS);
      instanced.castShadow = true;
      instanced.count = 0;
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < STOCK_PILE_SLOTS; index += 1) {
        const layer = Math.floor(index / (columns * 2));
        const inLayer = index % (columns * 2);
        matrix.makeTranslation(origin.x + (inLayer % columns) * 1.0, 0.35 + layer * 0.5, origin.z + Math.floor(inLayer / columns) * 0.9);
        instanced.setMatrixAt(index, matrix);
      }
      this.scene.add(instanced);
      return instanced;
    };
    this.stockpiles = {
      steel: pile("steel", { x: -54, z: 4.5 }, 4),
      hull: pile("hull", { x: -26, z: -10 }, 4),
      turret: pile("turret", { x: -31, z: 2.5 }, 3),
      engine: pile("engine", { x: -26, z: 9.2 }, 4),
    };
  }

  addPowerLines() {
    const power = STATION_LAYOUT.power;
    const poles = [];
    const points = [];
    const top = 7;
    const hub = new THREE.Vector3(power.x + 6, top, power.z + 2);
    for (const id of ["mill", "hull", "turret", "engine", "assembly"]) {
      const layout = STATION_LAYOUT[id];
      const pole = id === "assembly" ? new THREE.Vector3(layout.x, top, layout.z - 7.4) : new THREE.Vector3(layout.x + 3.5, top, layout.z - 3.2);
      poles.push(pole);
      points.push(hub, pole);
    }
    poles.push(hub);
    for (const pole of poles) {
      column(this.scene, 0.12, 0.16, top, MATERIALS.wood, pole.x, 0, pole.z, 6);
      block(this.scene, 1.4, 0.12, 0.12, MATERIALS.wood, pole.x, top - 0.4, pole.z);
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.scene.add(wires);
  }

  addBattlefield() {
    const random = seeded(4242);
    const craterGeometry = new THREE.CylinderGeometry(1, 1.3, 0.06, 12);
    for (let index = 0; index < 40; index += 1) {
      const crater = mesh(craterGeometry, MATERIALS.crater, 6 + random() * 100, 0.04, (random() * 2 - 1) * 15);
      crater.scale.set(0.5 + random() * 0.9, 1, 0.5 + random() * 0.9);
      crater.castShadow = false;
      this.scene.add(crater);
    }
    const treeTrunk = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
    const treeTop = new THREE.ConeGeometry(1.6, 4, 7);
    const plantTree = (x, z, scale) => {
      const tree = new THREE.Group();
      tree.add(mesh(treeTrunk, MATERIALS.trunk, 0, 1, 0));
      tree.add(mesh(treeTop, random() > 0.5 ? MATERIALS.leaves : MATERIALS.leavesDark, 0, 3.6, 0));
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);
      this.scene.add(tree);
    };
    for (let index = 0; index < 90; index += 1) {
      const side = random() > 0.5 ? 1 : -1;
      plantTree(2 + random() * 115, side * (16 + random() * 30), 0.8 + random() * 0.7);
    }
    for (let index = 0; index < 50; index += 1) plantTree(112 + random() * 20, (random() * 2 - 1) * 30, 1 + random() * 0.6);
    for (let index = 0; index < 40; index += 1) plantTree(-75 - random() * 30, (random() * 2 - 1) * 40, 0.9 + random() * 0.6);

    const sandbagGeometry = new THREE.CapsuleGeometry(0.28, 0.6, 2, 6).rotateZ(Math.PI / 2);
    const bags = [];
    for (const z0 of [-11, -5.5, 5.5, 11]) {
      for (let index = 0; index < 8; index += 1) bags.push([BATTLE.rallyX + 6 + (index % 2) * 0.3, 0.3 + Math.floor(index / 4) * 0.5, z0 - 1.5 + (index % 4) * 0.95]);
    }
    const sandbags = new THREE.InstancedMesh(sandbagGeometry, MATERIALS.sandbag, bags.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    bags.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z).multiply(rotation);
      sandbags.setMatrixAt(index, matrix);
    });
    sandbags.castShadow = true;
    this.scene.add(sandbags);

    for (let index = 0; index < 14; index += 1) {
      const hedgehog = new THREE.Group();
      for (let axis = 0; axis < 3; axis += 1) {
        const bar = mesh(SHARED.box, MATERIALS.hedgehog);
        bar.scale.set(2.2, 0.18, 0.18);
        bar.rotation.set(axis === 0 ? 0.6 : 0, axis === 1 ? 0.9 : 2.2, axis === 2 ? 0.8 : 0.3);
        hedgehog.add(bar);
      }
      hedgehog.position.set(62 + random() * 35, 0.7, (random() > 0.5 ? 1 : -1) * (9.5 + random() * 4));
      hedgehog.rotation.y = random() * Math.PI;
      this.scene.add(hedgehog);
    }

    for (const [x, z, w, d] of [[78, -17, 7, 5], [92, 16, 6, 6], [60, 19, 5, 4], [30, -19, 6, 5]]) {
      const ruin = new THREE.Group();
      block(ruin, w, 3.5 + random() * 2, 0.5, MATERIALS.rubble, 0, 0, -d / 2);
      block(ruin, 0.5, 2 + random() * 2, d, MATERIALS.rubble, -w / 2, 0, 0);
      block(ruin, w * 0.5, 1.2, 0.5, MATERIALS.rubble, w * 0.2, 0, d / 2);
      block(ruin, 1.4, 0.6, 1.2, MATERIALS.brickDark, 0.8, 0, 0.4);
      block(ruin, w + 0.4, 0.3, d + 0.4, MATERIALS.roof, 0, 0, 0).rotation.z = 0.08;
      ruin.position.set(x, 0, z);
      ruin.rotation.y = random() * 0.5;
      this.scene.add(ruin);
    }

    const signal = new THREE.Group();
    block(signal, 0.3, 6, 0.3, MATERIALS.wood, 0, 0, 0);
    const flag = block(signal, 2, 1.2, 0.05, paintMaterial(0xc23b2b), 1.15, 4.6, 0);
    signal.position.set(BATTLE.rallyX + 8, 0, -9);
    this.flag = flag;
    this.scene.add(signal);
  }

  setView(name, immediate = false) {
    const view = CAMERA_VIEWS[name];
    const portraitPullback = this.camera.aspect < 1 ? 1.9 : 1;
    const position = view.target.clone().addScaledVector(view.offset, portraitPullback);
    if (immediate) {
      this.controls.target.copy(view.target);
      this.camera.position.copy(position);
      this.controls.update();
      return;
    }
    this.cameraTween = { fromTarget: this.controls.target.clone(), fromPosition: this.camera.position.clone(), toTarget: view.target.clone(), toPosition: position, t: 0 };
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  pickStation(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const targets = Object.values(this.stations).map((station) => station.group);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return hit?.object.userData.stationId ?? null;
  }

  selectStation(id) {
    this.selectedStation = id;
    for (const [stationId, station] of Object.entries(this.stations)) station.ring.visible = stationId === id;
  }

  addEffect(object, life, update) {
    if (this.effects.length >= MAX_EFFECTS) {
      const oldest = this.effects.shift();
      this.scene.remove(oldest.object);
      oldest.object.material?.dispose();
    }
    this.scene.add(object);
    this.effects.push({ object, life, age: 0, update });
  }

  puff(position, { color, size, grow, life, rise, drift = 0, opacity = 0.55 }) {
    const material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false });
    const smoke = new THREE.Mesh(SHARED.sphere, material);
    smoke.position.copy(position);
    smoke.scale.setScalar(size);
    const driftX = (Math.random() - 0.3) * drift;
    const driftZ = (Math.random() - 0.5) * drift;
    this.addEffect(smoke, life, (effect, dt, t) => {
      smoke.position.y += rise * dt;
      smoke.position.x += driftX * dt;
      smoke.position.z += driftZ * dt;
      smoke.scale.setScalar(size * (1 + grow * t));
      material.opacity = opacity * (1 - t);
    });
  }

  flash(position, color, size, life) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const glow = new THREE.Mesh(SHARED.sphere, material);
    glow.position.copy(position);
    glow.scale.setScalar(size);
    this.addEffect(glow, life, (effect, dt, t) => {
      glow.scale.setScalar(size * (1 + t * 1.5));
      material.opacity = 1 - t;
    });
  }

  spark(position, color) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    const spark = new THREE.Mesh(SHARED.box, material);
    spark.scale.setScalar(0.12);
    spark.position.copy(position);
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
    this.addEffect(spark, 0.5, (effect, dt, t) => {
      velocity.y -= 14 * dt;
      spark.position.addScaledVector(velocity, dt);
      material.opacity = 1 - t;
    });
  }

  explosion(position, scale) {
    this.flash(position.clone().setY(1.2 * scale), 0xffc35a, 1.4 * scale, 0.35);
    this.flash(position.clone().setY(1.6 * scale), 0xff6a2a, 2.2 * scale, 0.55);
    for (let index = 0; index < 6; index += 1) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2).multiplyScalar(scale);
      this.puff(position.clone().add(offset), { color: 0x3b3835, size: 0.8 * scale, grow: 2.5, life: 2.2, rise: 1.8, drift: 1.5, opacity: 0.7 });
    }
    for (let index = 0; index < 10; index += 1) this.spark(position.clone().setY(1.2), 0xffb050);
  }

  tracer(from, to, side) {
    const material = new THREE.MeshBasicMaterial({ color: side === "ally" ? 0xffe27a : 0xff8a5a });
    const bolt = new THREE.Mesh(SHARED.box, material);
    bolt.scale.set(0.12, 0.12, 0.9);
    bolt.position.copy(from);
    bolt.lookAt(to);
    const distance = from.distanceTo(to);
    const life = Math.max(0.05, distance / TRACER_SPEED);
    const start = from.clone();
    const end = to.clone();
    this.addEffect(bolt, life, (effect, dt, t) => {
      bolt.position.lerpVectors(start, end, t);
      if (effect.age + dt >= effect.life) {
        this.flash(end, 0xffd27a, 0.45, 0.15);
        this.puff(end, { color: 0x6b6258, size: 0.35, grow: 2, life: 0.9, rise: 1, opacity: 0.6 });
      }
    });
  }

  artilleryShell(x, z) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const shell = new THREE.Mesh(SHARED.box, material);
    shell.scale.set(0.25, 0.25, 1.6);
    const start = new THREE.Vector3(x + 14, 36, z);
    const end = new THREE.Vector3(x, 0.3, z);
    shell.position.copy(start);
    shell.lookAt(end);
    this.addEffect(shell, 0.45, (effect, dt, t) => {
      shell.position.lerpVectors(start, end, t);
      if (effect.age + dt < effect.life) return;
      this.explosion(end, 1.6);
      const scorch = new THREE.Mesh(SHARED.sphere, new THREE.MeshBasicMaterial({ color: 0x2a2620, transparent: true, opacity: 0.6, depthWrite: false }));
      scorch.scale.set(2.2, 0.02, 2.2);
      scorch.position.set(x, 0.05, z);
      this.addEffect(scorch, 6, (_, __, fade) => {
        scorch.material.opacity = 0.6 * (1 - fade);
      });
    });
  }

  floater(position, text, className) {
    const element = document.createElement("div");
    element.className = `floater ${className}`;
    element.textContent = text;
    this.labelLayer.append(element);
    this.floaters.push({ element, position: position.clone(), age: 0 });
    if (this.floaters.length > 30) this.floaters.shift().element.remove();
  }

  muzzlePosition(view, target) {
    const gun = view.object.userData.gun;
    if (!gun) return target.copy(view.object.position).setY(1.2);
    view.object.updateMatrixWorld(true);
    return gun.localToWorld(target.set(gun.userData.muzzleX, 0, 0));
  }

  applyEvents(events) {
    for (const event of events) {
      if (event.type === "produced") this.spawnBeltItems(event.station, event.count);
      else if (event.type === "shot") this.showShot(event);
      else if (event.type === "kill") this.showKill(event);
      else if (event.type === "built") this.onTankBuilt(event.model);
      else if (event.type === "deploy") this.onTankDeployed(event);
      else if (event.type === "artillery") this.artilleryShell(event.x, event.z);
    }
  }

  spawnBeltItems(stationId, count) {
    const allowance = Math.min(count, Math.floor(this.spawnBudget[stationId]));
    for (let index = 0; index < allowance && this.beltItems.length < MAX_BELT_ITEMS; index += 1) {
      this.spawnBudget[stationId] -= 1;
      const resource = stationId === "mill" ? "steel" : stationId;
      const path = stationId === "mill" ? this.millPaths[this.millBranch++ % this.millPaths.length] : this.shopPaths[stationId];
      const item = mesh(this.itemGeometry[resource], this.itemMaterial[resource]);
      item.position.copy(path[0]);
      this.scene.add(item);
      this.beltItems.push({ mesh: item, path, length: pathLength(path), distance: -index * 0.9 });
    }
  }

  showShot(event) {
    const shooter = this.units.get(event.from);
    const target = this.units.get(event.to);
    if (!shooter || !target) return;
    const from = this.muzzlePosition(shooter, new THREE.Vector3());
    const to = target.object.position.clone().setY(1 + (target.boss ? 2 : 0));
    to.x += (Math.random() - 0.5) * 0.8;
    to.z += (Math.random() - 0.5) * 0.8;
    this.flash(from, 0xffe7a0, 0.5 * (shooter.boss ? 2.5 : 1), 0.09);
    this.tracer(from, to, event.side);
    shooter.recoil = 1;
  }

  showKill(event) {
    const view = this.units.get(event.id);
    const position = new THREE.Vector3(event.x, 0, event.z);
    this.explosion(position, event.boss ? 3 : 1.2);
    if (event.side === "enemy") {
      const text = `+${formatShort(event.salvage)} salvage  +${formatShort(event.intel)} intel`;
      this.floater(position.clone().setY(4), text, "floater-reward");
    }
    if (!view) return;
    this.units.delete(event.id);
    charTank(view.object);
    if (view.bar) view.object.remove(view.bar);
    view.object.userData.turret.rotation.z = (Math.random() - 0.5) * 0.5;
    this.wrecks.push({ object: view.object, age: 0, smokeTimer: 0 });
  }

  freeDepotSlot() {
    const taken = new Set(this.depotViews.map((entry) => entry.slotIndex));
    const index = DEPOT_SLOTS.findIndex((_, slotIndex) => !taken.has(slotIndex));
    return index === -1 ? null : index;
  }

  /** Drives a fresh tank off the assembly platform and backs it into a depot bay. */
  sendToDepot(entry, slotIndex) {
    const object = createTankMesh(entry.modelId, "ally", MODEL_BY_ID[entry.modelId].paint);
    object.position.set(HALL_START.x, groundHeight(HALL_START.x, HALL_START.z), HALL_START.z);
    this.scene.add(object);
    entry.object = object;
    entry.slotIndex = slotIndex;
    entry.route = routeToSlot(DEPOT_SLOTS[slotIndex]);
  }

  onTankBuilt(modelId) {
    const entry = { modelId, object: null, slotIndex: null, route: null };
    const slotIndex = this.freeDepotSlot();
    if (slotIndex !== null) this.sendToDepot(entry, slotIndex);
    this.depotViews.push(entry);
  }

  /** Hands a depot tank of the deployed model to the new unit so it visibly drives out of the gate. */
  onTankDeployed(event) {
    const rank = (entry) => (entry.object ? 0 : 2) + (entry.route ? 1 : 0);
    let picked = -1;
    this.depotViews.forEach((entry, index) => {
      if (entry.modelId !== event.model) return;
      if (picked === -1 || rank(entry) < rank(this.depotViews[picked]) || (rank(entry) === rank(this.depotViews[picked]) && entry.slotIndex < this.depotViews[picked].slotIndex)) picked = index;
    });
    if (picked === -1) return;
    const [entry] = this.depotViews.splice(picked, 1);
    if (!entry.object) return;
    const view = this.createUnitView({ kind: event.model, side: "ally", x: entry.object.position.x, z: entry.object.position.z }, entry.object);
    view.rollout = routeToGate(entry.object.position);
    this.units.set(event.id, view);
    const waiting = this.depotViews.find((candidate) => candidate.object === null);
    if (waiting) this.sendToDepot(waiting, entry.slotIndex);
  }

  createUnitView(unit, existingObject = null) {
    const model = MODEL_BY_ID[unit.kind];
    const object = existingObject ?? createTankMesh(unit.kind, unit.side, model?.paint);
    const baseHeading = unit.side === "ally" ? 0 : Math.PI;
    if (!existingObject) {
      object.position.set(unit.x, 0, unit.z);
      object.rotation.y = baseHeading;
    }
    const boss = unit.kind === "landship";
    const bar = new THREE.Group();
    const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1b1b1b, depthTest: false }));
    const front = new THREE.Sprite(new THREE.SpriteMaterial({ color: unit.side === "ally" ? 0x8bd450 : 0xe0573a, depthTest: false }));
    const width = boss ? 9 : 2.6;
    back.scale.set(width + 0.2, 0.42, 1);
    front.scale.set(width, 0.28, 1);
    front.center.set(0, 0.5);
    front.position.x = -width / 2;
    back.renderOrder = 10;
    front.renderOrder = 11;
    bar.add(back, front);
    bar.position.y = boss ? 4.8 : 2.4;
    bar.visible = false;
    const barHolder = new THREE.Group();
    barHolder.scale.setScalar(1 / MODEL_SCALE);
    barHolder.add(bar);
    object.add(barHolder);
    this.scene.add(object);
    const gun = object.userData.gun;
    if (gun) gun.userData.baseX = gun.position.x;
    return { object, bar: barHolder, barFront: front, barInner: bar, barWidth: width, recoil: 0, boss, baseHeading, rollout: null };
  }

  syncUnits(state, dt) {
    const alive = new Set();
    for (const unit of state.units) {
      alive.add(unit.id);
      let view = this.units.get(unit.id);
      if (!view) {
        view = this.createUnitView(unit);
        this.units.set(unit.id, view);
      }
      const object = view.object;
      if (view.rollout) {
        this.driveRollout(view, unit, dt);
      } else {
        const follow = Math.min(1, dt * 10);
        object.position.x += (unit.x - object.position.x) * follow;
        object.position.z += (unit.z - object.position.z) * follow;
        object.rotation.y += angleDelta(object.rotation.y, view.baseHeading) * Math.min(1, dt * 4);
        const moving = Math.abs(unit.x - object.position.x) > 0.01 || unit.moving;
        object.position.y = moving ? Math.abs(Math.sin(this.time * 14 + unit.id)) * 0.05 : 0;
        if (moving) for (const wheel of object.userData.wheels) wheel.rotation.z -= dt * unit.speed * 1.6;
      }

      const turret = object.userData.turret;
      const target = unit.targetId === null ? null : this.units.get(unit.targetId);
      if (!object.userData.fixedTurret) {
        let desired = 0;
        if (target) {
          const dx = target.object.position.x - object.position.x;
          const dz = target.object.position.z - object.position.z;
          desired = Math.atan2(-dz, dx) - object.rotation.y;
          desired = Math.atan2(Math.sin(desired), Math.cos(desired));
        }
        turret.rotation.y += (desired - turret.rotation.y) * Math.min(1, dt * 5);
      }
      const gun = object.userData.gun;
      if (gun) {
        view.recoil = Math.max(0, view.recoil - dt * 4);
        gun.position.x = gun.userData.baseX - view.recoil * 0.45;
      }
      const fraction = Math.max(0, unit.hp / unit.maxHp);
      view.barInner.visible = fraction < 0.999 || view.boss;
      view.barFront.scale.x = view.barWidth * fraction;
    }
    for (const [id, view] of this.units) {
      if (alive.has(id)) continue;
      this.scene.remove(view.object);
      this.units.delete(id);
    }
  }

  /** Drives out of the depot to the gate, then catches up with the unit's simulated position. */
  driveRollout(view, unit, dt) {
    const object = view.object;
    const speed = Math.max(DRIVE_SPEED, unit.speed * 1.5);
    const route = view.rollout;
    if (route.index < route.points.length) {
      driveRoute(object, route, speed, dt);
    } else {
      driveToward(object, unit.x, unit.z, false, speed, dt);
      if (Math.hypot(unit.x - object.position.x, unit.z - object.position.z) < HANDOFF_DISTANCE) view.rollout = null;
    }
    object.position.y = groundHeight(object.position.x, object.position.z) + Math.abs(Math.sin(this.time * 14 + unit.id)) * 0.05;
  }

  updateWrecks(dt) {
    for (const wreck of this.wrecks) {
      wreck.age += dt;
      wreck.smokeTimer -= dt;
      if (wreck.smokeTimer <= 0 && wreck.age < WRECK_SECONDS - 2) {
        wreck.smokeTimer = 0.45;
        this.puff(wreck.object.position.clone().setY(1.4), { color: 0x2e2b28, size: 0.6, grow: 2.4, life: 2.6, rise: 2, drift: 1.4, opacity: 0.5 });
      }
      if (wreck.age > WRECK_SECONDS - 2) wreck.object.position.y = -(wreck.age - (WRECK_SECONDS - 2)) * 0.8;
    }
    const keep = [];
    for (const wreck of this.wrecks) {
      if (wreck.age < WRECK_SECONDS) keep.push(wreck);
      else this.scene.remove(wreck.object);
    }
    this.wrecks = keep;
  }

  updateEffects(dt) {
    const keep = [];
    for (const effect of this.effects) {
      const t = Math.min(1, (effect.age + dt) / effect.life);
      effect.update(effect, dt, t);
      effect.age += dt;
      if (effect.age < effect.life) keep.push(effect);
      else {
        this.scene.remove(effect.object);
        effect.object.material?.dispose();
      }
    }
    this.effects = keep;
  }

  updateBelts(dt) {
    for (const texture of this.beltTextures) texture.offset.x -= (dt * BELT_SPEED) / 1.4;
    for (const key of Object.keys(this.spawnBudget)) this.spawnBudget[key] = Math.min(ITEM_SPAWNS_PER_SECOND, this.spawnBudget[key] + dt * ITEM_SPAWNS_PER_SECOND);
    const keep = [];
    for (const item of this.beltItems) {
      item.distance += dt * BELT_SPEED;
      item.mesh.visible = item.distance >= 0;
      pointOnPath(item.path, Math.max(0, item.distance), item.mesh.position);
      item.mesh.position.y += 0.2;
      if (item.distance < item.length) keep.push(item);
      else this.scene.remove(item.mesh);
    }
    this.beltItems = keep;
  }

  updateStockpiles(state) {
    const steelFraction = state.resources.steel / storageCap(state, "steel");
    this.stockpiles.steel.count = Math.ceil(Math.min(1, steelFraction) * STOCK_PILE_SLOTS);
    for (const part of PARTS) {
      const fraction = state.parts[part] / storageCap(state, part);
      this.stockpiles[part].count = Math.ceil(Math.min(1, fraction) * STOCK_PILE_SLOTS);
    }
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
        view.object.position.set(STATION_LAYOUT.assembly.x + 0.5, 0.4, STATION_LAYOUT.assembly.z);
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

  /** Animates depot traffic and rebuilds the lot without animation when it drifts from the simulation (load, catch-up). */
  updateDepot(state, dt) {
    const wanted = [...state.depot].sort().join(",");
    const shown = this.depotViews.map((entry) => entry.modelId).sort().join(",");
    if (wanted !== shown) this.rebuildDepot(state.depot);
    for (const entry of this.depotViews) {
      if (!entry.route) continue;
      if (driveRoute(entry.object, entry.route, DRIVE_SPEED, dt)) entry.route = null;
      entry.object.position.y = groundHeight(entry.object.position.x, entry.object.position.z);
    }
  }

  rebuildDepot(depot) {
    for (const entry of this.depotViews) if (entry.object) this.scene.remove(entry.object);
    this.depotViews = depot.map((modelId, index) => {
      const slot = DEPOT_SLOTS[index];
      if (!slot) return { modelId, object: null, slotIndex: null, route: null };
      const object = createTankMesh(modelId, "ally", MODEL_BY_ID[modelId].paint);
      object.position.set(slot.x, groundHeight(slot.x, slot.z), slot.z);
      object.rotation.y = parkedHeading(slot);
      this.scene.add(object);
      return { modelId, object, slotIndex: index, route: null };
    });
  }

  stationActivity(state, id) {
    if (id === "power") return 1;
    const status = state.stations[id].status;
    if (status === "running") return 1;
    if (status === "underpowered") return 0.5;
    return 0;
  }

  updateLabels(labels, dt) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const [id, station] of Object.entries(this.stations)) {
      const projected = this.scratch.copy(station.anchor).project(this.camera);
      const visible = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      station.label.style.display = visible ? "" : "none";
      if (!visible) continue;
      station.label.style.transform = `translate(-50%, -100%) translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px)`;
      const label = labels[id];
      const text = `${label.title}|${label.status}|${label.detail}`;
      if (text !== station.labelText) {
        station.labelText = text;
        station.label.dataset.status = label.status;
        station.label.innerHTML = `<strong>${label.title}</strong><span>${label.detail}</span>`;
      }
    }
    const keep = [];
    for (const floater of this.floaters) {
      floater.age += dt;
      floater.position.y += dt * 3;
      const projected = this.scratch.copy(floater.position).project(this.camera);
      floater.element.style.transform = `translate(-50%, -50%) translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px)`;
      floater.element.style.opacity = String(Math.max(0, 1 - floater.age / 1.6));
      if (floater.age < 1.6) keep.push(floater);
      else floater.element.remove();
    }
    this.floaters = keep;
  }

  updateCamera(dt) {
    if (this.cameraTween) {
      const tween = this.cameraTween;
      tween.t = Math.min(1, tween.t + dt / 0.9);
      const eased = 1 - (1 - tween.t) ** 3;
      this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      if (tween.t >= 1) this.cameraTween = null;
    }
    const target = this.controls.target;
    const clampedX = THREE.MathUtils.clamp(target.x, -70, 112);
    const clampedZ = THREE.MathUtils.clamp(target.z, -30, 30);
    const shift = this.scratchB.set(clampedX - target.x, -target.y, clampedZ - target.z);
    target.add(shift);
    this.camera.position.add(shift);
    this.controls.update();
  }

  update(state, dt, labels) {
    this.time += dt;
    for (const [id, station] of Object.entries(this.stations)) {
      station.animate(dt, this.stationActivity(state, id));
      if (station.ring.visible) station.ring.material.opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
    }
    this.flag.rotation.y = Math.sin(this.time * 2.2) * 0.25;
    this.syncUnits(state, dt);
    this.updateWrecks(dt);
    this.updateEffects(dt);
    this.updateBelts(dt);
    this.updateStockpiles(state);
    this.updateAssembly(state);
    this.updateDepot(state, dt);
    this.updateCamera(dt);
    this.updateLabels(labels, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
