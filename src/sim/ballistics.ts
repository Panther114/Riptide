// Exterior ballistics & armour penetration — semi-realistic, tuned for play.
//
// Ranges, striking velocities, fall angles and penetration follow the shape of
// the real 16"/50 Mk 7 curves (NavWeaps). Time of flight is compressed (~2.3x)
// so that salvos land in a time span that keeps the duel tense rather than slow.

import { DEG, clamp, sigmaForProbability } from '../core/math';
import type { ShellDef } from './shipClass';

/** Game time of flight (s) to a given range (m). */
export function flightTime(range: number): number {
  return (range / 1800) * (1 + range / 30000) + 0.4;
}

/** Angle of fall below horizontal (rad). Real 16"/50: ~10° @ 13.7 km, ~22° @ 22.8 km, ~36° @ 32 km. */
export function fallAngle(range: number, shell: ShellDef): number {
  const km = range / 1000;
  const hc = shell.id === 'HC' ? 1.06 : 1;
  return clamp((1.2 + 0.42 * km + 0.0265 * km * km) * hc, 0.5, 60) * DEG;
}

/** Striking velocity (m/s). */
export function strikeVelocity(range: number, shell: ShellDef): number {
  const decay = shell.id === 'HC' ? 39000 : 46000;
  return shell.muzzleVelocity * Math.exp(-range / decay);
}

/** Normal-impact penetration of face-hardened/class-A armour (mm). */
export function penetration(velocity: number, shell: ShellDef): number {
  if (shell.id === 'HC') return shell.caliber * shell.penMult; // ~1/6 calibre
  return 830 * Math.pow(velocity / 762, 1.38) * shell.penMult;
}

/** Peak altitude for drawing the arc (m) — purely visual. */
export function apexHeight(range: number): number {
  const a = fallAngle(range, { id: 'AP' } as ShellDef);
  return (range / 4) * Math.tan(a) * 1.1;
}

export interface Dispersion { lateral: number; range: number } // 1-sigma, metres

export function baseDispersion(range: number, d: { base: number; perKm: number; rangeRatio: number }, mult: number): Dispersion {
  const lat = (d.base + d.perKm * (range / 1000)) * mult;
  return { lateral: lat, range: lat * d.rangeRatio };
}

export const R50 = sigmaForProbability(0.5);
export const R90 = sigmaForProbability(0.9);

export interface ArmorTest {
  thickness: number;      // nominal mm
  effective: number;      // line-of-sight mm
  angle: number;          // obliquity from plate normal (rad)
  pen: number;            // shell penetration at impact (mm)
  result: 'pen' | 'nonpen' | 'ricochet' | 'shatter';
}

/**
 * Test a plate given the shell direction (unit 3D) and the plate normal (unit 3D,
 * pointing outward towards the shell).
 */
export function testPlate(thickness: number, dir: [number, number, number], normal: [number, number, number], velocity: number, shell: ShellDef, rnd: () => number): ArmorTest {
  const cosA = Math.abs(dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2]);
  let angle = Math.acos(clamp(cosA, 0, 1));
  // AP caps normalise the shell slightly into the plate.
  if (shell.id === 'AP') angle = Math.max(0, angle - 6 * DEG);
  // Oblique impact costs more than the simple line-of-sight thickness (shell must turn into the plate).
  const effective = thickness / Math.pow(Math.max(0.08, Math.cos(angle)), 1.45);
  const pen = penetration(velocity, shell) * (0.94 + rnd() * 0.12);
  let result: ArmorTest['result'];
  const ricoStart = shell.id === 'AP' ? 62 * DEG : 75 * DEG;
  const ricoFull = shell.id === 'AP' ? 72 * DEG : 82 * DEG;
  // Thin plates cannot deflect a 16" shell.
  const overmatch = thickness * 14.3 < shell.caliber;
  if (!overmatch && angle > ricoFull) result = 'ricochet';
  else if (!overmatch && angle > ricoStart && rnd() < (angle - ricoStart) / (ricoFull - ricoStart)) result = 'ricochet';
  else if (pen >= effective) result = 'pen';
  else result = 'nonpen';
  return { thickness, effective, angle, pen, result };
}
