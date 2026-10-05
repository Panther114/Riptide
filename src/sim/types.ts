import type { Vec2 } from '../core/math';

export type AmmoType = 'AP' | 'HC';
export type TeamId = 'blue' | 'red';

/** Telegraph positions, index -2..4. */
export const TELEGRAPH = [
  { v: -2, label: 'FULL ASTERN', frac: -1 },
  { v: -1, label: 'HALF ASTERN', frac: -0.5 },
  { v: 0, label: 'STOP', frac: 0 },
  { v: 1, label: 'SLOW AHEAD', frac: 0.3 },
  { v: 2, label: 'HALF AHEAD', frac: 0.55 },
  { v: 3, label: 'STANDARD', frac: 0.8 },
  { v: 4, label: 'FULL AHEAD', frac: 1 },
];
export const telegraphFrac = (t: number) => TELEGRAPH[t + 2].frac;
export const telegraphLabel = (t: number) => TELEGRAPH[t + 2].label;

/**
 * Everything a controller (local player, AI, or later a network peer) can ask a
 * ship to do. The simulation only ever reads ships' commands — it never looks at
 * the keyboard — so any ship can be driven by any kind of controller.
 */
export interface ShipCommand {
  telegraph: number;        // -2..4
  rudder: number;           // -1..1 requested rudder (fraction of max, + = starboard)
  aim: Vec2 | null;         // requested fall-of-shot point (world)
  fire: boolean;            // fire every ready turret this tick
  ammo: AmmoType;           // ammunition to load next
  /** Launch a torpedo spread from every ready mount that bears on this point (one tick). */
  torpedo?: Vec2 | null;
  /** Smoke generators running. */
  smoke?: boolean;
  /** Secondary battery weapons-free (default true). */
  secondaries?: boolean;
  /** One-shot orders (damage control etc.), consumed by the ship when received. */
  orders?: Order[];
}

/** What a damage-control party can be sent to. */
export type DCTarget = { type: 'module'; id: string } | { type: 'section'; index: number };

export type Order =
  | { kind: 'dc'; target: DCTarget }        // send the best-placed party here
  | { kind: 'dcAuto' }                      // release every party back to automatic damage control
  | { kind: 'counterflood' };              // flood the opposite side to correct a list

export const newCommand = (): ShipCommand => ({ telegraph: 0, rudder: 0, aim: null, fire: false, ammo: 'AP', torpedo: null, smoke: false, secondaries: true });

export type ModuleStateLevel = 0 | 1 | 2 | 3; // ok, damaged, heavy, destroyed
export const STATE_NAMES = ['Operational', 'Damaged', 'Heavily damaged', 'Destroyed'];

/** Spawn description for a ship — this is what a lobby will eventually produce. */
export interface ShipSpawn {
  classId: string;
  name?: string;
  team: TeamId;
  x: number; y: number; heading: number;
  speed?: number;            // initial speed (m/s)
  telegraph?: number;
  controller: 'player' | 'ai';
}

export type Conditions = 'day' | 'dusk' | 'night';
export type Terrain = 'open' | 'islands' | 'strait';

export interface BattleConfig {
  seed: number;
  mapSize: number;          // square side (m)
  ships: ShipSpawn[];
  difficulty: 'cadet' | 'officer' | 'admiral';
  wind: number;             // radians, for smoke drift
  /** Light: visual detection range (day ~26 km, dusk ~14 km, night ~7 km for a battleship). */
  conditions?: Conditions;
  terrain?: Terrain;
  /** Explicit island outlines (world metres). Generated from the seed when absent and terrain ≠ open. */
  islands?: Vec2[][];
}
