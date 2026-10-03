// Data-driven ship class definitions.
//
// Local ship coordinates: +x towards the bow, +y towards starboard, metres.
// Heights (z) are metres above the design waterline.
//
// The single class implemented for the prototype is the Iowa-class fast
// battleship (BB-61) as built in 1943. Figures follow published data
// (Friedman, "U.S. Battleships"; Garzke & Dulin; NavWeaps) and are adapted where
// a 2D top-down game needs simplification.

import type { Vec2 } from '../core/math';

export type ModuleKind =
  | 'magazine' | 'boiler' | 'engine' | 'steering' | 'bridge' | 'director' | 'funnel' | 'turret';

export interface Rect { x0: number; x1: number; y0: number; y1: number }

export interface ModuleDef {
  id: string;
  name: string;
  short: string;            // label used on the status diagram
  kind: ModuleKind;
  rect: Rect;
  band: 'low' | 'high';     // below the armoured deck (vitals) or above it
  hp: number;
  turret?: string;          // magazine -> turret it feeds
  zTop?: number;            // top of the space above the waterline (low-band vitals)
}

export interface TurretDef {
  id: string;
  name: string;
  x: number; y: number;
  facing: number;            // rest orientation, radians relative to bow
  arc: number;               // +/- traverse limit from facing
  traverseRate: number;      // rad/s
  guns: number;
  radius: number;            // gunhouse footprint radius
  height: number;            // roof height above waterline
  barbetteRadius: number;
  armor: { face: number; side: number; rear: number; roof: number; barbette: number };
  magazine: string;
}

export interface SectionDef {
  id: string;
  name: string;
  x0: number; x1: number;    // aft, fwd bounds
  capacity: number;          // tonnes of water it can hold (both sides)
}

export interface StructureDef {
  name: string;
  rect: Rect;
  height: number;            // top height above waterline
  armor: number;             // plating thickness, mm
  module?: string;           // module that a hit on this structure damages directly
  conning?: boolean;
}

export interface ArmorZone {
  x0: number; x1: number;
  belt: number;              // main belt thickness (mm)
  beltIncline: number;       // radians, top tilted outboard (Iowa: internal belt, 19 deg)
  beltTop: number;           // z
  beltBottom: number;        // z
  lowerBelt: number;         // tapered lower belt effective (mm)
  upperSide: number;         // plating above the belt (mm)
  deck: number;              // armoured (second) deck (mm)
  weatherDeck: number;       // bomb / weather deck (mm)
  citadel: boolean;
}

export interface ShellDef {
  id: 'AP' | 'HC';
  name: string;
  mass: number;              // kg
  caliber: number;           // mm
  muzzleVelocity: number;    // m/s
  burst: number;             // relative blast strength (game units)
  fuzeDelay: number;         // seconds (0 = instantaneous)
  armingThreshold: number;   // mm of plate needed to arm a delay fuze
  fireChance: number;        // base chance to start a fire on detonation
  penMult: number;           // multiplier on AP penetration curve
}

export interface ShipClass {
  id: string;
  name: string;
  designation: string;
  length: number; beam: number; draft: number;
  displacement: number;      // full load, tonnes
  maxSpeed: number;          // m/s (design)
  maxReverse: number;
  accelTime: number;         // seconds to approach full speed
  turnRadius: number;        // tactical radius at full rudder & full speed (m)
  rudderMax: number;         // rad
  rudderRate: number;        // rad/s
  reserveBuoyancy: number;   // tonnes of flood water that will sink her
  pumpRate: number;          // t/s total drainage at full power
  maxRange: number;          // main battery fire-control range limit (m)
  reloadTime: number;        // s
  dispersion: { base: number; perKm: number; rangeRatio: number };
  hull: Vec2[];
  freeboard: (x: number) => number;
  halfBeam: (x: number) => number;
  zones: ArmorZone[];
  modules: ModuleDef[];
  turrets: TurretDef[];
  sections: SectionDef[];
  structures: StructureDef[];
  shells: Record<'AP' | 'HC', ShellDef>;
  ammo: Record<'AP' | 'HC', number>;  // per turret magazine
  names: string[];
}

const D = Math.PI / 180;

// ---------------------------------------------------------------- hull shape
const L = 270.4, HALF = L / 2, B = 33.0;

function iowaHalfBeam(x: number): number {
  const hb = B / 2;
  if (x > HALF || x < -HALF) return 0;
  if (x >= 18) {
    // long fine entry, Iowa's characteristic narrow forecastle
    const t = (x - 18) / (HALF - 18);
    return hb * Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), 0.62);
  }
  if (x <= -92) {
    const t = (-92 - x) / (HALF - 92);
    // rounded cruiser stern
    return hb * (1 - 0.42 * Math.pow(t, 1.6)) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 7)));
  }
  return hb;
}

function buildHull(): Vec2[] {
  const pts: Vec2[] = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const x = -HALF + (L * i) / N;
    pts.push({ x, y: iowaHalfBeam(x) });
  }
  for (let i = N; i >= 0; i--) {
    const x = -HALF + (L * i) / N;
    pts.push({ x, y: -iowaHalfBeam(x) });
  }
  // de-duplicate the bow point
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1e-6 || Math.abs(p.y - pts[i - 1].y) > 1e-6);
}

const iowaFreeboard = (x: number) => {
  // sheer line: high flared bow, low quarterdeck
  if (x > 40) return 8.6 + (x - 40) / (HALF - 40) * 4.2;
  if (x < -60) return 8.6 - (-60 - x) / (HALF - 60) * 1.4;
  return 8.6;
};

const r = (x0: number, x1: number, y0: number, y1: number): Rect => ({ x0, x1, y0, y1 });

export const IOWA: ShipClass = {
  id: 'iowa',
  name: 'Iowa',
  designation: 'BB · Iowa class (1943)',
  length: L, beam: B, draft: 11.0,
  displacement: 57540,
  maxSpeed: 32.5 * 0.5144,
  maxReverse: 10 * 0.5144,
  accelTime: 75,
  turnRadius: 760,
  rudderMax: 35 * D,
  rudderRate: 6 * D,
  reserveBuoyancy: 19000,
  pumpRate: 4.5,
  maxRange: 26000,
  reloadTime: 15,
  dispersion: { base: 20, perKm: 3.4, rangeRatio: 1.65 },
  hull: buildHull(),
  freeboard: iowaFreeboard,
  halfBeam: iowaHalfBeam,
  zones: [
    // bow: no belt, splinter plating only
    { x0: 92, x1: 136, belt: 38, beltIncline: 0, beltTop: 3.2, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 38, weatherDeck: 38, citadel: false },
    // forward citadel (magazines) - transverse bulkhead 287 mm at fwd end
    { x0: 36, x1: 92, belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    // machinery spaces
    { x0: -64, x1: 36, belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    // aft magazine
    { x0: -96, x1: -64, belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    // steering gear box (343 mm sides, 158 mm roof)
    { x0: -124, x1: -96, belt: 343, beltIncline: 0, beltTop: 2.0, beltBottom: -3.5, lowerBelt: 120, upperSide: 25, deck: 158, weatherDeck: 38, citadel: true },
    // stern overhang
    { x0: -136, x1: -124, belt: 25, beltIncline: 0, beltTop: 2.5, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 38, weatherDeck: 38, citadel: false },
  ],
  modules: [
    { id: 'mag1', name: 'Turret I Magazine', short: 'MAG I', kind: 'magazine', rect: r(64, 86, -10, 10), band: 'low', hp: 110, turret: 't1', zTop: -2.4 },
    { id: 'mag2', name: 'Turret II Magazine', short: 'MAG II', kind: 'magazine', rect: r(38, 63, -11, 11), band: 'low', hp: 110, turret: 't2', zTop: -2.4 },
    { id: 'mag3', name: 'Turret III Magazine', short: 'MAG III', kind: 'magazine', rect: r(-88, -62, -11, 11), band: 'low', hp: 110, turret: 't3', zTop: -2.4 },
    { id: 'b1', name: 'No. 1 Fire Room', short: 'FR1', kind: 'boiler', rect: r(25, 36, -12.5, 12.5), band: 'low', hp: 120 },
    { id: 'e1', name: 'No. 1 Engine Room', short: 'ER1', kind: 'engine', rect: r(13, 25, -12.5, 12.5), band: 'low', hp: 130 },
    { id: 'b2', name: 'No. 2 Fire Room', short: 'FR2', kind: 'boiler', rect: r(1, 13, -12.5, 12.5), band: 'low', hp: 120 },
    { id: 'e2', name: 'No. 2 Engine Room', short: 'ER2', kind: 'engine', rect: r(-11, 1, -12.5, 12.5), band: 'low', hp: 130 },
    { id: 'b3', name: 'No. 3 Fire Room', short: 'FR3', kind: 'boiler', rect: r(-23, -11, -12.5, 12.5), band: 'low', hp: 120 },
    { id: 'e3', name: 'No. 3 Engine Room', short: 'ER3', kind: 'engine', rect: r(-35, -23, -12.5, 12.5), band: 'low', hp: 130 },
    { id: 'b4', name: 'No. 4 Fire Room', short: 'FR4', kind: 'boiler', rect: r(-47, -35, -12.5, 12.5), band: 'low', hp: 120 },
    { id: 'e4', name: 'No. 4 Engine Room', short: 'ER4', kind: 'engine', rect: r(-60, -47, -12.5, 12.5), band: 'low', hp: 130 },
    { id: 'steer', name: 'Steering Gear', short: 'STEER', kind: 'steering', rect: r(-122, -100, -8, 8), band: 'low', hp: 90 },
    { id: 'bridge', name: 'Conning Tower & Bridge', short: 'BRIDGE', kind: 'bridge', rect: r(27, 36, -5.5, 5.5), band: 'high', hp: 100 },
    { id: 'dirF', name: 'Forward Main Director', short: 'DIR F', kind: 'director', rect: r(17, 25, -4, 4), band: 'high', hp: 70 },
    { id: 'dirA', name: 'Aft Main Director', short: 'DIR A', kind: 'director', rect: r(-44, -37, -3.5, 3.5), band: 'high', hp: 70 },
    { id: 'fun1', name: 'Forward Funnel', short: 'FUN 1', kind: 'funnel', rect: r(3, 13, -4.5, 4.5), band: 'high', hp: 70 },
    { id: 'fun2', name: 'Aft Funnel', short: 'FUN 2', kind: 'funnel', rect: r(-23, -13, -4.5, 4.5), band: 'high', hp: 70 },
    { id: 't1', name: 'Turret I', short: 'T I', kind: 'turret', rect: r(66, 80, -7, 7), band: 'high', hp: 120 },
    { id: 't2', name: 'Turret II', short: 'T II', kind: 'turret', rect: r(43, 57, -7, 7), band: 'high', hp: 120 },
    { id: 't3', name: 'Turret III', short: 'T III', kind: 'turret', rect: r(-82, -68, -7, 7), band: 'high', hp: 120 },
  ],
  turrets: [
    { id: 't1', name: 'Turret I', x: 73, y: 0, facing: 0, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 13.5, barbetteRadius: 6.3,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag1' },
    { id: 't2', name: 'Turret II', x: 50, y: 0, facing: 0, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 17.0, barbetteRadius: 6.3,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag2' },
    { id: 't3', name: 'Turret III', x: -75, y: 0, facing: Math.PI, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 13.0, barbetteRadius: 6.3,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag3' },
  ],
  sections: [
    { id: 's1', name: 'Bow', x0: 112, x1: 136, capacity: 1300 },
    { id: 's2', name: 'Forecastle', x0: 88, x1: 112, capacity: 2300 },
    { id: 's3', name: 'Fwd Magazines', x0: 38, x1: 88, capacity: 4200 },
    { id: 's4', name: 'Fwd Machinery', x0: 13, x1: 38, capacity: 3300 },
    { id: 's5', name: 'Midships', x0: -11, x1: 13, capacity: 3300 },
    { id: 's6', name: 'Aft Machinery', x0: -35, x1: -11, capacity: 3300 },
    { id: 's7', name: 'Machinery Aft', x0: -60, x1: -35, capacity: 3200 },
    { id: 's8', name: 'Aft Magazine', x0: -96, x1: -60, capacity: 3600 },
    { id: 's9', name: 'Steering', x0: -124, x1: -96, capacity: 1900 },
    { id: 's10', name: 'Stern', x0: -136, x1: -124, capacity: 700 },
  ],
  structures: [
    { name: 'Conning tower', rect: r(28, 35, -4.2, 4.2), height: 24, armor: 439, module: 'bridge', conning: true },
    { name: 'Forward superstructure', rect: r(-4, 38, -9, 9), height: 21, armor: 19 },
    { name: 'Forward director tower', rect: r(16, 26, -4.5, 4.5), height: 38, armor: 38, module: 'dirF' },
    { name: 'Forward funnel', rect: r(3, 13, -4.5, 4.5), height: 30, armor: 16, module: 'fun1' },
    { name: 'Aft funnel', rect: r(-23, -13, -4.5, 4.5), height: 29, armor: 16, module: 'fun2' },
    { name: 'Aft superstructure', rect: r(-48, -12, -8, 8), height: 18, armor: 16 },
    { name: 'Aft director', rect: r(-45, -36, -3.5, 3.5), height: 25, armor: 38, module: 'dirA' },
    { name: '5"/38 battery (stbd)', rect: r(-38, 28, 9, 15.5), height: 12.5, armor: 64 },
    { name: '5"/38 battery (port)', rect: r(-38, 28, -15.5, -9), height: 12.5, armor: 64 },
  ],
  shells: {
    AP: { id: 'AP', name: 'AP Mk 8 (1,225 kg)', mass: 1225, caliber: 406, muzzleVelocity: 762, burst: 115, fuzeDelay: 0.033, armingThreshold: 64, fireChance: 0.2, penMult: 1 },
    HC: { id: 'HC', name: 'HC Mk 13 (862 kg)', mass: 862, caliber: 406, muzzleVelocity: 820, burst: 125, fuzeDelay: 0, armingThreshold: 0, fireChance: 0.55, penMult: 0.17 },
  },
  ammo: { AP: 270, HC: 120 },
  names: ['Iowa', 'New Jersey', 'Missouri', 'Wisconsin', 'Illinois', 'Kentucky'],
};

export const SHIP_CLASSES: Record<string, ShipClass> = { iowa: IOWA };
