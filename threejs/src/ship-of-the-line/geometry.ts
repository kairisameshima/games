import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  DESIGN_WATERLINE,
  GUN_MOUNT_FORWARD,
  GUN_STATIONS,
  hullBowX,
  hullHalfWidth,
  hullPlankingThickness,
  hullSternX,
  RIGGING_LANE_X,
  RIGGING_LANE_Z,
} from "./layout";

const SAIL_COLUMNS = 32;
const SAIL_ROWS = 24;


export function hullSheer(x: number, y: number): number {
  return (
    Math.pow(Math.max(0, (Math.abs(x) - 15) / 16), 2) *
    (x > 0 ? .7 : .45) *
    THREE.MathUtils.clamp((y - 7.1) / 2.35, 0, 1)
  );
}

export function hullPanelGeometry(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  side: number,
): THREE.BufferGeometry {
  const thickness = hullPlankingThickness((y0 + y1) / 2);
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, thickness);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index++) {
    const y = positions.getY(index) + (y0 + y1) / 2;
    const rawX = positions.getX(index) + (x0 + x1) / 2;
    const x = THREE.MathUtils.clamp(rawX, hullSternX(y), Math.min(30.8, hullBowX(y) - .35));
    const width = hullHalfWidth(x, y);
    const inward = .5 - side * positions.getZ(index) / thickness;
    positions.setXYZ(
      index,
      x,
      y + hullSheer(x, y),
      side * (width - Math.min(thickness, width * .9) * inward),
    );
    if (Math.abs(normals.getZ(index)) > 0.5) {
      const direction = Math.sign(normals.getZ(index));
      const dx =
        (side * (hullHalfWidth(x + 0.01, y) - hullHalfWidth(x - 0.01, y))) /
        0.02;
      const dy =
        (side * (hullHalfWidth(x, y + 0.01) - hullHalfWidth(x, y - 0.01))) /
        0.02;
      const length = Math.hypot(dx, dy, 1);
      normals.setXYZ(
        index,
        (-dx / length) * direction,
        (-dy / length) * direction,
        direction / length,
      );
    }
    uv.setXY(index, x / 12, y / 3);
  }
  return geometry;
}

export function hullFrameGeometry(
  x: number,
  side: number,
): THREE.BufferGeometry {
  const segments: THREE.BufferGeometry[] = [];
  const openings = GUN_STATIONS.filter((station) => station.side === "port"
    && Math.abs(station.position.x - x) < (station.calibre === 9 ? .53 : .68) + .14);
  const cuts = [...new Set([
    -4.2, 8.1, ...Array.from({ length: 31 }, (_, index) => -4.2 + index * .4),
    ...openings.flatMap((station) => [station.position.y + .15, station.position.y + 1.05]),
  ])].filter((y) => y >= -4.2 && y <= 8.1).sort((a, b) => a - b);
  for (let index = 0; index < cuts.length - 1; index++) {
    const y0 = cuts[index], y1 = cuts[index + 1], middle = (y0 + y1) / 2;
    if (openings.some((station) => middle > station.position.y + .15 && middle < station.position.y + 1.05)) continue;
    const segment = new THREE.BoxGeometry(.28, y1 - y0, .1);
    const positions = segment.getAttribute("position") as THREE.BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex) + (y0 + y1) / 2;
      const localX = THREE.MathUtils.clamp(x + positions.getX(vertex),
        hullSternX(y), Math.min(30.8, hullBowX(y) - .35));
      positions.setXYZ(vertex, localX, y + hullSheer(localX, y),
        side * Math.max(.06, hullHalfWidth(localX, y) - hullPlankingThickness(y) - .05)
          + positions.getZ(vertex));
    }
    segment.computeVertexNormals();
    segments.push(segment);
  }
  const geometry = mergeGeometries(segments)!;
  for (const segment of segments) segment.dispose();
  return geometry;
}

export function hullMouldingGeometry(
  y: number,
  height: number,
  projection: number,
  side: number,
  start = -30.5,
  end = 30.8,
): THREE.BufferGeometry {
  const vertices: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  const segments = 128;
  for (let index = 0; index <= segments; index++) {
    const x = start + (index / segments) * (end - start);
    for (const [vertical, depth] of [
      [-1, 0],
      [-1, 1],
      [1, 1],
      [1, 0],
    ]) {
      const localY = y + (vertical * height) / 2;
      const localX = THREE.MathUtils.clamp(x, hullSternX(localY), Math.min(30.8, hullBowX(localY) - .35));
      vertices.push(
        localX,
        localY + hullSheer(localX, localY),
        side * (hullHalfWidth(localX, localY) + 0.015 + depth * projection),
      );
      uv.push(x / 12, vertical);
    }
    if (index === segments) continue;
    for (let edge = 0; edge < 4; edge++) {
      const a = index * 4 + edge,
        b = index * 4 + ((edge + 1) % 4),
        c = a + 4,
        d = b + 4;
      indices.push(...(side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function sternPoint(height: number, transverse: number): THREE.Vector3 {
  const flare =
    height < 5.6
      ? 0
      : Math.sin(
          (THREE.MathUtils.clamp((height - 5.6) / 4.8, 0, 1) * Math.PI) / 2,
        ) * 1.15;
  const sternX = hullSternX(height);
  const beam = hullHalfWidth(sternX, height) + flare;
  const counter = THREE.MathUtils.smoothstep(height, DESIGN_WATERLINE, 3.4);
  return new THREE.Vector3(
    sternX - .68 * counter * (1 - transverse * transverse)
      + Math.max(0, height - 5.8) * .075,
    height + hullSheer(sternX, height),
    transverse * beam,
  );
}

export const STERN_WINDOW_HEIGHTS = [6.65, 9.05] as const;

export function transomGeometry(y0: number, y1: number): THREE.BufferGeometry {
  const vertices: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rows = Math.max(2, Math.ceil((y1 - y0) * 3));
  const heights = [...new Set([
    y0, y1, ...Array.from({ length: rows + 1 }, (_, row) => y0 + (y1 - y0) * row / rows),
    ...STERN_WINDOW_HEIGHTS.flatMap((height) => [height - .57, height + .57]),
  ])].filter((height) => height >= y0 && height <= y1).sort((a, b) => a - b);
  const transverseCuts = [...new Set([
    ...Array.from({ length: 33 }, (_, column) => column / 16 - 1),
    ...Array.from({ length: 7 }, (_, index) => (index - 3) * .255).flatMap((u) => [u - .112, u + .112]),
  ])].sort((a, b) => a - b);
  const columns = transverseCuts.length;
  for (let row = 0; row < heights.length; row++) {
    for (let column = 0; column < columns; column++) {
      const height = heights[row], u = transverseCuts[column];
      const point = sternPoint(height, u);
      vertices.push(point.x, point.y, point.z);
      uv.push((u + 1) / 2, height / 3);
      if (row === heights.length - 1 || column === columns - 1) continue;
      const middleY = (height + heights[row + 1]) / 2;
      const middleU = (u + transverseCuts[column + 1]) / 2;
      const windowRow = STERN_WINDOW_HEIGHTS.some((windowY) => Math.abs(middleY - windowY) < .57);
      const windowColumn = Math.abs(middleU - Math.round(middleU / .255) * .255) < .112
        && Math.abs(middleU) < 3 * .255 + .112;
      if (windowRow && windowColumn) continue;
      const a = row * columns + column, b = a + 1, c = a + columns, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function sternFittingGeometry(
  width: number,
  height: number,
  depth: number,
  y: number,
  transverse: number,
  projection = 0.08,
): THREE.BufferGeometry {
  const center = sternPoint(y, transverse);
  const tangent = sternPoint(y, transverse + 0.01).sub(
    sternPoint(y, transverse - 0.01),
  );
  return new THREE.BoxGeometry(depth, height, width)
    .rotateY(Math.atan2(tangent.x, tangent.z))
    .translate(center.x - projection, center.y, center.z);
}

export function sternMouldingGeometry(
  y: number,
  radius: number,
): THREE.BufferGeometry {
  const points = Array.from({ length: 33 }, (_, index) =>
    sternPoint(y, index / 16 - 1).add(new THREE.Vector3(-0.09, 0, 0)),
  );
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points),
    64,
    radius,
    6,
    false,
  );
}

export function backboneGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(hullSternX(3.4) - .2, 3.4);
  shape.lineTo(hullSternX(-4.45) - .2, -4.55);
  shape.lineTo(hullBowX(-4.45), -4.55);
  for (let index = 0; index <= 40; index++) {
    const y = -4.45 + index / 40 * 13.9;
    shape.lineTo(hullBowX(y) + .08, y + hullSheer(hullBowX(y), y));
  }
  for (let index = 40; index >= 0; index--) {
    const y = -4.15 + index / 40 * 13.6;
    shape.lineTo(hullBowX(y) - .28, y + hullSheer(hullBowX(y), y));
  }
  shape.lineTo(hullSternX(-4.15) + .15, -4.15);
  shape.lineTo(hullSternX(3.4) + .15, 3.4);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: .42, bevelEnabled: true, bevelSize: .02, bevelThickness: .02,
    bevelSegments: 1, curveSegments: 1,
  }).translate(0, 0, -.21);
}

export const GALLERY_WINDOW_X = [-29.5, -28.1, -26.7] as const;

export function galleryPoint(x: number, y: number, side: number): THREE.Vector3 {
  const along = THREE.MathUtils.clamp((x + 30.5) / 4.5, 0, 1);
  const stern = sternPoint(y, side);
  const flare = Math.abs(stern.z) - hullHalfWidth(-30.5, y);
  const bulge = 1 - along * along * (3 - 2 * along);
  return new THREE.Vector3(
    x + Math.max(0, y - 5.8) * .075 * (1 - along) * (1 - along),
    y + hullSheer(x, y),
    side * (hullHalfWidth(x, y) + flare * bulge),
  );
}

export function galleryPanelGeometry(x0: number, x1: number, y0: number, y1: number, side: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, .18);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex) + (x0 + x1) / 2;
    const y = positions.getY(vertex) + (y0 + y1) / 2;
    const depth = positions.getZ(vertex) - side * .09;
    const point = galleryPoint(x, y, side);
    positions.setXYZ(vertex, point.x, point.y, point.z + depth);
    uv.setXY(vertex, x / 12, y / 3);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function galleryFittingGeometry(width: number, height: number, depth: number, x: number, y: number, side: number): THREE.BufferGeometry {
  const point = galleryPoint(x, y, side);
  const left = galleryPoint(x - .02, y, side);
  const right = galleryPoint(x + .02, y, side);
  const yaw = -Math.atan2(right.z - left.z, right.x - left.x);
  return new THREE.BoxGeometry(width, height, depth).rotateY(yaw)
    .translate(point.x, point.y, point.z + side * (depth / 2 + .02));
}

export function galleryMouldingGeometry(y: number, side: number): THREE.BufferGeometry {
  const points = Array.from({ length: 49 }, (_, index) => galleryPoint(-30.5 + index / 48 * 4.5, y, side));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, .09, 6, false);
}

export function cannonBarrelGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, -1.61], [.045, -1.61], [.09, -1.54], [.1, -1.46],
    [.07, -1.37], [.19, -1.31], [.235, -1.23], [.255, -1.12],
    [.23, -1.04], [.225, -.96], [.25, -.92], [.25, -.86],
    [.22, -.81], [.205, -.28], [.22, -.25], [.22, -.18],
    [.20, -.14], [.155, .57], [.175, .60], [.175, .67],
    [.15, .71], [.14, 1.12], [.16, 1.20], [.17, 1.27],
    [.17, 1.35], [.082, 1.35], [.082, 1.02], [0, 1.02],
  ];
  const barrel = new THREE.LatheGeometry(
    profile.map(([radius, length]) => new THREE.Vector2(radius, length)),
    20,
  );
  barrel.rotateX(Math.PI / 2);
  const trunnion = new THREE.CylinderGeometry(.075, .075, .96, 12)
    .rotateZ(Math.PI / 2)
    .translate(0, 0, -0.35);
  const merged = mergeGeometries([barrel, trunnion])!;
  barrel.dispose();
  trunnion.dispose();
  return merged;
}

export function cannonCarriageGeometry(axisHeight: number, widthScale: number, lengthScale: number): THREE.BufferGeometry {
  const redParts: THREE.BufferGeometry[] = [];
  const woodParts: THREE.BufferGeometry[] = [];
  const ironParts: THREE.BufferGeometry[] = [];
  const forward = GUN_MOUNT_FORWARD * (1 - lengthScale);
  const cheekScale = (axisHeight - .075 * widthScale) / .705;
  const cheek = new THREE.Shape();
  cheek.moveTo(-.9, .18);
  cheek.lineTo(.75, .18);
  cheek.lineTo(.75, .705);
  cheek.lineTo(.25, .705);
  cheek.lineTo(.25, .61);
  cheek.lineTo(-.25, .61);
  cheek.lineTo(-.25, .48);
  cheek.lineTo(-.9, .48);
  cheek.closePath();
  for (const side of [-1, 1]) {
    const cheekGeometry = new THREE.ExtrudeGeometry(cheek, {
      depth: .13, bevelEnabled: true, bevelSize: .012, bevelThickness: .008,
      bevelSegments: 1, curveSegments: 1,
    }).rotateY(-Math.PI / 2).translate(.065, 0, .2)
      .scale(widthScale, cheekScale, lengthScale).translate(side * .4 * widthScale, 0, forward);
    redParts.push(mergeVertices(cheekGeometry));
    cheekGeometry.dispose();
    const trunnionZ = GUN_MOUNT_FORWARD - .35 * lengthScale;
    ironParts.push(new THREE.TorusGeometry(.095 * widthScale, .02 * widthScale, 5, 10, Math.PI)
      .rotateY(Math.PI / 2).translate(side * .4 * widthScale, axisHeight, trunnionZ));
    for (const end of [-1, 1]) {
      const z = forward + end * .52 * lengthScale;
      const radius = (end > 0 ? .25 : .22) * widthScale;
      woodParts.push(new THREE.CylinderGeometry(radius, radius, .16 * widthScale, 12)
        .rotateZ(Math.PI / 2).translate(side * .6 * widthScale, radius, z));
      ironParts.push(new THREE.CylinderGeometry(.045 * widthScale, .045 * widthScale, .2 * widthScale, 8)
        .rotateZ(Math.PI / 2).translate(side * .65 * widthScale, radius, z));
    }
  }
  for (const end of [-1, 1]) {
    const z = forward + end * .52 * lengthScale;
    const axleY = (end > 0 ? .25 : .22) * widthScale;
    woodParts.push(new THREE.BoxGeometry(1.36 * widthScale, .14 * widthScale, .17 * lengthScale)
      .translate(0, axleY, z));
    redParts.push(new THREE.BoxGeometry(.94 * widthScale, .16 * cheekScale, .25 * lengthScale)
      .translate(0, .28 * cheekScale, z));
  }
  const quoin = new THREE.BoxGeometry(.28 * widthScale, .2 * cheekScale, .4 * lengthScale);
  const positions = quoin.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    if (positions.getY(vertex) > 0) positions.setY(vertex,
      positions.getY(vertex) + (positions.getZ(vertex) / (.4 * lengthScale) + .5) * .12 * cheekScale);
  }
  quoin.computeVertexNormals();
  quoin.translate(0, axisHeight - .42 * widthScale, forward - .3 * lengthScale);
  woodParts.push(quoin);
  const red = mergeGeometries(redParts)!;
  const wood = mergeGeometries(woodParts)!;
  const iron = mergeGeometries(ironParts)!;
  const geometry = mergeGeometries([red, wood, iron], true)!;
  for (const part of [...redParts, ...woodParts, ...ironParts, red, wood, iron]) part.dispose();
  return geometry;
}

export function rudderGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const top = hullSternX(4) - .16;
  const bottom = hullSternX(-4.25) - .16;
  shape.moveTo(top, 4);
  shape.lineTo(top - .3, 4);
  shape.lineTo(hullSternX(DESIGN_WATERLINE + .3) - 1.15, DESIGN_WATERLINE + .3);
  shape.lineTo(bottom - 1.45, -4.25);
  shape.lineTo(bottom, -4.25);
  shape.lineTo(hullSternX(DESIGN_WATERLINE + .3) - .16, DESIGN_WATERLINE + .3);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: .28, bevelEnabled: true, bevelSize: .025, bevelThickness: .025,
    bevelSegments: 1, curveSegments: 1,
  }).translate(0, 0, -.14);
}

export function squareSailGeometry(
  width: number,
  height: number,
  level: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(
    width,
    height,
    SAIL_COLUMNS,
    SAIL_ROWS,
  );
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index++) {
    const u = positions.getX(index) / (width / 2),
      v = 0.5 - positions.getY(index) / height;
    const taper =
      THREE.MathUtils.lerp(1, level === 0 ? 0.94 : 1.24, v) -
      0.045 * Math.sin(v * Math.PI);
    const belly =
      Math.sin(v * Math.PI) *
      Math.pow(Math.max(0, 1 - u * u), 0.7) *
      Math.min(2.25, width * 0.13);
    const footArch = (1 - u * u) * Math.pow(v, 6) * height * 0.075;
    const clothFold =
      Math.sin(u * Math.PI * 13) * 0.026 * Math.sin(v * Math.PI);
    positions.setXYZ(
      index,
      0.15 + belly + clothFold,
      -height * v + footArch,
      ((u * width) / 2) * taper,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function sailSeamsGeometry(
  canvas: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const positions = canvas.getAttribute("position");
  const vertices: number[] = [];
  const columns = SAIL_COLUMNS + 1,
    rows = SAIL_ROWS + 1;
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const alongEdge =
        column === 0 || column === columns - 1 || column % 4 === 0;
      if (alongEdge && row < rows - 1)
        for (const vertex of [index, index + columns])
          vertices.push(
            positions.getX(vertex) + 0.025,
            positions.getY(vertex),
            positions.getZ(vertex),
          );
      if (
        (row === 0 || row === rows - 1 || row === 7 || row === 12) &&
        column < columns - 1
      )
        for (const vertex of [index, index + 1])
          vertices.push(
            positions.getX(vertex) + 0.025,
            positions.getY(vertex),
            positions.getZ(vertex),
          );
      if (
        (row === 7 || row === 12) &&
        column > 0 &&
        column < columns - 1 &&
        column % 3 === 0
      ) {
        const x = positions.getX(index) + 0.03,
          y = positions.getY(index),
          z = positions.getZ(index);
        vertices.push(x, y, z, x + 0.03, y - 0.27, z + 0.025);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  return geometry;
}

export function launchHullGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const sections = 36,
    ribs = 20;
  for (let skin = 0; skin < 2; skin++)
    for (let station = 0; station <= sections; station++)
      for (let rib = 0; rib <= ribs; rib++) {
        const t = station / sections,
          angle = -Math.PI / 2 + (rib / ribs) * Math.PI;
        const width = 0.055 + Math.pow(Math.sin(t * Math.PI), 0.72) * 1.2;
        const depth = 0.68 + Math.sin(t * Math.PI) * 0.16;
        const x = -8.2 + t * 8.6;
        const y =
          8.65 +
          depth * (1 - Math.cos(angle)) +
          0.16 * Math.pow(Math.abs(t * 2 - 1), 3) +
          skin * 0.075;
        const z = Math.sin(angle) * Math.max(0.01, width - skin * 0.075);
        vertices.push(x, y, z);
        uv.push(t * 3, rib / ribs);
        if (station < sections && rib < ribs) {
          const a =
              skin * (sections + 1) * (ribs + 1) + station * (ribs + 1) + rib,
            b = a + 1,
            c = a + ribs + 1,
            d = c + 1;
          indices.push(
            ...(skin === 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]),
          );
        }
      }
  for (let station = 0; station < sections; station++)
    for (const rib of [0, ribs]) {
      const a = station * (ribs + 1) + rib,
        b = a + ribs + 1,
        c = a + (sections + 1) * (ribs + 1),
        d = b + (sections + 1) * (ribs + 1);
      indices.push(a, b, c, b, d, c);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function mastTopGeometry(
  x: number,
  y: number,
  radius: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-radius * 0.85, -radius * 1.1);
  shape.lineTo(radius * 0.85, -radius * 1.1);
  shape.quadraticCurveTo(radius * 1.25, 0, radius * 0.85, radius * 0.85);
  shape.quadraticCurveTo(0, radius * 1.2, -radius * 0.85, radius * 0.85);
  shape.quadraticCurveTo(-radius * 1.25, 0, -radius * 0.85, -radius * 1.1);
  const opening = new THREE.Path();
  opening.absellipse(0, 0, 0.46, 0.46, 0, Math.PI * 2, true);
  shape.holes.push(opening);
  // Lubber holes let sailors reach the fighting tops without passing through the platform.
  for (const side of [-1, 1]) {
    for (const direction of [-1, 1]) {
      const access = new THREE.Path();
      const centerX = direction * RIGGING_LANE_X, centerZ = side * RIGGING_LANE_Z;
      access.moveTo(centerX - .26, centerZ - .26);
      access.lineTo(centerX - .26, centerZ + .26);
      access.lineTo(centerX + .26, centerZ + .26);
      access.lineTo(centerX + .26, centerZ - .26);
      access.closePath();
      shape.holes.push(access);
    }
  }
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.035,
    bevelSegments: 1,
    curveSegments: 16,
  })
    .rotateX(Math.PI / 2)
    .translate(x, y, 0);
}

export function yardGeometry(
  width: number,
  radius: number,
): THREE.BufferGeometry {
  const right = new THREE.CylinderGeometry(0.045, radius, width / 2, 12)
    .rotateX(Math.PI / 2)
    .translate(0, 0, width / 4);
  const left = right.clone().rotateY(Math.PI);
  const geometry = mergeGeometries([left, right])!;
  left.dispose();
  right.dispose();
  return geometry;
}

export function bowClosureGeometry(
  side: number,
  y0: number,
  y1: number,
): THREE.BufferGeometry {
  const vertices: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  const rows = 4,
    columns = 12;
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const y = y0 + ((y1 - y0) * row) / rows,
        angle = ((column / columns) * Math.PI) / 2;
      const tip = hullBowX(y);
      const base = Math.min(30.8, tip - .35);
      const x = base + Math.cos(angle) * (tip - base);
      vertices.push(
        x,
        y + hullSheer(x, y),
        side * Math.sin(angle) * hullHalfWidth(base, y),
      );
      uv.push(column / columns, y / 3);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + 1,
          c = a + columns + 1,
          d = c + 1;
        indices.push(...(side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
