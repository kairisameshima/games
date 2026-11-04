# B-17G Flying Fortress · mid sortie

A B-17G of the 91st Bomb Group flying the middle of a mission, built as a scale model and photographed in the studio-lab look from `../reference/sael-guide.md` (three.js). Three ships hold a combat box on display stands over a cloud deck while the lead runs from the initial point through flak to bombs away and the rally turn.

The aircraft is a hand-painted plastic kit come to life on a stop-motion set. The whole film runs at 12 exposures a second and holds between them; only the orbit camera answers the mouse at once. Everything moves the way an animator moves it:

| Stop-motion touch | What it does |
|---|---|
| Hand spacing | Each exposure moves the film 80–120 % of the time owed, and about one in fourteen is a held frame the next one catches up |
| Handled models | Every moved frame leaves each aircraft a fraction of a millimetre and of a degree off its pose |
| Propellers | Crisp blades at a new angle each frame, strobing rather than blurring |
| Replacement pieces | Muzzle and flak flashes are hand-cut paper stars, a different piece each shot; tracers are twisted strips of orange cellophane |
| Rigging in view | Flak hangs on fishing line from the rig, contrail cotton is threaded on an armature wire, falling bombs ride clear acrylic rods, and the stands carry tape, a clamp and a tape cross on the plinth |
| Reused cotton | Each contrail is a fixed set of tufts slid back along its wire and teased looser; the thinned one at the tail goes back on at the exhaust |
| Camera and film | Lamps drift up to 1.5 % in brightness and colour per frame, the tripod jolts and settles when a camera move begins, and the film adds fresh grain, gate weave, a shallow macro depth of field and a vignette |
| The kit | A mould seam along the fuselage's top and bottom, trimmed sprue gates, cement fog and a thumbprint on the nose glazing, silvering round the decals, and shelf dust on everything facing up |
| The set | Taped seams in the backdrop, a cutting mat and steel rule on the floor, and a lamp on a light stand aimed in at the box |

The airframe comes from a traced 3-view and wartime photographs, not by eye. `reference/README.md` lists the sources and the measuring method, and `reference/overlay-*.png` show the finished model's silhouette over the drawing.

| Part | How it is built |
|---|---|
| Fuselage | Loft through 42 measured stations, windscreen step included |
| Wing, tailplane, fin | NACA sections lofted along the traced planform (0018 root to 0010 tip on the wing) |
| Nacelles | Cowl, cowl flaps and nacelle body lofted per engine and tucked into the wing surface |
| Propellers | Three twisted Hamilton Standard blades with yellow tips |
| Paint | Olive Drab 41 over Neutral Gray 43 with panel lines, rivets, fade, de-icer boots and exhaust soot, brushed on: strokes along each part with bristle grooves and paint built up at their edges |
| Markings | Water-slide decals: star-and-bar, `LG` codes, Triangle A and an illustrative serial, each printed on a glossy carrier film that stands off the paint with a lip and a hairline of shadow |
| Clouds, contrails, flak | Cotton wool: lumpy tufts with a halo of tangled fibres; contrails are tufts pulled out thin behind each turbo and fattening aft, flak is wool dyed near black |
| Turrets | Sperry top turret; Sperry ball turret to its handbook's installation drawing (glazed end bells, sighting window, ring gear, hanger, gunner folded as figure 39 shows); Bendix chin turret, Cheyenne tail guns, cheek, waist and radio-hatch guns |
| Guns | Thirteen Browning AN/M2 .50s at true size (1.44 m, TM 9-225): receiver with feed cover, feedways and slide handle, perforated cooling jacket, flash hider; hand-held guns add spade grips, butterfly trigger and ring-and-bead sight |
| Ammunition | Riveted boxes (tall bare-metal boxes at the waist windows and either side of the tail gunner, as in Pilot's Manual figures 76 and 78), articulated feed chutes routed to each gun's feedway, and linked .50 BMG belts at true size in a 1944 AP, incendiary, API, AP, tracer order |
| Gunnery | Each M2 fires 800-rpm bursts: the barrel recoils inside its jacket, the bolt stud runs back in its slot, the belt steps a link, the flash leaves the flash hider, every fifth round is a tracer (slowed for display), and the spent case drops out of the receiver onto the floor inside, or overboard from the ball, chin and tail guns to the studio floor; cases are cleared after 30 seconds |
| Interior | Every compartment from the Norden sight to the tail guns, laid out from the Standard Aircraft Characteristics inboard profile and the Pilot's Manual figures: Z-section frames and stringers, quilted insulation, plywood floors, bulkheads 4–7, instrument panel, pedestal, top-turret basket, racks and catwalk, radio sets, waist guns on K-6 mounts, ball turret, tail station, oxygen system; at every station the fittings the Pilot's Manual lists (interphone jack boxes, A-12 regulators with indicator panels, walk-around oxygen bottles, suit heater outlets, dome and table lamps, first-aid kit, red emergency releases, radio-room alarm bell and hand cranks, bomb bay relief tube and fuel pump), and conduit, oxygen line and control cables along the walls |
| Crew | Ten men posed with IK onto the real controls (wheels, grips, Norden knobs, throttles, Morse key). Each is a signed-distance sculpture meshed in a worker: anatomy under B-3/A-3 sheepskin, A-2 or F-3 heated suit, A-6 boots, A-11 helmet, A-14 mask and hose to his regulator, B-8 goggles, M4 helmet, M1 vest, M3 apron, B-4 life vest, harness |
| Bomb bay | Twelve AN-M64 500 lb bombs to TM 9-1980 (59.2 in, 14.18 in body, yellow nose and tail bands, AN-M103 nose fuze, box fin, lugs 14 in apart), hung lugs-inboard in B-7 shackles on the two vertical racks along the catwalk, released bottom tier first through a real opening |

The exploded view (**E**) pulls the lead ship apart along the lines it was built on: the fuselage splits at its bulkheads into nose, pilots' compartment, bomb bay, radio room, waist and tail, each taking its crew, guns and fittings with it; the wings, the four engine nacelles, the stabilizers, the fin, the three turrets and the bomb bay doors come away on their own, each labelled. The formation keeps flying, and the guns keep firing, while it is open.

The cutaway (**C**) peels the lead ship's starboard skin, frames and bulkheads back to the centreline and labels each crew station. The skin is clipped in the shader, so the cut follows the aircraft as it banks and the turrets keep turning with their gunners inside. Equipment hung on the starboard wall hides once the cut passes it. With the skin on, the crew show through glazed window openings.

The sortie loop runs 72 seconds:

| Phase | What happens |
|---|---|
| Formation cruise | Gunners scan, formation wander |
| Fighter attack | Unseen fighters press in; every gun in the box fires short bursts |
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
| E | exploded view of the lead ship |
| L | record a render log: about 40 s, then saves a `.json` with this machine's GPU, frame timings and what each cost adds |
| Drag, scroll | orbit and zoom |

Under the controls, a frame-rate readout (average of the last second, and the worst frame of the last eight seconds) sits over a frame-time chart with a guide at the 12 fps the film is locked to.

## Layout

- `src/scene/b17-dimensions.ts` holds every measured dimension. `src/scene/b17.ts` builds the aircraft from them, and `src/scene/hull.ts` answers hull shape queries.
- `src/scene/interior/` builds the compartments (`layout.ts` holds the stations, `index.ts` assembles them). `src/scene/crew/` holds the figure generator: skeleton and IK, signed-distance primitives, the surface-nets mesher and the meshing worker. `src/scene/m2.ts` builds the guns, `src/scene/ball-turret.ts` the ball turret, `src/scene/window-cutouts.ts` opens the windows, `src/scene/assemblies.ts` and `src/scene/exploded.ts` split and move the assemblies, `src/scene/cutaway.ts` clips the skin, and `src/ui/callouts.ts` labels the stations.
- `src/scene/loft.ts` lofts rings into meshes and generates NACA sections.
- `src/scene/effects.ts` runs flak bursts, contrails and falling bombs with their rigs, `src/scene/stop-motion.ts` times the exposures and their hand spacing; `src/scene/gunnery.ts` fires the guns. `src/scene/set.ts` also builds the workshop props.
- `src/sortie.ts` is the mission timeline. `src/main.ts` wires the formation, camera, views and adaptive quality.
- `src/render/studio.ts` is the shared studio renderer from `../mise`, with a light-steel environment added for the Studio view. `src/render/miniature.ts` adds the brushwork, shelf dust and the cotton wool, `src/render/film-gate.ts` the grain, gate weave and vignette, `src/render/render-log.ts` records the render log.
