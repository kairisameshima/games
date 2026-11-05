/**
 * A schematic route map for the title panel: England's east coast and the continent's across the North Sea, the planned
 * route from the base out to the initial point, the target and the rally, and home, with the box's place on it now.
 * The track flown so far is drawn solid over the dashed plan.
 */

/** The map's drawing size, in its own units. */
const MAP = { width: 300, height: 110 } as const;

/** Rough coastlines, schematic only: enough to read as England, the North Sea and the continent. */
const COASTS = {
  england: 'M0 8 L46 6 L64 18 L80 30 L92 44 L96 58 L88 70 L92 84 L80 98 L70 110 L0 110 Z',
  continent: 'M300 0 L246 6 L214 22 L194 38 L176 54 L166 70 L158 88 L150 110 L300 110 Z',
} as const;

/** Named places on the route, in map units, and where each label sits off its place. */
const PLACES = {
  base: { x: 40, y: 66, label: 'BASSINGBOURN', labelAt: [-14, -6], anchor: 'start' },
  ip: { x: 226, y: 42, label: 'IP', labelAt: [-8, -5], anchor: 'end' },
  target: { x: 254, y: 58, label: 'TARGET', labelAt: [8, 2.5], anchor: 'start' },
  rally: { x: 244, y: 80, label: 'RALLY', labelAt: [8, 2.5], anchor: 'start' },
} as const;

/**
 * Where the box is on the map at film times through the mission, linear between: the film opens four hours out, over
 * the continent on the way to the IP, and the landing brings it home.
 */
const TRACK: readonly (readonly [number, number, number])[] = [
  [0, 178, 50], [24, PLACES.ip.x, PLACES.ip.y], [28, 232, 46], [44, PLACES.target.x, PLACES.target.y],
  [49.5, 252, 70], [57.5, PLACES.rally.x, PLACES.rally.y], [72, 150, 92], [81, PLACES.base.x, PLACES.base.y],
];

/** The planned route the dashed line shows: out over the sea to the start of the film's track, then the track itself. */
const PLANNED = [[PLACES.base.x, PLACES.base.y], [96, 52], ...TRACK.map(([, x, y]) => [x, y])] as const;

function positionAt(time: number): [number, number] {
  if (time <= TRACK[0][0]) return [TRACK[0][1], TRACK[0][2]];
  for (let index = 0; index < TRACK.length - 1; index++) {
    const [from, x0, y0] = TRACK[index];
    const [to, x1, y1] = TRACK[index + 1];
    if (time <= to) {
      const along = (time - from) / (to - from);
      return [x0 + (x1 - x0) * along, y0 + (y1 - y0) * along];
    }
  }
  const last = TRACK[TRACK.length - 1];
  return [last[1], last[2]];
}

/** The track's points flown by `time`, ending at the box. */
function flownPoints(time: number): string {
  const points: [number, number][] = [[TRACK[0][1], TRACK[0][2]]];
  for (const [at, x, y] of TRACK.slice(1)) {
    if (at >= time) break;
    points.push([x, y]);
  }
  points.push(positionAt(time));
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export class RouteMap {
  readonly element: HTMLElement;
  private readonly flown: SVGPolylineElement;
  private readonly box: SVGCircleElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'route-map';
    const place = (key: keyof typeof PLACES) => {
      const { x, y, label, labelAt, anchor } = PLACES[key];
      return `<circle class="route-place" cx="${x}" cy="${y}" r="2.4"/><text x="${x + labelAt[0]}" y="${y + labelAt[1]}" text-anchor="${anchor}">${label}</text>`;
    };
    this.element.innerHTML = `<svg viewBox="0 0 ${MAP.width} ${MAP.height}" aria-label="Route">
      <rect class="route-sea" width="${MAP.width}" height="${MAP.height}" rx="6"/>
      <path class="route-land" d="${COASTS.england}"/><path class="route-land" d="${COASTS.continent}"/>
      <polyline class="route-planned" points="${PLANNED.map(([x, y]) => `${x},${y}`).join(' ')}"/>
      <polyline class="route-flown" points=""/>
      ${(Object.keys(PLACES) as (keyof typeof PLACES)[]).map(place).join('')}
      <circle class="route-box" r="4"/>
    </svg>`;
    const flown = this.element.querySelector('.route-flown');
    const box = this.element.querySelector('.route-box');
    if (!(flown instanceof SVGPolylineElement) || !(box instanceof SVGCircleElement)) throw new Error('Route map failed to build');
    this.flown = flown;
    this.box = box;
  }

  update(time: number): void {
    const [x, y] = positionAt(time);
    this.box.setAttribute('cx', x.toFixed(1));
    this.box.setAttribute('cy', y.toFixed(1));
    this.flown.setAttribute('points', flownPoints(time));
  }
}
