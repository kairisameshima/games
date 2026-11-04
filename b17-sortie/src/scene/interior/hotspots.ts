import * as THREE from 'three';
import { STATIONS } from '../b17-dimensions';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { BOMB_BAY, COCKPIT, CRAWLWAY, FLOORS, NOSE, RADIO_ROOM, TAIL, WAIST, WALL_FITTINGS } from './layout';
import { tailFloorHeight, waistFloorHeight } from './structure';

/** A fitting the cutaway can name on hover: what it is, the figure or page it was modelled from, and where it is. */
export interface Hotspot {
  label: string;
  source: string;
  /** In the aircraft's model space. */
  anchor: THREE.Vector3;
}

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);

/** A point just inboard of the port wall at a station and height. */
const portWall = (d: number, y: number) => v(d, y, -(hullHalfWidthAtHeight(d, y) - 0.05));

/**
 * The fittings worth naming, on the centreline or the port side: the cutaway hides the starboard wall's equipment.
 * Figure numbers are the B-17 Pilot's Manual's; the forward hatch is from the EAA B-17G manual.
 */
export function fittingHotspots(): Hotspot[] {
  const step = BOMB_BAY.step;
  const hatch = CRAWLWAY.forwardHatch;
  const radioTable = RADIO_ROOM.table;
  const navigatorTable = NOSE.navigatorTable;
  return [
    { label: 'Norden M-9 bombsight', source: "Pilot's Manual fig. 43", anchor: v(NOSE.bombsight.d, NOSE.bombsight.eyepieceY + 0.06, 0) },
    { label: "Navigator's table", source: "Pilot's Manual figs. 45–46", anchor: v((navigatorTable.start + navigatorTable.end) / 2, navigatorTable.topY + 0.02, navigatorTable.innerZ - 0.12) },
    { label: 'Interphone jack box BC-366', source: "Pilot's Manual fig. 28", anchor: portWall(WALL_FITTINGS.navigatorJackBox.d, WALL_FITTINGS.navigatorJackBox.y) },
    { label: 'A-12 oxygen regulator', source: "Pilot's Manual fig. 14", anchor: portWall(WALL_FITTINGS.navigatorRegulator.d, WALL_FITTINGS.navigatorRegulator.y) },
    { label: 'Forward entrance hatch, guard and red release', source: 'EAA B-17G manual, nose section', anchor: v((hatch.start + hatch.end) / 2, FLOORS.crawlway.y + 0.02, (hatch.inner + hatch.outer) / 2) },
    { label: 'Control pedestal', source: "Pilot's Manual fig. 21", anchor: v((COCKPIT.pedestal.startD + COCKPIT.pedestal.endD) / 2, COCKPIT.pedestal.topY + 0.02, 0) },
    { label: 'Upper turret', source: "Pilot's Manual figs. 49–51", anchor: v(STATIONS.topTurret.d, hullSectionAt(STATIONS.topTurret.d).top - 0.1, 0) },
    { label: 'Catwalk step: bomb door crank, emergency bomb release', source: "Pilot's Manual figs. 34, 56", anchor: v(step.endD - 0.12, step.topY + 0.03, 0) },
    { label: 'Bomb rack and B-7 shackles', source: "Pilot's Manual fig. 58", anchor: v((step.endD + RADIO_ROOM.table.start) / 2, BOMB_BAY.lowestTierY + 2 * BOMB_BAY.tierSpacing, -BOMB_BAY.rackFrameZ) },
    { label: "Radio operator's table, command receivers", source: "Pilot's Manual figs. 61–62", anchor: v((radioTable.start + radioTable.end) / 2, radioTable.topY + 0.05, radioTable.innerZ - 0.15) },
    { label: 'Liaison transmitter BC-375 and tuning units', source: "Pilot's Manual figs. 63, 65", anchor: v(RADIO_ROOM.transmitter.d, 0.1, RADIO_ROOM.transmitter.z) },
    { label: 'Radio compartment gun', source: "Pilot's Manual fig. 66", anchor: v((STATIONS.radioHatch.start + STATIONS.radioHatch.end) / 2, hullSectionAt(9.5).top - 0.15, 0) },
    { label: 'Ball turret', source: "Pilot's Manual figs. 70–74", anchor: v(STATIONS.ballTurret.d, waistFloorHeight(STATIONS.ballTurret.d) + 0.25, 0) },
    { label: 'Left waist gun', source: "Pilot's Manual fig. 77", anchor: v(WAIST.portGunD, WAIST.gunY, -(hullHalfWidthAtHeight(WAIST.portGunD, WAIST.gunY) - 0.25)) },
    { label: "Tail gunner's knee pads and seat", source: "Pilot's Manual figs. 78–81", anchor: v(TAIL.gunnerD, tailFloorHeight(TAIL.gunnerD) + 0.1, 0) },
  ];
}

