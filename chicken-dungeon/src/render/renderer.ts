import type { MonsterKindId } from "../data/bestiary.ts";
import type { Floor } from "../gen/floor.ts";
import { isWalkable, toIndex, type Point } from "../gen/grid.ts";
import { mixSeed } from "../rng.ts";
import { currentTile } from "../sim/movement.ts";
import type { FloorState, GameState, Mover } from "../sim/types.ts";
import { isInDungeon, leadChicken } from "../sim/world.ts";
import {
  buildChickenSprites,
  buildFeatherPileSprite,
  buildGoldPileSprite,
  buildMonsterSprites,
  contextOf,
  SPRITE_SIZE,
  type FacingSprites,
} from "./sprites.ts";

interface Combatant extends Mover {
  readonly id: number;
  hp: number;
  maxHp: number;
}

export const VIEW_WIDTH = 480;
export const VIEW_HEIGHT = 270;
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
const HEALTH_BAR = { width: 12, height: 2, inset: 2, background: "#1a120c", chicken: "#7fd35a", monster: "#e2533a" };
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
  private readonly tileLayers = new Map<number, HTMLCanvasElement>();
  private readonly chickenSpritesByBandana = new Map<string, FacingSprites>();
  private readonly monsterSprites: Readonly<Record<MonsterKindId, FacingSprites>>;
  private readonly goldPileSprite: HTMLCanvasElement;
  private readonly featherPileSprite: HTMLCanvasElement;
  // Chickens and monsters have separate id spaces, so each keeps its own facing memory.
  private readonly chickenFacingLeft = new Map<number, boolean>();
  private readonly monsterFacingLeft = new Map<number, boolean>();

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    this.context = contextOf(canvas);
    this.monsterSprites = { cellarRat: buildMonsterSprites("cellarRat"), cellarSpider: buildMonsterSprites("cellarSpider") };
    this.goldPileSprite = buildGoldPileSprite();
    this.featherPileSprite = buildFeatherPileSprite();
  }

  /** `interpolation` is how far real time has moved past the last tick, from 0 to 1. */
  draw(state: GameState, interpolation: number): void {
    const context = this.context;
    context.fillStyle = ROOT_CELLAR.void;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const lead = leadChicken(state);
    if (!lead) return;
    const floorState = state.floors.get(lead.depth);
    if (!floorState) return;
    const { floor, lastSeenTick } = floorState;

    const camera = cameraOrigin(floor, {
      x: interpolate(lead.previousX, lead.x, interpolation) * TILE_SIZE + TILE_SIZE / 2,
      y: interpolate(lead.previousY, lead.y, interpolation) * TILE_SIZE + TILE_SIZE / 2,
    });
    context.drawImage(this.tileLayerFor(floor), camera.x, camera.y, VIEW_WIDTH, VIEW_HEIGHT, 0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    for (const pile of floorState.lootPiles) {
      if (lastSeenTick[toIndex(floor.side, pile)] < 0) continue;
      const sprite = pile.isFeatherPile ? this.featherPileSprite : this.goldPileSprite;
      context.drawImage(sprite, pile.x * TILE_SIZE - camera.x, pile.y * TILE_SIZE - camera.y);
    }
    for (const monster of floorState.monsters) {
      if (lastSeenTick[toIndex(floor.side, currentTile(monster))] !== state.tick) continue;
      this.drawCombatant(monster, this.monsterSprites[monster.kind], this.monsterFacingLeft, HEALTH_BAR.monster, camera, interpolation);
    }
    for (const chicken of state.chickens) {
      if (!isInDungeon(chicken) || chicken.depth !== lead.depth) continue;
      const sprites = this.chickenSpritesFor(BANDANA_COLORS[chicken.id % BANDANA_COLORS.length]);
      this.drawCombatant(chicken, sprites, this.chickenFacingLeft, HEALTH_BAR.chicken, camera, interpolation);
    }
    this.drawFog(floorState, state.tick, camera);
  }

  private drawCombatant(
    unit: Combatant,
    sprites: FacingSprites,
    facingLeftById: Map<number, boolean>,
    healthColor: string,
    camera: Point,
    interpolation: number,
  ): void {
    const movedX = unit.x - unit.previousX;
    if (movedX !== 0) facingLeftById.set(unit.id, movedX < 0);
    const screenX = Math.round(interpolate(unit.previousX, unit.x, interpolation) * TILE_SIZE - camera.x);
    const screenY = Math.round(interpolate(unit.previousY, unit.y, interpolation) * TILE_SIZE - camera.y);
    this.context.drawImage(facingLeftById.get(unit.id) ? sprites.left : sprites.right, screenX, screenY);
    if (unit.hp >= unit.maxHp) return;
    const barX = screenX + HEALTH_BAR.inset;
    const barY = screenY + SPRITE_SIZE;
    this.context.fillStyle = HEALTH_BAR.background;
    this.context.fillRect(barX, barY, HEALTH_BAR.width, HEALTH_BAR.height);
    this.context.fillStyle = healthColor;
    this.context.fillRect(barX, barY, Math.max(1, Math.round((HEALTH_BAR.width * unit.hp) / unit.maxHp)), HEALTH_BAR.height);
  }

  private drawFog(floorState: FloorState, currentTick: number, camera: Point): void {
    const { floor, lastSeenTick } = floorState;
    const firstColumn = Math.floor(camera.x / TILE_SIZE);
    const firstRow = Math.floor(camera.y / TILE_SIZE);
    const lastColumn = Math.min(floor.side - 1, Math.floor((camera.x + VIEW_WIDTH) / TILE_SIZE));
    const lastRow = Math.min(floor.side - 1, Math.floor((camera.y + VIEW_HEIGHT) / TILE_SIZE));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const seenTick = lastSeenTick[row * floor.side + column];
        if (seenTick === currentTick) continue;
        this.context.fillStyle = seenTick < 0 ? ROOT_CELLAR.void : REMEMBERED_SHADE;
        this.context.fillRect(column * TILE_SIZE - camera.x, row * TILE_SIZE - camera.y, TILE_SIZE, TILE_SIZE);
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
    let layer = this.tileLayers.get(floor.depth);
    if (!layer) {
      layer = paintTileLayer(floor);
      this.tileLayers.set(floor.depth, layer);
    }
    return layer;
  }
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function cameraOrigin(floor: Floor, focus: Point): Point {
  const maxX = floor.side * TILE_SIZE - VIEW_WIDTH;
  const maxY = floor.side * TILE_SIZE - VIEW_HEIGHT;
  return {
    x: Math.round(Math.min(maxX, Math.max(0, focus.x - VIEW_WIDTH / 2))),
    y: Math.round(Math.min(maxY, Math.max(0, focus.y - VIEW_HEIGHT / 2))),
  };
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
