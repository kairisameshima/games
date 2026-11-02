import * as THREE from "three";
import { canvasTexture, SHARED } from "./scene-kit.js";

const MAX_EFFECTS = 360;

function softPuffTexture() {
  return canvasTexture(64, 64, (context, width, height) => {
    const gradient = context.createRadialGradient(width / 2, height / 2, 2, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.75)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}

/** Short-lived scene decorations: smoke, flashes, sparks and anything else with a lifetime. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.puffTexture = softPuffTexture();
  }

  add(object, life, update) {
    if (this.active.length >= MAX_EFFECTS) this.remove(this.active.shift());
    this.scene.add(object);
    this.active.push({ object, life, age: 0, update });
  }

  remove(effect) {
    this.scene.remove(effect.object);
    effect.object.material?.dispose();
  }

  puff(position, { color, size, grow, life, rise, drift = 0, opacity = 0.55 }) {
    const material = new THREE.SpriteMaterial({ map: this.puffTexture, color, transparent: true, opacity, depthWrite: false, rotation: Math.random() * Math.PI * 2 });
    const smoke = new THREE.Sprite(material);
    smoke.position.copy(position);
    smoke.scale.setScalar(size * 2);
    const driftX = (Math.random() - 0.3) * drift;
    const driftZ = (Math.random() - 0.5) * drift;
    const spin = (Math.random() - 0.5) * 0.6;
    this.add(smoke, life, (effect, dt, t) => {
      smoke.position.y += rise * dt;
      smoke.position.x += driftX * dt;
      smoke.position.z += driftZ * dt;
      smoke.scale.setScalar(size * 2 * (1 + grow * t));
      material.rotation += spin * dt;
      material.opacity = opacity * (1 - t) * Math.min(1, t * 8);
    });
  }

  flash(position, color, size, life) {
    const material = new THREE.SpriteMaterial({ map: this.puffTexture, color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(material);
    glow.position.copy(position);
    glow.scale.setScalar(size * 2.4);
    this.add(glow, life, (effect, dt, t) => {
      glow.scale.setScalar(size * 2.4 * (1 + t * 1.5));
      material.opacity = 1 - t;
    });
  }

  spark(position, color) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    const spark = new THREE.Mesh(SHARED.box, material);
    spark.scale.setScalar(0.1);
    spark.position.copy(position);
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
    this.add(spark, 0.5, (effect, dt, t) => {
      velocity.y -= 14 * dt;
      spark.position.addScaledVector(velocity, dt);
      if (spark.position.y < 0.25) {
        spark.position.y = 0.25;
        velocity.set(velocity.x * 0.4, -velocity.y * 0.3, velocity.z * 0.4);
      }
      material.opacity = 1 - t;
    });
  }

  explosion(position, scale) {
    this.flash(position.clone().setY(1.2 * scale), 0xffc35a, 1.4 * scale, 0.35);
    this.flash(position.clone().setY(1.6 * scale), 0xff6a2a, 2.2 * scale, 0.55);
    for (let index = 0; index < 6; index += 1) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2).multiplyScalar(scale);
      this.puff(position.clone().add(offset), { color: 0x3b3835, size: 0.8 * scale, grow: 2.5, life: 2.2, rise: 1.8, drift: 1.5, opacity: 0.75 });
    }
    for (let index = 0; index < 10; index += 1) this.spark(position.clone().setY(1.2), 0xffb050);
  }

  update(dt) {
    const keep = [];
    for (const effect of this.active) {
      const t = Math.min(1, (effect.age + dt) / effect.life);
      effect.update(effect, dt, t);
      effect.age += dt;
      if (effect.age < effect.life) keep.push(effect);
      else this.remove(effect);
    }
    this.active = keep;
  }
}
