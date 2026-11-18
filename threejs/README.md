# three.js scenes

Procedurally built three.js scenes. The Ironhollow remake combines generated geometry with locally bundled photographic surface maps and an outdoor HDR environment.

## Scenes

| Scene | Path | What it shows |
|---|---|---|
| The Wooden Wall | `ship-of-the-line/` | Command a 74-gun ship with 540 individual crew, sailing orders, naval combat, x-ray and cutaway inspection |
| Ironhollow · remade | `ironhollow/` | A human-sized town across the upper armor of a colossal, earth-buried wreck |
| Ironhollow · original | `mech-village/` | The first version, a village on a fallen siege walker at golden hour |

The remake lives in `src/ironhollow/`. It opens over the town. Drag to orbit, scroll to zoom, and use **Reveal the giant** to see the buried wreck. **Town view** or R returns to the settlement. **Slow orbit** or Space toggles rotation. The original remains available for comparison.

The remake uses triplanar albedo, normal and roughness maps for aged steel, wood, plaster, stone, roofing and soil. Its perspective camera, photographed sky lighting and individually instanced foliage replace the original flat miniature presentation.

The machinery remains 16× larger than the original scene, but sits 140 metres deeper in the earth. Irregular banks bury the lower hull and limbs while leaving the upper armor, turret and weapon exposed. Connected neighborhoods spread across the soil-covered deck, with cottages, villagers and foliage kept human-sized. A sloping approach road joins the town to the surrounding terrain.

Surface maps and sky are from [Poly Haven](https://polyhaven.com/license), licensed CC0. Assets are bundled under `public/ironhollow/textures/`, so the scene makes no external requests at runtime.

| Surface | Source |
|---|---|
| Painted, rusted steel | [Green Metal Rust](https://polyhaven.com/a/green_metal_rust) |
| Timber | [Rough Wood](https://polyhaven.com/a/rough_wood) |
| Plaster | [White Plaster Rough 01](https://polyhaven.com/a/white_plaster_rough_01) |
| Stone | [Mossy Rock](https://polyhaven.com/a/mossy_rock) |
| Ground | [Forest Floor](https://polyhaven.com/a/forest_floor) |
| Roofing | [Grey Roof Tiles](https://polyhaven.com/a/grey_roof_tiles) |
| Lighting | [Kloppenheim 05 Pure Sky](https://polyhaven.com/a/kloppenheim_05_puresky) |


### Original scene

A four-legged weapon platform lies where it fell. One rear leg sheared off, the head rests in the grass with its eye still glowing, and an arm lies on the ground with a tree growing in its palm. Villagers have settled the armoured deck. Timber-framed houses crowd a market square, a windmill turns on the turret roof, and a plank walkway runs up the intact cannon to a lookout hut. A broken coolant main pours into a fishing pond, and someone lives inside the fallen half of the second barrel.

The scene code is in `src/mech-village/`:

| File | Contents |
|---|---|
| `mech.ts` | Hull, turret, barrels, legs, head, arm, neck cables, gear |
| `village.ts` | Houses, market, windmill, barrel walkway, lift, stair tower, ground homes, farm |
| `vegetation.ts` | Trees, grass, hanging vines, climbing ivy, flowers, pine forest |
| `terrain.ts` | Height field, paths, pond, mountain ring |
| `atmosphere.ts` | Sky, sun, fog, smoke, fireflies, waterfall, birds, clouds |
| `materials.ts` | Triplanar shader that textures merged geometry and grows moss on upward faces |
| `batch.ts` | Merges static geometry into one mesh per material |

Controls: drag to orbit, right-drag to pan, scroll to zoom. Space pauses the slow orbit and R resets the camera.

### The Wooden Wall

Open `ship-of-the-line/`. Drag to orbit, scroll to zoom, and click a sailor to inspect. The Sailing panel orders canvas and compass headings. Topmen travel to their yards before changing sail. The Gunnery panel calls battle stations, selects shot and aim, and orders port or starboard broadsides or fire at will. Signal an enemy encounter in the tactical panel to begin an action.

Every member of the 540-person company has a position, route, role, task, health and fatigue. Gun crews muster and work through a loading cycle, while powder runners carry charges from the magazine. Damage control assigns repairs, pumps, firefighting and care for wounded sailors. The manifest lists individual assignments.

Exterior, cutaway and x-ray modes show the ship's structure. Deck selection removes upper levels for interior inspection. Space pauses, B toggles battle stations, C toggles cutaway, X toggles x-ray, and R resets the camera. Time controls run the simulation at 1×, 4× or 12×. Sailing and combat use accelerated task-based approximations rather than a naval engineering model.

## Run

```sh
npm install --registry https://registry.npmjs.org/
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production build into dist/
```
