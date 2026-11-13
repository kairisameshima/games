import { MONSTER_KINDS, type MonsterKindId } from "../data/bestiary.ts";
import type { Floor } from "../gen/floor.ts";
import { isWalkable, toIndex, type Point } from "../gen/grid.ts";
import { mixSeed } from "../rng.ts";
import { currentTile } from "../sim/movement.ts";
import type { FloorState, GameState, Mover, Nest } from "../sim/types.ts";
import { frontDepth, isInDungeon } from "../sim/world.ts";
import { clampCenter, easeToward, frameTargets, type Framing } from "./camera.ts";
import {
  buildChickenSprites,
  buildDenSiteSprite,
  buildFeatherPileSprite,
  buildGoldPileSprite,
  buildMonsterSprites,
  buildNestSprite,
  contextOf,
  SPRITE_SIZE,
  type FacingSprites,
} from "./sprites.ts";

interface Combatant extends Mover {
  readonly id: number;
  hp: number;
  maxHp: number;
}

const CAMERA_EASE_RATE = 4;
// Close enough that easing would only shimmer: snap to the target so the scale lands on a whole number.
const SCALE_SNAP = 0.01;
const TILE_SIZE = SPRITE_SIZE;
const WALL_SHADOW_ROWS = 3;
const SPECKLES_PER_TILE = 3;

// Root Cellar palette from the bible: brown, root beige, lantern amber.
const ROOT_CELLAR = {
  void: "#0b0806",
  wallFace: "#8a7458",
  wallShadow: "#5e4c37",
  floor: "#5a4632",
  speckleLight: "#66513a",
  speckleDark: "#4e3c2a",
  lanternAmber: "#d9a441",
  stairwell: "#0d0907",
};
const REMEMBERED_SHADE = "rgba(5, 3, 2, 0.6)";
const HEALTH_BAR = { width: 12, height: 2, inset: 2, background: "#1a120c", chicken: "#7fd35a", monster: "#e2533a", nest: "#d9b25a" };
// Eggs sit in a row inside the nest sprite's straw ring, one pixel apart.
const NEST_EGG = { firstX: 5, y: 11, width: 1, height: 2, color: "#f4ecd8" };
const BANDANA_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#fabed4",
  "#469990",
  "#dcbeff",
];

export class DungeonRenderer {
  private readonly context: CanvasRenderingContext2D;
  // Keyed by the Floor object, so a new run or a loaded save never reuses another seed's paint.
  private readonly tileLayers = new WeakMap<Floor, HTMLCanvasElement>();
  private readonly chickenSpritesByBandana = new Map<string, FacingSprites>();
  private readonly monsterSprites: Readonly<Record<MonsterKindId, FacingSprites>>;
  private readonly goldPileSprite: HTMLCanvasElement;
  private readonly featherPileSprite: HTMLCanvasElement;
  private readonly nestSprite: HTMLCanvasElement;
  private readonly denSiteSprite: HTMLCanvasElement;
  // Chickens and monsters have separate id spaces, so each keeps its own facing memory.
  private readonly chickenFacingLeft = new Map<number, boolean>();
  private readonly monsterFacingLeft = new Map<number, boolean>();

  private readonly canvas: HTMLCanvasElement;
  private framing: Framing | null = null;
  private framedFloor: Floor | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = contextOf(canvas);
    this.monsterSprites = {
      cellarRat: buildMonsterSprites("cellarRat"),
      cellarSpider: buildMonsterSprites("cellarSpider"),
      monsterDen: buildMonsterSprites("monsterDen"),
    };
    this.goldPileSprite = buildGoldPileSprite();
    this.featherPileSprite = buildFeatherPileSprite();
    this.nestSprite = buildNestSprite();
    this.denSiteSprite = buildDenSiteSprite();
  }

  /** Sizes the backing store in device pixels. Resizing a canvas resets its context, so smoothing is turned off again. */
  resize(pixelWidth: number, pixelHeight: number): void {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.context.imageSmoothingEnabled = false;
  }

  /**
   * Frames every chicken on the busiest floor, easing toward the new framing.
   * `interpolation` is how far real time has moved past the last tick, from 0 to 1.
   */
  draw(state: GameState, interpolation: number, deltaSeconds: number): void {
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = ROOT_CELLAR.void;
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const depth = frontDepth(state);
    const floorState = depth === null ? undefined : state.floors.get(depth);
    if (!floorState) return;
    const { floor, lastSeenTick } = floorState;

    const framed = state.chickens.filter((chicken) => isInDungeon(chicken) && chicken.depth === depth);
    const centers = framed.map((chicken) => ({
      x: interpolate(chicken.previousX, chicken.x, interpolation) * TILE_SIZE + TILE_SIZE / 2,
      y: interpolate(chicken.previousY, chicken.y, interpolation) * TILE_SIZE + TILE_SIZE / 2,
    }));
    const framing = this.easeFraming(frameTargets(centers, this.canvas.width, this.canvas.height), floor, deltaSeconds);
    const { scale } = framing;
    const floorPixels = floor.side * TILE_SIZE;
    const viewWidth = this.canvas.width / scale;
    const viewHeight = this.canvas.height / scale;
    // Round the view's corner to a whole device pixel so art pixels do not shimmer as the camera glides.
    const left = Math.round((clampCenter(framing.centerX, viewWidth, floorPixels) - viewWidth / 2) * scale) / scale;
    const top = Math.round((clampCenter(framing.centerY, viewHeight, floorPixels) - viewHeight / 2) * scale) / scale;
    context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);

    context.drawImage(this.tileLayerFor(floor), 0, 0);
    const isExplored = (point: Point) => lastSeenTick[toIndex(floor.side, point)] >= 0;
    for (const site of floorState.denSites) {
      if (isExplored(site)) context.drawImage(this.denSiteSprite, site.x * TILE_SIZE, site.y * TILE_SIZE);
    }
    for (const nest of floorState.nests) {
      if (isExplored(nest)) this.drawNest(nest);
    }
    for (const pile of floorState.lootPiles) {
      if (!isExplored(pile)) continue;
      context.drawImage(pile.isFeatherPile ? this.featherPileSprite : this.goldPileSprite, pile.x * TILE_SIZE, pile.y * TILE_SIZE);
    }
    for (const monster of floorState.monsters) {
      // Dens never move, so a den once seen stays on the map. Mobile monsters show only while in sight.
      const isDen = MONSTER_KINDS[monster.kind].spawner !== null;
      const shown = isDen ? isExplored(monster) : lastSeenTick[toIndex(floor.side, currentTile(monster))] === state.tick;
      if (shown) this.drawCombatant(monster, this.monsterSprites[monster.kind], this.monsterFacingLeft, HEALTH_BAR.monster, interpolation);
    }
    for (const chicken of framed) {
      const sprites = this.chickenSpritesFor(BANDANA_COLORS[chicken.id % BANDANA_COLORS.length]);
      this.drawCombatant(chicken, sprites, this.chickenFacingLeft, HEALTH_BAR.chicken, interpolation);
    }
    this.drawFog(floorState, state.tick, left, top, viewWidth, viewHeight);
  }

  /** Snaps on the first frame and on floor changes, otherwise glides toward the target framing. */
  private easeFraming(target: Framing, floor: Floor, deltaSeconds: number): Framing {
    const previous = this.framedFloor === floor ? this.framing : null;
    this.framedFloor = floor;
    if (!previous) {
      this.framing = target;
      return target;
    }
    const easedScale = easeToward(previous.scale, target.scale, deltaSeconds, CAMERA_EASE_RATE);
    this.framing = {
      centerX: easeToward(previous.centerX, target.centerX, deltaSeconds, CAMERA_EASE_RATE),
      centerY: easeToward(previous.centerY, target.centerY, deltaSeconds, CAMERA_EASE_RATE),
      scale: Math.abs(easedScale - target.scale) < SCALE_SNAP ? target.scale : easedScale,
    };
    return this.framing;
  }

  private drawCombatant(
    unit: Combatant,
    sprites: FacingSprites,
    facingLeftById: Map<number, boolean>,
    healthColor: string,
    interpolation: number,
  ): void {
    const movedX = unit.x - unit.previousX;
    if (movedX !== 0) facingLeftById.set(unit.id, movedX < 0);
    const worldX = Math.round(interpolate(unit.previousX, unit.x, interpolation) * TILE_SIZE);
    const worldY = Math.round(interpolate(unit.previousY, unit.y, interpolation) * TILE_SIZE);
    this.context.drawImage(facingLeftById.get(unit.id) ? sprites.left : sprites.right, worldX, worldY);
    this.drawHealthBar(worldX, worldY, unit.hp, unit.maxHp, healthColor);
  }

  private drawNest(nest: Nest): void {
    const worldX = nest.x * TILE_SIZE;
    const worldY = nest.y * TILE_SIZE;
    this.context.drawImage(this.nestSprite, worldX, worldY);
    this.context.fillStyle = NEST_EGG.color;
    nest.eggs.forEach((_, index) => this.context.fillRect(worldX + NEST_EGG.firstX + index, worldY + NEST_EGG.y, NEST_EGG.width, NEST_EGG.height));
    this.drawHealthBar(worldX, worldY, nest.hp, nest.maxHp, HEALTH_BAR.nest);
  }

  private drawHealthBar(worldX: number, worldY: number, hp: number, maxHp: number, color: string): void {
    if (hp >= maxHp) return;
    const barX = worldX + HEALTH_BAR.inset;
    const barY = worldY + SPRITE_SIZE;
    this.context.fillStyle = HEALTH_BAR.background;
    this.context.fillRect(barX, barY, HEALTH_BAR.width, HEALTH_BAR.height);
    this.context.fillStyle = color;
    this.context.fillRect(barX, barY, Math.max(1, Math.round((HEALTH_BAR.width * hp) / maxHp)), HEALTH_BAR.height);
  }

  private drawFog(floorState: FloorState, currentTick: number, left: number, top: number, viewWidth: number, viewHeight: number): void {
    const { floor, lastSeenTick } = floorState;
    const firstColumn = Math.max(0, Math.floor(left / TILE_SIZE));
    const firstRow = Math.max(0, Math.floor(top / TILE_SIZE));
    const lastColumn = Math.min(floor.side - 1, Math.floor((left + viewWidth) / TILE_SIZE));
    const lastRow = Math.min(floor.side - 1, Math.floor((top + viewHeight) / TILE_SIZE));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const seenTick = lastSeenTick[row * floor.side + column];
        if (seenTick === currentTick) continue;
        this.context.fillStyle = seenTick < 0 ? ROOT_CELLAR.void : REMEMBERED_SHADE;
        this.context.fillRect(column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private chickenSpritesFor(bandanaColor: string): FacingSprites {
    let sprites = this.chickenSpritesByBandana.get(bandanaColor);
    if (!sprites) {
      sprites = buildChickenSprites(bandanaColor);
      this.chickenSpritesByBandana.set(bandanaColor, sprites);
    }
    return sprites;
  }

  /** Floors never change shape, so each one is painted once and copied every frame. */
  private tileLayerFor(floor: Floor): HTMLCanvasElement {
    let layer = this.tileLayers.get(floor);
    if (!layer) {
      layer = paintTileLayer(floor);
      this.tileLayers.set(floor, layer);
    }
    return layer;
  }
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function paintTileLayer(floor: Floor): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = floor.side * TILE_SIZE;
  layer.height = floor.side * TILE_SIZE;
  const context = contextOf(layer);
  for (let row = 0; row < floor.side; row++) {
    for (let column = 0; column < floor.side; column++) {
      const index = row * floor.side + column;
      const pixelX = column * TILE_SIZE;
      const pixelY = row * TILE_SIZE;
      if (isWalkable(floor, index)) {
        paintFloorTile(context, pixelX, pixelY, mixSeed(floor.depth, index));
      } else if (row + 1 < floor.side && isWalkable(floor, index + floor.side)) {
        // Walls with floor below show their face, which gives the top-down view its slight tilt.
        context.fillStyle = ROOT_CELLAR.wallFace;
        context.fillRect(pixelX, pixelY, TILE_SIZE, TILE_SIZE);
        context.fillStyle = ROOT_CELLAR.wallShadow;
        context.fillRect(pixelX, pixelY + TILE_SIZE - WALL_SHADOW_ROWS, TILE_SIZE, WALL_SHADOW_ROWS);
      }
    }
  }
  paintStairsUp(context, floor.stairsUp);
  paintStairsDown(context, floor.stairsDown);
  return layer;
}

function paintFloorTile(context: CanvasRenderingContext2D, pixelX: number, pixelY: number, tileHash: number): void {
  context.fillStyle = ROOT_CELLAR.floor;
  context.fillRect(pixelX, pixelY, TILE_SIZE, TILE_SIZE);
  for (let speckle = 0; speckle < SPECKLES_PER_TILE; speckle++) {
    const bits = tileHash >>> (speckle * 8);
    context.fillStyle = speckle % 2 === 0 ? ROOT_CELLAR.speckleLight : ROOT_CELLAR.speckleDark;
    context.fillRect(pixelX + (bits & 15), pixelY + ((bits >>> 4) & 15), 1, 1);
  }
}

function paintStairsUp(context: CanvasRenderingContext2D, tile: Point): void {
  const pixelX = tile.x * TILE_SIZE;
  const pixelY = tile.y * TILE_SIZE;
  context.fillStyle = ROOT_CELLAR.lanternAmber;
  context.fillRect(pixelX + 3, pixelY + 1, 2, 14);
  context.fillRect(pixelX + 11, pixelY + 1, 2, 14);
  for (let rung = 3; rung < TILE_SIZE; rung += 4) context.fillRect(pixelX + 3, pixelY + rung, 10, 1);
}

function paintStairsDown(context: CanvasRenderingContext2D, tile: Point): void {
  const pixelX = tile.x * TILE_SIZE;
  const pixelY = tile.y * TILE_SIZE;
  context.fillStyle = ROOT_CELLAR.lanternAmber;
  context.fillRect(pixelX + 1, pixelY + 1, 14, 14);
  context.fillStyle = ROOT_CELLAR.stairwell;
  context.fillRect(pixelX + 2, pixelY + 2, 12, 12);
}
