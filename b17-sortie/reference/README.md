# B-17G references

| File | Source | License |
|---|---|---|
| `b17g-3view.svg` | [Boeing B-17G Flying Fortress 3-view line drawing](https://commons.wikimedia.org/wiki/File:Boeing_B-17G_Flying_Fortress_3-view_line_drawing.svg), Kaboldy | CC BY-SA 3.0 |
| `b17g-profile-emoscopes.png` | [Boeing B-17G Flying Fortress](https://commons.wikimedia.org/wiki/File:Boeing_B-17G_Flying_Fortress.png), Emoscopes | CC BY-SA 2.5 |
| `photo-91bg-b17g-42-102509.jpg` | [B-17G 42-102509, 91st BG, 401st BS](https://commons.wikimedia.org/wiki/File:B-17G-42-102509-91bg-401stbs.jpg), USAAF | Public domain |
| `photo-b17-bomb-run.jpg` | [B-17 on bomb run](https://commons.wikimedia.org/wiki/File:B-17_on_bomb_run.jpg), USAAF | Public domain |
| `photo-385bg-b17f-flak.jpg` | [385th BG B-17F 42-30275](https://commons.wikimedia.org/wiki/File:385th_Bombardment_Group_B-17F_Flying_Fortress_42-30275.jpg), USAAF | Public domain |
| `photo-schweinfurt-formation.jpg` | [B-17F formation over Schweinfurt, 17 August 1943](https://commons.wikimedia.org/wiki/File:B-17F_formation_over_Schweinfurt,_Germany,_August_17,_1943.jpg), USAAF | Public domain |
| `photo-b17-schweinfurt.jpg` | [B-17 Schweinfurt](https://commons.wikimedia.org/wiki/File:B-17_Schweinfurt.jpg), USAAF | Public domain |

## How the model was measured

The 3-view was rasterised at 4× (`rsvg-convert -w 4580`) and its outlines traced column by column, keeping only strokes at least 3 px thick so panel lines drop out. Turrets, antennas, guns, props and the landing gear were masked by station and bridged by hand from the gridded crops.

Two scales are used because the drawing is about 5% short in span against its own length:

- Length and height: 142.3 px/m, fixed by the official 22.66 m (74 ft 4 in) from the nose glazing to the tail turret.
- Span: 135.7 px/m, fixed by the official 31.62 m (103 ft 9 in).

Results (metres, `d` aft of the nose tip, height above the nose-tip axis) live in `src/scene/b17-dimensions.ts`:

- Fuselage: 42 stations of top, bottom, and half-width. Maximum 2.30 m wide at the radio room and 2.76 m deep between the cockpit and the bomb bay.
- Wing: straight leading edge `d = 0.1517·s + 4.469` and trailing edge `d = −0.1058·s + 10.486`, fitted to within 6 mm, with the traced tip rounding. Root chord 5.7 m, chord-line dihedral about 3° from the front view.
- Nacelles: inboard at 2.97 m span, outboard at 6.51 m. Cowl diameter 1.46 m. Propeller 3.54 m (11 ft 7 in, Hamilton Standard).
- Tailplane: 12.5 m span, root chord 3.1 m. Fin top 4.67 m above the nose axis, with the long dorsal fillet starting at 11.3 m.

The `*-raw.json` files are the column traces, and `fuselage-stations.json` is the first pass at the station table before hand corrections.

## Fidelity check

`overlay-side.png`, `overlay-top.png` and `overlay-front.png` show the finished model rendered as an orthographic silhouette (red) at the drawing's scale over the 3-view. Side and plan outlines sit on the drawn lines. The front view shows the one deliberate difference: the model uses the B-17's NACA 0018 root and 0010 tip sections, which are thinner than the drawing's front-view wing band.
