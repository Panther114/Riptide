// The battle simulation. Owns ships and shells, steps physics at a fixed rate and
// emits events for presentation (renderer, HUD, audio). Nothing here touches the
// DOM, so the same code can later run authoritative on a server.

import { Rng, Vec2, angleOf, dist, fromAngle, norm, sub, TAU, clamp, add, scale, rotate } from '../core/math';
import { flightTime, fallAngle, strikeVelocity, apexHeight, R50 } from './ballistics';
import { traceContact, resolveHit, makePath, HitReport, DamageSink, ModuleHit } from './damage';
import { Ship, levelFor } from './ship';
import { SHIP_CLASSES, ShellDef } from './shipClass';
import type { AmmoType, BattleConfig, TeamId } from './types';
import { STATE_NAMES } from './types';

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
}

export type WorldEvent =
  | { type: 'fire'; ship: Ship; turret: number; pos: Vec2; bearing: number; guns: number; ammo: AmmoType }
  | { type: 'splash'; pos: Vec2; shell: Shell; near: Ship | null; nearDist: number }
  | { type: 'hit'; report: HitReport; shell: Shell; pos: Vec2 }
  | { type: 'module'; ship: Ship; module: ModuleHit; level: number; prev: number }
  | { type: 'fireStart'; ship: Ship; x: number; y: number }
  | { type: 'magazine'; ship: Ship; x: number }
  | { type: 'magFlooded'; ship: Ship; name: string }
  | { type: 'moduleFlooded'; ship: Ship; name: string }
  | { type: 'outOfAction'; ship: Ship; reason: string }
  | { type: 'sinking'; ship: Ship }
  | { type: 'collision'; a: Ship; b: Ship; pos: Vec2 }
  | { type: 'end'; winner: TeamId | null };

export class World {
  time = 0;
  ships: Ship[] = [];
  shells: Shell[] = [];
  events: WorldEvent[] = [];
  rng: Rng;
  cfg: BattleConfig;
  mapHalf: number;
  ended = false;
  winner: TeamId | null = null;
  endTime = 0;
  private nextId = 1;
  private salvoId = 1;
  private shellId = 1;
  private contacts = new Map<number, number>();

  constructor(cfg: BattleConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.mapHalf = cfg.mapSize / 2;
    const used: Record<string, number> = {};
    for (const s of cfg.ships) {
      const cls = SHIP_CLASSES[s.classId];
      const idx = used[s.classId] ?? 0;
      used[s.classId] = idx + 1;
      const name = s.name ?? cls.names[idx % cls.names.length];
      this.ships.push(new Ship(this.nextId++, cls, { name, team: s.team, controller: s.controller, pos: { x: s.x, y: s.y }, heading: s.heading, speed: s.speed, telegraph: s.telegraph }));
    }
  }

  emit(e: WorldEvent) { this.events.push(e); }
  shipById(id: number) { return this.ships.find((s) => s.id === id); }
  enemiesOf(s: Ship) { return this.ships.filter((o) => o.team !== s.team && o.status !== 'sunk'); }

  step(dt: number) {
    this.time += dt;
    for (const s of this.ships) {
      s.update(dt, this.time, this.mapHalf);
      if (s.status === 'active') {
        s.updateBuoyancy(dt, this.time, (e, m) => this.onShipEvent(s, e, m));
        s.updateFires(dt, this.time, () => this.rng.next(), (e, m) => this.onShipEvent(s, e, m), (id, amt, cause) => { this.damageModule(s, id, amt, cause); });
        if (s.cmd.fire && !s.outOfAction) this.fireSalvo(s);
        this.checkEffectiveness(s);
      } else if (s.status === 'sinking' || s.status === 'exploded') {
        s.fires.forEach((f) => (f.age += dt));
      }
    }
    this.collisions();
    this.updateShells(dt);
    this.checkEnd();
  }

  private onShipEvent(s: Ship, e: string, m: any) {
    if (e === 'magazineFlooded') this.emit({ type: 'magFlooded', ship: s, name: m.def.name });
    else if (e === 'moduleFlooded') this.emit({ type: 'moduleFlooded', ship: s, name: m.def.name });
    else if (e === 'sinking') { this.emit({ type: 'sinking', ship: s }); this.emit({ type: 'outOfAction', ship: s, reason: s.outReason }); }
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
        const gunOff = (g - (guns - 1) / 2) * 2.6;
        const origin = { x: tp.x + lat.x * gunOff + fwd.x * 18, y: tp.y + lat.y * gunOff + fwd.y * 18 };
        const sh: Shell = {
          id: this.shellId++, shooter: s.id, team: s.team, shell: shellDef, origin, target: land, t: -g * 0.07 - this.rng.next() * 0.05,
          T: flightTime(r) * (0.985 + this.rng.next() * 0.03), apex: apexHeight(r), fall: fallAngle(r, shellDef), v: strikeVelocity(r, shellDef), salvo, aimPoint: { ...intended },
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
      if (d > 320) continue;
      if (s.status !== 'active' && s.sinkProgress > 0.5) continue;
      const path = makePath(s, sh.target, dirW, sh.fall, sh.v, sh.shell);
      const c = traceContact(s, path);
      if (c && (!best || c.s > best.c.s)) best = { ship: s, c };
    }
    if (!best) {
      this.emit({ type: 'splash', pos: sh.target, shell: sh, near: nearest, nearDist: nearestD });
      return;
    }
    const s = best.ship;
    const path = makePath(s, sh.target, dirW, sh.fall, sh.v, sh.shell);
    const report = resolveHit(s, path, best.c, this.sink);
    const pos = s.localToWorld(best.c.p);
    const shooter = this.shipById(sh.shooter);
    if (shooter && shooter.team !== s.team) {
      shooter.stats.hits++;
      if (['pen', 'citadel', 'underwater', 'overpen', 'he'].includes(report.kind)) shooter.stats.pens++;
      if (report.kind === 'citadel') shooter.stats.citadels++;
      shooter.stats.damageDealt += report.modules.reduce((a, m) => a + m.dmg, 0);
    }
    s.stats.received++;
    this.emit({ type: 'hit', report, shell: sh, pos });
  }

  // ----------------------------------------------------------------- damage plumbing
  readonly sink: DamageSink = {
    rnd: () => this.rng.next(),
    damageModule: (ship, id, amount, cause) => this.damageModule(ship, id, amount, cause),
    addHole: (ship, x, y, z, area) => {
      const sec = ship.sectionAt(x);
      ship.holes.push({ section: sec, side: y >= 0 ? 1 : -1, x, z, area });
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
    }
    return hit;
  }

  private checkEffectiveness(s: Ship) {
    if (s.outOfAction) return;
    const operable = s.turrets.some((t) => s.turretOperable(t));
    if (!operable) {
      s.setOutOfAction('Main battery silenced');
      this.emit({ type: 'outOfAction', ship: s, reason: s.outReason });
      return;
    }
    // Accumulated damage can leave a ship unable to fight long before she sinks.
    const r = s.readiness();
    const value = r.firepower * 0.5 + r.mobility * 0.2 + r.buoyancy * 0.3;
    if (value < 0.3 && r.firepower <= 0.34) {
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

  private checkEnd() {
    if (this.ended) return;
    if (this.time >= this.timeLimit) {
      const str = (t: TeamId) => this.ships.filter((s) => s.team === t && !s.outOfAction).reduce((a, s) => { const r = s.readiness(); return a + r.firepower * 0.6 + r.buoyancy * 0.25 + r.mobility * 0.15; }, 0);
      const b = str('blue'), r = str('red');
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

  // ----------------------------------------------------------------- collisions
  private collisions() {
    const act = this.ships.filter((s) => s.status === 'active' || s.sinkProgress < 0.4);
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (dist(a.pos, b.pos) > a.cls.length) continue;
      // approximate hulls with chains of circles
      let pushed = false;
      for (const pa of hullCircles(a)) for (const pb of hullCircles(b)) {
        const d = dist(pa.c, pb.c), min = pa.r + pb.r;
        if (d < min && d > 0.001) {
          const n = scale(sub(pa.c, pb.c), 1 / d);
          const push = (min - d) * 0.5;
          a.pos = add(a.pos, scale(n, push)); b.pos = add(b.pos, scale(n, -push));
          pushed = true;
        }
      }
      if (pushed) {
        // grinding contact costs a little way; a hard collision (closing fast) holes both hulls
        const rel = Math.abs(a.speed - b.speed * Math.cos(a.heading - b.heading));
        a.speed *= 0.995; b.speed *= 0.995;
        const key = a.id * 1000 + b.id;
        if (rel > 5 && !this.contacts.has(key)) {
          const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
          for (const s of [a, b]) {
            const lp = rotate(sub(mid, s.pos), -s.heading);
            const x = clamp(lp.x, -125, 125);
            this.sink.addHole(s, x, Math.sign(lp.y || 1) * 15, -1.5, 0.6 + rel * 0.06);
          }
          this.emit({ type: 'collision', a, b, pos: mid });
        }
        this.contacts.set(key, this.time);
      }
    }
    for (const [k, t] of this.contacts) if (this.time - t > 3) this.contacts.delete(k);
  }
}

function hullCircles(s: Ship) {
  const out: { c: Vec2; r: number }[] = [];
  for (let x = -110; x <= 115; x += 25) {
    const r = Math.max(4, s.cls.halfBeam(x));
    out.push({ c: s.localToWorld({ x, y: 0 }), r });
  }
  return out;
}

export { STATE_NAMES, R50, angleOf, TAU, clamp, rotate };
