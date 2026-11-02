import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BATTLE } from "./data.js";
import { Effects } from "./effects.js";
import { ASSEMBLY_PLATFORM, Factory, FLOOR_Y, RAIL_Z } from "./factory.js";
import { formatShort } from "./format.js";
import { charTank, createTankMesh, MODEL_SCALE, paintMaterial } from "./models.js";
import { block, mesh, seeded, SHARED } from "./scene-kit.js";
import { MODEL_BY_ID } from "./sim.js";

const SKY = 0xb7cad3;
const WRECK_SECONDS = 9;
const TRACER_SPEED = 110;
const GROUND_OFFSET_X = 40;
const GATE_OPEN_DISTANCE = 6;

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
const HALL_START = { x: ASSEMBLY_PLATFORM.x, z: ASSEMBLY_PLATFORM.z };
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
  const onPlatform = Math.abs(x - HALL_START.x) < 3.6 && Math.abs(z - HALL_START.z) < 2.3;
  if (onPlatform) return ASSEMBLY_PLATFORM.y;
  return x < 2 ? FLOOR_Y : 0;
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
  factory: { target: new THREE.Vector3(-37, 0, 1), offset: new THREE.Vector3(0, 46, 50) },
  front: { target: new THREE.Vector3(58, 0, 0), offset: new THREE.Vector3(0, 32, 40) },
  overview: { target: new THREE.Vector3(20, 0, 2), offset: new THREE.Vector3(0, 100, 92) },
};

const MATERIALS = {
  wood: paintMaterial(0x7a5a3a),
  sandbag: paintMaterial(0xb3a173),
  trunk: paintMaterial(0x5b4430),
  leaves: paintMaterial(0x47652f),
  leavesDark: paintMaterial(0x3a5527),
  rubble: paintMaterial(0x8d8577),
  crater: paintMaterial(0x6e5c40),
  hedgehog: paintMaterial(0x3b3a36),
  brickDark: paintMaterial(0x6d3828),
  roof: paintMaterial(0x5c5f5a),
};

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
    this.floaters = [];
    /** One entry per tank in state.depot: { modelId, object, slotIndex, route }. Overflow entries have no object. */
    this.depotViews = [];
    this.selectedStation = null;
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
    this.scratch = new THREE.Vector3();
    this.scratchB = new THREE.Vector3();

    this.effects = new Effects(this.scene);
    this.addLights();
    this.addGround();
    this.factory = new Factory(this.scene, this.effects);
    this.stationLabels = this.createStationLabels();
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
    // Shadowless sky bounce from behind the plant, so walls facing away from the sun keep their detail.
    const backFill = new THREE.DirectionalLight(0xcdd8e6, 0.8);
    backFill.position.set(20, 45, -70);
    backFill.target.position.set(-20, 0, 0);
    this.scene.add(backFill, backFill.target);
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
    for (let index = 0; index < 40; index += 1) {
      const z = (random() * 2 - 1) * 40;
      const x = -75 - random() * 30;
      const scale = 0.9 + random() * 0.6;
      if (Math.abs(z - RAIL_Z) > 3) plantTree(x, z, scale);
    }

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
    this.signalFlag = flag;
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

  createStationLabels() {
    const labels = {};
    for (const [id, station] of Object.entries(this.factory.stations)) {
      const label = document.createElement("button");
      label.type = "button";
      label.className = "station-label";
      label.dataset.station = id;
      this.labelLayer.append(label);
      labels[id] = { label, anchor: station.anchor, labelText: "" };
    }
    return labels;
  }

  tankNearGate() {
    const gateX = BATTLE.gateX - 1;
    for (const view of this.units.values()) {
      if (view.rollout && Math.abs(view.object.position.x - gateX) < GATE_OPEN_DISTANCE) return true;
    }
    return false;
  }

  pickStation(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.factory.pickTargets(), true)[0];
    return hit?.object.userData.stationId ?? null;
  }

  selectStation(id) {
    this.factory.selectStation(id);
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
    this.effects.add(bolt, life, (effect, dt, t) => {
      bolt.position.lerpVectors(start, end, t);
      if (effect.age + dt >= effect.life) {
        this.effects.flash(end, 0xffd27a, 0.45, 0.15);
        this.effects.puff(end, { color: 0x6b6258, size: 0.35, grow: 2, life: 0.9, rise: 1, opacity: 0.6 });
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
    this.effects.add(shell, 0.45, (effect, dt, t) => {
      shell.position.lerpVectors(start, end, t);
      if (effect.age + dt < effect.life) return;
      this.effects.explosion(end, 1.6);
      const scorch = new THREE.Mesh(SHARED.sphere, new THREE.MeshBasicMaterial({ color: 0x2a2620, transparent: true, opacity: 0.6, depthWrite: false }));
      scorch.scale.set(2.2, 0.02, 2.2);
      scorch.position.set(x, 0.05, z);
      this.effects.add(scorch, 6, (_, __, fade) => {
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
      if (event.type === "produced") this.factory.spawnBeltItems(event.station, event.count);
      else if (event.type === "shot") this.showShot(event);
      else if (event.type === "kill") this.showKill(event);
      else if (event.type === "built") this.onTankBuilt(event.model);
      else if (event.type === "deploy") this.onTankDeployed(event);
      else if (event.type === "artillery") this.artilleryShell(event.x, event.z);
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
    this.effects.flash(from, 0xffe7a0, 0.5 * (shooter.boss ? 2.5 : 1), 0.09);
    this.tracer(from, to, event.side);
    shooter.recoil = 1;
  }

  showKill(event) {
    const view = this.units.get(event.id);
    const position = new THREE.Vector3(event.x, 0, event.z);
    this.effects.explosion(position, event.boss ? 3 : 1.2);
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
    // Sprite centers are in screen space, so anchoring the fill by its center keeps it aligned with the
    // backing at any camera angle. A world-space x offset drifts off the bar when the view rotates.
    front.center.set(0.5, 0.5);
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
      const shown = Math.max(0.001, fraction);
      view.barFront.scale.x = view.barWidth * shown;
      view.barFront.center.x = 0.5 / shown;
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
        this.effects.puff(wreck.object.position.clone().setY(1.4), { color: 0x2e2b28, size: 0.6, grow: 2.4, life: 2.6, rise: 2, drift: 1.4, opacity: 0.5 });
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

  updateLabels(labels, dt) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const [id, station] of Object.entries(this.stationLabels)) {
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
    this.signalFlag.rotation.y = Math.sin(this.time * 2.2) * 0.25;
    this.factory.update(state, dt);
    this.syncUnits(state, dt);
    this.updateWrecks(dt);
    this.effects.update(dt);
    this.updateDepot(state, dt);
    this.factory.setGateOpen(this.tankNearGate(), dt);
    this.updateCamera(dt);
    this.updateLabels(labels, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
