// Shell-vs-ship resolution: traces a falling shell through hull, superstructure,
// turrets and the armour scheme, decides penetration / fuzing, and applies damage
// to the internal modules, flooding and fires it actually reaches.

import { DEG, Vec2, clamp, pointInPolygon, rotate, sub } from '../core/math';
import { penetration, testPlate, ArmorTest } from './ballistics';
import type { ArmorZone, ShellDef, StructureDef } from './shipClass';
import type { Ship } from './ship';

export type HitKind = 'citadel' | 'pen' | 'overpen' | 'nonpen' | 'ricochet' | 'underwater' | 'he' | 'shatter';

export interface ModuleHit { id: string; name: string; dmg: number; before: number; after: number }

export interface HitReport {
  ship: Ship;
  kind: HitKind;
  plate: string;            // what was struck first
  armor?: ArmorTest;
  deck?: ArmorTest;         // second layer (armoured deck) if reached
  local: Vec2;              // impact point (local)
  z: number;
  det?: { x: number; y: number; z: number };
  modules: ModuleHit[];
  fire: boolean;
  flooding: boolean;
  magazineDetonation: boolean;
  text: string;             // short human explanation
}

interface ShellPath {
  L: Vec2;          // local landing point at waterline
  d: Vec2;          // local horizontal direction of travel (unit)
  tanF: number;     // tan of fall angle
  fall: number;
  v: number;        // striking velocity
  shell: ShellDef;
}

const STEP = 0.6;

function zoneAt(ship: Ship, x: number): ArmorZone {
  return ship.cls.zones.find((z) => x >= z.x0 && x < z.x1) ?? ship.cls.zones[0];
}

function inRect(p: Vec2, r: { x0: number; x1: number; y0: number; y1: number }, pad = 0) {
  return p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad;
}

interface Contact {
  s: number;               // path parameter (larger = earlier along the flight)
  type: 'side' | 'deck' | 'structure' | 'turret';
  p: Vec2; z: number;
  structure?: StructureDef;
  turret?: number;
  roof?: boolean;
}

/** Find the first thing the shell meets on this ship, or null. Returns path param s. */
export function traceContact(ship: Ship, path: ShellPath): Contact | null {
  const cls = ship.cls;
  const { L, d, tanF } = path;
  // start where the shell is 42 m up, or at the far edge of the ship bounding circle
  const sTop = 42 / tanF;
  const proj = -(L.x * d.x + L.y * d.y); // s at closest approach to origin
  const sA = Math.min(sTop, proj + 150), sB = Math.max(-30, proj - 150);
  if (sA < sB) return null;
  // quick reject
  const perp = Math.abs(L.x * d.y - L.y * d.x);
  if (perp > 150) return null;

  let prevIn = false, prevStruct: StructureDef | null = null, prevTur = -1;
  let first = true;
  const underwaterLimit = -14; // diving shells travel a short way underwater
  for (let s = sA; s >= sB; s -= STEP) {
    if (s < underwaterLimit) break;
    const p = { x: L.x - d.x * s, y: L.y - d.y * s };
    // above water: z = s*tanF; below: steeper, slows
    const z = s >= 0 ? s * tanF : s * Math.max(tanF, Math.tan(22 * DEG)) - ship.waterRise(p.x) * 0;
    const rise = ship.waterRise(p.x);
    const inHull = Math.abs(p.x) < cls.length / 2 + 1 && pointInPolygon(p, cls.hull);
    // turrets (cylinders)
    for (let i = 0; i < ship.turrets.length; i++) {
      const t = ship.turrets[i].def;
      const r = Math.hypot(p.x - t.x, p.y - t.y);
      if (r <= t.radius && z <= t.height - rise) {
        if (ship.mod(t.id).level === 3 && ship.status === 'exploded') continue;
        return { s, type: 'turret', p, z, turret: i, roof: prevTur === i && !first };
      }
    }
    prevTur = -1;
    for (let i = 0; i < ship.turrets.length; i++) {
      const t = ship.turrets[i].def;
      if (Math.hypot(p.x - t.x, p.y - t.y) <= t.radius) prevTur = i;
    }
    // superstructure blocks (tallest first wins because we check all)
    let hitS: StructureDef | null = null;
    for (const st of cls.structures) {
      if (inRect(p, st.rect) && z <= st.height - rise) { if (!hitS || st.height > hitS.height) hitS = st; }
    }
    if (hitS) return { s, type: 'structure', p, z, structure: hitS, roof: prevStruct === hitS && !first };
    prevStruct = null;
    for (const st of cls.structures) if (inRect(p, st.rect)) prevStruct = st;

    if (inHull) {
      const fb = cls.freeboard(p.x) - rise;
      if (!prevIn && !first) {
        // crossing the hull side
        if (z <= fb && z > -cls.draft + rise) return { s, type: 'side', p, z };
      }
      if (z <= fb && (prevIn || first)) {
        if (z >= -0.5) return { s, type: 'deck', p, z: fb };
        if (first) return { s, type: 'side', p, z };
      }
    }
    prevIn = inHull;
    first = false;
  }
  return null;
}

/** Outward normal (3D) of the hull side at local point p. */
function sideNormal(ship: Ship, p: Vec2, incline: number): [number, number, number] {
  const hb = ship.cls.halfBeam;
  const dh = (hb(p.x + 0.5) - hb(p.x - 0.5));
  const sgn = p.y >= 0 ? 1 : -1;
  let nx = -dh, ny = sgn;
  const l = Math.hypot(nx, ny);
  nx /= l; ny /= l;
  return [nx * Math.cos(incline), ny * Math.cos(incline), -Math.sin(incline)];
}

export interface DamageSink {
  damageModule(ship: Ship, id: string, amount: number, cause: string): ModuleHit | null;
  addHole(ship: Ship, x: number, y: number, z: number, area: number): void;
  startFire(ship: Ship, x: number, y: number, band: 'low' | 'high', intensity: number): boolean;
  detonateMagazine(ship: Ship, x: number): void;
  rnd(): number;
}

/** Resolve a shell that hit `ship` at `c`. */
export function resolveHit(ship: Ship, path: ShellPath, c: Contact, sink: DamageSink): HitReport {
  const { shell, d, tanF, fall } = path;
  const rnd = () => sink.rnd();
  const cos = Math.cos(fall), sin = Math.sin(fall);
  let dir: [number, number, number] = [d.x * cos, d.y * cos, -sin];
  let v = path.v;
  const rep: HitReport = { ship, kind: 'nonpen', plate: '', local: c.p, z: c.z, modules: [], fire: false, flooding: false, magazineDetonation: false, text: '' };
  const zone = zoneAt(ship, c.p.x);
  const rise = ship.waterRise(c.p.x);
  const isHE = shell.id === 'HC';

  const explodeAt = (x: number, y: number, z: number, band: 'low' | 'high', power: number, forward = true) => {
    rep.det = { x, y, z };
    const blastR = isHE ? 15 : 11;
    for (const m of ship.modules.values()) {
      const md = m.def;
      if (md.band !== band && !(band === 'high' && md.kind === 'turret')) continue;
      const r = md.rect;
      const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
      // vertical separation from spaces deep in the hull (magazines sit below the machinery flats)
      const dz = md.zTop !== undefined ? Math.max(0, z - md.zTop) * 1.6 : 0;
      let dd = Math.hypot(dx, dy, dz);
      let f = dd <= 0 ? 1 : Math.max(0, 1 - dd / blastR) * 0.7;
      // splinter cone continues along the shell's path
      if (forward && !isHE) {
        const cx = (r.x0 + r.x1) / 2 - x, cy = (r.y0 + r.y1) / 2 - y;
        const along = cx * d.x + cy * d.y, across = Math.abs(cx * d.y - cy * d.x);
        if (along > 0 && along < 22 && across < 6 + along * 0.4) f = Math.max(f, 0.38);
      }
      if (md.kind === 'turret' && band === 'high' && dd > 0) f *= 0.3; // armoured gunhouse shrugs off nearby blasts
      if (f <= 0) continue;
      const dmg = power * f * (0.75 + rnd() * 0.5);
      const h = sink.damageModule(ship, md.id, dmg, isHE ? 'HE' : 'AP');
      if (h) rep.modules.push(h);
      if (md.kind === 'magazine' && dd <= 0 && band === 'low') {
        const frac = Math.min(1, dmg / md.hp);
        const p = 0.015 + 0.12 * frac * frac;
        if (rnd() < p) { rep.magazineDetonation = true; sink.detonateMagazine(ship, x); }
      }
    }
    // fire
    const fc = shell.fireChance * (band === 'high' ? 1 : 0.55);
    if (rnd() < fc) { rep.fire = sink.startFire(ship, x, y, band, 0.6 + rnd() * 0.4) || rep.fire; }
    // holes from detonation near the waterline
    if (z < 2.5) { sink.addHole(ship, x, y, z + rise, isHE ? 1.1 : 1.5); rep.flooding = true; }
  };

  // ---------------------------------------------------- turrets
  if (c.type === 'turret') {
    const t = ship.turrets[c.turret!];
    const td = t.def;
    const tName = td.name;
    const turretFacing = td.facing + t.offset;
    let plate: number, normal: [number, number, number], label: string;
    const lowHit = c.z < td.height - rise - 4.5 && !c.roof;
    if (c.roof) {
      plate = td.armor.roof; normal = [0, 0, 1]; label = `${tName} roof`;
    } else if (lowHit) {
      plate = td.armor.barbette;
      const n = { x: c.p.x - td.x, y: c.p.y - td.y }; const l = Math.hypot(n.x, n.y) || 1;
      normal = [n.x / l, n.y / l, 0]; label = `${tName} barbette`;
    } else {
      const n = { x: c.p.x - td.x, y: c.p.y - td.y }; const l = Math.hypot(n.x, n.y) || 1;
      const a = Math.atan2(n.y, n.x) - turretFacing;
      const ca = Math.cos(a);
      plate = ca > 0.7 ? td.armor.face : ca < -0.6 ? td.armor.rear : td.armor.side;
      label = `${tName} ${ca > 0.7 ? 'face' : ca < -0.6 ? 'rear' : 'side'}`;
      normal = [n.x / l, n.y / l, 0];
    }
    const test = testPlate(plate, dir, normal, v, shell, rnd);
    rep.armor = test; rep.plate = label;
    if (test.result === 'pen') {
      rep.kind = 'pen';
      const h = sink.damageModule(ship, td.id, shell.burst * (isHE ? 0.8 : 1.35) * (0.85 + rnd() * 0.3), 'AP');
      if (h) rep.modules.push(h);
      if (rnd() < (isHE ? 0.1 : 0.4)) rep.fire = sink.startFire(ship, td.x, td.y, 'high', 0.7) || rep.fire;
      // flash down the hoists
      if (!isHE && rnd() < (lowHit ? 0.045 : 0.012)) { rep.magazineDetonation = true; sink.detonateMagazine(ship, td.x); }
      rep.text = `Penetrated ${label}`;
    } else {
      rep.kind = test.result === 'ricochet' ? 'ricochet' : 'nonpen';
      const h = sink.damageModule(ship, td.id, isHE ? 9 : 6, isHE ? 'HE' : 'AP');
      if (h) rep.modules.push(h);
      if (rnd() < 0.25) t.jam = 4 + rnd() * 6;
      rep.text = test.result === 'ricochet' ? `Ricochet off ${label}` : `${label} held`;
      if (isHE) rep.kind = 'he';
    }
    return rep;
  }

  // ---------------------------------------------------- superstructure
  if (c.type === 'structure') {
    const st = c.structure!;
    rep.plate = st.name;
    const normal: [number, number, number] = c.roof ? [0, 0, 1] : [-d.x, -d.y, 0];
    const test = testPlate(st.armor, dir, normal, v, shell, rnd);
    rep.armor = test;
    if (st.conning) {
      if (test.result === 'pen') {
        rep.kind = 'pen';
        const h = sink.damageModule(ship, 'bridge', shell.burst * 1.4, 'AP');
        if (h) rep.modules.push(h);
        rep.text = 'Penetrated conning tower';
      } else { rep.kind = test.result === 'ricochet' ? 'ricochet' : 'nonpen'; rep.text = 'Conning tower armour held'; }
      return rep;
    }
    if (isHE) {
      rep.kind = 'he';
      explodeAt(c.p.x, c.p.y, c.z, 'high', shell.burst * 0.9, false);
      if (st.module) { const h = sink.damageModule(ship, st.module, shell.burst * 0.6, 'HE'); if (h) rep.modules.push(h); }
      rep.text = `HE burst on ${st.name.toLowerCase()}`;
      return rep;
    }
    // AP through thin superstructure: fuze does not arm on light plating, shell passes through
    rep.kind = 'overpen';
    if (st.module) { const h = sink.damageModule(ship, st.module, 14 + rnd() * 10, 'AP'); if (h) rep.modules.push(h); }
    rep.text = `Overpenetration — ${st.name.toLowerCase()}`;
    if (rnd() < 0.08) rep.fire = sink.startFire(ship, c.p.x, c.p.y, 'high', 0.4) || rep.fire;
    return rep;
  }

  // ---------------------------------------------------- hull: side or deck
  let armed = false;
  let travel = 0;           // distance travelled since arming
  let fuzeDist = 0;
  let x = c.p.x, y = c.p.y, z = c.z;
  let belowArmorDeck = false;

  const arm = (eff: number, resid: number) => {
    if (armed) return;
    if (isHE || eff >= shell.armingThreshold) {
      armed = true; travel = 0;
      fuzeDist = isHE ? 0.8 : Math.max(3, resid * shell.fuzeDelay * (0.8 + rnd() * 0.4));
    }
  };
  const residual = (t: ArmorTest) => v * Math.sqrt(Math.max(0, 1 - Math.pow(t.effective / Math.max(1, t.pen), 2)));

  if (c.type === 'side') {
    const underwater = c.z < 0;
    let plate: number, label: string, incline = 0;
    if (c.z > zone.beltTop - rise) { plate = zone.upperSide; label = 'upper side plating'; }
    else if (c.z >= zone.beltBottom - rise) { plate = zone.belt; incline = zone.beltIncline; label = zone.citadel ? (zone.belt > 330 ? 'steering gear armour' : 'main belt') : 'bow/stern plating'; }
    else { plate = zone.lowerBelt; incline = zone.beltIncline; label = zone.citadel ? 'lower belt (below waterline)' : 'hull below waterline'; }
    if (underwater) v *= 0.7;
    const n = sideNormal(ship, c.p, incline);
    const test = testPlate(plate, dir, n, v, shell, rnd);
    rep.armor = test; rep.plate = label;
    if (underwater) rep.kind = 'underwater';
    if (test.result !== 'pen') {
      rep.kind = test.result === 'ricochet' ? 'ricochet' : 'nonpen';
      if (isHE) {
        rep.kind = 'he';
        // HE bursting on the armour: blast & splinters across the upper works
        if (c.z > 0) explodeAt(c.p.x, c.p.y * 0.85, c.z, 'high', shell.burst * 0.35, false);
        rep.text = `HE burst against ${label}`;
      } else {
        rep.text = test.result === 'ricochet' ? `Ricochet off ${label}` : `${label[0].toUpperCase() + label.slice(1)} held`;
      }
      if (underwater && plate < 200) { sink.addHole(ship, c.p.x, c.p.y, c.z + rise, 0.6); rep.flooding = true; }
      return rep;
    }
    // penetrated the side
    sink.addHole(ship, c.p.x, c.p.y, c.z + rise, underwater ? 1.3 : 0.5);
    if (c.z + rise < ship.waterRise(c.p.x) + 1.5) rep.flooding = true;
    arm(test.effective, residual(test));
    v = residual(test) * 0.98;
    belowArmorDeck = zone.citadel && c.z <= zone.beltTop - rise;
    rep.kind = underwater ? 'underwater' : 'pen';
  } else {
    // weather deck from above
    const test = testPlate(zone.weatherDeck, dir, [0, 0, 1], v, shell, rnd);
    rep.armor = test; rep.plate = 'weather deck';
    if (test.result !== 'pen') {
      rep.kind = test.result === 'ricochet' ? 'ricochet' : 'nonpen';
      if (isHE) { rep.kind = 'he'; explodeAt(c.p.x, c.p.y, c.z, 'high', shell.burst * 0.75, false); rep.text = 'HE burst on deck'; }
      else rep.text = test.result === 'ricochet' ? 'Ricochet off the deck' : 'Deck held';
      return rep;
    }
    arm(test.effective, residual(test));
    v = residual(test);
    rep.kind = 'pen';
    if (isHE) { explodeAt(c.p.x, c.p.y, c.z - 1, 'high', shell.burst * 0.9, false); rep.text = 'HE burst between decks'; return rep; }
  }

  if (armed && isHE) {
    // instantaneous fuze: bursts just behind the plate
    const band: 'low' | 'high' = belowArmorDeck ? 'low' : 'high';
    explodeAt(x + d.x * 1.5, y + d.y * 1.5, z, band, shell.burst * 0.85);
    rep.text = belowArmorDeck ? `HE penetrated ${rep.plate} — burst inside` : `HE burst behind ${rep.plate}`;
    return rep;
  }

  // march inside the hull
  const stepH = 0.8;
  const dz = -stepH * Math.max(tanF, 0.02) * (c.z < 0 ? 1.4 : 1);
  for (let i = 0; i < 400; i++) {
    x += d.x * stepH; y += d.y * stepH; z += dz;
    travel += Math.hypot(stepH, dz);
    const zn = zoneAt(ship, x);
    const r = ship.waterRise(x);
    const inside = pointInPolygon({ x, y }, ship.cls.hull);
    if (!inside || z < -ship.cls.draft + r) {
      // exited through the far side or the bottom
      rep.kind = rep.kind === 'underwater' ? 'underwater' : 'overpen';
      if (z < 0.5) { sink.addHole(ship, x, y, z + r, 0.45); rep.flooding = true; }
      // light damage along the path
      for (const m of ship.modules.values()) {
        if (m.def.band !== (belowArmorDeck ? 'low' : 'high')) continue;
        if (segmentHitsRect(c.p, { x, y }, m.def.rect)) { const h = sink.damageModule(ship, m.def.id, 10 + rnd() * 8, 'AP'); if (h) rep.modules.push(h); }
      }
      rep.text = `Overpenetration through ${rep.plate}`;
      return rep;
    }
    // armoured deck from above, inside the citadel
    if (!belowArmorDeck && zn.citadel && z <= zn.beltTop - r) {
      const test = testPlate(zn.deck, dir, [0, 0, 1], v, shell, rnd);
      rep.deck = test;
      if (test.result === 'pen') {
        belowArmorDeck = true;
        arm(test.effective, residual(test));
        v = residual(test);
      } else {
        // stopped on the armoured deck
        if (armed || test.effective >= shell.armingThreshold) {
          explodeAt(x, y, z + 0.5, 'high', shell.burst * 0.8, false);
          rep.kind = 'pen';
          rep.text = `Penetrated ${rep.plate}, stopped by armoured deck (${zn.deck} mm)`;
        } else {
          rep.kind = 'nonpen';
          rep.text = `Defeated by armoured deck (${zn.deck} mm)`;
        }
        return rep;
      }
    }
    // inner torpedo bulkheads for underwater hits
    if (armed) {
      if (travel >= fuzeDist) {
        const band: 'low' | 'high' = belowArmorDeck ? 'low' : 'high';
        explodeAt(x, y, z, band, shell.burst);
        if (belowArmorDeck && zn.citadel) { rep.kind = rep.kind === 'underwater' ? 'underwater' : 'citadel'; }
        const where = rep.modules.length ? rep.modules[0].name : (belowArmorDeck ? 'below the armoured deck' : 'between decks');
        rep.text = belowArmorDeck && zn.citadel ? `CITADEL — shell burst in ${where}` : `Penetration — burst in ${where}`;
        return rep;
      }
    }
  }
  rep.kind = 'overpen';
  rep.text = 'Overpenetration';
  return rep;
}

function segmentHitsRect(a: Vec2, b: Vec2, r: { x0: number; x1: number; y0: number; y1: number }) {
  for (let t = 0; t <= 1; t += 0.1) {
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }
  return false;
}

export function makePath(ship: Ship, landing: Vec2, dirWorld: Vec2, fall: number, v: number, shell: ShellDef): ShellPath {
  const L = rotate(sub(landing, ship.pos), -ship.heading);
  const d = rotate(dirWorld, -ship.heading);
  return { L, d, tanF: Math.tan(fall), fall, v, shell };
}

export { penetration, clamp };
