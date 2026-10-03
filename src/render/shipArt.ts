// Procedural top-down artwork for the Iowa class, rendered once to offscreen
// canvases: hull+deck sprite, shadow sprites, turret sprites. Built from the same
// class data the simulation uses so the art and the armour layout line up.

import type { ShipClass, TurretDef } from '../sim/shipClass';

export const ART_SCALE = 7; // sprite px per metre

export interface ShipArt {
  hull: HTMLCanvasElement;        // deck, superstructure, fittings (no main turrets)
  hullShadow: HTMLCanvasElement;  // hull silhouette for low shadow
  upperShadow: HTMLCanvasElement; // superstructure silhouette for long shadow
  turret: HTMLCanvasElement;      // gunhouse + barrels, turret local frame
  turretShadow: HTMLCanvasElement;
  originX: number; originY: number; // sprite px of local (0,0)
  turretOrigin: number;           // px of turret pivot in turret sprite (x and y)
  scale: number;
}

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface Livery { name: string; deck: string; deckLine: string; steel: string; steelDark: string; steelLight: string; hullEdge: string; camo: boolean }

export const LIVERIES: Record<'blue' | 'red', Livery> = {
  blue: { name: 'Measure 22', deck: '#a08a68', deckLine: 'rgba(60,44,28,0.22)', steel: '#8b969d', steelDark: '#5d686f', steelLight: '#b3bcc1', hullEdge: '#3a4a5c', camo: false },
  red: { name: 'Measure 32', deck: '#8f8166', deckLine: 'rgba(50,40,30,0.24)', steel: '#868d8f', steelDark: '#4a4f52', steelLight: '#b9bdbd', hullEdge: '#2b2f33', camo: true },
};

export function buildShipArt(cls: ShipClass, livery: Livery): ShipArt {
  const S = ART_SCALE;
  const pad = 30; // metres of padding for barrels and overhang
  const W = Math.ceil((cls.length + pad * 2) * S), H = Math.ceil((cls.beam + 20) * S);
  const ox = (cls.length / 2 + pad) * S, oy = H / 2;
  const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  const hull = mk(W, H);
  const ctx = hull.getContext('2d')!;
  ctx.translate(ox, oy);
  ctx.scale(S, S);

  const hullPath = new Path2D();
  cls.hull.forEach((p, i) => (i ? hullPath.lineTo(p.x, p.y) : hullPath.moveTo(p.x, p.y)));
  hullPath.closePath();

  // ------------------------------------------------ hull sides (flare visible from above)
  ctx.fillStyle = livery.hullEdge;
  ctx.fill(hullPath);
  // deck inset slightly
  const deckPath = new Path2D();
  const inset = 0.55;
  const pts = cls.hull.map((p) => { const ins = inset + Math.max(0, p.x - 55) / 80 * 0.9 + Math.max(0, -p.x - 110) / 25 * 0.4; return { x: p.x * (1 - 0.004) - 0.2, y: Math.sign(p.y) * Math.max(0, Math.abs(p.y) - ins) }; });
  pts.forEach((p, i) => (i ? deckPath.lineTo(p.x, p.y) : deckPath.moveTo(p.x, p.y)));
  deckPath.closePath();

  ctx.save();
  ctx.clip(deckPath);
  // teak deck with planking
  ctx.fillStyle = livery.deck;
  ctx.fillRect(-150, -20, 300, 40);
  // subtle tonal variation per plank strake
  for (let y = -17; y < 17; y += 0.26) {
    const k = Math.sin(y * 91.7) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(${k > 0.5 ? '255,240,210' : '40,25,10'},${0.025 + Math.abs(k - 0.5) * 0.05})`;
    ctx.fillRect(-150, y, 300, 0.24);
  }
  ctx.strokeStyle = livery.deckLine;
  ctx.lineWidth = 0.05;
  for (let y = -17; y < 17; y += 0.26) { ctx.beginPath(); ctx.moveTo(-150, y); ctx.lineTo(150, y); ctx.stroke(); }
  // butt joints
  ctx.strokeStyle = 'rgba(40,28,16,0.12)';
  for (let y = -17, i = 0; y < 17; y += 0.26, i++) {
    for (let x = -140 + (i % 5) * 1.6; x < 140; x += 8) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 0.26); ctx.stroke(); }
  }
  // steel deck areas (bow forecastle tip, around superstructure and fantail)
  ctx.fillStyle = 'rgba(75,82,88,0.85)';
  ctx.fillRect(116, -12, 30, 24);
  ctx.fillRect(-140, -20, 10, 40);
  // camouflage on the hull edge (Measure 32 dazzle)
  if (livery.camo) {
    ctx.globalAlpha = 0.5;
    const camo = ['#2a2e31', '#6e7679', '#2a2e31', '#9aa2a4'];
    for (let i = 0; i < 18; i++) {
      const x = -135 + i * 15;
      ctx.fillStyle = camo[i % 4];
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, sgn * 19); ctx.lineTo(x + 9, sgn * 19); ctx.lineTo(x + 15 + (i % 3) * 2, sgn * (cls.halfBeam(x + 10) - 1.4)); ctx.lineTo(x + 3, sgn * (cls.halfBeam(x) - 1.0));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // deck edge shading for roundness
  const g = ctx.createLinearGradient(0, -17, 0, 17);
  g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.12, 'rgba(0,0,0,0.0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g; ctx.fillRect(-150, -18, 300, 36);
  ctx.restore();

  // gunwale / deck edge highlight
  ctx.strokeStyle = 'rgba(225,230,232,0.55)';
  ctx.lineWidth = 0.22;
  ctx.stroke(deckPath);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 0.18;
  ctx.stroke(hullPath);

  const steel = livery.steel, dark = livery.steelDark, light = livery.steelLight;
  const block = (x0: number, x1: number, hw: number, r: number, fill: string, edge = 'rgba(0,0,0,0.45)', hi = 'rgba(255,255,255,0.25)') => {
    rr(ctx, x0, -hw, x1 - x0, hw * 2, r);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 0.18; ctx.strokeStyle = edge; ctx.stroke();
    // top-left highlight for height cue
    ctx.beginPath(); ctx.moveTo(x0 + r, -hw + 0.12); ctx.lineTo(x1 - r, -hw + 0.12);
    ctx.strokeStyle = hi; ctx.lineWidth = 0.25; ctx.stroke();
  };
  const circle = (x: number, y: number, r: number, fill: string, stroke = 'rgba(0,0,0,0.5)', lw = 0.15) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
  };

  // ------------------------------------------------ bow fittings
  // anchor chains from hawse pipes to windlass
  ctx.strokeStyle = 'rgba(30,30,30,0.85)'; ctx.lineWidth = 0.55; ctx.setLineDash([0.5, 0.35]);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(126, s * 2.2); ctx.lineTo(108, s * 2.4); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(124, 0); ctx.lineTo(108, 0.5); ctx.stroke();
  ctx.setLineDash([]);
  for (const s of [-1, 0, 1]) circle(106.5, s * 2.4, 1.0, dark);
  // breakwater
  ctx.strokeStyle = steel; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(92, -10.5); ctx.lineTo(97.5, 0); ctx.lineTo(92, 10.5); ctx.stroke();
  // bow 40mm quad tubs
  for (const s of [-1, 1]) { circle(101, s * 5.5, 2.4, dark); circle(101, s * 5.5, 1.7, '#4b5257'); quad(ctx, 101, s * 5.5, 0); }
  // jackstaff
  circle(133.2, 0, 0.35, '#ddd');
  // bollards & vents
  for (const x of [118, 112, 86, -96, -106, -118]) for (const s of [-1, 1]) {
    const hb = cls.halfBeam(x) - 1.3;
    rr(ctx, x - 0.6, s * hb - 0.4, 1.2, 0.8, 0.3); ctx.fillStyle = '#2d3236'; ctx.fill();
  }

  // ------------------------------------------------ barbettes (seen around turrets)
  for (const t of cls.turrets) circle(t.x, t.y, t.barbetteRadius + 0.6, dark, 'rgba(0,0,0,0.6)', 0.25);
  // T2 sits on a raised barbette with a wide base ring
  circle(50, 0, 8.6, steel, 'rgba(0,0,0,0.45)', 0.2);

  // ------------------------------------------------ superstructure
  // Each tier casts a soft ambient-occlusion halo on what lies beneath it, so
  // the stacked decks read as height without baking in a light direction.
  const tier = (x0: number, x1: number, hw: number, r: number, fill: string | CanvasGradient, ao = 10, taperFwd = 0) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = ao;
    ctx.beginPath();
    if (taperFwd > 0) {
      ctx.moveTo(x0 + r, -hw); ctx.lineTo(x1 - taperFwd, -hw); ctx.quadraticCurveTo(x1, -hw * 0.6, x1, 0);
      ctx.quadraticCurveTo(x1, hw * 0.6, x1 - taperFwd, hw); ctx.lineTo(x0 + r, hw);
      ctx.quadraticCurveTo(x0, hw, x0, hw - r); ctx.lineTo(x0, -hw + r); ctx.quadraticCurveTo(x0, -hw, x0 + r, -hw);
    } else ctx.roundRect(x0, -hw, x1 - x0, hw * 2, r);
    ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    // lit upper edge & railing
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.moveTo(x0 + r, -hw + 0.15); ctx.lineTo(x1 - Math.max(r, taperFwd), -hw + 0.15); ctx.stroke();
  };
  const g1 = (x0: number, x1: number, hw: number) => { const g = ctx.createLinearGradient(0, -hw, 0, hw); g.addColorStop(0, light); g.addColorStop(0.5, steel); g.addColorStop(1, dark); return g; };

  // 01 level: long deckhouse carrying the 5"/38 battery
  tier(-50, 38, 10.2, 1.8, g1(-50, 38, 10.2), 12, 4);
  // 5"/38 twin mounts along the sides (non-functional detail)
  for (const x of [27, 15, 3, -21, -33]) for (const sd of [-1, 1]) fiveInch(ctx, x, sd * 12.6, sd, steel, dark);
  // boat deck details: vents and lockers
  ctx.fillStyle = 'rgba(30,36,40,0.55)';
  for (let x = -46; x < 34; x += 4.2) for (const sd of [-1, 1]) ctx.fillRect(x, sd * 8.6 - 0.35, 2.2, 0.7);
  // 02 level forward
  tier(-3, 37, 7.8, 1.5, g1(-3, 37, 7.8), 10, 3);
  // conning tower (17.3" armour, oval)
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.ellipse(32.5, 0, 4.4, 4.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b757b'; ctx.fill(); ctx.restore();
  ctx.lineWidth = 0.22; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  ctx.strokeStyle = '#1b2023'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.ellipse(32.5, 0, 3.4, 3.6, 0, -0.9, 0.9); ctx.stroke();   // vision slits
  // navigating bridge & flag bridge, tapering upward
  tier(11, 31, 6.6, 1.3, g1(11, 31, 6.6), 9, 3);
  tier(14, 28.5, 5.2, 1.2, light, 8, 2.5);
  // fire-control tower top: Mk 38 director with its 26.5 ft rangefinder
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.roundRect(17.6, -3.6, 7.2, 7.2, 2.6); ctx.fillStyle = '#8a959a'; ctx.fill(); ctx.restore();
  ctx.lineWidth = 0.18; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(20.4, -4.9, 1.4, 9.8, 0.6); ctx.fill();
  ctx.fillStyle = '#c3cbcf'; ctx.fillRect(20.7, -1.1, 0.8, 2.2);
  // foremast with SK air-search mattress
  ctx.strokeStyle = '#262c30'; ctx.lineWidth = 0.32;
  ctx.beginPath(); ctx.moveTo(25.5, -6.2); ctx.lineTo(25.5, 6.2); ctx.moveTo(23.2, 0); ctx.lineTo(28, 0); ctx.stroke();
  ctx.save(); ctx.translate(26.6, 0);
  ctx.fillStyle = 'rgba(40,46,50,0.85)'; ctx.fillRect(-0.4, -3.2, 0.8, 6.4);
  ctx.strokeStyle = 'rgba(160,170,175,0.6)'; ctx.lineWidth = 0.08;
  for (let i = -3; i <= 3; i += 0.8) { ctx.beginPath(); ctx.moveTo(-0.4, i); ctx.lineTo(0.4, i); ctx.stroke(); }
  ctx.restore();
  // Mk 37 secondary directors (fore & aft)
  for (const x of [30.5, -30.5]) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.roundRect(x - 2.2, -2.4, 4.4, 4.8, 1.4); ctx.fillStyle = '#7f8a90'; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#2f373c'; ctx.fillRect(x - 0.3, -3.2, 0.6, 6.4);
  }
  // funnels (forward funnel faired into the tower)
  funnel(ctx, 6.5, 10.5, 7.2);
  funnel(ctx, -17.5, 10, 6.6);
  // boat cranes and boats between the funnels
  for (const sd of [-1, 1]) {
    boat(ctx, -5.5, sd * 6.6, 9.5, 2.7);
    ctx.save(); ctx.translate(-26, sd * 5.2); ctx.rotate(sd > 0 ? 0.55 : -0.55);
    ctx.fillStyle = '#4c555b'; ctx.fillRect(0, -0.45, 15, 0.9);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.1; ctx.strokeRect(0, -0.45, 15, 0.9);
    ctx.restore();
    circle(-26, sd * 5.2, 1.1, '#5b646a');
  }
  // aft superstructure & mainmast
  tier(-49, -33, 5.6, 1.2, g1(-49, -33, 5.6), 9);
  ctx.strokeStyle = '#262c30'; ctx.lineWidth = 0.32;
  ctx.beginPath(); ctx.moveTo(-28.5, -6.5); ctx.lineTo(-28.5, 6.5); ctx.stroke();
  // aft Mk 38 director
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.roundRect(-43.4, -3.2, 6.2, 6.4, 2.4); ctx.fillStyle = '#8a959a'; ctx.fill(); ctx.restore();
  ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(-41, -4.4, 1.3, 8.8, 0.6); ctx.fill();
  // 40mm quads on the superstructure
  for (const [x, y] of [[36, -7], [36, 7], [-1, -7.8], [-1, 7.8], [-46, -6.4], [-46, 6.4], [-36.5, -7], [-36.5, 7]]) {
    circle(x, y, 2.0, dark); quad(ctx, x, y, y > 0 ? 0.6 : -0.6);
  }
  // 40mm tubs fore and aft of turrets
  for (const [x, y] of [[-87, -11], [-87, 11], [-61, -12.5], [-61, 12.5]]) { circle(x, y, 2.3, dark); quad(ctx, x, y, 0); }
  // 20mm Oerlikons along the deck edge
  ctx.fillStyle = '#2b3135';
  for (let x = -120; x < 120; x += 5.5) {
    if (x > -50 && x < 40) continue;
    for (const s of [-1, 1]) { const hb = cls.halfBeam(x) - 1.6; if (hb > 4) { ctx.beginPath(); ctx.arc(x, s * hb, 0.45, 0, 7); ctx.fill(); } }
  }

  // ------------------------------------------------ fantail: catapults, crane, Kingfishers
  ctx.save();
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(-116, s * 7.5);
    ctx.rotate(s * 0.25 + Math.PI);
    ctx.fillStyle = '#4a5054'; ctx.fillRect(-1, -0.7, 22, 1.4);
    ctx.strokeStyle = '#2a2e30'; ctx.lineWidth = 0.12; ctx.strokeRect(-1, -0.7, 22, 1.4);
    circle(0, 0, 1.6, '#5a6064');
    ctx.restore();
  }
  kingfisher(ctx, -127, 7.8, Math.PI + 0.25);
  kingfisher(ctx, -110, -10.2, Math.PI - 0.15);
  // aircraft crane at the very stern
  circle(-131, 0, 1.8, dark);
  ctx.fillStyle = '#3a4246'; ctx.save(); ctx.translate(-131, 0); ctx.rotate(0.6); ctx.fillRect(0, -0.5, 14, 1.0); ctx.restore();
  ctx.restore();

  // weathering
  ctx.save(); ctx.clip(hullPath);
  for (let i = 0; i < 260; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 135, y = (Math.sin(i * 78.233) * 12345.678 % 1) * 16;
    ctx.fillStyle = `rgba(30,25,20,${0.03 + (i % 5) * 0.012})`;
    ctx.beginPath(); ctx.ellipse(x, y, 1.5 + (i % 7), 0.3 + (i % 3) * 0.2, 0, 0, 7); ctx.fill();
  }
  ctx.restore();

  // ------------------------------------------------ shadows
  const hullShadow = mk(W, H);
  {
    const c = hullShadow.getContext('2d')!;
    c.translate(ox, oy); c.scale(S, S);
    c.fillStyle = '#000'; c.fill(hullPath);
  }
  const upperShadow = mk(W, H);
  {
    const c = upperShadow.getContext('2d')!;
    c.translate(ox, oy); c.scale(S, S); c.fillStyle = '#000';
    const b = (x0: number, x1: number, hw: number) => { c.beginPath(); c.roundRect(x0, -hw, x1 - x0, hw * 2, 1.4); c.fill(); };
    b(-50, 38, 10.2); b(-3, 37, 7.8); b(11, 31, 6.6); b(14, 28.5, 5.2); b(17.6, 24.8, 3.6);
    c.beginPath(); c.ellipse(8, 0, 4.8, 3.2, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(-18, 0, 4.8, 3.0, 0, 0, 7); c.fill();
    c.fillRect(19, -6.5, 0.6, 13);
  }

  // ------------------------------------------------ turret sprite
  const tS = S, tR = 30; // half-size in metres of turret sprite
  const turret = mk(tR * 2 * tS, tR * 2 * tS);
  drawTurret(turret.getContext('2d')!, tR * tS, tS, livery, false);
  const turretShadow = mk(tR * 2 * tS, tR * 2 * tS);
  drawTurret(turretShadow.getContext('2d')!, tR * tS, tS, livery, true);

  return { hull, hullShadow, upperShadow, turret, turretShadow, originX: ox, originY: oy, turretOrigin: tR * tS, scale: S };
}

function quad(ctx: Ctx, x: number, y: number, rot: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#5c6367'; ctx.fillRect(-0.9, -0.9, 1.8, 1.8);
  ctx.strokeStyle = '#1d2124'; ctx.lineWidth = 0.22;
  for (const o of [-0.6, -0.2, 0.2, 0.6]) { ctx.beginPath(); ctx.moveTo(0.6, o); ctx.lineTo(2.6, o); ctx.stroke(); }
  ctx.restore();
}

function fiveInch(ctx: Ctx, x: number, y: number, side: number, steel: string, dark: string) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.roundRect(-2.6, -2.2, 5.2, 4.4, 1.6); ctx.fillStyle = steel; ctx.fill();
  ctx.lineWidth = 0.18; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-2, -2.0, 4, 0.35);
  ctx.strokeStyle = dark; ctx.lineWidth = 0.42;
  for (const o of [-0.8, 0.8]) { ctx.beginPath(); ctx.moveTo(2.4, o); ctx.lineTo(7.4, o); ctx.stroke(); }
  ctx.restore();
}

function funnel(ctx: Ctx, x: number, len: number, w: number) {
  ctx.save(); ctx.translate(x, 0);
  ctx.beginPath(); ctx.ellipse(0, 0, len / 2, w / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#7f898e'; ctx.fill(); ctx.lineWidth = 0.25; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 0, len / 2 - 0.9, w / 2 - 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#16191b'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,120,120,0.5)'; ctx.lineWidth = 0.12;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 0.95, -w / 2 + 1); ctx.lineTo(i * 0.95, w / 2 - 1); ctx.stroke(); }
  ctx.restore();
}

function boat(ctx: Ctx, x: number, y: number, l: number, w: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(-l / 2, -w / 2 + 0.4); ctx.quadraticCurveTo(l / 2 + 1, -w / 2, l / 2, 0); ctx.quadraticCurveTo(l / 2 + 1, w / 2, -l / 2, w / 2 - 0.4); ctx.closePath();
  ctx.fillStyle = '#9aa3a8'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.15; ctx.stroke();
  ctx.fillStyle = '#5b6266'; ctx.fillRect(-l / 4, -w / 4, l / 2.5, w / 2);
  ctx.restore();
}

function kingfisher(ctx: Ctx, x: number, y: number, rot: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#5f7381';
  ctx.beginPath(); ctx.ellipse(0, 0, 5, 0.65, 0, 0, 7); ctx.fill();           // fuselage
  ctx.beginPath(); ctx.roundRect(0.6, -5.8, 1.6, 11.6, 0.6); ctx.fill();         // wing
  ctx.beginPath(); ctx.roundRect(-4.6, -1.8, 0.9, 3.6, 0.3); ctx.fill();         // tailplane
  ctx.fillStyle = '#3d4b55'; ctx.beginPath(); ctx.ellipse(1.2, 0, 1.4, 0.4, 0, 0, 7); ctx.fill(); // float
  ctx.fillStyle = '#dfe6ea'; ctx.beginPath(); ctx.arc(1.4, -4.6, 0.45, 0, 7); ctx.arc(1.4, 4.6, 0.45, 0, 7); ctx.fill(); // roundels
  ctx.restore();
}

function drawTurret(ctx: Ctx, o: number, S: number, l: Livery, shadow: boolean) {
  ctx.translate(o, o);
  ctx.scale(S, S);
  const body = new Path2D();
  // gunhouse: sloped face plate forward (+x), long sides, rounded rear overhang
  body.moveTo(6.6, -5.2);
  body.lineTo(6.6, 5.2);
  body.lineTo(3.2, 6.6);
  body.lineTo(-6.4, 6.6);
  body.quadraticCurveTo(-8.6, 6.4, -8.8, 3.8);
  body.lineTo(-8.8, -3.8);
  body.quadraticCurveTo(-8.6, -6.4, -6.4, -6.6);
  body.lineTo(3.2, -6.6);
  body.closePath();
  // barrels
  const barrel = (y: number) => {
    const p = new Path2D();
    p.moveTo(5.6, y - 0.62); p.lineTo(25.5, y - 0.36); p.lineTo(26.6, y - 0.42); p.lineTo(26.6, y + 0.42); p.lineTo(25.5, y + 0.36); p.lineTo(5.6, y + 0.62); p.closePath();
    return p;
  };
  if (shadow) {
    ctx.fillStyle = '#000';
    ctx.fill(body);
    for (const y of [-2.6, 0, 2.6]) ctx.fill(barrel(y));
    // rangefinder ears
    ctx.fillRect(-5.4, -7.8, 2.2, 15.6);
    return;
  }
  for (const y of [-2.6, 0, 2.6]) {
    const b = barrel(y);
    const g = ctx.createLinearGradient(0, y - 0.6, 0, y + 0.6);
    g.addColorStop(0, '#9aa3a8'); g.addColorStop(0.45, '#6b7479'); g.addColorStop(1, '#3d4448');
    ctx.fillStyle = g; ctx.fill(b);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.1; ctx.stroke(b);
    // blast bag
    ctx.fillStyle = '#5b5f55'; ctx.fillRect(6.0, y - 0.85, 1.3, 1.7);
    // muzzle
    ctx.fillStyle = '#25292b'; ctx.fillRect(26.1, y - 0.25, 0.5, 0.5);
  }
  const g = ctx.createLinearGradient(-8, -6.6, 6, 6.6);
  g.addColorStop(0, l.steelLight); g.addColorStop(0.5, l.steel); g.addColorStop(1, l.steelDark);
  ctx.fillStyle = g; ctx.fill(body);
  ctx.lineWidth = 0.22; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke(body);
  // sloped face plate
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(6.6, -5.2); ctx.lineTo(6.6, 5.2); ctx.lineTo(4.8, 5.8); ctx.lineTo(4.8, -5.8); ctx.closePath(); ctx.fill();
  // rangefinder hoods (ears) at the rear
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.roundRect(-5.6, s > 0 ? 6.2 : -7.9, 2.4, 1.7, 0.6);
    ctx.fillStyle = l.steelDark; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.15; ctx.stroke();
  }
  // roof details: hatches, periscope hoods, vents, 40 mm quad on T3 style roof
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (const [x, y] of [[-1.5, -3.6], [-1.5, 3.6], [2.4, -1.5], [2.4, 1.5]]) { ctx.beginPath(); ctx.roundRect(x - 0.7, y - 0.55, 1.4, 1.1, 0.3); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-6.8, -0.3, 4.2, 0.6);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.08;
  ctx.beginPath(); ctx.moveTo(-8, -1.4); ctx.lineTo(4.5, -1.4); ctx.moveTo(-8, 1.4); ctx.lineTo(4.5, 1.4); ctx.stroke();
  // white identification number on roof is off for wartime; a small star of service flag stripe
  if (l.camo) { ctx.fillStyle = 'rgba(25,28,30,0.45)'; ctx.beginPath(); ctx.moveTo(-8.6, -3); ctx.lineTo(-2, -6.6); ctx.lineTo(1, -6.6); ctx.lineTo(-8.8, 1); ctx.closePath(); ctx.fill(); }
}

export function turretDefs(cls: ShipClass): TurretDef[] { return cls.turrets; }
