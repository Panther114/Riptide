// KMS Bismarck as completed in 1940. Sources: Wikipedia; N. Okun, "Armor protection
// of KM Bismarck" (combinedfleet.com/okun_biz.htm); NavWeaps 38 cm/52 SK C/34.
//
// The defining feature is the "turtleback": a 320 mm vertical belt backed by a
// 110 mm armour deck whose outer edges slope down at 22° to meet the belt's lower
// edge. A shell that defeats the belt at close range must still get through the
// steeply-angled slope before it reaches the machinery or magazines — excellent
// protection at short range, weak (80–95 mm flat deck) against plunging fire.

import type { ShipClass } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';

const L = 251, HALF = L / 2, B = 36;
const halfBeam = makeHalfBeam({ L, B, fwd: 34, aft: -62, bowP: 1.75, bowQ: 0.62, stern: 0.5 });
const TDS = 5.3;
const inner = (x0: number, x1: number) => innerRect(halfBeam, TDS, x0, x1);
const ib = inner(-40, -20).y1; // inner half-breadth amidships

const A = 62, Bx = 44, C = -50, Dx = -67; // Anton, Bruno, Caesar, Dora
const slope = { thickness: 110, angle: 22 * DEG };

const SEC15 = shell({ id: 'HC', name: '15 cm SK C/28 HE (45 kg)', mass: 45.3, caliber: 150, mv: 875, burster: 3.9, range: 23000, fire: 0.1 });

const turret = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 5 * DEG, guns: 2, radius: 7.4, height, barbetteRadius: 6.0,
  armor: { face: 360, side: 220, rear: 320, roof: 180, barbette: 340 }, magazine, barrel: 20.5, spacing: 3.6,
});

export const BISMARCK: ShipClass = {
  id: 'bismarck',
  name: 'Bismarck',
  type: 'BB',
  nation: 'de',
  prefix: 'KMS',
  designation: 'BB · Bismarck class (1940)',
  blurb: 'Battleship. 8 × 38 cm · 320 mm belt + 110 mm turtleback · 30 kn · FuMO 23 radar',
  gunName: '38 CM/52 SK C/34',
  length: L, beam: B, draft: 9.3,
  displacement: 50300,
  maxSpeed: 30 * KN,
  maxReverse: 9 * KN,
  accelTime: 72,
  turnRadius: 720,
  rudderMax: 35 * DEG,
  rudderRate: 5.5 * DEG,
  reserveBuoyancy: 16500,
  pumpRate: 4.2,
  maxRange: 25000,
  reloadTime: 13.5,
  dispersion: { base: 17, perKm: 3.1, rangeRatio: 1.6 },
  hull: buildHull(L, halfBeam),
  freeboard: makeFreeboard(8.0, 4.0, 60, HALF, 1.1, -88),
  halfBeam,
  zones: [
    { x0: 72, x1: HALF + 1, belt: 60, beltIncline: 0, beltTop: 2.5, beltBottom: -2.5, lowerBelt: 60, upperSide: 35, deck: 20, weatherDeck: 50, citadel: false, beltName: 'bow belt' },
    // magazine spaces forward: 95 mm flat deck
    { x0: 36, x1: 72, belt: 320, beltIncline: 0, beltTop: 2.6, beltBottom: -2.2, lowerBelt: 170, upperSide: 145, deck: 95, weatherDeck: 50, citadel: true, slope, tds: 250 },
    // machinery: 80 mm flat deck
    { x0: -40, x1: 36, belt: 320, beltIncline: 0, beltTop: 2.6, beltBottom: -2.2, lowerBelt: 170, upperSide: 145, deck: 80, weatherDeck: 50, citadel: true, slope, tds: 250 },
    { x0: -80, x1: -40, belt: 320, beltIncline: 0, beltTop: 2.6, beltBottom: -2.2, lowerBelt: 170, upperSide: 145, deck: 95, weatherDeck: 50, citadel: true, slope, tds: 250 },
    // steering gear: 80 mm stern belt and a 110 mm turtleback deck
    { x0: -110, x1: -80, belt: 80, beltIncline: 0, beltTop: 2.0, beltBottom: -2.5, lowerBelt: 80, upperSide: 30, deck: 110, weatherDeck: 50, citadel: true, slope, beltName: 'stern belt' },
    { x0: -HALF - 1, x1: -110, belt: 20, beltIncline: 0, beltTop: 2.0, beltBottom: -2.5, lowerBelt: 20, upperSide: 20, deck: 20, weatherDeck: 30, citadel: false, beltName: 'stern plating' },
  ],
  modules: [
    mod('magA', 'Anton Magazines', 'MAG A', 'magazine', inner(53, 71), 'low', 105, { turret: 'tA', zTop: -2.2 }),
    mod('magB', 'Bruno Magazines', 'MAG B', 'magazine', inner(36, 53), 'low', 105, { turret: 'tB', zTop: -2.2 }),
    mod('magC', 'Caesar Magazines', 'MAG C', 'magazine', inner(-58, -40), 'low', 105, { turret: 'tC', zTop: -2.2 }),
    mod('magD', 'Dora Magazines', 'MAG D', 'magazine', inner(-76, -58), 'low', 105, { turret: 'tD', zTop: -2.2 }),
    mod('b1', 'Boiler Rooms 1 & 2', 'BR 1/2', 'boiler', inner(8, 22), 'low', 120),
    mod('b2', 'Boiler Rooms 3 & 4', 'BR 3/4', 'boiler', inner(-6, 8), 'low', 120),
    mod('b3', 'Boiler Rooms 5 & 6', 'BR 5/6', 'boiler', inner(-20, -6), 'low', 120),
    // three turbine rooms side by side, one per shaft
    mod('e1', 'Starboard Turbine Room', 'T STB', 'engine', r(-40, -20, 4.4, ib), 'low', 120),
    mod('e2', 'Centre Turbine Room', 'T CTR', 'engine', r(-40, -20, -4.4, 4.4), 'low', 120),
    mod('e3', 'Port Turbine Room', 'T PRT', 'engine', r(-40, -20, -ib, -4.4), 'low', 120),
    mod('steer', 'Steering Gear Room', 'STEER', 'steering', r(-104, -94, -6, 6), 'low', 90),
    mod('bridge', 'Conning Tower & Bridge', 'CT', 'bridge', r(29, 35, -3.6, 3.6), 'high', 100),
    mod('dirF', 'Foretop Fire-Control Station', 'DIR F', 'director', r(18, 25, -3.2, 3.2), 'high', 70),
    mod('dirA', 'After Fire-Control Station', 'DIR A', 'director', r(-35, -29, -3, 3), 'high', 70),
    mod('fun1', 'Funnel', 'STK', 'funnel', r(-8, 4, -4.6, 4.6), 'high', 80),
    mod('secP', 'Port 15 cm Battery', '15 P', 'secondary', r(-26, 26, -14.5, -9.5), 'high', 90),
    mod('secS', 'Starboard 15 cm Battery', '15 S', 'secondary', r(-26, 26, 9.5, 14.5), 'high', 90),
    mod('tA', 'Turret Anton', 'A', 'turret', r(A - 7, A + 7, -7, 7), 'high', 115),
    mod('tB', 'Turret Bruno', 'B', 'turret', r(Bx - 7, Bx + 7, -7, 7), 'high', 115),
    mod('tC', 'Turret Caesar', 'C', 'turret', r(C - 7, C + 7, -7, 7), 'high', 115),
    mod('tD', 'Turret Dora', 'D', 'turret', r(Dx - 7, Dx + 7, -7, 7), 'high', 115),
  ],
  turrets: [
    turret('tA', 'Turret Anton', A, 0, 12.5, 'magA'),
    turret('tB', 'Turret Bruno', Bx, 0, 15.5, 'magB'),
    turret('tC', 'Turret Caesar', C, Math.PI, 15.0, 'magC'),
    turret('tD', 'Turret Dora', Dx, Math.PI, 12.0, 'magD'),
  ],
  secondary: {
    name: '15 cm SK C/28',
    shell: SEC15,
    reload: 4.5,
    range: 14000,
    traverseRate: 9 * DEG,
    dispersion: { base: 11, perKm: 6, rangeRatio: 1.5 },
    mounts: [20, 3, -16].flatMap((x, i) => [
      { id: `s${i}p`, x, y: -12.6, facing: -Math.PI / 2, arc: 75 * DEG, guns: 2, radius: 3.4, barrel: 9, module: 'secP' },
      { id: `s${i}s`, x, y: 12.6, facing: Math.PI / 2, arc: 75 * DEG, guns: 2, radius: 3.4, barrel: 9, module: 'secS' },
    ]),
  },
  sections: sections(
    ['Stern', 'Steering gear', 'Dora magazines', 'Caesar magazines', 'Turbine rooms', 'Boiler rooms 5 & 6', 'Boiler rooms 3 & 4', 'Boiler rooms 1 & 2', '15 cm magazines', 'Bruno magazines', 'Anton magazines', 'Forecastle', 'Bow'],
    [-HALF, -106, -80, -58, -40, -20, -6, 8, 22, 36, 53, 72, 100, HALF],
    [600, 1500, 1900, 1900, 2600, 1900, 1900, 1900, 1400, 1800, 2000, 2300, 1000],
  ),
  structures: [
    { name: 'Conning tower', rect: r(29, 35, -3.6, 3.6), height: 22, armor: 350, module: 'bridge', conning: true },
    { name: 'Forward superstructure', rect: r(10, 36, -8.5, 8.5), height: 20, armor: 20 },
    { name: 'Foretop', rect: r(17, 26, -4, 4), height: 36, armor: 20, module: 'dirF' },
    { name: 'Funnel', rect: r(-8, 4, -4.6, 4.6), height: 27, armor: 16, module: 'fun1' },
    { name: 'Aft superstructure', rect: r(-40, -18, -7, 7), height: 16, armor: 20 },
    { name: 'After fire-control station', rect: r(-35, -29, -3, 3), height: 24, armor: 20, module: 'dirA' },
    { name: '15 cm battery (stbd)', rect: r(-24, 25, 9.5, 15), height: 11.5, armor: 100, module: 'secS' },
    { name: '15 cm battery (port)', rect: r(-24, 25, -15, -9.5), height: 11.5, armor: 100, module: 'secP' },
  ],
  shells: {
    AP: shell({ id: 'AP', name: 'APC L/4.4 (800 kg)', mass: 800, caliber: 380, mv: 820, burster: 20.3, range: 36500, penRef: 700, fuze: 0.035, fire: 0.18 }),
    HC: shell({ id: 'HC', name: 'HE L/4.5 (800 kg)', mass: 800, caliber: 380, mv: 820, burster: 66.2, range: 36500, fire: 0.5 }),
  },
  ammo: { AP: 210, HC: 110 },
  names: ['Bismarck', 'Tirpitz', 'Friedrich der Grosse', 'Grossdeutschland'],
  visibility: 1,
  radar: 20000,
  dcParties: 3,
  citadel: { x0: -80, x1: 72 },
  shafts: [
    { engine: 'e1', y: 7.5, propX: -98, propR: 2.4, blades: 3 },
    { engine: 'e2', y: 0, propX: -104, propR: 2.4, blades: 3 },
    { engine: 'e3', y: -7.5, propX: -98, propR: 2.4, blades: 3 },
  ],
  rudders: { x: -114, ys: [-3.4, 3.4], len: 5 },
  dcNote: 'CITADEL · 320 mm BELT + 110 mm SLOPE @ 22° · 80–95 mm DECK · TRUE SCALE',
  art: {
    deck: 'teak',
    blocks: [
      { x0: -42, x1: 37, hw: 10.8, r: 1.8, taper: 5 },
      { x0: 10, x1: 36, hw: 8, r: 1.6, taper: 4 },
      { x0: -40, x1: -18, hw: 6.8, r: 1.4 },
      { x0: 15, x1: 33, hw: 5.6, r: 1.4, tone: 'light', taper: 3 },
      { x0: 17, x1: 27, hw: 4.2, r: 1.6, tone: 'light' },
      { x0: 29, x1: 35, hw: 3.6, r: 1.8, tone: 'dark' },
      { x0: -36, x1: -27, hw: 3.6, r: 1.4, tone: 'light' },
    ],
    funnels: [{ x: -2, len: 12, w: 9.2 }],
    masts: [{ x: 15.5, span: 12 }, { x: -23, span: 11 }],
    directors: [{ x: 21.5, l: 5, w: 5.4, rf: 10.5 }, { x: 32, l: 3.8, w: 4, rf: 7 }, { x: -32, l: 4.6, w: 4.6, rf: 10.5 }],
    aa: [[8, -13.5], [8, 13.5], [-6, -13.5], [-6, 13.5], [-22, -12.5], [-22, 12.5], [30, -9.6], [30, 9.6], [-38, -8.4], [-38, 8.4]],
    boats: [{ x: -12, y: -8.2, l: 9, w: 2.6 }, { x: -12, y: 8.2, l: 9, w: 2.6 }],
    catapults: [{ x: -14, y: 0, rot: Math.PI / 2, len: 28 }],
    aircraft: [{ x: -14, y: 6, rot: Math.PI / 2 }],
    breakwater: 88,
    turret: 'de',
  },
};
