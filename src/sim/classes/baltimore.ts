// USS Baltimore (CA-68), 1943. Sources: Wikipedia (Baltimore-class cruiser);
// NavWeaps 8"/55 Marks 12 and 15 (335 lb "super-heavy" AP Mk 21), 5"/38 Mk 12.

import type { ShipClass } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';

const L = 205.3, HALF = L / 2, B = 21.6;
const halfBeam = makeHalfBeam({ L, B, fwd: 20, aft: -45, bowP: 1.8, bowQ: 0.6, stern: 0.72, transom: true });
const inner = (x0: number, x1: number) => innerRect(halfBeam, 2.2, x0, x1);

const T1 = 56, T2 = 43, T3 = -56;
const FIVE = shell({ id: 'HC', name: '5"/38 AAC (25 kg)', mass: 25, caliber: 127, mv: 792, burster: 3.3, range: 16600, fire: 0.1 });

const turret = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 5.3 * DEG, guns: 3, radius: 5.2, height, barbetteRadius: 4.4,
  armor: { face: 203, side: 95, rear: 38, roof: 76, barbette: 160 }, magazine, barrel: 13.5, spacing: 1.75,
});

export const BALTIMORE: ShipClass = {
  id: 'baltimore',
  name: 'Baltimore',
  type: 'CA',
  nation: 'us',
  prefix: 'USS',
  designation: 'CA · Baltimore class (1943)',
  blurb: 'Heavy cruiser. 9 × 8" super-heavy AP · 12 × 5"/38 · 152 mm belt · 33 kn · SG radar',
  gunName: '8"/55 MK 12',
  length: L, beam: B, draft: 8.2,
  displacement: 17300,
  maxSpeed: 33 * KN,
  maxReverse: 11 * KN,
  accelTime: 50,
  turnRadius: 560,
  rudderMax: 35 * DEG,
  rudderRate: 7 * DEG,
  reserveBuoyancy: 5800,
  pumpRate: 2.0,
  maxRange: 21000,
  reloadTime: 8.5,
  dispersion: { base: 13, perKm: 3.6, rangeRatio: 1.6 },
  hull: buildHull(L, halfBeam),
  freeboard: makeFreeboard(6.8, 3.4, 40, HALF, 1.4, -60),
  halfBeam,
  zones: [
    { x0: 64, x1: HALF + 1, belt: 16, beltIncline: 0, beltTop: 2.2, beltBottom: -2, lowerBelt: 16, upperSide: 16, deck: 16, weatherDeck: 19, citadel: false, beltName: 'bow plating' },
    { x0: -66, x1: 64, belt: 152, beltIncline: 0, beltTop: 2.2, beltBottom: -2, lowerBelt: 102, upperSide: 16, deck: 64, weatherDeck: 19, citadel: true },
    { x0: -92, x1: -66, belt: 51, beltIncline: 0, beltTop: 1.6, beltBottom: -2.4, lowerBelt: 51, upperSide: 16, deck: 64, weatherDeck: 19, citadel: true, beltName: 'steering gear plating' },
    { x0: -HALF - 1, x1: -92, belt: 16, beltIncline: 0, beltTop: 1.6, beltBottom: -2, lowerBelt: 16, upperSide: 16, deck: 16, weatherDeck: 19, citadel: false, beltName: 'stern plating' },
  ],
  modules: [
    mod('mag1', 'Turret I Magazine', 'MAG I', 'magazine', inner(49, 62), 'low', 70, { turret: 't1', zTop: -1.8 }),
    mod('mag2', 'Turret II Magazine', 'MAG II', 'magazine', inner(36, 49), 'low', 70, { turret: 't2', zTop: -1.8 }),
    mod('mag3', 'Turret III Magazine', 'MAG III', 'magazine', inner(-64, -48), 'low', 70, { turret: 't3', zTop: -1.8 }),
    mod('b1', 'Forward Fire Room', 'FR1', 'boiler', inner(20, 33), 'low', 80),
    mod('e1', 'Forward Engine Room', 'ER1', 'engine', inner(6, 20), 'low', 85),
    mod('b2', 'After Fire Room', 'FR2', 'boiler', inner(-8, 6), 'low', 80),
    mod('e2', 'After Engine Room', 'ER2', 'engine', inner(-24, -8), 'low', 85),
    mod('steer', 'Steering Gear Room', 'STEER', 'steering', r(-88, -80, -4, 4), 'low', 65),
    mod('bridge', 'Conning Tower & Bridge', 'CT', 'bridge', r(24, 28.5, -3.2, 3.2), 'high', 70),
    mod('dirF', 'Forward Mk 34 Director', 'DIR F', 'director', r(17.5, 22.5, -2.6, 2.6), 'high', 50),
    mod('dirA', 'After Mk 34 Director', 'DIR A', 'director', r(-38, -33, -2.4, 2.4), 'high', 50),
    mod('fun1', 'Forward Stack', 'STK 1', 'funnel', r(4, 12, -2.8, 2.8), 'high', 50),
    mod('fun2', 'After Stack', 'STK 2', 'funnel', r(-20, -12, -2.6, 2.6), 'high', 50),
    mod('secF', 'Forward 5" Mount', '5" F', 'secondary', r(30.4, 35.6, -2.6, 2.6), 'high', 45),
    mod('secA', 'After 5" Mount', '5" A', 'secondary', r(-46.6, -41.4, -2.6, 2.6), 'high', 45),
    mod('secP', 'Port 5" Mounts', '5" P', 'secondary', r(-10, 16, -10.5, -6), 'high', 55),
    mod('secS', 'Starboard 5" Mounts', '5" S', 'secondary', r(-10, 16, 6, 10.5), 'high', 55),
    mod('t1', 'Turret I', 'I', 'turret', r(T1 - 5, T1 + 5, -5, 5), 'high', 80),
    mod('t2', 'Turret II', 'II', 'turret', r(T2 - 5, T2 + 5, -5, 5), 'high', 80),
    mod('t3', 'Turret III', 'III', 'turret', r(T3 - 5, T3 + 5, -5, 5), 'high', 80),
  ],
  turrets: [
    turret('t1', 'Turret I', T1, 0, 9.5, 'mag1'),
    turret('t2', 'Turret II', T2, 0, 12.5, 'mag2'),
    turret('t3', 'Turret III', T3, Math.PI, 9.5, 'mag3'),
  ],
  secondary: {
    name: '5"/38 Mk 12',
    shell: FIVE,
    reload: 3.2,
    range: 12000,
    traverseRate: 20 * DEG,
    dispersion: { base: 10, perKm: 7, rangeRatio: 1.5 },
    mounts: [
      { id: 'sF', x: 33, y: 0, facing: 0, arc: 150 * DEG, guns: 2, radius: 2.6, barrel: 7.4, module: 'secF' },
      { id: 'sA', x: -44, y: 0, facing: Math.PI, arc: 150 * DEG, guns: 2, radius: 2.6, barrel: 7.4, module: 'secA' },
      ...[12, -6].flatMap((x, i) => [
        { id: `s${i}p`, x, y: -8.2, facing: -Math.PI / 2, arc: 85 * DEG, guns: 2, radius: 2.6, barrel: 7.4, module: 'secP' },
        { id: `s${i}s`, x, y: 8.2, facing: Math.PI / 2, arc: 85 * DEG, guns: 2, radius: 2.6, barrel: 7.4, module: 'secS' },
      ]),
    ],
  },
  sections: sections(
    ['Stern', 'Steering gear', 'Turret III magazine', 'After auxiliary spaces', 'After engine room', 'After fire room', 'Forward engine room', 'Forward fire room', 'Turret II magazine', 'Turret I magazine', 'Forecastle', 'Bow'],
    [-HALF, -92, -66, -48, -24, -8, 6, 20, 36, 49, 64, 84, HALF],
    [250, 500, 650, 600, 650, 650, 650, 650, 600, 600, 600, 300],
  ),
  structures: [
    { name: 'Conning tower', rect: r(24, 28.5, -3.2, 3.2), height: 16, armor: 165, module: 'bridge', conning: true },
    { name: 'Bridge superstructure', rect: r(14, 29.5, -6.2, 6.2), height: 18, armor: 13 },
    { name: 'Forward director', rect: r(17.5, 22.5, -2.6, 2.6), height: 26, armor: 13, module: 'dirF' },
    { name: 'Forward stack', rect: r(4, 12, -2.8, 2.8), height: 22, armor: 10, module: 'fun1' },
    { name: 'After stack', rect: r(-20, -12, -2.6, 2.6), height: 21, armor: 10, module: 'fun2' },
    { name: 'After superstructure', rect: r(-42, -28, -5.2, 5.2), height: 13, armor: 13 },
    { name: 'After director', rect: r(-38, -33, -2.4, 2.4), height: 18, armor: 13, module: 'dirA' },
    { name: '5in/38 mounts (stbd)', rect: r(-9, 15, 6, 10.5), height: 10, armor: 25, module: 'secS' },
    { name: '5in/38 mounts (port)', rect: r(-9, 15, -10.5, -6), height: 10, armor: 25, module: 'secP' },
  ],
  shells: {
    AP: shell({ id: 'AP', name: 'AP Mk 21 (152 kg)', mass: 152, caliber: 203, mv: 762, burster: 2.3, range: 27700, penRef: 384, fuze: 0.025, fire: 0.1 }),
    HC: shell({ id: 'HC', name: 'HC Mk 25 (118 kg)', mass: 118, caliber: 203, mv: 823, burster: 9.7, range: 27700, fire: 0.32 }),
  },
  ammo: { AP: 150, HC: 120 },
  names: ['Baltimore', 'Boston', 'Canberra', 'Quincy', 'Pittsburgh', 'Saint Paul', 'Columbus', 'Helena'],
  visibility: 0.8,
  radar: 22000,
  dcParties: 2,
  citadel: { x0: -66, x1: 64 },
  shafts: [
    { engine: 'e1', y: 6.4, propX: -74, propR: 1.9, blades: 4 },
    { engine: 'e1', y: -6.4, propX: -74, propR: 1.9, blades: 4 },
    { engine: 'e2', y: 2.4, propX: -82, propR: 1.9, blades: 4 },
    { engine: 'e2', y: -2.4, propX: -82, propR: 1.9, blades: 4 },
  ],
  rudders: { x: -94, ys: [0], len: 4.5 },
  dcNote: 'CITADEL · 152 mm BELT · 64 mm DECK · TRUE SCALE',
  art: {
    deck: 'grey',
    blocks: [
      { x0: -46, x1: 30, hw: 7.4, r: 1.4, taper: 4 },
      { x0: 14, x1: 29.5, hw: 6.2, r: 1.3, taper: 3, tone: 'light' },
      { x0: -42, x1: -28, hw: 5.2, r: 1.2 },
      { x0: 16.5, x1: 27, hw: 4.2, r: 1.2, tone: 'light' },
      { x0: 24, x1: 28.5, hw: 3.2, r: 1.4, tone: 'dark' },
    ],
    funnels: [{ x: 8, len: 8, w: 5.4 }, { x: -16, len: 8, w: 5.0 }],
    masts: [{ x: 15.5, span: 9 }, { x: -25, span: 8 }],
    directors: [{ x: 20, l: 3.8, w: 3.8, rf: 0 }, { x: -35.5, l: 3.4, w: 3.4, rf: 0 }],
    aa: [[39, -5.2], [39, 5.2], [-2, -8.6], [-2, 8.6], [-27, -7.4], [-27, 7.4], [-51, -6.2], [-51, 6.2], [70, -4.2], [70, 4.2]],
    catapults: [{ x: -88, y: -5, rot: Math.PI + 0.35, len: 13 }, { x: -88, y: 5, rot: Math.PI - 0.35, len: 13 }],
    aircraft: [{ x: -95, y: 3.2, rot: Math.PI }],
    breakwater: 72,
    turret: 'us',
  },
};
