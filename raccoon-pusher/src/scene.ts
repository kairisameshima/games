import * as THREE from "three";
import { PixelPass } from "./pixel-pass.ts";
import {
  createCoinFaceTexture,
  createFeltTexture,
  createSteelTexture,
  createToonGradient,
  createWallTexture,
  tiled,
} from "./pixel-textures.ts";
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
import { type PusherArt, RACCOON_FRAMES } from "./art.ts";
import { SlotScreen } from "./slot-screen.ts";
import { buildVoxelFrames } from "./voxel-sprite.ts";

const MAX_COINS = 1_000;
/** Low-poly is enough: at pixel-art resolution a 16-sided coin reads as round. */
const COIN_SEGMENTS = 16;
const CAMERA_FOV = 42;
// The camera sits a little left of center so the raccoon has room beside the machine's left corner.
const CAMERA_POSITION = new THREE.Vector3(-0.9, 8.5, 9);
const CAMERA_TARGET = new THREE.Vector3(-0.9, 0.2, -0.8);
const FLOOR_VISIBLE_BACK_Z = -5.4;
/** CSS pixels per art pixel. */
const ART_PIXEL_SIZE = 4;

// The slot screen sits on the back wall between the pusher and the gate.
const SCREEN_WIDTH = 3.6;
const SCREEN_HEIGHT = 1.35;
const SCREEN_CENTER_Y = 1.6;
const GATE_TUBE_RADIUS = 0.07;
/** The ring is drawn a bit wider than the hit zone, so a coin that counts looks clearly inside it. */
const GATE_RING_MARGIN = COIN_RADIUS * 0.9;
const EXPLOSION_SECONDS = 0.5;
/** The raccoon stands on the floor-level ledge beside the board's front-left corner, turned toward the board. */
const RACCOON_POSITION = new THREE.Vector3(-(BOARD_HALF_WIDTH + 0.9), 0, FRONT_EDGE_Z - 0.8);
const RACCOON_YAW = 0.15;
/** The camera looks down steeply; leaning back keeps the raccoon's face toward it instead of its head top. */
const RACCOON_LEAN_BACK = 0.55;
/** One sprite pixel becomes a block this wide, close to one art pixel on screen at the raccoon's distance. */
const RACCOON_VOXEL_SIZE = 0.07;
/** Shadow, mid and lit bands for the cabinet and coins. */
const SCENE_TOON_BANDS = [70, 160, 255];
/** The raccoon's front face must show its pixel art at full colour; only faces turned away get shaded. */
const RACCOON_TOON_BANDS = [150, 255];
const RACCOON_DEPTH_PIXELS = 4;
const RACCOON_IDLE_FPS = 1.5;
const RACCOON_CHEER_FPS = 6;
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
  trim: 0xff3d8b,
  neonBlue: 0x39d7ff,
  neonPink: 0xff3d8b,
  glass: 0x9fe8ff,
};

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
  private readonly pixelPass = new PixelPass();
  private readonly toonGradient = createToonGradient(SCENE_TOON_BANDS);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  private readonly coinMesh: THREE.InstancedMesh;
  private readonly pusherMesh: THREE.Mesh;
  private readonly dropGuide: THREE.Mesh;
  private readonly gateRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshToonMaterial>;
  private readonly slotScreen: SlotScreen;
  private readonly raccoonFrames: THREE.InstancedMesh[];
  private cheerUntilSeconds = -Infinity;
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

  constructor(canvas: HTMLCanvasElement, art: PusherArt) {
    this.slotScreen = new SlotScreen(art.reels);
    // No antialiasing and hard shadows: every edge should land on a whole art pixel.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    this.scene.background = new THREE.Color(COLORS.background);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    const raccoonMaterial = new THREE.MeshToonMaterial({ gradientMap: createToonGradient(RACCOON_TOON_BANDS) });
    this.raccoonFrames = buildVoxelFrames(art.raccoon, RACCOON_VOXEL_SIZE, RACCOON_DEPTH_PIXELS, raccoonMaterial);
    const raccoon = new THREE.Group();
    raccoon.position.copy(RACCOON_POSITION);
    raccoon.rotation.set(-RACCOON_LEAN_BACK, RACCOON_YAW, 0, "YXZ");
    raccoon.add(...this.raccoonFrames);
    this.scene.add(raccoon);

    this.addLights();
    this.addCabinet();
    const pusherWidth = BOARD_HALF_WIDTH * 2 - 0.1;
    this.pusherMesh = addBox(
      this.scene,
      [pusherWidth, PUSHER_HEIGHT, PUSHER_HALF_DEPTH * 2],
      [0, PUSHER_HEIGHT / 2, 0],
      this.toon({ color: 0xffffff, map: tiled(createSteelTexture(), pusherWidth, PUSHER_HEIGHT) }),
    );

    const faceMaterial = this.toon({ color: 0xffffff, map: createCoinFaceTexture() });
    const edgeMaterial = this.toon({ color: COLORS.goldEdge });
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
      this.toon({ color: COLORS.neonPink, emissive: COLORS.neonPink, emissiveIntensity: GATE_GLOW }),
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

  private toon(parameters: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ gradientMap: this.toonGradient, ...parameters });
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x2a1640, 0.6));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
    key.position.set(-4, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -8;
    shadowCamera.right = 8;
    shadowCamera.top = 8;
    shadowCamera.bottom = -8;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    // Toon shading turns strong coloured fills into hard tinted bands, so the neon fills stay faint.
    const pinkFill = new THREE.PointLight(COLORS.neonPink, 8, 18);
    // Behind the raccoon, so it rims the machine's left side without tinting the raccoon pink.
    pinkFill.position.set(-5, 3, -3);
    this.scene.add(pinkFill);
    const blueFill = new THREE.PointLight(COLORS.neonBlue, 8, 18);
    blueFill.position.set(5, 3, 3);
    this.scene.add(blueFill);
  }

  private addCabinet(): void {
    const floorWidth = BOARD_HALF_WIDTH * 2;
    const floorDepth = FRONT_EDGE_Z - FLOOR_VISIBLE_BACK_Z;
    const felt = this.toon({ color: 0xffffff, map: tiled(createFeltTexture(), floorWidth, floorDepth) });
    addBox(this.scene, [floorWidth, 0.5, floorDepth], [0, -0.25, FLOOR_VISIBLE_BACK_Z + floorDepth / 2], felt);

    const trim = this.toon({ color: COLORS.trim, emissive: COLORS.trim, emissiveIntensity: 1.5 });
    addBox(this.scene, [floorWidth, 0.06, 0.06], [0, 0.03, FRONT_EDGE_Z - 0.03], trim);

    const backWallWidth = floorWidth + 0.4;
    const backWallHeight = BACK_WALL_TOP_Y - BACK_WALL_BOTTOM_Y;
    addBox(
      this.scene,
      [backWallWidth, backWallHeight, 0.2],
      [0, BACK_WALL_BOTTOM_Y + backWallHeight / 2, BACK_WALL_Z],
      this.toon({ color: 0xffffff, map: tiled(createWallTexture(), backWallWidth, backWallHeight) }),
    );
    const neon = this.toon({ color: COLORS.neonBlue, emissive: COLORS.neonBlue, emissiveIntensity: 2 });
    addBox(this.scene, [floorWidth, 0.08, 0.08], [0, BACK_WALL_TOP_Y - 0.3, BACK_WALL_Z + 0.12], neon);

    const glass = new THREE.MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.06, depthWrite: false });
    // Walls are built 1 deep and stretched each frame to the length the Side Walls upgrade gives them.
    for (const side of [-1, 1]) {
      const wall = addBox(this.scene, [SIDE_WALL_THICKNESS, SIDE_WALL_HEIGHT, 1], [side * (BOARD_HALF_WIDTH + SIDE_WALL_THICKNESS / 2), SIDE_WALL_HEIGHT / 2, 0], glass);
      wall.castShadow = false;
      const strip = addBox(this.scene, [0.08, 0.08, 1], [side * (BOARD_HALF_WIDTH + SIDE_WALL_THICKNESS / 2), SIDE_WALL_HEIGHT, 0], neon);
      strip.castShadow = false;
      this.sideWallMeshes.push(wall, strip);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    const devicePixelRatio = this.renderer.getPixelRatio();
    const pixelSize = Math.max(1, Math.round(ART_PIXEL_SIZE * devicePixelRatio));
    this.camera.aspect = this.pixelPass.setSize(Math.round(width * devicePixelRatio), Math.round(height * devicePixelRatio), pixelSize);
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
    this.cheer(timeSeconds, 2.5);
  }

  /** The raccoon cheers for `seconds`, for slot wins and bomb blasts. */
  cheer(timeSeconds: number, seconds: number): void {
    this.cheerUntilSeconds = Math.max(this.cheerUntilSeconds, timeSeconds + seconds);
  }

  private updateRaccoon(timeSeconds: number): void {
    const cheering = timeSeconds < this.cheerUntilSeconds;
    const frames = cheering ? RACCOON_FRAMES.cheer : RACCOON_FRAMES.idle;
    const fps = cheering ? RACCOON_CHEER_FPS : RACCOON_IDLE_FPS;
    const shown = frames[Math.floor(timeSeconds * fps) % frames.length];
    this.raccoonFrames.forEach((mesh, frame) => (mesh.visible = frame === shown));
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
    this.updateRaccoon(timeSeconds);
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
    this.pixelPass.render(this.renderer, this.scene, this.camera);
  }
}
