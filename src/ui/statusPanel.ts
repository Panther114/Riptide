// Bottom-left damage-control plan: a true-scale plan of the ship's internal
// arrangement with live module states, flooding per watertight section, fires,
// holes, shafts, propellers, rudders, turret train, secondary mounts, torpedo
// tubes and damage-control parties. Geometry comes straight from the ship class
// data the damage model uses, so the diagram is the real target the shells are
// traced through. Click a compartment to send a party there; right-click
// returns every party to automatic damage control.

import { TAU, clamp01 } from '../core/math';
import type { Ship } from '../sim/ship';
import type { HitReport } from '../sim/damage';
import type { Shell } from '../sim/world';
import type { DCTarget } from '../sim/types';

export const STATE_COLORS = ['#9fbcc5', '#e8c55a', '#ec8b45', '#df4d45'];
const STATE_FILL = ['rgba(159,188,197,0.26)', 'rgba(232,197,90,0.55)', 'rgba(236,139,69,0.62)', 'rgba(223,77,69,0.42)'];
const INK = 'rgba(214,230,236,';

export class StatusPanel {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 560; h = 112;
  private t = 0;
  private prop: number[] = [];
  hover: string | null = null;
  mouse: { x: number; y: number } | null = null;
  armorView = false;
  /** Damage-control orders from clicks on the plan. */
  onOrder: ((t: DCTarget | 'auto') => void) | null = null;
  private lastShip: Ship | null = null;
  /** Recent shell strikes on the plan: a shell streaks in along its real track, then bursts. */
  private strikes: { x: number; y: number; det: { x: number; y: number } | null; dx: number; dy: number; kind: HitReport['kind']; size: number; t0: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.w * dpr; canvas.height = this.h * dpr;
    canvas.style.width = this.w + 'px'; canvas.style.height = this.h + 'px';
    this.ctx.scale(dpr, dpr);
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); const sx = this.w / r.width; this.mouse = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx }; });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onOrder?.('auto'); });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.hover || !this.lastShip) return;
      const s = this.lastShip;
      if (this.hover.startsWith('sec:')) {
        const idx = s.sections.findIndex((q) => 'sec:' + q.def.id === this.hover);
        if (idx >= 0) this.onOrder?.({ type: 'section', index: idx });
      } else {
        const m = s.modules.get(this.hover);
        if (!m) return;
        // a damaged compartment gets repaired; one that is burning or flooding gets its section worked
        const xm = (m.def.rect.x0 + m.def.rect.x1) / 2;
        const sec = s.sectionAt(xm);
        const sectionTrouble = s.dcNeeded({ type: 'section', index: sec });
        if (s.dcNeeded({ type: 'module', id: m.def.id }) && !(sectionTrouble && m.hp >= s.repairCap(m) - 0.5)) this.onOrder?.({ type: 'module', id: m.def.id });
        else if (sectionTrouble) this.onOrder?.({ type: 'section', index: sec });
        else this.onOrder?.({ type: 'module', id: m.def.id });
      }
    });
  }

  /** An enemy shell struck this ship: animate it on the plan. */
  addStrike(r: HitReport, sh: Shell) {
    // direction of travel in the ship's frame
    const wx = sh.target.x - sh.origin.x, wy = sh.target.y - sh.origin.y;
    const c = Math.cos(-r.ship.heading), sn = Math.sin(-r.ship.heading), n = Math.hypot(wx, wy) || 1;
    const det = r.det && r.kind !== 'nonpen' && r.kind !== 'ricochet' && r.kind !== 'shatter' ? { x: r.det.x, y: r.det.y } : null;
    this.strikes.push({ x: r.local.x, y: r.local.y, det, dx: (wx * c - wy * sn) / n, dy: (wx * sn + wy * c) / n, kind: r.kind, size: Math.max(0.45, Math.sqrt(sh.shell.caliber / 406)), t0: this.t });
    if (this.strikes.length > 24) this.strikes.shift();
  }

  draw(s: Ship, dt: number, time: number) {
    if (this.lastShip !== s) this.strikes = [];
    this.lastShip = s;
    this.t += dt;
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cls = s.cls;
    const L = cls.length;
    const half = L / 2, hbMax = cls.beam / 2;
    const k = (w - 30) / L;            // px per metre — true scale both ways
    const cx = w / 2 - 2, cy = 58;
    const X = (x: number) => cx + x * k;
    const Y = (y: number) => cy + y * k;
    const hb = cls.halfBeam;
    const cit = cls.citadel;
    // depth of the side protection (torpedo bulkheads / bunkers) from the vital spaces' outline
    let inner = 0;
    for (const m of cls.modules) if (m.band === 'low' && cit && m.rect.x0 >= cit.x0 - 1 && m.rect.x1 <= cit.x1 + 1) inner = Math.max(inner, m.rect.y1);
    const tdsDepth = cit ? Math.max(0.8, hbMax - inner) : 0;

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
    this.canvas.style.cursor = this.hover ? 'pointer' : 'default';

    // ---- scale along the top: frames where the plan has them, metres otherwise
    ctx.font = '500 7.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (cls.frames) {
      for (let f = 0; f <= cls.frames.max; f += 10) {
        const x = X(cls.frames.toX(f));
        const major = f % 50 === 0;
        ctx.strokeStyle = INK + (major ? '0.4)' : '0.16)');
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x, major ? 15 : 12); ctx.stroke();
        if (major) { ctx.fillStyle = INK + '0.45)'; ctx.fillText(String(f), x, 7.5); }
      }
      ctx.fillStyle = INK + '0.3)'; ctx.textAlign = 'left'; ctx.fillText('FR', 3, 7.5);
    } else {
      const step = L > 160 ? 10 : 5;
      for (let m = 0; m <= L; m += step) {
        const x = X(half - m);
        const major = m % (step * 5) === 0;
        ctx.strokeStyle = INK + (major ? '0.4)' : '0.16)');
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x, major ? 15 : 12); ctx.stroke();
        if (major) { ctx.fillStyle = INK + '0.45)'; ctx.fillText(String(m), x, 7.5); }
      }
      ctx.fillStyle = INK + '0.3)'; ctx.textAlign = 'left'; ctx.fillText('M', 3, 7.5);
    }

    // ---- hull
    const hull = new Path2D();
    cls.hull.forEach((p, i) => (i ? hull.lineTo(X(p.x), Y(p.y)) : hull.moveTo(X(p.x), Y(p.y))));
    hull.closePath();
    const g = ctx.createLinearGradient(0, cy - hbMax * k, 0, cy + hbMax * k);
    g.addColorStop(0, 'rgba(120,150,162,0.10)'); g.addColorStop(0.5, 'rgba(150,180,192,0.06)'); g.addColorStop(1, 'rgba(120,150,162,0.10)');
    ctx.fillStyle = g; ctx.fill(hull);

    ctx.save();
    ctx.clip(hull);
    // torpedo-defence layers inside the citadel
    if (cit && tdsDepth > 1.5) for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let x = cit.x0; x <= cit.x1; x += 2) { const y = side * (hb(x) - tdsDepth); x === cit.x0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
      for (let x = cit.x1; x >= cit.x0; x -= 2) ctx.lineTo(X(x), Y(side * hb(x)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(70,90,80,0.22)'; ctx.fill();
      ctx.strokeStyle = INK + '0.12)'; ctx.lineWidth = 0.6;
      for (const d of [0.25, 0.5, 0.75].map((q) => q * tdsDepth)) {
        ctx.beginPath();
        for (let x = cit.x0; x <= cit.x1; x += 3) { const y = side * (hb(x) - d); x === cit.x0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
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
        const depth = hbMax * k * Math.min(1, f * 1.05);
        const wave = Math.sin(this.t * 3 + x0 * 0.13) * 0.7;
        ctx.fillStyle = `rgba(60,140,225,${0.32 + f * 0.42})`;
        if (side > 0) ctx.fillRect(x0, cy + hbMax * k - depth + wave, x1 - x0, depth + 2);
        else ctx.fillRect(x0, cy - hbMax * k - 2, x1 - x0, depth + 2 + wave);
      }
    }
    // hovered section
    if (this.hover?.startsWith('sec:')) {
      const sec = s.sections.find((q) => 'sec:' + q.def.id === this.hover);
      if (sec) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(X(sec.def.x0), cy - hbMax * k, (sec.def.x1 - sec.def.x0) * k, hbMax * 2 * k); }
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
    if (cit) {
      ctx.strokeStyle = 'rgba(214,230,236,0.6)'; ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let x = cit.x0; x <= cit.x1; x += 2) { const y = side * (hb(x) - 0.35); x === cit.x0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
        ctx.stroke();
      }
      ctx.lineWidth = 1.6;
      for (const x of [cit.x0, cit.x1]) { ctx.beginPath(); ctx.moveTo(X(x), Y(-hb(x) + 0.3)); ctx.lineTo(X(x), Y(hb(x) - 0.3)); ctx.stroke(); }
    }
    const steerZ = cls.zones.find((z) => z.beltName?.includes('steering') && z.belt > 100);
    if (steerZ) { ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(214,230,236,0.6)'; const yb = Math.min(hb((steerZ.x0 + steerZ.x1) / 2) * 0.5, 7.6); ctx.strokeRect(X(steerZ.x0), Y(-yb), (steerZ.x1 - steerZ.x0) * k, yb * 2 * k); }

    // shafts, propellers and rudders
    cls.shafts.forEach((sh, i) => {
      const eng = s.mod(sh.engine);
      const er = eng.def.rect;
      const live = eng.level < 3 && !eng.flooded;
      ctx.strokeStyle = live ? INK + '0.4)' : 'rgba(223,77,69,0.5)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash(live ? [] : [2, 2]);
      ctx.beginPath(); ctx.moveTo(X(er.x0), Y(sh.y)); ctx.lineTo(X(sh.propX), Y(sh.y)); ctx.stroke();
      ctx.setLineDash([]);
      const rpm = live ? s.speed / cls.maxSpeed : 0;
      this.prop[i] = (this.prop[i] ?? 0) + rpm * dt * 14 * (sh.y >= 0 ? 1 : -1);
      ctx.save(); ctx.translate(X(sh.propX), Y(sh.y));
      ctx.strokeStyle = live ? INK + '0.75)' : 'rgba(223,77,69,0.6)'; ctx.lineWidth = 1.4;
      for (let b = 0; b < sh.blades; b++) {
        const a = this.prop[i] + (b * TAU) / sh.blades;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 1.2, Math.sin(a) * sh.propR * k * 0.55); ctx.stroke();
      }
      ctx.restore();
    });
    const steer = s.modsOf('steering')[0];
    for (const y of cls.rudders.ys) {
      ctx.save(); ctx.translate(X(cls.rudders.x), Y(y));
      ctx.rotate(-s.rudder);
      ctx.strokeStyle = steer?.level === 3 ? '#df4d45' : 'rgba(235,244,247,0.9)';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-cls.rudders.len * k, 0); ctx.stroke();
      ctx.restore();
    }

    if (this.armorView) { this.drawArmor(s, X, Y, k, cy); this.drawStrikes(X, Y); return; }

    // ---- vital spaces below the armoured deck
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of s.modules.values()) {
      const d = m.def;
      if (d.kind === 'turret' || d.band !== 'low') continue;
      const r = d.rect;
      const x = X(r.x0), y = Y(r.y0), ww = (r.x1 - r.x0) * k, hh = (r.y1 - r.y0) * k;
      const ym = Y((r.y0 + r.y1) / 2);
      ctx.fillStyle = m.flooded ? 'rgba(60,140,225,0.55)' : STATE_FILL[m.level];
      ctx.fillRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
      ctx.strokeStyle = m.flooded ? '#4b93d8' : STATE_COLORS[m.level];
      ctx.globalAlpha = m.level === 0 && !m.flooded ? 0.55 : 0.95;
      ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, ww - 1, hh - 1);
      ctx.globalAlpha = 1;
      // equipment silhouettes: boilers, turbine + reduction gear, shell rooms
      ctx.strokeStyle = INK + '0.35)'; ctx.lineWidth = 0.8;
      if (d.kind === 'boiler') {
        ctx.strokeRect(x + ww * 0.2, y + hh * 0.12, ww * 0.6, hh * 0.3);
        ctx.strokeRect(x + ww * 0.2, y + hh * 0.58, ww * 0.6, hh * 0.3);
      } else if (d.kind === 'engine') {
        ctx.strokeRect(x + ww * 0.12, ym - hh * 0.28, ww * 0.42, hh * 0.56);
        ctx.beginPath(); ctx.arc(x + ww * 0.74, ym, Math.min(ww, hh) * 0.2, 0, TAU); ctx.stroke();
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
      if (ww >= 26) ctx.fillText(d.short, x + ww / 2, ym + 0.5);
      else if (hh >= 20) { ctx.save(); ctx.translate(x + ww / 2, ym); ctx.rotate(-Math.PI / 2); ctx.fillText(d.short, 0, 0.5); ctx.restore(); }
    }

    // ---- torpedo tubes
    for (const tm of s.torpedoMounts) {
      const md = s.mod(tm.def.module);
      ctx.save(); ctx.translate(X(tm.def.x), Y(tm.def.y)); ctx.rotate(tm.train);
      const tl = Math.min(9, cls.beam * 0.42) * k, n = tm.def.tubes;
      ctx.fillStyle = md.level === 3 ? 'rgba(223,77,69,0.7)' : tm.loaded ? 'rgba(150,225,255,0.85)' : 'rgba(150,170,180,0.35)';
      for (let i = 0; i < n; i++) ctx.fillRect(-tl / 2, (i - n / 2) * 0.7 * k, tl, Math.max(1, 0.5 * k));
      ctx.restore();
    }

    // ---- barbettes and turrets (true size, live train)
    for (const t of s.turrets) {
      const m = s.mod(t.def.id);
      const x = X(t.def.x), y = Y(t.def.y);
      const R = t.def.radius;
      ctx.beginPath(); ctx.arc(x, y, t.def.barbetteRadius * k, 0, TAU);
      ctx.fillStyle = 'rgba(12,24,30,0.9)'; ctx.fill();
      ctx.strokeStyle = INK + '0.5)'; ctx.lineWidth = 1; ctx.stroke();
      const ang = t.def.facing + t.offset;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const col = STATE_COLORS[m.level];
      ctx.strokeStyle = m.level === 3 ? 'rgba(223,77,69,0.6)' : 'rgba(232,242,246,0.85)';
      ctx.lineWidth = Math.max(0.8, Math.min(1.2, R * 0.17));
      const rec = t.recoil * t.recoil * 2 * (R / 7.2);
      for (let gI = 0; gI < t.def.guns; gI++) {
        const o = (gI - (t.def.guns - 1) / 2) * t.def.spacing;
        ctx.beginPath(); ctx.moveTo((R * 0.78 - rec) * k, o * k); ctx.lineTo((t.def.barrel - rec) * k, o * k); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0.92 * R * k, -0.72 * R * k); ctx.lineTo(0.92 * R * k, 0.72 * R * k); ctx.lineTo(0.44 * R * k, 0.92 * R * k); ctx.lineTo(-1.03 * R * k, 0.92 * R * k);
      ctx.lineTo(-1.22 * R * k, 0.53 * R * k); ctx.lineTo(-1.22 * R * k, -0.53 * R * k); ctx.lineTo(-1.03 * R * k, -0.92 * R * k); ctx.lineTo(0.44 * R * k, -0.92 * R * k); ctx.closePath();
      ctx.fillStyle = m.level === 3 ? 'rgba(80,30,28,0.9)' : col; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(6,14,18,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / cls.reloadTime);
      ctx.strokeStyle = t.loaded ? 'rgba(134,208,169,1)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(x, y, R * k + 3, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      if (m.level === 3) this.cross(x - 5, y - 5, 10, 10);
      const fl = clamp01(1 - (time - m.lastHit) / 0.8);
      if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.beginPath(); ctx.arc(x, y, R * k, 0, TAU); ctx.fill(); }
      if (this.hover === t.def.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, R * k + 1, 0, TAU); ctx.stroke(); }
      if (R * k > 7) {
        ctx.fillStyle = 'rgba(6,14,18,0.95)'; ctx.font = '700 8px "Barlow Condensed", sans-serif';
        ctx.fillText(m.def.short, x, y + 0.5);
      }
    }

    // ---- upper-works systems (above the armour deck): outlined
    for (const m of s.modules.values()) {
      const d = m.def;
      if (d.band !== 'high' || d.kind === 'turret' || d.kind === 'torpedo') continue;
      const r = d.rect;
      const x = X(r.x0), y = Y(r.y0), ww = (r.x1 - r.x0) * k, hh = (r.y1 - r.y0) * k;
      ctx.beginPath();
      if (d.kind === 'funnel') ctx.ellipse(x + ww / 2, y + hh / 2, ww / 2, hh / 2, 0, 0, TAU);
      else ctx.roundRect(x, y, ww, hh, 2);
      ctx.fillStyle = d.kind === 'secondary' ? 'rgba(8,18,22,0.35)' : 'rgba(8,18,22,0.85)'; ctx.fill();
      ctx.strokeStyle = STATE_COLORS[m.level]; ctx.lineWidth = m.level ? 1.6 : 1.1;
      if (d.kind === 'secondary') ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (m.level === 3) this.cross(x, y, ww, hh);
      const fl = clamp01(1 - (time - m.lastHit) / 0.8);
      if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.fill(); }
      if (this.hover === d.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); }
    }
    // secondary mounts as live dots
    for (const sm of s.secondaries) {
      const lvl = s.mod(sm.def.module).level;
      ctx.beginPath(); ctx.arc(X(sm.def.x), Y(sm.def.y), Math.max(1.6, sm.def.radius * k * 0.8), 0, TAU);
      ctx.fillStyle = lvl === 3 ? 'rgba(223,77,69,0.8)' : sm.target != null ? 'rgba(255,214,140,0.95)' : STATE_COLORS[lvl];
      ctx.fill();
    }
    // torpedo mount hover outline
    for (const m of s.modsOf('torpedo')) {
      const r = m.def.rect;
      ctx.strokeStyle = this.hover === m.def.id ? '#fff' : STATE_COLORS[m.level]; ctx.lineWidth = this.hover === m.def.id ? 1.5 : 0.8;
      ctx.setLineDash([2, 2]); ctx.strokeRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k); ctx.setLineDash([]);
      if (m.level === 3) this.cross(X(r.x0), Y(r.y0), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
    }

    this.drawHolesFires(s, X, Y);
    this.drawParties(s, X, Y, k, cy);
    this.drawStrikes(X, Y);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '500 8.5px "Barlow Condensed", sans-serif';
    ctx.fillStyle = INK + '0.45)';
    ctx.fillText(cls.dcNote + ' · CLICK: SEND DAMAGE CONTROL', 4, h - 3);
  }

  private drawParties(s: Ship, X: (x: number) => number, Y: (y: number) => number, k: number, cy: number) {
    const ctx = this.ctx;
    s.dc.forEach((p, i) => {
      if (!p.task) return;
      let x: number, y: number;
      if (p.task.type === 'section') { const sec = s.sections[p.task.index]; if (!sec) return; x = X((sec.def.x0 + sec.def.x1) / 2); y = cy; }
      else { const m = s.modules.get(p.task.id); if (!m) return; x = X((m.def.rect.x0 + m.def.rect.x1) / 2); y = Y((m.def.rect.y0 + m.def.rect.y1) / 2); }
      // offset parties that share a spot
      y += (i - (s.dc.length - 1) / 2) * 7;
      const bob = Math.sin(this.t * 5 + i) * 0.8;
      ctx.beginPath(); ctx.arc(x, y + bob, 5, 0, TAU);
      ctx.fillStyle = p.manual ? 'rgba(255,214,120,0.95)' : 'rgba(150,230,190,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,14,18,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(6,14,18,0.95)'; ctx.font = '700 7.5px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + bob + 0.5);
    });
    void k;
  }

  private drawStrikes(X: (x: number) => number, Y: (y: number) => number) {
    const ctx = this.ctx;
    const FLY = 0.32, LIFE = 2.2;
    this.strikes = this.strikes.filter((st) => this.t - st.t0 < FLY + LIFE);
    for (const st of this.strikes) {
      const age = this.t - st.t0;
      const px = X(st.x), py = Y(st.y);
      const bad = st.kind === 'citadel' || st.kind === 'pen' || st.kind === 'he' || st.kind === 'overpen' || st.kind === 'underwater';
      const col = st.kind === 'citadel' ? '255,70,60' : bad ? '255,160,70' : '190,215,225';
      if (age < FLY) {
        // the shell streaking in, with a short tracer
        const u = age / FLY, reach = 46;
        const hx = px - st.dx * reach * (1 - u), hy = py - st.dy * reach * (1 - u);
        const g = ctx.createLinearGradient(hx - st.dx * 16, hy - st.dy * 16, hx, hy);
        g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.9)`);
        ctx.strokeStyle = g; ctx.lineWidth = 1.6 * st.size + 0.6;
        ctx.beginPath(); ctx.moveTo(hx - st.dx * 16, hy - st.dy * 16); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,245,220,1)';
        ctx.beginPath(); ctx.arc(hx, hy, 1.4 + st.size, 0, TAU); ctx.fill();
        continue;
      }
      const a = age - FLY, f = clamp01(1 - a / LIFE);
      if (st.kind === 'ricochet') {
        // glances off and skips away
        const u = Math.min(1, a / 0.4), rx = px + st.dx * 30 * u, ry = py - st.dy * 30 * u;
        if (u < 1) { ctx.fillStyle = `rgba(${col},${1 - u})`; ctx.beginPath(); ctx.arc(rx, ry, 1.6, 0, TAU); ctx.fill(); }
      }
      // shockwave ring and flash at the point of impact
      const ring = 3 + Math.min(1, a / 0.5) * (bad ? 14 : 8) * st.size;
      ctx.strokeStyle = `rgba(${col},${0.85 * f * f})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(px, py, ring, 0, TAU); ctx.stroke();
      if (a < 0.25) { ctx.fillStyle = `rgba(255,240,210,${1 - a / 0.25})`; ctx.beginPath(); ctx.arc(px, py, (bad ? 6 : 3.5) * st.size, 0, TAU); ctx.fill(); }
      // a penetrating shell carries on inside and bursts where its fuze fires
      if (st.det) {
        const dx = X(st.det.x), dy = Y(st.det.y), u = Math.min(1, a / 0.18);
        ctx.strokeStyle = `rgba(${col},${0.6 * f})`; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (dx - px) * u, py + (dy - py) * u); ctx.stroke(); ctx.setLineDash([]);
        if (u >= 1) {
          const b = a - 0.18;
          ctx.fillStyle = `rgba(${col},${0.75 * clamp01(1 - b / 0.6)})`;
          ctx.beginPath(); ctx.arc(dx, dy, (3 + Math.min(1, b / 0.3) * 7) * st.size, 0, TAU); ctx.fill();
        }
      }
      // a small marker lingers so you can see where it struck
      ctx.strokeStyle = `rgba(${col},${0.9 * f})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px - 3, py - 3); ctx.lineTo(px + 3, py + 3); ctx.moveTo(px + 3, py - 3); ctx.lineTo(px - 3, py + 3); ctx.stroke();
    }
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
      const patched = hle.area <= 0.02;
      const under = !patched && s.waterRise(hle.x) - hle.z > 0;
      ctx.fillStyle = patched ? 'rgba(150,160,165,0.6)' : under ? 'rgba(120,195,255,1)' : 'rgba(225,230,232,0.7)';
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
      const t = clamp01((z.belt - 20) / 380);
      const col = `rgba(${Math.round(90 + t * 150)},${Math.round(120 + t * 50)},${Math.round(135 - t * 80)},`;
      const x0 = Math.max(z.x0, -cls.length / 2), x1 = Math.min(z.x1, cls.length / 2);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 1.5) { const y = side * cls.halfBeam(x); x === x0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); }
        ctx.strokeStyle = col + '0.95)'; ctx.lineWidth = 1.5 + t * 4; ctx.stroke();
      }
      const mid = (x0 + x1) / 2, b = cls.halfBeam(mid);
      ctx.fillStyle = col + '0.16)';
      ctx.fillRect(X(x0), Y(-b), (x1 - x0) * k, b * 2 * k);
      if ((x1 - x0) * k > 24) {
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(240,246,248,0.95)';
        ctx.fillText(`${z.belt}${z.beltIncline ? '∠' : ''}`, X(mid), cy - 8);
        ctx.fillStyle = 'rgba(200,215,220,0.7)';
        ctx.fillText(z.slope ? `${z.deck}+${z.slope.thickness}⟋` : `${z.deck}`, X(mid), cy + 8);
      }
    }
    for (const t of s.turrets) {
      ctx.beginPath(); ctx.arc(X(t.def.x), Y(t.def.y), t.def.barbetteRadius * k, 0, TAU);
      ctx.fillStyle = 'rgba(240,120,80,0.95)'; ctx.fill(); ctx.strokeStyle = 'rgba(8,16,20,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      if (t.def.barbetteRadius * k > 6) {
        ctx.fillStyle = 'rgba(8,16,20,0.95)'; ctx.font = '600 7.5px "IBM Plex Mono", monospace';
        ctx.fillText(`${t.def.armor.barbette}`, X(t.def.x), Y(t.def.y));
      }
    }
    const ct = cls.structures.find((q) => q.conning);
    if (ct && ct.armor > 50) { ctx.fillStyle = 'rgba(240,120,80,0.95)'; ctx.fillRect(X(ct.rect.x0), Y(ct.rect.y0), (ct.rect.x1 - ct.rect.x0) * k, (ct.rect.y1 - ct.rect.y0) * k); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK + '0.55)';
    ctx.font = '500 8.5px "Barlow Condensed", sans-serif';
    ctx.fillText('ARMOUR mm · belt (∠ inclined) · deck (+ sloped ⟋) · barbettes · conning tower · V to return', 4, this.h - 3);
  }
}
