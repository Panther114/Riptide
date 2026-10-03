// Bottom-left damage-control plan: a true-scale plan of the ship's internal
// arrangement (frame plan from the Iowa crew handbook) with live module states,
// flooding per watertight section, fires, holes, shafts, propellers, rudders and
// turret train. Geometry comes straight from the ship class data the damage
// model uses, so the diagram is the real target the shells are traced through.

import { TAU, clamp01 } from '../core/math';
import type { Ship } from '../sim/ship';
import { FR, TDS_DEPTH } from '../sim/shipClass';

export const STATE_COLORS = ['#9fbcc5', '#e8c55a', '#ec8b45', '#df4d45'];
const STATE_FILL = ['rgba(159,188,197,0.26)', 'rgba(232,197,90,0.55)', 'rgba(236,139,69,0.62)', 'rgba(223,77,69,0.42)'];
const INK = 'rgba(214,230,236,';

// shaft lines: engine room -> propeller (Iowa: ER1 stbd outboard, ER2 port outboard, ER3 stbd inboard, ER4 port inboard)
const SHAFTS = [
  { engine: 'e1', y: 9.6, propX: FR(181), propR: 2.6 },
  { engine: 'e2', y: -9.6, propX: FR(181), propR: 2.6 },
  { engine: 'e3', y: 4.3, propX: FR(199), propR: 2.8 },
  { engine: 'e4', y: -4.3, propX: FR(199), propR: 2.8 },
];
const RUDDER_X = FR(207.5);

export class StatusPanel {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 560; h = 112;
  private t = 0;
  private prop = [0, 0, 0, 0];
  hover: string | null = null;
  mouse: { x: number; y: number } | null = null;
  armorView = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.w * dpr; canvas.height = this.h * dpr;
    canvas.style.width = this.w + 'px'; canvas.style.height = this.h + 'px';
    this.ctx.scale(dpr, dpr);
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); const sx = this.w / r.width; this.mouse = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx }; });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; });
  }

  draw(s: Ship, dt: number, time: number) {
    this.t += dt;
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cls = s.cls;
    const L = cls.length;
    const k = (w - 30) / L;            // px per metre — true scale both ways
    const cx = w / 2 - 2, cy = 58;
    const X = (x: number) => cx + x * k;
    const Y = (y: number) => cy + y * k;
    const hb = cls.halfBeam;
    const citA = FR(166), citF = FR(50);

    // ---- hover hit-test
    this.hover = null;
    if (this.mouse) {
      const lx = (this.mouse.x - cx) / k, ly = (this.mouse.y - cy) / k;
      for (const t of s.turrets) if (Math.hypot(lx - t.def.x, ly - t.def.y) < t.def.radius + 1) this.hover = t.def.id;
      if (!this.hover) for (const m of s.modules.values()) {
        const r = m.def.rect;
        if (m.def.kind !== 'turret' && lx >= r.x0 - 0.5 && lx <= r.x1 + 0.5 && ly >= r.y0 - 0.5 && ly <= r.y1 + 0.5) { this.hover = m.def.id; if (m.def.band === 'high') break; }
      }
      if (!this.hover) { const sec = s.sections.find((q) => lx >= q.def.x0 && lx < q.def.x1); if (sec && Math.abs(ly) < hb(lx)) this.hover = 'sec:' + sec.def.id; }
    }

    // ---- frame scale along the top
    ctx.font = '500 7.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let f = 0; f <= 216; f += 10) {
      const x = X(FR(f));
      const major = f % 50 === 0;
      ctx.strokeStyle = INK + (major ? '0.4)' : '0.16)');
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x, major ? 15 : 12); ctx.stroke();
      if (major) { ctx.fillStyle = INK + '0.45)'; ctx.fillText(String(f), x, 7.5); }
    }
    ctx.fillStyle = INK + '0.3)'; ctx.textAlign = 'left'; ctx.fillText('FR', 3, 7.5);

    // ---- hull
    const hull = new Path2D();
    cls.hull.forEach((p, i) => (i ? hull.lineTo(X(p.x), Y(p.y)) : hull.moveTo(X(p.x), Y(p.y))));
    hull.closePath();
    const g = ctx.createLinearGradient(0, cy - 17 * k, 0, cy + 17 * k);
    g.addColorStop(0, 'rgba(120,150,162,0.10)'); g.addColorStop(0.5, 'rgba(150,180,192,0.06)'); g.addColorStop(1, 'rgba(120,150,162,0.10)');
    ctx.fillStyle = g; ctx.fill(hull);

    ctx.save();
    ctx.clip(hull);
    // torpedo-defence layers inside the citadel
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let x = citA; x <= citF; x += 2) { const y = side * (hb(x) - TDS_DEPTH); x === citA ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
      for (let x = citF; x >= citA; x -= 2) ctx.lineTo(X(x), Y(side * hb(x)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(70,90,80,0.22)'; ctx.fill();
      ctx.strokeStyle = INK + '0.12)'; ctx.lineWidth = 0.6;
      for (const d of [1.4, 2.8, 4.2]) {
        ctx.beginPath();
        for (let x = citA; x <= citF; x += 3) { const y = side * (hb(x) - d); x === citA ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
        ctx.stroke();
      }
    }
    // flooding: water fills each side of each section
    for (const sec of s.sections) {
      const cap = sec.def.capacity / 2;
      const x0 = X(sec.def.x0), x1 = X(sec.def.x1);
      for (const side of [-1, 1] as const) {
        const f = clamp01((side > 0 ? sec.stbd : sec.port) / cap);
        if (f <= 0.003) continue;
        const depth = 17 * k * Math.min(1, f * 1.05);
        const wave = Math.sin(this.t * 3 + x0 * 0.13) * 0.7;
        ctx.fillStyle = `rgba(60,140,225,${0.32 + f * 0.42})`;
        if (side > 0) ctx.fillRect(x0, cy + 17 * k - depth + wave, x1 - x0, depth + 2);
        else ctx.fillRect(x0, cy - 17 * k - 2, x1 - x0, depth + 2 + wave);
      }
    }
    ctx.restore();

    // watertight bulkheads
    ctx.strokeStyle = INK + '0.16)'; ctx.lineWidth = 1;
    for (const sec of s.sections) {
      const x = sec.def.x0, b = hb(x);
      if (b < 1) continue;
      ctx.beginPath(); ctx.moveTo(X(x) + 0.5, Y(-b)); ctx.lineTo(X(x) + 0.5, Y(b)); ctx.stroke();
    }
    ctx.strokeStyle = INK + '0.55)'; ctx.lineWidth = 1;
    ctx.stroke(hull);

    // armoured belt & transverse bulkheads (citadel) and steering box
    ctx.strokeStyle = 'rgba(214,230,236,0.6)'; ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let x = citA; x <= citF; x += 2) { const y = side * (hb(x) - 0.35); x === citA ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
      ctx.stroke();
    }
    ctx.lineWidth = 1.6;
    for (const x of [citA, citF]) { ctx.beginPath(); ctx.moveTo(X(x), Y(-hb(x) + 0.3)); ctx.lineTo(X(x), Y(hb(x) - 0.3)); ctx.stroke(); }
    const steerZ = cls.zones.find((z) => z.belt > 330);
    if (steerZ) { ctx.lineWidth = 1.4; ctx.strokeRect(X(steerZ.x0), Y(-7.6), (steerZ.x1 - steerZ.x0) * k, 15.2 * k); }

    // shafts, propellers and rudders
    for (let i = 0; i < SHAFTS.length; i++) {
      const sh = SHAFTS[i];
      const eng = s.mod(sh.engine);
      const er = eng.def.rect;
      const live = eng.level < 3 && !eng.flooded;
      ctx.strokeStyle = live ? INK + '0.4)' : 'rgba(223,77,69,0.5)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash(live ? [] : [2, 2]);
      ctx.beginPath(); ctx.moveTo(X(er.x0), Y(sh.y)); ctx.lineTo(X(sh.propX), Y(sh.y)); ctx.stroke();
      ctx.setLineDash([]);
      const rpm = live ? s.speed / cls.maxSpeed : 0;
      this.prop[i] += rpm * dt * 14 * (sh.y > 0 ? 1 : -1);
      ctx.save(); ctx.translate(X(sh.propX), Y(sh.y));
      ctx.strokeStyle = live ? INK + '0.75)' : 'rgba(223,77,69,0.6)'; ctx.lineWidth = 1.4;
      const blades = i < 2 ? 4 : 5;
      for (let b = 0; b < blades; b++) {
        const a = this.prop[i] + (b * TAU) / blades;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 1.2, Math.sin(a) * sh.propR * k * 0.55); ctx.stroke();
      }
      ctx.restore();
    }
    const steer = s.mod('steer');
    for (const y of [-4.3, 4.3]) {
      ctx.save(); ctx.translate(X(RUDDER_X + 2.2), Y(y));
      ctx.rotate(-s.rudder);
      ctx.strokeStyle = steer.level === 3 ? '#df4d45' : 'rgba(235,244,247,0.9)';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5.6 * k, 0); ctx.stroke();
      ctx.restore();
    }

    if (this.armorView) { this.drawArmor(s, X, Y, k, cy); return; }

    // ---- vital spaces below the armoured deck
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of s.modules.values()) {
      const d = m.def;
      if (d.kind === 'turret' || d.band !== 'low') continue;
      const r = d.rect;
      const x = X(r.x0), y = Y(r.y0), ww = (r.x1 - r.x0) * k, hh = (r.y1 - r.y0) * k;
      ctx.fillStyle = m.flooded ? 'rgba(60,140,225,0.55)' : STATE_FILL[m.level];
      ctx.fillRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
      ctx.strokeStyle = m.flooded ? '#4b93d8' : STATE_COLORS[m.level];
      ctx.globalAlpha = m.level === 0 && !m.flooded ? 0.55 : 0.95;
      ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
      ctx.globalAlpha = 1;
      // equipment silhouettes: two boilers per fire room, turbine + reduction gear per engine room
      ctx.strokeStyle = INK + '0.35)'; ctx.lineWidth = 0.8;
      if (d.kind === 'boiler') {
        ctx.strokeRect(x + ww * 0.2, y + hh * 0.12, ww * 0.6, hh * 0.3);
        ctx.strokeRect(x + ww * 0.2, y + hh * 0.58, ww * 0.6, hh * 0.3);
      } else if (d.kind === 'engine') {
        ctx.strokeRect(x + ww * 0.12, cy - hh * 0.28, ww * 0.42, hh * 0.56);
        ctx.beginPath(); ctx.arc(x + ww * 0.74, cy, Math.min(ww, hh) * 0.2, 0, TAU); ctx.stroke();
      } else if (d.kind === 'magazine') {
        ctx.setLineDash([1.5, 2]);
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 2, y + (hh * i) / 4); ctx.lineTo(x + ww - 2, y + (hh * i) / 4); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      if (m.level === 3 && !m.flooded) this.cross(x, y, ww, hh);
      this.flash(m.lastHit, time, x, y, ww, hh);
      if (this.hover === d.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, ww, hh); }
      ctx.fillStyle = 'rgba(232,242,246,0.9)';
      ctx.font = '600 8px "Barlow Condensed", sans-serif';
      if (ww >= 26) ctx.fillText(d.short, x + ww / 2, cy + 0.5);
      else { ctx.save(); ctx.translate(x + ww / 2, cy); ctx.rotate(-Math.PI / 2); ctx.fillText(d.short, 0, 0.5); ctx.restore(); }
    }

    // ---- barbettes and turrets (true size, live train)
    for (const t of s.turrets) {
      const m = s.mod(t.def.id);
      const x = X(t.def.x), y = Y(t.def.y);
      ctx.beginPath(); ctx.arc(x, y, t.def.barbetteRadius * k, 0, TAU);
      ctx.fillStyle = 'rgba(12,24,30,0.9)'; ctx.fill();
      ctx.strokeStyle = INK + '0.5)'; ctx.lineWidth = 1; ctx.stroke();
      const ang = t.def.facing + t.offset;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const col = STATE_COLORS[m.level];
      ctx.strokeStyle = m.level === 3 ? 'rgba(223,77,69,0.6)' : 'rgba(232,242,246,0.85)';
      ctx.lineWidth = 1.2;
      const rec = t.recoil * t.recoil * 2;
      for (const o of [-2.6, 0, 2.6]) { ctx.beginPath(); ctx.moveTo((5.6 - rec) * k, o * k); ctx.lineTo((26.6 - rec) * k, o * k); ctx.stroke(); }
      ctx.beginPath();
      ctx.moveTo(6.6 * k, -5.2 * k); ctx.lineTo(6.6 * k, 5.2 * k); ctx.lineTo(3.2 * k, 6.6 * k); ctx.lineTo(-7.4 * k, 6.6 * k);
      ctx.lineTo(-8.8 * k, 3.8 * k); ctx.lineTo(-8.8 * k, -3.8 * k); ctx.lineTo(-7.4 * k, -6.6 * k); ctx.lineTo(3.2 * k, -6.6 * k); ctx.closePath();
      ctx.fillStyle = m.level === 3 ? 'rgba(80,30,28,0.9)' : col; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(6,14,18,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / cls.reloadTime);
      ctx.strokeStyle = t.loaded ? 'rgba(134,208,169,1)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(x, y, t.def.radius * k + 3, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      if (m.level === 3) this.cross(x - 5, y - 5, 10, 10);
      const fl = clamp01(1 - (time - m.lastHit) / 0.8);
      if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.beginPath(); ctx.arc(x, y, t.def.radius * k, 0, TAU); ctx.fill(); }
      if (this.hover === t.def.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, t.def.radius * k + 1, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(6,14,18,0.95)'; ctx.font = '700 8px "Barlow Condensed", sans-serif';
      ctx.fillText(t.def.name.replace('Turret ', ''), x, y + 0.5);
    }

    // ---- upper-works systems (above the armour deck): outlined
    for (const m of s.modules.values()) {
      const d = m.def;
      if (d.band !== 'high' || d.kind === 'turret') continue;
      const r = d.rect;
      const x = X(r.x0), y = Y(r.y0), ww = (r.x1 - r.x0) * k, hh = (r.y1 - r.y0) * k;
      ctx.beginPath();
      if (d.kind === 'funnel') ctx.ellipse(x + ww / 2, y + hh / 2, ww / 2, hh / 2, 0, 0, TAU);
      else ctx.roundRect(x, y, ww, hh, 2);
      ctx.fillStyle = 'rgba(8,18,22,0.85)'; ctx.fill();
      ctx.strokeStyle = STATE_COLORS[m.level]; ctx.lineWidth = m.level ? 1.6 : 1.1; ctx.stroke();
      if (m.level === 3) this.cross(x, y, ww, hh);
      const fl = clamp01(1 - (time - m.lastHit) / 0.8);
      if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.fill(); }
      if (this.hover === d.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); }
    }

    this.drawHolesFires(s, X, Y);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '500 8.5px "Barlow Condensed", sans-serif';
    ctx.fillStyle = INK + '0.45)';
    ctx.fillText('CITADEL FR 50–166 · 307 mm BELT @ 19° · TRUE SCALE', 4, h - 3);
  }

  private cross(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,120,110,0.95)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.moveTo(x + w - 2, y + 2); ctx.lineTo(x + 2, y + h - 2); ctx.stroke();
  }

  private flash(lastHit: number, time: number, x: number, y: number, w: number, h: number) {
    const fl = clamp01(1 - (time - lastHit) / 0.8);
    if (fl > 0) { this.ctx.fillStyle = `rgba(255,255,255,${fl * 0.75})`; this.ctx.fillRect(x, y, w, h); }
  }

  private drawHolesFires(s: Ship, X: (x: number) => number, Y: (y: number) => number) {
    const ctx = this.ctx;
    for (const hle of s.holes) {
      const x = X(hle.x), y = Y(hle.side * (s.cls.halfBeam(hle.x) - 0.2));
      const under = s.waterRise(hle.x) - hle.z > 0;
      ctx.fillStyle = under ? 'rgba(120,195,255,1)' : 'rgba(225,230,232,0.7)';
      ctx.beginPath(); ctx.arc(x, y, under ? 2.3 : 1.6, 0, TAU); ctx.fill();
      if (under) { ctx.strokeStyle = 'rgba(120,195,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 3.5 + Math.sin(this.t * 6) * 0.8, 0, TAU); ctx.stroke(); }
    }
    for (const f of s.fires) {
      const x = X(f.x), y = Y(f.y);
      const flick = 0.75 + Math.sin(this.t * 17 + f.id) * 0.15 + Math.sin(this.t * 31 + f.id * 3) * 0.1;
      const sz = 3.5 + f.intensity * 3.5;
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
  }

  private drawArmor(s: Ship, X: (x: number) => number, Y: (y: number) => number, k: number, cy: number) {
    const ctx = this.ctx;
    const cls = s.cls;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const z of cls.zones) {
      const t = clamp01((z.belt - 20) / 330);
      const col = `rgba(${Math.round(90 + t * 150)},${Math.round(120 + t * 50)},${Math.round(135 - t * 80)},`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let x = z.x0; x <= z.x1; x += 1.5) { const y = side * cls.halfBeam(x); x === z.x0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
        ctx.strokeStyle = col + '0.95)'; ctx.lineWidth = 1.5 + t * 4; ctx.stroke();
      }
      const mid = (z.x0 + z.x1) / 2, b = cls.halfBeam(mid);
      ctx.fillStyle = col + '0.16)';
      ctx.fillRect(X(z.x0), Y(-b), (z.x1 - z.x0) * k, b * 2 * k);
      if ((z.x1 - z.x0) * k > 24) {
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(240,246,248,0.95)';
        ctx.fillText(`${z.belt}`, X(mid), cy - 8);
        ctx.fillStyle = 'rgba(200,215,220,0.7)';
        ctx.fillText(`${z.deck}`, X(mid), cy + 8);
      }
    }
    for (const t of s.turrets) {
      ctx.beginPath(); ctx.arc(X(t.def.x), Y(t.def.y), t.def.barbetteRadius * k, 0, TAU);
      ctx.fillStyle = 'rgba(240,120,80,0.95)'; ctx.fill(); ctx.strokeStyle = 'rgba(8,16,20,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(8,16,20,0.95)'; ctx.font = '600 7.5px "IBM Plex Mono", monospace';
      ctx.fillText(`${t.def.armor.barbette}`, X(t.def.x), Y(t.def.y));
    }
    const ct = cls.structures.find((q) => q.conning);
    if (ct) { ctx.fillStyle = 'rgba(240,120,80,0.95)'; ctx.fillRect(X(ct.rect.x0), Y(ct.rect.y0), (ct.rect.x1 - ct.rect.x0) * k, (ct.rect.y1 - ct.rect.y0) * k); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK + '0.55)';
    ctx.font = '500 8.5px "Barlow Condensed", sans-serif';
    ctx.fillText('ARMOUR mm · belt (upper figure) · deck (lower) · barbettes · conning tower · V to return', 4, this.h - 3);
  }
}
