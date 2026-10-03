// Runtime state of one ship: manoeuvring, gunnery, internal systems, flooding, fires.

import {
  Vec2, DEG, TAU, angleDiff, approach, clamp, clamp01, dist, fromAngle, rotate, toWorld, wrapAngle, damp,
} from '../core/math';
import type { ModuleDef, SectionDef, ShipClass, TurretDef } from './shipClass';
import { AmmoType, ModuleStateLevel, ShipCommand, TeamId, newCommand, telegraphFrac } from './types';
import { baseDispersion, Dispersion } from './ballistics';

export interface ModuleState {
  def: ModuleDef;
  hp: number;
  level: ModuleStateLevel;
  flooded: boolean;          // machinery/magazine space flooded out
  lastHit: number;           // sim time of last damage (for UI flashes)
}

export interface TurretState {
  def: TurretDef;
  offset: number;            // traverse offset from rest facing (rad), kept within +/-arc
  desired: number;           // desired offset (clamped)
  inArc: boolean;            // aim bearing lies inside the arc
  aligned: boolean;
  reload: number;            // seconds remaining
  loaded: AmmoType | null;
  loading: AmmoType;
  recoil: number;            // visual 0..1
  elevation: number;         // visual 0..1
  jam: number;               // seconds of temporary traverse jam
}

export interface Hole {
  section: number;
  side: -1 | 1;
  x: number;
  z: number;                 // height of the hole above design waterline
  area: number;              // m^2
}

export interface Fire {
  id: number;
  x: number; y: number;      // local
  band: 'low' | 'high';
  intensity: number;
  life: number;
  age: number;
}

export interface SectionState {
  def: SectionDef;
  port: number;              // tonnes
  stbd: number;
}

export type ShipStatus = 'active' | 'sinking' | 'exploded' | 'sunk';

let fireIds = 1;

export class Ship {
  readonly id: number;
  readonly cls: ShipClass;
  name: string;
  team: TeamId;
  controller: 'player' | 'ai';

  pos: Vec2;
  heading: number;
  speed = 0;                   // along heading (m/s)
  yawRate = 0;                 // rad/s
  rudder = 0;                  // actual rudder angle (rad), + = starboard
  telegraph = 0;
  cmd: ShipCommand = newCommand();
  private cmdQueue: { t: number; cmd: ShipCommand }[] = [];

  modules = new Map<string, ModuleState>();
  turrets: TurretState[] = [];
  sections: SectionState[] = [];
  holes: Hole[] = [];
  fires: Fire[] = [];
  ammo = new Map<string, Record<AmmoType, number>>();   // magazine id -> counts
  magHeat = new Map<string, number>();

  status: ShipStatus = 'active';
  outOfAction = false;
  outReason = '';
  statusTime = 0;               // time since status changed (for sinking animation)
  sinkProgress = 0;             // 0..1 visual
  breakAt = 0;                  // local x where the hull broke (exploded)

  // derived
  power = 1;                    // available propulsion power 0..1
  sinkage = 0;                  // m, mean settlement
  trim = 0;                     // m/m, + = bow down
  list = 0;                     // rad, + = to starboard
  floodTotal = 0;
  fcError = 0;                  // fire-control solution degradation 0..1
  private lastAim: Vec2 | null = null;
  outOfBoundsTime = 0;

  // bookkeeping for UI / results
  stats = { salvos: 0, shells: 0, hits: 0, pens: 0, received: 0, citadels: 0, fires: 0, damageDealt: 0 };
  lastSalvoAt = -999;

  constructor(id: number, cls: ShipClass, opts: { name: string; team: TeamId; controller: 'player' | 'ai'; pos: Vec2; heading: number; speed?: number; telegraph?: number }) {
    this.id = id;
    this.cls = cls;
    this.name = opts.name;
    this.team = opts.team;
    this.controller = opts.controller;
    this.pos = { ...opts.pos };
    this.heading = opts.heading;
    this.speed = opts.speed ?? 0;
    this.telegraph = opts.telegraph ?? 0;
    this.cmd.telegraph = this.telegraph;
    for (const m of cls.modules) this.modules.set(m.id, { def: m, hp: m.hp, level: 0, flooded: false, lastHit: -99 });
    for (const t of cls.turrets) {
      this.turrets.push({ def: t, offset: 0, desired: 0, inArc: true, aligned: false, reload: 4 + Math.random() * 3, loaded: null, loading: 'AP', recoil: 0, elevation: 0, jam: 0 });
      this.ammo.set(t.magazine, { ...cls.ammo });
      this.magHeat.set(t.magazine, 0);
    }
    for (const s of cls.sections) this.sections.push({ def: s, port: 0, stbd: 0 });
  }

  get alive() { return this.status === 'active'; }
  get dir(): Vec2 { return fromAngle(this.heading); }
  mod(id: string) { return this.modules.get(id)!; }

  /** Commands pass through the bridge; a wrecked bridge delays orders (emergency conn aft). */
  setCommand(cmd: ShipCommand, time: number) {
    const bridge = this.mod('bridge');
    const delay = bridge.level === 3 ? 2.5 : bridge.level === 2 ? 1.0 : 0;
    if (delay === 0) { this.cmd = cmd; this.cmdQueue.length = 0; return; }
    this.cmdQueue.push({ t: time + delay, cmd: { ...cmd, aim: cmd.aim ? { ...cmd.aim } : null } });
    // gunnery is controlled from the directors, not the bridge: aim & fire are immediate
    this.cmd.aim = cmd.aim; this.cmd.fire = cmd.fire; this.cmd.ammo = cmd.ammo;
    while (this.cmdQueue.length && this.cmdQueue[0].t <= time) {
      const c = this.cmdQueue.shift()!.cmd;
      this.cmd.telegraph = c.telegraph; this.cmd.rudder = c.rudder;
    }
  }

  // ---------------------------------------------------------------- geometry
  localToWorld(p: Vec2): Vec2 { return toWorld(p, this.pos, this.heading); }
  turretWorld(t: TurretState): Vec2 { return this.localToWorld({ x: t.def.x, y: t.def.y }); }
  /** World bearing the turret's guns currently point along. */
  turretBearing(t: TurretState): number { return wrapAngle(this.heading + t.def.facing + t.offset); }
  /** Water level relative to design waterline at local x (positive = deeper). */
  waterRise(x: number) { return this.sinkage + this.trim * x; }

  sectionAt(x: number): number {
    const s = this.sections.findIndex((s) => x >= s.def.x0 && x < s.def.x1);
    return s < 0 ? (x > 0 ? 0 : this.sections.length - 1) : s;
  }

  // ---------------------------------------------------------------- systems
  propulsionPower(): number {
    let boil = 0, eng = 0, boilers = 0, engines = 0;
    const f = [1, 0.75, 0.4, 0];
    for (const m of this.modules.values()) {
      const eff = m.flooded ? 0 : f[m.level];
      if (m.def.kind === 'boiler') { boil += eff; boilers++; }
      if (m.def.kind === 'engine') { eng += eff; engines++; }
    }
    let draft = 1;
    for (const id of ['fun1', 'fun2']) { const m = this.modules.get(id); if (m) draft -= [0, 0.05, 0.1, 0.17][m.level]; }
    return clamp01(Math.min((boil / boilers) * draft, eng / engines));
  }

  steeringFactor(): number { const m = this.mod('steer'); return Math.min([1, 0.65, 0.3, 0][m.level], m.flooded && m.level < 3 ? 0.3 : 1); }

  dispersionMult(): number {
    const dF = this.mod('dirF').level, dA = this.mod('dirA').level;
    const dirLoss = (dF === 3 ? 1 : dF * 0.2) + (dA === 3 ? 1 : dA * 0.2);
    let m = 1 + 0.18 * Math.min(dirLoss, 1) + (dirLoss >= 2 ? 0.45 : 0);
    m *= 1 + 0.85 * this.fcError;
    m *= 1 + Math.abs(this.list) / DEG * 0.025;
    return m;
  }

  dispersionAt(range: number): Dispersion { return baseDispersion(range, this.cls.dispersion, this.dispersionMult()); }

  gunsFor(t: TurretState): number {
    const m = this.mod(t.def.id);
    if (m.level === 3) return 0;
    return [3, 2, 1, 0][m.level];
  }

  magazineOk(t: TurretState): boolean {
    const mag = this.mod(t.def.magazine);
    return mag.level < 3 && !mag.flooded;
  }

  ammoLeft(t: TurretState, a: AmmoType): number { return this.ammo.get(t.def.magazine)![a]; }

  turretOperable(t: TurretState): boolean {
    if (this.gunsFor(t) === 0) return false;
    if (t.loaded) return true;
    if (!this.magazineOk(t)) return false;
    const am = this.ammo.get(t.def.magazine)!;
    return am.AP + am.HC > 0;
  }

  /** Overall condition used by UI & AI, 0..1 each. */
  readiness() {
    const firepower = this.turrets.reduce((s, t) => s + (this.turretOperable(t) ? this.gunsFor(t) : 0), 0) / (this.turrets.length * 3);
    return { firepower, mobility: this.power * (this.steeringFactor() > 0 ? 1 : 0.5), buoyancy: 1 - clamp01(this.floodTotal / this.cls.reserveBuoyancy) };
  }

  // ---------------------------------------------------------------- update
  update(dt: number, time: number, mapHalf: number) {
    this.statusTime += dt;
    if (this.status !== 'active') { this.updateSinking(dt); return; }
    this.power = this.propulsionPower();
    this.updateMovement(dt, mapHalf);
    this.updateTurrets(dt);
    this.updateFireControl(dt);
  }

  private updateMovement(dt: number, mapHalf: number) {
    const cls = this.cls;
    // telegraph responds in steps; engine order follows command
    this.telegraph = clamp(Math.round(this.cmd.telegraph), -2, 4);
    const floodFrac = clamp01(this.floodTotal / cls.reserveBuoyancy);
    const floodFactor = 1 - 0.55 * Math.pow(floodFrac, 1.3);
    const frac = telegraphFrac(this.telegraph);
    const vmax = frac >= 0 ? cls.maxSpeed : cls.maxReverse;
    // power ~ v^3 -> achievable speed ~ cube root of available power
    let target = frac * vmax * Math.cbrt(this.power) * floodFactor;
    // helm-induced speed loss
    const rudFrac = Math.abs(this.rudder) / cls.rudderMax;
    target *= 1 - 0.28 * rudFrac * clamp01(Math.abs(this.speed) / cls.maxSpeed + 0.2);
    const accelTau = cls.accelTime / 3;
    const tau = Math.abs(target) > Math.abs(this.speed) && Math.sign(target) === Math.sign(this.speed || target) ? accelTau : accelTau * 1.6;
    this.speed += (target - this.speed) * damp(1 / tau, dt);

    // rudder
    const sf = this.steeringFactor();
    if (sf > 0) {
      const want = clamp(this.cmd.rudder, -1, 1) * cls.rudderMax;
      this.rudder = approach(this.rudder, want, cls.rudderRate * sf * dt);
    } // destroyed steering: rudder stays jammed where it was

    // yaw: turning rate from tactical radius, scaled by rudder and speed
    const effSpeed = this.speed;
    const radius = cls.turnRadius / Math.max(0.05, Math.abs(this.rudder) / cls.rudderMax);
    let targetYaw = this.rudder === 0 ? 0 : Math.sign(this.rudder) * (effSpeed / radius) * (effSpeed < 0 ? 0.6 : 1);
    // a little residual steerage way even when stopped
    this.yawRate += (targetYaw - this.yawRate) * damp(0.32, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // drift: stern kicks out in a turn, the ship slides slightly
    const fwd = fromAngle(this.heading);
    const side = { x: -fwd.y, y: fwd.x };
    const slip = -this.yawRate * 34;
    this.pos.x += (fwd.x * this.speed + side.x * slip) * dt;
    this.pos.y += (fwd.y * this.speed + side.y * slip) * dt;

    const out = Math.abs(this.pos.x) > mapHalf || Math.abs(this.pos.y) > mapHalf;
    this.outOfBoundsTime = out ? this.outOfBoundsTime + dt : Math.max(0, this.outOfBoundsTime - dt * 2);
  }

  private updateTurrets(dt: number) {
    const aim = this.cmd.aim;
    for (const t of this.turrets) {
      t.recoil = Math.max(0, t.recoil - dt * 1.4);
      const m = this.mod(t.def.id);
      if (m.level === 3) { t.aligned = false; continue; }
      if (aim) {
        const tp = this.turretWorld(t);
        const bearing = Math.atan2(aim.y - tp.y, aim.x - tp.x);
        const rel = wrapAngle(bearing - this.heading - t.def.facing);
        t.inArc = Math.abs(rel) <= t.def.arc;
        t.desired = clamp(rel, -t.def.arc, t.def.arc);
        const range = dist(tp, aim);
        t.elevation += (clamp01(range / this.cls.maxRange) - t.elevation) * damp(1.5, dt);
      }
      const rate = t.def.traverseRate * [1, 0.75, 0.45, 0][m.level];
      if (t.jam > 0) t.jam -= dt;
      else {
        // Traverse is kept on the linear offset so turrets never swing through their blind arc.
        // Ship yaw is compensated because desired is relative to the hull.
        t.offset = approach(t.offset, t.desired, rate * dt);
      }
      t.aligned = t.inArc && Math.abs(t.offset - t.desired) < 0.55 * DEG && !!aim;

      // loading
      if (!t.loaded && this.gunsFor(t) > 0) {
        if (this.magazineOk(t)) {
          const am = this.ammo.get(t.def.magazine)!;
          let want = this.cmd.ammo;
          if (am[want] <= 0) want = want === 'AP' ? 'HC' : 'AP';
          if (am[want] > 0) {
            if (t.loading !== want) { t.loading = want; }
            const mag = this.mod(t.def.magazine);
            const slow = [1, 1.25, 1.7, 99][m.level] * [1, 1.2, 1.6, 99][mag.level];
            t.reload -= dt / slow;
            if (t.reload <= 0) {
              const n = Math.min(this.gunsFor(t), am[want]);
              am[want] -= n;
              t.loaded = want;
              t.reload = 0;
            }
          }
        }
      }
    }
  }

  private updateFireControl(dt: number) {
    // A good firing solution needs a steady platform and a steady point of aim.
    const aim = this.cmd.aim;
    let disturb = Math.abs(this.yawRate) / DEG * 0.085;
    if (aim && this.lastAim) {
      const range = Math.max(800, dist(this.pos, aim));
      const moved = dist(aim, this.lastAim) / range; // radians of aim change
      disturb += (moved / dt) / DEG * 0.11;
    }
    this.lastAim = aim ? { ...aim } : null;
    const target = clamp01(disturb);
    if (target > this.fcError) this.fcError += (target - this.fcError) * damp(3.5, dt);
    else this.fcError += (target - this.fcError) * damp(0.32, dt);
  }

  /** Called by the world when a magazine module is lost or the ship founders. */
  updateBuoyancy(dt: number, time: number, onEvent: (e: string, extra?: any) => void) {
    const cls = this.cls;
    // flooding through holes
    const g = 9.81;
    for (const h of this.holes) {
      const sec = this.sections[h.section];
      const depth = this.waterRise(h.x) - h.z + Math.sin(this.list) * 16 * h.side;
      if (depth <= 0) continue;
      const cap = sec.def.capacity / 2;
      const key = h.side > 0 ? 'stbd' : 'port';
      if (sec[key] >= cap) continue;
      const q = 0.62 * h.area * Math.sqrt(2 * g * depth) * 1.025; // t/s
      sec[key] = Math.min(cap, sec[key] + q * dt);
    }
    // cross-flooding equalises slowly, pumps drain
    let total = 0;
    const pumping = cls.pumpRate * (0.35 + 0.65 * this.power) * dt;
    const flooding = this.sections.filter((s) => s.port + s.stbd > 1);
    for (const s of this.sections) {
      const diff = s.stbd - s.port;
      const xfer = diff * damp(0.035, dt);
      s.stbd -= xfer; s.port += xfer;
      if (flooding.length) {
        const share = pumping / flooding.length;
        const tot = s.port + s.stbd;
        if (tot > 0) {
          const k = Math.max(0, tot - share) / tot;
          s.port *= k; s.stbd *= k;
        }
      }
      total += s.port + s.stbd;
    }
    this.floodTotal = total;

    // hydrostatics (deliberately simple): mean sinkage, trim and list
    const frac = total / cls.reserveBuoyancy;
    const fb = cls.freeboard(0);
    this.sinkage = frac * (fb - 0.6);
    let mom = 0, side = 0;
    for (const s of this.sections) {
      const xm = (s.def.x0 + s.def.x1) / 2;
      mom += (s.port + s.stbd) * xm;
      side += s.stbd - s.port;
    }
    const trimTarget = mom / (cls.reserveBuoyancy * 135) * 0.075;
    this.trim += (trimTarget - this.trim) * damp(0.25, dt);
    const listTarget = (side / 2400) * 6 * DEG * (1 + frac);
    this.list += (listTarget - this.list) * damp(0.2, dt);

    // machinery & magazine spaces drown when their section is well flooded
    for (const m of this.modules.values()) {
      if (m.def.band !== 'low' || m.flooded) continue;
      const xm = (m.def.rect.x0 + m.def.rect.x1) / 2;
      const s = this.sections[this.sectionAt(xm)];
      if ((s.port + s.stbd) / s.def.capacity > 0.8) {
        m.flooded = true;
        onEvent('moduleFlooded', m);
      }
    }

    if (frac >= 1 || Math.abs(this.list) > 21 * DEG) {
      this.beginSinking(Math.abs(this.list) > 21 * DEG ? 'Capsized' : 'Foundered — sunk by flooding');
      onEvent('sinking');
    }
  }

  updateFires(dt: number, time: number, rnd: () => number, onEvent: (e: string, extra?: any) => void, damageModule: (id: string, amount: number, cause: string) => void) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      // damage control gradually beats fires down
      const fade = f.age > f.life ? 0.12 : 0;
      f.intensity = clamp01(f.intensity + (f.age < 8 ? 0.06 : -0.004 - fade) * dt * 2);
      if (f.intensity <= 0.02) { this.fires.splice(i, 1); onEvent('fireOut', f); continue; }
      // scorch nearby modules in the same band
      for (const m of this.modules.values()) {
        if (m.level === 3) continue;
        const r = m.def.rect;
        const dx = Math.max(r.x0 - f.x, 0, f.x - r.x1), dy = Math.max(r.y0 - f.y, 0, f.y - r.y1);
        const d = Math.hypot(dx, dy);
        if (d > 9) continue;
        const sameBand = m.def.band === f.band;
        if (!sameBand && m.def.kind !== 'turret') continue;
        const rate = (m.def.kind === 'magazine' ? 0 : m.def.kind === 'turret' ? 0.35 : 0.9) * f.intensity * (1 - d / 9);
        if (rate > 0) damageModule(m.def.id, rate * dt, 'fire');
        if (m.def.kind === 'magazine' && f.band === 'low' && !m.flooded) {
          const h = (this.magHeat.get(m.def.id) ?? 0) + dt * f.intensity * (1 - d / 9) / 45;
          this.magHeat.set(m.def.id, h);
          if (h >= 1) {
            m.flooded = true;
            onEvent('magazineFlooded', m);
          }
        }
      }
      // spread
      if (this.fires.length < 7 && rnd() < dt * 0.012 * f.intensity) {
        const nx = clamp(f.x + (rnd() - 0.5) * 34, -125, 125);
        const ny = clamp(f.y + (rnd() - 0.5) * 14, -this.cls.halfBeam(nx) * 0.8, this.cls.halfBeam(nx) * 0.8);
        if (!this.fires.some((o) => Math.hypot(o.x - nx, o.y - ny) < 10)) this.startFire(nx, ny, f.band, 0.4, rnd);
      }
    }
  }

  startFire(x: number, y: number, band: 'low' | 'high', intensity: number, rnd: () => number): Fire | null {
    const near = this.fires.find((f) => Math.hypot(f.x - x, f.y - y) < 12);
    if (near) { near.intensity = clamp01(near.intensity + intensity * 0.5); near.life += 15; return null; }
    const f: Fire = { id: fireIds++, x, y, band, intensity, life: 40 + rnd() * 60, age: 0 };
    this.fires.push(f);
    this.stats.fires++;
    return f;
  }

  beginSinking(reason: string) {
    if (this.status !== 'active') return;
    this.status = 'sinking';
    this.statusTime = 0;
    this.setOutOfAction(reason);
  }

  explode(atX: number) {
    if (this.status === 'exploded' || this.status === 'sunk') return;
    this.status = 'exploded';
    this.statusTime = 0;
    this.breakAt = atX;
    for (const m of this.modules.values()) { m.hp = 0; m.level = 3; }
    this.setOutOfAction('Magazine detonation');
  }

  setOutOfAction(reason: string) {
    if (this.outOfAction) return;
    this.outOfAction = true;
    this.outReason = reason;
    this.cmd.fire = false;
  }

  private updateSinking(dt: number) {
    const dur = this.status === 'exploded' ? 26 : 48;
    this.sinkProgress = clamp01(this.statusTime / dur);
    this.speed *= 1 - damp(0.15, dt);
    this.yawRate *= 1 - damp(0.3, dt);
    const fwd = fromAngle(this.heading);
    this.pos.x += fwd.x * this.speed * dt;
    this.pos.y += fwd.y * this.speed * dt;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    if (this.status === 'sinking') {
      // she goes down by the head or the stern, whichever is already lower
      this.list += Math.sign(this.list || 1) * dt * 0.006;
      this.trim += Math.sign(this.trim || 1) * dt * 0.0011;
      this.sinkage += dt * 0.25;
    }
    if (this.sinkProgress >= 1) this.status = 'sunk';
    for (const t of this.turrets) t.recoil = 0;
  }

  /** Predict own track for the helm indicator. */
  predictPath(seconds: number, step: number, rudderOverride?: number): Vec2[] {
    const pts: Vec2[] = [];
    let p = { ...this.pos }, h = this.heading, v = this.speed, yaw = this.yawRate, rud = this.rudder;
    const cls = this.cls;
    const wantRud = (rudderOverride ?? this.cmd.rudder) * cls.rudderMax;
    const sf = this.steeringFactor();
    for (let t = 0; t <= seconds; t += step) {
      pts.push({ ...p });
      if (sf > 0) rud = approach(rud, wantRud, cls.rudderRate * sf * step);
      const radius = cls.turnRadius / Math.max(0.05, Math.abs(rud) / cls.rudderMax);
      const ty = rud === 0 ? 0 : Math.sign(rud) * (v / radius) * (v < 0 ? 0.6 : 1);
      yaw += (ty - yaw) * damp(0.32, step);
      h += yaw * step;
      const f = fromAngle(h);
      const slip = -yaw * 34;
      p = { x: p.x + (f.x * v - f.y * slip) * step, y: p.y + (f.y * v + f.x * slip) * step };
    }
    return pts;
  }
}

export const levelFor = (hp: number, max: number): ModuleStateLevel => {
  if (hp <= 0) return 3;
  const f = hp / max;
  return f > 0.75 ? 0 : f > 0.4 ? 1 : 2;
};
