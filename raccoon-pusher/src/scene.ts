import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BACK_WALL_BOTTOM_Y,
  BACK_WALL_TOP_Y,
  BACK_WALL_Z,
  BOARD_HALF_WIDTH,
  BOMB_RADIUS,
  COIN_RADIUS,
  COIN_THICKNESS,
  DROP_HALF_RANGE,
  DROP_Y,
  DROP_Z,
  type Explosion,
  FRONT_EDGE_Z,
  GATE_Y,
  PUSHER_HALF_DEPTH,
  PUSHER_HEIGHT,
  type PusherMachine,
  SIDE_WALL_HEIGHT,
  SIDE_WALL_THICKNESS,
} from "./machine.ts";
import type { SlotReels } from "./slot.ts";
import { SlotScreen } from "./slot-screen.ts";

const MAX_COINS = 1_000;
const COIN_SEGMENTS = 32;
const CAMERA_FOV = 42;
const CAMERA_POSITION = new THREE.Vector3(0, 8.5, 9);
const CAMERA_TARGET = new THREE.Vector3(0, 0.2, -0.8);
const FLOOR_VISIBLE_BACK_Z = -5.4;
const FACE_TEXTURE_SIZE = 128;

// The slot screen sits on the back wall between the pusher and the gate.
const SCREEN_WIDTH = 3.6;
const SCREEN_HEIGHT = 1.35;
const SCREEN_CENTER_Y = 1.6;
const GATE_TUBE_RADIUS = 0.07;
/** The ring is drawn a bit wider than the hit zone, so a coin that counts looks clearly inside it. */
const GATE_RING_MARGIN = COIN_RADIUS * 0.9;
const EXPLOSION_SECONDS = 0.5;
const EXPLOSION_LIGHT_INTENSITY = 60;
const BOMB_TINT = new THREE.Color(1, 0.22, 0.18);
const COIN_TINT = new THREE.Color(1, 1, 1);
const GATE_GLOW = 1.2;
const GATE_FLASH_GLOW = 8;
const GATE_FLASH_DECAY_PER_SECOND = 4;

const COLORS = {
  background: 0x0b0714,
  gold: 0xf5c04a,
  goldEdge: 0xc98b2a,
  felt: 0x1f4a5a,
  pusher: 0xd9dde3,
  trim: 0xff3d8b,
  backWall: 0x2a1640,
  neonBlue: 0x39d7ff,
  neonPink: 0xff3d8b,
  glass: 0x9fe8ff,
};

/** Coin faces get a stamped ring and star so tumbling coins read as coins, not discs. */
function createCoinFaceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_TEXTURE_SIZE;
  canvas.height = FACE_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  const center = FACE_TEXTURE_SIZE / 2;
  context.fillStyle = "#f5c04a";
  context.fillRect(0, 0, FACE_TEXTURE_SIZE, FACE_TEXTURE_SIZE);
  context.strokeStyle = "#b07a22";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(center, center, center - 10, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#c98b2a";
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const radius = point % 2 === 0 ? 34 : 15;
    const angle = (point * Math.PI) / 5 - Math.PI / 2;
    context.lineTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
  }
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addBox(
  scene: THREE.Scene,
  size: [number, number, number],
  center: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

export class PusherScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  private readonly coinMesh: THREE.InstancedMesh;
  private readonly pusherMesh: THREE.Mesh;
  private readonly dropGuide: THREE.Mesh;
  private readonly gateRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private readonly slotScreen = new SlotScreen();
  private gateFlash = 0;
  private readonly sideWallMeshes: THREE.Mesh[] = [];
  private readonly bombTarget: THREE.Mesh;
  private readonly explosions: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight; ageSeconds: number }[] = [];
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PUSHER_HEIGHT);
  private readonly raycaster = new THREE.Raycaster();
  private readonly dropPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -DROP_Z);
  private readonly coinMatrix = new THREE.Matrix4();
  private readonly coinPosition = new THREE.Vector3();
  private readonly coinRotation = new THREE.Quaternion();
  private readonly coinScale = new THREE.Vector3(1, 1, 1);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(COLORS.background);
    const environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.6;
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    this.addLights();
    this.addCabinet();
    this.pusherMesh = addBox(
      this.scene,
      [BOARD_HALF_WIDTH * 2 - 0.1, PUSHER_HEIGHT, PUSHER_HALF_DEPTH * 2],
      [0, PUSHER_HEIGHT / 2, 0],
      new THREE.MeshStandardMaterial({ color: COLORS.pusher, metalness: 0.9, roughness: 0.25 }),
    );

    const faceMaterial = new THREE.MeshStandardMaterial({ map: createCoinFaceTexture(), metalness: 1, roughness: 0.3 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: COLORS.goldEdge, metalness: 1, roughness: 0.35 });
    // CylinderGeometry groups: side, top cap, bottom cap.
    this.coinMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, COIN_SEGMENTS),
      [edgeMaterial, faceMaterial, faceMaterial],
      MAX_COINS,
    );
    this.coinMesh.castShadow = true;
    this.coinMesh.receiveShadow = true;
    this.coinMesh.frustumCulled = false;
    this.scene.add(this.coinMesh);

    this.dropGuide = new THREE.Mesh(
      new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, COIN_SEGMENTS),
      new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.35 }),
    );
    this.dropGuide.position.set(0, DROP_Y, DROP_Z);
    this.scene.add(this.dropGuide);

    this.gateRing = new THREE.Mesh(
      // Unit radius; render() scales it to the gate's current hit zone.
      new THREE.TorusGeometry(1, GATE_TUBE_RADIUS, 12, 48),
      new THREE.MeshStandardMaterial({ color: COLORS.neonPink, emissive: COLORS.neonPink, emissiveIntensity: GATE_GLOW }),
    );
    // Lay the ring flat so coins fall through it.
    this.gateRing.rotation.x = Math.PI / 2;
    this.gateRing.position.set(0, GATE_Y, DROP_Z);
    this.scene.add(this.gateRing);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
      new THREE.MeshBasicMaterial({ map: this.slotScreen.texture, toneMapped: false }),
    );
    screen.position.set(0, SCREEN_CENTER_Y, BACK_WALL_Z + 0.11);
    this.scene.add(screen);

    this.bombTarget = new THREE.Mesh(
      new THREE.RingGeometry(BOMB_RADIUS - 0.08, BOMB_RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.neonPink, transparent: true, opacity: 0.7, toneMapped: false }),
    );
    this.bombTarget.rotation.x = -Math.PI / 2;
    this.bombTarget.visible = false;
    this.scene.add(this.bombTarget);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x2a1640, 0.6));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
    key.position.set(-4, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -8;
    shadowCamera.right = 8;
    shadowCamera.top = 8;
    shadowCamera.bottom = -8;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const pinkFill = new THREE.PointLight(COLORS.neonPink, 25, 18);
    pinkFill.position.set(-5, 3, 3);
    this.scene.add(pinkFill);
    const blueFill = new THREE.PointLight(COLORS.neonBlue, 25, 18);
    blueFill.position.set(5, 3, 3);
    this.scene.add(blueFill);
  }

  private addCabinet(): void {
    const floorDepth = FRONT_EDGE_Z - FLOOR_VISIBLE_BACK_Z;
    const felt = new THREE.MeshStandardMaterial({ color: COLORS.felt, roughness: 0.9 });
    addBox(this.scene, [BOARD_HALF_WIDTH * 2, 0.5, floorDepth], [0, -0.25, FLOOR_VISIBLE_BACK_Z + floorDepth / 2], felt);

    const trim = new THREE.MeshStandardMaterial({ color: COLORS.trim, emissive: COLORS.trim, emissiveIntensity: 1.5 });
    addBox(this.scene, [BOARD_HALF_WIDTH * 2, 0.06, 0.06], [0, 0.03, FRONT_EDGE_Z - 0.03], trim);

    const backWallHeight = BACK_WALL_TOP_Y - BACK_WALL_BOTTOM_Y;
    addBox(
      this.scene,
      [BOARD_HALF_WIDTH * 2 + 0.4, backWallHeight, 0.2],
      [0, BACK_WALL_BOTTOM_Y + backWallHeight / 2, BACK_WALL_Z],
      new THREE.MeshStandardMaterial({ color: COLORS.backWall, roughness: 0.6 }),
    );
    const neon = new THREE.MeshStandardMaterial({ color: COLORS.neonBlue, emissive: COLORS.neonBlue, emissiveIntensity: 2 });
    addBox(this.scene, [BOARD_HALF_WIDTH * 2, 0.08, 0.08], [0, BACK_WALL_TOP_Y - 0.3, BACK_WALL_Z + 0.12], neon);

    const glass = new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.12, roughness: 0.05 });
    // Walls are built 1 deep and stretched each frame to the length the Side Walls upgrade gives them.
    for (const side of [-1, 1]) {
      const wall = addBox(this.scene, [SIDE_WALL_THICKNESS, SIDE_WALL_HEIGHT, 1], [side * (BOARD_HALF_WIDTH + SIDE_WALL_THICKNESS / 2), SIDE_WALL_HEIGHT / 2, 0], glass);
      wall.castShadow = false;
      const strip = addBox(this.scene, [0.08, 0.08, 1], [side * (BOARD_HALF_WIDTH + SIDE_WALL_THICKNESS / 2), SIDE_WALL_HEIGHT, 0], neon);
      this.sideWallMeshes.push(wall, strip);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Maps a pointer position (normalized device coordinates) to a drop slot position from -1 to 1. */
  slotFromPointer(ndcX: number, ndcY: number): number {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.dropPlane, new THREE.Vector3());
    if (!hit) return 0;
    return Math.max(-1, Math.min(1, hit.x / DROP_HALF_RANGE));
  }

  showDropSlot(slotX: number): void {
    this.dropGuide.position.x = slotX * DROP_HALF_RANGE;
  }

  /** Where the pointer meets the top of the pile, or undefined off the board. */
  floorPointFromPointer(ndcX: number, ndcY: number): { x: number; z: number } | undefined {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
    if (!hit || Math.abs(hit.x) > BOARD_HALF_WIDTH || hit.z > FRONT_EDGE_Z || hit.z < BACK_WALL_Z) return undefined;
    return { x: hit.x, z: hit.z };
  }

  /** Shows the bomb's blast circle at a board point, or hides it. */
  showBombTarget(point: { x: number; z: number } | undefined): void {
    this.bombTarget.visible = point !== undefined;
    if (point) this.bombTarget.position.set(point.x, PUSHER_HEIGHT + 0.05, point.z);
  }

  addExplosion(explosion: Explosion): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.neonPink, transparent: true, opacity: 0.6, toneMapped: false }),
    );
    mesh.position.set(explosion.x, explosion.y, explosion.z);
    const light = new THREE.PointLight(0xffa040, EXPLOSION_LIGHT_INTENSITY, BOMB_RADIUS * 3);
    light.position.copy(mesh.position);
    this.scene.add(mesh, light);
    this.explosions.push({ mesh, light, ageSeconds: 0 });
  }

  private updateExplosions(frameSeconds: number): void {
    for (let index = this.explosions.length - 1; index >= 0; index--) {
      const explosion = this.explosions[index];
      explosion.ageSeconds += frameSeconds;
      const progress = explosion.ageSeconds / EXPLOSION_SECONDS;
      if (progress >= 1) {
        this.scene.remove(explosion.mesh, explosion.light);
        explosion.mesh.geometry.dispose();
        explosion.mesh.material.dispose();
        explosion.light.dispose();
        this.explosions.splice(index, 1);
        continue;
      }
      explosion.mesh.scale.setScalar(BOMB_RADIUS * progress);
      explosion.mesh.material.opacity = 0.6 * (1 - progress);
      explosion.light.intensity = EXPLOSION_LIGHT_INTENSITY * (1 - progress);
    }
  }

  private updateSideWalls(endZ: number): void {
    const depth = endZ - FLOOR_VISIBLE_BACK_Z;
    for (const mesh of this.sideWallMeshes) {
      mesh.scale.z = depth;
      mesh.position.z = FLOOR_VISIBLE_BACK_Z + depth / 2;
    }
  }

  flashGate(): void {
    this.gateFlash = 1;
  }

  showSlotWin(payout: number, timeSeconds: number): void {
    this.slotScreen.showWin(payout, timeSeconds);
  }

  render(machine: PusherMachine, slot: SlotReels, timeSeconds: number, frameSeconds: number): void {
    this.pusherMesh.position.z = machine.pusherZ;
    this.gateRing.position.x = machine.gateX;
    this.gateRing.scale.setScalar(machine.gateTolerance + GATE_RING_MARGIN);
    this.gateFlash = Math.max(0, this.gateFlash - GATE_FLASH_DECAY_PER_SECOND * frameSeconds);
    this.gateRing.material.emissiveIntensity = GATE_GLOW + this.gateFlash * (GATE_FLASH_GLOW - GATE_GLOW);
    this.updateSideWalls(machine.sideWallEndZ);
    this.updateExplosions(frameSeconds);
    this.slotScreen.draw(slot, timeSeconds);
    machine.coins.forEach((coin, index) => {
      const position = coin.translation();
      const rotation = coin.rotation();
      this.coinPosition.set(position.x, position.y, position.z);
      this.coinRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.coinMatrix.compose(this.coinPosition, this.coinRotation, this.coinScale);
      this.coinMesh.setMatrixAt(index, this.coinMatrix);
      this.coinMesh.setColorAt(index, machine.coinKind(coin) === "bomb" ? BOMB_TINT : COIN_TINT);
    });
    this.coinMesh.count = Math.min(machine.coins.length, MAX_COINS);
    this.coinMesh.instanceMatrix.needsUpdate = true;
    if (this.coinMesh.instanceColor) this.coinMesh.instanceColor.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
