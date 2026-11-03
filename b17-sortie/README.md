# B-17G Flying Fortress · mid sortie

A B-17G of the 91st Bomb Group flying the middle of a mission, built as a scale model and photographed in the studio-lab look from `../reference/sael-guide.md` (three.js). Three ships hold a combat box on display stands over a cloud deck while the lead runs from the initial point through flak to bombs away and the rally turn.

The airframe comes from a traced 3-view and wartime photographs, not by eye. `reference/README.md` lists the sources and the measuring method, and `reference/overlay-*.png` show the finished model's silhouette over the drawing.

| Part | How it is built |
|---|---|
| Fuselage | Loft through 42 measured stations, windscreen step included |
| Wing, tailplane, fin | NACA sections lofted along the traced planform (0018 root to 0010 tip on the wing) |
| Nacelles | Cowl, cowl flaps and nacelle body lofted per engine and tucked into the wing surface |
| Propellers | Three twisted Hamilton Standard blades with yellow tips, plus a motion-blur disc |
| Paint | Olive Drab 41 over Neutral Gray 43 with panel lines, rivets, fade, de-icer boots and exhaust soot |
| Markings | Projected decals: star-and-bar, `LG` codes, Triangle A and an illustrative serial |
| Turrets | Sperry top and ball turrets, Bendix chin turret, Cheyenne tail guns, cheek, waist and radio-hatch guns |
| Guns | Thirteen Browning AN/M2 .50s at true size (1.44 m, TM 9-225): receiver with feed cover, feedways and slide handle, perforated cooling jacket, flash hider; hand-held guns add spade grips, butterfly trigger and ring-and-bead sight |
| Interior | Every compartment from the Norden sight to the tail guns, laid out from the Standard Aircraft Characteristics inboard profile and the Pilot's Manual figures: Z-section frames and stringers, quilted insulation, plywood floors, bulkheads 4–7, instrument panel, pedestal, top-turret basket, racks and catwalk, radio sets, waist guns on K-6 mounts, ball turret, tail station, oxygen system |
| Crew | Ten men posed with IK onto the real controls (wheels, grips, Norden knobs, throttles, Morse key). Each is a signed-distance sculpture meshed in a worker: anatomy under B-3/A-3 sheepskin, A-2 or F-3 heated suit, A-6 boots, A-11 helmet, A-14 mask and hose to his regulator, B-8 goggles, M4 helmet, M1 vest, M3 apron, B-4 life vest, harness |
| Bomb bay | Twelve 500 lb bombs in two vertical racks either side of the catwalk, released bottom tier first through a real opening |

The cutaway (**C**) peels the lead ship's starboard skin, frames and bulkheads back to the centreline and labels each crew station. The skin is clipped in the shader, so the cut follows the aircraft as it banks and the turrets keep turning with their gunners inside. Equipment hung on the starboard wall hides once the cut passes it. With the skin on, the crew show through glazed window openings.

The sortie loop runs 64 seconds:

| Phase | What happens |
|---|---|
| Formation cruise | Gunners scan, formation wander |
| Initial point | Turn onto the run, bomb bay doors open, flak starts |
| Bomb run | Held level through heavy flak |
| Bombs away | Twelve 500 lb bombs leave in train from each ship |
| Rally | Doors close, banked turn off the target |
| Withdrawal | Flak thins out behind |

## Run

```sh
npm install --registry https://registry.npmjs.org/
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

## Controls

| Input | Action |
|---|---|
| Space | play / pause |
| ← / → | previous / next phase |
| V | switch Lab and Studio |
| C | cutaway of the lead ship |
| Drag, scroll | orbit and zoom |

## Layout

- `src/scene/b17-dimensions.ts` holds every measured dimension. `src/scene/b17.ts` builds the aircraft from them, and `src/scene/hull.ts` answers hull shape queries.
- `src/scene/interior/` builds the compartments (`layout.ts` holds the stations, `index.ts` assembles them). `src/scene/crew/` holds the figure generator: skeleton and IK, signed-distance primitives, the surface-nets mesher and the meshing worker. `src/scene/m2.ts` builds the guns, `src/scene/window-cutouts.ts` opens the windows, `src/scene/cutaway.ts` clips the skin, and `src/ui/callouts.ts` labels the stations.
- `src/scene/loft.ts` lofts rings into meshes and generates NACA sections.
- `src/scene/effects.ts` runs flak bursts, contrail ribbons and falling bombs.
- `src/sortie.ts` is the mission timeline. `src/main.ts` wires the formation, camera, views and adaptive quality.
- `src/render/studio.ts` is the shared studio renderer from `../mise`, with a light-steel environment added for the Studio view.
