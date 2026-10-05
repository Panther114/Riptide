// IJN Yamato in her 1944–45 configuration. Sources: Wikipedia (Yamato, Yamato
// class); NavWeaps 46 cm/45 Type 94; Navy General Board, "Yamato class armor".
//
// The heaviest armour and guns ever put to sea: a 410 mm belt inclined 20°,
// 200–230 mm armour deck, 650 mm turret faces, and 1,460 kg shells. Paid for with
// slow 2°/s turrets, a 40 s reload and a modest 27 kn.

import type { ShipClass } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';

const L = 263, HALF = L / 2, B = 38.9;
const halfBeam = makeHalfBeam({ L, B, fwd: 24, aft: -58, bowP: 1.55, bowQ: 0.72, stern: 0.52 });
const TDS = 5.1;
const inner = (x0: number, x1: number) => innerRect(halfBeam, TDS, x0, x1);
const ib = inner(-34, -14).y1;

const T1 = 64, T2 = 45, T3 = -60;

const S155 = shell({ id: 'HC', name: '15.5 cm Type 0 HE (55.9 kg)', mass: 55.9, caliber: 155, mv: 920, burster: 3, range: 27400, fire: 0.1 });
const S127 = shell({ id: 'HC', name: '12.7 cm Type 0 HE (23 kg)', mass: 23, caliber: 127, mv: 725, burster: 1.8, range: 14700, fire: 0.1 });

const turret = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 2 * DEG, guns: 3, radius: 9.0, height, barbetteRadius: 7.4,
  armor: { face: 650, side: 250, rear: 190, roof: 270, barbette: 560 }, magazine, barrel: 24, spacing: 3.1,
});

export const YAMATO: ShipClass = {
  id: 'yamato',
  name: 'Yamato',
  type: 'BB',
  nation: 'jp',
  prefix: 'IJN',
  designation: 'BB · Yamato class (1945)',
  blurb: 'Super-battleship. 9 × 46 cm · 410 mm belt @ 20° · 200 mm deck · 27 kn · slow turrets',
  gunName: '46 CM/45 TYPE 94',
  length: L, beam: B, draft: 11,
  displacement: 71659,
  maxSpeed: 27 * KN,
  maxReverse: 8 * KN,
  accelTime: 88,
  turnRadius: 640,
  rudderMax: 35 * DEG,
  rudderRate: 5 * DEG,
  reserveBuoyancy: 26000,
  pumpRate: 5.5,
  maxRange: 28000,
  reloadTime: 20,
  dispersion: { base: 22, perKm: 3.5, rangeRatio: 1.65 },
  hull: buildHull(L, halfBeam),
  freeboard: makeFreeboard(8.6, 5.4, 40, HALF, 1.6, -70),
  halfBeam,
  zones: [
    { x0: 76, x1: HALF + 1, belt: 25, beltIncline: 0, beltTop: 3, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 35, weatherDeck: 35, citadel: false, beltName: 'bow plating' },
    { x0: 36, x1: 76, belt: 410, beltIncline: 20 * DEG, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 200, upperSide: 25, deck: 230, weatherDeck: 35, citadel: true, tds: 400 },
    { x0: -50, x1: 36, belt: 410, beltIncline: 20 * DEG, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 200, upperSide: 25, deck: 200, weatherDeck: 35, citadel: true, tds: 400 },
    { x0: -78, x1: -50, belt: 410, beltIncline: 20 * DEG, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 200, upperSide: 25, deck: 230, weatherDeck: 35, citadel: true, tds: 400 },
    { x0: -112, x1: -78, belt: 350, beltIncline: 0, beltTop: 1.8, beltBottom: -3.5, lowerBelt: 200, upperSide: 25, deck: 200, weatherDeck: 35, citadel: true, beltName: 'steering gear armour' },
    { x0: -HALF - 1, x1: -112, belt: 25, beltIncline: 0, beltTop: 2, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 25, weatherDeck: 35, citadel: false, beltName: 'stern plating' },
  ],
  modules: [
    mod('mag1', 'No. 1 Turret Magazines', 'MAG 1', 'magazine', inner(54, 76), 'low', 120, { turret: 't1', zTop: -2.4 }),
    mod('mag2', 'No. 2 Turret Magazines', 'MAG 2', 'magazine', inner(36, 54), 'low', 120, { turret: 't2', zTop: -2.4 }),
    mod('mag3', 'No. 3 Turret Magazines', 'MAG 3', 'magazine', inner(-72, -50), 'low', 120, { turret: 't3', zTop: -2.4 }),
    mod('b1', 'Forward Boiler Rooms', 'BR F', 'boiler', inner(18, 34), 'low', 130),
    mod('b2', 'Centre Boiler Rooms', 'BR C', 'boiler', inner(2, 18), 'low', 130),
    mod('b3', 'After Boiler Rooms', 'BR A', 'boiler', inner(-14, 2), 'low', 130),
    // four turbine rooms abreast, one per shaft
    mod('e1', 'Starboard Outer Turbine Room', 'T SO', 'engine', r(-34, -14, ib / 2, ib), 'low', 110),
    mod('e2', 'Starboard Inner Turbine Room', 'T SI', 'engine', r(-34, -14, 0, ib / 2), 'low', 110),
    mod('e3', 'Port Inner Turbine Room', 'T PI', 'engine', r(-34, -14, -ib / 2, 0), 'low', 110),
    mod('e4', 'Port Outer Turbine Room', 'T PO', 'engine', r(-34, -14, -ib, -ib / 2), 'low', 110),
    mod('steer', 'Main Steering Gear Room', 'STEER', 'steering', r(-108, -96, -6.5, 6.5), 'low', 100),
    mod('bridge', 'Conning Tower & Bridge', 'CT', 'bridge', r(20, 25.5, -4.2, 4.2), 'high', 110),
    mod('dirF', 'Main Battery Director (15 m RF)', 'DIR F', 'director', r(12, 18, -3.4, 3.4), 'high', 75),
    mod('dirA', 'After Rangefinder', 'DIR A', 'director', r(-30, -24, -3, 3), 'high', 65),
    mod('fun1', 'Funnel', 'STK', 'funnel', r(-6, 8, -5, 5), 'high', 85),
    mod('secF', 'Forward 15.5 cm Turret', '15.5 F', 'secondary', r(26, 36, -5, 5), 'high', 70),
    mod('secA', 'After 15.5 cm Turret', '15.5 A', 'secondary', r(-50, -40, -5, 5), 'high', 70),
    mod('secP', 'Port 12.7 cm Battery', '12.7 P', 'secondary', r(-20, 12, -17, -11), 'high', 80),
    mod('secS', 'Starboard 12.7 cm Battery', '12.7 S', 'secondary', r(-20, 12, 11, 17), 'high', 80),
    mod('t1', 'No. 1 Turret', '1', 'turret', r(T1 - 9, T1 + 9, -9, 9), 'high', 140),
    mod('t2', 'No. 2 Turret', '2', 'turret', r(T2 - 9, T2 + 9, -9, 9), 'high', 140),
    mod('t3', 'No. 3 Turret', '3', 'turret', r(T3 - 9, T3 + 9, -9, 9), 'high', 140),
  ],
  turrets: [
    turret('t1', 'No. 1 Turret', T1, 0, 14.5, 'mag1'),
    turret('t2', 'No. 2 Turret', T2, 0, 18.5, 'mag2'),
    turret('t3', 'No. 3 Turret', T3, Math.PI, 14.0, 'mag3'),
  ],
  secondary: {
    name: '15.5 cm/60 & 12.7 cm/40',
    shell: S127,
    reload: 3.5,
    range: 10000,
    traverseRate: 12 * DEG,
    dispersion: { base: 11, perKm: 6, rangeRatio: 1.5 },
    mounts: [
      { id: 'sF', x: 31, y: 0, facing: 0, arc: 140 * DEG, guns: 3, radius: 4.4, barrel: 10, module: 'secF', shell: S155, reload: 6, range: 15000 },
      { id: 'sA', x: -45, y: 0, facing: Math.PI, arc: 140 * DEG, guns: 3, radius: 4.4, barrel: 10, module: 'secA', shell: S155, reload: 6, range: 15000 },
      ...[8, -4, -16].flatMap((x, i) => [
        { id: `s${i}p`, x, y: -14.6, facing: -Math.PI / 2, arc: 80 * DEG, guns: 2, radius: 2.4, barrel: 6.5, module: 'secP' },
        { id: `s${i}s`, x, y: 14.6, facing: Math.PI / 2, arc: 80 * DEG, guns: 2, radius: 2.4, barrel: 6.5, module: 'secS' },
      ]),
    ],
  },
  sections: sections(
    ['Stern', 'Steering gear', 'No. 3 magazines', 'Auxiliary machinery', 'Turbine rooms', 'After boiler rooms', 'Centre boiler rooms', 'Forward boiler rooms', 'No. 2 magazines', 'No. 1 magazines', 'Forecastle', 'Bow'],
    [-HALF, -112, -78, -50, -34, -14, 2, 18, 36, 54, 76, 104, HALF],
    [700, 2000, 2500, 2000, 3000, 2400, 2400, 2400, 2500, 2600, 2800, 1100],
  ),
  structures: [
    { name: 'Conning tower', rect: r(20, 25.5, -4.2, 4.2), height: 22, armor: 500, module: 'bridge', conning: true },
    { name: 'Tower bridge', rect: r(3, 26.5, -9, 9), height: 26, armor: 20 },
    { name: 'Main director tower', rect: r(11, 19, -4.5, 4.5), height: 40, armor: 20, module: 'dirF' },
    { name: 'Funnel', rect: r(-6, 8, -5, 5), height: 30, armor: 25, module: 'fun1' },
    { name: 'After superstructure', rect: r(-34, -16, -7, 7), height: 18, armor: 20 },
    { name: 'After rangefinder', rect: r(-30, -24, -3, 3), height: 24, armor: 20, module: 'dirA' },
    { name: 'Forward 15.5 cm turret', rect: r(26.6, 35.4, -4.4, 4.4), height: 22, armor: 25, module: 'secF' },
    { name: 'After 15.5 cm turret', rect: r(-49.4, -40.6, -4.4, 4.4), height: 18, armor: 25, module: 'secA' },
    { name: '12.7 cm battery (stbd)', rect: r(-20, 12, 11, 17), height: 12, armor: 13, module: 'secS' },
    { name: '12.7 cm battery (port)', rect: r(-20, 12, -17, -11), height: 12, armor: 13, module: 'secP' },
  ],
  shells: {
    AP: shell({ id: 'AP', name: 'Type 91 AP (1,460 kg)', mass: 1460, caliber: 460, mv: 780, burster: 23.9, range: 42000, penRef: 820, fuze: 0.06, fire: 0.18 }),
    HC: shell({ id: 'HC', name: 'Type 0 HE (1,360 kg)', mass: 1360, caliber: 460, mv: 805, burster: 61.7, range: 42000, fire: 0.5 }),
  },
  ammo: { AP: 300, HC: 120 },
  names: ['Yamato', 'Musashi', 'Shinano', 'Kii'],
  visibility: 1.05,
  radar: 18000,
  dcParties: 4,
  citadel: { x0: -78, x1: 76 },
  shafts: [
    { engine: 'e1', y: 10.5, propX: -96, propR: 2.5, blades: 3 },
    { engine: 'e2', y: 4, propX: -104, propR: 2.5, blades: 3 },
    { engine: 'e3', y: -4, propX: -104, propR: 2.5, blades: 3 },
    { engine: 'e4', y: -10.5, propX: -96, propR: 2.5, blades: 3 },
  ],
  rudders: { x: -116, ys: [0], len: 6 },
  dcNote: 'CITADEL · 410 mm BELT @ 20° · 200–230 mm DECK · TRUE SCALE',
  art: {
    deck: 'teak',
    blocks: [
      { x0: -36, x1: 36, hw: 13.2, r: 2, taper: 6 },
      { x0: 3, x1: 26.5, hw: 9, r: 1.8, taper: 5 },
      { x0: -34, x1: -16, hw: 7, r: 1.4 },
      { x0: 7, x1: 24, hw: 6.4, r: 1.6, tone: 'light', taper: 4 },
      { x0: 10, x1: 20, hw: 4.6, r: 1.8, tone: 'light', taper: 2 },
      { x0: 20, x1: 25.5, hw: 4.2, r: 2, tone: 'dark' },
      { x0: -31, x1: -23, hw: 3.4, r: 1.2, tone: 'light' },
    ],
    funnels: [{ x: 1, len: 14, w: 10 }],
    masts: [{ x: -12, span: 12 }],
    directors: [{ x: 15, l: 5, w: 5.4, rf: 15 }, { x: -27, l: 4, w: 4, rf: 10 }],
    aa: [[30, -11.5], [30, 11.5], [12, -13], [12, 13], [-8, -14.5], [-8, 14.5], [-26, -11], [-26, 11], [-56, -12], [-56, 12], [86, -6], [86, 6]],
    catapults: [{ x: -108, y: -7.5, rot: Math.PI - 0.3, len: 19 }, { x: -108, y: 7.5, rot: Math.PI + 0.3, len: 19 }],
    aircraft: [{ x: -121, y: 5.5, rot: Math.PI }, { x: -117, y: -6, rot: Math.PI }],
    breakwater: 92,
    turret: 'jp',
  },
};
