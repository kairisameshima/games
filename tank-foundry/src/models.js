import * as THREE from "three";
import { contactShadow } from "./scene-kit.js";

export const MODEL_SCALE = 0.5;

const ENEMY_PAINT = 0x5d6268;
const ENEMY_BAND = 0xb23a2a;
const ALLY_MARK = 0xf1ecd8;

const materialCache = new Map();

export function paintMaterial(color, options = {}) {
  const key = `${color}|${options.emissive ?? 0}|${options.roughness ?? 0.85}`;
  if (!materialCache.has(key)) {
    materialCache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? 0.85,
        metalness: 0.05,
        flatShading: true,
        emissive: options.emissive ?? 0x000000,
      }),
    );
  }
  return materialCache.get(key);
}

const TRACK = paintMaterial(0x2b2a27);
const WHEEL = paintMaterial(0x3c3a33);
const HUB = paintMaterial(0x8a8470);
const GUNMETAL = paintMaterial(0x3a3d3a);
const TIRE = paintMaterial(0x1c1c1c);

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function box(group, w, h, d, material, x, y, z) {
  const item = mesh(new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z);
  group.add(item);
  return item;
}

/** Extrudes a side profile (x forward, y up) across the given width, centered on z. */
function profile(group, points, width, material, z = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  const item = mesh(geometry, material, 0, 0, z);
  group.add(item);
  return item;
}

function cylinderAlong(axis, radiusFront, radiusBack, length, segments, material) {
  const geometry = new THREE.CylinderGeometry(radiusFront, radiusBack, length, segments);
  if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  return mesh(geometry, material);
}

function stadium(length, height) {
  const radius = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2 + radius, 0);
  shape.lineTo(length / 2 - radius, 0);
  shape.absarc(length / 2 - radius, radius, radius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-length / 2 + radius, height);
  shape.absarc(-length / 2 + radius, radius, radius, Math.PI / 2, Math.PI * 1.5, false);
  return shape;
}

/**
 * Two track runs with road wheels showing on the outside faces.
 * wheels: x positions, or objects { x, r, inner } for interleaved rows.
 */
function tracks(parts, { length, width, trackWidth, trackHeight, wheelRadius, wheels, x = 0, lift = 0 }) {
  for (const side of [-1, 1]) {
    const geometry = new THREE.ExtrudeGeometry(stadium(length, trackHeight), { depth: trackWidth, bevelEnabled: false, curveSegments: 6 });
    geometry.translate(x, lift, -trackWidth / 2);
    const run = mesh(geometry, TRACK, 0, 0, side * (width / 2 - trackWidth / 2));
    parts.lower.add(run);
    for (const wheel of wheels) {
      const spec = typeof wheel === "number" ? { x: wheel } : wheel;
      const radius = spec.r ?? wheelRadius;
      const inset = spec.inner ? 0.06 : 0;
      const disc = cylinderAlong("z", radius, radius, 0.1, 12, WHEEL);
      disc.position.set(x + spec.x, lift + (spec.y ?? radius * 0.95), side * (width / 2 + 0.04 - inset));
      const hub = cylinderAlong("z", radius * 0.35, radius * 0.35, 0.14, 6, HUB);
      disc.add(hub);
      parts.lower.add(disc);
    }
  }
}

function wheelsSpread(count, from, to) {
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, index) => from + step * index);
}

function interleaved(count, from, to, radius) {
  return wheelsSpread(count, from, to).map((x, index) => ({ x, r: radius, inner: index % 2 === 1 }));
}

/** Gun barrel along +x starting at the mantlet; returns the barrel group so recoil can slide it. */
function gun(parts, { x, y, length, radius, brake = false, mantlet = null, twin = null }) {
  const barrel = new THREE.Group();
  barrel.name = "gun";
  barrel.position.set(x, y, 0);
  const tube = cylinderAlong("x", radius, radius * 1.25, length, 10, GUNMETAL);
  tube.position.x = length / 2;
  barrel.add(tube);
  if (brake) {
    const muzzle = cylinderAlong("x", radius * 1.9, radius * 1.9, radius * 4, 8, GUNMETAL);
    muzzle.position.x = length;
    barrel.add(muzzle);
  }
  if (twin) {
    const second = cylinderAlong("x", twin.radius, twin.radius, twin.length, 8, GUNMETAL);
    second.position.set(twin.length / 2, twin.y, twin.z);
    barrel.add(second);
  }
  barrel.userData.muzzleX = length + (brake ? radius * 2 : 0);
  parts.turret.add(barrel);
  if (mantlet) parts.turret.add(mantlet);
  parts.gun = barrel;
  return barrel;
}

/** White star on both turret sides; z is the turret half-width. */
function star(parts, x, y, z, size) {
  const shape = new THREE.Shape();
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2 + Math.PI / 2;
    const radius = index % 2 === 0 ? size : size * 0.4;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  for (const side of [1, -1]) {
    const decal = new THREE.Mesh(geometry, paintMaterial(ALLY_MARK, { roughness: 1 }));
    decal.position.set(x, y, z * side);
    decal.rotation.y = side > 0 ? 0 : Math.PI;
    parts.turret.add(decal);
  }
}

function band(parts, radius, y, height) {
  const ring = cylinderAlong("y", radius * 1.01, radius * 1.01, height, 16, paintMaterial(ENEMY_BAND));
  ring.position.y = y;
  parts.turret.add(ring);
}

function cupola(parts, x, y, z, radius = 0.28) {
  const top = cylinderAlong("y", radius, radius * 1.05, 0.26, 10, parts.paint);
  top.position.set(x, y + 0.13, z);
  parts.turret.add(top);
}

function newParts(paint) {
  const root = new THREE.Group();
  const lower = new THREE.Group();
  lower.name = "lower";
  const turret = new THREE.Group();
  turret.name = "turret";
  root.add(lower, turret);
  return { root, lower, turret, gun: null, paint: paintMaterial(paint), accent: paintMaterial(shade(paint, 0.82)) };
}

function shade(hex, factor) {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return color.getHex();
}

function stuart(parts, ally) {
  tracks(parts, { length: 4.4, width: 2.3, trackWidth: 0.42, trackHeight: 0.9, wheelRadius: 0.33, wheels: [-1.35, -0.55, 0.45, 1.25, { x: -1.85, r: 0.36, y: 0.5 }, { x: 1.9, r: 0.3, y: 0.55 }] });
  box(parts.lower, 3.9, 0.55, 1.5, parts.accent, 0, 0.45, 0);
  profile(parts.lower, [[-2.15, 1.0], [2.15, 1.0], [2.25, 1.15], [1.35, 1.6], [-2.1, 1.6]], 2.1, parts.paint);
  box(parts.lower, 0.5, 0.35, 0.4, parts.paint, 1.0, 1.55, 0.75);
  box(parts.lower, 0.5, 0.35, 0.4, parts.paint, 1.0, 1.55, -0.75);
  parts.turret.position.set(-0.25, 1.6, 0);
  const shell = cylinderAlong("y", 0.62, 0.72, 0.62, 8, parts.paint);
  shell.position.y = 0.31;
  parts.turret.add(shell);
  cupola(parts, -0.2, 0.62, 0.25, 0.22);
  gun(parts, { x: 0.6, y: 0.32, length: 1.35, radius: 0.05, mantlet: mesh(new THREE.BoxGeometry(0.3, 0.32, 0.5), parts.accent, 0.65, 0.32, 0) });
  if (ally) star(parts, 0, 0.32, 0.73, 0.2);
}

function t34(parts, ally) {
  tracks(parts, { length: 5.9, width: 3.0, trackWidth: 0.55, trackHeight: 1.0, wheelRadius: 0.42, wheels: wheelsSpread(5, -2.35, 2.25) });
  profile(parts.lower, [[-3.0, 0.45], [2.45, 0.45], [3.05, 0.95], [1.85, 1.65], [-2.65, 1.65], [-3.0, 1.25]], 2.2, parts.paint);
  box(parts.lower, 5.6, 0.07, 3.0, parts.accent, 0, 1.02, 0);
  parts.turret.position.set(0.75, 1.65, 0);
  const hex = cylinderAlong("y", 0.8, 0.98, 0.72, 6, parts.paint);
  hex.rotation.y = Math.PI / 6;
  hex.position.y = 0.36;
  parts.turret.add(hex);
  cupola(parts, -0.35, 0.72, 0.35, 0.22);
  cupola(parts, -0.35, 0.72, -0.35, 0.22);
  gun(parts, { x: 0.8, y: 0.36, length: 2.3, radius: 0.075, mantlet: mesh(new THREE.BoxGeometry(0.35, 0.42, 0.7), parts.accent, 0.88, 0.36, 0) });
  if (ally) star(parts, -0.1, 0.4, 0.9, 0.22);
}

function sherman(parts, ally) {
  const bogies = [-1.85, -1.25, -0.35, 0.25, 1.15, 1.75];
  tracks(parts, { length: 5.6, width: 2.65, trackWidth: 0.5, trackHeight: 0.95, wheelRadius: 0.3, wheels: [...bogies, { x: 2.5, r: 0.33, y: 0.6 }] });
  for (const center of [-1.55, 0.95, -0.05]) {
    box(parts.lower, 0.85, 0.32, 0.12, parts.accent, center, 0.2, 1.38);
    box(parts.lower, 0.85, 0.32, 0.12, parts.accent, center, 0.2, -1.38);
  }
  profile(parts.lower, [[-2.9, 0.55], [2.35, 0.55], [2.95, 1.0], [2.95, 1.2], [1.15, 2.05], [-2.85, 2.05], [-2.95, 1.6]], 2.55, parts.paint);
  parts.turret.position.set(0.05, 2.05, 0);
  const dome = mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), parts.paint);
  dome.scale.set(1.05, 0.72, 0.92);
  parts.turret.add(dome);
  box(parts.turret, 0.9, 0.2, 0.7, parts.paint, -0.9, 0.05, 0);
  cupola(parts, -0.3, 0.62, -0.3, 0.26);
  gun(parts, { x: 0.95, y: 0.38, length: 1.95, radius: 0.075, mantlet: mesh(new THREE.BoxGeometry(0.35, 0.5, 0.8), parts.accent, 0.95, 0.38, 0) });
  if (ally) star(parts, 0, 0.35, 0.93, 0.25);
}

function panther(parts, ally) {
  tracks(parts, { length: 6.4, width: 3.3, trackWidth: 0.62, trackHeight: 1.05, wheelRadius: 0.45, wheels: interleaved(8, -2.6, 2.45, 0.45) });
  profile(parts.lower, [[-3.4, 0.5], [2.55, 0.5], [3.45, 1.15], [1.75, 1.95], [-3.2, 1.95], [-3.45, 1.45]], 2.3, parts.paint);
  box(parts.lower, 5.3, 0.6, 0.06, parts.accent, -0.3, 1.05, 1.68);
  box(parts.lower, 5.3, 0.6, 0.06, parts.accent, -0.3, 1.05, -1.68);
  box(parts.lower, 5.6, 0.2, 3.35, parts.paint, -0.4, 1.75, 0);
  parts.turret.position.set(-0.25, 1.95, 0);
  const shell = cylinderAlong("y", 0.95, 1.3, 0.95, 4, parts.paint);
  shell.rotation.y = Math.PI / 4;
  shell.scale.set(1.25, 1, 0.85);
  shell.position.y = 0.47;
  parts.turret.add(shell);
  cupola(parts, -0.7, 0.95, 0.55, 0.26);
  gun(parts, { x: 1.15, y: 0.45, length: 4.2, radius: 0.075, brake: true, mantlet: mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.85, 10).rotateX(Math.PI / 2), parts.accent, 1.2, 0.45, 0) });
  if (ally) star(parts, -0.2, 0.5, 0.98, 0.25);
}

function tiger(parts, ally) {
  tracks(parts, { length: 6.0, width: 3.6, trackWidth: 0.72, trackHeight: 1.05, wheelRadius: 0.42, wheels: interleaved(8, -2.35, 2.35, 0.42) });
  profile(parts.lower, [[-3.15, 0.45], [2.85, 0.45], [3.15, 0.95], [3.15, 1.3], [2.75, 1.85], [-3.1, 1.85], [-3.15, 1.0]], 3.6, parts.paint);
  parts.turret.position.set(-0.2, 1.85, 0);
  const shell = cylinderAlong("y", 1.15, 1.18, 0.95, 16, parts.paint);
  shell.scale.set(1.08, 1, 0.92);
  shell.position.y = 0.47;
  parts.turret.add(shell);
  box(parts.turret, 0.6, 0.12, 0.9, parts.accent, -1.15, 0.6, 0);
  cupola(parts, -0.6, 0.95, -0.55, 0.3);
  gun(parts, { x: 1.2, y: 0.5, length: 4.0, radius: 0.09, brake: true, mantlet: mesh(new THREE.BoxGeometry(0.45, 0.8, 1.35), parts.accent, 1.2, 0.5, 0) });
  if (ally) star(parts, 0, 0.5, 1.07, 0.28);
}

function is2(parts, ally) {
  tracks(parts, { length: 6.4, width: 3.1, trackWidth: 0.62, trackHeight: 0.95, wheelRadius: 0.38, wheels: wheelsSpread(6, -2.45, 2.35) });
  profile(parts.lower, [[-3.35, 0.45], [2.85, 0.45], [3.4, 0.95], [2.25, 1.7], [-3.35, 1.7]], 2.5, parts.paint);
  box(parts.lower, 6.3, 0.07, 3.1, parts.accent, -0.1, 0.98, 0);
  parts.turret.position.set(0.35, 1.7, 0);
  const dome = mesh(new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), parts.paint);
  dome.scale.set(1.1, 0.66, 0.95);
  parts.turret.add(dome);
  cupola(parts, -0.45, 0.66, -0.45, 0.28);
  const muzzle = gun(parts, { x: 1.05, y: 0.38, length: 4.1, radius: 0.1, mantlet: mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10).rotateX(Math.PI / 2), parts.accent, 1.05, 0.38, 0) });
  const brake = mesh(new THREE.BoxGeometry(0.4, 0.22, 0.55), GUNMETAL, 4.1, 0, 0);
  muzzle.add(brake);
  if (ally) star(parts, -0.1, 0.32, 1.05, 0.26);
}

function kingTiger(parts, ally) {
  tracks(parts, { length: 6.9, width: 3.75, trackWidth: 0.8, trackHeight: 1.1, wheelRadius: 0.44, wheels: interleaved(9, -2.8, 2.7, 0.44) });
  profile(parts.lower, [[-3.6, 0.5], [2.7, 0.5], [3.7, 1.25], [1.85, 2.05], [-3.45, 2.05], [-3.7, 1.5]], 2.5, parts.paint);
  box(parts.lower, 6.4, 0.22, 3.75, parts.paint, -0.35, 1.85, 0);
  parts.turret.position.set(-0.35, 2.05, 0);
  profile(parts.turret, [[-2.0, 0], [1.4, 0], [1.65, 0.35], [1.35, 1.0], [-1.9, 1.0]], 2.4, parts.paint);
  cupola(parts, -0.8, 1.0, 0.55, 0.3);
  gun(parts, { x: 1.6, y: 0.55, length: 5.0, radius: 0.085, brake: true, mantlet: mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.7, 10).rotateZ(Math.PI / 2), parts.accent, 1.68, 0.55, 0) });
  if (ally) star(parts, -0.3, 0.5, 1.21, 0.3);
}

function maus(parts, ally) {
  tracks(parts, { length: 9.0, width: 3.75, trackWidth: 1.05, trackHeight: 1.2, wheelRadius: 0.32, wheels: wheelsSpread(12, -3.9, 3.9) });
  box(parts.lower, 8.4, 0.9, 0.08, parts.accent, 0, 0.6, 1.9);
  box(parts.lower, 8.4, 0.9, 0.08, parts.accent, 0, 0.6, -1.9);
  profile(parts.lower, [[-5.0, 0.5], [4.3, 0.5], [5.1, 1.3], [4.1, 2.3], [-4.9, 2.3], [-5.05, 1.4]], 3.7, parts.paint);
  parts.turret.position.set(-1.2, 2.3, 0);
  box(parts.turret, 3.2, 1.35, 3.1, parts.paint, -0.5, 0, 0);
  const nose = cylinderAlong("y", 1.55, 1.55, 1.35, 14, parts.paint);
  nose.scale.z = 1;
  nose.position.set(1.05, 0.675, 0);
  parts.turret.add(nose);
  cupola(parts, -1.2, 1.35, 0.8, 0.32);
  gun(parts, { x: 2.4, y: 0.7, length: 5.2, radius: 0.13, mantlet: null, twin: { length: 2.0, radius: 0.07, y: 0, z: 0.45 } });
  if (ally) star(parts, -0.5, 0.65, 1.58, 0.42);
}

function armoredCar(parts) {
  for (const x of [-1.45, 1.45]) {
    for (const side of [-1, 1]) {
      const tire = cylinderAlong("z", 0.45, 0.45, 0.35, 12, TIRE);
      tire.position.set(x, 0.45, side * 0.85);
      const hub = cylinderAlong("z", 0.2, 0.2, 0.4, 6, HUB);
      tire.add(hub);
      parts.lower.add(tire);
    }
  }
  profile(parts.lower, [[-2.35, 0.55], [2.35, 0.55], [2.4, 0.9], [1.4, 1.35], [-1.75, 1.35], [-2.35, 0.95]], 1.6, parts.paint);
  parts.turret.position.set(-0.15, 1.35, 0);
  const ring = cylinderAlong("y", 0.75, 0.6, 0.42, 10, parts.paint);
  ring.position.y = 0.21;
  parts.turret.add(ring);
  gun(parts, { x: 0.4, y: 0.25, length: 1.2, radius: 0.045 });
  band(parts, 0.68, 0.2, 0.1);
}

function lightTank(parts) {
  tracks(parts, { length: 4.6, width: 2.25, trackWidth: 0.4, trackHeight: 0.75, wheelRadius: 0.32, wheels: wheelsSpread(5, -1.65, 1.65) });
  profile(parts.lower, [[-2.4, 0.45], [2.15, 0.45], [2.45, 0.85], [2.3, 1.1], [-2.4, 1.2]], 2.1, parts.paint);
  box(parts.lower, 2.6, 0.32, 1.9, parts.paint, -0.2, 1.1, 0);
  parts.turret.position.set(0.2, 1.42, 0.15);
  const shell = cylinderAlong("y", 0.55, 0.62, 0.5, 6, parts.paint);
  shell.position.y = 0.25;
  parts.turret.add(shell);
  gun(parts, { x: 0.55, y: 0.25, length: 1.1, radius: 0.045 });
  band(parts, 0.58, 0.2, 0.1);
}

function mediumTank(parts) {
  tracks(parts, { length: 5.5, width: 2.9, trackWidth: 0.45, trackHeight: 0.85, wheelRadius: 0.27, wheels: wheelsSpread(8, -2.0, 2.0) });
  profile(parts.lower, [[-2.9, 0.45], [2.55, 0.45], [2.85, 0.8], [2.85, 1.25], [2.4, 1.4], [-2.85, 1.45], [-2.95, 0.9]], 2.85, parts.paint);
  box(parts.lower, 5.0, 0.55, 0.05, parts.accent, -0.2, 0.75, 1.5);
  box(parts.lower, 5.0, 0.55, 0.05, parts.accent, -0.2, 0.75, -1.5);
  parts.turret.position.set(-0.1, 1.45, 0.1);
  const shell = cylinderAlong("y", 0.72, 0.95, 0.75, 4, parts.paint);
  shell.rotation.y = Math.PI / 4;
  shell.scale.set(1.3, 1, 0.95);
  shell.position.y = 0.37;
  parts.turret.add(shell);
  box(parts.turret, 2.0, 0.5, 0.05, parts.accent, -0.2, 0.15, 1.05);
  box(parts.turret, 2.0, 0.5, 0.05, parts.accent, -0.2, 0.15, -1.05);
  gun(parts, { x: 0.95, y: 0.4, length: 3.0, radius: 0.065, brake: true });
  band(parts, 0.9, 0.35, 0.12);
}

function tankDestroyer(parts) {
  tracks(parts, { length: 5.3, width: 2.9, trackWidth: 0.45, trackHeight: 0.8, wheelRadius: 0.3, wheels: wheelsSpread(6, -1.95, 1.95) });
  profile(parts.lower, [[-2.8, 0.45], [2.55, 0.45], [2.85, 0.85], [2.6, 1.15], [-2.8, 1.15]], 2.85, parts.paint);
  parts.turret.position.set(0.2, 1.15, 0);
  parts.turret.userData.fixed = true;
  profile(parts.turret, [[-2.2, 0], [1.5, 0], [0.85, 0.8], [-2.0, 0.8]], 2.3, parts.paint);
  const saukopf = mesh(new THREE.SphereGeometry(0.42, 10, 8), parts.accent, 1.1, 0.4, 0);
  saukopf.scale.set(1.2, 0.85, 0.85);
  gun(parts, { x: 1.2, y: 0.4, length: 3.0, radius: 0.07, brake: true, mantlet: saukopf });
  const stripe = mesh(new THREE.BoxGeometry(0.25, 0.81, 2.32), paintMaterial(ENEMY_BAND), -1.2, 0.4, 0);
  parts.turret.add(stripe);
}

function heavyTank(parts) {
  tiger(parts, false);
  band(parts, 1.17, 0.45, 0.14);
}

function landship(parts) {
  for (const offset of [-1, 0, 1]) {
    const runs = { length: 13, width: 9.5, trackWidth: 1.3, trackHeight: 2.2, wheelRadius: 0.75, wheels: wheelsSpread(9, -5.6, 5.6) };
    if (offset !== 0) {
      const group = new THREE.Group();
      group.position.z = offset * 1.45;
      const inner = { lower: group };
      tracks(inner, { ...runs, width: 9.5 - 2.9 * Math.abs(offset) });
      parts.lower.add(group);
    } else {
      tracks(parts, runs);
    }
  }
  profile(parts.lower, [[-7.0, 1.2], [6.3, 1.2], [7.4, 2.6], [6.0, 4.2], [-6.8, 4.2], [-7.2, 2.4]], 9.0, parts.paint);
  box(parts.lower, 2.0, 2.4, 2.4, parts.accent, -4.2, 4.2, 0);
  box(parts.lower, 1.2, 0.8, 1.4, parts.accent, -4.2, 6.6, 0);
  parts.turret.position.set(0.8, 4.2, 0);
  const shell = cylinderAlong("y", 2.6, 3.0, 2.0, 8, parts.paint);
  shell.scale.set(1.2, 1, 1);
  shell.position.y = 1.0;
  parts.turret.add(shell);
  gun(parts, { x: 2.8, y: 1.05, length: 7.5, radius: 0.28, twin: { length: 7.5, radius: 0.28, y: 0, z: 1.3 } });
  parts.gun.position.z = -0.65;
  band(parts, 3.02, 1.2, 0.35);
}

const BUILDERS = {
  stuart,
  t34,
  sherman,
  panther,
  tiger,
  is2,
  kingtiger: kingTiger,
  maus,
  armoredCar,
  lightTank,
  mediumTank,
  tankDestroyer,
  heavyTank,
  landship,
};

const templateCache = new Map();

function buildTemplate(kind, side, paint) {
  const parts = newParts(side === "ally" ? paint : ENEMY_PAINT);
  BUILDERS[kind](parts, side === "ally");
  const bounds = new THREE.Box3().setFromObject(parts.root);
  const size = bounds.getSize(new THREE.Vector3());
  const shadow = contactShadow(size.x * 1.3, size.z * 1.35, 0.5);
  shadow.position.x = (bounds.min.x + bounds.max.x) / 2;
  parts.root.add(shadow);
  parts.root.scale.setScalar(MODEL_SCALE);
  return parts.root;
}

/**
 * Returns a fresh instance that shares geometry and materials with a cached template.
 * userData: turret, gun, wheels, fixedTurret.
 */
export function createTankMesh(kind, side, paint = 0x6b7340) {
  const key = `${kind}|${side}`;
  if (!templateCache.has(key)) templateCache.set(key, buildTemplate(kind, side, paint));
  const instance = templateCache.get(key).clone(true);
  const turret = instance.getObjectByName("turret");
  const wheels = [];
  instance.getObjectByName("lower").traverse((child) => {
    if (child.isMesh && child.geometry.type === "CylinderGeometry" && child.material === WHEEL) wheels.push(child);
    if (child.isMesh && child.material === TIRE) wheels.push(child);
  });
  instance.userData = {
    turret,
    gun: instance.getObjectByName("gun"),
    wheels,
    fixedTurret: Boolean(turret.userData.fixed),
    lower: instance.getObjectByName("lower"),
  };
  return instance;
}

export const CHARRED = paintMaterial(0x26231f, { roughness: 1 });

export function charTank(object) {
  object.traverse((child) => {
    if (child.isMesh && !child.userData.contactShadow) child.material = CHARRED;
  });
}
