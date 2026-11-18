import type { CrewLocomotion, CrewMember, CrewRole, CrewTask, CrewWaypoint } from "./types";

export const ANIMATION_DURATION = 30;
export const ANIMATION_SPACING = 6;

export interface AnimationPreview {
  readonly id: string;
  readonly label: string;
  readonly group: "Rest" | "Movement" | "Waiting" | "Gunnery" | "Sailing" | "Damage control" | "Duty";
  readonly description: string;
  readonly role: CrewRole;
  readonly task: CrewTask;
  readonly locomotion: CrewLocomotion;
  readonly speed?: number;
  readonly verticalSpeed?: number;
  readonly lateralSpeed?: number;
  readonly elevation?: number;
  readonly carrying?: boolean;
  readonly health?: number;
  readonly waitingFor?: CrewWaypoint["kind"];
}

// Order controls seeded pose variation; append cases to preserve existing pose links.
export const ANIMATION_PREVIEWS: readonly AnimationPreview[] = [
  { id: "rest-seated", label: "Off watch · seated", group: "Rest", description: "Even-seed seated rest, bent knees and relaxed hands.", role: "sailor", task: "off watch", locomotion: "idle" },
  { id: "rest-standing", label: "Off watch · standing", group: "Rest", description: "Odd-seed standing rest with head bowed.", role: "sailor", task: "off watch", locomotion: "idle" },
  { id: "idle", label: "Patrol · idle", group: "Movement", description: "Neutral stance and breathing. Patrol has no separate stationary work pose.", role: "sailor", task: "patrol", locomotion: "idle" },
  { id: "walk", label: "Walk", group: "Movement", description: "Distance-driven stride with planted feet and opposite arm swing.", role: "sailor", task: "patrol", locomotion: "walk", speed: 1.2 },
  { id: "walk-slow", label: "Walk · slow", group: "Movement", description: "Low-speed stride and reduced body sway.", role: "sailor", task: "patrol", locomotion: "walk", speed: .5 },
  { id: "walk-fast", label: "Walk · hurried", group: "Movement", description: "High-speed stride and stronger arm swing.", role: "sailor", task: "patrol", locomotion: "walk", speed: 1.8 },
  { id: "injured-left", label: "Injured walk · left leg", group: "Movement", description: "Even-seed injury, reduced left-leg stride and forward lean.", role: "sailor", task: "patrol", locomotion: "walk", speed: .7, health: 30 },
  { id: "injured-right", label: "Injured walk · right leg", group: "Movement", description: "Odd-seed injury, reduced right-leg stride and forward lean.", role: "sailor", task: "patrol", locomotion: "walk", speed: .7, health: 30 },
  { id: "stairs-up", label: "Stairs · ascending", group: "Movement", description: "High knee lift, forward lean and hands at the ladder.", role: "sailor", task: "muster", locomotion: "stairs", speed: .65, verticalSpeed: .55 },
  { id: "stairs-down", label: "Stairs · descending", group: "Movement", description: "Descending ladder posture driven by downward velocity.", role: "sailor", task: "muster", locomotion: "stairs", speed: .65, verticalSpeed: -.55 },
  { id: "climb-up", label: "Rigging · ascending", group: "Movement", description: "Alternating ratline reaches, planted grips and bent-elbow pulls.", role: "topman", task: "aloft", locomotion: "climb", verticalSpeed: .5, elevation: 12 },
  { id: "climb-down", label: "Rigging · descending", group: "Movement", description: "Controlled lowering from planted grips, then reaching down to the next ratline.", role: "topman", task: "aloft", locomotion: "climb", verticalSpeed: -.5, elevation: 12 },
  { id: "yard-left", label: "Yard · shuffle left", group: "Movement", description: "Crouched footrope shuffle with arms spread for balance.", role: "topman", task: "aloft", locomotion: "yard", lateralSpeed: -.3, elevation: 12 },
  { id: "yard-right", label: "Yard · shuffle right", group: "Movement", description: "The same footrope controller with rightward travel.", role: "topman", task: "aloft", locomotion: "yard", lateralSpeed: .3, elevation: 12 },
  { id: "wait-deck", label: "Queue · deck", group: "Waiting", description: "Stationary queue posture with slightly flexed elbows.", role: "sailor", task: "muster", locomotion: "wait", waitingFor: "walk" },
  { id: "wait-stairs", label: "Queue · stairs", group: "Waiting", description: "Waiting at a stair passage before climbing.", role: "sailor", task: "muster", locomotion: "wait", waitingFor: "stairs" },
  { id: "wait-rigging", label: "Queue · rigging", group: "Waiting", description: "Hanging posture while waiting for the next shroud passage.", role: "topman", task: "aloft", locomotion: "wait", waitingFor: "climb", elevation: 12 },
  { id: "wait-yard", label: "Queue · yard", group: "Waiting", description: "Hanging posture while waiting on a yard passage.", role: "topman", task: "aloft", locomotion: "wait", waitingFor: "yard", elevation: 12 },
  { id: "run-out", label: "Run out gun", group: "Gunnery", description: "Braced two-handed push and rocking torso.", role: "gunner", task: "run out", locomotion: "idle" },
  { id: "sponge", label: "Sponge bore", group: "Gunnery", description: "Two-handed sponge stroke with hand IK on the shaft.", role: "gunner", task: "sponge", locomotion: "idle" },
  { id: "fetch-powder", label: "Fetch powder · outbound", group: "Gunnery", description: "Unladen powder runner travelling to the magazine.", role: "powder runner", task: "fetch powder", locomotion: "walk", speed: 1.5 },
  { id: "carry-standing", label: "Carry charge · standing", group: "Gunnery", description: "Both hands hold the powder charge using the live hand IK.", role: "powder runner", task: "fetch powder", locomotion: "idle", carrying: true },
  { id: "carry-wait", label: "Carry charge · queued", group: "Gunnery", description: "Queued powder runner keeping both hands on the charge while waiting for a passage.", role: "powder runner", task: "fetch powder", locomotion: "wait", carrying: true, waitingFor: "walk" },
  { id: "carry-walk", label: "Carry charge · walking", group: "Gunnery", description: "Two-handed carrying overrides arm swing while the legs walk.", role: "powder runner", task: "fetch powder", locomotion: "walk", speed: 1.2, carrying: true },
  { id: "carry-stairs-up", label: "Carry charge · stairs up", group: "Gunnery", description: "Two-handed charge grip while ascending a ladder.", role: "powder runner", task: "fetch powder", locomotion: "stairs", speed: .65, verticalSpeed: .55, carrying: true },
  { id: "carry-stairs-down", label: "Carry charge · stairs down", group: "Gunnery", description: "Two-handed charge grip while descending a ladder.", role: "powder runner", task: "fetch powder", locomotion: "stairs", speed: .65, verticalSpeed: -.55, carrying: true },
  { id: "load", label: "Load gun", group: "Gunnery", description: "Bending and reaching through the loading motion.", role: "gunner", task: "load", locomotion: "idle" },
  { id: "ram", label: "Ram charge", group: "Gunnery", description: "Faster two-handed rammer stroke and forward body drive.", role: "gunner", task: "ram", locomotion: "idle" },
  { id: "aim", label: "Aim gun", group: "Gunnery", description: "Asymmetric crouched aiming stance.", role: "gunner", task: "aim", locomotion: "idle" },
  { id: "ready", label: "Gun ready", group: "Gunnery", description: "Low ready stance and scanning head turn.", role: "gunner", task: "ready", locomotion: "idle" },
  { id: "haul-braces", label: "Haul braces", group: "Sailing", description: "Wide arm pulls and opposing body lean.", role: "topman", task: "haul braces", locomotion: "idle" },
  { id: "work-aloft", label: "Work aloft", group: "Sailing", description: "Alternating sail-handling reach while crouched on a yard.", role: "topman", task: "aloft", locomotion: "idle", elevation: 12 },
  { id: "steer", label: "Steer", group: "Sailing", description: "Two-handed helm posture, head turn and slight roll.", role: "officer", task: "steer", locomotion: "idle" },
  { id: "repair", label: "Repair hull", group: "Damage control", description: "Right-handed hammer stroke with the left hand bracing.", role: "carpenter", task: "repair hull", locomotion: "idle" },
  { id: "hammer-walk", label: "Carry hammer · walking", group: "Damage control", description: "Walking with the carpenter's hammer in the right hand.", role: "carpenter", task: "repair hull", locomotion: "walk", speed: 1.1 },
  { id: "pump", label: "Man pumps", group: "Damage control", description: "Repeated pump stroke with crouch and torso motion.", role: "sailor", task: "pump", locomotion: "idle" },
  { id: "fight-fire", label: "Fight fire", group: "Damage control", description: "Bucket carry and periodic throwing motion.", role: "sailor", task: "fight fire", locomotion: "idle" },
  { id: "bucket-walk", label: "Carry bucket · walking", group: "Damage control", description: "Walking with a bucket in the right hand.", role: "sailor", task: "fight fire", locomotion: "walk", speed: 1.1 },
  { id: "tend-wounded", label: "Tend wounded", group: "Damage control", description: "Deep crouch, forward torso and both hands reaching.", role: "sailor", task: "tend wounded", locomotion: "idle" },
  { id: "muster", label: "Muster · at station", group: "Duty", description: "Neutral stance shared with idle patrol once at the muster point.", role: "sailor", task: "muster", locomotion: "idle" },
  { id: "marine-idle", label: "Marine · guard", group: "Duty", description: "Standing with musket held in the right hand.", role: "marine", task: "patrol", locomotion: "idle" },
  { id: "marine-walk", label: "Marine · patrol", group: "Duty", description: "Walking with the musket grip and stock visible.", role: "marine", task: "patrol", locomotion: "walk", speed: 1.2 },
  { id: "marine-aim", label: "Marine · aim", group: "Duty", description: "Aiming posture with the musket, distinct from gunner equipment.", role: "marine", task: "aim", locomotion: "idle" },
  { id: "marine-ready", label: "Marine · ready", group: "Duty", description: "Ready posture with the musket rather than the patrol grip rotation.", role: "marine", task: "ready", locomotion: "idle" },
];

export const ANIMATION_TASK_COVERAGE: Readonly<Record<CrewTask, string>> = {
  "off watch": "rest-seated", patrol: "idle", "haul braces": "haul-braces", aloft: "work-aloft",
  muster: "muster", "run out": "run-out", sponge: "sponge", "fetch powder": "fetch-powder",
  load: "load", ram: "ram", aim: "aim", ready: "ready", "repair hull": "repair",
  pump: "pump", "fight fire": "fight-fire", steer: "steer", "tend wounded": "tend-wounded",
};
export const ANIMATION_LOCOMOTION_COVERAGE: Readonly<Record<CrewLocomotion, string>> = {
  idle: "idle", walk: "walk", stairs: "stairs-up", climb: "climb-up", yard: "yard-left", wait: "wait-deck",
};

export function createAnimationPreviewCrew(preview: AnimationPreview, index: number): CrewMember {
  const crew: CrewMember = {
    id: index, name: preview.label, role: preview.role, task: preview.task,
    position: { x: index * ANIMATION_SPACING, y: preview.elevation ?? 0, z: 0 },
    destination: { x: index * ANIMATION_SPACING, y: preview.elevation ?? 0, z: 0 },
    route: preview.waitingFor ? [{ x: index * ANIMATION_SPACING, y: preview.elevation ?? 0, z: 0, kind: preview.waitingFor }] : [],
    routeIndex: 0, velocity: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, gait: 0,
    locomotion: preview.locomotion, carrying: preview.carrying ?? false, station: -1,
    health: preview.health ?? 100, fatigue: 0, progress: 0, moving: preview.locomotion !== "idle" && preview.locomotion !== "wait",
  };
  sampleAnimationPreview(preview, crew, 0);
  return crew;
}

export function sampleAnimationPreview(preview: AnimationPreview, crew: CrewMember, time: number): void {
  const forwardSpeed = preview.locomotion === "walk" || preview.locomotion === "stairs" ? preview.speed ?? 1.2 : 0;
  const verticalSpeed = preview.verticalSpeed ?? 0, lateralSpeed = preview.lateralSpeed ?? 0;
  crew.position.x = crew.id * ANIMATION_SPACING + lateralSpeed * time;
  crew.position.y = (preview.elevation ?? 0) + verticalSpeed * time;
  crew.position.z = forwardSpeed * time;
  crew.velocity.x = lateralSpeed;
  crew.velocity.y = verticalSpeed;
  crew.velocity.z = forwardSpeed;
  crew.speed = Math.hypot(lateralSpeed, verticalSpeed, forwardSpeed);
  crew.gait = crew.speed * time;
  crew.progress = time / ANIMATION_DURATION;
}
