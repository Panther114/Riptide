// IJN Kagero, 1941. Sources: Wikipedia (Kagerō-class destroyer, Type 93 torpedo).
// Three twin 12.7 cm Type 3 turrets and two quadruple 61 cm mounts for the Type 93
// "Long Lance": 22 km at 48–50 kn, 490 kg warhead, almost no wake — with a
// second set of torpedoes and quick-reload gear on deck. No radar.

import type { ShipClass } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';
import { LONG_LANCE } from './takao';

const L = 118.5, HALF = L / 2, B = 10.8;
const halfBeam = makeHalfBeam({ L, B, fwd: 6, aft: -34, bowP: 1.35, bowQ: 0.6, stern: 0.5 });
const inner = (x0: number, x1: number) => innerRect(halfBeam, 0.8, x0, x1);
const ib = inner(-20, -4).y1;

const turret = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 6 * DEG, guns: 2, radius: 2.9, height, barbetteRadius: 2,
  armor: { face: 3, side: 3, rear: 3, roof: 3, barbette: 6 }, magazine, barrel: 7, spacing: 1.3,
});

const HULL = { belt: 10, beltIncline: 0, beltTop: 1.3, beltBottom: -2.4, lowerBelt: 10, upperSide: 8, deck: 8, weatherDeck: 8, citadel: true, beltName: 'hull plating' };

export const KAGERO: ShipClass = {
  id: 'kagero',
  name: 'Kagero',
  type: 'DD',
  nation: 'jp',
  prefix: 'IJN',
  designation: 'DD · Kagerō class (1941)',
  blurb: 'Destroyer. 6 × 12.7 cm · 8 Long Lance tubes + 8 reloads · smoke · 35 kn · no radar',
  gunName: '12.7 CM/50 TYPE 3',
  length: L, beam: B, draft: 3.8,
  displacement: 2490,
  maxSpeed: 35 * KN,
  maxReverse: 14 * KN,
  accelTime: 34,
  turnRadius: 400,
  rudderMax: 35 * DEG,
  rudderRate: 9 * DEG,
  reserveBuoyancy: 580,
  pumpRate: 0.85,
  maxRange: 14000,
  reloadTime: 3.0,
  dispersion: { base: 10, perKm: 6, rangeRatio: 1.5 },
  hull: buildHull(L, halfBeam, 60),
  freeboard: makeFreeboard(4.0, 2.8, 26, HALF, 0.5, -40),
  halfBeam,
  zones: [{ x0: -HALF - 1, x1: HALF + 1, ...HULL }],
  modules: [
    mod('magF', 'Forward Magazine', 'MAG F', 'magazine', inner(30, 40), 'low', 40, { turret: 't1', zTop: -1 }),
    mod('magA', 'After Magazine', 'MAG A', 'magazine', inner(-44, -32), 'low', 40, { turret: 't2', zTop: -1 }),
    mod('b1', 'No. 1 Boiler Room', 'BR1', 'boiler', inner(16, 28), 'low', 42),
    mod('b2', 'No. 2 Boiler Room', 'BR2', 'boiler', inner(6, 16), 'low', 42),
    mod('b3', 'No. 3 Boiler Room', 'BR3', 'boiler', inner(-4, 6), 'low', 42),
    mod('e1', 'Starboard Turbine', 'T S', 'engine', r(-20, -4, 0, ib), 'low', 45),
    mod('e2', 'Port Turbine', 'T P', 'engine', r(-20, -4, -ib, 0), 'low', 45),
    mod('steer', 'Steering Engine Room', 'STEER', 'steering', r(-54, -49, -2.2, 2.2), 'low', 30),
    mod('bridge', 'Bridge', 'BRG', 'bridge', r(22, 28, -2.8, 2.8), 'high', 38),
    mod('dirF', 'Type 94 Director', 'DIR', 'director', r(24, 27.5, -1.6, 1.6), 'high', 28),
    mod('fun1', 'Forward Funnel', 'STK 1', 'funnel', r(11.5, 16.5, -1.8, 1.8), 'high', 28),
    mod('fun2', 'After Funnel', 'STK 2', 'funnel', r(-2.5, 1.5, -1.6, 1.6), 'high', 28),
    mod('torp1', 'Forward Torpedo Mount', 'TT 1', 'torpedo', r(4, 9, -1.6, 1.6), 'high', 30),
    mod('torp2', 'After Torpedo Mount', 'TT 2', 'torpedo', r(-16.5, -11.5, -1.6, 1.6), 'high', 30),
    mod('t1', 'No. 1 Turret', '1', 'turret', r(37, 43, -3, 3), 'high', 40),
    mod('t2', 'No. 2 Turret', '2', 'turret', r(-29, -23, -3, 3), 'high', 40),
    mod('t3', 'No. 3 Turret', '3', 'turret', r(-40, -34, -3, 3), 'high', 40),
  ],
  turrets: [
    turret('t1', 'No. 1 Turret', 40, 0, 6.2, 'magF'),
    turret('t2', 'No. 2 Turret', -26, Math.PI, 8.4, 'magA'),
    turret('t3', 'No. 3 Turret', -37, Math.PI, 5.8, 'magA'),
  ],
  torpedoes: {
    def: LONG_LANCE,
    mounts: [
      { id: 'tt1', name: 'Forward Quadruple Mount', x: 6.5, y: 0, side: 'both', arc: 70 * DEG, tubes: 4, module: 'torp1' },
      { id: 'tt2', name: 'After Quadruple Mount', x: -14, y: 0, side: 'both', arc: 70 * DEG, tubes: 4, module: 'torp2' },
    ],
  },
  sections: sections(
    ['Stern & steering', 'After magazine', 'After crew spaces', 'Turbine room', 'No. 3 boiler room', 'No. 2 boiler room', 'No. 1 boiler room', 'Forward magazine', 'Forward crew spaces', 'Bow'],
    [-HALF, -44, -32, -20, -4, 6, 16, 28, 40, 48, HALF],
    [80, 110, 120, 160, 130, 130, 130, 120, 90, 70],
  ),
  structures: [
    { name: 'Bridge', rect: r(20, 30, -3.4, 3.4), height: 10, armor: 6, module: 'bridge', conning: true },
    { name: 'Director', rect: r(24, 27.5, -1.6, 1.6), height: 13, armor: 6, module: 'dirF' },
    { name: 'Forward funnel', rect: r(11.5, 16.5, -1.8, 1.8), height: 11, armor: 6, module: 'fun1' },
    { name: 'After funnel', rect: r(-2.5, 1.5, -1.6, 1.6), height: 10, armor: 6, module: 'fun2' },
    { name: 'Forward torpedo mount', rect: r(4, 9, -1.6, 1.6), height: 6, armor: 6, module: 'torp1' },
    { name: 'After torpedo mount', rect: r(-16.5, -11.5, -1.6, 1.6), height: 6, armor: 6, module: 'torp2' },
  ],
  shells: {
    AP: shell({ id: 'AP', name: '12.7 cm Common (23 kg)', mass: 23, caliber: 127, mv: 910, burster: 1.0, range: 18400, penRef: 160, fuze: 0.01, arming: 8, fire: 0.05 }),
    HC: shell({ id: 'HC', name: '12.7 cm Type 0 HE (23 kg)', mass: 23, caliber: 127, mv: 910, burster: 1.8, range: 18400, fire: 0.12 }),
  },
  ammo: { AP: 200, HC: 400 },
  names: ['Kagero', 'Shiranui', 'Kuroshio', 'Oyashio', 'Hatsukaze', 'Yukikaze', 'Amatsukaze', 'Tokitsukaze', 'Urakaze', 'Isokaze', 'Hamakaze', 'Tanikaze', 'Nowaki'],
  visibility: 0.55,
  radar: 0,
  dcParties: 1,
  smoke: { duration: 50, charges: 3 },
  citadel: null,
  shafts: [
    { engine: 'e1', y: 2.2, propX: -48, propR: 1.4, blades: 3 },
    { engine: 'e2', y: -2.2, propX: -48, propR: 1.4, blades: 3 },
  ],
  rudders: { x: -56, ys: [0], len: 2.4 },
  dcNote: 'UNARMOURED · 8–10 mm PLATING · TRUE SCALE',
  art: {
    deck: 'linoleum',
    blocks: [
      { x0: 19, x1: 31, hw: 3.6, r: 0.9, taper: 2 },
      { x0: -6, x1: 19, hw: 2.4, r: 0.8 },
      { x0: -25, x1: -18, hw: 2.6, r: 0.8 },
      { x0: 22, x1: 29, hw: 2.8, r: 0.9, tone: 'light', taper: 1.2 },
    ],
    funnels: [{ x: 14, len: 4.8, w: 3 }, { x: -0.5, len: 4, w: 2.6 }],
    masts: [{ x: 19.5, span: 5 }, { x: -20, span: 4 }],
    directors: [{ x: 25.8, l: 2.4, w: 2.4, rf: 3 }],
    aa: [[-8.5, -2.6], [-8.5, 2.6], [10, -3.2], [10, 3.2]],
    turret: 'dd',
  },
};
