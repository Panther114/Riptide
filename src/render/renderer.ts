// World renderer: water (WebGL) underneath a 2D canvas for everything else.

import { Vec2, TAU, clamp, clamp01, dist, fromAngle, lerp, DEG } from '../core/math';
import { R50, R90, flightTime } from '../sim/ballistics';
import type { Ship } from '../sim/ship';
import type { ShellDef } from '../sim/shipClass';
import type { TeamId } from '../sim/types';
import type { World } from '../sim/world';
import { Camera } from './camera';
import { Effects } from './effects';
import { buildShipArt, liveryFor, ShipArt } from './shipArt';
import { Water } from './water';

interface WakePt { x: number; y: number; t: number; v: number; hx: number; hy: number }
interface Decal { x: number; y: number; r: number; a: number }
interface Slick { x: number; y: number; r: number; t: number; max: number }
export interface FloatText { x: number; y: number; text: string; sub?: string; color: string; t: number; life: number; big?: boolean }

/** Where to draw the edge-of-screen pointer to an off-screen point (null if on screen). Avoids the HUD panels. */
export function edgePointer(cam: Camera, sp: Vec2): { x: number; y: number; ang: number } | null {
  const m = 30;
  if (sp.x > m && sp.y > m && sp.x < cam.w - m && sp.y < cam.h - m) return null;
  const x0 = 40, x1 = cam.w - 40, y0 = 80, y1 = cam.h - 200;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const k = Math.min((x1 - x0) / 2 / Math.abs(Math.cos(ang) || 1e-6), (y1 - y0) / 2 / Math.abs(Math.sin(ang) || 1e-6));
  let x = cx + Math.cos(ang) * k, y = cy + Math.sin(ang) * k;
  if (x > cam.w - 210 && y < 205) { if (Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))) y = 210; else x = cam.w - 215; }
  // keep clear of the combat log under the minimap
  if (x > cam.w - 360 && y > 185 && y < 540) x = cam.w - 372;
  return { x, y, ang };
}

export const TEAM_COLOR = { blue: '#5fb4ff', red: '#ff6a55' };
export const TEAM_RGB = { blue: '95,180,255', red: '255,106,85' };

/** Where to aim so a shell arrives with the target: her current motion projected over the time of flight (iterated, as range changes). */
export function leadPoint(from: Vec2, s: Ship, shell: ShellDef): Vec2 {
  const v = fromAngle(s.heading, s.speed);
  let p = s.pos;
  for (let i = 0; i < 3; i++) {
    const tof = flightTime(dist(from, p), shell);
    p = { x: s.pos.x + v.x * tof, y: s.pos.y + v.y * tof };
  }
  return p;
}

export interface OverlayState {
  player: Ship | null;
  aimWorld: Vec2 | null;
  mouse: Vec2;
  lockId: number | null;
  /** The gun aim is a fixed point on the sea (aimWorld), not the cursor. */
  aimFixed?: boolean;
  rudderHeld: number;
  showOverlay: boolean;
  time: number;
  weapon: 'guns' | 'torpedo';
  /** Whose eyes we see the battle through (null: everything, e.g. spectating). */
  viewTeam: TeamId | null;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  water: Water;
  camera = new Camera();
  fx = new Effects();
  arts = new Map<string, ShipArt>();
  wakes = new Map<number, WakePt[]>();
  decals = new Map<number, Decal[]>();
  slicks: Slick[] = [];
  texts: FloatText[] = [];
  private wakeTimer = 0;
  /** Water is low-frequency: render it below native resolution for speed. */
  waterScale = new URLSearchParams(location.search).has('lowgpu') ? 0.35 : 0.75;
  time = 0;
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private islandPaths: Path2D[] = [];
  private islandsFor: unknown = null;
  private viewTeam: TeamId | null = null;

  constructor(glCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.water = new Water(glCanvas);
  }

  art(ship: Ship): ShipArt {
    const key = ship.cls.id + ':' + ship.team;
    let a = this.arts.get(key);
    if (!a) { a = buildShipArt(ship.cls, liveryFor(ship.cls.nation, ship.team)); this.arts.set(key, a); }
    return a;
  }

  /** Upper bound on canvas pixel density; lowered automatically on slow GPUs. */
  maxDpr = 2;
  private perf = { t: 0, n: 0, slow: 0 };

  /** Adaptive quality: if frames are consistently slow, render at lower density. */
  trackPerf(dtReal: number) {
    const p = this.perf;
    p.t += dtReal; p.n++;
    if (p.t < 2) return;
    const fps = p.n / p.t;
    p.t = 0; p.n = 0;
    if (fps < 42) p.slow++; else p.slow = Math.max(0, p.slow - 1);
    if (p.slow >= 2) {
      p.slow = 0;
      const cur = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      if (cur > 1) { this.maxDpr = Math.max(1, cur - 0.5); this.resize(); }
      else if (this.waterScale > 0.5) { this.waterScale = 0.5; this.resize(); }
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of [this.canvas, this.water.canvas]) {
      const k = c === this.water.canvas ? this.waterScale : 1;
      c.width = Math.round(w * dpr * k); c.height = Math.round(h * dpr * k);
      c.style.width = w + 'px'; c.style.height = h + 'px';
    }
    this.camera.resize(w, h, dpr);
  }

  reset() {
    this.wakes.clear(); this.decals.clear(); this.slicks = []; this.texts = []; this.fx.ps = [];
  }

  addDecal(ship: Ship, x: number, y: number, r: number) {
    let d = this.decals.get(ship.id);
    if (!d) { d = []; this.decals.set(ship.id, d); }
    d.push({ x, y, r, a: 0.5 + Math.random() * 0.4 });
    if (d.length > 60) d.shift();
  }

  addText(t: Omit<FloatText, 't'>) {
    this.texts.push({ ...t, t: 0 });
    if (this.texts.length > 40) this.texts.shift();
  }

  /** Is this ship drawn for the current viewer? */
  seen(world: World, s: Ship) { return this.viewTeam == null || world.isVisibleTo(this.viewTeam, s); }

  // ---------------------------------------------------------------- per-frame updates
  update(world: World, dt: number) {
    this.time += dt;
    this.fx.wind = { x: Math.cos(world.cfg.wind) * 4, y: Math.sin(world.cfg.wind) * 4 };
    this.fx.update(dt);
    this.wakeTimer -= dt;
    const sample = this.wakeTimer <= 0;
    if (sample) this.wakeTimer = 0.4;
    for (const s of world.ships) {
      if (s.status === 'sunk') continue;
      let w = this.wakes.get(s.id);
      if (!w) { w = []; this.wakes.set(s.id, w); }
      if (sample) {
        const stern = s.localToWorld({ x: -s.cls.length / 2 + 8, y: 0 });
        const f = fromAngle(s.heading);
        w.push({ x: stern.x, y: stern.y, t: this.time, v: Math.abs(s.speed), hx: f.x, hy: f.y });
      }
      while (w.length && this.time - w[0].t > 55) w.shift();
      if (!this.seen(world, s)) continue;
      const art = this.art(s);
      const k = s.cls.length / 270;
      // funnel smoke & fires
      const dark = s.alive ? 1 - s.power : 0.2;
      for (const fx of art.funnels) {
        const p = s.localToWorld({ x: fx, y: 0 });
        if (s.alive) this.fx.funnelSmoke(p.x, p.y, (2.2 + s.power * 2) * Math.sqrt(k), dt, dark * 0.6 + 0.2);
      }
      if (s.alive && Math.abs(s.speed) > 3 && Math.random() < dt * 6) {
        const p = s.localToWorld({ x: -s.cls.length / 2 + 2 - Math.random() * 25 * k, y: (Math.random() - 0.5) * s.cls.beam * 0.55 });
        this.fx.add({ k: 'foam', x: p.x, y: p.y, r: (8 + Math.random() * 8) * Math.max(0.5, k), gr: 1.5, life: 9, a: 0.55 * Math.min(1, Math.abs(s.speed) / 12), c: '230,240,242' });
      }
      for (const f of s.fires) {
        const p = s.localToWorld({ x: f.x, y: f.y });
        this.fx.fireTick(p.x, p.y, f.intensity * (1 - s.sinkProgress), dt);
      }
      if (s.status === 'sinking' || s.status === 'exploded') {
        const p = s.localToWorld({ x: (Math.random() - 0.5) * s.cls.length * 0.8, y: (Math.random() - 0.5) * s.cls.beam * 0.6 });
        this.fx.bubbles(p.x, p.y, 20 * Math.max(0.5, k), dt);
        if (Math.random() < dt * 0.6) this.slicks.push({ x: p.x, y: p.y, r: 10, t: 0, max: (90 + Math.random() * 120) * Math.max(0.4, k) });
        if (s.status === 'exploded' && Math.random() < dt * 6) {
          const q = s.localToWorld({ x: s.breakAt + (Math.random() - 0.5) * 30 * k, y: (Math.random() - 0.5) * s.cls.beam * 0.5 });
          this.fx.fireTick(q.x, q.y, 1 - s.sinkProgress, 0.5);
        }
      }
    }
    for (const sl of this.slicks) { sl.t += dt; sl.r = Math.min(sl.max, sl.r + dt * 4); }
    if (this.slicks.length > 80) this.slicks.shift();
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter((t) => t.t < t.life);
  }

  // ---------------------------------------------------------------- render
  render(world: World, ov: OverlayState) {
    this.viewTeam = ov.viewTeam;
    const cam = this.camera;
    this.water.render(cam.cx, cam.cy, cam.zoom * cam.dpr * this.waterScale, this.time, world.cfg.wind);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    cam.apply(ctx);
    const z = cam.zoom;
    const px = 1 / z;

    this.drawChart(ctx, world, px);
    for (const sl of this.slicks) {
      const a = 0.22 * (1 - clamp01((sl.t - 60) / 60)) * clamp01(sl.t / 3);
      if (a <= 0.005) continue;
      const g = ctx.createRadialGradient(sl.x, sl.y, 0, sl.x, sl.y, sl.r);
      g.addColorStop(0, `rgba(6,10,12,${a})`); g.addColorStop(0.7, `rgba(10,16,20,${a * 0.7})`); g.addColorStop(0.92, `rgba(70,80,70,${a * 0.35})`); g.addColorStop(1, 'rgba(6,10,12,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tl = cam.screenToWorld({ x: 0, y: 0 }), br = cam.screenToWorld({ x: cam.w, y: cam.h });
    this.view = { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
    this.drawIslands(ctx, world, px);
    this.drawWakes(ctx, world, px);
    this.drawTorpedoes(ctx, world, ov, px);
    this.fx.draw(ctx, z, 'low', this.view);
    // darkness falls hardest on the sea: ships (which the player must read) get a lighter veil
    this.drawLight(ctx, world, world.conditions === 'night' ? 0.5 : 0.18);
    if (ov.showOverlay) this.drawWorldOverlayLow(ctx, world, ov, px);
    for (const s of world.ships) if (s.status !== 'sunk' && this.seen(world, s)) this.drawShip(ctx, s, px);
    this.drawShells(ctx, world, px);
    this.drawSmoke(ctx, world, px);
    this.drawLight(ctx, world, world.conditions === 'night' ? 0.22 : 0.1);
    this.fx.draw(ctx, z, 'high', this.view);

    // screen-space overlay
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    if (ov.showOverlay || ov.player) this.drawMarkers(ctx, world, ov);
    this.drawTexts(ctx);
    if (ov.showOverlay) this.drawAim(ctx, world, ov);
  }

  /** Dusk and night: a dark tint over the sea and ships; gun flashes and fires (drawn after) stay bright. */
  private drawLight(ctx: CanvasRenderingContext2D, world: World, alpha: number) {
    if (world.conditions === 'day') return;
    const v = this.view;
    ctx.save();
    ctx.fillStyle = world.conditions === 'night' ? `rgba(2,8,22,${alpha})` : `rgba(46,24,40,${alpha})`;
    ctx.fillRect(v.x0 - 100, v.y0 - 100, v.x1 - v.x0 + 200, v.y1 - v.y0 + 200);
    if (world.conditions === 'dusk' && alpha > 0.15) {
      // low sun to the west: a faint warm sheen fading across the view
      const g = ctx.createLinearGradient(v.x0, 0, v.x1, 0);
      g.addColorStop(0, 'rgba(255,150,80,0.06)'); g.addColorStop(1, 'rgba(255,150,80,0)');
      ctx.fillStyle = g; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    }
    ctx.restore();
  }

  private drawChart(ctx: CanvasRenderingContext2D, world: World, px: number) {
    const cam = this.camera;
    const half = world.mapHalf;
    // km grid fades in as you zoom out — plotting-table feel
    const gridA = clamp01((0.5 - cam.zoom) / 0.4) * 0.07;
    if (gridA > 0.004) {
      const tl = cam.screenToWorld({ x: 0, y: 0 }), br = cam.screenToWorld({ x: cam.w, y: cam.h });
      const step = cam.zoom < 0.05 ? 5000 : 1000;
      ctx.strokeStyle = `rgba(190,225,235,${gridA})`;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = Math.ceil(Math.max(tl.x, -half) / step) * step; x <= Math.min(br.x, half); x += step) { ctx.moveTo(x, Math.max(tl.y, -half)); ctx.lineTo(x, Math.min(br.y, half)); }
      for (let y = Math.ceil(Math.max(tl.y, -half) / step) * step; y <= Math.min(br.y, half); y += step) { ctx.moveTo(Math.max(tl.x, -half), y); ctx.lineTo(Math.min(br.x, half), y); }
      ctx.stroke();
    }
    // battle area boundary
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    const big = half * 6;
    ctx.beginPath();
    ctx.rect(-big, -big, big * 2, big * 2);
    ctx.rect(half, -half, -half * 2, half * 2);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,190,90,0.35)';
    ctx.lineWidth = px * 1.5;
    ctx.setLineDash([px * 14, px * 10]);
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.setLineDash([]);
  }

  private drawIslands(ctx: CanvasRenderingContext2D, world: World, px: number) {
    if (!world.islands.length) return;
    if (this.islandsFor !== world.islands) {
      this.islandsFor = world.islands;
      this.islandPaths = world.islands.map((isl) => {
        const coast = new Path2D();
        isl.pts.forEach((q, i) => (i ? coast.lineTo(q.x, q.y) : coast.moveTo(q.x, q.y)));
        coast.closePath();
        return coast;
      });
    }
    const v = this.view;
    ctx.lineJoin = 'round';
    world.islands.forEach((isl, i) => {
      if (isl.cx + isl.r < v.x0 - 400 || isl.cx - isl.r > v.x1 + 400 || isl.cy + isl.r < v.y0 - 400 || isl.cy - isl.r > v.y1 + 400) return;
      const coast = this.islandPaths[i];
      // shoal water and surf outside the coast
      ctx.strokeStyle = 'rgba(90,170,170,0.14)'; ctx.lineWidth = 520; ctx.stroke(coast);
      ctx.strokeStyle = 'rgba(120,200,195,0.2)'; ctx.lineWidth = 180; ctx.stroke(coast);
      // land: bands that follow the coastline inward — hills, scrub, beach
      ctx.fillStyle = '#3c5637'; ctx.fill(coast);
      ctx.save(); ctx.clip(coast);
      ctx.strokeStyle = '#4f6b45'; ctx.lineWidth = 1100; ctx.stroke(coast);
      ctx.strokeStyle = '#5f7a50'; ctx.lineWidth = 420; ctx.stroke(coast);
      ctx.strokeStyle = '#cdbb90'; ctx.lineWidth = 140; ctx.stroke(coast);
      ctx.restore();
      ctx.strokeStyle = 'rgba(235,245,240,0.55)'; ctx.lineWidth = Math.max(px * 1.5, 12); ctx.stroke(coast);
    });
    ctx.lineJoin = 'miter';
  }

  private drawWakes(ctx: CanvasRenderingContext2D, world: World, px: number) {
    const now = this.time;
    for (const s of world.ships) {
      if (!this.seen(world, s)) continue;
      const w = this.wakes.get(s.id);
      if (!w || w.length < 2) continue;
      const v = this.view, m = 2500;
      if (s.pos.x < v.x0 - m || s.pos.x > v.x1 + m || s.pos.y < v.y0 - m || s.pos.y > v.y1 + m) continue;
      const k = Math.max(0.45, s.cls.beam / 33);
      const pts = [...w];
      if (s.status !== 'sunk') {
        const stern = s.localToWorld({ x: -s.cls.length / 2 + 8, y: 0 });
        const f = fromAngle(s.heading);
        pts.push({ x: stern.x, y: stern.y, t: now, v: Math.abs(s.speed), hx: f.x, hy: f.y });
      }
      // turbulent centre wash: one tapered strip, brightest at the stern
      if (pts.length > 2) {
        const L: Vec2[] = [], R: Vec2[] = [];
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const age = now - p.t;
          const wdt = (7 * k + age * 0.45) * clamp01(p.v / 6 + 0.25);
          L.push({ x: p.x - p.hy * wdt, y: p.y + p.hx * wdt });
          R.push({ x: p.x + p.hy * wdt, y: p.y - p.hx * wdt });
        }
        const a = pts[pts.length - 1], o = pts[0];
        const vk = clamp01(a.v / 10);
        const grad = ctx.createLinearGradient(a.x, a.y, o.x, o.y);
        grad.addColorStop(0, `rgba(215,232,236,${0.3 * vk})`);
        grad.addColorStop(0.15, `rgba(205,226,232,${0.1 * vk})`);
        grad.addColorStop(1, 'rgba(200,220,228,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        L.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
        ctx.closePath(); ctx.fill();
      }
      // Kelvin wake arms (~19.5°) spreading from the track, fading with age (batched in chunks)
      const CH = 6;
      for (const side of [-1, 1]) {
        for (let c0 = 0; c0 < pts.length - 1; c0 += CH) {
          const mid = pts[Math.min(pts.length - 1, c0 + (CH >> 1))];
          const age = now - mid.t;
          const a = 0.24 * clamp01(mid.v / 9) * Math.pow(clamp01(1 - age / 55), 1.6);
          if (a < 0.01) continue;
          ctx.beginPath();
          for (let i = c0; i <= Math.min(pts.length - 1, c0 + CH); i++) {
            const p = pts[i];
            const ag = now - p.t;
            const spread = 10 * k + ag * p.v * 0.354 * 0.6;
            const x = p.x - p.hy * spread * side, y = p.y + p.hx * spread * side;
            if (i === c0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(222,236,240,${a})`;
          ctx.lineWidth = Math.max(px * 1.1, (2.2 + age * 0.06) * k);
          ctx.stroke();
        }
      }
      // bow wave: foam lines peeling off the stem and running along the flanks
      if (s.alive && Math.abs(s.speed) > 2) {
        const kk = clamp01(Math.abs(s.speed) / 16);
        const step = s.cls.length / 38;
        ctx.lineCap = 'round';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i <= 14; i++) {
            const x = s.cls.length / 2 - 2 - i * step;
            const y = side * (s.cls.halfBeam(x) + 1.2 * k + i * i * 0.09 * kk * k);
            const p = s.localToWorld({ x, y });
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
          const a = s.localToWorld({ x: s.cls.length / 2, y: 0 }), b = s.localToWorld({ x: s.cls.length * 0.13, y: 0 });
          const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          g.addColorStop(0, `rgba(235,244,246,${0.75 * kk})`); g.addColorStop(1, 'rgba(235,244,246,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = Math.max(px * 1.2, (2.2 + kk * 1.5) * k);
          ctx.stroke();
        }
      }
    }
  }

  private drawTorpedoes(ctx: CanvasRenderingContext2D, world: World, ov: OverlayState, px: number) {
    for (const tp of world.torpedoes) {
      if (tp.t < 0) continue;
      const spotted = this.viewTeam == null || world.torpedoSpotted(tp, this.viewTeam);
      if (!spotted) continue;
      const f = fromAngle(tp.heading);
      const len = Math.min(tp.run, 260);
      const enemy = this.viewTeam != null && tp.team !== this.viewTeam;
      // bubble track
      const g = ctx.createLinearGradient(tp.pos.x - f.x * len, tp.pos.y - f.y * len, tp.pos.x, tp.pos.y);
      g.addColorStop(0, 'rgba(225,240,245,0)'); g.addColorStop(1, `rgba(225,240,245,${tp.def.detect < 600 ? 0.4 : 0.7})`);
      ctx.strokeStyle = g; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(px * 1.6, 3.5);
      ctx.beginPath(); ctx.moveTo(tp.pos.x - f.x * len, tp.pos.y - f.y * len); ctx.lineTo(tp.pos.x, tp.pos.y); ctx.stroke();
      ctx.fillStyle = enemy ? 'rgba(255,110,90,0.95)' : 'rgba(235,245,250,0.95)';
      ctx.beginPath(); ctx.arc(tp.pos.x, tp.pos.y, Math.max(px * 2.2, 2.4), 0, TAU); ctx.fill();
      // threat line: where an enemy torpedo is going
      if (enemy && ov.showOverlay) {
        const rem = Math.min(tp.range - tp.run, 6000);
        ctx.strokeStyle = 'rgba(255,110,90,0.45)'; ctx.lineWidth = px * 1.3;
        ctx.setLineDash([px * 8, px * 6]);
        ctx.beginPath(); ctx.moveTo(tp.pos.x, tp.pos.y); ctx.lineTo(tp.pos.x + f.x * rem, tp.pos.y + f.y * rem); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, world: World, px: number) {
    if (!world.smoke.length) return;
    const v = this.view;
    for (const p of world.smoke) {
      if (p.x + p.r < v.x0 || p.x - p.r > v.x1 || p.y + p.r < v.y0 || p.y - p.r > v.y1) continue;
      const a = 0.82 * clamp01(p.t / 3) * clamp01((p.life - p.t) / 25);
      if (a < 0.01) continue;
      const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.1, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(196,198,196,${a})`); g.addColorStop(0.6, `rgba(170,174,174,${a * 0.75})`); g.addColorStop(1, 'rgba(160,165,165,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(p.r, px * 3), 0, TAU); ctx.fill();
    }
  }

  private drawShip(ctx: CanvasRenderingContext2D, s: Ship, px: number) {
    const art = this.art(s);
    const zoom = this.camera.zoom;
    const tiny = s.cls.length * zoom < 10;
    const sinkA = s.status === 'active' ? 1 : 1 - s.sinkProgress * 0.95;
    const S = art.scale;
    const hk = s.cls.beam / 33;
    const drawPart = (clipX0: number, clipX1: number, dx: number, rot: number) => {
      ctx.save();
      ctx.translate(s.pos.x, s.pos.y);
      ctx.rotate(s.heading);
      ctx.translate(dx, 0);
      ctx.rotate(rot);
      const cl = Math.cos(s.list);
      ctx.translate(0, Math.sin(s.list) * 5 * hk);
      ctx.scale(1, cl);
      if (clipX0 > -999) { ctx.beginPath(); ctx.rect(clipX0, -60, clipX1 - clipX0, 120); ctx.clip(); }
      // shadows: offset towards bottom-right in world space
      const shadowDir = (len: number) => {
        const a = -s.heading - rot;
        return { x: (Math.cos(a) * 1 - Math.sin(a) * 1) * len * 0.7, y: (Math.sin(a) * 1 + Math.cos(a) * 1) * len * 0.7 };
      };
      ctx.globalAlpha = 0.42 * sinkA;
      const o1 = shadowDir(3.6 * hk * (1 - s.sinkProgress));
      ctx.drawImage(art.hullShadow, -art.originX / S + o1.x, -art.originY / S + o1.y, art.hull.width / S, art.hull.height / S);
      ctx.globalAlpha = 0.3 * sinkA;
      const o2 = shadowDir(11 * hk * (1 - s.sinkProgress));
      ctx.drawImage(art.upperShadow, -art.originX / S + o2.x, -art.originY / S + o2.y, art.hull.width / S, art.hull.height / S);
      ctx.globalAlpha = sinkA;
      ctx.drawImage(art.hull, -art.originX / S, -art.originY / S, art.hull.width / S, art.hull.height / S);
      // scorch decals
      const dec = this.decals.get(s.id);
      if (dec) for (const d of dec) {
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        g.addColorStop(0, `rgba(12,10,8,${d.a})`); g.addColorStop(0.6, `rgba(25,20,16,${d.a * 0.5})`); g.addColorStop(1, 'rgba(25,20,16,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
      }
      // torpedo tubes
      for (const m of s.torpedoMounts) {
        const ok = s.torpedoMountOk(m);
        ctx.save(); ctx.translate(m.def.x, m.def.y); ctx.rotate(m.train);
        const tl = Math.min(9, s.cls.beam * 0.42), n = m.def.tubes, gap = 0.7;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-tl / 2 + 0.4, -n * gap / 2 + 0.4, tl, n * gap);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = !ok ? '#3a2a26' : m.loaded ? '#7c868b' : '#4c5458';
          ctx.fillRect(-tl / 2, -n * gap / 2 + i * gap + 0.08, tl, gap - 0.16);
        }
        ctx.fillStyle = '#596166'; ctx.beginPath(); ctx.arc(0, 0, 1.0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // secondary mounts
      s.secondaries.forEach((m, i) => {
        const sp = art.secondaries[i];
        if (!sp) return;
        const dead = s.mod(m.def.module).level === 3;
        const ang = m.def.facing + m.offset;
        const tr = sp.origin / S;
        ctx.save(); ctx.translate(m.def.x, m.def.y); ctx.rotate(ang);
        ctx.globalAlpha = 0.3 * sinkA;
        ctx.drawImage(sp.shadow, -tr + 0.9, -tr + 0.9, tr * 2, tr * 2);
        ctx.globalAlpha = sinkA;
        ctx.save(); ctx.translate(-m.recoil * 0.6, 0); ctx.drawImage(sp.barrels, -tr, -tr, tr * 2, tr * 2); ctx.restore();
        ctx.drawImage(sp.house, -tr, -tr, tr * 2, tr * 2);
        if (dead) { ctx.fillStyle = 'rgba(15,12,10,0.6)'; ctx.beginPath(); ctx.arc(0, 0, m.def.radius, 0, TAU); ctx.fill(); }
        ctx.restore();
      });
      // turrets
      s.turrets.forEach((t, i) => {
        const sp = art.turrets[i];
        const dead = s.mod(t.def.id).level === 3;
        const ang = t.def.facing + t.offset;
        const rk = t.def.radius / 7.2;
        const recoil = t.recoil * t.recoil * 1.6 * Math.max(0.35, rk);
        ctx.save();
        ctx.translate(t.def.x, t.def.y);
        ctx.rotate(ang);
        const tr = sp.origin / S;
        ctx.globalAlpha = 0.35 * sinkA;
        const so = shadowDir(t.def.height * 0.25);
        const ca = Math.cos(-ang), sa = Math.sin(-ang);
        ctx.drawImage(sp.shadow, -tr + so.x * ca - so.y * sa, -tr + so.x * sa + so.y * ca, tr * 2, tr * 2);
        ctx.globalAlpha = sinkA;
        // guns: recoil back into the gunhouse; elevation foreshortens them seen from above
        const elevDeg = 1.5 + 33 * Math.pow(clamp01(t.elevation), 1.3);
        const fore = Math.cos(elevDeg * DEG);
        ctx.save();
        ctx.translate(sp.pivot - recoil, 0);
        ctx.scale(fore, 1);
        ctx.drawImage(sp.barrels, -tr - sp.pivot, -tr, tr * 2, tr * 2);
        ctx.restore();
        ctx.drawImage(sp.house, -tr, -tr, tr * 2, tr * 2);
        if (dead) {
          ctx.fillStyle = 'rgba(15,12,10,0.6)';
          ctx.beginPath(); ctx.arc(0, 0, t.def.radius * 1.04, 0, TAU); ctx.fill();
        }
        ctx.restore();
      });
      // awash: water over the deck where the ship has settled
      const awash = (x: number) => clamp01((s.waterRise(x) - (s.cls.freeboard(x) - 1.6)) / 3 + (s.status !== 'active' ? s.sinkProgress * 1.6 - 0.15 : 0));
      let any = false;
      const g = ctx.createLinearGradient(-s.cls.length / 2, 0, s.cls.length / 2, 0);
      for (let i = 0; i <= 10; i++) {
        const x = -s.cls.length / 2 + (s.cls.length * i) / 10;
        const a = awash(x);
        if (a > 0.01) any = true;
        g.addColorStop(i / 10, `rgba(12,52,64,${a * 0.9})`);
      }
      if (any) {
        ctx.fillStyle = g;
        ctx.beginPath();
        s.cls.hull.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
    if (s.status === 'exploded') {
      const k = s.sinkProgress, lk = s.cls.length / 270;
      drawPart(s.breakAt, 400, k * 30 * lk, k * 0.25);
      drawPart(-400, s.breakAt - 4 * lk, -k * 25 * lk, -k * 0.18);
    } else drawPart(-1000, 0, 0, 0);
    ctx.globalAlpha = 1;
    if (tiny) {
      // keep a crisp silhouette when zoomed far out
      ctx.save(); ctx.translate(s.pos.x, s.pos.y); ctx.rotate(s.heading);
      ctx.fillStyle = s.team === 'blue' ? TEAM_COLOR.blue : TEAM_COLOR.red;
      ctx.globalAlpha = s.alive ? 0.9 : 0.4;
      const sz = s.cls.type === 'DD' ? 6 : s.cls.type === 'CA' ? 7.5 : 9;
      const l = Math.max(s.cls.length, sz * px), w = Math.max(s.cls.beam, sz * 0.33 * px);
      ctx.beginPath(); ctx.moveTo(l / 2, 0); ctx.lineTo(-l / 2, -w / 2); ctx.lineTo(-l / 2, w / 2); ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  private drawShells(ctx: CanvasRenderingContext2D, world: World, px: number) {
    for (const sh of world.shells) {
      if (sh.t < 0) continue;
      const u = clamp01(sh.t / sh.T);
      const x = lerp(sh.origin.x, sh.target.x, u), y = lerp(sh.origin.y, sh.target.y, u);
      const h = 4 * sh.apex * u * (1 - u);
      const dx = sh.target.x - sh.origin.x, dy = sh.target.y - sh.origin.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const ck = Math.max(0.45, Math.sqrt(sh.shell.caliber / 406));
      // shadow on the water
      const so = Math.min(h * 0.12, 80);
      ctx.globalAlpha = 0.25 * clamp01(1 - h / 3000);
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x + so, y + so, Math.max(1.2, 1.5 * px * ck), 0, TAU); ctx.fill();
      // tracer streak (length grows with height: closer to the eye, faster in screen)
      const trail = clamp(L / sh.T * 0.09, 25, 140) * ck;
      const s = (1 + Math.min(h / 4000, 1.2)) * ck;
      ctx.globalCompositeOperation = 'lighter';
      const col = sh.shell.id === 'HC' ? '255,226,120' : '255,170,90';
      const g = ctx.createLinearGradient(x - ux * trail, y - uy * trail, x, y);
      g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.9)`);
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.4 * px * ck, 1.4 * s);
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(x - ux * trail, y - uy * trail); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = `rgba(255,245,220,1)`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.6 * px * ck, 1.3 * s), 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = `rgba(${col},1)`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(4 * px * ck, 4 * s), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // --------------------------------------------------------------- overlays (world space)
  private drawWorldOverlayLow(ctx: CanvasRenderingContext2D, world: World, ov: OverlayState, px: number) {
    const p = ov.player;
    if (!p || !p.alive || p.outOfAction) return;
    // max gun range ring
    const near = ov.aimWorld ? dist(p.pos, ov.aimWorld) / p.cls.maxRange : 0;
    const ringA = clamp01(0.12 + (near - 0.75) * 1.2) * 0.9 + clamp01((0.25 - this.camera.zoom) * 2) * 0.25;
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.55, ringA)})`;
    ctx.lineWidth = px * 1.2;
    ctx.setLineDash([px * 6, px * 8]);
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.cls.maxRange, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // torpedo range ring in torpedo mode
    if (ov.weapon === 'torpedo' && p.cls.torpedoes) {
      ctx.strokeStyle = 'rgba(140,220,255,0.45)';
      ctx.setLineDash([px * 3, px * 7]);
      ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.cls.torpedoes.def.range, 0, TAU); ctx.stroke();
      const sl = p.cls.torpedoes.def.slow;
      if (sl) { ctx.strokeStyle = 'rgba(140,220,255,0.22)'; ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, sl.range, 0, TAU); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    // enemy gun range rings when zoomed out: where you are in danger
    const far = clamp01((0.12 - this.camera.zoom) / 0.08);
    if (far > 0) {
      for (const e of world.ships) {
        if (e.team === p.team || !e.alive || e.outOfAction || !this.seen(world, e)) continue;
        ctx.strokeStyle = `rgba(255,106,85,${0.22 * far})`;
        ctx.lineWidth = px * 1.2;
        ctx.setLineDash([px * 3, px * 9]);
        ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, e.cls.maxRange, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // heading line & predicted track
    const f = fromAngle(p.heading);
    const bow = p.localToWorld({ x: p.cls.length / 2, y: 0 });
    const headLen = Math.max(700, 140 * px);
    const hg = ctx.createLinearGradient(bow.x, bow.y, bow.x + f.x * headLen, bow.y + f.y * headLen);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = hg; ctx.lineWidth = px * 1.3;
    ctx.beginPath(); ctx.moveTo(bow.x, bow.y); ctx.lineTo(bow.x + f.x * headLen, bow.y + f.y * headLen); ctx.stroke();

    const steering = ov.rudderHeld !== 0 || Math.abs(p.rudder) > 0.5 * DEG;
    if (steering && Math.abs(p.speed) > 0.5) {
      const path = p.predictPath(55, 0.5, ov.rudderHeld !== 0 ? ov.rudderHeld : undefined);
      // offset path to start at the bow
      const off = { x: bow.x - p.pos.x, y: bow.y - p.pos.y };
      const col = TEAM_RGB[p.team];
      ctx.lineWidth = px * 2.4;
      ctx.lineCap = 'round';
      for (let i = 1; i < path.length; i++) {
        const k = i / path.length;
        ctx.strokeStyle = `rgba(${col},${0.75 * (1 - k)})`;
        ctx.beginPath();
        ctx.moveTo(path[i - 1].x + off.x, path[i - 1].y + off.y);
        ctx.lineTo(path[i].x + off.x, path[i].y + off.y);
        ctx.stroke();
      }
      // chevrons flowing along the curve
      const phase = (this.time * 1.2) % 1;
      for (let j = 0; j < 6; j++) {
        const idx = Math.floor(((j + phase) / 6) * (path.length - 2)) + 1;
        if (idx >= path.length - 1) continue;
        const a = path[idx], b = path[idx + 1];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const k = idx / path.length;
        const sz = px * 8;
        ctx.save();
        ctx.translate(a.x + off.x, a.y + off.y);
        ctx.rotate(ang);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`;
        ctx.lineWidth = px * 1.8;
        ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.7); ctx.lineTo(0, 0); ctx.lineTo(-sz * 0.6, sz * 0.7); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // --------------------------------------------------------------- markers (screen space)
  private drawMarkers(ctx: CanvasRenderingContext2D, world: World, ov: OverlayState) {
    const cam = this.camera;
    for (const s of world.ships) {
      if (s.status === 'sunk' || !this.seen(world, s)) continue;
      const sp = cam.worldToScreen(s.pos);
      if (sp.x < -100 || sp.y < -100 || sp.x > cam.w + 100 || sp.y > cam.h + 100) continue;
      const mine = ov.player?.id === s.id;
      const col = TEAM_COLOR[s.team];
      const lenPx = s.cls.length * cam.zoom;
      const r = Math.max(16, lenPx * 0.5 + 6);
      ctx.globalAlpha = s.alive ? 1 : 0.5;
      if (!mine) {
        // corner brackets around enemies & allies
        const b = Math.min(r, 120), c = 7;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const x = sp.x + sx * b, y = sp.y + sy * Math.min(b, 40);
          ctx.moveTo(x - sx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * c);
        }
        ctx.stroke();
      }
      // label
      const ly = sp.y - Math.min(r, 40) - 12;
      ctx.font = '600 12px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const name = (mine ? s.cls.prefix + ' ' : '') + s.name.toUpperCase() + (mine ? '' : ` · ${s.cls.type}`);
      ctx.fillText(name, sp.x + 1, ly + 1);
      ctx.fillStyle = mine ? 'rgba(255,255,255,0.85)' : col;
      ctx.fillText(name, sp.x, ly);
      if (!mine && ov.player) {
        const d = dist(ov.player.pos, s.pos) / 1000;
        ctx.font = '500 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(230,240,245,0.75)';
        ctx.fillText(s.alive ? `${d.toFixed(1)} km` : s.outReason.toUpperCase(), sp.x, ly + 13);
      } else if (!s.alive) {
        ctx.font = '500 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(255,190,120,0.9)';
        ctx.fillText(s.outReason.toUpperCase(), sp.x, ly + 13);
      }
      if (mine && s.alive) {
        // incoming enemy salvo: time until the nearest one lands around us
        let tIn = Infinity;
        for (const sh of world.shells) if (sh.team !== s.team && !sh.secondary && dist(sh.target, s.pos) < 450) tIn = Math.min(tIn, sh.T - sh.t);
        const tags: string[] = [];
        if (tIn < Infinity && tIn > 0) tags.push(`INCOMING ${tIn.toFixed(1)}s`);
        if (s.smoking) tags.push('MAKING SMOKE');
        if (s.counterflooding) tags.push('COUNTER-FLOODING');
        if (tags.length) {
          const pulse = 0.65 + 0.35 * Math.sin(this.time * 9);
          ctx.font = '600 11px "IBM Plex Mono", monospace';
          tags.forEach((t, i) => { ctx.fillStyle = t.startsWith('INCOMING') ? `rgba(255,150,90,${pulse})` : 'rgba(200,225,235,0.85)'; ctx.fillText(t, sp.x, sp.y + Math.min(r, 40) + 20 + i * 13); });
        }
      }
      // camera lock indicator
      if (ov.lockId === s.id) {
        const a = this.time * 0.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
        const rr = Math.min(r, 120) + 12;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(sp.x, sp.y, rr, a + i * TAU / 4, a + i * TAU / 4 + 0.5); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    // last known positions of enemies out of sight
    if (this.viewTeam) {
      for (const [id, c] of world.contacts[this.viewTeam]) {
        const s = world.shipById(id);
        if (!s || s.status === 'sunk' || this.seen(world, s) || s.outOfAction) continue;
        const age = world.time - c.t;
        if (age > 240) continue;
        const sp = cam.worldToScreen(c.pos);
        if (sp.x < -50 || sp.y < -50 || sp.x > cam.w + 50 || sp.y > cam.h + 50) continue;
        ctx.globalAlpha = clamp01(1 - age / 240) * 0.8;
        ctx.strokeStyle = TEAM_COLOR[s.team]; ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 12, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 11px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = TEAM_COLOR[s.team];
        ctx.fillText(`${s.name.toUpperCase()} · LOST ${Math.floor(age)}s`, sp.x, sp.y - 18);
        ctx.globalAlpha = 1;
      }
    }
    // off-screen enemy pointers
    if (ov.player) for (const s of world.ships) {
      if (s.team === ov.player.team || !s.alive || !this.seen(world, s)) continue;
      const ep = edgePointer(cam, cam.worldToScreen(s.pos));
      if (!ep) continue;
      const { x, y, ang } = ep;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = TEAM_COLOR[s.team];
      const k = s.cls.type === 'DD' ? 0.75 : 1;
      ctx.beginPath(); ctx.moveTo(10 * k, 0); ctx.lineTo(-6 * k, -7 * k); ctx.lineTo(-3 * k, 0); ctx.lineTo(-6 * k, 7 * k); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(`${(dist(ov.player.pos, s.pos) / 1000).toFixed(1)} km`, x - Math.cos(ang) * 22, y - Math.sin(ang) * 22 + 4);
    }
  }

  private drawTexts(ctx: CanvasRenderingContext2D) {
    const cam = this.camera;
    // greedy de-clutter: newer labels stack above older ones they would overlap
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      const sp = cam.worldToScreen({ x: t.x, y: t.y });
      const k = t.t / t.life;
      const a = k < 0.08 ? k / 0.08 : 1 - clamp01((k - 0.6) / 0.4);
      let y = sp.y - 22 - Math.min(t.t, 1.2) * 12;
      const w = t.sub ? 168 : 100;
      const up = t.big ? 16 : 13, down = t.sub ? 17 : 4;
      for (let guard = 0; guard < 10; guard++) {
        const hit = placed.find((b) => sp.x + w / 2 > b.x0 && sp.x - w / 2 < b.x1 && y + down > b.y0 && y - up < b.y1);
        if (!hit) break;
        y = hit.y0 - down - 3;
      }
      placed.push({ x0: sp.x - w / 2, x1: sp.x + w / 2, y0: y - up, y1: y + down });
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = `700 ${t.big ? 17 : 13}px "Barlow Condensed", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(t.text, sp.x + 1, y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sp.x, y);
      if (t.sub) {
        ctx.font = '500 10.5px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(t.sub, sp.x + 1, y + 14);
        ctx.fillStyle = 'rgba(235,240,242,0.9)'; ctx.fillText(t.sub, sp.x, y + 13);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAim(ctx: CanvasRenderingContext2D, world: World, ov: OverlayState) {
    const p = ov.player;
    const m = ov.mouse;
    if (!p || !p.alive || !ov.aimWorld) {
      // plain cursor
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, TAU); ctx.stroke();
      return;
    }
    if (ov.weapon === 'torpedo' && p.cls.torpedoes) { this.drawTorpedoAim(ctx, world, ov, p); return; }
    const cam = this.camera;
    const aim = ov.aimWorld;
    const rawRange = dist(p.pos, aim);
    const outOfRange = rawRange > p.cls.maxRange;
    const range = Math.min(rawRange, p.cls.maxRange);
    const brg = Math.atan2(aim.y - p.pos.y, aim.x - p.pos.x);
    const eff = outOfRange ? { x: p.pos.x + Math.cos(brg) * range, y: p.pos.y + Math.sin(brg) * range } : aim;
    const es = cam.worldToScreen(eff);
    const zoom = cam.zoom;
    const shell = p.cls.shells[p.cmd.ammo];

    // ---------- dispersion ellipses at the effective fall-of-shot point
    const disp = p.dispersionAt(range);
    const quality = clamp01((p.dispersionMult() - 0.65) / 1.1);
    const tint = quality < 0.25 ? '160,230,255' : quality < 0.6 ? '255,220,140' : '255,150,110';
    ctx.save();
    ctx.translate(es.x, es.y);
    ctx.rotate(brg);
    const r90 = { a: disp.range * R90 * zoom, b: disp.lateral * R90 * zoom };
    const r50 = { a: disp.range * R50 * zoom, b: disp.lateral * R50 * zoom };
    // 50%: filled soft core
    ctx.fillStyle = `rgba(${tint},0.10)`;
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(r50.a, 3), Math.max(r50.b, 2), 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${tint},0.55)`; ctx.lineWidth = 1.2;
    ctx.stroke();
    // 90%: dashed, breathing slightly
    const breathe = 1 + Math.sin(this.time * 2.4) * 0.008;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -this.time * 8;
    ctx.strokeStyle = `rgba(${tint},0.38)`;
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(r90.a * breathe, 5), Math.max(r90.b * breathe, 3), 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // range-axis ticks
    ctx.strokeStyle = `rgba(${tint},0.5)`;
    ctx.beginPath();
    ctx.moveTo(-r90.a - 6, 0); ctx.lineTo(-r90.a + 2, 0);
    ctx.moveTo(r90.a - 2, 0); ctx.lineTo(r90.a + 6, 0);
    ctx.stroke();
    ctx.restore();

    // ---------- where the guns currently lie (per turret)
    for (const t of p.turrets) {
      const dead = p.gunsFor(t) === 0;
      if (dead || !t.inArc) continue;
      const tp = p.turretWorld(t);
      const b = p.turretBearing(t);
      const lay = { x: tp.x + Math.cos(b) * range, y: tp.y + Math.sin(b) * range };
      const ls = cam.worldToScreen(lay);
      const ok = t.aligned;
      const col = !t.inArc ? '255,110,90' : ok ? '235,245,250' : '255,200,110';
      // arc from current lay to the desired bearing along the aim range circle
      if (!ok && t.inArc && range * zoom < 1400) {
        const ps = cam.worldToScreen(tp);
        const a0 = b, a1 = brg;
        const rr = range * zoom;
        let d = a1 - a0; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        // follow the actual traverse direction (turret can't pass through its blind arc)
        const dirSign = Math.sign(t.desired - t.offset) || 1;
        if (Math.sign(d) !== dirSign) d = d - dirSign * TAU * Math.sign(d) * -1;
        ctx.strokeStyle = `rgba(${col},0.35)`; ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(ps.x, ps.y, rr, a0, a0 + d, d < 0); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.save(); ctx.translate(ls.x, ls.y); ctx.rotate(b);
      ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -5); ctx.lineTo(7, 0); ctx.lineTo(0, 5); ctx.closePath();
      ctx.stroke();
      if (t.loaded && ok) { ctx.fillStyle = `rgba(${col},0.9)`; ctx.fill(); }
      ctx.restore();
    }

    // ---------- the requested aim point: custom reticle at the cursor, or at the fixed aim point
    let cx = m.x, cy = m.y;
    if (ov.aimFixed) {
      const as = cam.worldToScreen(aim);
      cx = as.x; cy = as.y;
      // the cursor itself is free: a plain ring, tied to the aim point by a faint line
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, TAU); ctx.stroke();
    }
    const col = outOfRange ? '255,170,90' : '255,255,255';
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(cx + dx * 15, cy + dy * 15); ctx.lineTo(cx + dx * 23, cy + dy * 23); }
    ctx.stroke();
    ctx.fillStyle = `rgba(${col},1)`;
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, TAU); ctx.fill();
    // turret readiness ring segments around the reticle
    const n = p.turrets.length;
    const gap = n > 3 ? 0.08 : 0.12;
    for (let i = 0; i < n; i++) {
      const t = p.turrets[i];
      const a0 = -Math.PI / 2 + (i * TAU) / n + gap, a1 = -Math.PI / 2 + ((i + 1) * TAU) / n - gap;
      const guns = p.gunsFor(t);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, 30, a0, a1); ctx.stroke();
      if (guns === 0 || !p.turretOperable(t)) {
        ctx.strokeStyle = 'rgba(255,90,70,0.6)';
        ctx.beginPath(); ctx.arc(cx, cy, 30, a0, a1); ctx.stroke();
        continue;
      }
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / p.cls.reloadTime);
      const ready = t.loaded && t.aligned;
      ctx.strokeStyle = ready ? 'rgba(140,235,170,0.95)' : t.loaded ? 'rgba(255,205,120,0.9)' : 'rgba(220,230,235,0.55)';
      ctx.beginPath(); ctx.arc(cx, cy, 30, a0, a0 + (a1 - a0) * prog); ctx.stroke();
    }
    // range/time read-out
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    const tof = flightTime(range, shell);
    const label = outOfRange ? `MAX ${(p.cls.maxRange / 1000).toFixed(1)} km` : `${(range / 1000).toFixed(2)} km`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(label, cx + 38, cy - 3);
    ctx.fillStyle = `rgba(${col},0.95)`; ctx.fillText(label, cx + 37, cy - 4);
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(210,225,230,0.8)'; ctx.fillText(`${tof.toFixed(1)} s`, cx + 37, cy + 10);
    // countdown to the fall of our most recent salvo
    let next = Infinity;
    for (const sh of world.shells) if (sh.shooter === p.id && !sh.secondary) next = Math.min(next, sh.T - sh.t);
    if (next < Infinity) {
      ctx.fillStyle = 'rgba(255,214,140,0.95)';
      ctx.fillText(`SPLASH ${next.toFixed(1)}`, cx + 37, cy + 24);
    }
    ctx.font = '600 9.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = ov.aimFixed ? 'rgba(150,225,255,0.9)' : 'rgba(210,225,230,0.45)';
    ctx.fillText(ov.aimFixed ? 'AIM FIXED · SPACE: FOLLOW' : 'RMB: FIX AIM', cx + 37, cy - 18);

    // ---------- fire-control lead: where to aim at each enemy so shell and ship arrive together
    if (p.directorsOk() > 0) {
      for (const s of world.ships) {
        if (s.team === p.team || !s.alive || s.outOfAction || !this.seen(world, s)) continue;
        const lp = leadPoint(p.pos, s, shell);
        if (dist(p.pos, lp) > p.cls.maxRange * 1.15) continue;
        const ls = cam.worldToScreen(lp), ss = cam.worldToScreen(s.pos);
        const onIt = dist(aim, lp) < Math.max(s.cls.length * 0.5, 14 / zoom);
        const c = onIt ? '140,235,170' : '255,120,95';
        ctx.strokeStyle = `rgba(${c},0.35)`; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(ss.x, ss.y); ctx.lineTo(ls.x, ls.y); ctx.stroke(); ctx.setLineDash([]);
        // a small diamond pip with a centre dot
        const r = 6;
        ctx.strokeStyle = `rgba(${c},0.95)`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(ls.x, ls.y - r); ctx.lineTo(ls.x + r, ls.y); ctx.lineTo(ls.x, ls.y + r); ctx.lineTo(ls.x - r, ls.y); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = `rgba(${c},1)`;
        ctx.beginPath(); ctx.arc(ls.x, ls.y, 1.3, 0, TAU); ctx.fill();
      }
    }

    // ---------- lead indicator: where a target near the cursor will be when shells land
    for (const s of world.ships) {
      if (s.team === p.team || !s.alive || s.outOfAction || !this.seen(world, s)) continue;
      const d = dist(s.pos, aim);
      if (d > Math.max(2500, 200 / zoom)) continue;
      this.drawGhost(ctx, s, leadPoint(p.pos, s, shell), clamp01(1.3 - d / Math.max(2500, 200 / zoom)), TEAM_COLOR.red);
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, s: Ship, ghost: Vec2, alpha: number, color: string) {
    const cam = this.camera, zoom = cam.zoom;
    const gs = cam.worldToScreen(ghost), ss = cam.worldToScreen(s.pos);
    ctx.save();
    ctx.globalAlpha = 0.42 * alpha;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ss.x, ss.y); ctx.lineTo(gs.x, gs.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(gs.x, gs.y); ctx.rotate(s.heading);
    const L = s.cls.length * zoom, W = s.cls.beam * zoom;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (L > 14) { ctx.moveTo(L / 2, 0); ctx.lineTo(L * 0.2, -W / 2); ctx.lineTo(-L / 2, -W * 0.4); ctx.lineTo(-L / 2, W * 0.4); ctx.lineTo(L * 0.2, W / 2); ctx.closePath(); }
    else ctx.arc(0, 0, 5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Torpedo mode: the fan each bearing mount would fire, its reach, and where a target near the cursor would be when they arrive. */
  private drawTorpedoAim(ctx: CanvasRenderingContext2D, world: World, ov: OverlayState, p: Ship) {
    const cam = this.camera;
    const td = p.cls.torpedoes!.def;
    const aim = ov.aimWorld!;
    const m = ov.mouse;
    let any = false;
    // the setting a launch at this point would use (same rule as the simulation)
    const slow = !!td.slow && dist(p.pos, aim) > td.range * 0.95;
    const speed = slow ? td.slow!.speed : td.speed, maxRange = slow ? td.slow!.range : td.range;
    for (const mt of p.torpedoMounts) {
      const mp = p.turretWorld(mt);
      const brg = Math.atan2(aim.y - mp.y, aim.x - mp.x);
      const bears = p.torpedoBearing(mt, brg) != null;
      const ready = mt.loaded && p.torpedoMountOk(mt);
      if (!bears) continue;
      any = any || ready;
      const n = mt.def.tubes, spread = 2.2 * DEG;
      const reach = Math.min(maxRange, dist(mp, aim) + 3000);
      const ms = cam.worldToScreen(mp);
      ctx.strokeStyle = ready ? 'rgba(150,225,255,0.65)' : 'rgba(150,170,180,0.3)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < n; i++) {
        const h = brg + (i - (n - 1) / 2) * spread;
        const e = cam.worldToScreen({ x: mp.x + Math.cos(h) * reach, y: mp.y + Math.sin(h) * reach });
        ctx.beginPath(); ctx.moveTo(ms.x, ms.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      }
    }
    // reticle
    ctx.strokeStyle = any ? 'rgba(150,225,255,0.95)' : 'rgba(255,150,110,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(m.x - 12, m.y); ctx.lineTo(m.x + 12, m.y); ctx.moveTo(m.x, m.y - 12); ctx.lineTo(m.x, m.y + 12); ctx.stroke();
    ctx.beginPath(); ctx.arc(m.x, m.y, 16, 0, TAU); ctx.stroke();
    const r = dist(p.pos, aim);
    const run = r / speed;
    ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    const caps = p.torpedoCapacity();
    const txt = r > maxRange ? `OUT OF REACH ${(maxRange / 1000).toFixed(1)} km` : `${(r / 1000).toFixed(2)} km · ${run.toFixed(0)} s run${slow ? ' · SLOW SETTING' : ''}`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(txt, m.x + 25, m.y - 3);
    ctx.fillStyle = r > maxRange ? 'rgba(255,170,90,0.95)' : 'rgba(170,230,255,0.95)'; ctx.fillText(txt, m.x + 24, m.y - 4);
    ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(210,225,230,0.85)';
    ctx.fillText(any ? `${caps.ready} TUBES READY · LMB LAUNCH` : caps.ready ? 'TUBES DO NOT BEAR' : 'TUBES EMPTY', m.x + 24, m.y + 11);
    // lead: where a target near the cursor will be after the torpedo run
    for (const s of world.ships) {
      if (s.team === p.team || !s.alive || s.outOfAction || !this.seen(world, s)) continue;
      const d = dist(s.pos, aim);
      if (d > 3500) continue;
      const t = dist(p.pos, s.pos) / speed;
      const v = fromAngle(s.heading, s.speed);
      this.drawGhost(ctx, s, { x: s.pos.x + v.x * t, y: s.pos.y + v.y * t }, clamp01(1.3 - d / 3500), '#96e1ff');
    }
  }
}
