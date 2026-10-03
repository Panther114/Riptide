// Bottom-left damage-control diagram: the real internal layout of the ship with
// live module states, flooding per watertight section, fires and turret training.

import { TAU, clamp01 } from '../core/math';
import type { Ship } from '../sim/ship';

export const STATE_COLORS = ['#a7c3cb', '#f2cf5b', '#f3904a', '#e5534b'];

export class StatusPanel {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 440; h = 128;
  private t = 0;
  hover: string | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.w * dpr; canvas.height = this.h * dpr;
    canvas.style.width = this.w + 'px'; canvas.style.height = this.h + 'px';
    this.ctx.scale(dpr, dpr);
  }

  draw(s: Ship, dt: number, time: number) {
    this.t += dt;
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const L = s.cls.length;
    const k = (w - 24) / L;           // px per metre (horizontal)
    const ky = k * 1.9;               // exaggerate beam for legibility
    const cx = w / 2, cy = h / 2;
    const X = (x: number) => cx + x * k;
    const Y = (y: number) => cy + y * ky;

    // hull
    const hull = new Path2D();
    s.cls.hull.forEach((p, i) => (i ? hull.lineTo(X(p.x), Y(p.y)) : hull.moveTo(X(p.x), Y(p.y))));
    hull.closePath();
    ctx.fillStyle = 'rgba(160,190,205,0.07)';
    ctx.fill(hull);

    // flooding per section (fills from each side towards centre)
    ctx.save();
    ctx.clip(hull);
    for (const sec of s.sections) {
      const cap = sec.def.capacity / 2;
      const x0 = X(sec.def.x0), x1 = X(sec.def.x1);
      const hb = 17 * ky;
      for (const side of [-1, 1] as const) {
        const f = clamp01((side > 0 ? sec.stbd : sec.port) / cap);
        if (f <= 0.002) continue;
        const depth = hb * f;
        const wave = Math.sin(this.t * 3 + x0 * 0.1) * 0.8;
        ctx.fillStyle = `rgba(64,150,230,${0.35 + f * 0.4})`;
        if (side > 0) ctx.fillRect(x0, cy + hb - depth + wave, x1 - x0, depth);
        else ctx.fillRect(x0, cy - hb, x1 - x0, depth + wave);
      }
    }
    ctx.restore();
    // section bulkheads
    ctx.strokeStyle = 'rgba(200,220,230,0.13)';
    ctx.lineWidth = 1;
    for (const sec of s.sections) {
      const x = X(sec.def.x0);
      const hb = s.cls.halfBeam(sec.def.x0) * ky;
      ctx.beginPath(); ctx.moveTo(x, cy - hb); ctx.lineTo(x, cy + hb); ctx.stroke();
    }
    // armoured citadel outline
    const cit = s.cls.zones.filter((z) => z.citadel && z.belt > 300 && z.belt < 330);
    if (cit.length) {
      const x0 = Math.min(...cit.map((z) => z.x0)), x1 = Math.max(...cit.map((z) => z.x1));
      ctx.strokeStyle = 'rgba(200,220,230,0.28)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(X(x0), Y(-14.5), (x1 - x0) * k, 29 * ky);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(210,228,236,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke(hull);

    // modules
    ctx.font = '600 8.5px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of s.modules.values()) {
      const d = m.def;
      if (d.kind === 'turret') continue;
      const r = d.rect;
      const x = X(r.x0), y = Y(r.y0), ww = (r.x1 - r.x0) * k, hh = (r.y1 - r.y0) * ky;
      const flash = clamp01(1 - (time - m.lastHit) / 0.8);
      let col = STATE_COLORS[m.level];
      const high = d.band === 'high';
      ctx.globalAlpha = high ? 0.95 : 0.85;
      ctx.fillStyle = m.flooded ? '#3f86d0' : col;
      ctx.globalAlpha *= m.level === 3 ? 0.55 : 0.9;
      ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, ww - 1, hh - 1, 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (m.level === 3 && !m.flooded) {
        ctx.strokeStyle = 'rgba(20,10,10,0.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + ww - 2, y + hh - 2); ctx.moveTo(x + ww - 2, y + 2); ctx.lineTo(x + 2, y + hh - 2); ctx.stroke();
      }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.7})`; ctx.fillRect(x, y, ww, hh); }
      if (high) { ctx.strokeStyle = 'rgba(10,20,25,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1); }
      if (ww > 18 && hh > 12) {
        ctx.fillStyle = 'rgba(8,16,20,0.85)';
        ctx.fillText(d.short, x + ww / 2, y + hh / 2 + 0.5);
      }
    }

    // turrets with live training
    for (const t of s.turrets) {
      const m = s.mod(t.def.id);
      const x = X(t.def.x), y = Y(t.def.y);
      const rad = 7.5;
      const col = STATE_COLORS[m.level];
      const flash = clamp01(1 - (time - m.lastHit) / 0.8);
      const ang = t.def.facing + t.offset;
      ctx.save();
      ctx.translate(x, y);
      // barrels — drawn in true angle (beam is exaggerated, keep angle honest)
      ctx.rotate(ang);
      ctx.strokeStyle = m.level === 3 ? 'rgba(200,80,70,0.5)' : 'rgba(225,235,240,0.85)';
      ctx.lineWidth = 1.4;
      for (const o of [-2.6, 0, 2.6]) { ctx.beginPath(); ctx.moveTo(4, o); ctx.lineTo(19, o * 0.7); ctx.stroke(); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU);
      ctx.fillStyle = col; ctx.globalAlpha = m.level === 3 ? 0.6 : 0.95; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(8,16,20,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
      // reload ring
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / s.cls.reloadTime);
      ctx.strokeStyle = t.loaded ? 'rgba(150,240,180,1)' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rad + 3, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(8,16,20,0.9)';
      ctx.font = '700 8px "Barlow Condensed", sans-serif';
      ctx.fillText(t.def.name.replace('Turret ', ''), x, y + 0.5);
      if (m.level === 3) {
        ctx.strokeStyle = 'rgba(20,10,10,0.9)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
      }
    }

    // holes
    for (const hle of s.holes) {
      const x = X(hle.x), y = cy + hle.side * 16.5 * ky;
      const under = s.waterRise(hle.x) - hle.z > 0;
      ctx.fillStyle = under ? 'rgba(120,190,255,0.95)' : 'rgba(230,230,230,0.6)';
      ctx.beginPath(); ctx.arc(x, y, under ? 2.2 : 1.5, 0, TAU); ctx.fill();
    }

    // fires
    for (const f of s.fires) {
      const x = X(f.x), y = Y(f.y);
      const flick = 0.75 + Math.sin(this.t * 17 + f.id) * 0.15 + Math.sin(this.t * 31 + f.id * 3) * 0.1;
      const sz = 4 + f.intensity * 4;
      ctx.save(); ctx.translate(x, y); ctx.scale(flick, 1);
      ctx.fillStyle = f.band === 'low' ? 'rgba(255,90,40,0.95)' : 'rgba(255,150,50,0.95)';
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.3);
      ctx.quadraticCurveTo(sz * 0.9, -sz * 0.1, 0, sz * 0.6);
      ctx.quadraticCurveTo(-sz * 0.9, -sz * 0.1, 0, -sz * 1.3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,230,140,0.95)';
      ctx.beginPath(); ctx.arc(0, sz * 0.05, sz * 0.32, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // bow marker
    ctx.fillStyle = 'rgba(210,228,236,0.4)';
    ctx.font = '600 9px "Barlow Condensed", sans-serif';
    ctx.fillText('BOW ▸', w - 22, 10);
  }
}
