// Particle effects in world space. Kept data-oriented (flat objects in a pool)
// to stay cheap with thousands of particles.

import { Vec2, TAU, clamp01 } from '../core/math';

export type PKind = 'smoke' | 'fire' | 'flash' | 'spark' | 'splash' | 'ring' | 'debris' | 'foam' | 'mist' | 'ember' | 'blast' | 'steam';

export interface Particle {
  k: PKind;
  x: number; y: number;
  vx: number; vy: number;
  z: number; vz: number;     // pseudo height for arcs (splash drops, debris)
  r: number; gr: number;     // radius & growth (m, m/s)
  life: number; age: number;
  a: number;                 // base alpha
  c: string;                 // colour (css rgb triple "r,g,b")
  rot: number;
  drag: number;
}

const MAX = 3500;

let foamCv: HTMLCanvasElement | null = null;
/** Speckled foam patch: lacy white bubbles fading towards the rim. */
function foamSprite(): HTMLCanvasElement {
  if (foamCv) return foamCv;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * TAU, rr = Math.pow(Math.random(), 0.7) * 60;
    const x = 64 + Math.cos(a) * rr, y = 64 + Math.sin(a) * rr;
    const fall = 1 - rr / 62;
    g.fillStyle = `rgba(235,244,246,${0.08 + fall * 0.35 * Math.random()})`;
    g.beginPath(); g.arc(x, y, 0.8 + Math.random() * 3.2 * fall, 0, TAU); g.fill();
  }
  foamCv = cv;
  return cv;
}

// Cached soft radial sprites (much cheaper than per-particle gradients).
const spriteCache = new Map<string, HTMLCanvasElement>();
function soft(c: string, hot: boolean): HTMLCanvasElement {
  const key = c + (hot ? 'h' : 's');
  let cv = spriteCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hot) { gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.25, `rgba(${c},0.9)`); gr.addColorStop(1, `rgba(${c},0)`); }
  else { gr.addColorStop(0, `rgba(${c},1)`); gr.addColorStop(0.55, `rgba(${c},0.6)`); gr.addColorStop(1, `rgba(${c},0)`); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  spriteCache.set(key, cv);
  return cv;
}

export class Effects {
  ps: Particle[] = [];
  wind: Vec2 = { x: 2, y: 0.6 };

  add(p: Partial<Particle> & { k: PKind; x: number; y: number }) {
    if (this.ps.length >= MAX) this.ps.splice(0, 200);
    this.ps.push({ vx: 0, vy: 0, z: 0, vz: 0, r: 5, gr: 0, life: 1, age: 0, a: 1, c: '255,255,255', rot: Math.random() * TAU, drag: 0.4, ...p });
  }

  update(dt: number) {
    const w = this.wind;
    const ps = this.ps;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const windK = p.k === 'smoke' || p.k === 'steam' || p.k === 'mist' ? 1 : p.k === 'fire' || p.k === 'ember' ? 0.4 : 0;
      p.vx += (w.x * windK - p.vx) * Math.min(1, p.drag * dt);
      p.vy += (w.y * windK - p.vy) * Math.min(1, p.drag * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'debris' || p.k === 'splash' || p.k === 'ember') {
        p.vz -= 9.81 * dt * (p.k === 'splash' ? 1.4 : 1); p.z += p.vz * dt;
        if (p.z < 0 && p.k !== 'splash') { p.z = 0; p.vz = 0; p.vx *= 0.3; p.vy *= 0.3; if (p.k === 'ember') p.age = p.life; }
      }
      p.r += p.gr * dt;
      ps[j++] = p;
    }
    ps.length = j;
  }

  // ------------------------------------------------------------- emitters
  muzzle(x: number, y: number, ang: number, guns: number) {
    const fx = Math.cos(ang), fy = Math.sin(ang);
    for (let g = 0; g < guns; g++) {
      const off = (g - (guns - 1) / 2) * 2.6;
      const mx = x + fx * 27 - fy * off, my = y + fy * 27 + fx * off;
      this.add({ k: 'flash', x: mx + fx * 10, y: my + fy * 10, r: 22, gr: 40, life: 0.18, a: 1, c: '255,214,140' });
      this.add({ k: 'flash', x: mx + fx * 32, y: my + fy * 32, r: 14, gr: 60, life: 0.12, a: 0.9, c: '255,245,215' });
      for (let i = 0; i < 9; i++) {
        const sp = 20 + Math.random() * 90, a2 = ang + (Math.random() - 0.5) * 0.7;
        this.add({ k: 'smoke', x: mx + fx * 8, y: my + fy * 8, vx: Math.cos(a2) * sp, vy: Math.sin(a2) * sp, r: 7 + Math.random() * 6, gr: 6, life: 5 + Math.random() * 5, a: 0.3, c: '178,170,158', drag: 0.9 });
      }
      for (let i = 0; i < 6; i++) {
        const sp = 40 + Math.random() * 140, a2 = ang + (Math.random() - 0.5) * 0.4;
        this.add({ k: 'ember', x: mx, y: my, vx: Math.cos(a2) * sp, vy: Math.sin(a2) * sp, z: 8, vz: 8 + Math.random() * 10, r: 0.8, life: 1.2, a: 1, c: '255,190,90', drag: 0.4 });
      }
    }
    // blast overpressure flattens the sea around the turret
    this.add({ k: 'ring', x: x + fx * 30, y: y + fy * 30, r: 10, gr: 120, life: 0.55, a: 0.5, c: '230,238,240' });
    this.add({ k: 'mist', x: x + fx * 26, y: y + fy * 26, r: 30, gr: 30, life: 1.4, a: 0.25, c: '220,225,225' });
  }

  splash(x: number, y: number, big: number, dye: string | null) {
    const s = big;
    const col = dye ?? '240,246,248';
    // central column (seen from above: a bright plume that collapses)
    this.add({ k: 'splash', x, y, r: 7 * s, gr: 9 * s, life: 2.2, a: 1, c: col, z: 0, vz: 0 });
    this.add({ k: 'splash', x, y, r: 4 * s, gr: 4 * s, life: 3.2, a: 0.9, c: '255,255,255', z: 0, vz: 0 });
    // base surge ring and lingering foam
    this.add({ k: 'ring', x, y, r: 6 * s, gr: 26 * s, life: 1.6, a: 0.4, c: '235,245,248' });
    this.add({ k: 'foam', x, y, r: 16 * s, gr: 3 * s, life: 18, a: 0.75, c: '225,238,240' });
    // spray thrown outward
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU, sp = (8 + Math.random() * 22) * s;
      this.add({ k: 'splash', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: 0, vz: 18 + Math.random() * 30, r: (1.2 + Math.random() * 2.2) * s, gr: 1.2, life: 1.4 + Math.random() * 1.4, a: 0.85, c: col, drag: 0.25 });
    }
    this.add({ k: 'mist', x, y, r: 14 * s, gr: 9 * s, life: 4.5, a: 0.28, c: col });
  }

  explosion(x: number, y: number, scale: number, kind: 'pen' | 'citadel' | 'he' | 'nonpen' | 'ricochet' | 'magazine') {
    const s = scale;
    if (kind === 'nonpen' || kind === 'ricochet') {
      this.add({ k: 'flash', x, y, r: 6 * s, gr: 30, life: 0.15, a: 1, c: '255,240,200' });
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU, sp = 40 + Math.random() * 90;
        this.add({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0.6, life: 0.35 + Math.random() * 0.3, a: 1, c: '255,220,150', drag: 1.5 });
      }
      this.add({ k: 'smoke', x, y, r: 5, gr: 4, life: 3, a: 0.35, c: '90,90,90' });
      return;
    }
    const big = kind === 'magazine' ? 6 : kind === 'citadel' ? 1.7 : kind === 'he' ? 1.3 : 1;
    this.add({ k: 'flash', x, y, r: 18 * s * big, gr: 80 * big, life: 0.25 + big * 0.05, a: 1, c: '255,200,120' });
    this.add({ k: 'blast', x, y, r: 10 * s * big, gr: 40 * big, life: 0.9 + big * 0.2, a: 0.9, c: '255,140,50' });
    this.add({ k: 'ring', x, y, r: 6 * big, gr: 110 * big, life: 0.7, a: 0.45, c: '255,230,200' });
    const n = Math.round(10 * big);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (20 + Math.random() * 70) * Math.sqrt(big);
      this.add({ k: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: 3, vz: 10 + Math.random() * 25 * big, r: 0.8 + Math.random() * 1.2, life: 3 + Math.random() * 2, a: 1, c: '30,30,30', drag: 0.25 });
      this.add({ k: 'ember', x, y, vx: Math.cos(a) * sp * 1.3, vy: Math.sin(a) * sp * 1.3, z: 4, vz: 12 + Math.random() * 25, r: 0.9, life: 1.6, a: 1, c: '255,170,70', drag: 0.4 });
    }
    for (let i = 0; i < 4 * big; i++) {
      this.add({ k: 'smoke', x: x + (Math.random() - 0.5) * 10 * big, y: y + (Math.random() - 0.5) * 10 * big, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, r: (8 + Math.random() * 8) * Math.sqrt(big), gr: 5 + big * 2, life: 8 + Math.random() * 6 * big, a: 0.55, c: kind === 'he' ? '70,64,58' : '40,38,36', drag: 0.6 });
    }
    if (kind === 'magazine') {
      this.add({ k: 'flash', x, y, r: 120, gr: 260, life: 0.6, a: 1, c: '255,210,150' });
      this.add({ k: 'ring', x, y, r: 30, gr: 420, life: 1.6, a: 0.7, c: '255,240,220' });
      this.add({ k: 'ring', x, y, r: 20, gr: 160, life: 3.5, a: 0.5, c: '230,240,242' });
      for (let i = 0; i < 12; i++) this.add({ k: 'blast', x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * 30, r: 30 + Math.random() * 30, gr: 30, life: 2.5 + Math.random() * 2, a: 0.9, c: '255,120,40' });
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * TAU, sp = 20 + Math.random() * 160;
        this.add({ k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 14 + Math.random() * 20, gr: 10, life: 2 + Math.random() * 2, a: 0.9, c: '255,150,60', drag: 0.8 });
        this.add({ k: 'smoke', x, y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.6, r: 25 + Math.random() * 30, gr: 9, life: 22 + Math.random() * 15, a: 0.65, c: '28,26,25', drag: 0.25 });
      }
    }
  }

  fireTick(x: number, y: number, intensity: number, dt: number) {
    if (Math.random() < dt * 14 * intensity) {
      this.add({ k: 'fire', x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 4, vx: 0, vy: 0, r: 3 + Math.random() * 3 * intensity, gr: 3, life: 0.6 + Math.random() * 0.5, a: 0.9, c: Math.random() < 0.5 ? '255,140,40' : '255,190,80', drag: 2 });
    }
    if (Math.random() < dt * 5 * intensity) {
      this.add({ k: 'smoke', x, y, vx: 0, vy: 0, r: 5 + intensity * 4, gr: 3.5, life: 10 + Math.random() * 8, a: 0.42 + intensity * 0.2, c: '24,22,21', drag: 0.7 });
    }
  }

  funnelSmoke(x: number, y: number, rate: number, dt: number, dark: number) {
    if (Math.random() < dt * rate) {
      const c = Math.round(120 - dark * 70);
      this.add({ k: 'smoke', x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3, vx: 0, vy: 0, r: 2.8, gr: 2.4, life: 10 + Math.random() * 6, a: 0.13 + dark * 0.22, c: `${c},${c - 4},${c - 8}`, drag: 0.6 });
    }
  }

  bubbles(x: number, y: number, r: number, dt: number) {
    if (Math.random() < dt * 8) {
      this.add({ k: 'foam', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.4, r: 2 + Math.random() * 4, gr: 3, life: 3, a: 0.5, c: '220,235,238' });
    }
  }

  // ------------------------------------------------------------- drawing
  /** view: world-space bounds for culling. Additive particles are drawn in a second pass to avoid state thrash. */
  draw(ctx: CanvasRenderingContext2D, zoom: number, layer: 'low' | 'high', view?: { x0: number; y0: number; x1: number; y1: number }) {
    const px = 1 / zoom; // metres per pixel
    for (const additive of [false, true]) {
    if (additive) ctx.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      const t = p.age / p.life;
      const low = p.k === 'foam' || p.k === 'ring' || p.k === 'mist';
      if ((layer === 'low') !== low) continue;
      const add = p.k === 'flash' || p.k === 'blast' || p.k === 'fire' || p.k === 'spark' || p.k === 'ember';
      if (add !== additive) continue;
      // keep gun flashes, blasts and splash columns readable when zoomed far out
      const minPx = p.k === 'flash' ? 7 : p.k === 'blast' ? 4 : p.k === 'splash' && p.vz === 0 && p.vx === 0 ? 2.2 : 0.8;
      const r = Math.max(p.r, px * minPx);
      if (view && (p.x + r < view.x0 || p.x - r > view.x1 || p.y + r < view.y0 || p.y - r > view.y1)) continue;
      // sub-pixel smoke at far zoom is invisible: skip it
      if (!additive && r < px * 0.6 && p.k !== 'splash') continue;
      switch (p.k) {
        case 'foam': {
          ctx.globalAlpha = p.a * (1 - t) * (1 - t) * (t < 0.05 ? t / 0.05 : 1);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.drawImage(foamSprite(), -r, -r, r * 2, r * 2);
          ctx.restore();
          break;
        }
        case 'ring': {
          ctx.globalAlpha = p.a * (1 - t) * (1 - t);
          ctx.strokeStyle = `rgb(${p.c})`;
          ctx.lineWidth = Math.max(px * 1.2, r * 0.08 * (1 - t));
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
          break;
        }
        case 'mist': case 'smoke': case 'steam': {
          const fadeIn = clamp01(p.age / 0.4);
          ctx.globalAlpha = p.a * fadeIn * (1 - t) * (1 - t * 0.3);
          ctx.drawImage(soft(p.c, false), p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case 'splash': {
          // column seen from above: bright core, soft edge; drops arc out
          const h = Math.max(0, p.z);
          ctx.globalAlpha = p.a * (1 - t) * (1 - t);
          const sx = p.x + h * 0.25, sy = p.y + h * 0.25;
          ctx.drawImage(soft(p.c, false), p.x - r, p.y - r, r * 2, r * 2);
          if (h > 2) { ctx.globalAlpha *= 0.3; ctx.fillStyle = 'rgba(0,20,30,1)'; ctx.beginPath(); ctx.arc(sx, sy, r * 0.8, 0, TAU); ctx.fill(); }
          break;
        }
        case 'flash': case 'blast': case 'fire': {
          ctx.globalAlpha = p.a * (1 - t) * (p.k === 'fire' ? Math.min(1, (1 - t) * 1.6) : 1);
          ctx.drawImage(soft(p.c, true), p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case 'spark': case 'ember': {
          ctx.globalAlpha = p.a * (1 - t);
          ctx.strokeStyle = `rgb(${p.c})`;
          ctx.lineWidth = Math.max(px * 1.5, r);
          const lx = p.vx * 0.04, ly = p.vy * 0.04;
          ctx.beginPath(); ctx.moveTo(p.x - lx, p.y - ly - p.z * 0.3); ctx.lineTo(p.x, p.y - p.z * 0.3); ctx.stroke();
          break;
        }
        case 'debris': {
          ctx.globalAlpha = p.a * (1 - t);
          ctx.fillStyle = `rgb(${p.c})`;
          ctx.fillRect(p.x - r / 2, p.y - r / 2 - p.z * 0.3, r, r);
          break;
        }
      }
    }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
