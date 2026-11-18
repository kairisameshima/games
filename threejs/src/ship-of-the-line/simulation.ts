import {
  CREW_COUNT,
  DECK_HEIGHTS,
  MAST_X,
  type Ammo,
  type BattleEvent,
  type Command,
  type CrewDebug,
  type CrewMember,
  type CrewRole,
  type CrewTask,
  type Gun,
  type ShipState,
  type Side,
  type Simulation,
  type SimulationState,
  type Vec3,
} from "./types";
import {
  DESIGN_WATERLINE,
  GUN_DIMENSIONS,
  GUN_MOUNT_FORWARD,
  GUN_STATIONS,
  SQUARE_SAIL_YARDS,
  deckContainsPoint,
  sailTrim,
  yardPosition,
} from "./layout";
import { CrewNavigation } from "./navigation";

const DEG = Math.PI / 180;
// A debug dump includes everyone within this reach of the sailor on the same deck.
const NEARBY_DISTANCE = 1.5;
const NEARBY_DECK_TOLERANCE = .3;
const SAIL_AREA = { full: 1, battle: 0.62, reef: 0.28, furl: 0 };
const PHASE_SECONDS = {
  "run out": 3,
  sponge: 4,
  load: 4,
  ram: 4,
  aim: 5,
  recoil: 2,
  ready: 0,
  unmanned: 0,
};
const FIRST_NAMES = [
  "Thomas",
  "William",
  "John",
  "James",
  "George",
  "Henry",
  "Edward",
  "Samuel",
  "Charles",
  "Robert",
  "Joseph",
  "Peter",
  "Isaac",
  "Francis",
  "Arthur",
  "Daniel",
  "Benjamin",
  "Walter",
  "Nicholas",
  "Matthew",
  "David",
  "Richard",
  "Philip",
  "Andrew",
  "Oliver",
  "Hugh",
  "Patrick",
  "Elias",
  "Nathaniel",
  "Simon",
];
const SURNAMES = [
  "Barlow",
  "Collins",
  "Drake",
  "Evans",
  "Fletcher",
  "Graves",
  "Hawkins",
  "Irving",
  "Jenkins",
  "Kemp",
  "Lawson",
  "Morgan",
  "Nash",
  "Oakes",
  "Parker",
  "Quinn",
  "Reed",
  "Sutton",
];
interface PendingShot {
  arrival: number;
  target: Vec3;
  enemy: boolean;
  ammo: Ammo;
  aim: "hull" | "rigging" | "crew";
  hit: boolean;
}

function shipState(): ShipState {
  return {
    position: { x: 0, y: 0, z: 0 },
    heading: 90,
    targetHeading: 90,
    speed: 3.2,
    hull: 100,
    rigging: 100,
    fire: 0,
    flooding: 0,
    crewHealth: 100,
    sail: 0.62,
    targetSail: 0.62,
    sailOrder: "battle",
    sunk: false,
  };
}
function wrappedAngle(angle: number): number {
  return ((angle + 540) % 360) - 180;
}
function worldPosition(ship: ShipState, point: Vec3): Vec3 {
  const cosine = Math.cos(ship.heading * DEG);
  const sine = Math.sin(ship.heading * DEG);
  return {
    x: ship.position.x + point.x * cosine - point.z * sine,
    y: point.y - DESIGN_WATERLINE,
    z: ship.position.z + point.x * sine + point.z * cosine,
  };
}
function crewRole(id: number): CrewRole {
  if (id < 296) return "gunner";
  if (id < 392) return "topman";
  if (id < 429) return "powder runner";
  if (id < 465) return "marine";
  if (id < 489) return "carpenter";
  if (id < 501) return "officer";
  return "sailor";
}
// Weather deck (index 3) is open to the sky only outside the quarterdeck/forecastle
// breaks and along the side gangways; anywhere else in the waist, fall back to the always-
// present upper gun deck floor below it.
function weatherPosition(x: number, z: number): Vec3 {
  return deckContainsPoint(3, x, z) ? { x, y: DECK_HEIGHTS[3], z } : { x, y: DECK_HEIGHTS[2], z };
}

function homePosition(id: number, role: CrewRole): Vec3 {
  const x = -24 + (id % 26) * 1.85;
  const z = ((Math.floor(id / 26) % 8) - 3.5) * 1.1;
  if (role === "officer")
    return { x: -24 + (id % 4) * 1.4, y: 10.4, z: ((id % 3) - 1) * 2 };
  if (role === "marine")
    return { x: -20 + (id % 20) * 2, y: 8.2, z: (id % 2 ? -1 : 1) * 4.8 };
  if (role === "topman") return weatherPosition(x, z);
  return { x, y: id % 3 === 0 ? 1 : id % 3 === 1 ? 3.4 : 5.8, z };
}

function magazinePosition(id: number): Vec3 {
  const runner = id - 392;
  return { x: -12 + (runner % 8) * .7, y: 1, z: -1.75 + Math.floor(runner / 8) * .7 };
}

function bracePosition(id: number): Vec3 {
  const index = id - 296;
  const mast = index % 3;
  const x = MAST_X[mast] + (Math.floor(index / 3) % 8 - 3.5) * .8;
  const z = (id % 2 ? -1 : 1) * (1.8 + (Math.floor(index / 24) % 4) * .65);
  return weatherPosition(x, z);
}

function atWorkstation(member: CrewMember): boolean {
  return member.health > 0 && !member.moving && Math.hypot(
    member.position.x-member.destination.x,
    member.position.y-member.destination.y,
    member.position.z-member.destination.z,
  ) < .4;
}

class NavalSimulation implements Simulation {
  readonly state: SimulationState;
  private randomSeed = 1805;
  private eventId = 0;
  private readonly pendingShots: PendingShot[] = [];
  private readonly delivery: number[] = [];
  private readonly reservedCharges: boolean[] = [];
  private readonly loadedCharge: boolean[] = [];
  private readonly navigation: CrewNavigation;
  private readonly requestedPositions: Vec3[] = [];
  private readonly patrolAt = new Float64Array(CREW_COUNT);
  private readonly patrolLeg = new Uint16Array(CREW_COUNT);
  private readonly runnerPoll = new Float64Array(CREW_COUNT);
  private watchInterval = 240;
  private repairInterval = 0;
  private lastHullWarning = 100;

  constructor() {
    const guns: Gun[] = GUN_STATIONS.map((station, id) => ({
      id,
      side: station.side,
      deck: station.deck,
      calibre: station.calibre,
      battery: station.battery,
      position: { ...station.position },
      phase: "unmanned",
      progress: 0,
      crew: [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3],
      loaded: "round",
      fireRequested: false,
      recoil: 0,
    }));
    for (let index = 0; index < guns.length; index++) {
      this.delivery.push(0);
      this.reservedCharges.push(false);
      this.loadedCharge.push(false);
    }
    this.navigation = new CrewNavigation(guns);
    const crew: CrewMember[] = [];
    for (let id = 0; id < CREW_COUNT; id++) {
      const role = crewRole(id);
      const member: CrewMember = {
        id,
        name: `${FIRST_NAMES[id % FIRST_NAMES.length]} ${SURNAMES[Math.floor(id / FIRST_NAMES.length)]}`,
        role,
        task: "off watch",
        position: homePosition(id, role),
        destination: homePosition(id, role),
        route: [],
        routeIndex: 0,
        velocity: { x: 0, y: 0, z: 0 },
        heading: (id % 8) * Math.PI / 4,
        speed: 0,
        gait: 0,
        locomotion: "idle",
        carrying: false,
        station:
          role === "gunner"
            ? Math.floor(id / 4)
            : role === "powder runner"
              ? id - 392
              : -1,
        health: 100,
        fatigue: 7 + (id % 13),
        progress: 0,
        moving: false,
      };
      this.requestedPositions.push({ ...member.destination });
      this.navigation.place(member);
      crew.push(member);
    }
    this.state = {
      time: 0,
      crew,
      guns,
      ship: shipState(),
      enemy: {
        ...shipState(),
        name: "L’Indomptable",
        active: false,
        surrendered: false,
        reload: 36,
        position: { x: -210, y: 0, z: 0 },
      },
      stations: false,
      fireAtWill: false,
      repairing: false,
      ammo: "round",
      aim: "hull",
      powder: 1480,
      shot: 1480,
      wind: { direction: 315, speed: 16 },
      events: [],
      log: [],
      shotsFired: 0,
      hits: 0,
    };
    this.assignWatch();
    this.event("order", "The morning watch has the deck. Steady on 090°.");
  }
  private random(): number {
    this.randomSeed = (Math.imul(this.randomSeed, 1664525) + 1013904223) >>> 0;
    return this.randomSeed / 4294967296;
  }
  private event(
    kind: BattleEvent["kind"],
    text: string,
    position: Vec3 = this.state.ship.position,
    extra: Partial<BattleEvent> = {},
  ): void {
    const event: BattleEvent = {
      id: ++this.eventId,
      kind,
      time: this.state.time,
      text,
      position: { ...position },
      ...extra,
    };
    this.state.events.push(event);
    if (kind !== "shot" && kind !== "splash") this.state.log.push(event);
    if (this.state.events.length > 200)
      this.state.events.splice(0, this.state.events.length - 200);
    if (this.state.log.length > 100)
      this.state.log.splice(0, this.state.log.length - 100);
  }
  private assign(member: CrewMember, task: CrewTask, destination: Vec3): void {
    if (member.health <= 0) return;
    const previous = this.requestedPositions[member.id];
    if (member.task === task && Math.hypot(previous.x-destination.x,previous.y-destination.y,previous.z-destination.z) < .03) return;
    member.task = task;
    member.progress = 0;
    this.patrolAt[member.id] = 0;
    previous.x = destination.x; previous.y = destination.y; previous.z = destination.z;
    this.navigation.planRoute(member, destination, sailTrim(this.state.ship.heading, this.state.wind.direction));
  }
  private assignWatch(): void {
    const watch = Math.floor(this.state.time / 240) % 2;
    for (const member of this.state.crew) {
      if (member.health <= 0) continue;
      if (member.role === "powder runner" && member.carrying) {
        member.station = -1;
        this.assign(member,"fetch powder",magazinePosition(member.id));
        continue;
      }
      if (member.role === "officer") {
        this.assign(
          member,
          member.id === 489 ? "steer" : "patrol",
          homePosition(member.id, member.role),
        );
        continue;
      }
      if (
        member.role === "topman" &&
        Math.abs(this.state.ship.sail - this.state.ship.targetSail) > 0.005
      ) {
        this.assignTopman(member);
        continue;
      }
      if (member.role === "carpenter" && this.state.repairing) continue;
      const onWatch = member.id % 2 === watch;
      const task: CrewTask = onWatch
        ? member.role === "topman"
          ? "haul braces"
          : "patrol"
        : "off watch";
      const onWatchX = -22 + (member.id % 25) * 1.8;
      const onWatchZ = ((member.id % 7) - 3) * 1.25;
      const destination = onWatch && member.role === "topman"
        ? bracePosition(member.id)
        : onWatch
          ? member.role === "gunner"
            ? { x: onWatchX, y: 3.4 + (member.id % 2) * 2.4, z: onWatchZ }
            : weatherPosition(onWatchX, onWatchZ)
          : {
              x: -23 + (member.id % 26) * 1.8,
              y: 1,
              z: ((Math.floor(member.id / 26) % 8) - 3.5) * 1.05,
            };
      this.assign(member, task, destination);
    }
  }
  private assignTopman(member: CrewMember): void {
    const index = member.id - 296;
    const yard = index % SQUARE_SAIL_YARDS.length;
    const { mast, level } = SQUARE_SAIL_YARDS[yard];
    const rank = Math.floor(index / SQUARE_SAIL_YARDS.length);
    const count = Math.floor((95 - yard) / SQUARE_SAIL_YARDS.length) + 1;
    const lateral = (rank - (count - 1) / 2) * .56;
    this.assign(member, "aloft", yardPosition(mast,level,lateral,sailTrim(this.state.ship.heading,this.state.wind.direction)));
  }
  private assignStations(): void {
    for (const gun of this.state.guns) {
      const surviving = gun.crew.filter((id) => this.state.crew[id].health > 0);
      if (surviving.length < 4) {
        const spare = this.state.crew.filter(
          (member) =>
            member.health > 0 &&
            member.role === "sailor" &&
            !this.state.guns.some((other) => other.crew.includes(member.id)),
        );
        while (surviving.length < 4 && spare.length)
          surviving.push(spare.shift()!.id);
        gun.crew = surviving;
      }
      gun.phase = "run out";
      gun.progress = 0;
      gun.crew.forEach((id, index) => {
        const member = this.state.crew[id];
        member.station = gun.id;
        this.assign(member, "muster", {
          x: gun.position.x + ((index % 2) - .5) * 1.5,
          y: gun.position.y,
          z: gun.position.z - (gun.side === "port" ? -1 : 1) * (index < 2 ? 1.25 : 1.95),
        });
      });
    }
    for (const member of this.state.crew) {
      if (member.role === "powder runner") this.sendRunner(member);
      if (member.role === "marine")
        this.assign(member, "muster", homePosition(member.id, member.role));
      if (member.role === "topman") {
        if (Math.abs(this.state.ship.sail - this.state.ship.targetSail) > 0.005)
          this.assignTopman(member);
        else
          this.assign(member, "haul braces", bracePosition(member.id));
      }
    }
  }
  private sendRunner(member: CrewMember): void {
    const first = member.id - 392;
    const guns = [this.state.guns[first], this.state.guns[first + 37]];
    const needed = [...guns, ...this.state.guns].find(
      (gun) =>
        gun &&
        gun.phase === "load" &&
        this.delivery[gun.id] === 0 &&
        !this.reservedCharges[gun.id],
    );
    if (!needed) {
      member.station = -1;
      this.assign(member, "fetch powder", member.carrying ? magazinePosition(member.id) : {
        x: -12 + (first % 10) * 2.3, y: 1, z: (first % 2 ? -1 : 1) * 2,
      });
      return;
    }
    member.station = needed.id;
    this.reservedCharges[needed.id] = true;
    if (member.carrying) this.assign(member,"load",{x:needed.position.x+(needed.deck===3 ? .5 : 1.05),y:needed.position.y,z:needed.position.z-(needed.side==="port"?-1:1)*2.55});
    else this.assign(member, "fetch powder", magazinePosition(member.id));
  }
  command(command: Command): void {
    const state = this.state;
    if (state.ship.sunk && command.type !== "engage") {
      this.event(
        "order",
        "The ship is lost. No further orders can be carried out.",
      );
      return;
    }
    switch (command.type) {
      case "stations":
        if (state.stations === command.active) break;
        state.stations = command.active;
        state.fireAtWill = false;
        for (const gun of state.guns) {
          gun.fireRequested = false;
          if (!command.active) {
            gun.phase = "unmanned";
            gun.progress = 0;
          }
        }
        // Ladder orders first, so every new route already respects the one-way ladders.
        this.navigation.setLadderOrders(command.active, sailTrim(state.ship.heading, state.wind.direction));
        if (command.active) this.assignStations();
        else {
          this.reservedCharges.fill(false);
          this.assignWatch();
        }
        this.event(
          "order",
          command.active
            ? "Beat to quarters. Gun crews muster, powder runners to the magazine."
            : "Stand down. Secure the guns and resume the watch.",
        );
        break;
      case "sails":
        if (state.ship.sailOrder === command.order) break;
        state.ship.sailOrder = command.order;
        state.ship.targetSail = SAIL_AREA[command.order];
        for (const member of state.crew)
          if (member.role === "topman") this.assignTopman(member);
        this.event(
          "order",
          `${command.order === "full" ? "Make all plain sail" : command.order === "battle" ? "Set battle sail" : command.order === "reef" ? "Reef the topsails" : "Furl all sail"}. Topmen aloft.`,
        );
        break;
      case "heading":
        if (!Number.isFinite(command.degrees)) return;
        state.ship.targetHeading = ((command.degrees % 360) + 360) % 360;
        this.event(
          "order",
          `Helm, steer ${Math.round(state.ship.targetHeading).toString().padStart(3, "0")}°. Keep her steady.`,
        );
        break;
      case "fire":
        if (!state.stations) {
          this.event(
            "order",
            "The guns are not manned. Beat to quarters first.",
          );
          break;
        }
        if (
          !state.enemy.active ||
          state.enemy.surrendered ||
          state.enemy.sunk
        ) {
          this.event("order", "No hostile target. Hold your fire.");
          break;
        }
        for (const side of ["port", "starboard"] as const)
          if (command.side === side || command.side === "both") {
            if (!this.inArc(side)) {
              this.event(
                "order",
                `${side === "port" ? "Port" : "Starboard"} battery cannot bear. Bring the enemy onto the beam, within 600 metres.`,
              );
              continue;
            }
            const battery = state.guns.filter(
              (gun) => gun.side === side && gun.phase === "ready",
            );
            for (const gun of battery) gun.fireRequested = true;
            this.event(
              "order",
              battery.length
                ? `${side === "port" ? "Port" : "Starboard"} broadside. Fire ${battery.length} guns!`
                : "The battery is still loading. Wait for ready guns.",
            );
          }
        break;
      case "fireAtWill":
        state.fireAtWill = command.active && state.stations;
        if (!command.active)
          for (const gun of state.guns) gun.fireRequested = false;
        this.event(
          "order",
          state.fireAtWill
            ? "Fire as your guns bear. Continue the action."
            : "Cease fire. Hold for my command.",
        );
        break;
      case "ammo":
        state.ammo = command.ammo;
        this.event(
          "order",
          `Load ${command.ammo === "round" ? "round shot" : command.ammo === "chain" ? "chain shot" : "grapeshot"} on the next cycle.`,
        );
        break;
      case "aim":
        state.aim = command.aim;
        this.event("order", `Lay the guns on the enemy’s ${command.aim}.`);
        break;
      case "repair":
        state.repairing = command.active;
        if (command.active) this.assignRepairs();
        else if (!state.stations) this.assignWatch();
        else
          for (const member of state.crew) {
            if (
              member.role === "carpenter" ||
              (member.role === "sailor" &&
                !state.guns.some((gun) => gun.crew.includes(member.id)))
            )
              this.assign(
                member,
                "patrol",
                homePosition(member.id, member.role),
              );
          }
        this.event(
          "order",
          command.active
            ? "Damage control. Carpenters to the hull, hands to pumps and fire buckets."
            : "Secure damage control. Return to your duties.",
        );
        break;
      case "engage":
        state.enemy.active = command.active;
        if (command.active) {
          Object.assign(state.enemy, shipState(), {
            active: true,
            surrendered: false,
            reload: 45,
          });
          state.enemy.position = worldPosition(state.ship, {
            x: 0,
            y: 0,
            z: 210,
          });
          state.enemy.heading = state.ship.heading;
          state.enemy.targetHeading = state.ship.heading;
          state.enemy.speed = state.ship.speed;
          this.pendingShots.length = 0;
          this.event(
            "order",
            "Sail on the starboard beam! L’Indomptable, 74 guns. Clear for action.",
          );
        } else {
          state.fireAtWill = false;
          this.pendingShots.length = 0;
          this.event("order", "Break off the action.");
        }
        break;
    }
  }
  private inArc(side: Side): boolean {
    const state = this.state;
    const dx = state.enemy.position.x - state.ship.position.x;
    const dz = state.enemy.position.z - state.ship.position.z;
    return (
      Math.hypot(dx, dz) <= 600 &&
      Math.abs(
        wrappedAngle(
          Math.atan2(dz, dx) / DEG -
            state.ship.heading -
            (side === "starboard" ? 90 : -90),
        ),
      ) <= 25
    );
  }
  private moveCrew(seconds: number): void {
    const state = this.state;
    this.navigation.step(state.crew, seconds, state.time, sailTrim(state.ship.heading,state.wind.direction));
    for (const member of state.crew) {
      if (member.health <= 0) continue;
      const resting = member.task === "off watch" && atWorkstation(member);
      member.fatigue = Math.max(0, Math.min(100, member.fatigue + seconds * (resting ? -.075 : member.moving ? .014 : .006)));
      if (!atWorkstation(member)) continue;
      member.progress = Math.min(1,member.progress + seconds / 12);
      this.faceWorkstation(member, seconds);
      if (member.task !== "patrol" || state.stations) continue;
      if (!this.patrolAt[member.id]) this.patrolAt[member.id] = state.time + 6 + member.id % 11;
      if (state.time < this.patrolAt[member.id]) continue;
      const leg = ++this.patrolLeg[member.id];
      const officer = member.role === "officer";
      const patrolX = officer ? -27 + (member.id + leg * 3) % 7 * 1.25 : -22 + (member.id * 7 + leg * 11) % 46;
      const patrolZ = officer ? (leg % 2 ? -1 : 1) * 2.9 : ((member.id + leg * 3) % 7 - 3) * .85;
      const patrolY = officer ? 10.4 : Math.abs(member.position.y - 8.2) < .1 ? weatherPosition(patrolX, patrolZ).y : member.position.y;
      this.assign(member, "patrol", { x: patrolX, y: patrolY, z: patrolZ });
    }
  }

  private faceWorkstation(member: CrewMember, seconds: number): void {
    let heading = member.heading;
    if (member.task === "aloft") heading = Math.PI / 2 + sailTrim(this.state.ship.heading,this.state.wind.direction);
    else if (member.station >= 0 && (member.role === "gunner" || member.role === "sailor" || member.task === "load")) {
      const gun = this.state.guns[member.station];
      heading = Math.atan2(gun.position.x-member.position.x,gun.position.z-member.position.z);
    } else if (member.task === "steer") heading = Math.atan2(-24-member.position.x,.8-member.position.z);
    else if (member.task === "haul braces") {
      const mast = MAST_X[(member.id - 296) % 3];
      heading = Math.atan2(mast-member.position.x,-member.position.z);
    } else if (member.task === "repair hull") heading = member.position.z < 0 ? Math.PI : 0;
    else if (member.task === "off watch") heading = member.position.z < 0 ? 0 : Math.PI;
    const difference = Math.atan2(Math.sin(heading-member.heading),Math.cos(heading-member.heading));
    member.heading += Math.max(-seconds*3,Math.min(seconds*3,difference));
  }
  private updateRunners(): void {
    for (const member of this.state.crew) {
      if (member.role !== "powder runner" || !atWorkstation(member)) continue;
      if (member.carrying && member.station < 0 && member.task === "fetch powder") {
        if (member.progress >= .25) {
          this.state.powder++; this.state.shot++; member.carrying = false;
          if (!this.state.stations) this.assign(member,"off watch",homePosition(member.id,member.role));
        }
        continue;
      }
      if (!this.state.stations) continue;
      if (member.station < 0) {
        if (this.state.time >= this.runnerPoll[member.id]) {
          this.runnerPoll[member.id] = this.state.time + .8;
          this.sendRunner(member);
        }
        continue;
      }
      const gun = this.state.guns[member.station];
      if (member.task === "fetch powder") {
        if (member.progress < 0.5) continue;
        if (this.state.powder <= 0 || this.state.shot <= 0) {
          this.reservedCharges[gun.id] = false;
          member.station = -1;
          continue;
        }
        this.state.powder--;
        this.state.shot--;
        member.carrying = true;
        this.assign(member, "load", {
          x: gun.position.x + (gun.deck === 3 ? .5 : 1.05),
          y: gun.position.y,
          z: gun.position.z - (gun.side === "port" ? -1 : 1) * 2.55,
        });
      } else if (member.task === "load") {
        if (member.progress < .1) continue;
        member.carrying = false;
        this.delivery[gun.id]++;
        this.reservedCharges[gun.id] = false;
        this.sendRunner(member);
      }
    }
  }
  private updateGuns(seconds: number): void {
    const state = this.state;
    for (const gun of state.guns) {
      gun.recoil = Math.max(0, gun.recoil - seconds * 0.65);
      if (!state.stations || state.ship.sunk) continue;
      const team = gun.crew
        .map((id) => state.crew[id])
        .filter((member) => atWorkstation(member) && Math.hypot(member.position.x-gun.position.x,member.position.z-gun.position.z) < 3.5);
      if (team.length < 2) continue;
      if (gun.phase === "ready") {
        for (const member of team) member.task = "ready";
        if (
          (gun.fireRequested || state.fireAtWill) &&
          state.enemy.active &&
          !state.enemy.surrendered &&
          !state.enemy.sunk &&
          this.inArc(gun.side)
        )
          this.fireGun(gun);
        continue;
      }
      if (gun.phase === "load" && this.delivery[gun.id] === 0) {
        for (const member of team) { member.task = "load"; member.progress = 0; }
        continue;
      }
      const duration = PHASE_SECONDS[gun.phase];
      gun.progress += (seconds / Math.max(1, duration)) * (team.length / 4);
      const task =
        gun.phase === "recoil"
          ? "run out"
          : gun.phase === "unmanned"
            ? "muster"
            : gun.phase;
      for (const member of team) {
        member.task = task;
        member.progress = gun.progress;
      }
      if (gun.progress < 1) continue;
      gun.progress = 0;
      switch (gun.phase) {
        case "recoil":
          gun.phase = "sponge";
          break;
        case "sponge":
          gun.phase = "load";
          break;
        case "load":
          this.delivery[gun.id]--;
          this.loadedCharge[gun.id] = true;
          gun.loaded = state.ammo;
          gun.phase = "ram";
          break;
        case "ram":
          gun.phase = "run out";
          break;
        case "run out":
          gun.phase = this.loadedCharge[gun.id] ? "aim" : "sponge";
          break;
        case "aim":
          gun.phase = "ready";
          break;
        default:
          gun.phase = "sponge";
      }
    }
  }
  private fireGun(gun: Gun): void {
    const state = this.state;
    const dims = GUN_DIMENSIONS[gun.calibre];
    const muzzle = GUN_MOUNT_FORWARD + 1.35 * dims.lengthScale;
    const sgn = gun.side === "starboard" ? 1 : -1;
    const from = worldPosition(state.ship, {
      x: gun.position.x,
      y: gun.position.y + dims.axisHeight,
      z: gun.position.z + sgn * muzzle,
    });
    const target = {
      ...state.enemy.position,
      y: (gun.loaded === "chain" || state.aim === "rigging" ? 18 : 5) - DESIGN_WATERLINE,
    };
    const range = Math.hypot(target.x - from.x, target.z - from.z);
    const accuracy =
      Math.max(0.08, 0.88 - range / 950) *
      (gun.loaded === "grape" && range > 180 ? 0.13 : 1);
    this.pendingShots.push({
      arrival: state.time + range / 105,
      target,
      enemy: false,
      ammo: gun.loaded,
      aim: state.aim,
      hit: this.random() < accuracy,
    });
    this.event("shot", "Broadside", from, { target, side: gun.side });
    state.shotsFired++;
    gun.recoil = 1;
    gun.phase = "recoil";
    gun.progress = 0;
    gun.fireRequested = false;
    this.delivery[gun.id] = 0;
    this.loadedCharge[gun.id] = false;
  }
  private assignRepairs(): void {
    for (const member of this.state.crew) {
      if (member.health <= 0) continue;
      if (member.role === "carpenter")
        this.assign(member, "repair hull", {
          x: -22 + ((member.id - 465) % 12) * 4,
          y: 1,
          z: member.id < 477 ? -3.4 : 3.4,
        });
      if (
        member.role === "sailor" &&
        !this.state.guns.some((gun) => gun.crew.includes(member.id))
      ) {
        const task: CrewTask =
          member.id % 3 === 0
            ? "pump"
            : member.id % 3 === 1
              ? "fight fire"
              : "tend wounded";
        const rank = Math.floor((member.id - 501) / 3);
        this.assign(member, task, {
          x: (task === "pump" ? -5 : task === "fight fire" ? 7 : -11) + (rank % 4) * .7,
          y: task === "fight fire" ? 5.8 : 1,
          z: -1.2 + Math.floor(rank / 4) * .7,
        });
      }
    }
  }
  private updateDamage(seconds: number): void {
    const ship = this.state.ship;
    let repairers = 0,
      pumps = 0,
      firefighters = 0,
      medics = 0;
    if (this.state.repairing)
      for (const member of this.state.crew) {
        if (!atWorkstation(member)) continue;
        if (member.task === "repair hull") repairers++;
        if (member.task === "pump") pumps++;
        if (member.task === "fight fire") firefighters++;
        if (member.task === "tend wounded") medics++;
      }
    ship.fire = Math.max(
      0,
      ship.fire +
        seconds * (ship.fire > 0 ? 0.002 * ship.fire : 0) -
        seconds * firefighters * 0.05,
    );
    ship.flooding = Math.max(
      0,
      ship.flooding +
        seconds * (ship.hull < 40 ? 0.025 : 0) -
        seconds * pumps * 0.045,
    );
    ship.hull = Math.max(
      0,
      Math.min(
        100,
        ship.hull +
          seconds * repairers * 0.012 -
          seconds * (ship.fire * 0.006 + ship.flooding * 0.004),
      ),
    );
    if (medics && this.state.time > this.repairInterval) {
      this.repairInterval = this.state.time + 2;
      for (const member of this.state.crew)
        if (member.health > 0 && member.health < 100)
          member.health = Math.min(100, member.health + medics * 0.07);
    }
    if (ship.hull < this.lastHullWarning - 20) {
      this.lastHullWarning = ship.hull;
      this.event(
        "damage",
        `Hull integrity ${Math.round(ship.hull)}%. ${ship.fire > 1 ? "Fire below decks! " : ""}Damage control required.`,
      );
    }
    if (ship.hull <= 0 && !ship.sunk) {
      ship.sunk = true;
      this.state.fireAtWill = false;
      this.event("damage", "The ship is sinking. Abandon ship.");
    }
    if (this.state.enemy.hull <= 0 && !this.state.enemy.sunk) {
      this.state.enemy.sunk = true;
      this.event("damage", "L’Indomptable is sinking. Cease fire.");
    } else if (
      (this.state.enemy.hull < 15 || this.state.enemy.crewHealth < 20) &&
      !this.state.enemy.surrendered
    ) {
      this.state.enemy.surrendered = true;
      this.event(
        "order",
        "L’Indomptable has struck her colours. The action is won.",
      );
    }
  }
  private updateEnemy(seconds: number): void {
    const state = this.state,
      enemy = state.enemy;
    if (!enemy.active || enemy.sunk || enemy.surrendered) return;
    const heading = state.ship.heading * DEG;
    const desired = {
      x: state.ship.position.x - Math.sin(heading) * 220,
      z: state.ship.position.z + Math.cos(heading) * 220,
    };
    // The opponent sails an offset parallel course rather than teleporting to a firing position.
    const desiredBearing =
      Math.atan2(desired.z - enemy.position.z, desired.x - enemy.position.x) /
      DEG;
    const errorDistance = Math.hypot(
      desired.x - enemy.position.x,
      desired.z - enemy.position.z,
    );
    const targetHeading =
      errorDistance > 85 ? desiredBearing : state.ship.heading;
    enemy.heading =
      (enemy.heading +
        Math.max(
          -seconds,
          Math.min(seconds, wrappedAngle(targetHeading - enemy.heading)),
        ) +
        360) %
      360;
    enemy.speed +=
      (Math.min(7, state.ship.speed + (errorDistance > 85 ? 2 : 0)) *
        (0.35 + (0.65 * enemy.rigging) / 100) -
        enemy.speed) *
      seconds *
      0.03;
    enemy.position.x +=
      Math.cos(enemy.heading * DEG) * enemy.speed * 0.5144 * seconds;
    enemy.position.z +=
      Math.sin(enemy.heading * DEG) * enemy.speed * 0.5144 * seconds;
    enemy.reload -= seconds;
    const range = Math.hypot(
      enemy.position.x - state.ship.position.x,
      enemy.position.z - state.ship.position.z,
    );
    if (enemy.reload > 0 || range > 600) return;
    const bearing =
      Math.atan2(
        state.ship.position.z - enemy.position.z,
        state.ship.position.x - enemy.position.x,
      ) / DEG;
    if (Math.abs(Math.abs(wrappedAngle(bearing - enemy.heading)) - 90) > 30)
      return;
    enemy.reload = 38 + this.random() * 12;
    this.event("damage", "Enemy broadside! Round shot incoming.");
    for (let index = 0; index < 20; index++) {
      const from = worldPosition(enemy, {
        x: -20 + index * 2,
        y: 3.4 + (index % 2) * 2.4,
        z: 0,
      });
      const target = worldPosition(state.ship, {
        x: -20 + this.random() * 40,
        y: 3.4,
        z: (this.random() - 0.5) * 9,
      });
      this.event("shot", "Enemy gunfire", from, { target, enemy: true });
      this.pendingShots.push({
        arrival: state.time + range / 105 + index * 0.035,
        target,
        enemy: true,
        ammo: "round",
        aim: "hull",
        hit: this.random() < 0.53,
      });
    }
  }
  private resolveShots(): void {
    const state = this.state;
    for (let index = this.pendingShots.length - 1; index >= 0; index--) {
      const shot = this.pendingShots[index];
      if (shot.arrival > state.time) continue;
      this.pendingShots.splice(index, 1);
      if (!shot.hit) {
        this.event("splash", "Shot falls short", { ...shot.target, y: 0 });
        continue;
      }
      const target = shot.enemy ? state.ship : state.enemy;
      const rigging = shot.ammo === "chain" || shot.aim === "rigging";
      const crew = shot.ammo === "grape" || shot.aim === "crew";
      target.hull = Math.max(
        0,
        target.hull - (rigging ? 0.13 : crew ? 0.15 : 0.72),
      );
      target.rigging = Math.max(0, target.rigging - (rigging ? 1.65 : 0.13));
      target.crewHealth = Math.max(0, target.crewHealth - (crew ? 2.1 : 0.25));
      if (!shot.enemy) state.hits++;
      if (shot.enemy) {
        if (this.random() < 0.12) target.fire += 0.5;
        if (this.random() < 0.18) target.flooding += 0.35;
        const casualties = 1 + Math.floor(this.random() * 3);
        for (let casualty = 0; casualty < casualties; casualty++) {
          const member =
            state.crew[Math.floor(this.random() * state.crew.length)];
          member.health = Math.max(0, member.health - 30 - this.random() * 55);
          if (member.health === 0) {
            member.carrying = false;
            member.speed = 0;
            member.locomotion = "idle";
            member.moving = false;
            member.route.length = 0;
            if (member.role === "powder runner" && member.station >= 0)
              this.reservedCharges[member.station] = false;
          }
        }
      }
      this.event(
        "hit",
        shot.enemy
          ? "Round shot strikes Resolute."
          : "Shot strikes L’Indomptable.",
        shot.target,
        { enemy: shot.enemy },
      );
    }
  }
  update(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const state = this.state;
    state.time += seconds;
    this.moveCrew(seconds);
    if (Math.abs(state.ship.sail - state.ship.targetSail) > 0.003) {
      const workers = state.crew.filter(
        (member) =>
          member.role === "topman" && atWorkstation(member) && member.position.y > 18 && member.task === "aloft",
      ).length;
      state.ship.sail +=
        Math.sign(state.ship.targetSail - state.ship.sail) *
        Math.min(
          Math.abs(state.ship.targetSail - state.ship.sail),
          (workers / 96) * seconds * 0.018,
        );
      if (Math.abs(state.ship.sail - state.ship.targetSail) < 0.003) {
        state.ship.sail = state.ship.targetSail;
        this.event(
          "order",
          `Sail order complete. ${Math.round(state.ship.sail * 100)}% canvas set.`,
        );
        for (const member of state.crew)
          if (member.role === "topman")
            this.assign(member, "haul braces", bracePosition(member.id));
      }
    }
    const ship = state.ship;
    const windAngle = Math.abs(
      wrappedAngle(ship.heading - state.wind.direction),
    );
    const windDrive =
      windAngle < 35
        ? 0
        : Math.sin(((windAngle - 35) / 145) * Math.PI * 0.8) * 0.9 + 0.1;
    const desiredSpeed = ship.sunk
      ? 0
      : state.wind.speed *
        0.67 *
        ship.sail *
        windDrive *
        (0.35 + (0.65 * ship.rigging) / 100) *
        (1 - ship.flooding * 0.015);
    ship.speed +=
      (Math.max(0, desiredSpeed) - ship.speed) * Math.min(1, seconds * 0.035);
    const helm = state.crew.some(
      (member) =>
        member.role === "officer" &&
        member.task === "steer" &&
        atWorkstation(member),
    );
    const turn = helm ? Math.min(1.1, ship.speed * 0.23) * seconds : 0;
    ship.heading =
      (ship.heading +
        Math.max(
          -turn,
          Math.min(turn, wrappedAngle(ship.targetHeading - ship.heading)),
        ) +
        360) %
      360;
    ship.position.x +=
      Math.cos(ship.heading * DEG) * ship.speed * 0.5144 * seconds;
    ship.position.z +=
      Math.sin(ship.heading * DEG) * ship.speed * 0.5144 * seconds;
    this.updateRunners();
    this.updateGuns(seconds);
    this.updateEnemy(seconds);
    this.resolveShots();
    this.updateDamage(seconds);
    if (state.time > this.watchInterval) {
      this.watchInterval = state.time + 240;
      if (!state.stations) this.assignWatch();
      else if (
        state.guns.some(
          (gun) =>
            gun.crew.filter((id) => state.crew[id].health > 0).length < 2,
        )
      )
        this.assignStations();
      if (state.repairing) this.assignRepairs();
    }
    while (state.events.length && state.events[0].time < state.time - 12)
      state.events.shift();
  }

  debugCrew(id: number): CrewDebug {
    const member = this.state.crew[id];
    const nearby = this.state.crew
      .filter(other => other.id !== id && Math.abs(other.position.y - member.position.y) < NEARBY_DECK_TOLERANCE)
      .map(other => ({ other, distance: Math.hypot(other.position.x - member.position.x, other.position.z - member.position.z) }))
      .filter(({ distance }) => distance < NEARBY_DISTANCE)
      .sort((a, b) => a.distance - b.distance)
      .map(({ other, distance }) => ({ ...this.crewSnapshot(other), distance }));
    return { ...this.crewSnapshot(member), nearby };
  }

  private crewSnapshot(member: CrewMember): Omit<CrewDebug, "nearby"> {
    const gun = member.station >= 0 ? this.state.guns[member.station] : undefined;
    return {
      time: this.state.time,
      id: member.id, name: member.name, role: member.role, task: member.task,
      locomotion: member.locomotion, moving: member.moving, carrying: member.carrying,
      station: member.station, gunPhase: gun?.phase ?? null,
      position: { ...member.position }, destination: { ...member.destination },
      speed: member.speed, heading: member.heading, health: member.health, fatigue: member.fatigue, progress: member.progress,
      navigation: this.navigation.debugReport(member),
    };
  }
}
export function createSimulation(): Simulation {
  return new NavalSimulation();
}
