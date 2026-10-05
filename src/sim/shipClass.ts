// Data-driven ship class definitions.
//
// Local ship coordinates: +x towards the bow, +y towards starboard, metres.
// Heights (z) are metres above the design waterline.
//
// Every class is pure data: hull curve, armour zones, internal modules, turrets,
// secondary battery, torpedo tubes, watertight sections, superstructure and an
// art description. The simulation, the damage model, the procedural artwork and
// the damage-control diagram are all built from the same numbers, so what you
// see is what gets hit. Individual classes live in ./classes/.

import type { Vec2 } from '../core/math';

export type ShipType = 'BB' | 'CA' | 'DD';
export type Nation = 'us' | 'de' | 'jp';

export type ModuleKind =
  | 'magazine' | 'boiler' | 'engine' | 'steering' | 'bridge' | 'director' | 'funnel' | 'turret'
  | 'secondary' | 'torpedo';

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
  barrel: number;            // muzzle distance from the pivot (m) — art & muzzle flash
  spacing: number;           // distance between gun axes (m)
}

/** One mount of the secondary (dual-purpose / casemate) battery. */
export interface SecondaryMountDef {
  id: string;
  x: number; y: number;
  facing: number;
  arc: number;
  guns: number;
  radius: number;
  barrel: number;
  module: string;            // module (battery group) whose state silences the mount
  /** Override the battery's gun for this mount (mixed secondary batteries, e.g. Yamato). */
  shell?: ShellDef;
  reload?: number;
  range?: number;
}

export interface SecondaryBattery {
  name: string;              // e.g. '5"/38 Mk 12'
  shell: ShellDef;
  reload: number;            // s (game time)
  range: number;             // effective engagement range (m)
  traverseRate: number;
  dispersion: { base: number; perKm: number; rangeRatio: number };
  mounts: SecondaryMountDef[];
}

export interface TorpedoDef {
  name: string;
  speed: number;             // m/s
  range: number;             // m
  warhead: number;           // kg of explosive
  reload: number;            // s to reload a mount from the spare set
  reloads: number;           // spare torpedo sets per mount (0 = none)
  detect: number;            // m: range at which the wake can be seen
  /** Long-range low-speed setting, used automatically when the aim lies beyond the fast setting's reach. */
  slow?: { speed: number; range: number };
}

export interface TorpedoMountDef {
  id: string;
  name: string;
  x: number; y: number;
  /** 'both': centreline mount that trains to either beam; 'port' / 'stbd': fixed side. */
  side: 'both' | 'port' | 'stbd';
  arc: number;               // +/- around the beam (rad)
  tubes: number;
  module: string;
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
  citadel: boolean;          // vital spaces (machinery, magazines) lie in this zone
  beltName?: string;         // what the hit report calls the belt here
  /** Sloped armour deck behind the belt (German "turtleback"): thickness and slope from horizontal. */
  slope?: { thickness: number; angle: number };
  /** Torpedo-defence system rating: kg of charge it can absorb without the holding bulkhead failing. */
  tds?: number;
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
  penMult: number;           // HC: fraction of calibre it can punch through
  penRef: number;            // AP: normal-impact penetration at the muzzle (mm)
  ballisticRange: number;    // gun's maximum range (m) — scales the trajectory curves
}

/** Description of the procedural top-down artwork (generic builder). */
export interface ArtSpec {
  deck: 'teak' | 'grey' | 'linoleum';
  /** Superstructure tiers, drawn bottom to top. */
  blocks: { x0: number; x1: number; hw: number; r?: number; taper?: number; tone?: 'steel' | 'light' | 'dark'; y?: number }[];
  funnels: { x: number; len: number; w: number; y?: number }[];
  masts: { x: number; span: number }[];
  directors: { x: number; y?: number; l: number; w: number; rf?: number }[];
  aa: [number, number][];
  boats?: { x: number; y: number; l: number; w: number }[];
  catapults?: { x: number; y: number; rot: number; len: number }[];
  aircraft?: { x: number; y: number; rot: number }[];
  breakwater?: number;
  /** Turret gunhouse style. */
  turret: 'us' | 'de' | 'jp' | 'dd';
}

export interface Shaft { engine: string; y: number; propX: number; propR: number; blades: number }

export interface ShipClass {
  id: string;
  name: string;
  type: ShipType;
  nation: Nation;
  prefix: string;            // USS / KMS / IJN
  designation: string;
  blurb: string;             // one-line description for menus
  gunName: string;           // main battery name for the HUD
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
  secondary?: SecondaryBattery;
  torpedoes?: { def: TorpedoDef; mounts: TorpedoMountDef[] };
  sections: SectionDef[];
  structures: StructureDef[];
  shells: Record<'AP' | 'HC', ShellDef>;
  ammo: Record<'AP' | 'HC', number>;  // per magazine
  names: string[];
  // ---- sensors, damage control, smoke
  /** How conspicuous the ship is: multiplies the observer's visual range (BB 1.0, DD ~0.6). */
  visibility: number;
  /** Surface-search radar range (m), 0 if none. Needs the primary director intact. */
  radar: number;
  dcParties: number;
  smoke?: { duration: number; charges: number };
  // ---- damage-control diagram
  citadel: { x0: number; x1: number } | null;
  shafts: Shaft[];
  rudders: { x: number; ys: number[]; len: number };
  /** Frame numbering for the diagram scale (optional). */
  frames?: { toX: (f: number) => number; max: number };
  dcNote: string;
  art: ArtSpec | 'iowa';
}

// ---------------------------------------------------------------- registry

import { IOWA } from './classes/iowa';
import { BISMARCK } from './classes/bismarck';
import { YAMATO } from './classes/yamato';
import { BALTIMORE } from './classes/baltimore';
import { TAKAO } from './classes/takao';
import { FLETCHER } from './classes/fletcher';
import { KAGERO } from './classes/kagero';

export const SHIP_CLASSES: Record<string, ShipClass> = {
  iowa: IOWA, bismarck: BISMARCK, yamato: YAMATO,
  baltimore: BALTIMORE, takao: TAKAO,
  fletcher: FLETCHER, kagero: KAGERO,
};

export const CLASS_ORDER = ['iowa', 'bismarck', 'yamato', 'baltimore', 'takao', 'fletcher', 'kagero'];
export const TYPE_NAMES: Record<ShipType, string> = { BB: 'Battleship', CA: 'Heavy cruiser', DD: 'Destroyer' };

export const modulesOfKind = (cls: ShipClass, kind: ModuleKind) => cls.modules.filter((m) => m.kind === kind);

export { IOWA };
export { DEG, KN, r, makeHalfBeam, buildHull, makeFreeboard, innerRect } from './classes/common';
export type { HullShape } from './classes/common';
