import * as THREE from "three";
import {
  blocksLadderApproach,
  GUN_DIMENSIONS,
  GUN_STATIONS,
  hullHalfWidth,
  hullPlankingThickness,
  INTERIOR_BULKHEAD,
  INTERIOR_FIXTURES,
  WALKABLE_DECKS,
  type InteriorFixture,
} from "./layout";

type InteriorAdder = (
  geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial,
  side: number, deck: number, shell?: boolean, rig?: boolean, restOnly?: boolean,
) => void;

export interface InteriorMaterials {
  timber: THREE.MeshStandardMaterial;
  pale: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  canvas: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}

export interface InteriorLight { light: THREE.PointLight; deck: number }

const UP = new THREE.Vector3(0, 1, 0);
const HAMMOCK_LENGTH = 2.05;
const HAMMOCK_WIDTH = .58;

function block(width: number, height: number, depth: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}

function rod(from: THREE.Vector3, to: THREE.Vector3, radius: number, sides = 6): THREE.BufferGeometry {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, sides);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.divideScalar(length)));
  return geometry.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
}

function addCeilingDetails(add: InteriorAdder, materials: InteriorMaterials): void {
  for (const [deck, floor] of [[1, 1], [2, 3.4], [3, 5.8]] as const) {
    for (const side of [-1, 1]) {
      for (let x = -25.8; x < 26; x += 2.2) {
        const ceiling = floor + 2.02;
        const z = side * (hullHalfWidth(x, ceiling) - hullPlankingThickness(ceiling) - .08);
        const nextZ = side * (hullHalfWidth(x + 2.2, ceiling) - hullPlankingThickness(ceiling) - .08);
        add(rod(new THREE.Vector3(x, ceiling, z), new THREE.Vector3(x + 2.2, ceiling, nextZ), .105, 4), materials.pale, side, deck);
        const knee = new THREE.Shape();
        knee.moveTo(0, 0);
        knee.lineTo(.78, 0);
        knee.lineTo(.78, -.13);
        knee.quadraticCurveTo(.2, -.12, .12, -.32);
        knee.lineTo(0, -.32);
        knee.closePath();
        const geometry = new THREE.ExtrudeGeometry(knee, { depth: .16, bevelEnabled: false });
        geometry.rotateY(side * Math.PI / 2).translate(x - side * .08, floor + 2.23, z);
        add(geometry, materials.pale, side, deck);
      }
    }
  }
}

function addCabin(add: InteriorAdder, materials: InteriorMaterials): void {
  const { x, deck, doorHalfWidth } = INTERIOR_BULKHEAD;
  const floor = WALKABLE_DECKS[deck];
  for (const side of [-1, 1]) {
    const width = hullHalfWidth(x, floor + 1) - hullPlankingThickness(floor + 1) - .05;
    const panel = new THREE.BoxGeometry(.14, 2.12, width - doorHalfWidth);
    const positions = panel.getAttribute("position") as THREE.BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex) + 1.06;
      const across = positions.getZ(vertex) / (width - doorHalfWidth) + .5;
      const edge = hullHalfWidth(x, floor + y) - hullPlankingThickness(floor + y) - .05;
      positions.setXYZ(vertex, positions.getX(vertex) + x, floor + y,
        side * (doorHalfWidth + across * (edge - doorHalfWidth)));
    }
    panel.computeVertexNormals();
    add(panel, materials.pale, side, deck + 1);
    for (let z = doorHalfWidth + .5; z < width - .3; z += .85) {
      add(block(.035, 1.1, .68, x + .09, floor + .99, side * z), materials.dark, side, deck + 1);
      add(block(.045, .96, .56, x + .115, floor + .99, side * z), materials.pale, side, deck + 1);
      add(block(.04, .1, .8, x + .12, floor + .32, side * z), materials.timber, side, deck + 1);
    }
    add(block(.2, 1.88, .12, x, floor + .94, side * doorHalfWidth), materials.timber, side, deck + 1);
    add(block(.21, .1, width - doorHalfWidth, x, floor + 1.74, side * (width + doorHalfWidth) / 2), materials.brass, side, deck + 1);
  }
  add(block(.22, .26, doorHalfWidth * 2 + .12, x, floor + 1.99, 0), materials.timber, 0, deck + 1);
  for (let tileX = -29.9; tileX < x - .3; tileX += .45) {
    const width = hullHalfWidth(tileX, floor) - .45;
    for (let tileZ = -width + .25; tileZ < width - .25; tileZ += .45) {
      const color = (Math.round(tileX / .45) + Math.round(tileZ / .45)) % 2 ? materials.pale : materials.dark;
      add(block(.445, .012, .445, tileX, floor + .008, tileZ), color, Math.sign(tileZ), deck + 1);
    }
  }
}

function addTable(fixture: InteriorFixture, add: InteriorAdder, materials: InteriorMaterials): void {
  const { x, z, halfX, halfZ, height, deck } = fixture;
  const y = WALKABLE_DECKS[deck];
  add(block(halfX * 2, .1, halfZ * 2, x, y + height - .05, z), materials.timber, 0, deck + 1);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    add(block(.12, height - .1, .12, x + dx * (halfX - .1), y + (height - .1) / 2,
      z + dz * (halfZ - .1)), materials.dark, 0, deck + 1);
  }
  add(block(halfX * 1.7, .08, .1, x, y + .23, z), materials.timber, 0, deck + 1);
}

function addChart(fixture: InteriorFixture, add: InteriorAdder, materials: InteriorMaterials): void {
  const { x, z, deck } = fixture;
  const y = WALKABLE_DECKS[deck] + fixture.height + .008;
  add(block(1.05, .009, .75, x, y, z), materials.paper, 0, deck + 1);
  const coast = [[-.44, -.27], [-.3, -.2], [-.36, -.1], [-.18, -.04], [-.23, .07], [-.08, .1], [.05, .24], [.3, .28], [.44, .2]];
  for (let index = 1; index < coast.length; index++) {
    const a = coast[index - 1], b = coast[index];
    add(rod(new THREE.Vector3(x + a[0], y + .009, z + a[1]),
      new THREE.Vector3(x + b[0], y + .009, z + b[1]), .006, 4), materials.iron, 0, deck + 1);
  }
  for (let spoke = 0; spoke < 8; spoke++) {
    const angle = spoke * Math.PI / 4;
    add(rod(new THREE.Vector3(x + .28, y + .012, z - .17),
      new THREE.Vector3(x + .28 + Math.cos(angle) * .12, y + .012, z - .17 + Math.sin(angle) * .12), .004, 4), materials.iron, 0, deck + 1);
  }
  for (const offset of [-.05, .05]) {
    add(rod(new THREE.Vector3(x - .55, y + .025, z + .25),
      new THREE.Vector3(x - .35, y + .025, z + .35 + offset), .012), materials.brass, 0, deck + 1);
  }
}

function addGalley(fixture: InteriorFixture, add: InteriorAdder, materials: InteriorMaterials): void {
  const { x, z, deck, halfX, halfZ } = fixture;
  const y = WALKABLE_DECKS[deck];
  add(block(halfX * 2, .14, halfZ * 2, x, y + .07, z), materials.brick, 0, deck + 1);
  add(block(2, 1, 1.4, x, y + .65, z), materials.iron, 0, deck + 1);
  add(block(2.1, .08, 1.5, x, y + 1.19, z), materials.dark, 0, deck + 1);
  add(block(.04, .4, .7, x - 1.025, y + .65, z), materials.brass, 0, deck + 1);
  add(block(.045, .28, .5, x - 1.05, y + .65, z), materials.glow, 0, deck + 1);
  for (const offset of [-.17, 0, .17])
    add(block(.055, .3, .025, x - 1.08, y + .65, z + offset), materials.iron, 0, deck + 1);
  for (const offset of [-.52, .52]) {
    add(new THREE.SphereGeometry(.26, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
      .translate(x + offset, y + 1.48, z - .13), materials.brass, 0, deck + 1);
    add(new THREE.TorusGeometry(.26, .025, 6, 16).rotateX(Math.PI / 2)
      .translate(x + offset, y + 1.48, z - .13), materials.brass, 0, deck + 1);
    add(new THREE.CylinderGeometry(.23, .23, .012, 16).translate(x + offset, y + 1.46, z - .13), materials.dark, 0, deck + 1);
    for (const handle of [-1, 1])
      add(new THREE.TorusGeometry(.08, .017, 5, 10)
        .translate(x + offset + handle * .27, y + 1.45, z - .13), materials.iron, 0, deck + 1);
  }
  const flue = INTERIOR_FIXTURES.find(part => part.kind === "flue")!;
  add(new THREE.CylinderGeometry(.19, .21, 1.2, 12).translate(flue.x, y + 1.8, flue.z), materials.iron, 0, deck + 1);
}

function addFixtures(add: InteriorAdder, materials: InteriorMaterials): void {
  for (const fixture of INTERIOR_FIXTURES) {
    const { x, z, deck, halfX, halfZ, height } = fixture;
    const y = WALKABLE_DECKS[deck];
    if (fixture.kind === "galley") { addGalley(fixture, add, materials); continue; }
    if (fixture.kind === "flue") {
      add(new THREE.CylinderGeometry(.19, .19, height, 12).translate(x, y + height / 2, z), materials.iron, 0, deck + 1);
      add(new THREE.ConeGeometry(.34, .18, 12).translate(x, y + height + .1, z), materials.iron, 0, deck + 1);
      continue;
    }
    if (fixture.kind === "chair") {
      add(block(halfX * 2, .1, halfZ * 2, x, y + .44, z), materials.timber, 0, deck + 1);
      for (const dx of [-1, 1]) for (const dz of [-1, 1])
        add(block(.07, dx > 0 ? height : .44, .07, x + dx * (halfX - .05),
          y + (dx > 0 ? height : .44) / 2, z + dz * (halfZ - .05)), materials.dark, 0, deck + 1);
      add(block(.08, .14, halfZ * 2, x + halfX - .05, y + height - .07, z), materials.timber, 0, deck + 1);
      continue;
    }
    addTable(fixture, add, materials);
    if (fixture.kind === "chart-table") addChart(fixture, add, materials);
    if (fixture.kind === "cot") {
      add(block(halfX * 1.92, .13, halfZ * 1.88, x, y + height + .065, z), materials.canvas, 0, deck + 1);
      add(block(.35, .12, halfZ * 1.7, x - halfX + .25, y + height + .17, z), materials.paper, 0, deck + 1);
      add(block(halfX * 1.1, .025, halfZ * 1.9, x + .35, y + height + .145, z), materials.pale, 0, deck + 1);
    }
    if (fixture.kind === "workbench") {
      add(block(.19, .26, .2, x + .45, y + height + .1, z - .15), materials.iron, 0, deck + 1);
      add(rod(new THREE.Vector3(x + .45, y + height + .05, z - .3),
        new THREE.Vector3(x + .45, y + height + .05, z + .22), .025), materials.iron, 0, deck + 1);
      add(block(.55, .03, .12, x - .25, y + height + .03, z + .1), materials.iron, 0, deck + 1);
      add(block(.15, .06, .16, x - .55, y + height + .04, z + .1), materials.timber, 0, deck + 1);
    }
    if (fixture.kind === "surgery-table") {
      add(block(halfX * 1.9, .02, halfZ * 1.85, x, y + height + .01, z), materials.canvas, 0, deck + 1);
      for (const offset of [-.2, .1])
        add(new THREE.CylinderGeometry(.07, .07, .24, 10).rotateZ(Math.PI / 2)
          .translate(x, y + height + .08, z + offset), materials.paper, 0, deck + 1);
      add(block(.3, .025, .2, x - .25, y + height + .03, z - .35), materials.brass, 0, deck + 1);
    }
  }
}

function hammockGeometry(x: number, y: number, z: number): THREE.BufferGeometry {
  const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  const columns = 20, rows = 6;
  for (let column = 0; column <= columns; column++) for (let row = 0; row <= rows; row++) {
    const u = column / columns * 2 - 1, v = row / rows * 2 - 1;
    vertices.push(x + u * HAMMOCK_LENGTH / 2, y + 1.5 + .55 * Math.pow(Math.abs(u), 1.55) + .08 * v * v,
      z + v * HAMMOCK_WIDTH / 2 * (1 - .5 * Math.abs(u)));
    uv.push(column / columns * 3, row / rows);
    if (column < columns && row < rows) {
      const a = column * (rows + 1) + row, b = a + 1, c = a + rows + 1;
      indices.push(a, b, c, b, c + 1, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addBatteryDetails(add: InteriorAdder, materials: InteriorMaterials): void {
  for (const station of GUN_STATIONS) {
    if (station.calibre === 9) continue;
    const { x, y } = station.position, side = station.side === "port" ? -1 : 1;
    const z = station.position.z + side * .4, deck = station.deck + 1;
    add(hammockGeometry(x, y, z), materials.canvas, side, deck, false, false, true);
    for (const end of [-1, 1]) for (const across of [-1, 1])
      add(rod(new THREE.Vector3(x + end * HAMMOCK_LENGTH / 2, y + 2.13, z + across * HAMMOCK_WIDTH / 4),
        new THREE.Vector3(x + end * 1.28, y + 2.26, z), .013), materials.canvas, side, deck, false, false, true);
    add(block(1.08, .1, .4, x, y + .05, z + side * .35), materials.timber, side, deck);
    const radius = .082 * GUN_DIMENSIONS[station.calibre].widthScale;
    for (let shot = 0; shot < 8; shot++)
      add(new THREE.SphereGeometry(radius, 8, 6).translate(x - .39 + shot % 4 * .26,
        y + .1 + radius, z + side * .35 + (shot < 4 ? -.1 : .1)), materials.iron, side, deck);
    const wallX = x + 1.72;
    if (wallX > 24) continue;
    const wallZ = side * (hullHalfWidth(wallX, y + 1.1) - hullPlankingThickness(y + 1.1) - .05);
    add(block(1.05, .65, .08, wallX, y + 1.1, wallZ), materials.timber, side, deck);
    for (const hinge of [-.35, .35])
      add(block(.1, .09, .09, wallX + hinge, y + 1.4, wallZ - side * .04), materials.iron, side, deck);
  }
}

function addLantern(x: number, y: number, z: number, side: number, deck: number, add: InteriorAdder, materials: InteriorMaterials): void {
  add(block(.15, .25, .13, x, y, z), materials.glow, side, deck);
  for (const end of [-1, 1]) {
    add(block(.25, .035, .22, x, y + end * .15, z), materials.iron, side, deck);
    for (const across of [-1, 1])
      add(block(.018, .3, .018, x + end * .105, y, z + across * .09), materials.brass, side, deck);
  }
  add(new THREE.TorusGeometry(.055, .014, 5, 10).translate(x, y + .21, z), materials.iron, side, deck);
}

function addStores(add: InteriorAdder, materials: InteriorMaterials): void {
  for (let index = 0; index < 18; index++) {
    const x = -24 + index % 6 * 2, z = -1.9 + Math.floor(index / 6) * 1.9;
    if (blocksLadderApproach(0, x, z, .57, .42)) continue;
    for (const end of [-1, 1]) {
      add(block(1.1, .06, .06, x, 1.58, z + end * .38), materials.pale, 0, 1);
      add(block(.07, .6, .82, x + end * .48, 1.3, z), materials.dark, 0, 1);
    }
  }
}

export function buildInterior(add: InteriorAdder, materials: InteriorMaterials): InteriorLight[] {
  addCeilingDetails(add, materials);
  addCabin(add, materials);
  addFixtures(add, materials);
  addBatteryDetails(add, materials);
  addStores(add, materials);
  for (const [deck, floor] of [[1, 1], [2, 3.4], [3, 5.8]] as const)
    for (const side of [-1, 1]) for (let x = -23; x < 25; x += 6.88) {
      const z = side * (hullHalfWidth(x, floor + 1.65) - hullPlankingThickness(floor + 1.65) - .12);
      addLantern(x, floor + 1.65, z, side, deck, add, materials);
    }
  const cabinLight = new THREE.PointLight(0xffd89a, 9, 6, 2);
  cabinLight.position.set(-28.2, 7.55, .4);
  addLantern(-28.2, 7.55, .4, 0, 3, add, materials);
  const galleyLight = new THREE.PointLight(0xffb56b, 5, 4, 2);
  galleyLight.position.set(23.7, 6.5, 0);
  return [{ light: cabinLight, deck: 3 }, { light: galleyLight, deck: 3 }];
}
