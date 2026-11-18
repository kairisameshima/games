import assert from "node:assert/strict";
import { after, test } from "node:test";
import { resolve } from "node:path";
import { Box3, Group, InstancedMesh, Matrix4, Mesh, Vector3 } from "three";
import { createServer } from "vite";

const server = await createServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { middlewareMode: true, watch: null },
  appType: "custom",
});
/** @type {typeof import('../src/ship-of-the-line/crew-animation.ts')} */
const animation = await server.ssrLoadModule("/src/ship-of-the-line/crew-animation.ts");
/** @type {typeof import('../src/ship-of-the-line/animation-gallery-data.ts')} */
const catalog = await server.ssrLoadModule("/src/ship-of-the-line/animation-gallery-data.ts");
/** @type {typeof import('../src/ship-of-the-line/crew-geometry.ts')} */
const handGeometry = await server.ssrLoadModule("/src/ship-of-the-line/crew-geometry.ts");

after(async () => { await server.close(); });

/** @param {ReadonlyArray<import('../src/ship-of-the-line/animation-gallery-data.ts').AnimationPreview>} [previews] @returns {{root: Group, animator: InstanceType<typeof animation.CrewAnimator>, previews: ReadonlyArray<import('../src/ship-of-the-line/animation-gallery-data.ts').AnimationPreview>, state: {time: number, crew: import('../src/ship-of-the-line/types.ts').CrewMember[]}}} */
function createAnimationFixture(previews = catalog.ANIMATION_PREVIEWS) {
  const root = new Group();
  return {
    root,
    animator: new animation.CrewAnimator(root, previews.length),
    previews,
    state: { time: 0, crew: previews.map(catalog.createAnimationPreviewCrew) },
  };
}

/** @param {ReturnType<typeof createAnimationFixture>} fixture @param {number} time @returns {void} */
function sampleFixture(fixture, time) {
  fixture.state.time = time;
  for (let index = 0; index < fixture.state.crew.length; index++) {
    catalog.sampleAnimationPreview(fixture.previews[index], fixture.state.crew[index], time);
  }
  fixture.animator.update(fixture.state, Infinity, null);
}

/** @param {Group} root @returns {void} */
function disposeFixture(root) {
  for (const child of root.children) {
    if (!(child instanceof Mesh)) continue;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  }
}

/** @returns {import('../src/ship-of-the-line/crew-animation.ts').ArmPose} */
function createArmPose() {
  return { shoulder: new Vector3(), elbow: new Vector3(), wrist: new Vector3(), flexion: 0 };
}

/** @param {ReturnType<typeof createAnimationFixture>} fixture @returns {number[]} */
function snapshotArms(fixture) {
  const values = [], pose = createArmPose();
  for (const crew of fixture.state.crew) {
    for (const side of /** @type {const} */ (["left", "right"])) {
      fixture.animator.readArmPose(crew.id, side, pose);
      values.push(...pose.shoulder, ...pose.elbow, ...pose.wrist, pose.flexion);
    }
  }
  return values;
}

test("every gallery animation preserves arm lengths and elbow flexion limits", () => {
  const fixture = createAnimationFixture(), pose = createArmPose();
  try {
    for (let frame = 0; frame <= catalog.ANIMATION_DURATION * 8; frame++) {
      const time = frame / 8;
      sampleFixture(fixture, time);
      for (const crew of fixture.state.crew) {
        for (const side of /** @type {const} */ (["left", "right"])) {
          fixture.animator.readArmPose(crew.id, side, pose);
          const context = `${catalog.ANIMATION_PREVIEWS[crew.id].id}, ${side}, ${time}s`;
          assert.ok(Number.isFinite(pose.flexion), `${context}: invalid flexion`);
          assert.ok(pose.flexion >= -.001, `${context}: negative elbow flexion`);
          assert.ok(pose.flexion <= animation.MAX_ELBOW_FLEXION + .001, `${context}: elbow exceeds its range`);
          assert.ok(Math.abs(pose.shoulder.distanceTo(pose.elbow) - .32) < .0001, `${context}: upper arm separates`);
          assert.ok(Math.abs(pose.elbow.distanceTo(pose.wrist) - .3) < .0001, `${context}: forearm separates`);
        }
      }
    }
  } finally {
    disposeFixture(fixture.root);
  }
});

test("returning to a frame does not inherit another sailor's IK rotation order", () => {
  const fixture = createAnimationFixture();
  try {
    fixture.animator.resetPoseHistory();
    sampleFixture(fixture, 7.125);
    const expected = snapshotArms(fixture);
    for (const time of [22.75, 1.5, 7.125]) {
      fixture.animator.resetPoseHistory();
      sampleFixture(fixture, time);
    }
    assert.deepEqual(snapshotArms(fixture), expected);
  } finally {
    disposeFixture(fixture.root);
  }
});

test("climbers bend through the pull and retain a planted hand during each transfer", () => {
  const previews = catalog.ANIMATION_PREVIEWS.filter(preview => preview.locomotion === "climb");
  const fixture = createAnimationFixture(previews), pose = createArmPose();
  const matrix = new Matrix4(), contact = new Vector3();
  const reach = new Vector3(), bendOffset = new Vector3();
  const hands = ["crew left hand", "crew right hand"].map(name => fixture.root.getObjectByName(name));
  const frames = 240, frameRate = 60;
  try {
    for (const crew of fixture.state.crew) {
      crew.heading = crew.id === 0 ? -1.3 : .8;
      const forward = new Vector3(Math.sin(crew.heading), 0, Math.cos(crew.heading));
      const minimum = [Infinity, Infinity], maximum = [-Infinity, -Infinity], planted = [0, 0];
      const previous = [new Vector3(), new Vector3()];
      let alternatingFlexion = 0;
      for (let frame = 0; frame <= frames; frame++) {
        sampleFixture(fixture, frame / frameRate);
        const flexion = [0, 0], holding = [false, false];
        for (let side = 0; side < 2; side++) {
          fixture.animator.readArmPose(crew.id, side === 0 ? "left" : "right", pose);
          reach.subVectors(pose.wrist, pose.shoulder);
          bendOffset.subVectors(pose.elbow, pose.shoulder);
          bendOffset.addScaledVector(reach, -bendOffset.dot(reach) / reach.lengthSq());
          const context = `${crew.name}, ${side === 0 ? "left" : "right"} arm, frame ${frame}`;
          assert.ok(bendOffset.y < -.005, `${context}: elbow folds above the reach`);
          assert.ok(bendOffset.dot(forward) > .005, `${context}: elbow folds behind the reach`);
          flexion[side] = pose.flexion;
          minimum[side] = Math.min(minimum[side], pose.flexion);
          maximum[side] = Math.max(maximum[side], pose.flexion);
          assert.ok(hands[side] instanceof InstancedMesh);
          hands[side].getMatrixAt(crew.id, matrix);
          contact.copy(handGeometry.SAILOR_HAND_GRIP).applyMatrix4(matrix);
          holding[side] = frame > 0 && contact.distanceTo(previous[side]) < .0001;
          if (holding[side]) planted[side]++;
          previous[side].copy(contact);
        }
        alternatingFlexion = Math.max(alternatingFlexion, Math.abs(flexion[0] - flexion[1]));
        if (frame > 0) assert.ok(holding.some(Boolean), `${crew.name}: both hands release during a transfer`);
      }
      for (let side = 0; side < 2; side++) {
        const context = `${crew.name}, ${side === 0 ? "left" : "right"} arm`;
        assert.ok(minimum[side] < 50 * Math.PI / 180, `${context}: never extends to reach`);
        assert.ok(maximum[side] > 95 * Math.PI / 180, `${context}: never bends into the pull`);
        assert.ok(maximum[side] - minimum[side] > 60 * Math.PI / 180, `${context}: elbow stays nearly rigid`);
        assert.ok(planted[side] > frames * .5, `${context}: slides instead of holding a ratline`);
      }
      assert.ok(alternatingFlexion > 50 * Math.PI / 180, `${crew.name}: arms do not alternate reach and pull`);
    }
  } finally {
    disposeFixture(fixture.root);
  }
});

/** @returns {import('../src/ship-of-the-line/animation-gallery-data.ts').AnimationPreview[]} */
function rodPreviewVariants() {
  return catalog.ANIMATION_PREVIEWS.filter(preview => preview.task === "ram" || preview.task === "sponge")
    .flatMap(preview => /** @type {const} */ (["idle", "walk", "stairs", "wait"]).map(locomotion => ({
      ...preview, id: `${preview.id}-${locomotion}`, locomotion, speed: 1.1,
      verticalSpeed: locomotion === "stairs" ? .55 : 0,
      waitingFor: locomotion === "wait" ? "walk" : undefined,
    })));
}

test("two-handed grips stay on the equipment with outward elbows and aligned wrists", () => {
  const previews = [...rodPreviewVariants(), ...catalog.ANIMATION_PREVIEWS.filter(preview => preview.carrying)];
  const fixture = createAnimationFixture(previews), pose = createArmPose();
  const handMatrix = new Matrix4(), toolMatrix = new Matrix4(), inverseTool = new Matrix4(), bodyMatrix = new Matrix4();
  const point = new Vector3(), bodyRight = new Vector3(), bodyUp = new Vector3(), delta = new Vector3(), axis = new Vector3();
  const contacts = [new Vector3(), new Vector3()];
  try {
    for (const crew of fixture.state.crew) crew.heading = (crew.id % 3 - 1) * Math.PI * .75;
    for (let frame = 0; frame <= catalog.ANIMATION_DURATION * 8; frame++) {
      sampleFixture(fixture, frame / 8);
      for (const crew of fixture.state.crew) {
        const rod = !crew.carrying;
        const tool = fixture.root.getObjectByName(rod ? "crew rammer" : "crew charge");
        assert.ok(tool instanceof InstancedMesh);
        tool.geometry.computeBoundingBox();
        tool.getMatrixAt(crew.id, toolMatrix);
        inverseTool.copy(toolMatrix).invert();
        fixture.animator.pickable.getMatrixAt(crew.id, bodyMatrix);
        bodyRight.setFromMatrixColumn(bodyMatrix, 0).normalize();
        bodyUp.setFromMatrixColumn(bodyMatrix, 1).normalize();
        for (const [index, side] of /** @type {const} */ ([[0, "left"], [1, "right"]])) {
          const hand = fixture.root.getObjectByName(`crew ${side} hand`);
          assert.ok(hand instanceof InstancedMesh);
          hand.getMatrixAt(crew.id, handMatrix);
          point.copy(handGeometry.SAILOR_HAND_GRIP).applyMatrix4(handMatrix).applyMatrix4(inverseTool);
          contacts[index].copy(point);
          const context = `${fixture.previews[crew.id].id}, ${side}, ${frame / 8}s`;
          if (rod) {
            assert.ok(Math.hypot(point.x, point.y) < .001, `${context}: fingers leave the shaft`);
            assert.ok(point.z > tool.geometry.boundingBox.min.z && point.z < tool.geometry.boundingBox.max.z,
              `${context}: grip falls beyond the shaft`);
            axis.setFromMatrixColumn(handMatrix, 0).transformDirection(inverseTool);
            assert.ok(Math.abs(axis.z) > .9, `${context}: grip twists across the rod`);
          } else {
            assert.ok(Math.abs(Math.hypot(point.y, point.z) - tool.geometry.boundingBox.max.z) < .01,
              `${context}: hands leave the powder charge surface`);
          }
          fixture.animator.readArmPose(crew.id, side, pose);
          if (rod) {
            axis.setFromMatrixColumn(handMatrix, 1).negate().normalize();
            point.subVectors(pose.wrist, pose.elbow).normalize();
            assert.ok(axis.dot(point) > .65, `${context}: wrist folds sharply away from the forearm`);
          }
          delta.subVectors(pose.elbow, pose.shoulder);
          const outward = delta.dot(bodyRight) * (side === "left" ? -1 : 1);
          assert.ok(outward >= -.01, `${context}: elbow folds inward across the chest`);
          assert.ok(delta.dot(bodyUp) < .02, `${context}: elbow rises above the shoulder`);
        }
        if (rod) {
          const spacing = contacts[0].z - contacts[1].z;
          assert.ok(spacing > .18 && spacing < .3, `${fixture.previews[crew.id].id}: hands cross or collide`);
        }
      }
    }
  } finally {
    disposeFixture(fixture.root);
  }
});

test("the shaft butt stays clear of the torso throughout retraction and travel", () => {
  const fixture = createAnimationFixture(rodPreviewVariants());
  const toolMatrix = new Matrix4(), bodyMatrix = new Matrix4(), relative = new Matrix4(), bounds = new Box3();
  try {
    const tool = fixture.root.getObjectByName("crew rammer");
    assert.ok(tool instanceof InstancedMesh);
    tool.geometry.computeBoundingBox();
    fixture.animator.pickable.geometry.computeBoundingBox();
    const chestFront = fixture.animator.pickable.geometry.boundingBox.max.z;
    for (const crew of fixture.state.crew) crew.heading = (crew.id % 3 - 1) * Math.PI * .75;
    for (let frame = 0; frame <= catalog.ANIMATION_DURATION * 8; frame++) {
      sampleFixture(fixture, frame / 8);
      for (const crew of fixture.state.crew) {
        fixture.animator.pickable.getMatrixAt(crew.id, bodyMatrix);
        tool.getMatrixAt(crew.id, toolMatrix);
        relative.copy(bodyMatrix).invert().multiply(toolMatrix);
        bounds.copy(tool.geometry.boundingBox).applyMatrix4(relative);
        assert.ok(bounds.min.z > chestFront + .015,
          `${fixture.previews[crew.id].id}, ${frame / 8}s: shaft penetrates or grazes the shirt`);
      }
    }
  } finally {
    disposeFixture(fixture.root);
  }
});
