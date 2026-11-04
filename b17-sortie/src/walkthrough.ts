import * as THREE from 'three';
import { toX } from './scene/hull';
import type { CrewStation } from './scene/interior';
import { BOMB_BAY, BULKHEADS, CRAWLWAY, FLOORS } from './scene/interior/layout';

/** A point on the crew's way through the ship: station, eye height, and offset to starboard, in model metres. */
interface RouteWaypoint { d: number; eyeY: number; z: number }

/** Eye height over a floor: crouched in the crawlways and doors, standing where the cabin allows. */
const CROUCH = 0.3;
const STAND = 1.0;

/**
 * The way the crew moved from the bombardier's seat to the tail gunner's knee pads: aft past the navigator, through
 * bulkhead 4 and along the crawlway, up through the opening behind the pilots, round the top turret, down the step onto
 * the catwalk between the bomb racks, through the radio room, past the ball turret on its starboard side, over the tail
 * wheel well and up the narrowing tail.
 */
const CREW_ROUTE: RouteWaypoint[] = [
  { d: 1.7, eyeY: FLOORS.nose.y + 0.75, z: 0.3 },
  { d: 2.4, eyeY: FLOORS.nose.y + 0.75, z: 0.3 },
  { d: BULKHEADS.noseToCockpit - 0.1, eyeY: FLOORS.crawlway.y + CROUCH, z: 0.05 },
  { d: BULKHEADS.noseToCockpit + 0.15, eyeY: FLOORS.crawlway.y + CROUCH, z: 0 },
  { d: CRAWLWAY.exit.d - 0.15, eyeY: FLOORS.crawlway.y + CROUCH, z: 0 },
  { d: CRAWLWAY.exit.d, eyeY: FLOORS.cockpit.y + 0.2, z: 0 },
  { d: CRAWLWAY.exit.d + 0.1, eyeY: FLOORS.cockpit.y + STAND - 0.05, z: 0 },
  { d: FLOORS.flightDeck.start, eyeY: FLOORS.flightDeck.y + STAND, z: 0.45 },
  { d: BULKHEADS.frontSpar - 0.3, eyeY: FLOORS.flightDeck.y + STAND, z: 0.45 },
  { d: BULKHEADS.frontSpar - 0.08, eyeY: FLOORS.flightDeck.y + 0.8, z: 0 },
  { d: BULKHEADS.frontSpar + 0.05, eyeY: FLOORS.flightDeck.y + 0.65, z: 0 },
  { d: BOMB_BAY.step.endD - 0.15, eyeY: BOMB_BAY.step.topY + 0.8, z: 0 },
  { d: BOMB_BAY.step.endD + 0.15, eyeY: BOMB_BAY.catwalkY + 0.95, z: 0 },
  { d: BULKHEADS.rearSpar - 0.2, eyeY: BOMB_BAY.catwalkY + 0.95, z: 0 },
  { d: BULKHEADS.rearSpar, eyeY: FLOORS.radioRoom.y + 0.95, z: 0 },
  { d: BULKHEADS.rearSpar + 0.5, eyeY: FLOORS.radioRoom.y + 1.05, z: 0 },
  { d: BULKHEADS.radioToWaist - 0.2, eyeY: FLOORS.radioRoom.y + 1.05, z: 0 },
  { d: BULKHEADS.radioToWaist + 0.05, eyeY: 0.15, z: 0 },
  { d: 10.85, eyeY: 0, z: 0.25 },
  { d: 11.12, eyeY: 0, z: 0.75 },
  { d: 11.6, eyeY: 0, z: 0.3 },
  { d: 13.9, eyeY: -0.05, z: 0 },
  { d: 16.2, eyeY: -0.15, z: 0 },
  { d: 16.6, eyeY: 0.15, z: 0 },
  { d: 17.2, eyeY: -0.15, z: 0 },
  { d: 18.5, eyeY: 0, z: 0 },
  { d: 20.2, eyeY: 0.15, z: 0 },
  { d: 20.75, eyeY: 0.2, z: 0 },
];

/** Walking pace along the route, in model metres per second of film. */
const WALK_SPEED = 2.2;
/** How far ahead along the route the eye looks while walking. */
const LOOK_AHEAD = 0.9;
/** Where the walk stops short of a station, so the eye ends beside the crewman rather than in him. */
const STOP_SHORT = 0.7;
/** Over this last stretch the gaze turns from the way ahead to the station. */
const TURN_TO_STATION = 1.4;
/** Seconds to step in from wherever the camera was to the route. */
const ENTRY_SECONDS = 1.2;

interface Entry { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; progress: number }

/**
 * Walks the camera along the crew's route through the cut-away lead ship to a station, an exposure at a time, looking
 * ahead and turning to the station at the end. The route is in the ship's model space, so the walk rides with the ship.
 */
export class Walkthrough {
  private readonly points: THREE.Vector3[];
  /** Arc length along the route at each point. */
  private readonly arcs: number[];
  /** Where on the route the eye stands, or null before the first walk. */
  private arc: number | null = null;
  private destination: { arc: number; station: CrewStation } | null = null;
  private entry: Entry | null = null;
  private readonly scratch = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();
  private readonly stationWorld = new THREE.Vector3();

  constructor(private readonly root: THREE.Object3D) {
    this.points = CREW_ROUTE.map((point) => new THREE.Vector3(toX(point.d), point.eyeY, point.z));
    this.arcs = [0];
    for (let index = 1; index < this.points.length; index++) {
      this.arcs.push(this.arcs[index - 1] + this.points[index].distanceTo(this.points[index - 1]));
    }
  }

  get active(): boolean {
    return this.destination !== null;
  }

  /**
   * Starts a walk to `station`: from where the last walk ended, or, the first time, stepping in from the camera's pose
   * to the route point nearest what it was looking at.
   */
  walkTo(station: CrewStation, cameraPosition: THREE.Vector3, lookTarget: THREE.Vector3): void {
    const stationArc = this.nearestArc(this.stationInModel(station));
    if (this.arc === null) {
      this.arc = this.nearestArc(this.root.worldToLocal(this.scratch.copy(lookTarget)));
      this.entry = { fromPosition: cameraPosition.clone(), fromTarget: lookTarget.clone(), progress: 0 };
    }
    const fromFore = stationArc >= this.arc;
    const stopArc = THREE.MathUtils.clamp(stationArc + (fromFore ? -STOP_SHORT : STOP_SHORT), 0, this.length);
    this.destination = { arc: stopArc, station };
  }

  cancel(): void {
    this.destination = null;
    this.entry = null;
  }

  /** Moves one exposure along the walk, writing the eye and its look target in world space. */
  step(deltaSec: number, cameraPosition: THREE.Vector3, lookTarget: THREE.Vector3): void {
    if (!this.destination || this.arc === null) return;
    const { arc: stopArc, station } = this.destination;
    if (this.entry) {
      this.entry.progress = Math.min(this.entry.progress + deltaSec / ENTRY_SECONDS, 1);
      const eased = THREE.MathUtils.smootherstep(this.entry.progress, 0, 1);
      cameraPosition.lerpVectors(this.entry.fromPosition, this.worldAt(this.arc, this.scratch), eased);
      lookTarget.lerpVectors(this.entry.fromTarget, this.worldAt(this.arc + Math.sign(stopArc - this.arc) * LOOK_AHEAD, this.scratch), eased);
      if (this.entry.progress >= 1) this.entry = null;
      return;
    }
    const direction = Math.sign(stopArc - this.arc);
    this.arc = direction === 0 ? stopArc : THREE.MathUtils.clamp(this.arc + direction * WALK_SPEED * deltaSec, Math.min(this.arc, stopArc), Math.max(this.arc, stopArc));
    this.worldAt(this.arc, cameraPosition);
    const ahead = this.worldAt(this.arc + (direction || 1) * LOOK_AHEAD, this.scratch);
    const stationWorld = this.stationWorldPosition(station);
    const turn = THREE.MathUtils.smoothstep(TURN_TO_STATION - Math.abs(stopArc - this.arc), 0, TURN_TO_STATION);
    lookTarget.lerpVectors(ahead, stationWorld, turn);
    if (this.arc === stopArc) this.destination = null;
  }

  private get length(): number {
    return this.arcs[this.arcs.length - 1];
  }

  /** World position of the route point at arc length `arc`, clamped to the route's ends. */
  private worldAt(arc: number, target: THREE.Vector3): THREE.Vector3 {
    const clamped = THREE.MathUtils.clamp(arc, 0, this.length);
    let index = 1;
    while (index < this.arcs.length - 1 && this.arcs[index] < clamped) index++;
    const span = this.arcs[index] - this.arcs[index - 1];
    const t = span > 0 ? (clamped - this.arcs[index - 1]) / span : 0;
    target.lerpVectors(this.points[index - 1], this.points[index], t);
    return this.root.localToWorld(target);
  }

  /** Arc length of the route point nearest a model-space position. */
  private nearestArc(model: THREE.Vector3): number {
    let bestArc = 0;
    let bestDistance = Infinity;
    for (let index = 1; index < this.points.length; index++) {
      const segment = new THREE.Line3(this.points[index - 1], this.points[index]);
      const t = segment.closestPointToPointParameter(model, true);
      const distance = segment.at(t, this.closest).distanceTo(model);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestArc = THREE.MathUtils.lerp(this.arcs[index - 1], this.arcs[index], t);
      }
    }
    return bestArc;
  }

  private stationWorldPosition(station: CrewStation): THREE.Vector3 {
    return (station.space ?? this.root).localToWorld(this.stationWorld.copy(station.anchor));
  }

  private stationInModel(station: CrewStation): THREE.Vector3 {
    return this.root.worldToLocal(this.stationWorldPosition(station).clone());
  }
}
