// Runtime state of one ship: manoeuvring, gunnery, internal systems, flooding,
// fires, secondary battery, torpedo tubes, smoke and damage control.

import {
  Vec2, DEG, angleDiff, approach, clamp, clamp01, dist, fromAngle, toWorld, wrapAngle, damp, Rng,
} from '../core/math';
import type { ModuleDef, ModuleKind, SecondaryMountDef, SectionDef, ShipClass, TorpedoMountDef, TurretDef } from './shipClass';
import { AmmoType, DCTarget, ModuleStateLevel, Order, ShipCommand, TeamId, newCommand, telegraphFrac } from './types';
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

export interface SecondaryState {
  def: SecondaryMountDef;
  offset: number;            // traverse offset from rest facing
  desired: number;
  reload: number;
  target: number | null;     // ship id
  recoil: number;
}

export interface TorpedoMountState {
  def: TorpedoMountDef;
  loaded: boolean;
  reload: number;            // seconds remaining (when reloading from spares)
  spares: number;            // spare sets left
  train: number;             // visual: current relative bearing of the tubes (rad, from bow)
}

export interface Hole {
  section: number;
  side: -1 | 1;
  x: number;
  z: number;                 // height of the hole above design waterline
  area: number;              // m^2 (shrinks as damage control shores it)
  area0: number;             // original size
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

export interface DCParty {
  task: DCTarget | null;
  manual: boolean;           // ordered by the captain (otherwise automatic)
  since: number;
}

export type ShipStatus = 'active' | 'sinking' | 'exploded' | 'sunk';

/** Module kinds damage control may restore from "destroyed" (jury rigs). Turrets and magazines cannot be. */
const JURY_RIG: ModuleKind[] = ['steering', 'director', 'bridge', 'funnel', 'engine', 'boiler', 'secondary'];

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
  private byKind = new Map<ModuleKind, ModuleState[]>();
  turrets: TurretState[] = [];
  secondaries: SecondaryState[] = [];
  torpedoMounts: TorpedoMountState[] = [];
  sections: SectionState[] = [];
  holes: Hole[] = [];
  fires: Fire[] = [];
  ammo = new Map<string, Record<AmmoType, number>>();   // magazine id -> counts
  magHeat = new Map<string, number>();
  private fireIds = 1;

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
  fcSettle = 0;                 // how refined the solution is from steady tracking 0..1
  private lastAim: Vec2 | null = null;
  private fcAim: Vec2 | null = null;
  outOfBoundsTime = 0;
  grounded = 0;                 // seconds aground (islands)

  // smoke, damage control
  smokeLeft = 0;                // seconds of smoke generation remaining
  smoking = false;
  dc: DCParty[] = [];
  counterflooding = false;
  /** Sim time of the last main-battery salvo (gun flash reveals the ship). */
  lastSalvoAt = -999;

  // bookkeeping for UI / results
  stats = { salvos: 0, shells: 0, hits: 0, pens: 0, received: 0, citadels: 0, fires: 0, damageDealt: 0, secShells: 0, secHits: 0, torpedoes: 0, torpHits: 0 };

  constructor(id: number, cls: ShipClass, opts: { name: string; team: TeamId; controller: 'player' | 'ai'; pos: Vec2; heading: number; speed?: number; telegraph?: number }, rng: Rng) {
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
    for (const m of cls.modules) {
      const st: ModuleState = { def: m, hp: m.hp, level: 0, flooded: false, lastHit: -99 };
      this.modules.set(m.id, st);
      let arr = this.byKind.get(m.kind);
      if (!arr) { arr = []; this.byKind.set(m.kind, arr); }
      arr.push(st);
    }
    for (const t of cls.turrets) {
      this.turrets.push({ def: t, offset: 0, desired: 0, inArc: true, aligned: false, reload: Math.min(cls.reloadTime * 0.5, 4) + rng.next() * 3, loaded: null, loading: 'AP', recoil: 0, elevation: 0, jam: 0 });
      if (!this.ammo.has(t.magazine)) { this.ammo.set(t.magazine, { ...cls.ammo }); this.magHeat.set(t.magazine, 0); }
    }
    for (const m of cls.secondary?.mounts ?? []) this.secondaries.push({ def: m, offset: 0, desired: 0, reload: rng.next() * 3, target: null, recoil: 0 });
    for (const m of cls.torpedoes?.mounts ?? []) this.torpedoMounts.push({ def: m, loaded: true, reload: 0, spares: cls.torpedoes!.def.reloads, train: m.side === 'port' ? -Math.PI / 2 : Math.PI / 2 });
    for (const s of cls.sections) this.sections.push({ def: s, port: 0, stbd: 0 });
    if (cls.smoke) this.smokeLeft = cls.smoke.duration * cls.smoke.charges;
    for (let i = 0; i < cls.dcParties; i++) this.dc.push({ task: null, manual: false, since: 0 });
  }

  get alive() { return this.status === 'active'; }
  get dir(): Vec2 { return fromAngle(this.heading); }
  mod(id: string) { return this.modules.get(id)!; }
  modsOf(kind: ModuleKind): ModuleState[] { return this.byKind.get(kind) ?? []; }
  private firstOf(kind: ModuleKind): ModuleState | undefined { return this.byKind.get(kind)?.[0]; }

  /** Commands pass through the bridge; a wrecked bridge delays orders (emergency conn aft). */
  setCommand(cmd: ShipCommand, time: number) {
    const bridge = this.firstOf('bridge');
    const lvl = bridge?.level ?? 0;
    const delay = lvl === 3 ? 2.5 : lvl === 2 ? 1.0 : 0;
    const orders = cmd.orders;
    if (orders?.length) for (const o of orders) this.applyOrder(o, time);
    if (delay === 0) { this.cmd = { ...cmd, orders: undefined }; this.cmdQueue.length = 0; return; }
    this.cmdQueue.push({ t: time + delay, cmd: { ...cmd, aim: cmd.aim ? { ...cmd.aim } : null, orders: undefined } });
    // gunnery is controlled from the directors, not the bridge: aim & fire are immediate
    this.cmd.aim = cmd.aim; this.cmd.fire = cmd.fire; this.cmd.ammo = cmd.ammo; this.cmd.torpedo = cmd.torpedo; this.cmd.secondaries = cmd.secondaries;
    this.cmd.smoke = cmd.smoke;
    while (this.cmdQueue.length && this.cmdQueue[0].t <= time) {
      const c = this.cmdQueue.shift()!.cmd;
      this.cmd.telegraph = c.telegraph; this.cmd.rudder = c.rudder;
    }
  }

  // ---------------------------------------------------------------- geometry
  localToWorld(p: Vec2): Vec2 { return toWorld(p, this.pos, this.heading); }
  turretWorld(t: { def: { x: number; y: number } }): Vec2 { return this.localToWorld({ x: t.def.x, y: t.def.y }); }
  /** World bearing the turret's guns currently point along. */
  turretBearing(t: TurretState): number { return wrapAngle(this.heading + t.def.facing + t.offset); }
  secondaryBearing(m: SecondaryState): number { return wrapAngle(this.heading + m.def.facing + m.offset); }
  /** Water level relative to design waterline at local x (positive = deeper). */
  waterRise(x: number) { return this.sinkage + this.trim * x; }

  sectionAt(x: number): number {
    const s = this.sections.findIndex((s) => x >= s.def.x0 && x < s.def.x1);
    if (s >= 0) return s;
    // beyond the ends: the foremost or aftmost section (classes list them in either order)
    let best = 0;
    for (let i = 1; i < this.sections.length; i++) {
      const a = this.sections[i].def, b = this.sections[best].def;
      if (x > 0 ? a.x1 > b.x1 : a.x0 < b.x0) best = i;
    }
    return best;
  }

  // ---------------------------------------------------------------- systems
  propulsionPower(): number {
    let boil = 0, eng = 0;
    const f = [1, 0.75, 0.4, 0];
    const boilers = this.modsOf('boiler'), engines = this.modsOf('engine');
    for (const m of boilers) boil += m.flooded ? 0 : f[m.level];
    for (const m of engines) eng += m.flooded ? 0 : f[m.level];
    const funnels = this.modsOf('funnel');
    let draft = 1;
    for (const m of funnels) draft -= [0, 0.05, 0.1, 0.17][m.level] * (2 / Math.max(2, funnels.length));
    return clamp01(Math.min((boil / Math.max(1, boilers.length)) * draft, eng / Math.max(1, engines.length)));
  }

  steeringFactor(): number {
    const m = this.firstOf('steering');
    if (!m) return 1;
    return Math.min([1, 0.65, 0.3, 0][m.level], m.flooded && m.level < 3 ? 0.3 : 1);
  }

  /** Primary director still able to work the radar and the main battery solution. */
  directorsOk(): number {
    const d = this.modsOf('director');
    if (!d.length) return 1;
    return d.filter((m) => m.level < 3).length / d.length;
  }

  radarRange(): number {
    const d = this.firstOf('director');
    if (!this.cls.radar || (d && d.level === 3)) return 0;
    return this.cls.radar * (d && d.level === 2 ? 0.6 : 1);
  }

  dispersionMult(): number {
    const ds = this.modsOf('director');
    const n = Math.max(1, ds.length);
    let dirLoss = 0;
    for (const m of ds) dirLoss += m.level === 3 ? 1 : m.level * 0.2;
    dirLoss *= 2 / Math.max(2, n);
    let m = 1 + 0.18 * Math.min(dirLoss, 1) + (dirLoss >= 2 || (n === 1 && ds[0].level === 3) ? 0.45 : 0);
    m *= 1 + 0.85 * this.fcError;
    // a fresh solution is rough; holding a steady point of aim refines it well past the nominal spread
    m *= 1.1 - 0.4 * this.fcSettle;
    m *= 1 + Math.abs(this.list) / DEG * 0.025;
    return m;
  }

  dispersionAt(range: number): Dispersion { return baseDispersion(range, this.cls.dispersion, this.dispersionMult()); }

  gunsFor(t: TurretState): number {
    const m = this.mod(t.def.id);
    if (m.level === 3) return 0;
    return Math.max(1, Math.round(t.def.guns * [1, 0.67, 0.34][m.level]));
  }

  get totalGuns() { return this.cls.turrets.reduce((a, t) => a + t.guns, 0); }

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

  operableGuns(): number { return this.turrets.reduce((a, t) => a + (this.turretOperable(t) ? this.gunsFor(t) : 0), 0); }

  torpedoMountOk(m: TorpedoMountState): boolean { const md = this.mod(m.def.module); return md.level < 3 && !md.flooded; }
  /** Tubes loaded and usable, plus whether more can still be loaded. */
  torpedoCapacity(): { ready: number; potential: number } {
    let ready = 0, potential = 0;
    for (const m of this.torpedoMounts) {
      if (!this.torpedoMountOk(m)) continue;
      if (m.loaded) ready += m.def.tubes;
      potential += (m.loaded ? 1 : 0) * m.def.tubes + m.spares * m.def.tubes;
    }
    return { ready, potential };
  }

  /** Can the tubes of this mount bear on world bearing `brg`? Returns the relative bearing if so. */
  torpedoBearing(m: TorpedoMountState, brg: number): number | null {
    const rel = wrapAngle(brg - this.heading);
    const sides = m.def.side === 'both' ? [1, -1] : m.def.side === 'stbd' ? [1] : [-1];
    for (const s of sides) if (Math.abs(angleDiff(s * Math.PI / 2, rel)) <= m.def.arc) return rel;
    return null;
  }

  secondaryOk(m: SecondaryState): boolean { const md = this.mod(m.def.module); return md.level < 3; }

  /** Overall condition used by UI & AI, 0..1 each. */
  readiness() {
    const firepower = this.operableGuns() / Math.max(1, this.totalGuns);
    return { firepower, mobility: this.power * (this.steeringFactor() > 0 ? 1 : 0.5), buoyancy: 1 - clamp01(this.floodTotal / this.cls.reserveBuoyancy) };
  }

  // ---------------------------------------------------------------- update
  update(dt: number, time: number, mapHalf: number) {
    this.statusTime += dt;
    if (this.status !== 'active') { this.updateSinking(dt); return; }
    this.power = this.propulsionPower();
    this.updateMovement(dt, mapHalf);
    this.updateTurrets(dt);
    this.updateTorpedoMounts(dt);
    this.updateFireControl(dt);
    // smoke generators burn their oil
    this.smoking = !!this.cmd.smoke && this.smokeLeft > 0 && this.power > 0.1;
    if (this.smoking) this.smokeLeft = Math.max(0, this.smokeLeft - dt);
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
    if (this.grounded > 0) target = 0;
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
    const targetYaw = this.rudder === 0 ? 0 : Math.sign(this.rudder) * (effSpeed / radius) * (effSpeed < 0 ? 0.6 : 1);
    this.yawRate += (targetYaw - this.yawRate) * damp(0.32, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // drift: stern kicks out in a turn, the ship slides slightly (scaled to hull length)
    const fwd = fromAngle(this.heading);
    const side = { x: -fwd.y, y: fwd.x };
    const slip = -this.yawRate * 34 * (cls.length / 270);
    this.pos.x += (fwd.x * this.speed + side.x * slip) * dt;
    this.pos.y += (fwd.y * this.speed + side.y * slip) * dt;

    const out = Math.abs(this.pos.x) > mapHalf + 1500 || Math.abs(this.pos.y) > mapHalf + 1500;
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
    for (const s of this.secondaries) {
      s.recoil = Math.max(0, s.recoil - dt * 2);
      if (s.reload > 0) s.reload -= dt * (this.mod(s.def.module).level === 2 ? 0.6 : 1);
      const rate = this.cls.secondary!.traverseRate;
      s.offset = approach(s.offset, s.desired, rate * dt);
    }
  }

  private updateTorpedoMounts(dt: number) {
    const aim = this.cmd.aim;
    for (const m of this.torpedoMounts) {
      // spare torpedoes are hoisted into empty tubes
      if (!m.loaded && m.spares > 0 && this.torpedoMountOk(m)) {
        m.reload -= dt;
        if (m.reload <= 0) { m.loaded = true; m.spares--; m.reload = 0; }
      }
      // tubes train toward the aim side (visual, and so the player sees which mount bears)
      if (aim) {
        const p = this.turretWorld(m);
        const brg = Math.atan2(aim.y - p.y, aim.x - p.x);
        const rel = this.torpedoBearing(m, brg);
        const rest = m.def.side === 'port' ? -Math.PI / 2 : m.def.side === 'stbd' ? Math.PI / 2 : (wrapAngle(brg - this.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2);
        const want = rel ?? rest;
        m.train += clamp(angleDiff(m.train, want), -dt * 0.6, dt * 0.6);
      }
    }
  }

  private updateFireControl(dt: number) {
    // A good firing solution needs a steady platform and a steady point of aim.
    const aim = this.cmd.aim;
    let disturb = Math.abs(this.yawRate) / DEG * 0.085 * (this.cls.type === 'DD' ? 0.6 : 1);
    if (aim && this.lastAim) {
      const range = Math.max(800, dist(this.pos, aim));
      // switching to a new point of aim starts the solution again; spotting corrections don't
      if (dist(aim, this.lastAim) > Math.max(700, range * 0.05)) this.fcSettle *= 0.25;
      // the director follows the ordered point of aim smoothly, so plot updates don't read as a slew
      const prev = this.fcAim ?? aim, k = damp(3, dt);
      this.fcAim = { x: prev.x + (aim.x - prev.x) * k, y: prev.y + (aim.y - prev.y) * k };
      const moved = dist(this.fcAim, prev) / range; // radians of aim change
      disturb += (moved / dt) / DEG * 0.11;
    } else this.fcAim = aim ? { ...aim } : null;
    if (!aim) this.fcSettle = 0;
    this.lastAim = aim ? { ...aim } : null;
    const target = clamp01(disturb);
    if (target > this.fcError) this.fcError += (target - this.fcError) * damp(3.5, dt);
    else this.fcError += (target - this.fcError) * damp(0.32, dt);
    // the plot refines only while the solution is steady; manoeuvring or slewing erodes it
    const settleTime = this.cls.type === 'DD' ? 5 : this.cls.type === 'BB' ? 11 : 8;
    if (this.fcError < 0.2) this.fcSettle = Math.min(1, this.fcSettle + dt / settleTime * (1 - this.fcError * 5) * this.directorsOk());
    else this.fcSettle = Math.max(0, this.fcSettle - dt * (this.fcError - 0.2) * 1.5);
  }

  // ---------------------------------------------------------------- damage control
  private applyOrder(o: Order, time: number) {
    if (this.status !== 'active') return;
    if (o.kind === 'counterflood') { this.counterflooding = true; return; }
    if (o.kind === 'dcAuto') { for (const p of this.dc) { p.manual = false; } return; }
    if (o.kind === 'dc') {
      if (!this.dc.length) return;
      // already on it?
      const same = this.dc.find((p) => p.task && sameTarget(p.task, o.target));
      if (same) { same.manual = true; return; }
      // take an idle party, else the automatic one that started longest ago, else the oldest manual one
      const pick = this.dc.find((p) => !p.task) ?? [...this.dc].filter((p) => !p.manual).sort((a, b) => a.since - b.since)[0] ?? [...this.dc].sort((a, b) => a.since - b.since)[0];
      pick.task = o.target; pick.manual = true; pick.since = time;
    }
  }

  /** Is there anything for damage control to do at this target? */
  dcNeeded(t: DCTarget): boolean {
    if (t.type === 'section') {
      const i = t.index;
      const sec = this.sections[i];
      if (!sec) return false;
      if (this.fires.some((f) => this.sectionAt(f.x) === i)) return true;
      if (this.holes.some((h) => h.section === i && h.area > 0.02 && this.waterRise(h.x) - h.z > -0.5)) return true;
      return false;
    }
    const m = this.modules.get(t.id);
    if (!m) return false;
    if (m.flooded) return this.canUnflood(m);
    return m.hp < this.repairCap(m) - 0.5;
  }

  repairCap(m: ModuleState): number {
    // gunhouses and magazines are beyond a damage-control party in action
    if (m.def.kind === 'turret' || m.def.kind === 'magazine') return 0;
    if (m.hp <= 0 && !JURY_RIG.includes(m.def.kind)) return 0;
    return m.def.hp * (m.hp <= 0 ? 0.25 : 0.55);
  }

  private canUnflood(m: ModuleState): boolean {
    if (m.def.kind === 'magazine') return false; // deliberately flooded to save the ship
    const s = this.sections[this.sectionAt((m.def.rect.x0 + m.def.rect.x1) / 2)];
    return (s.port + s.stbd) / s.def.capacity < 0.4;
  }

  /** Priority list for automatic damage control (also what AI captains do). */
  private autoTask(taken: DCTarget[]): DCTarget | null {
    let best: DCTarget | null = null, bs = 0;
    const consider = (t: DCTarget, score: number) => { if (score > bs && !taken.some((q) => sameTarget(q, t)) && this.dcNeeded(t)) { bs = score; best = t; } };
    // flooding & fire, per section
    for (let i = 0; i < this.sections.length; i++) {
      let s = 0;
      for (const f of this.fires) if (this.sectionAt(f.x) === i) {
        s += 3 + f.intensity * 4;
        // fire near a magazine is the emergency
        for (const m of this.modsOf('magazine')) if (!m.flooded && f.x >= m.def.rect.x0 - 10 && f.x <= m.def.rect.x1 + 10) s += 8;
      }
      for (const h of this.holes) if (h.section === i && h.area > 0.02) {
        const depth = this.waterRise(h.x) - h.z;
        if (depth > -0.5) s += 2 + h.area * 3 * (1 + Math.max(0, depth) * 0.3) * (1 + 2 * clamp01(this.floodTotal / this.cls.reserveBuoyancy));
      }
      consider({ type: 'section', index: i }, s);
    }
    // repairs: what matters most for fighting and survival
    const weight: Partial<Record<ModuleKind, number>> = { steering: 9, engine: 6, boiler: 5, director: 4, bridge: 3, secondary: 1.5, funnel: 1, torpedo: 2 };
    for (const m of this.modules.values()) {
      const w = weight[m.def.kind] ?? 0;
      if (!w) continue;
      const deficit = 1 - m.hp / m.def.hp;
      consider({ type: 'module', id: m.def.id }, w * deficit * (m.level === 3 ? 1.6 : 1) + (m.flooded ? 2 : 0));
    }
    return best as DCTarget | null;
  }

  /** Damage-control parties: fight fires, shore holes, pump, and patch up machinery. */
  updateDamageControl(dt: number, time: number, onEvent: (e: string, extra?: any) => void) {
    // re-plan automatic parties every couple of seconds, finished tasks immediately
    for (const p of this.dc) {
      if (p.task && !this.dcNeeded(p.task)) { p.task = null; p.manual = false; }
    }
    if (Math.floor(time * 0.5) !== Math.floor((time - dt) * 0.5) || this.dc.some((p) => !p.task)) {
      for (const p of this.dc) {
        if (p.manual && p.task) continue;
        const taken = this.dc.filter((q) => q !== p && q.task).map((q) => q.task!);
        const t = this.autoTask(taken);
        if (t && (!p.task || !sameTarget(p.task, t))) { p.task = t; p.since = time; }
      }
    }
    for (const p of this.dc) {
      const t = p.task;
      if (!t) continue;
      if (t.type === 'section') {
        // fires in the section are beaten down
        for (const f of this.fires) if (this.sectionAt(f.x) === t.index) { f.intensity = Math.max(0, f.intensity - dt * 0.035); f.life = Math.min(f.life, f.age + 25); }
        // shore the worst hole that is letting water in
        let worst: Hole | null = null;
        for (const h of this.holes) if (h.section === t.index && h.area > 0.02 && this.waterRise(h.x) - h.z > -0.5 && (!worst || h.area > worst.area)) worst = h;
        if (worst) worst.area = Math.max(0, worst.area - dt * (0.018 + worst.area0 * 0.006));
        // portable pumps
        const sec = this.sections[t.index];
        const tot = sec.port + sec.stbd;
        if (tot > 0) { const k = Math.max(0, tot - dt * this.cls.pumpRate * 0.25) / tot; sec.port *= k; sec.stbd *= k; }
      } else {
        const m = this.modules.get(t.id);
        if (!m) continue;
        if (m.flooded) { if (this.canUnflood(m)) { m.flooded = false; onEvent('moduleRestored', m); } continue; }
        const cap = this.repairCap(m);
        if (m.hp < cap) {
          const before = m.level;
          m.hp = Math.min(cap, m.hp + m.def.hp * 0.0045 * dt);
          m.level = levelFor(m.hp, m.def.hp);
          if (m.level < before) onEvent('repaired', m);
        }
      }
    }
  }

  // ---------------------------------------------------------------- buoyancy
  /** Flooding, pumping, counter-flooding and hydrostatics. */
  updateBuoyancy(dt: number, time: number, onEvent: (e: string, extra?: any) => void) {
    const cls = this.cls;
    // flooding through holes
    const g = 9.81;
    const beamArm = cls.beam * 0.48;
    for (const h of this.holes) {
      if (h.area <= 0.005) continue;
      const sec = this.sections[h.section];
      const depth = this.waterRise(h.x) - h.z + Math.sin(this.list) * beamArm * h.side;
      if (depth <= 0) continue;
      const cap = sec.def.capacity / 2;
      const key = h.side > 0 ? 'stbd' : 'port';
      if (sec[key] >= cap) continue;
      const q = 0.62 * h.area * Math.sqrt(2 * g * depth) * 1.025; // t/s
      sec[key] = Math.min(cap, sec[key] + q * dt);
    }
    // counter-flooding: open the opposite wing voids until she comes upright
    if (this.counterflooding) {
      const listDeg = this.list / DEG;
      if (Math.abs(listDeg) < 0.6) this.counterflooding = false;
      else {
        const lowSide = listDeg > 0 ? 'stbd' : 'port', highSide = listDeg > 0 ? 'port' : 'stbd';
        const rate = cls.reserveBuoyancy * 0.0016 * dt;
        // flood the high side of the sections with the worst imbalance first
        const order = [...this.sections].sort((a, b) => (b[lowSide] - b[highSide]) - (a[lowSide] - a[highSide]));
        let left = rate;
        for (const s of order) {
          if (left <= 0) break;
          const room = s.def.capacity / 2 - s[highSide];
          const want = Math.max(0, s[lowSide] - s[highSide]);
          const add = Math.min(left, room, want > 0 ? want : room * 0.2);
          if (add > 0) { s[highSide] += add; left -= add; }
        }
        if (left >= rate * 0.999) this.counterflooding = false; // nothing left to flood
      }
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
    const half = cls.length / 2;
    const trimTarget = mom / (cls.reserveBuoyancy * half) * 0.075;
    this.trim += (trimTarget - this.trim) * damp(0.25, dt);
    // a given off-centre weight lists a small ship more (scaled on Iowa: 2,400 t -> 6°)
    const listTarget = (side / (cls.reserveBuoyancy * 0.126)) * 6 * DEG * (1 + frac);
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
    const half = this.cls.length / 2 - 3;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      // the crew gradually beats fires down even without a dedicated party (slowly)
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
        if (!sameBand && m.def.kind !== 'turret' && m.def.kind !== 'torpedo') continue;
        const rate = (m.def.kind === 'magazine' ? 0 : m.def.kind === 'turret' ? 0.35 : 0.9) * f.intensity * (1 - d / 9) * (this.cls.type === 'DD' ? 0.6 : 1);
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
        const nx = clamp(f.x + (rnd() - 0.5) * 34, -half, half);
        const ny = clamp(f.y + (rnd() - 0.5) * 14, -this.cls.halfBeam(nx) * 0.8, this.cls.halfBeam(nx) * 0.8);
        if (!this.fires.some((o) => Math.hypot(o.x - nx, o.y - ny) < 10)) this.startFire(nx, ny, f.band, 0.4, rnd);
      }
    }
  }

  startFire(x: number, y: number, band: 'low' | 'high', intensity: number, rnd: () => number): Fire | null {
    const near = this.fires.find((f) => Math.hypot(f.x - x, f.y - y) < 12);
    if (near) { near.intensity = clamp01(near.intensity + intensity * 0.5); near.life += 15; return null; }
    const f: Fire = { id: this.fireIds++, x, y, band, intensity, life: 40 + rnd() * 60, age: 0 };
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

  /** The hull parts at atX: magazine detonation, or a torpedo breaking a small ship's back. */
  explode(atX: number, reason = 'Magazine detonation') {
    if (this.status === 'exploded' || this.status === 'sunk') return;
    this.status = 'exploded';
    this.statusTime = 0;
    this.breakAt = atX;
    for (const m of this.modules.values()) { m.hp = 0; m.level = 3; }
    this.setOutOfAction(reason);
  }

  setOutOfAction(reason: string) {
    if (this.outOfAction) return;
    this.outOfAction = true;
    this.outReason = reason;
    this.cmd.fire = false;
    this.cmd.smoke = false;
  }

  private updateSinking(dt: number) {
    const dur = (this.status === 'exploded' ? 26 : 48) * (this.cls.type === 'DD' ? 0.6 : 1);
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
    let p = { ...this.pos }, h = this.heading, yaw = this.yawRate, rud = this.rudder;
    const v = this.speed;
    const cls = this.cls;
    const wantRud = (rudderOverride ?? this.cmd.rudder) * cls.rudderMax;
    const sf = this.steeringFactor();
    const slipK = 34 * (cls.length / 270);
    for (let t = 0; t <= seconds; t += step) {
      pts.push({ ...p });
      if (sf > 0) rud = approach(rud, wantRud, cls.rudderRate * sf * step);
      const radius = cls.turnRadius / Math.max(0.05, Math.abs(rud) / cls.rudderMax);
      const ty = rud === 0 ? 0 : Math.sign(rud) * (v / radius) * (v < 0 ? 0.6 : 1);
      yaw += (ty - yaw) * damp(0.32, step);
      h += yaw * step;
      const f = fromAngle(h);
      const slip = -yaw * slipK;
      p = { x: p.x + (f.x * v - f.y * slip) * step, y: p.y + (f.y * v + f.x * slip) * step };
    }
    return pts;
  }
}

export const sameTarget = (a: DCTarget, b: DCTarget) => a.type === b.type && (a.type === 'section' ? a.index === (b as any).index : a.id === (b as any).id);

export const levelFor = (hp: number, max: number): ModuleStateLevel => {
  if (hp <= 0) return 3;
  const f = hp / max;
  return f > 0.75 ? 0 : f > 0.4 ? 1 : 2;
};
