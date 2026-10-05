// Shared helpers for ship class data.

import type { Vec2 } from '../../core/math';
import type { ModuleDef, ModuleKind, Rect, SectionDef, ShellDef } from '../shipClass';

export const mod = (id: string, name: string, short: string, kind: ModuleKind, rect: Rect, band: 'low' | 'high', hp: number, extra: Partial<ModuleDef> = {}): ModuleDef =>
  ({ id, name, short, kind, rect, band, hp, ...extra });

/** Watertight sections from a list of bulkhead positions (aft to fwd) and per-section capacities. */
export function sections(names: string[], xs: number[], caps: number[]): SectionDef[] {
  return names.map((name, i) => ({ id: 's' + (i + 1), name, x0: xs[i], x1: xs[i + 1], capacity: caps[i] }));
}

/**
 * Shell factory. Blast ("burst") follows the bursting charge and the shell's mass,
 * calibrated on the 16" Mk 8 AP (15.6 kg burster, 1,225 kg → 115) and Mk 13 HC.
 * penRef is the normal-impact penetration at the muzzle, back-solved from NavWeaps tables.
 */
export function shell(o: { id: 'AP' | 'HC'; name: string; mass: number; caliber: number; mv: number; burster: number; range: number; penRef?: number; fuze?: number; arming?: number; fire: number }): ShellDef {
  const k = o.id === 'AP' ? 0.83 : 0.51;
  return {
    id: o.id, name: o.name, mass: o.mass, caliber: o.caliber, muzzleVelocity: o.mv,
    burst: Math.max(6, Math.round(k * Math.sqrt(o.burster * o.mass))),
    fuzeDelay: o.id === 'AP' ? (o.fuze ?? 0.033) : 0,
    armingThreshold: o.id === 'AP' ? (o.arming ?? Math.round(o.caliber / 6.3)) : 0,
    fireChance: o.fire, penMult: o.id === 'AP' ? 1 : 0.17, penRef: o.penRef ?? 0, ballisticRange: o.range,
  };
}

export const DEG = Math.PI / 180;
export const KN = 0.5144;
export const r = (x0: number, x1: number, y0: number, y1: number): Rect => ({ x0, x1, y0, y1 });

// ---------------------------------------------------------------- hull helpers

export interface HullShape {
  L: number; B: number;
  /** Local x where the parallel middle body ends forward / aft. */
  fwd: number; aft: number;
  /** Bow waterline shape: (1 - t^p)^q. Larger q = fuller shoulders. */
  bowP: number; bowQ: number;
  /** Fraction of the half-beam remaining at the stern. */
  stern: number;
  /** Transom (flat, cut-off) stern instead of a rounded cruiser stern. */
  transom?: boolean;
}

export function makeHalfBeam(h: HullShape): (x: number) => number {
  const half = h.L / 2, hb = h.B / 2;
  return (x: number) => {
    if (x > half || x < -half) return 0;
    if (x >= h.fwd) {
      const t = (x - h.fwd) / (half - h.fwd);
      return hb * Math.pow(Math.max(0, 1 - Math.pow(t, h.bowP)), h.bowQ);
    }
    if (x <= h.aft) {
      const t = (h.aft - x) / (half + h.aft);
      if (h.transom) return hb * (1 - (1 - h.stern) * Math.pow(t, 1.5)) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 22)));
      return hb * (1 - (1 - h.stern) * Math.pow(t, 1.6)) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 7)));
    }
    return hb;
  };
}

export function buildHull(L: number, halfBeam: (x: number) => number, N = 90) {
  const pts: Vec2[] = [];
  const HALF = L / 2;
  for (let i = 0; i <= N; i++) { const x = -HALF + (L * i) / N; pts.push({ x, y: halfBeam(x) }); }
  for (let i = N; i >= 0; i--) { const x = -HALF + (L * i) / N; pts.push({ x, y: -halfBeam(x) }); }
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1e-6 || Math.abs(p.y - pts[i - 1].y) > 1e-6);
}

/** Freeboard with a raised, sheered forecastle. */
export function makeFreeboard(base: number, bowRise: number, from: number, half: number, sternDrop = 0, aftFrom = -half) {
  return (x: number) => {
    if (x > from) return base + ((x - from) / (half - from)) * bowRise;
    if (x < aftFrom) return base - ((aftFrom - x) / (half + aftFrom)) * sternDrop;
    return base;
  };
}

/** Space between the torpedo bulkheads over a length of hull. */
export const innerRect = (halfBeam: (x: number) => number, depth: number, x0: number, x1: number): Rect => {
  const hb = Math.min(halfBeam(x0), halfBeam(x1)) - depth;
  return { x0, x1, y0: -hb, y1: hb };
};

