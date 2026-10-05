// USS Fletcher (DD-445), 1942. Sources: Wikipedia (Fletcher-class destroyer,
// Mark 15 torpedo); NavWeaps 5"/38 Mk 12. Five enclosed 5"/38 mounts directed by a
// Mk 37 director with SG radar, ten 21" tubes in two centreline quintuple mounts.
// Unarmoured: big-gun AP passes straight through; HE and 5" fire tear her apart.

import type { ShipClass, TorpedoDef } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';

const L = 114.8, HALF = L / 2, B = 12.0;
const halfBeam = makeHalfBeam({ L, B, fwd: 4, aft: -30, bowP: 1.4, bowQ: 0.62, stern: 0.66, transom: true });
const inner = (x0: number, x1: number) => innerRect(halfBeam, 0.8, x0, x1);

/**
 * Mark 15: 45 kn for 6,000 yd, or 26.5 kn for 15,000 yd; 363 kg warhead (Mod 3).
 * Speeds doubled for game pace.
 */
export const MK15: TorpedoDef = { name: 'Mk 15', speed: 46, range: 5500, warhead: 363, reload: 0, reloads: 0, detect: 1100, slow: { speed: 27, range: 13700 } };

const mount = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 20 * DEG, guns: 1, radius: 2.3, height, barbetteRadius: 1.6,
  armor: { face: 3, side: 3, rear: 3, roof: 3, barbette: 6 }, magazine, barrel: 7, spacing: 0,
});

const HULL = { belt: 12, beltIncline: 0, beltTop: 1.4, beltBottom: -2.6, lowerBelt: 12, upperSide: 9, deck: 9, weatherDeck: 9, citadel: true, beltName: 'hull plating' };

export const FLETCHER: ShipClass = {
  id: 'fletcher',
  name: 'Fletcher',
  type: 'DD',
  nation: 'us',
  prefix: 'USS',
  designation: 'DD · Fletcher class (1942)',
  blurb: 'Destroyer. 5 × 5"/38 · 10 × 21" Mk 15 torpedoes · SG radar · smoke · 36.5 kn',
  gunName: '5"/38 MK 12',
  length: L, beam: B, draft: 4.2,
  displacement: 2924,
  maxSpeed: 36.5 * KN,
  maxReverse: 15 * KN,
  accelTime: 32,
  turnRadius: 380,
  rudderMax: 35 * DEG,
  rudderRate: 9 * DEG,
  reserveBuoyancy: 620,
  pumpRate: 0.9,
  maxRange: 14000,
  reloadTime: 2.2,
  dispersion: { base: 9, perKm: 5.5, rangeRatio: 1.5 },
  hull: buildHull(L, halfBeam, 60),
  freeboard: makeFreeboard(4.4, 2.6, 22, HALF, 0.6, -40),
  halfBeam,
  zones: [{ x0: -HALF - 1, x1: HALF + 1, ...HULL }],
  modules: [
    mod('magF', 'Forward Magazine', 'MAG F', 'magazine', inner(25, 35), 'low', 40, { turret: 'm51', zTop: -1 }),
    mod('magA', 'After Magazine', 'MAG A', 'magazine', inner(-46, -36), 'low', 40, { turret: 'm55', zTop: -1 }),
    mod('b1', 'No. 1 Fire Room', 'FR1', 'boiler', inner(12, 24), 'low', 45),
    mod('b2', 'No. 2 Fire Room', 'FR2', 'boiler', inner(0, 12), 'low', 45),
    mod('e1', 'No. 1 Engine Room', 'ER1', 'engine', inner(-12, 0), 'low', 50),
    mod('e2', 'No. 2 Engine Room', 'ER2', 'engine', inner(-24, -12), 'low', 50),
    mod('steer', 'Steering Engine Room', 'STEER', 'steering', r(-53, -48, -2.4, 2.4), 'low', 32),
    mod('bridge', 'Bridge & Pilot House', 'BRG', 'bridge', r(18, 24, -3, 3), 'high', 40),
    mod('dirF', 'Mk 37 Director', 'DIR', 'director', r(19.5, 23.5, -1.8, 1.8), 'high', 30),
    mod('fun1', 'Forward Stack', 'STK 1', 'funnel', r(7.5, 12.5, -1.8, 1.8), 'high', 30),
    mod('fun2', 'After Stack', 'STK 2', 'funnel', r(-7.5, -2.5, -1.8, 1.8), 'high', 30),
    mod('torp1', 'Forward Torpedo Mount', 'TT 1', 'torpedo', r(0.5, 5.5, -1.6, 1.6), 'high', 30),
    mod('torp2', 'After Torpedo Mount', 'TT 2', 'torpedo', r(-14.5, -9.5, -1.6, 1.6), 'high', 30),
    mod('m51', 'Mount 51', '51', 'turret', r(37.7, 42.3, -2.3, 2.3), 'high', 38),
    mod('m52', 'Mount 52', '52', 'turret', r(29.7, 34.3, -2.3, 2.3), 'high', 38),
    mod('m53', 'Mount 53', '53', 'turret', r(-24.3, -19.7, -2.3, 2.3), 'high', 38),
    mod('m54', 'Mount 54', '54', 'turret', r(-35.3, -30.7, -2.3, 2.3), 'high', 38),
    mod('m55', 'Mount 55', '55', 'turret', r(-46.3, -41.7, -2.3, 2.3), 'high', 38),
  ],
  turrets: [
    mount('m51', 'Mount 51', 40, 0, 6.5, 'magF'),
    mount('m52', 'Mount 52', 32, 0, 8.8, 'magF'),
    mount('m53', 'Mount 53', -22, Math.PI, 8.8, 'magA'),
    mount('m54', 'Mount 54', -33, Math.PI, 6.5, 'magA'),
    mount('m55', 'Mount 55', -44, Math.PI, 5.8, 'magA'),
  ],
  torpedoes: {
    def: MK15,
    mounts: [
      { id: 'tt1', name: 'Forward Quintuple Mount', x: 3, y: 0, side: 'both', arc: 70 * DEG, tubes: 5, module: 'torp1' },
      { id: 'tt2', name: 'After Quintuple Mount', x: -12, y: 0, side: 'both', arc: 70 * DEG, tubes: 5, module: 'torp2' },
    ],
  },
  sections: sections(
    ['Stern & steering', 'After magazine', 'After crew spaces', 'No. 2 engine room', 'No. 1 engine room', 'No. 2 fire room', 'No. 1 fire room', 'Forward magazine', 'Forward crew spaces', 'Bow'],
    [-HALF, -46, -36, -24, -12, 0, 12, 24, 35, 46, HALF],
    [90, 110, 120, 150, 150, 150, 150, 120, 100, 80],
  ),
  structures: [
    { name: 'Bridge', rect: r(17, 28, -3.8, 3.8), height: 11, armor: 13, module: 'bridge', conning: true },
    { name: 'Mk 37 director', rect: r(19.5, 23.5, -1.8, 1.8), height: 15, armor: 6, module: 'dirF' },
    { name: 'Forward stack', rect: r(7.5, 12.5, -1.8, 1.8), height: 12, armor: 6, module: 'fun1' },
    { name: 'After stack', rect: r(-7.5, -2.5, -1.8, 1.8), height: 11, armor: 6, module: 'fun2' },
    { name: 'Forward torpedo mount', rect: r(0.5, 5.5, -1.6, 1.6), height: 6.5, armor: 6, module: 'torp1' },
    { name: 'After torpedo mount', rect: r(-14.5, -9.5, -1.6, 1.6), height: 6.5, armor: 6, module: 'torp2' },
    { name: 'After deckhouse', rect: r(-30, -15, -3.6, 3.6), height: 7, armor: 6 },
  ],
  shells: {
    AP: shell({ id: 'AP', name: '5"/38 Common (24.5 kg)', mass: 24.5, caliber: 127, mv: 792, burster: 1.1, range: 16600, penRef: 164, fuze: 0.01, arming: 8, fire: 0.05 }),
    HC: shell({ id: 'HC', name: '5"/38 AAC (25 kg)', mass: 25, caliber: 127, mv: 792, burster: 3.3, range: 16600, fire: 0.12 }),
  },
  ammo: { AP: 250, HC: 500 },
  names: ['Fletcher', 'Radford', 'Nicholas', "O'Bannon", 'Johnston', 'Hoel', 'Heermann', 'Kidd', 'The Sullivans', 'Cassin Young'],
  visibility: 0.55,
  radar: 18000,
  dcParties: 1,
  smoke: { duration: 50, charges: 3 },
  citadel: null,
  shafts: [
    { engine: 'e1', y: 2.4, propX: -46, propR: 1.4, blades: 3 },
    { engine: 'e2', y: -2.4, propX: -46, propR: 1.4, blades: 3 },
  ],
  rudders: { x: -54, ys: [0], len: 2.6 },
  dcNote: 'UNARMOURED · 9–16 mm PLATING · TRUE SCALE',
  art: {
    deck: 'grey',
    blocks: [
      { x0: 14, x1: 28, hw: 4.2, r: 1, taper: 2.5 },
      { x0: -10, x1: 14, hw: 2.6, r: 0.8 },
      { x0: -30, x1: -15, hw: 3.6, r: 0.8 },
      { x0: 17, x1: 26, hw: 3.3, r: 0.9, tone: 'light', taper: 1.5 },
    ],
    funnels: [{ x: 10, len: 4.4, w: 3 }, { x: -5, len: 4.4, w: 3 }],
    masts: [{ x: 15, span: 5 }],
    directors: [{ x: 21.5, l: 2.6, w: 2.6, rf: 0 }],
    aa: [[-17, -3.2], [-17, 3.2], [14, -4.4], [14, 4.4], [-39, -2.6], [-39, 2.6]],
    turret: 'dd',
  },
};
