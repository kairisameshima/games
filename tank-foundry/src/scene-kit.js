import * as THREE from "three";

export const SHARED = {
  sphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
};

export function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

/** Box resting on `y` (its bottom face), centered on x/z. */
export function block(parent, w, h, d, material, x, y, z) {
  const item = mesh(SHARED.box, material, x, y + h / 2, z);
  item.scale.set(w, h, d);
  parent.add(item);
  return item;
}

/** Cylinder resting on `y`. */
export function column(parent, radiusTop, radiusBottom, h, material, x, y, z, segments = 12) {
  const item = mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), material, x, y + h / 2, z);
  parent.add(item);
  return item;
}

export function canvasTexture(width, height, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

let contactShadowTexture = null;
const contactShadowMaterials = new Map();

/**
 * Soft dark ellipse on the ground. Cheap stand-in for ambient occlusion that keeps
 * machines, vehicles and figures visually planted on the floor.
 */
export function contactShadow(width, depth, opacity = 0.45) {
  contactShadowTexture ??= canvasTexture(64, 64, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.65)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
  if (!contactShadowMaterials.has(opacity)) {
    contactShadowMaterials.set(opacity, new THREE.MeshBasicMaterial({ map: contactShadowTexture, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), contactShadowMaterials.get(opacity));
  shadow.position.y = 0.03;
  shadow.renderOrder = -1;
  shadow.userData.contactShadow = true;
  return shadow;
}
