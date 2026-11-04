# B-17G references

| File | Source | License |
|---|---|---|
| `b17g-3view.svg` | [Boeing B-17G Flying Fortress 3-view line drawing](https://commons.wikimedia.org/wiki/File:Boeing_B-17G_Flying_Fortress_3-view_line_drawing.svg), Kaboldy | CC BY-SA 3.0 |
| `b17g-profile-emoscopes.png` | [Boeing B-17G Flying Fortress](https://commons.wikimedia.org/wiki/File:Boeing_B-17G_Flying_Fortress.png), Emoscopes | CC BY-SA 2.5 |
| `photo-91bg-b17g-42-102509.jpg` | [B-17G 42-102509, 91st BG, 401st BS](https://commons.wikimedia.org/wiki/File:B-17G-42-102509-91bg-401stbs.jpg), USAAF | Public domain |
| `photo-b17-bomb-run.jpg` | [B-17 on bomb run](https://commons.wikimedia.org/wiki/File:B-17_on_bomb_run.jpg), USAAF | Public domain |
| `photo-385bg-b17f-flak.jpg` | [385th BG B-17F 42-30275](https://commons.wikimedia.org/wiki/File:385th_Bombardment_Group_B-17F_Flying_Fortress_42-30275.jpg), USAAF | Public domain |
| `photo-schweinfurt-formation.jpg` | [B-17F formation over Schweinfurt, 17 August 1943](https://commons.wikimedia.org/wiki/File:B-17F_formation_over_Schweinfurt,_Germany,_August_17,_1943.jpg), USAAF | Public domain |
| `ball-turret-installation.png` | [AN 11-45G-1, Handbook of Instructions, Lower Ball Turrets Types A-2, A-2A and A-13](http://hangarthirteen.org/wp-content/uploads/2020/08/11-45G-1-Handbook-for-Sperry-Lower-Ball-Turrets-A-2-A-2A-A-13.pdf), figure 47 (installation outline drawing), USAAF | Public domain |
| `photo-b17-schweinfurt.jpg` | [B-17 Schweinfurt](https://commons.wikimedia.org/wiki/File:B-17_Schweinfurt.jpg), USAAF | Public domain |
| `photo-liberty-belle-cheyenne-tail.jpg` | [Liberty Belle 04](https://commons.wikimedia.org/wiki/File:Liberty_Belle_04.jpg), the Cheyenne tail of B-17G 44-85734, Danleo | CC BY 2.5 |

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

## Interior sources

- *Standard Aircraft Characteristics, B-17G* (AAF), inboard profile: compartment boundaries scaled to the 22.66 m length. Nose to bulkhead 4 at 2.85 m, pilots' compartment to the front spar at 5.76 m, bomb bay to the rear spar at 8.49 m, radio room to 10.6 m, waist to 16.7 m, tail beyond.
- *EAA Flight Training Manual, B-17G "Aluminum Overcast"* (EAA, revised March 2012), weight and balance arms: pilots 167.6 in, top turret 193.6 in, radio room 374.0 in, waist gunners 559 and 621 in, tail wheel 665 in, from a datum 205 in ahead of the wing-root leading edge. These place the seats and gun positions along the fuselage.
- *Pilot's Manual for Boeing B-17 Flying Fortress* (AAF), figures of the instrument panel (the panel texture follows its layout), pedestal, upper turret, bomb bay, radio room, ball turret, waist and tail positions.
- *Pilot Training Manual for the B-17 Flying Fortress* (AAF Manual 50-13), [archive.org](https://archive.org/details/50-13): crew duties and stations, oxygen equipment, flight clothing.

The Sperry ball turret follows AN 11-45G-1: a 44 in ball hung 2 in below the skin in a 46 1/2 in hole, so about half of it sits inside the waist; guns 28 in apart and 2 1/4 in below the centreline, muzzles 42 11/32 in ahead of it; the laminated sighting window (15.3 in glass in a 17.4 in armoured frame) 3 in below the centreline; end bells flat-faced at 18 5/16 in, glazed with eight wedge panes round the trunnion hub and a ring of panes round the shoulder; the azimuth ring gear on twenty Lord shock mounts; the trunnion ring support, its brackets and the hanger tubing; the ammunition boxes (445 and 571 rounds) in front of the gunner; and the gunner's posture from figure 39, scaled to 5 ft 4 in because ball gunners were picked short.

Crew outfits follow 1944 Eighth Air Force practice on a bomb run: oxygen masks on above 10,000 ft, M4 flak helmets and M1 vests on, waist and tail gunners in M3 aprons, and the ball turret gunner in an F-3 heated suit alone because nothing bulkier fits the 44 in ball.

A fit audit run against the built scene checked the result: no crew or equipment vertex lies more than 2 cm outside the hull section (turret volumes excepted), and every hand and foot reaches its target within 2.2 cm.
