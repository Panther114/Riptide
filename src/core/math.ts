// Small math toolkit. World units are metres, angles are radians.
// Heading convention: 0 = east (+x), increasing counter-clockwise in world space,
// but because screen y points down we treat +y as "south" visually. All sim code
// stays in this one convention; only the renderer cares about the screen.

export interface Vec2 { x: number; y: number }

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const fromAngle = (a: number, l = 1): Vec2 => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });
export const angleOf = (a: Vec2) => Math.atan2(a.y, a.x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Wrap angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
/** Signed shortest difference b - a. */
export const angleDiff = (a: number, b: number) => wrapAngle(b - a);

/** Move angle `a` toward `b` by at most `maxStep`. */
export function approachAngle(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
export function approach(a: number, b: number, maxStep: number): number {
  if (Math.abs(b - a) <= maxStep) return b;
  return a + Math.sign(b - a) * maxStep;
}

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Rotate a local vector into world space by heading. */
export function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
export function toLocal(p: Vec2, origin: Vec2, heading: number): Vec2 {
  return rotate(sub(p, origin), -heading);
}
export function toWorld(p: Vec2, origin: Vec2, heading: number): Vec2 {
  return add(rotate(p, heading), origin);
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Seeded PRNG (mulberry32) so battles can be replayed/synchronised later. */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  chance(p: number) { return this.next() < p; }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Standard normal via Box-Muller. */
  gauss(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

/** Radius multiplier for a 2D normal distribution containing probability p. */
export const sigmaForProbability = (p: number) => Math.sqrt(-2 * Math.log(1 - p));
