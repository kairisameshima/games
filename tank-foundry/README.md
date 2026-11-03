# Tank Foundry

A Three.js idle and factory-automation game. Run a WW2 tank factory, send every finished tank to an endless front, and spend what the fighting brings back on research for better tanks.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

`play/` is the committed static build that GitHub Pages serves at `/games/tank-foundry/play/`. To publish, bring the changes onto `main` and run `npm run deploy`: it checks for a clean tree, pulls, tests, rebuilds `play/`, commits it and pushes. `/games/tank-foundry/` redirects to the build. Asset paths are relative. Three.js is bundled locally. Progress is stored in `localStorage`.

## Loop

- **Factory.** The Steel Mill feeds the Hull Works, Turret Shop and Engine Plant. The Assembly Hall turns parts into the selected model. Each station reports running, starved, output full or low power. Every machine level draws power from the Power Station, and a shortfall slows the whole plant by the same factor. Upgrades show on the floor: shops add machine bays, the mill adds furnaces, the power station adds cooling towers, and the hall adds a second crane and more welders.
- **Assault.** Every finished tank rolls out to attack a fortified sector. Each sector is generated from its number: up to three defensive lines of trenches (which slow tanks and expose them to 60% more damage), pillboxes, AT guns and bunkers, armor held in reserve until the assault nears the first line, and a fortified base. Destroying the base captures the sector, pays a bonus and moves the army up to the next, deeper position. There is no army cap below a 60-tank rendering limit, so factory output is army size.
- **Attrition, not defeat.** Assaults never fail outright. Damaged defenses repair themselves and the base keeps sending armor, so a factory that cannot keep up stalls. Enemy artillery wears down tanks no matter how strong they are. Fall back one sector at any time.
- **Salvage.** Kills pay salvage, which buys station upgrades and blueprints. Blueprints unlock eight models in order: M3 Stuart, T-34/76, M4 Sherman, Panther, Tiger I, IS-2, King Tiger and Maus.
- **Regroup.** Each run ends at the limit of a maxed factory. Regrouping resets stations, blueprints, salvage and sectors, and pays medals that grow 25% per sector from sector 3. The Doctrine tab flags a stall after three minutes without the front moving forward.
- **Doctrine.** Medals buy permanent doctrine: guns, armor, machine output, power, storage and auto-upgrade. Gun and armor doctrine also make tanks 5% slower to build per level, so the factory has to keep up.
- **Offensives.** An offensive commits front-line tanks to skip up to two sectors, stopping two short of the best ever reached, and pays those sectors' salvage at once. New runs catch up to the old wall quickly; pushing past it still takes fighting.
- **Idle.** Time away is simulated on return, capped at 8 hours.

## Code

- `src/data.js` holds every tunable number.
- `src/sim.js` is the DOM-free simulation. `tick(state, dt, events)` advances it and reports events for the renderer.
- `src/save.js` serializes saves and simulates time away.
- `src/models.js` builds each tank from boxes, cylinders and extruded side profiles.
- `src/factory.js` draws the plant from simulation state: cutaway brick halls, machines that multiply as stations level up, belts, stock piles, status beacons, workers, forklifts and the supply train.
- `src/scene.js` owns the renderer and camera, the battlefield, tanks, the depot and labels.
- `src/effects.js` runs short-lived smoke, flashes and sparks. `src/scene-kit.js` holds shared mesh and texture helpers.
- `src/ui.js` owns the panels.
