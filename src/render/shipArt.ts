// Procedural top-down artwork, rendered once per class & livery to offscreen
// canvases: hull+deck sprite, shadow sprites, turret sprites. Built from the same
// class data the simulation uses so the art and the armour layout line up.
// Iowa has a hand-tuned builder; every other class is drawn from its ArtSpec.

import type { ArtSpec, Nation, ShipClass } from '../sim/shipClass';
import type { TeamId } from '../sim/types';

export const ART_SCALE = 7; // sprite px per metre

export interface TurretSprite {
  house: HTMLCanvasElement;       // gunhouse, turret local frame
  barrels: HTMLCanvasElement;     // the guns (drawn separately: recoil & elevation)
  shadow: HTMLCanvasElement;
  origin: number;                 // px of turret pivot in the sprite (x and y)
  pivot: number;                  // m: where barrels start (recoil/foreshortening pivot)
}

export interface ShipArt {
  hull: HTMLCanvasElement;        // deck, superstructure, fittings (no main turrets)
  hullShadow: HTMLCanvasElement;  // hull silhouette for low shadow
  upperShadow: HTMLCanvasElement; // superstructure silhouette for long shadow
  originX: number; originY: number; // sprite px of local (0,0)
  scale: number;
  turrets: TurretSprite[];        // one per main turret (same order as cls.turrets)
  secondaries: TurretSprite[];    // one per secondary mount
  funnels: number[];              // local x of the funnels (smoke)
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

/** Paint schemes by navy; the team only switches US ships between their two 1944 measures. */
export function liveryFor(nation: Nation, team: TeamId): Livery {
  if (nation === 'us') return LIVERIES[team];
  if (nation === 'de') return team === 'blue'
    ? { name: 'Rheinübung grey', deck: '#a38d6b', deckLine: 'rgba(60,44,28,0.22)', steel: '#9ca2a5', steelDark: '#646b6f', steelLight: '#c3c8ca', hullEdge: '#4b5257', camo: false }
    : { name: 'Baltic camouflage', deck: '#9d8a6a', deckLine: 'rgba(60,44,28,0.22)', steel: '#979ea1', steelDark: '#5a6064', steelLight: '#c0c5c7', hullEdge: '#33383b', camo: true };
  return { name: 'Kure grey', deck: '#9c8664', deckLine: 'rgba(55,40,25,0.22)', steel: '#7c8386', steelDark: '#4c5255', steelLight: '#a4abae', hullEdge: '#3a3f42', camo: false };
}

const sprites = new Map<string, TurretSprite>();
/** Gunhouse sprites are shared between ships with the same mount. */
export function turretSprite(o: { radius: number; guns: number; barrel: number; spacing: number; style: ArtSpec['turret'] }, livery: Livery): TurretSprite {
  const key = `${o.radius}|${o.guns}|${o.barrel}|${o.spacing}|${o.style}|${livery.name}`;
  let s = sprites.get(key);
  if (s) return s;
  const S = ART_SCALE;
  const tR = Math.max(o.radius * 1.6, o.barrel + 2);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = Math.ceil(tR * 2 * S); return c; };
  const house = mk(), barrels = mk(), shadow = mk();
  drawTurret(house.getContext('2d')!, tR * S, S, livery, 'house', o);
  drawTurret(barrels.getContext('2d')!, tR * S, S, livery, 'barrels', o);
  drawTurret(shadow.getContext('2d')!, tR * S, S, livery, 'shadow', o);
  s = { house, barrels, shadow, origin: tR * S, pivot: o.radius * 0.78 };
  sprites.set(key, s);
  return s;
}

export function buildShipArt(cls: ShipClass, livery: Livery): ShipArt {
  const base = cls.art === 'iowa' ? buildIowaHull(cls, livery) : buildGenericHull(cls, cls.art, livery);
  const style = cls.art === 'iowa' ? 'us' : cls.art.turret;
  const turrets = cls.turrets.map((t) => turretSprite({ radius: t.radius, guns: t.guns, barrel: t.barrel, spacing: t.spacing, style }, livery));
  const secondaries = (cls.secondary?.mounts ?? []).map((m) => turretSprite({ radius: m.radius, guns: m.guns, barrel: m.barrel, spacing: m.radius * 0.45, style: m.radius > 3.2 ? style : 'dd' }, livery));
  const funnels = cls.art === 'iowa' ? [6.5, -23] : cls.art.funnels.map((f) => f.x);
  return { ...base, turrets, secondaries, funnels };
}

function buildIowaHull(cls: ShipClass, livery: Livery) {
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
  circle(cls.turrets[1].x, 0, 8.6, steel, 'rgba(0,0,0,0.45)', 0.2);

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
  tier(-50, 31.5, 10.2, 1.8, g1(-50, 31.5, 10.2), 12, 4);
  // 5"/38 mount base rings (the mounts themselves are drawn live: they train on targets)
  for (const x of [24, 12, 0, -24, -36]) for (const sd of [-1, 1]) circle(x, sd * 12.6, 2.9, dark, 'rgba(0,0,0,0.5)', 0.2);
  // boat deck details: vents and lockers
  ctx.fillStyle = 'rgba(30,36,40,0.55)';
  for (let x = -46; x < 28; x += 4.2) for (const sd of [-1, 1]) ctx.fillRect(x, sd * 8.6 - 0.35, 2.2, 0.7);
  // 02 level forward
  tier(-3, 29, 7.8, 1.5, g1(-3, 29, 7.8), 10, 3);
  // conning tower (17.3" armour, oval)
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.ellipse(25.2, 0, 4.0, 4.4, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b757b'; ctx.fill(); ctx.restore();
  ctx.lineWidth = 0.22; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  ctx.strokeStyle = '#1b2023'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.ellipse(25.2, 0, 3.0, 3.4, 0, -0.9, 0.9); ctx.stroke();   // vision slits
  // navigating bridge & flag bridge, tapering upward
  tier(8, 23.5, 6.6, 1.3, g1(8, 23.5, 6.6), 9, 3);
  tier(10.5, 21.5, 5.2, 1.2, light, 8, 2.5);
  // fire-control tower top: Mk 38 director with its 26.5 ft rangefinder
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.roundRect(13.5, -3.6, 7.0, 7.2, 2.6); ctx.fillStyle = '#8a959a'; ctx.fill(); ctx.restore();
  ctx.lineWidth = 0.18; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(16.3, -4.9, 1.4, 9.8, 0.6); ctx.fill();
  ctx.fillStyle = '#c3cbcf'; ctx.fillRect(16.6, -1.1, 0.8, 2.2);
  // foremast with SK air-search mattress
  ctx.strokeStyle = '#262c30'; ctx.lineWidth = 0.32;
  ctx.beginPath(); ctx.moveTo(21.4, -6.2); ctx.lineTo(21.4, 6.2); ctx.moveTo(19.4, 0); ctx.lineTo(23.6, 0); ctx.stroke();
  ctx.save(); ctx.translate(22.4, 0);
  ctx.fillStyle = 'rgba(40,46,50,0.85)'; ctx.fillRect(-0.4, -3.2, 0.8, 6.4);
  ctx.strokeStyle = 'rgba(160,170,175,0.6)'; ctx.lineWidth = 0.08;
  for (let i = -3; i <= 3; i += 0.8) { ctx.beginPath(); ctx.moveTo(-0.4, i); ctx.lineTo(0.4, i); ctx.stroke(); }
  ctx.restore();
  // Mk 37 secondary directors (fore & aft)
  for (const [x, y] of [[4.5, -6.6], [4.5, 6.6], [-46.5, 0]]) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.roundRect(x - 2.2, y - 2.4, 4.4, 4.8, 1.4); ctx.fillStyle = '#7f8a90'; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#2f373c'; ctx.fillRect(x - 0.3, y - 3.2, 0.6, 6.4);
  }
  // funnels (forward funnel faired into the tower)
  funnel(ctx, 6.5, 10.5, 7.2);
  funnel(ctx, -23, 10, 6.6);
  // boat cranes and boats between the funnels
  for (const sd of [-1, 1]) {
    boat(ctx, -9, sd * 6.6, 9.5, 2.7);
    ctx.save(); ctx.translate(-30, sd * 5.2); ctx.rotate(sd > 0 ? 0.55 : -0.55);
    ctx.fillStyle = '#4c555b'; ctx.fillRect(0, -0.45, 15, 0.9);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.1; ctx.strokeRect(0, -0.45, 15, 0.9);
    ctx.restore();
    circle(-30, sd * 5.2, 1.1, '#5b646a');
  }
  // aft superstructure & mainmast
  tier(-49, -33, 5.6, 1.2, g1(-49, -33, 5.6), 9);
  ctx.strokeStyle = '#262c30'; ctx.lineWidth = 0.32;
  ctx.beginPath(); ctx.moveTo(-32.5, -6.5); ctx.lineTo(-32.5, 6.5); ctx.stroke();
  // aft Mk 38 director
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.roundRect(-43.4, -3.2, 6.2, 6.4, 2.4); ctx.fillStyle = '#8a959a'; ctx.fill(); ctx.restore();
  ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(-41, -4.4, 1.3, 8.8, 0.6); ctx.fill();
  // 40mm quads on the superstructure
  for (const [x, y] of [[29.5, -8], [29.5, 8], [-1, -7.8], [-1, 7.8], [-46, -6.4], [-46, 6.4], [-36.5, -7], [-36.5, 7]]) {
    circle(x, y, 2.0, dark); quad(ctx, x, y, y > 0 ? 0.6 : -0.6);
  }
  // 40mm tubs fore and aft of turrets
  for (const [x, y] of [[-79, -10.5], [-79, 10.5], [-52, -12.8], [-52, 12.8]]) { circle(x, y, 2.3, dark); quad(ctx, x, y, 0); }
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
    b(-50, 31.5, 10.2); b(-3, 29, 7.8); b(8, 23.5, 6.6); b(10.5, 21.5, 5.2); b(13.5, 20.5, 3.6);
    c.beginPath(); c.ellipse(6.5, 0, 5.2, 3.6, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(-23, 0, 5.0, 3.3, 0, 0, 7); c.fill();
    c.fillRect(19, -6.5, 0.6, 13);
  }

  return { hull, hullShadow, upperShadow, originX: ox, originY: oy, scale: S };
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

/** Gunhouse outline (local, + = muzzle direction) for each navy's style, scaled by the turret radius. */
function turretOutline(style: ArtSpec['turret'], r: number): Path2D {
  const p = new Path2D();
  const P = (pts: [number, number][]) => { pts.forEach(([x, y], i) => (i ? p.lineTo(x * r, y * r) : p.moveTo(x * r, y * r))); p.closePath(); };
  if (style === 'de') {
    // Bismarck: slab-sided box, flat face, chamfered corners
    P([[0.95, -0.74], [0.95, 0.74], [0.72, 0.95], [-1.02, 0.95], [-1.14, 0.8], [-1.14, -0.8], [-1.02, -0.95], [0.72, -0.95]]);
  } else if (style === 'jp') {
    // Yamato / Takao: narrow sloped face, long rounded rear
    p.moveTo(0.86 * r, -0.5 * r); p.lineTo(0.86 * r, 0.5 * r); p.lineTo(0.32 * r, 0.96 * r); p.lineTo(-0.85 * r, 0.98 * r);
    p.quadraticCurveTo(-1.3 * r, 0.9 * r, -1.32 * r, 0.45 * r); p.lineTo(-1.32 * r, -0.45 * r);
    p.quadraticCurveTo(-1.3 * r, -0.9 * r, -0.85 * r, -0.98 * r); p.lineTo(0.32 * r, -0.96 * r); p.closePath();
  } else if (style === 'dd') {
    // enclosed destroyer / dual-purpose mount: rounded shield
    p.moveTo(0.8 * r, -0.62 * r); p.lineTo(0.8 * r, 0.62 * r); p.lineTo(0.25 * r, 0.96 * r); p.lineTo(-0.7 * r, 0.9 * r);
    p.quadraticCurveTo(-1.08 * r, 0.7 * r, -1.08 * r, 0); p.quadraticCurveTo(-1.08 * r, -0.7 * r, -0.7 * r, -0.9 * r); p.lineTo(0.25 * r, -0.96 * r); p.closePath();
  } else {
    // US: sloped face plate, long sides, rounded rear overhang (Iowa geometry at r = 7.2)
    p.moveTo(0.92 * r, -0.72 * r); p.lineTo(0.92 * r, 0.72 * r); p.lineTo(0.44 * r, 0.92 * r); p.lineTo(-0.89 * r, 0.92 * r);
    p.quadraticCurveTo(-1.19 * r, 0.89 * r, -1.22 * r, 0.53 * r); p.lineTo(-1.22 * r, -0.53 * r);
    p.quadraticCurveTo(-1.19 * r, -0.89 * r, -0.89 * r, -0.92 * r); p.lineTo(0.44 * r, -0.92 * r); p.closePath();
  }
  return p;
}

function drawTurret(ctx: Ctx, o: number, S: number, l: Livery, mode: 'shadow' | 'barrels' | 'house', spec: { radius: number; guns: number; barrel: number; spacing: number; style: ArtSpec['turret'] }) {
  const shadow = mode === 'shadow';
  const r = spec.radius;
  ctx.translate(o, o);
  ctx.scale(S, S);
  const body = turretOutline(spec.style, r);
  const bw = Math.min(0.62, Math.max(0.16, r * 0.086));   // barrel half-width
  const b0 = r * 0.78;
  const barrel = (y: number) => {
    const p = new Path2D();
    const L = spec.barrel;
    p.moveTo(b0, y - bw); p.lineTo(L - 1.1, y - bw * 0.58); p.lineTo(L, y - bw * 0.68); p.lineTo(L, y + bw * 0.68); p.lineTo(L - 1.1, y + bw * 0.58); p.lineTo(b0, y + bw); p.closePath();
    return p;
  };
  const ys = Array.from({ length: spec.guns }, (_, g) => (g - (spec.guns - 1) / 2) * spec.spacing);
  const ears = r > 4 && spec.style !== 'dd';
  if (shadow) {
    ctx.fillStyle = '#000';
    ctx.fill(body);
    for (const y of ys) ctx.fill(barrel(y));
    if (ears) ctx.fillRect(-0.75 * r, -1.08 * r, 0.3 * r, 2.16 * r);
    return;
  }
  if (mode === 'barrels') {
    for (const y of ys) {
      const b = barrel(y);
      const g = ctx.createLinearGradient(0, y - bw, 0, y + bw);
      g.addColorStop(0, '#9aa3a8'); g.addColorStop(0.45, '#6b7479'); g.addColorStop(1, '#3d4448');
      ctx.fillStyle = g; ctx.fill(b);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(0.04, bw * 0.16); ctx.stroke(b);
      // blast bag & muzzle
      ctx.fillStyle = '#5b5f55'; ctx.fillRect(b0 + 0.4, y - bw * 1.35, Math.max(0.5, r * 0.18), bw * 2.7);
      ctx.fillStyle = '#25292b'; ctx.fillRect(spec.barrel - 0.5, y - bw * 0.4, 0.5, bw * 0.8);
    }
    return;
  }
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, l.steelLight); g.addColorStop(0.5, l.steel); g.addColorStop(1, l.steelDark);
  ctx.fillStyle = g; ctx.fill(body);
  ctx.lineWidth = Math.max(0.08, r * 0.03); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke(body);
  // face plate highlight
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0.66 * r, -0.72 * r, 0.25 * r, 1.44 * r);
  if (ears) {
    // rangefinder hoods at the rear sides
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.roundRect(-0.78 * r, s > 0 ? 0.86 * r : -1.1 * r, 0.33 * r, 0.24 * r, 0.08 * r);
      ctx.fillStyle = l.steelDark; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.15; ctx.stroke();
    }
  }
  // roof details: hatches, periscope hoods, vents
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (const [x, y] of [[-0.21, -0.5], [-0.21, 0.5], [0.33, -0.21], [0.33, 0.21]]) { ctx.beginPath(); ctx.roundRect((x - 0.1) * r, (y - 0.08) * r, 0.2 * r, 0.15 * r, 0.04 * r); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-0.94 * r, -0.04 * r, 0.58 * r, 0.08 * r);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(0.04, r * 0.011);
  ctx.beginPath(); ctx.moveTo(-1.1 * r, -0.19 * r); ctx.lineTo(0.62 * r, -0.19 * r); ctx.moveTo(-1.1 * r, 0.19 * r); ctx.lineTo(0.62 * r, 0.19 * r); ctx.stroke();
  if (l.camo) { ctx.fillStyle = 'rgba(25,28,30,0.45)'; ctx.beginPath(); ctx.moveTo(-1.19 * r, -0.42 * r); ctx.lineTo(-0.28 * r, -0.92 * r); ctx.lineTo(0.14 * r, -0.92 * r); ctx.lineTo(-1.22 * r, 0.14 * r); ctx.closePath(); ctx.fill(); }
}

// ------------------------------------------------------------------ generic builder
function buildGenericHull(cls: ShipClass, spec: ArtSpec, livery: Livery) {
  const S = ART_SCALE;
  const pad = Math.max(12, cls.length * 0.11);
  const half = cls.length / 2, hbMax = cls.beam / 2;
  const W = Math.ceil((cls.length + pad * 2) * S), H = Math.ceil((cls.beam + 20) * S);
  const ox = (half + pad) * S, oy = H / 2;
  const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hull = mk(W, H);
  const ctx = hull.getContext('2d')!;
  ctx.translate(ox, oy);
  ctx.scale(S, S);
  const small = cls.type === 'DD';

  const hullPath = new Path2D();
  cls.hull.forEach((p, i) => (i ? hullPath.lineTo(p.x, p.y) : hullPath.moveTo(p.x, p.y)));
  hullPath.closePath();
  ctx.fillStyle = livery.hullEdge;
  ctx.fill(hullPath);
  const deckPath = new Path2D();
  const inset = small ? 0.3 : 0.5;
  cls.hull.forEach((p, i) => {
    const q = { x: p.x * 0.997, y: Math.sign(p.y) * Math.max(0, Math.abs(p.y) - inset - Math.max(0, p.x - half * 0.6) / half * 0.6) };
    i ? deckPath.lineTo(q.x, q.y) : deckPath.moveTo(q.x, q.y);
  });
  deckPath.closePath();

  ctx.save();
  ctx.clip(deckPath);
  // deck covering
  const deckCol = spec.deck === 'teak' ? livery.deck : spec.deck === 'linoleum' ? '#7d5f4a' : '#6f777b';
  ctx.fillStyle = deckCol;
  ctx.fillRect(-half - 2, -hbMax - 2, cls.length + 4, cls.beam + 4);
  if (spec.deck === 'teak') {
    for (let y = -hbMax; y < hbMax; y += 0.26) {
      const k = Math.sin(y * 91.7) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(${k > 0.5 ? '255,240,210' : '40,25,10'},${0.025 + Math.abs(k - 0.5) * 0.05})`;
      ctx.fillRect(-half, y, cls.length, 0.24);
    }
    ctx.strokeStyle = livery.deckLine; ctx.lineWidth = 0.05;
    for (let y = -hbMax; y < hbMax; y += 0.26) { ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(40,28,16,0.12)';
    for (let y = -hbMax, i = 0; y < hbMax; y += 0.26, i++) for (let x = -half + (i % 5) * 1.6; x < half; x += 8) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 0.26); ctx.stroke(); }
    // steel areas at the extremities
    ctx.fillStyle = 'rgba(75,82,88,0.85)';
    ctx.fillRect(half - cls.length * 0.07, -hbMax, cls.length * 0.08, cls.beam);
  } else {
    // painted steel / linoleum with brass strips: transverse seams
    ctx.strokeStyle = spec.deck === 'linoleum' ? 'rgba(200,170,110,0.35)' : 'rgba(30,35,38,0.35)';
    ctx.lineWidth = spec.deck === 'linoleum' ? 0.12 : 0.07;
    for (let x = -half; x < half; x += spec.deck === 'linoleum' ? 1.8 : 2.4) { ctx.beginPath(); ctx.moveTo(x, -hbMax); ctx.lineTo(x, hbMax); ctx.stroke(); }
    for (let i = 0; i < 90; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * half, y = (Math.sin(i * 78.233) * 12345.678 % 1) * hbMax;
      ctx.fillStyle = `rgba(0,0,0,${0.03 + (i % 4) * 0.012})`;
      ctx.fillRect(x, y, 2 + (i % 5), 0.6 + (i % 3) * 0.3);
    }
  }
  if (livery.camo) {
    ctx.globalAlpha = 0.5;
    const camo = ['#2a2e31', '#6e7679', '#2a2e31', '#9aa2a4'];
    const step = cls.length / 18;
    for (let i = 0; i < 18; i++) {
      const x = -half + 2 + i * step;
      ctx.fillStyle = camo[i % 4];
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, sgn * (hbMax + 2)); ctx.lineTo(x + step * 0.6, sgn * (hbMax + 2)); ctx.lineTo(x + step + (i % 3) * 0.13 * step, sgn * (cls.halfBeam(x + step * 0.66) - hbMax * 0.09)); ctx.lineTo(x + step * 0.2, sgn * (cls.halfBeam(x) - hbMax * 0.06));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  const g = ctx.createLinearGradient(0, -hbMax, 0, hbMax);
  g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.12, 'rgba(0,0,0,0.0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g; ctx.fillRect(-half - 2, -hbMax - 1, cls.length + 4, cls.beam + 2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(225,230,232,0.55)'; ctx.lineWidth = small ? 0.12 : 0.2; ctx.stroke(deckPath);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.16; ctx.stroke(hullPath);

  const steel = livery.steel, dark = livery.steelDark, light = livery.steelLight;
  const circle = (x: number, y: number, rad: number, fill: string, stroke = 'rgba(0,0,0,0.5)', lw = 0.15) => {
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
  };

  // ---- bow fittings: anchor cables, windlass, breakwater
  const bowX = half;
  ctx.strokeStyle = 'rgba(30,30,30,0.85)'; ctx.lineWidth = small ? 0.3 : 0.5; ctx.setLineDash([0.45, 0.32]);
  const chainA = bowX - (small ? 4 : 9), chainB = bowX - cls.length * (small ? 0.12 : 0.1);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(chainA, s * hbMax * 0.14); ctx.lineTo(chainB, s * hbMax * 0.15); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const s of [-1, 1]) circle(chainB - 1, s * hbMax * 0.15, small ? 0.5 : 0.9, dark);
  if (spec.breakwater) {
    const bw = cls.halfBeam(spec.breakwater) * 0.7;
    ctx.strokeStyle = steel; ctx.lineWidth = small ? 0.35 : 0.6;
    ctx.beginPath(); ctx.moveTo(spec.breakwater - 5, -bw); ctx.lineTo(spec.breakwater, 0); ctx.lineTo(spec.breakwater - 5, bw); ctx.stroke();
  }
  circle(half - 1.2, 0, small ? 0.2 : 0.35, '#ddd');
  // bollards along the deck edge
  for (let i = 0; i < 8; i++) {
    const x = -half + 6 + (i / 7) * (cls.length - 14);
    if (Math.abs(x) < cls.length * 0.3) continue;
    for (const s of [-1, 1]) { const hb = cls.halfBeam(x) - (small ? 0.7 : 1.3); if (hb < 1) continue; rr(ctx, x - 0.5, s * hb - 0.35, 1, 0.7, 0.25); ctx.fillStyle = '#2d3236'; ctx.fill(); }
  }
  // ---- barbettes
  for (const t of cls.turrets) circle(t.x, t.y, t.barbetteRadius + 0.5, dark, 'rgba(0,0,0,0.6)', small ? 0.15 : 0.25);
  for (const m of cls.secondary?.mounts ?? []) circle(m.x, m.y, m.radius * 1.05, dark, 'rgba(0,0,0,0.5)', 0.15);

  // ---- catapults, aircraft & boats (under the superstructure tiers)
  for (const c of spec.catapults ?? []) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    ctx.fillStyle = '#4a5054'; ctx.fillRect(-1, -0.7, c.len, 1.4);
    ctx.strokeStyle = '#2a2e30'; ctx.lineWidth = 0.12; ctx.strokeRect(-1, -0.7, c.len, 1.4);
    circle(0, 0, 1.6, '#5a6064');
    ctx.restore();
  }
  for (const a of spec.aircraft ?? []) kingfisher(ctx, a.x, a.y, a.rot);

  // ---- superstructure
  const shade = (x0: number, x1: number, hw: number, tone: 'steel' | 'light' | 'dark' = 'steel') => {
    const gr = ctx.createLinearGradient(0, -hw, 0, hw);
    const top = tone === 'light' ? light : tone === 'dark' ? steel : light;
    const mid = tone === 'light' ? light : tone === 'dark' ? dark : steel;
    gr.addColorStop(0, top); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark);
    void x0; void x1;
    return gr;
  };
  const blockPath = (b: ArtSpec['blocks'][number]) => {
    const r = Math.min(b.r ?? 1.2, b.hw * 0.9, (b.x1 - b.x0) / 2), y = b.y ?? 0, taper = Math.min(b.taper ?? 0, (b.x1 - b.x0) / 2);
    const p = new Path2D();
    if (taper > 0) {
      const { x0, x1, hw } = b;
      p.moveTo(x0 + r, y - hw); p.lineTo(x1 - taper, y - hw); p.quadraticCurveTo(x1, y - hw * 0.6, x1, y);
      p.quadraticCurveTo(x1, y + hw * 0.6, x1 - taper, y + hw); p.lineTo(x0 + r, y + hw);
      p.quadraticCurveTo(x0, y + hw, x0, y + hw - r); p.lineTo(x0, y - hw + r); p.quadraticCurveTo(x0, y - hw, x0 + r, y - hw);
    } else p.roundRect(b.x0, y - b.hw, b.x1 - b.x0, b.hw * 2, r);
    return p;
  };
  spec.blocks.forEach((b, i) => {
    const p = blockPath(b);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = (small ? 4 : 10) * (i === 0 ? 1.2 : 1);
    ctx.fillStyle = shade(b.x0, b.x1, b.hw, b.tone); ctx.fill(p);
    ctx.restore();
    ctx.lineWidth = small ? 0.1 : 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke(p);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = small ? 0.1 : 0.18;
    const y = b.y ?? 0;
    ctx.beginPath(); ctx.moveTo(b.x0 + 1, y - b.hw + 0.15); ctx.lineTo(b.x1 - Math.max(1, b.taper ?? 0), y - b.hw + 0.15); ctx.stroke();
    // vents & lockers on the lowest deckhouse
    if (i === 0 && !small) {
      ctx.fillStyle = 'rgba(30,36,40,0.45)';
      for (let x = b.x0 + 3; x < b.x1 - 4; x += 4.2) for (const sd of [-1, 1]) ctx.fillRect(x, y + sd * b.hw * 0.78 - 0.3, 2, 0.6);
    }
  });
  for (const bt of spec.boats ?? []) {
    ctx.save(); ctx.translate(bt.x, bt.y);
    ctx.beginPath(); ctx.moveTo(-bt.l / 2, -bt.w / 2 + 0.4); ctx.quadraticCurveTo(bt.l / 2 + 1, -bt.w / 2, bt.l / 2, 0); ctx.quadraticCurveTo(bt.l / 2 + 1, bt.w / 2, -bt.l / 2, bt.w / 2 - 0.4); ctx.closePath();
    ctx.fillStyle = '#9aa3a8'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.15; ctx.stroke();
    ctx.fillStyle = '#5b6266'; ctx.fillRect(-bt.l / 4, -bt.w / 4, bt.l / 2.5, bt.w / 2);
    ctx.restore();
  }
  // directors with their rangefinder arms
  for (const d of spec.directors) {
    const y = d.y ?? 0;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = small ? 3 : 8;
    ctx.beginPath(); ctx.roundRect(d.x - d.l / 2, y - d.w / 2, d.l, d.w, Math.min(d.l, d.w) * 0.35); ctx.fillStyle = '#8a959a'; ctx.fill(); ctx.restore();
    ctx.lineWidth = 0.14; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    if (d.rf) { ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(d.x - 0.6, y - d.rf / 2, 1.2, d.rf, 0.5); ctx.fill(); }
  }
  for (const f of spec.funnels) funnel(ctx, f.x, f.len, f.w);
  // masts
  ctx.strokeStyle = '#262c30'; ctx.lineWidth = small ? 0.18 : 0.3;
  for (const m of spec.masts) { ctx.beginPath(); ctx.moveTo(m.x, -m.span / 2); ctx.lineTo(m.x, m.span / 2); ctx.moveTo(m.x - 1.4, 0); ctx.lineTo(m.x + 1.4, 0); ctx.stroke(); }
  // light AA
  for (const [x, y] of spec.aa) { circle(x, y, small ? 1.1 : 1.9, dark); quad(ctx, x, y, y > 0 ? 0.6 : -0.6); }

  // weathering
  ctx.save(); ctx.clip(hullPath);
  for (let i = 0; i < Math.round(cls.length * 0.9); i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * half, y = (Math.sin(i * 78.233) * 12345.678 % 1) * hbMax;
    ctx.fillStyle = `rgba(30,25,20,${0.03 + (i % 5) * 0.012})`;
    ctx.beginPath(); ctx.ellipse(x, y, (1.5 + (i % 7)) * (small ? 0.5 : 1), 0.3 + (i % 3) * 0.2, 0, 0, 7); ctx.fill();
  }
  ctx.restore();

  // ---- shadows
  const hullShadow = mk(W, H);
  { const c = hullShadow.getContext('2d')!; c.translate(ox, oy); c.scale(S, S); c.fillStyle = '#000'; c.fill(hullPath); }
  const upperShadow = mk(W, H);
  {
    const c = upperShadow.getContext('2d')!;
    c.translate(ox, oy); c.scale(S, S); c.fillStyle = '#000';
    for (const b of spec.blocks) c.fill(blockPath(b));
    for (const f of spec.funnels) { c.beginPath(); c.ellipse(f.x, 0, f.len / 2, f.w / 2, 0, 0, 7); c.fill(); }
    for (const m of spec.masts) c.fillRect(m.x - 0.3, -m.span / 2, 0.6, m.span);
  }
  return { hull, hullShadow, upperShadow, originX: ox, originY: oy, scale: S };
}

