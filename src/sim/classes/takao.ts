// IJN Takao, 1942. Sources: Wikipedia (Takao-class cruiser, Type 93 torpedo);
// NavWeaps 20 cm/50 3rd Year Type No. 2. Five twin 20.3 cm turrets, a towering
// bridge, light splinter-proof gunhouses — and sixteen 61 cm tubes for the
// oxygen-fuelled Type 93 "Long Lance", with a full reload carried aboard.

import type { ShipClass, TorpedoDef } from '../shipClass';
import { DEG, KN, r, buildHull, makeHalfBeam, makeFreeboard, innerRect, mod, sections, shell } from './common';

const L = 203.8, HALF = L / 2, B = 20.7;
const halfBeam = makeHalfBeam({ L, B, fwd: 16, aft: -45, bowP: 1.6, bowQ: 0.6, stern: 0.45 });
const inner = (x0: number, x1: number) => innerRect(halfBeam, 2.6, x0, x1);

const S127 = shell({ id: 'HC', name: '12.7 cm Type 0 HE (23 kg)', mass: 23, caliber: 127, mv: 725, burster: 1.8, range: 14700, fire: 0.1 });

/** Type 93 Model 1 at its 48–50 kn setting: 22 km, 490 kg; wakeless (oxygen). Speed doubled for game pace. */
export const LONG_LANCE: TorpedoDef = { name: 'Type 93 "Long Lance"', speed: 50, range: 20000, warhead: 490, reload: 120, reloads: 1, detect: 450 };

const turret = (id: string, name: string, x: number, facing: number, height: number, magazine: string) => ({
  id, name, x, y: 0, facing, arc: 150 * DEG, traverseRate: 4 * DEG, guns: 2, radius: 4.6, height, barbetteRadius: 3.6,
  armor: { face: 25, side: 25, rear: 25, roof: 25, barbette: 75 }, magazine, barrel: 11.5, spacing: 2.2,
});

export const TAKAO: ShipClass = {
  id: 'takao',
  name: 'Takao',
  type: 'CA',
  nation: 'jp',
  prefix: 'IJN',
  designation: 'CA · Takao class (1942)',
  blurb: 'Heavy cruiser. 10 × 20.3 cm · 16 Long Lance tubes + reloads · 102 mm belt · 34 kn',
  gunName: '20.3 CM/50 NO. 2',
  length: L, beam: B, draft: 6.3,
  displacement: 15490,
  maxSpeed: 34.2 * KN,
  maxReverse: 11 * KN,
  accelTime: 48,
  turnRadius: 520,
  rudderMax: 35 * DEG,
  rudderRate: 7 * DEG,
  reserveBuoyancy: 5200,
  pumpRate: 1.8,
  maxRange: 21000,
  reloadTime: 8,
  dispersion: { base: 14, perKm: 3.8, rangeRatio: 1.6 },
  hull: buildHull(L, halfBeam),
  freeboard: makeFreeboard(6.2, 4.0, 30, HALF, 0.8, -55),
  halfBeam,
  zones: [
    { x0: 78, x1: HALF + 1, belt: 16, beltIncline: 0, beltTop: 2, beltBottom: -2, lowerBelt: 16, upperSide: 16, deck: 16, weatherDeck: 16, citadel: false, beltName: 'bow plating' },
    { x0: 44, x1: 78, belt: 127, beltIncline: 12 * DEG, beltTop: 2, beltBottom: -1.6, lowerBelt: 58, upperSide: 16, deck: 47, weatherDeck: 16, citadel: true, tds: 200 },
    { x0: -38, x1: 44, belt: 102, beltIncline: 12 * DEG, beltTop: 2, beltBottom: -1.6, lowerBelt: 58, upperSide: 16, deck: 35, weatherDeck: 16, citadel: true, tds: 200 },
    { x0: -66, x1: -38, belt: 127, beltIncline: 12 * DEG, beltTop: 2, beltBottom: -1.6, lowerBelt: 58, upperSide: 16, deck: 47, weatherDeck: 16, citadel: true, tds: 200 },
    { x0: -90, x1: -66, belt: 25, beltIncline: 0, beltTop: 1.6, beltBottom: -2, lowerBelt: 25, upperSide: 16, deck: 25, weatherDeck: 16, citadel: true, beltName: 'stern plating' },
    { x0: -HALF - 1, x1: -90, belt: 12, beltIncline: 0, beltTop: 1.6, beltBottom: -2, lowerBelt: 12, upperSide: 12, deck: 12, weatherDeck: 16, citadel: false, beltName: 'stern plating' },
  ],
  modules: [
    mod('mag1', 'No. 1 Magazine', 'MAG 1', 'magazine', inner(68, 78), 'low', 55, { turret: 't1', zTop: -1.5 }),
    mod('mag2', 'No. 2 Magazine', 'MAG 2', 'magazine', inner(57, 68), 'low', 55, { turret: 't2', zTop: -1.5 }),
    mod('mag3', 'No. 3 Magazine', 'MAG 3', 'magazine', inner(44, 57), 'low', 55, { turret: 't3', zTop: -1.5 }),
    mod('mag4', 'No. 4 Magazine', 'MAG 4', 'magazine', inner(-50, -38), 'low', 55, { turret: 't4', zTop: -1.5 }),
    mod('mag5', 'No. 5 Magazine', 'MAG 5', 'magazine', inner(-62, -50), 'low', 55, { turret: 't5', zTop: -1.5 }),
    mod('b1', 'No. 1 Boiler Rooms', 'BR1', 'boiler', inner(26, 42), 'low', 75),
    mod('b2', 'No. 2 Boiler Rooms', 'BR2', 'boiler', inner(10, 26), 'low', 75),
    mod('b3', 'No. 3 Boiler Rooms', 'BR3', 'boiler', inner(-4, 10), 'low', 75),
    mod('e1', 'Forward Turbine Rooms', 'TR F', 'engine', inner(-20, -4), 'low', 80),
    mod('e2', 'After Turbine Rooms', 'TR A', 'engine', inner(-36, -20), 'low', 80),
    mod('steer', 'Steering Gear Room', 'STEER', 'steering', r(-84, -76, -3.5, 3.5), 'low', 55),
    mod('bridge', 'Bridge', 'BRG', 'bridge', r(30, 36, -3.5, 3.5), 'high', 60),
    mod('dirF', 'Type 94 Director', 'DIR F', 'director', r(36, 41, -2.6, 2.6), 'high', 45),
    mod('dirA', 'After Rangefinder', 'DIR A', 'director', r(-30, -26, -2, 2), 'high', 40),
    mod('fun1', 'Forward Funnel', 'STK 1', 'funnel', r(4, 18, -4.2, 4.2), 'high', 55),
    mod('fun2', 'After Funnel', 'STK 2', 'funnel', r(-7, -1, -2.8, 2.8), 'high', 45),
    mod('secP', 'Port 12.7 cm Mounts', '12.7 P', 'secondary', r(-2, 16, -9.6, -6.4), 'high', 45),
    mod('secS', 'Starboard 12.7 cm Mounts', '12.7 S', 'secondary', r(-2, 16, 6.4, 9.6), 'high', 45),
    mod('torpP', 'Port Torpedo Mounts', 'TT P', 'torpedo', r(-30, -10, -9.8, -6.6), 'high', 45),
    mod('torpS', 'Starboard Torpedo Mounts', 'TT S', 'torpedo', r(-30, -10, 6.6, 9.8), 'high', 45),
    mod('t1', 'No. 1 Turret', '1', 'turret', r(67.5, 76.5, -4.5, 4.5), 'high', 65),
    mod('t2', 'No. 2 Turret', '2', 'turret', r(56.5, 65.5, -4.5, 4.5), 'high', 65),
    mod('t3', 'No. 3 Turret', '3', 'turret', r(45.5, 54.5, -4.5, 4.5), 'high', 65),
    mod('t4', 'No. 4 Turret', '4', 'turret', r(-49.5, -40.5, -4.5, 4.5), 'high', 65),
    mod('t5', 'No. 5 Turret', '5', 'turret', r(-60.5, -51.5, -4.5, 4.5), 'high', 65),
  ],
  turrets: [
    turret('t1', 'No. 1 Turret', 72, 0, 8.5, 'mag1'),
    turret('t2', 'No. 2 Turret', 61, 0, 11.5, 'mag2'),
    turret('t3', 'No. 3 Turret', 50, 0, 8.5, 'mag3'),
    turret('t4', 'No. 4 Turret', -45, Math.PI, 11, 'mag4'),
    turret('t5', 'No. 5 Turret', -56, Math.PI, 8, 'mag5'),
  ],
  secondary: {
    name: '12.7 cm/40 Type 89',
    shell: S127,
    reload: 3.6,
    range: 10000,
    traverseRate: 12 * DEG,
    dispersion: { base: 11, perKm: 7, rangeRatio: 1.5 },
    mounts: [12, 2].flatMap((x, i) => [
      { id: `s${i}p`, x, y: -8.2, facing: -Math.PI / 2, arc: 80 * DEG, guns: 2, radius: 2.4, barrel: 6.5, module: 'secP' },
      { id: `s${i}s`, x, y: 8.2, facing: Math.PI / 2, arc: 80 * DEG, guns: 2, radius: 2.4, barrel: 6.5, module: 'secS' },
    ]),
  },
  torpedoes: {
    def: LONG_LANCE,
    mounts: [
      { id: 'tp1', name: 'No. 1 Port Tubes', x: -14, y: -8.2, side: 'port', arc: 40 * DEG, tubes: 4, module: 'torpP' },
      { id: 'tp2', name: 'No. 2 Port Tubes', x: -26, y: -8.2, side: 'port', arc: 40 * DEG, tubes: 4, module: 'torpP' },
      { id: 'ts1', name: 'No. 1 Stbd Tubes', x: -14, y: 8.2, side: 'stbd', arc: 40 * DEG, tubes: 4, module: 'torpS' },
      { id: 'ts2', name: 'No. 2 Stbd Tubes', x: -26, y: 8.2, side: 'stbd', arc: 40 * DEG, tubes: 4, module: 'torpS' },
    ],
  },
  sections: sections(
    ['Stern', 'Steering gear', 'No. 5 magazine', 'No. 4 magazine', 'After turbine rooms', 'Forward turbine rooms', 'No. 3 boiler rooms', 'No. 2 boiler rooms', 'No. 1 boiler rooms', 'No. 3 magazine', 'No. 2 magazine', 'No. 1 magazine', 'Bow'],
    [-HALF, -90, -64, -50, -36, -20, -4, 10, 26, 44, 57, 68, 78, HALF],
    [200, 450, 450, 450, 550, 550, 500, 500, 500, 400, 350, 300, 350],
  ),
  structures: [
    { name: 'Bridge tower', rect: r(28, 46, -8, 8), height: 24, armor: 10, module: 'bridge', conning: true },
    { name: 'Main director', rect: r(36, 41, -2.6, 2.6), height: 30, armor: 10, module: 'dirF' },
    { name: 'Forward funnel', rect: r(4, 18, -4.2, 4.2), height: 20, armor: 10, module: 'fun1' },
    { name: 'After funnel', rect: r(-7, -1, -2.8, 2.8), height: 17, armor: 10, module: 'fun2' },
    { name: 'After superstructure', rect: r(-34, -22, -5, 5), height: 12, armor: 10 },
    { name: 'After rangefinder', rect: r(-30, -26, -2, 2), height: 15, armor: 10, module: 'dirA' },
    { name: '12.7 cm mounts (stbd)', rect: r(-1, 15, 6.4, 9.6), height: 9, armor: 6, module: 'secS' },
    { name: '12.7 cm mounts (port)', rect: r(-1, 15, -9.6, -6.4), height: 9, armor: 6, module: 'secP' },
    { name: 'Torpedo deck (stbd)', rect: r(-30, -10, 6.6, 9.8), height: 6.5, armor: 6, module: 'torpS' },
    { name: 'Torpedo deck (port)', rect: r(-30, -10, -9.8, -6.6), height: 6.5, armor: 6, module: 'torpP' },
  ],
  shells: {
    AP: shell({ id: 'AP', name: 'Type 91 AP (125.9 kg)', mass: 125.85, caliber: 203, mv: 835, burster: 3.11, range: 29400, penRef: 282, fuze: 0.06, fire: 0.1 }),
    HC: shell({ id: 'HC', name: 'Type 0 HE (125.9 kg)', mass: 125.85, caliber: 203, mv: 835, burster: 7.5, range: 29400, fire: 0.35 }),
  },
  ammo: { AP: 100, HC: 80 },
  names: ['Takao', 'Atago', 'Maya', 'Chokai'],
  visibility: 0.8,
  radar: 0,
  dcParties: 2,
  citadel: { x0: -66, x1: 78 },
  shafts: [
    { engine: 'e1', y: 2.4, propX: -80, propR: 1.8, blades: 3 },
    { engine: 'e1', y: -2.4, propX: -80, propR: 1.8, blades: 3 },
    { engine: 'e2', y: 6.4, propX: -72, propR: 1.8, blades: 3 },
    { engine: 'e2', y: -6.4, propX: -72, propR: 1.8, blades: 3 },
  ],
  rudders: { x: -94, ys: [0], len: 4 },
  dcNote: 'CITADEL · 102–127 mm BELT @ 12° · 35–47 mm DECK · TRUE SCALE',
  art: {
    deck: 'linoleum',
    blocks: [
      { x0: -36, x1: 44, hw: 6.6, r: 1.2, taper: 3 },
      { x0: 27, x1: 46, hw: 8, r: 1.6, taper: 4 },
      { x0: 30, x1: 44, hw: 6.2, r: 1.4, taper: 3, tone: 'light' },
      { x0: 33, x1: 42, hw: 4.4, r: 1.4, tone: 'light' },
      { x0: -34, x1: -22, hw: 5, r: 1.2 },
    ],
    funnels: [{ x: 11, len: 13, w: 8 }, { x: -4, len: 6, w: 5 }],
    masts: [{ x: 25, span: 9 }, { x: -19, span: 8 }],
    directors: [{ x: 38.5, l: 4, w: 4, rf: 6 }, { x: -28, l: 3.4, w: 3.4, rf: 4.5 }],
    aa: [[22, -7.4], [22, 7.4], [-40, -6], [-40, 6], [84, -3.6], [84, 3.6]],
    catapults: [{ x: -32, y: 6.8, rot: Math.PI / 2 + 0.7, len: 16 }, { x: -32, y: -6.8, rot: -Math.PI / 2 - 0.7, len: 16 }],
    aircraft: [{ x: -36, y: 0, rot: Math.PI }],
    breakwater: 84,
    turret: 'jp',
  },
};
