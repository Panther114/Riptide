// Islands and coastlines: generation from the battle seed plus the geometry the
// simulation needs (inside tests, nearest-edge distance, line-of-sight).

import { Rng, Vec2, TAU, dist, pointInPolygon } from '../core/math';
import type { BattleConfig } from './types';

export interface Island { pts: Vec2[]; cx: number; cy: number; r: number }

export function makeIsland(pts: Vec2[]): Island {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return { pts, cx, cy, r };
}

/** Irregular blob: a radius modulated by a few random harmonics. */
function blob(rng: Rng, cx: number, cy: number, rx: number, ry: number, rot: number, n = 44): Vec2[] {
  const h = [1, 2, 3, 5].map((k) => ({ k, a: rng.range(0.03, 0.16) / Math.sqrt(k), p: rng.range(0, TAU) }));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    let m = 1;
    for (const q of h) m += q.a * Math.sin(q.k * t + q.p);
    const x = Math.cos(t) * rx * m, y = Math.sin(t) * ry * m;
    pts.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return pts;
}

/** Islands for a battle: explicit outlines, or generated from the seed around the spawn points. */
export function generateIslands(cfg: BattleConfig): Island[] {
  if (cfg.islands) return cfg.islands.map(makeIsland);
  const terrain = cfg.terrain ?? 'open';
  if (terrain === 'open') return [];
  const rng = new Rng((cfg.seed ^ 0x51a7d) >>> 0);
  const half = cfg.mapSize / 2;
  const clear = (x: number, y: number, r: number) => cfg.ships.every((s) => Math.hypot(s.x - x, s.y - y) > r + 3200);
  const out: Vec2[][] = [];
  if (terrain === 'strait') {
    // two coastlines leave a channel through the middle of the battle area
    const w = cfg.mapSize * 0.33;
    for (const side of [-1, 1]) {
      const pts: Vec2[] = [];
      const n = 90;
      const y0 = side * half * 1.25;
      // smooth noise: random offsets, low-passed, plus two long swells (headlands and bays)
      const raw = Array.from({ length: n + 1 }, () => rng.range(-1, 1));
      const sm = raw.map((_, i) => { let a = 0, c = 0; for (let j = -3; j <= 3; j++) { const q = raw[i + j]; if (q !== undefined) { a += q; c++; } } return a / c; });
      const p1 = rng.range(0, 6), p2 = rng.range(0, 6);
      for (let i = 0; i <= n; i++) {
        const x = -half * 1.3 + (i / n) * half * 2.6;
        const y = side * (w / 2 + sm[i] * 700 + Math.sin(x / 3600 + p1) * 1100 + Math.sin(x / 1700 + p2) * 380);
        pts.push({ x, y });
      }
      pts.push({ x: half * 1.3, y: y0 }, { x: -half * 1.3, y: y0 });
      if (side > 0) pts.reverse();
      out.push(pts);
    }
    // keep ships out of the coast: if a spawn sits on land, it is moved by the world
    for (let i = 0; i < 3; i++) {
      const x = rng.range(-half * 0.6, half * 0.6), y = rng.range(-w * 0.25, w * 0.25);
      if (clear(x, y, 900)) out.push(blob(rng, x, y, rng.range(300, 800), rng.range(250, 600), rng.range(0, TAU)));
    }
    return out.map(makeIsland);
  }
  // archipelago
  const count = 6 + Math.floor(rng.next() * 4);
  for (let tries = 0; out.length < count && tries < 200; tries++) {
    const x = rng.range(-half * 0.85, half * 0.85), y = rng.range(-half * 0.85, half * 0.85);
    const rx = rng.range(500, 2300), ry = rx * rng.range(0.45, 1);
    if (!clear(x, y, rx)) continue;
    if (out.some((o) => { const c = makeIsland(o); return Math.hypot(c.cx - x, c.cy - y) < c.r + rx + 1500; })) continue;
    out.push(blob(rng, x, y, rx, ry, rng.range(0, TAU)));
  }
  return out.map(makeIsland);
}

export function insideIsland(p: Vec2, isl: Island): boolean {
  if (Math.hypot(p.x - isl.cx, p.y - isl.cy) > isl.r) return false;
  return pointInPolygon(p, isl.pts);
}

export function onLand(p: Vec2, islands: Island[]): Island | null {
  for (const i of islands) if (insideIsland(p, i)) return i;
  return null;
}

/** Signed distance to the coast (negative inside) and the nearest coastal point. */
export function coastDistance(p: Vec2, isl: Island): { d: number; q: Vec2 } {
  let best = Infinity, q: Vec2 = { x: isl.cx, y: isl.cy };
  const pts = isl.pts;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    const abx = b.x - a.x, aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    const cx = a.x + abx * t, cy = a.y + aby * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) { best = d; q = { x: cx, y: cy }; }
  }
  return { d: pointInPolygon(p, pts) ? -best : best, q };
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Does the straight line a→b cross land? */
export function landBlocks(a: Vec2, b: Vec2, islands: Island[]): boolean {
  for (const isl of islands) {
    // bounding circle vs segment
    const abx = b.x - a.x, aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((isl.cx - a.x) * abx + (isl.cy - a.y) * aby) / (abx * abx + aby * aby || 1)));
    if (dist({ x: a.x + abx * t, y: a.y + aby * t }, { x: isl.cx, y: isl.cy }) > isl.r) continue;
    const pts = isl.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (segIntersect(a, b, pts[j], pts[i])) return true;
  }
  return false;
}
