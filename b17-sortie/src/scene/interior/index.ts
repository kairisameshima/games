import * as THREE from 'three';
import { figureMesh, type CrewMember, type FigureDetail } from '../crew/figure';
import { meshFigureInWorker } from '../crew/figure-pool';
import type { MountedGun } from '../gunnery';
import type { M2Gun } from '../m2';
import { hullHalfWidthAtHeight, toX } from '../hull';
import { buildSkeleton } from '../crew/skeleton';
import { buildBombBay, buildRadioRoom } from './bomb-bay';
import { buildCockpit } from './cockpit';
import { interiorMaterials } from './materials';
import { buildNose } from './nose';
import type { CompartmentContext, CrewStation, StationCrew } from './parts';
import { addFloors, addSkinAndStructure, tailFloorHeight, waistFloorHeight } from './structure';
import { addStationFittings } from './fittings';
import { BOMB_BAY, BULKHEADS, FLOORS, TAIL, WAIST } from './layout';
import { STATIONS } from '../b17-dimensions';
import type { WindowCutouts } from '../window-cutouts';
import { buildWaistAndTail } from './waist';

export type { CrewStation } from './parts';

export interface InteriorHosts {
  /** Static parent, merged per material by the caller. */
  airframe: THREE.Object3D;
  /** Parent for parts that move, change visibility, or carry per-vertex attributes (the crew). */
  root: THREE.Object3D;
  /** Hull-shaped shells whose inner faces become the interior skin. */
  shells: THREE.BufferGeometry[];
  topTurretYaw: THREE.Object3D;
  topTurretPitch: THREE.Object3D;
  topTurretGuns: M2Gun[];
  ballTurretGuns: M2Gun[];
  ballTurretPitch: THREE.Object3D;
  createBomb: () => THREE.Object3D;
  /** The hull's window openings, cut through the interior skin too. */
  windowCutouts: WindowCutouts;
}

export interface B17Interior {
  rackedBombs: THREE.Object3D[];
  stations: CrewStation[];
  /** Equipment on the starboard wall: in a cutaway it would float in front of the men, so the cutaway hides it. */
  starboardWall: THREE.Group;
  /** Structure the cutaway slices with the skin, so only the port half of each frame and bulkhead remains. */
  clipMaterials: THREE.Material[];
  /** Each man, his figure mesh, and the group carrying it: what the fit audit checks against the hull. */
  crew: { station: StationCrew; mesh: THREE.Mesh }[];
  /**
   * The men with a replacement figure for the No. 3 hit: the figure he flies in, and the reacting one, hidden until the
   * film swaps it in. Built on the fully detailed ship only, which the cutaway opens.
   */
  reactions: { calm: THREE.Mesh; reacting: { station: StationCrew; mesh: THREE.Mesh } }[];
  /** The guns the interior built or fed, with their belts and where their cases fall. */
  guns: MountedGun[];
}

/** Head-top clearance for a callout pinned above a man. */
const CALLOUT_LIFT = 0.16;
/** Equipment whose centre lies within this distance of the starboard skin counts as wall-mounted. */
const STARBOARD_WALL_DEPTH = 0.32;
const STARBOARD_WALL_MIN_Z = 0.5;

/** Every ship flies the same crew poses, so each man is meshed once per detail level and the geometry shared. */
const figureGeometries = new Map<string, Promise<THREE.BufferGeometry>>();

/** The man's mesh, empty until his figure comes back from the meshing worker. */
function crewMesh(member: CrewMember, variant: 'calm' | 'reacting', detail: FigureDetail): THREE.Mesh {
  const key = `${member.role}|${variant}|${detail}`;
  let geometry = figureGeometries.get(key);
  if (!geometry) {
    geometry = meshFigureInWorker(member, detail);
    figureGeometries.set(key, geometry);
  }
  const mesh = figureMesh(member, detail, new THREE.BufferGeometry());
  void geometry.then((meshed) => {
    mesh.geometry.dispose();
    mesh.geometry = meshed;
  });
  return mesh;
}

function calloutAnchor(crew: StationCrew): THREE.Vector3 {
  const skeleton = buildSkeleton(crew.member.pose);
  const joint = crew.placement === 'above' ? skeleton.head.position : skeleton.pelvis.position;
  const anchor = joint.clone().multiplyScalar(crew.member.stature ?? 1);
  if (crew.placement === 'above') anchor.y += CALLOUT_LIFT;
  return crew.host ? crew.host.localToWorld(anchor) : anchor;
}

export function buildInterior(hosts: InteriorHosts, detail: FigureDetail): B17Interior {
  const materials = interiorMaterials();
  hosts.windowCutouts.apply(materials.skin);
  addSkinAndStructure(hosts.airframe, materials, hosts.shells);
  addFloors(hosts.airframe, materials);
  // Turret groups sit in root space while the airframe is built, so their local→world is local→root here.
  hosts.root.updateMatrixWorld(true);
  // Compartment equipment is built into its own group first, then sorted between the airframe and the starboard wall.
  const equipment = new THREE.Group();
  const guns: MountedGun[] = [];
  const context: CompartmentContext = {
    parent: equipment, root: hosts.root, materials,
    topTurretYaw: hosts.topTurretYaw, topTurretPitch: hosts.topTurretPitch, topTurretGuns: hosts.topTurretGuns, ballTurretGuns: hosts.ballTurretGuns, guns, ballTurretPitch: hosts.ballTurretPitch, createBomb: hosts.createBomb,
  };
  const bombBay = buildBombBay(context);
  addStationFittings(equipment, materials, {
    bulkheads: BULKHEADS,
    floors: { nose: FLOORS.nose.y, radioRoom: FLOORS.radioRoom.y, catwalk: BOMB_BAY.catwalkY },
    waistFloorAt: waistFloorHeight,
    tailFloorAt: tailFloorHeight,
    radioHatch: { start: STATIONS.radioHatch.start, end: STATIONS.radioHatch.end, halfWidth: STATIONS.radioHatch.width / 2 },
    waist: {
      starboardWindow: [STATIONS.waistWindowStarboard.start, STATIONS.waistWindowStarboard.end],
      portWindow: [STATIONS.waistWindowPort.start, STATIONS.waistWindowPort.end],
      door: [WAIST.door.start, WAIST.door.end],
      windowMiddleY: (STATIONS.waistWindowBand.top + STATIONS.waistWindowBand.bottom) / 2,
    },
    tailGunnerD: TAIL.gunnerD,
  });
  const compartments = [buildNose(context), buildCockpit(context), bombBay, buildRadioRoom(context), buildWaistAndTail(context)];

  const starboardWall = sortStarboardWall(equipment, hosts.airframe);
  hosts.root.add(starboardWall);

  const crew = compartments.flatMap((compartment) => compartment.crew);
  const placeFigure = (station: StationCrew, member: CrewMember, variant: 'calm' | 'reacting'): THREE.Mesh => {
    const mesh = crewMesh(member, variant, detail);
    // The figure's mesh sits at the origin; its pelvis says which compartment it is in.
    mesh.userData.stationX = buildSkeleton(member.pose).pelvis.position.x * (member.stature ?? 1);
    // Its geometry arrives later from a worker, so no merge may fold it in.
    mesh.userData.unmerged = true;
    (station.host ?? hosts.root).add(mesh);
    return mesh;
  };
  const figures = crew.map((station) => ({ station, mesh: placeFigure(station, station.member, 'calm') }));
  const reactions = detail === 'high'
    ? figures.flatMap(({ station, mesh }) => {
      if (!station.reaction) return [];
      const reacting = placeFigure(station, station.reaction, 'reacting');
      reacting.visible = false;
      return [{ calm: mesh, reacting: { station: { ...station, member: station.reaction }, mesh: reacting } }];
    })
    : [];

  const stations: CrewStation[] = compartments.flatMap((compartment) => compartment.stations);
  const byLabel = new Map<string, { anchors: THREE.Vector3[]; placement: 'above' | 'below' }>();
  for (const man of crew) {
    const entry = byLabel.get(man.label) ?? { anchors: [], placement: man.placement };
    entry.anchors.push(calloutAnchor(man));
    byLabel.set(man.label, entry);
  }
  for (const [role, entry] of byLabel) {
    const anchor = entry.anchors.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(entry.anchors.length);
    stations.push({ role, anchor, placement: entry.placement, showsBombLoad: false });
  }
  return {
    rackedBombs: bombBay.rackedBombs, stations, crew: figures, reactions, starboardWall, guns,
    clipMaterials: [materials.frame, materials.frameGreen, materials.bulkheadWeb],
  };
}

function sortStarboardWall(equipment: THREE.Group, airframe: THREE.Object3D): THREE.Group {
  const wall = new THREE.Group();
  const bounds = new THREE.Box3();
  const centre = new THREE.Vector3();
  equipment.updateMatrixWorld(true);
  for (const child of [...equipment.children]) {
    bounds.setFromObject(child).getCenter(centre);
    const d = toX(centre.x);
    const onWall = !child.userData.staysInCutaway && centre.z > STARBOARD_WALL_MIN_Z && centre.z > hullHalfWidthAtHeight(d, centre.y) - STARBOARD_WALL_DEPTH;
    (onWall ? wall : airframe).add(child);
  }
  return wall;
}
