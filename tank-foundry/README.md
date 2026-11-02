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

`dist/` is a static build with relative asset paths. Three.js is bundled locally. Progress is stored in `localStorage`.

## Loop

- **Factory.** The Steel Mill feeds the Hull Works, Turret Shop and Engine Plant. The Assembly Hall turns parts into the selected model. Each station reports running, starved, output full or low power. Every machine level draws power from the Power Station, and a shortfall slows the whole plant by the same factor.
- **Front.** Finished tanks wait in the depot and roll out while the front is below its Logistics limit. Enemies come in endless waves that grow by 15% HP per wave, with a Landship boss every 10 waves. Enemy artillery wears down tanks no matter how strong they are, so the factory always has losses to replace.
- **Fallback.** If an enemy reaches the factory gate, or a wave is not cleared in 90 seconds, the front drops back one wave and keeps farming it.
- **Currencies.** Kills pay salvage (factory upgrades) and intel (research).
- **Research.** Gun and armor research make tanks stronger and also 5% slower to build per level, which keeps the factory growing. Blueprints unlock eight models in order: M3 Stuart, T-34/76, M4 Sherman, Panther, Tiger I, IS-2, King Tiger and Maus. Automated Requisition and Research Bureau unlock auto-upgrade and auto-research.
- **Idle.** Time away is simulated on return, capped at 8 hours.

## Code

- `src/data.js` holds every tunable number.
- `src/sim.js` is the DOM-free simulation. `tick(state, dt, events)` advances it and reports events for the renderer.
- `src/save.js` serializes saves and simulates time away.
- `src/models.js` builds each tank from boxes, cylinders and extruded side profiles.
- `src/scene.js` renders the factory, belts, battlefield and effects from simulation state.
- `src/ui.js` owns the panels.
