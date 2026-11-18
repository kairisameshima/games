export type Vec3 = { x: number; y: number; z: number };
export type ViewMode = "exterior" | "xray" | "cutaway";
export type CrewRole =
  | "gunner"
  | "topman"
  | "marine"
  | "carpenter"
  | "powder runner"
  | "officer"
  | "sailor";
export type CrewTask =
  | "off watch"
  | "patrol"
  | "haul braces"
  | "aloft"
  | "muster"
  | "run out"
  | "sponge"
  | "fetch powder"
  | "load"
  | "ram"
  | "aim"
  | "ready"
  | "repair hull"
  | "pump"
  | "fight fire"
  | "steer"
  | "tend wounded";
export type Side = "port" | "starboard";
export type SailOrder = "full" | "battle" | "reef" | "furl";
export type Ammo = "round" | "chain" | "grape";
export type Aim = "hull" | "rigging" | "crew";
export type Command =
  | { type: "stations"; active: boolean }
  | { type: "sails"; order: SailOrder }
  | { type: "heading"; degrees: number }
  | { type: "fire"; side: Side | "both" }
  | { type: "fireAtWill"; active: boolean }
  | { type: "ammo"; ammo: Ammo }
  | { type: "aim"; aim: Aim }
  | { type: "repair"; active: boolean }
  | { type: "engage"; active: boolean };
export type CrewLocomotion = "idle" | "walk" | "stairs" | "climb" | "yard" | "wait";
export interface CrewWaypoint extends Vec3 {
  kind: "walk" | "stairs" | "climb" | "yard";
  passage?: number;
  flow?: number;
  mast?: number;
  level?: number;
  lateral?: number;
  onFootrope?: boolean;
  returning?: boolean;
}
export interface CrewMember {
  id: number;
  name: string;
  role: CrewRole;
  task: CrewTask;
  position: Vec3;
  destination: Vec3;
  route: CrewWaypoint[];
  routeIndex: number;
  velocity: Vec3;
  heading: number;
  speed: number;
  gait: number;
  locomotion: CrewLocomotion;
  carrying: boolean;
  station: number;
  health: number;
  fatigue: number;
  progress: number;
  moving: boolean;
}
export interface Gun {
  id: number;
  side: Side;
  deck: number;
  calibre: 32 | 18 | 9;
  battery: "lower" | "upper" | "quarterdeck" | "forecastle";
  position: Vec3;
  phase:
    | "unmanned"
    | "run out"
    | "sponge"
    | "load"
    | "ram"
    | "aim"
    | "ready"
    | "recoil";
  progress: number;
  crew: number[];
  loaded: Ammo;
  fireRequested: boolean;
  recoil: number;
}
export interface ShipState {
  position: Vec3;
  heading: number;
  targetHeading: number;
  speed: number;
  hull: number;
  rigging: number;
  fire: number;
  flooding: number;
  crewHealth: number;
  sail: number;
  targetSail: number;
  sailOrder: SailOrder;
  sunk: boolean;
}
export interface EnemyState extends ShipState {
  name: string;
  active: boolean;
  surrendered: boolean;
  reload: number;
}
export interface BattleEvent {
  id: number;
  kind: "shot" | "hit" | "splash" | "order" | "damage";
  time: number;
  text: string;
  position: Vec3;
  target?: Vec3;
  side?: Side;
  enemy?: boolean;
}
export interface SimulationState {
  time: number;
  crew: CrewMember[];
  guns: Gun[];
  ship: ShipState;
  enemy: EnemyState;
  stations: boolean;
  fireAtWill: boolean;
  repairing: boolean;
  ammo: Ammo;
  aim: Aim;
  powder: number;
  shot: number;
  wind: { direction: number; speed: number };
  events: BattleEvent[];
  log: BattleEvent[];
  shotsFired: number;
  hits: number;
}
export const DECK_HEIGHTS = [1, 3.4, 5.8, 8.2] as const;
export const MAST_X = [17, -2, -21] as const;
export const MAST_HEIGHTS = [42, 46, 38] as const;
export const YARD_HEIGHTS = [
  [23, 32, 39],
  [23, 33, 42],
  [20, 28, 35],
] as const;
export const SAIL_HEIGHTS = [
  [10, 7.4, 5.2],
  [10, 7.4, 5.2],
  [8, 6.4, 4.8],
] as const;
export const CREW_COUNT = 540;
export interface Simulation {
  state: SimulationState;
  command(command: Command): void;
  update(seconds: number): void;
  debugCrew(id: number): CrewDebug;
}

// Raw crowd-agent state for one sailor on the deck navmesh.
export interface CrowdAgentDebug {
  agentState: number;
  targetState: number;
  partialPath: boolean;
  updateFlags: number;
  maxSpeed: number;
  desiredSpeed: number;
  velocity: Vec3;
  desiredVelocity: Vec3;
  target: Vec3 | null;
  goal: Vec3 | null;
  corners: number;
  corridorPolygons: number;
  neighbours: number[];
}

export interface NavigationDebug {
  crowd: CrowdAgentDebug | null;
  pendingDestination: Vec3 | null;
  replanInSeconds: number;
  settling: boolean;
  heldForSingleFile: boolean;
  blockedSeconds: number;
  landing: { key: string; leaderId: number | null; waiting: number } | null;
  floorSlot: string | null;
  routeIndex: number;
  route: CrewWaypoint[];
}

export interface CrewDebug {
  time: number;
  id: number;
  name: string;
  role: CrewRole;
  task: CrewTask;
  locomotion: CrewLocomotion;
  moving: boolean;
  carrying: boolean;
  station: number;
  gunPhase: Gun["phase"] | null;
  position: Vec3;
  destination: Vec3;
  speed: number;
  heading: number;
  health: number;
  fatigue: number;
  progress: number;
  navigation: NavigationDebug;
  // Sailors within arm's reach on the same deck, with the same detail.
  nearby: (Omit<CrewDebug, "nearby"> & { distance: number })[];
}
