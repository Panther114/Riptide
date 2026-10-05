// The battle simulation. Owns ships, shells, torpedoes, smoke and terrain, steps
// physics and emits events for presentation (renderer, HUD, audio). Nothing here
// touches the DOM, so the same code can later run authoritative on a server.

import { Rng, Vec2, angleOf, dist, fromAngle, norm, sub, TAU, clamp, add, scale, rotate, toLocal, pointInPolygon, wrapAngle, angleDiff } from '../core/math';
import { flightTime, fallAngle, strikeVelocity, apexHeight, R50 } from './ballistics';
import { traceContact, resolveHit, resolveTorpedo, makePath, HitReport, DamageSink, ModuleHit } from './damage';
import { Ship, SecondaryState, levelFor } from './ship';
import { SHIP_CLASSES, ShellDef, TorpedoDef } from './shipClass';
import type { AmmoType, BattleConfig, Conditions, TeamId } from './types';
import { STATE_NAMES } from './types';
import { Island, coastDistance, generateIslands, landBlocks, onLand } from './terrain';

export interface Shell {
  id: number;
  shooter: number;
  team: TeamId;
  shell: ShellDef;
  origin: Vec2;
  target: Vec2;          // landing point at the waterline
  t: number;             // elapsed
  T: number;             // total flight time
  apex: number;
  fall: number;
  v: number;
  salvo: number;
  aimPoint: Vec2;
  secondary?: boolean;
}

export interface Torpedo {
  id: number;
  shooter: number;
  team: TeamId;
  def: TorpedoDef;
  pos: Vec2;
  heading: number;
  speed: number;         // m/s for the setting it was launched at
  range: number;         // m
  run: number;           // metres run so far
  t: number;
}

export interface SmokePuff { id: number; x: number; y: number; r: number; t: number; life: number; owner: number }

export interface Contact { pos: Vec2; heading: number; speed: number; t: number }

export type WorldEvent =
  | { type: 'fire'; ship: Ship; turret: number; pos: Vec2; bearing: number; guns: number; ammo: AmmoType }
  | { type: 'secFire'; ship: Ship; pos: Vec2; bearing: number; guns: number; caliber: number }
  | { type: 'splash'; pos: Vec2; shell: Shell; near: Ship | null; nearDist: number }
  | { type: 'landHit'; pos: Vec2; shell: Shell }
  | { type: 'hit'; report: HitReport; shell: Shell; pos: Vec2 }
  | { type: 'torpLaunch'; ship: Ship; pos: Vec2; bearing: number; count: number }
  | { type: 'torpHit'; report: HitReport; torpedo: Torpedo; pos: Vec2 }
  | { type: 'torpEnd'; torpedo: Torpedo; pos: Vec2; land: boolean }
  | { type: 'torpExplosion'; ship: Ship; pos: Vec2; name: string }
  | { type: 'module'; ship: Ship; module: ModuleHit; level: number; prev: number }
  | { type: 'repaired'; ship: Ship; name: string; level: number }
  | { type: 'fireStart'; ship: Ship; x: number; y: number }
  | { type: 'magazine'; ship: Ship; x: number }
  | { type: 'brokeInTwo'; ship: Ship; x: number }
  | { type: 'magFlooded'; ship: Ship; name: string }
  | { type: 'moduleFlooded'; ship: Ship; name: string }
  | { type: 'outOfAction'; ship: Ship; reason: string }
  | { type: 'sinking'; ship: Ship }
  | { type: 'collision'; a: Ship; b: Ship; pos: Vec2 }
  | { type: 'grounding'; ship: Ship; pos: Vec2 }
  | { type: 'detected'; ship: Ship; by: TeamId }
  | { type: 'end'; winner: TeamId | null };

/** Visual detection range for a battleship-sized target under each light condition (m). */
export const VISUAL_RANGE: Record<Conditions, number> = { day: 26000, dusk: 14000, night: 7000 };

export class World {
  time = 0;
  ships: Ship[] = [];
  shells: Shell[] = [];
  torpedoes: Torpedo[] = [];
  smoke: SmokePuff[] = [];
  islands: Island[];
  events: WorldEvent[] = [];
  rng: Rng;
  cfg: BattleConfig;
  conditions: Conditions;
  mapHalf: number;
  ended = false;
  winner: TeamId | null = null;
  endTime = 0;
  /** Enemy ships each team currently has in sight (visual or radar). */
  visible: Record<TeamId, Set<number>> = { blue: new Set(), red: new Set() };
  /** Last known state of every enemy each team has ever seen. */
  contacts: Record<TeamId, Map<number, Contact>> = { blue: new Map(), red: new Map() };
  private nextId = 1;
  private salvoId = 1;
  private shellId = 1;
  private torpId = 1;
  private smokeId = 1;
  private smokeTimer = new Map<number, number>();
  private contactsMap = new Map<number, number>();
  private detTimer = 0;

  constructor(cfg: BattleConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.mapHalf = cfg.mapSize / 2;
    this.conditions = cfg.conditions ?? 'day';
    this.islands = generateIslands(cfg);
    const used: Record<string, number> = {};
    for (const s of cfg.ships) {
      const cls = SHIP_CLASSES[s.classId] ?? SHIP_CLASSES.iowa;
      const idx = used[cls.id] ?? 0;
      used[cls.id] = idx + 1;
      const name = s.name ?? cls.names[idx % cls.names.length];
      const ship = new Ship(this.nextId++, cls, { name, team: s.team, controller: s.controller, pos: { x: s.x, y: s.y }, heading: s.heading, speed: s.speed, telegraph: s.telegraph }, this.rng);
      this.clearOfLand(ship);
      this.ships.push(ship);
    }
    this.updateDetection();
  }

  /** Move a spawn off the land if a coastline was generated on top of it. */
  private clearOfLand(s: Ship) {
    for (let k = 0; k < 40; k++) {
      let worst: { d: number; q: Vec2 } | null = null;
      for (const isl of this.islands) {
        const c = coastDistance(s.pos, isl);
        if (c.d < s.cls.length && (!worst || c.d < worst.d)) worst = c;
      }
      if (!worst) return;
      const away = worst.d < 0 ? sub(worst.q, s.pos) : sub(s.pos, worst.q);
      const n = norm(away.x || away.y ? away : { x: 0, y: 1 });
      s.pos = add(worst.d < 0 ? worst.q : s.pos, scale(n, s.cls.length + 200));
    }
  }

  emit(e: WorldEvent) { this.events.push(e); }
  shipById(id: number) { return this.ships.find((s) => s.id === id); }
  enemiesOf(s: Ship) { return this.ships.filter((o) => o.team !== s.team && o.status !== 'sunk'); }
  /** Enemies of `s` its team can currently see. */
  visibleEnemiesOf(s: Ship) { const v = this.visible[s.team]; return this.ships.filter((o) => o.team !== s.team && o.status !== 'sunk' && v.has(o.id)); }
  isVisibleTo(team: TeamId, s: Ship) { return s.team === team || this.visible[team].has(s.id); }

  step(dt: number) {
    this.time += dt;
    for (const s of this.ships) {
      s.update(dt, this.time, this.mapHalf);
      if (s.status === 'active') {
        const ev = (e: string, m: any) => this.onShipEvent(s, e, m);
        s.updateBuoyancy(dt, this.time, ev);
        s.updateFires(dt, this.time, () => this.rng.next(), ev, (id, amt, cause) => { this.damageModule(s, id, amt, cause); });
        s.updateDamageControl(dt, this.time, ev);
        if (s.cmd.fire && !s.outOfAction) this.fireSalvo(s);
        if (s.cmd.torpedo && !s.outOfAction) this.launchTorpedoes(s, s.cmd.torpedo);
        if (!s.outOfAction) this.updateSecondaries(s, dt);
        this.emitSmoke(s, dt);
        this.checkEffectiveness(s);
      } else if (s.status === 'sinking' || s.status === 'exploded') {
        s.fires.forEach((f) => (f.age += dt));
      }
    }
    this.collisions();
    this.grounding(dt);
    this.updateShells(dt);
    this.updateTorpedoes(dt);
    this.updateSmoke(dt);
    this.detTimer -= dt;
    if (this.detTimer <= 0) { this.detTimer = 0.5; this.updateDetection(); }
    this.checkEnd();
  }

  private onShipEvent(s: Ship, e: string, m: any) {
    if (e === 'magazineFlooded') this.emit({ type: 'magFlooded', ship: s, name: m.def.name });
    else if (e === 'moduleFlooded') this.emit({ type: 'moduleFlooded', ship: s, name: m.def.name });
    else if (e === 'repaired') this.emit({ type: 'repaired', ship: s, name: m.def.name, level: m.level });
    else if (e === 'moduleRestored') this.emit({ type: 'repaired', ship: s, name: m.def.name + ' pumped out', level: m.level });
    else if (e === 'sinking') { this.emit({ type: 'sinking', ship: s }); this.emit({ type: 'outOfAction', ship: s, reason: s.outReason }); }
  }

  // ----------------------------------------------------------------- detection
  /** Can `o` see `t` right now (visual line of sight or radar)? */
  detects(o: Ship, t: Ship): boolean {
    const d = dist(o.pos, t.pos);
    if (d < 1500) return true;
    // radar sees through smoke and darkness, not through land; small hulls return weaker echoes
    const radar = o.radarRange() * Math.sqrt(t.cls.visibility);
    const landBlocked = () => landBlocks(o.pos, t.pos, this.islands);
    if (radar > 0 && d <= radar && !landBlocked()) return true;
    // visual
    let vis = VISUAL_RANGE[this.conditions] * t.cls.visibility;
    const sinceFlash = this.time - t.lastSalvoAt;
    if (sinceFlash < 14) vis *= this.conditions === 'night' ? 2.6 : this.conditions === 'dusk' ? 1.6 : 1.15;
    if (t.fires.length && this.conditions !== 'day') vis *= 1.5;
    if (o.directorsOk() < 0.5) vis *= 0.8;
    if (d > vis) return false;
    if (this.smokeBlocks(o.pos, t.pos)) return false;
    return !landBlocked();
  }

  /** Smoke screens hide what is behind them (and anything inside them beyond close range). */
  smokeBlocks(a: Vec2, b: Vec2): boolean {
    const abx = b.x - a.x, aby = b.y - a.y;
    const L2 = abx * abx + aby * aby || 1;
    for (const p of this.smoke) {
      const r = p.r * 0.85 * Math.min(1, (p.life - p.t) / 15);
      if (r < 20) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / L2));
      const cx = a.x + abx * t, cy = a.y + aby * t;
      if (Math.hypot(p.x - cx, p.y - cy) < r) return true;
    }
    return false;
  }

  private updateDetection() {
    for (const team of ['blue', 'red'] as TeamId[]) {
      const eyes = this.ships.filter((s) => s.team === team && s.status === 'active');
      const prev = this.visible[team];
      const next = new Set<number>();
      for (const t of this.ships) {
        if (t.team === team || t.status === 'sunk') continue;
        if (t.status !== 'active' || eyes.some((o) => this.detects(o, t))) {
          next.add(t.id);
          this.contacts[team].set(t.id, { pos: { ...t.pos }, heading: t.heading, speed: t.speed, t: this.time });
          if (!prev.has(t.id) && t.status === 'active') this.emit({ type: 'detected', ship: t, by: team });
        }
      }
      this.visible[team] = next;
    }
  }

  // ----------------------------------------------------------------- gunnery
  fireSalvo(s: Ship) {
    const aim = s.cmd.aim;
    if (!aim) return;
    let fired = 0;
    const salvo = this.salvoId++;
    for (let i = 0; i < s.turrets.length; i++) {
      const t = s.turrets[i];
      if (!t.loaded || !t.aligned) continue;
      const guns = s.gunsFor(t);
      if (guns <= 0) continue;
      const shellDef = s.cls.shells[t.loaded];
      const tp = s.turretWorld(t);
      const bearing = s.turretBearing(t);
      let range = Math.min(dist(tp, aim), s.cls.maxRange);
      range = Math.max(range, 150);
      const intended = add(tp, fromAngle(bearing, range));
      const disp = s.dispersionAt(range);
      const fwd = fromAngle(bearing), lat = { x: -fwd.y, y: fwd.x };
      // salvo-level error (common to all guns of the turret: laying/training error)
      const ce = this.rng.gauss() * disp.range * 0.35, cl = this.rng.gauss() * disp.lateral * 0.35;
      for (let g = 0; g < guns; g++) {
        const er = ce + this.rng.gauss() * disp.range * 0.94;
        const el = cl + this.rng.gauss() * disp.lateral * 0.94;
        const land = { x: intended.x + fwd.x * er + lat.x * el, y: intended.y + fwd.y * er + lat.y * el };
        const r = dist(tp, land);
        const gunOff = (g - (guns - 1) / 2) * t.def.spacing;
        const origin = { x: tp.x + lat.x * gunOff + fwd.x * t.def.barrel * 0.7, y: tp.y + lat.y * gunOff + fwd.y * t.def.barrel * 0.7 };
        const sh: Shell = {
          id: this.shellId++, shooter: s.id, team: s.team, shell: shellDef, origin, target: land, t: -g * 0.07 - this.rng.next() * 0.05,
          T: flightTime(r, shellDef) * (0.985 + this.rng.next() * 0.03), apex: apexHeight(r, shellDef), fall: fallAngle(r, shellDef), v: strikeVelocity(r, shellDef), salvo, aimPoint: { ...intended },
        };
        this.shells.push(sh);
      }
      s.stats.shells += guns;
      this.emit({ type: 'fire', ship: s, turret: i, pos: tp, bearing, guns, ammo: t.loaded });
      t.loaded = null;
      t.reload = s.cls.reloadTime * (0.97 + this.rng.next() * 0.06);
      t.recoil = 1;
      fired++;
    }
    if (fired) { s.stats.salvos++; s.lastSalvoAt = this.time; }
  }

  /** Secondary battery: each mount picks the nearest visible enemy in its arc and fires on its own. */
  private updateSecondaries(s: Ship, dt: number) {
    const bat = s.cls.secondary;
    if (!bat || !s.secondaries.length) return;
    const free = s.cmd.secondaries !== false;
    const foes = free ? this.visibleEnemiesOf(s).filter((o) => o.status === 'active' && !o.outOfAction) : [];
    for (const m of s.secondaries) {
      if (!s.secondaryOk(m)) continue;
      const mp = s.turretWorld(m);
      const range = m.def.range ?? bat.range;
      // (re)select a target
      let tgt = m.target != null ? this.shipById(m.target) : undefined;
      const valid = (o: Ship | undefined) => !!o && foes.includes(o) && dist(mp, o.pos) <= range && this.inSecArc(s, m, o.pos);
      if (!valid(tgt)) {
        let best: Ship | null = null, bs = Infinity;
        for (const o of foes) {
          const d = dist(mp, o.pos);
          if (d > range || !this.inSecArc(s, m, o.pos)) continue;
          const sc = d * (o.cls.type === 'DD' ? 0.7 : o.cls.type === 'CA' ? 0.85 : 1);
          if (sc < bs) { bs = sc; best = o; }
        }
        tgt = best ?? undefined;
        m.target = best ? best.id : null;
      }
      if (!tgt) { m.desired = 0; continue; }
      // director solution: lead by time of flight, with a little rate error
      const shellDef = m.def.shell ?? bat.shell;
      const d = dist(mp, tgt.pos);
      const tof = flightTime(d, shellDef);
      const v = fromAngle(tgt.heading, tgt.speed * (0.9 + this.rng.next() * 0.2));
      const aim = { x: tgt.pos.x + v.x * tof, y: tgt.pos.y + v.y * tof };
      const rel = wrapAngle(Math.atan2(aim.y - mp.y, aim.x - mp.x) - s.heading - m.def.facing);
      m.desired = clamp(rel, -m.def.arc, m.def.arc);
      if (m.reload > 0 || Math.abs(m.offset - m.desired) > 1.5 * Math.PI / 180) continue;
      // fire
      const bearing = s.secondaryBearing(m);
      const r = Math.min(dist(mp, aim), range * 1.05);
      const intended = add(mp, fromAngle(bearing, r));
      const disp = { lateral: (bat.dispersion.base + bat.dispersion.perKm * r / 1000) * (1 + s.fcError * 0.8 + Math.abs(s.list) * 2), range: 0 };
      disp.range = disp.lateral * bat.dispersion.rangeRatio;
      const fwd = fromAngle(bearing), lat = { x: -fwd.y, y: fwd.x };
      const salvo = this.salvoId++;
      for (let g = 0; g < m.def.guns; g++) {
        const er = this.rng.gauss() * disp.range, el = this.rng.gauss() * disp.lateral;
        const land = { x: intended.x + fwd.x * er + lat.x * el, y: intended.y + fwd.y * er + lat.y * el };
        const rr = dist(mp, land);
        this.shells.push({
          id: this.shellId++, shooter: s.id, team: s.team, shell: shellDef, origin: add(mp, fromAngle(bearing, m.def.barrel * 0.7)), target: land,
          t: -g * 0.05, T: flightTime(rr, shellDef) * (0.985 + this.rng.next() * 0.03), apex: apexHeight(rr, shellDef), fall: fallAngle(rr, shellDef), v: strikeVelocity(rr, shellDef),
          salvo, aimPoint: { ...intended }, secondary: true,
        });
      }
      s.stats.secShells += m.def.guns;
      m.reload = (m.def.reload ?? bat.reload) * (0.9 + this.rng.next() * 0.2);
      m.recoil = 1;
      this.emit({ type: 'secFire', ship: s, pos: mp, bearing, guns: m.def.guns, caliber: shellDef.caliber });
    }
  }

  private inSecArc(s: Ship, m: SecondaryState, p: Vec2) {
    const mp = s.turretWorld(m);
    const rel = wrapAngle(Math.atan2(p.y - mp.y, p.x - mp.x) - s.heading - m.def.facing);
    return Math.abs(rel) <= m.def.arc;
  }

  private updateShells(dt: number) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt;
      if (sh.t < sh.T) continue;
      this.shells.splice(i, 1);
      this.impact(sh);
    }
  }

  private impact(sh: Shell) {
    const dirW = norm(sub(sh.target, sh.origin));
    let best: { ship: Ship; c: NonNullable<ReturnType<typeof traceContact>> } | null = null;
    let nearest: Ship | null = null, nearestD = Infinity;
    for (const s of this.ships) {
      if (s.status === 'sunk') continue;
      if (s.id === sh.shooter && dist(s.pos, sh.target) > 400) continue;
      const d = dist(s.pos, sh.target);
      if (d < nearestD) { nearestD = d; nearest = s; }
      if (d > s.cls.length / 2 + 190) continue;
      if (s.status !== 'active' && s.sinkProgress > 0.5) continue;
      const path = makePath(s, sh.target, dirW, sh.fall, sh.v, sh.shell);
      const c = traceContact(s, path);
      if (c && (!best || c.s > best.c.s)) best = { ship: s, c };
    }
    if (!best) {
      if (onLand(sh.target, this.islands)) this.emit({ type: 'landHit', pos: sh.target, shell: sh });
      else this.emit({ type: 'splash', pos: sh.target, shell: sh, near: nearest, nearDist: nearestD });
      return;
    }
    const s = best.ship;
    const path = makePath(s, sh.target, dirW, sh.fall, sh.v, sh.shell);
    const report = resolveHit(s, path, best.c, this.sink);
    const pos = s.localToWorld(best.c.p);
    const shooter = this.shipById(sh.shooter);
    if (shooter && shooter.team !== s.team) {
      if (sh.secondary) shooter.stats.secHits++;
      else {
        shooter.stats.hits++;
        if (['pen', 'citadel', 'underwater', 'overpen', 'he'].includes(report.kind)) shooter.stats.pens++;
        if (report.kind === 'citadel') shooter.stats.citadels++;
      }
      shooter.stats.damageDealt += report.modules.reduce((a, m) => a + m.dmg, 0);
    }
    s.stats.received++;
    this.emit({ type: 'hit', report, shell: sh, pos });
  }

  // ----------------------------------------------------------------- torpedoes
  /** Fire every loaded mount that bears on `aim`, as a spread centred on the bearing. */
  launchTorpedoes(s: Ship, aim: Vec2) {
    const td = s.cls.torpedoes;
    if (!td) return;
    // beyond the fast setting's reach, run them slow and far
    const far = td.def.slow && dist(s.pos, aim) > td.def.range * 0.95;
    const speed = far ? td.def.slow!.speed : td.def.speed, range = far ? td.def.slow!.range : td.def.range;
    for (const m of s.torpedoMounts) {
      if (!m.loaded || !s.torpedoMountOk(m)) continue;
      const mp = s.turretWorld(m);
      const brg = Math.atan2(aim.y - mp.y, aim.x - mp.x);
      if (s.torpedoBearing(m, brg) == null) continue;
      const n = m.def.tubes;
      const spread = 2.2 * Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const h = brg + (i - (n - 1) / 2) * spread + this.rng.gauss() * 0.004;
        const lp = add(mp, fromAngle(h, 6));
        this.torpedoes.push({ id: this.torpId++, shooter: s.id, team: s.team, def: td.def, pos: lp, heading: h, speed, range, run: 0, t: -i * 0.35 });
      }
      m.loaded = false;
      m.train = wrapAngle(brg - s.heading);
      m.reload = td.def.reload;
      s.stats.torpedoes += n;
      this.emit({ type: 'torpLaunch', ship: s, pos: mp, bearing: brg, count: n });
    }
  }

  private updateTorpedoes(dt: number) {
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const tp = this.torpedoes[i];
      tp.t += dt;
      if (tp.t < 0) continue;
      const step = tp.speed * dt;
      const prev = tp.pos;
      const next = add(prev, fromAngle(tp.heading, step));
      tp.pos = next;
      tp.run += step;
      let done = false;
      // hits: the torpedo crosses into a hull's waterline footprint (armed after 300 m)
      if (tp.run > 300) for (const s of this.ships) {
        if (s.status === 'sunk' || (s.status !== 'active' && s.sinkProgress > 0.4)) continue;
        if (s.id === tp.shooter && tp.run < 1500) continue;
        if (dist(s.pos, next) > s.cls.length / 2 + 10) continue;
        const ln = toLocal(next, s.pos, s.heading);
        if (!pointInPolygon(ln, s.cls.hull)) continue;
        // where it struck: walk back to the hull edge
        const lp = toLocal(prev, s.pos, s.heading);
        let a = lp, b = ln;
        for (let k = 0; k < 8; k++) { const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; if (pointInPolygon(m, s.cls.hull)) b = m; else a = m; }
        const depth = Math.min(4, s.cls.draft * 0.55);
        const report = resolveTorpedo(s, b, tp.def.warhead, depth, this.sink);
        const shooter = this.shipById(tp.shooter);
        if (shooter && shooter.team !== s.team) { shooter.stats.torpHits++; shooter.stats.damageDealt += report.modules.reduce((q, m) => q + m.dmg, 0); }
        s.stats.received++;
        this.emit({ type: 'torpHit', report, torpedo: tp, pos: s.localToWorld(b) });
        done = true;
        break;
      }
      if (!done && onLand(next, this.islands)) { this.emit({ type: 'torpEnd', torpedo: tp, pos: next, land: true }); done = true; }
      if (!done && tp.run >= tp.range) { this.emit({ type: 'torpEnd', torpedo: tp, pos: next, land: false }); done = true; }
      if (done) this.torpedoes.splice(i, 1);
    }
  }

  /** Can team `team` see this torpedo's track? */
  torpedoSpotted(tp: Torpedo, team: TeamId): boolean {
    if (tp.team === team) return true;
    const r = tp.def.detect * (this.conditions === 'night' ? 0.6 : 1);
    return this.ships.some((s) => s.team === team && s.status === 'active' && dist(s.pos, tp.pos) < r);
  }

  // ----------------------------------------------------------------- smoke
  private emitSmoke(s: Ship, dt: number) {
    if (!s.smoking) return;
    const t = (this.smokeTimer.get(s.id) ?? 0) - dt;
    if (t > 0) { this.smokeTimer.set(s.id, t); return; }
    this.smokeTimer.set(s.id, 1.4);
    const p = s.localToWorld({ x: -s.cls.length * 0.3, y: 0 });
    this.smoke.push({ id: this.smokeId++, x: p.x, y: p.y, r: 30, t: 0, life: 110, owner: s.id });
  }

  private updateSmoke(dt: number) {
    const w = fromAngle(this.cfg.wind, 1.6);
    for (const p of this.smoke) {
      p.t += dt;
      p.r = Math.min(300, p.r + dt * (p.t < 20 ? 12 : 1.5));
      p.x += w.x * dt; p.y += w.y * dt;
    }
    if (this.smoke.length && this.smoke[0].t >= this.smoke[0].life) this.smoke = this.smoke.filter((p) => p.t < p.life);
  }

  // ----------------------------------------------------------------- damage plumbing
  readonly sink: DamageSink = {
    rnd: () => this.rng.next(),
    damageModule: (ship, id, amount, cause) => this.damageModule(ship, id, amount, cause),
    addHole: (ship, x, y, z, area) => {
      const sec = ship.sectionAt(x);
      ship.holes.push({ section: sec, side: y >= 0 ? 1 : -1, x, z, area, area0: area });
    },
    startFire: (ship, x, y, band, intensity) => {
      const f = ship.startFire(x, y, band, intensity, () => this.rng.next());
      if (f) this.emit({ type: 'fireStart', ship, x, y });
      return !!f;
    },
    detonateMagazine: (ship, x) => {
      if (ship.status !== 'active') return;
      ship.explode(x);
      this.emit({ type: 'magazine', ship, x });
      this.emit({ type: 'outOfAction', ship, reason: ship.outReason });
    },
    breakInTwo: (ship, x) => {
      if (ship.status !== 'active') return;
      ship.explode(x, 'Broke in two — torpedoed');
      this.emit({ type: 'brokeInTwo', ship, x });
      this.emit({ type: 'outOfAction', ship, reason: ship.outReason });
    },
  };

  damageModule(ship: Ship, id: string, amount: number, cause: string): ModuleHit | null {
    const m = ship.modules.get(id);
    if (!m || m.hp <= 0 || amount <= 0) return null;
    const before = m.hp;
    const prev = m.level;
    m.hp = Math.max(0, m.hp - amount);
    m.level = levelFor(m.hp, m.def.hp);
    m.lastHit = this.time;
    const hit: ModuleHit = { id, name: m.def.name, dmg: before - m.hp, before, after: m.hp };
    if (m.level !== prev) {
      this.emit({ type: 'module', ship, module: hit, level: m.level, prev });
      if (m.def.kind === 'turret' && m.level === 3) {
        const t = ship.turrets.find((t) => t.def.id === id);
        if (t) { t.loaded = null; }
      }
      if (m.def.kind === 'magazine' && m.level === 3) {
        // a wrecked magazine that did not explode is flooded by damage control
        m.flooded = true;
        this.emit({ type: 'magFlooded', ship, name: m.def.name });
      }
      if (m.def.kind === 'torpedo' && m.level === 3) this.torpedoMountWrecked(ship, id);
    }
    return hit;
  }

  /** Loaded torpedoes on deck can go off when their mount is wrecked (the bane of IJN cruisers). */
  private torpedoMountWrecked(ship: Ship, moduleId: string) {
    const td = ship.cls.torpedoes;
    if (!td) return;
    for (const m of ship.torpedoMounts) {
      if (m.def.module !== moduleId) continue;
      const armed = m.loaded || m.spares > 0;
      m.loaded = false; m.spares = 0;
      if (!armed || this.rng.next() > (td.def.warhead >= 450 ? 0.35 : 0.12)) continue;
      const pos = ship.localToWorld({ x: m.def.x, y: m.def.y });
      this.emit({ type: 'torpExplosion', ship, pos, name: m.def.name });
      for (const md of ship.modules.values()) {
        const r = md.def.rect;
        const dx = Math.max(r.x0 - m.def.x, 0, m.def.x - r.x1), dy = Math.max(r.y0 - m.def.y, 0, m.def.y - r.y1);
        const dd = Math.hypot(dx, dy);
        if (dd > 16) continue;
        this.damageModule(ship, md.def.id, td.def.warhead * 0.22 * (1 - dd / 16) * (0.8 + this.rng.next() * 0.4), 'torpedo');
      }
      this.sink.startFire(ship, m.def.x, m.def.y, 'high', 1);
      this.sink.addHole(ship, m.def.x, m.def.y, 0.6, 2.5 * td.def.warhead / 400);
    }
  }

  private checkEffectiveness(s: Ship) {
    if (s.outOfAction) return;
    const guns = s.turrets.some((t) => s.turretOperable(t));
    const torps = s.torpedoCapacity().potential > 0;
    if (!guns && !torps) {
      s.setOutOfAction('Main battery silenced');
      this.emit({ type: 'outOfAction', ship: s, reason: s.outReason });
      return;
    }
    // Accumulated damage can leave a ship unable to fight long before she sinks.
    const r = s.readiness();
    const value = r.firepower * 0.5 + r.mobility * 0.2 + r.buoyancy * 0.3;
    if (value < 0.3 && r.firepower <= 0.34 && !(torps && r.mobility > 0.3)) {
      s.setOutOfAction('Crippled — no longer combat effective');
      this.emit({ type: 'outOfAction', ship: s, reason: s.outReason });
      return;
    }
    if (s.power <= 0.001 && s.floodTotal > s.cls.reserveBuoyancy * 0.7) {
      s.setOutOfAction('Dead in the water and foundering');
      this.emit({ type: 'outOfAction', ship: s, reason: s.outReason });
      return;
    }
    if (s.outOfBoundsTime > 60) {
      s.setOutOfAction('Withdrew from the battle area');
      this.emit({ type: 'outOfAction', ship: s, reason: s.outReason });
    }
  }

  /** Battles are capped; at the limit the side with more fighting strength holds the field. */
  timeLimit = 25 * 60;

  /** Fighting strength of a team, weighted by displacement so a battleship outweighs a destroyer. */
  strength(t: TeamId) {
    return this.ships.filter((s) => s.team === t && !s.outOfAction).reduce((a, s) => {
      const r = s.readiness();
      return a + (r.firepower * 0.6 + r.buoyancy * 0.25 + r.mobility * 0.15) * Math.sqrt(s.cls.displacement / 50000);
    }, 0);
  }

  private checkEnd() {
    if (this.ended) return;
    if (this.time >= this.timeLimit) {
      const b = this.strength('blue'), r = this.strength('red');
      this.ended = true;
      this.winner = Math.abs(b - r) < 0.05 ? null : b > r ? 'blue' : 'red';
      this.endTime = this.time;
      this.emit({ type: 'end', winner: this.winner });
      return;
    }
    const teams: TeamId[] = ['blue', 'red'];
    const alive = teams.filter((t) => this.ships.some((s) => s.team === t && !s.outOfAction));
    if (alive.length < 2) {
      this.ended = true;
      this.winner = alive[0] ?? null;
      this.endTime = this.time;
      this.emit({ type: 'end', winner: this.winner });
    }
  }

  // ----------------------------------------------------------------- collisions & grounding
  private collisions() {
    const act = this.ships.filter((s) => s.status === 'active' || s.sinkProgress < 0.4);
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (dist(a.pos, b.pos) > (a.cls.length + b.cls.length) / 2) continue;
      // approximate hulls with chains of circles
      let pushed = false;
      const ca = hullCircles(a), cb = hullCircles(b);
      const ma = a.cls.displacement, mb = b.cls.displacement;
      for (const pa of ca) for (const pb of cb) {
        const d = dist(pa.c, pb.c), min = pa.r + pb.r;
        if (d < min && d > 0.001) {
          const n = scale(sub(pa.c, pb.c), 1 / d);
          const push = min - d;
          // the lighter ship is shoved further
          a.pos = add(a.pos, scale(n, push * mb / (ma + mb))); b.pos = add(b.pos, scale(n, -push * ma / (ma + mb)));
          pushed = true;
        }
      }
      if (pushed) {
        // grinding contact costs a little way; a hard collision (closing fast) holes both hulls
        const rel = Math.abs(a.speed - b.speed * Math.cos(a.heading - b.heading));
        a.speed *= 0.995; b.speed *= 0.995;
        const key = a.id * 1000 + b.id;
        if (rel > 5 && !this.contactsMap.has(key)) {
          const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
          for (const [s, o] of [[a, b], [b, a]] as const) {
            const lp = rotate(sub(mid, s.pos), -s.heading);
            const x = clamp(lp.x, -s.cls.length / 2 + 10, s.cls.length / 2 - 10);
            // ramming: the heavier ship tears a bigger hole in the lighter one
            const k = Math.min(3, Math.sqrt(o.cls.displacement / s.cls.displacement));
            this.sink.addHole(s, x, Math.sign(lp.y || 1) * s.cls.halfBeam(x), -1.5, (0.6 + rel * 0.06) * k);
          }
          this.emit({ type: 'collision', a, b, pos: mid });
        }
        this.contactsMap.set(key, this.time);
      }
    }
    for (const [k, t] of this.contactsMap) if (this.time - t > 3) this.contactsMap.delete(k);
  }

  /** Running aground: the hull is pushed back off the coast, way is lost and the bottom is holed. */
  private grounding(dt: number) {
    if (!this.islands.length) return;
    for (const s of this.ships) {
      if (s.status === 'sunk') continue;
      s.grounded = Math.max(0, s.grounded - dt);
      for (const isl of this.islands) {
        if (dist(s.pos, { x: isl.cx, y: isl.cy }) > isl.r + s.cls.length) continue;
        // far from this coast: no need to test the hull circle by circle
        if (coastDistance(s.pos, isl).d > s.cls.length / 2 + 30) continue;
        for (const c of hullCircles(s)) {
          const cd = coastDistance(c.c, isl);
          if (cd.d >= c.r * 0.6) continue;
          const away = cd.d < 0 ? sub(cd.q, c.c) : sub(c.c, cd.q);
          const n = norm(away.x || away.y ? away : sub(s.pos, { x: isl.cx, y: isl.cy }));
          s.pos = add(s.pos, scale(n, c.r * 0.6 - cd.d));
          if (s.grounded <= 0 && Math.abs(s.speed) > 2 && s.status === 'active') {
            const lp = toLocal(c.c, s.pos, s.heading);
            this.sink.addHole(s, clamp(lp.x, -s.cls.length / 2 + 6, s.cls.length / 2 - 6), lp.y || 1, -s.cls.draft * 0.8, 0.4 + Math.abs(s.speed) * 0.12);
            this.emit({ type: 'grounding', ship: s, pos: c.c });
          }
          s.grounded = 2.5;
          s.speed *= 0.9;
        }
      }
    }
  }
}

export function hullCircles(s: Ship) {
  const out: { c: Vec2; r: number }[] = [];
  const L = s.cls.length;
  const n = Math.max(4, Math.round(L / 25));
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + 12 + ((L - 20) * i) / n;
    const r = Math.max(3, s.cls.halfBeam(x));
    out.push({ c: s.localToWorld({ x, y: 0 }), r });
  }
  return out;
}

export { STATE_NAMES, R50, angleOf, TAU, clamp, rotate, angleDiff };
