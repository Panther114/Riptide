// Ship AI, organised in two layers so it scales to fleet actions:
//
//   TeamCommander  — one per team. Looks at the whole picture every few seconds,
//                    assigns targets (concentration of fire, destroyers onto the
//                    enemy's heavy ships), and sets doctrine: press, hold or open
//                    the range, from relative fighting strength.
//   CaptainAI      — one per AI ship. Ship-handling and gunnery: keeps guns
//                    bearing while angling the armour, manages range, evades
//                    incoming salvos and torpedoes, avoids land, runs a spotting
//                    /bracketing loop to walk salvos onto the target, and — for
//                    torpedo craft — plans and executes torpedo attacks under smoke.
//
// The AI reads only what a real ship could observe: enemies its team has in
// sight (visual or radar, see World.detects) with ranging noise, last-known
// positions of the rest, visible torpedo tracks and its own fall of shot.

import { DEG, Rng, Vec2, angleDiff, clamp, dist, fromAngle, wrapAngle, add, scale, sub } from '../core/math';
import { flightTime, penetration, strikeVelocity } from '../sim/ballistics';
import type { Ship } from '../sim/ship';
import type { World, WorldEvent } from '../sim/world';
import type { ShipCommand, TeamId } from '../sim/types';
import { coastDistance } from '../sim/terrain';

type DoctrineMode = 'press' | 'hold' | 'open';

const SKILL = {
  cadet: { rangeErr: 650, latErr: 110, correct: 0.45, react: 1.6, patience: 0.55, trackNoise: 1.6, torpNoise: 0.08 },
  officer: { rangeErr: 340, latErr: 50, correct: 0.68, react: 1.0, patience: 0.75, trackNoise: 0.8, torpNoise: 0.045 },
  admiral: { rangeErr: 320, latErr: 45, correct: 0.72, react: 0.6, patience: 0.9, trackNoise: 0.7, torpNoise: 0.03 },
};

const heavy = (s: Ship) => s.cls.type !== 'DD';

export class TeamCommander {
  team: TeamId;
  targets = new Map<number, number>(); // ship id -> target id
  mode: DoctrineMode = 'hold';
  private timer = 0;
  constructor(team: TeamId) { this.team = team; }

  /** Engagement band for a ship as fractions of its gun range, by doctrine. */
  band(s: Ship): { min: number; max: number } {
    const R = s.cls.maxRange;
    if (this.mode === 'press') return { min: R * 0.35, max: R * 0.52 };
    if (this.mode === 'open') return { min: R * 0.6, max: R * 0.8 };
    return { min: R * 0.44, max: R * 0.63 };
  }

  update(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 4;
    const mine = world.ships.filter((s) => s.team === this.team && !s.outOfAction);
    const seen = world.visible[this.team];
    const foes = world.ships.filter((s) => s.team !== this.team && !s.outOfAction && s.status === 'active');
    const visibleFoes = foes.filter((f) => seen.has(f.id));
    // a target we have lost sight of is still worth hunting for a while
    const known = foes.filter((f) => seen.has(f.id) || ((world.contacts[this.team].get(f.id)?.t ?? -1e9) > world.time - 90));
    const pool = visibleFoes.length ? visibleFoes : known;
    if (!pool.length) { this.targets.clear(); return; }
    // Concentrate fire: prefer damaged and close enemies, but spread if heavily outnumbering.
    const score = (me: Ship, f: Ship) => {
      const r = f.readiness();
      let s = dist(me.pos, f.pos) / 1000 + r.firepower * 6 + r.buoyancy * 3 - (f.fires.length ? 1 : 0);
      if (!seen.has(f.id)) s += 8;
      // destroyers go for the heavy ships; heavy ships are drawn to big threats but swat close destroyers
      if (me.cls.type === 'DD') s += heavy(f) ? -6 : 4;
      else if (f.cls.type === 'DD') s += dist(me.pos, f.pos) < 9000 ? -2 : 5;
      return s;
    };
    const load = new Map<number, number>();
    for (const me of mine) {
      let best: Ship | null = null, bs = Infinity;
      for (const f of pool) {
        const s = score(me, f) + (load.get(f.id) ?? 0) * (mine.length > pool.length * 2 ? 3 : 0.5);
        if (s < bs) { bs = s; best = f; }
      }
      if (best) { this.targets.set(me.id, best.id); load.set(best.id, (load.get(best.id) ?? 0) + 1); }
    }
    // Doctrine: compare our fighting strength to theirs.
    const ratio = world.strength(this.team) / Math.max(0.01, world.strength(this.team === 'blue' ? 'red' : 'blue'));
    this.mode = ratio > 1.35 ? 'press' : ratio < 0.7 ? 'open' : 'hold';
  }
}

interface Track { pos: Vec2; vel: Vec2; t: number }
type DDPhase = 'approach' | 'attack' | 'retire';

export class CaptainAI {
  ship: Ship;
  cmdr: TeamCommander;
  private rng: Rng;
  private skill: typeof SKILL.officer;
  private track = new Map<number, Track>();
  private rangeBias = 0;           // spotting correction state, metres along line of fire
  private latBias = 0;
  private biasTarget = -1;
  private weaveTimer = 0;
  private weave = 0;
  private side = 1;                // which side we present: +1 keep target to starboard
  private sideTimer = 0;
  private telegraph = 4;
  private speedOrder = 4;
  private observing: { salvo: number; target: number; errs: number[]; latErrs: number[]; t: number; rb: number; lb: number }[] = [];
  /** Spotting corrections in force when each salvo was fired (several salvos can be in the air at once). */
  private biasHistory: { t: number; rb: number; lb: number }[] = [];
  private holdFire = 0;
  private ammo: 'AP' | 'HC' = 'AP';
  private underFire = -999;        // last time shells fell close
  private smokeUntil = 0;
  private evade: { heading: number; until: number } | null = null;
  private phase: DDPhase = 'approach';
  private phaseTimer = 0;
  private torpCooldown = 0;
  private lastCF = -999;

  constructor(ship: Ship, cmdr: TeamCommander, seed: number, difficulty: keyof typeof SKILL) {
    this.ship = ship; this.cmdr = cmdr;
    this.rng = new Rng(seed);
    this.skill = SKILL[difficulty];
    this.weaveTimer = 10 + this.rng.next() * 15;
  }

  /** Observe world events — fall of shot of our own salvos, shells landing around us. */
  observe(e: WorldEvent, world: World) {
    const me = this.ship;
    if (e.type === 'splash' || e.type === 'hit') {
      const sh = e.shell;
      if (sh.shooter !== me.id) {
        // incoming fire landing close: urge to change course (chasing salvos)
        if (sh.team !== me.team && dist(e.pos, me.pos) < 600) {
          this.underFire = world.time;
          if (this.weaveTimer > 3) this.weaveTimer = 1 + this.rng.next() * 3 * this.skill.react;
        }
        return;
      }
      if (sh.secondary) return;
      const tgt = world.shipById(this.cmdr.targets.get(me.id) ?? -1);
      if (!tgt) return;
      let ob = this.observing.find((o) => o.salvo === sh.salvo);
      if (!ob) {
        // the correction this salvo was laid with
        const fired = world.time - sh.T;
        let h = this.biasHistory[0] ?? { t: 0, rb: this.rangeBias, lb: this.latBias };
        for (const q of this.biasHistory) if (q.t <= fired + 0.05) h = q;
        ob = { salvo: sh.salvo, target: tgt.id, errs: [], latErrs: [], t: world.time, rb: h.rb, lb: h.lb };
        this.observing.push(ob);
      }
      // a salvo laid beyond maximum range tells us nothing about the range error
      if (dist(sh.origin, sh.aimPoint) > me.cls.maxRange * 0.98) return;
      // Spotters estimate whether splashes fell over or short, and left or right.
      const fwd = fromAngle(Math.atan2(sh.target.y - sh.origin.y, sh.target.x - sh.origin.x));
      const rel = { x: e.pos.x - tgt.pos.x, y: e.pos.y - tgt.pos.y };
      const along = rel.x * fwd.x + rel.y * fwd.y;
      const across = rel.x * -fwd.y + rel.y * fwd.x;
      const noise = this.rng.gauss() * 60 * this.skill.trackNoise;
      ob.errs.push(e.type === 'hit' ? along * 0.3 : along + noise);
      ob.latErrs.push(across + this.rng.gauss() * 20);
    } else if (e.type === 'torpHit' && e.report.ship === me) {
      this.underFire = world.time;
    }
  }

  update(world: World, dt: number): ShipCommand {
    const me = this.ship;
    const cmd: ShipCommand = { telegraph: this.telegraph, rudder: 0, aim: null, fire: false, ammo: this.ammo, torpedo: null, smoke: false, secondaries: true };
    if (!me.alive) return cmd;
    const visible = world.visible[me.team];
    const assigned = world.shipById(this.cmdr.targets.get(me.id) ?? -1);
    let tgt = assigned && !assigned.outOfAction ? assigned : undefined;
    // for gunnery we need a target in sight: fall back to the nearest visible enemy
    const visFoes = world.visibleEnemiesOf(me).filter((s) => !s.outOfAction && s.status === 'active');
    let gunTgt = tgt && visible.has(tgt.id) ? tgt : undefined;
    if (!gunTgt && visFoes.length) gunTgt = visFoes.reduce((a, b) => (dist(a.pos, me.pos) < dist(b.pos, me.pos) ? a : b));
    // destroyers shoot at what threatens them most closely while running in
    if (me.cls.type === 'DD' && visFoes.length) {
      const near = visFoes.reduce((a, b) => (dist(a.pos, me.pos) < dist(b.pos, me.pos) ? a : b));
      if (dist(near.pos, me.pos) < me.cls.maxRange * 0.9) gunTgt = near;
    }
    if (!tgt) tgt = gunTgt;

    // process spotting reports once the whole salvo has landed
    for (let i = this.observing.length - 1; i >= 0; i--) {
      const ob = this.observing[i];
      if (world.time - ob.t > 1.5) {
        if (ob.target === this.biasTarget && ob.errs.length) {
          const mean = ob.errs.reduce((a, b) => a + b, 0) / ob.errs.length;
          const lat = ob.latErrs.reduce((a, b) => a + b, 0) / ob.latErrs.length;
          // correct relative to the aim this salvo actually used, not the current one
          const lim = Math.max(1500, me.cls.maxRange * 0.15);
          this.rangeBias = clamp(ob.rb - mean * this.skill.correct, -lim, lim);
          this.latBias = clamp(ob.lb - lat * this.skill.correct * 0.8, -lim / 3, lim / 3);
        }
        this.observing.splice(i, 1);
      }
    }

    // ------------------------------------------------ tracking (noisy observation of the gun target)
    let est: Track | null = null;
    if (gunTgt) {
      const range = dist(me.pos, gunTgt.pos);
      const noise = (range / 1000) * 9 * this.skill.trackNoise;
      const meas = { x: gunTgt.pos.x + this.rng.gauss() * noise, y: gunTgt.pos.y + this.rng.gauss() * noise };
      const prev = this.track.get(gunTgt.id);
      // rangefinder/plot updates about once a second; predict in between
      if (!prev || world.time - prev.t > 20) est = { pos: meas, vel: fromAngle(gunTgt.heading, gunTgt.speed * (0.7 + this.rng.next() * 0.6)), t: world.time };
      else if (world.time - prev.t >= 1) {
        const pdt = world.time - prev.t;
        const pred = add(prev.pos, scale(prev.vel, pdt));
        const a = 0.3, b = 0.05;
        const res = { x: meas.x - pred.x, y: meas.y - pred.y };
        est = { pos: add(pred, scale(res, a)), vel: add(prev.vel, scale(res, b / pdt)), t: world.time };
      } else est = prev;
      this.track.set(gunTgt.id, est);
      if (this.biasTarget !== gunTgt.id) {
        this.biasTarget = gunTgt.id;
        const k = Math.min(1, range / 15000) + 0.3;
        this.rangeBias = this.rng.gauss() * this.skill.rangeErr * k;
        this.latBias = this.rng.gauss() * this.skill.latErr * k;
      }
    }

    // where to steer relative to: the assigned target (seen, or its last known position)
    let navPos: Vec2 | null = null, navVel: Vec2 = { x: 0, y: 0 };
    if (tgt && visible.has(tgt.id)) { navPos = tgt.pos; navVel = fromAngle(tgt.heading, tgt.speed); }
    else if (tgt) { const c = world.contacts[me.team].get(tgt.id); if (c) { navPos = add(c.pos, scale(fromAngle(c.heading, c.speed), Math.min(120, world.time - c.t))); } }
    if (!navPos) {
      // nothing known: steam towards the most recent contact, else the centre of the battle area
      let last: Vec2 | null = null, lt = -1;
      for (const c of world.contacts[me.team].values()) if (c.t > lt) { lt = c.t; last = c.pos; }
      navPos = last ?? { x: 0, y: 0 };
    }

    // ------------------------------------------------ navigation
    let desired = me.heading;
    const range = dist(me.pos, navPos);
    const brg = Math.atan2(navPos.y - me.pos.y, navPos.x - me.pos.x);
    this.sideTimer -= dt;
    const relNow = angleDiff(me.heading, brg);
    if (this.sideTimer <= 0) { this.side = relNow >= 0 ? 1 : -1; this.sideTimer = 40; }
    const r = me.readiness();
    const torps = me.torpedoCapacity();
    this.torpCooldown -= dt;

    if (me.cls.type === 'DD' && torps.potential > 0 && tgt) {
      desired = this.destroyerAttack(world, me, tgt, navPos, navVel, range, brg, cmd, dt);
    } else {
      const band = this.bandFor(me);
      let off = 50 * DEG; // ~50° off the bow keeps every turret bearing while angling the belt
      if (me.cls.type === 'DD') off = 70 * DEG;
      if (range > band.max) off = this.cmdr.mode === 'press' ? 22 * DEG : 32 * DEG;
      else if (range < band.min) off = 118 * DEG;
      if (r.buoyancy < 0.45 || r.firepower < 0.34) off = Math.max(off, 105 * DEG); // break off, but keep guns bearing
      desired = wrapAngle(brg - this.side * off);
      // weave to throw off the enemy's fire control
      this.weaveTimer -= dt;
      if (this.weaveTimer <= 0) {
        this.weave = (this.rng.next() - 0.5) * 2 * 24 * DEG;
        this.weaveTimer = (me.cls.type === 'BB' ? 18 : 10) + this.rng.next() * 22;
        // occasionally change speed too: it spoils the enemy's rate solution
        this.speedOrder = this.rng.next() < 0.3 ? 3 : 4;
      }
      desired = wrapAngle(desired + this.weave);
      // cruisers with torpedoes use them when a heavy target is in reach
      if (me.cls.torpedoes && gunTgt && est) this.tryTorpedoes(world, me, gunTgt, est, cmd, 0.55);
      // light ships under heavy fire hide in smoke
      if (me.cls.smoke && world.time - this.underFire < 6 && r.buoyancy < 0.85) this.smokeUntil = world.time + 25;
    }

    // torpedo tracks we can see: turn to comb them
    desired = this.evadeTorpedoes(world, me, desired);
    // stay inside the battle area
    const half = world.mapHalf * 0.86;
    const edge = Math.max(Math.abs(me.pos.x), Math.abs(me.pos.y));
    if (edge > half) {
      const toCenter = Math.atan2(-me.pos.y, -me.pos.x);
      const w = clamp((edge - half) / (world.mapHalf * 0.05), 0, 1);
      desired = wrapAngle(desired + angleDiff(desired, toCenter) * w);
    }
    // avoid collisions with any ship nearby
    for (const o of world.ships) {
      if (o === me || o.status === 'sunk') continue;
      const d = dist(me.pos, o.pos);
      const keep = (me.cls.length + o.cls.length) * 2.6 + 500;
      if (d < keep) {
        const away = Math.atan2(me.pos.y - o.pos.y, me.pos.x - o.pos.x);
        const w = clamp((keep - d) / (keep * 0.65), 0, 1);
        desired = wrapAngle(desired + angleDiff(desired, away) * w * 0.8);
      }
    }
    desired = this.avoidLand(world, me, desired);
    const err = angleDiff(me.heading, desired);
    cmd.rudder = clamp(err * 2.6 - me.yawRate * 18, -1, 1);
    if (Math.abs(cmd.rudder) < 0.06) cmd.rudder = 0;
    if (me.grounded > 0) { this.speedOrder = -2; }
    else if (this.speedOrder < 0) this.speedOrder = 4;
    this.telegraph = this.speedOrder;
    cmd.telegraph = this.telegraph;
    cmd.smoke = world.time < this.smokeUntil;

    // damage control: correct a dangerous list
    if (Math.abs(me.list) > 5.5 * DEG && world.time - this.lastCF > 20) { cmd.orders = [{ kind: 'counterflood' }]; this.lastCF = world.time; }

    // ------------------------------------------------ gunnery
    if (gunTgt && est) {
      const now = add(est.pos, scale(est.vel, world.time - est.t));
      const grange = dist(me.pos, now);
      const ammoDef = me.cls.shells[this.ammo];
      const tof = flightTime(grange, ammoDef);
      // lead the target: predicted position at impact
      let aim = add(now, scale(est.vel, tof));
      const gbrg = Math.atan2(aim.y - me.pos.y, aim.x - me.pos.x);
      const fwd = fromAngle(gbrg), lat = { x: -fwd.y, y: fwd.x };
      aim = add(aim, add(scale(fwd, this.rangeBias), scale(lat, this.latBias)));
      cmd.aim = aim;
      this.ammo = this.chooseAmmo(me, gunTgt, grange);
      cmd.ammo = this.ammo;

      const ready = me.turrets.filter((t) => t.loaded && t.aligned && me.gunsFor(t) > 0).length;
      const operable = me.turrets.filter((t) => me.turretOperable(t)).length;
      const loadingSoon = me.turrets.filter((t) => !t.loaded && me.turretOperable(t) && t.reload < 4).length;
      const solid = me.fcError < 0.35 * (2 - this.skill.patience);
      this.holdFire -= dt;
      if (grange < me.cls.maxRange * 0.99 && solid && this.holdFire <= 0) {
        if (ready >= Math.max(1, operable - (loadingSoon ? 0 : 1)) || (ready >= 1 && operable === 1) || (me.cls.type === 'DD' && ready >= 1)) {
          cmd.fire = true;
          this.holdFire = Math.min(1.5, me.cls.reloadTime * 0.3);
          this.biasHistory.push({ t: world.time, rb: this.rangeBias, lb: this.latBias });
          while (this.biasHistory.length > 40) this.biasHistory.shift();
        }
      }
    } else if (navPos) {
      // keep the turrets trained toward where the enemy is expected
      cmd.aim = navPos;
    }
    return cmd;
  }

  private bandFor(me: Ship) {
    const b = this.cmdr.band(me);
    // light cruisers & destroyers keep clear of battleship guns when they can
    return b;
  }

  /** AP only where it can get through the armour that matters; HE against light ships and at extreme range. */
  private chooseAmmo(me: Ship, t: Ship, range: number): 'AP' | 'HC' {
    if (t.cls.type === 'DD') return 'HC';
    const ap = me.cls.shells.AP;
    if (ap.caliber >= 280) return range > me.cls.maxRange * 0.93 && t.cls.type !== 'BB' ? 'HC' : 'AP';
    const belt = Math.max(...t.cls.zones.filter((z) => z.citadel).map((z) => z.belt), 0);
    const pen = penetration(strikeVelocity(range, ap), ap);
    return pen > belt * 1.3 ? 'AP' : 'HC';
  }

  /** Torpedo craft: run in (weaving, under smoke if fired upon), launch at the intercept, turn away. */
  private destroyerAttack(world: World, me: Ship, tgt: Ship, pos: Vec2, vel: Vec2, range: number, brg: number, cmd: ShipCommand, dt: number): number {
    const td = me.cls.torpedoes!.def;
    const launchRange = td.slow ? Math.min(td.slow.range * 0.6, 9000) : Math.min(td.range * 0.8, td.range > 10000 ? 11000 : td.range * 0.82);
    const caps = me.torpedoCapacity();
    this.phaseTimer -= dt;
    this.speedOrder = 4;
    if (this.phase === 'approach') {
      if (range < launchRange) this.phase = 'attack';
      if (world.time - this.underFire < 5 && me.cls.smoke && range < launchRange * 1.8) this.smokeUntil = world.time + 12;
      // close on an intercept course aimed ahead of the target's bow, weaving to spoil her gunnery
      this.weaveTimer -= dt;
      if (this.weaveTimer <= 0) { this.weave = (this.rng.next() - 0.5) * 2 * 14 * DEG; this.weaveTimer = 6 + this.rng.next() * 8; }
      const ahead = add(pos, scale(vel, 45));
      const ic = intercept(ahead, vel, me.pos, me.cls.maxSpeed * Math.cbrt(Math.max(0.05, me.power)) * 0.95);
      const goal = ic ? ic.p : add(pos, scale(vel, range / (me.cls.maxSpeed * 1.2)));
      const lb = Math.atan2(goal.y - me.pos.y, goal.x - me.pos.x);
      return wrapAngle(lb + this.weave);
    }
    if (this.phase === 'attack') {
      // swing to bring the tubes to bear on the beam
      const desired = wrapAngle(brg - this.side * 80 * DEG);
      const fired = this.tryTorpedoes(world, me, tgt, { pos, vel, t: world.time }, cmd, 1);
      if (fired || caps.ready === 0) {
        this.phase = 'retire'; this.phaseTimer = Math.max(td.reload, 50);
        if (me.cls.smoke) this.smokeUntil = world.time + 22;
      }
      if (range > launchRange * 1.3) this.phase = 'approach';
      return desired;
    }
    // retire: open the range, target astern, until the tubes are reloaded
    if (this.phaseTimer <= 0 && caps.ready > 0) this.phase = 'approach';
    if (world.time - this.underFire < 4 && me.cls.smoke) this.smokeUntil = Math.max(this.smokeUntil, world.time + 10);
    const away = wrapAngle(brg + Math.PI + this.side * 25 * DEG);
    return range > launchRange * 1.6 ? wrapAngle(brg - this.side * 100 * DEG) : away;
  }

  /** Solve the torpedo intercept and launch if the solution is good. Returns true if fired. */
  private tryTorpedoes(world: World, me: Ship, tgt: Ship, est: Track, cmd: ShipCommand, eagerness: number): boolean {
    const td = me.cls.torpedoes?.def;
    if (!td || this.torpCooldown > 0) return false;
    if (!heavy(tgt) && eagerness < 1) return false;
    if (!me.torpedoMounts.some((m) => m.loaded && me.torpedoMountOk(m))) return false;
    // intercept at the fast setting, else (torpedo craft only) the long-range slow one
    const reach = eagerness >= 1 ? 0.92 : 0.55;
    let hit = intercept(est.pos, est.vel, me.pos, td.speed);
    if (hit && td.speed * hit.t > td.range * reach) hit = null;
    if (!hit && td.slow && eagerness >= 1) {
      hit = intercept(est.pos, est.vel, me.pos, td.slow.speed);
      // a long slow run is easier to dodge: only take it against a ship that is not yet weaving away
      if (hit && (td.slow.speed * hit.t > td.slow.range * 0.85 || hit.t > 260)) hit = null;
    }
    if (!hit) return false;
    let aim = hit.p;
    // aiming error grows with skill noise
    const ab = Math.atan2(aim.y - me.pos.y, aim.x - me.pos.x) + this.rng.gauss() * this.skill.torpNoise;
    aim = add(me.pos, fromAngle(ab, dist(me.pos, aim)));
    // would the spread run into a friendly ship first?
    for (const f of world.ships) {
      if (f.team !== me.team || f === me || f.status !== 'active') continue;
      const d = dist(me.pos, f.pos);
      if (d < dist(me.pos, aim) && Math.abs(angleDiff(ab, Math.atan2(f.pos.y - me.pos.y, f.pos.x - me.pos.x))) < 0.12) return false;
    }
    if (!me.torpedoMounts.some((m) => m.loaded && me.torpedoMountOk(m) && me.torpedoBearing(m, ab) != null)) return false;
    cmd.torpedo = aim;
    this.torpCooldown = 6;
    return true;
  }

  private evadeTorpedoes(world: World, me: Ship, desired: number): number {
    if (this.evade && world.time < this.evade.until) return this.evade.heading;
    this.evade = null;
    const v = fromAngle(me.heading, me.speed);
    for (const tp of world.torpedoes) {
      if (tp.team === me.team || tp.t < 0 || !world.torpedoSpotted(tp, me.team)) continue;
      const tv = fromAngle(tp.heading, tp.speed);
      // closest point of approach within the torpedo's remaining run
      const rp = sub(tp.pos, me.pos), rv = sub(tv, v);
      const tc = clamp(-(rp.x * rv.x + rp.y * rv.y) / (rv.x * rv.x + rv.y * rv.y || 1), 0, (tp.range - tp.run) / tp.speed);
      const cpa = Math.hypot(rp.x + rv.x * tc, rp.y + rv.y * tc);
      if (cpa > me.cls.length * 0.7 + 80 || tc > 90) continue;
      // comb the track: turn parallel to it, whichever way is quicker
      const opts = [tp.heading, wrapAngle(tp.heading + Math.PI)];
      const h = Math.abs(angleDiff(me.heading, opts[0])) < Math.abs(angleDiff(me.heading, opts[1])) ? opts[0] : opts[1];
      this.evade = { heading: h, until: world.time + 6 * this.skill.react + 4 };
      this.speedOrder = 4;
      return h;
    }
    return desired;
  }

  /** Feelers ahead: if land lies on the intended course, bend it until clear. */
  private landCache: { t: number; want: number; got: number } | null = null;
  private avoidLand(world: World, me: Ship, desired: number): number {
    if (!world.islands.length) return desired;
    // re-plan a few times a second; reuse the bend in between if the wish has not changed
    const c = this.landCache;
    if (c && world.time - c.t < 0.4 && Math.abs(angleDiff(c.want, desired)) < 4 * DEG) return wrapAngle(desired + angleDiff(c.want, c.got));
    const got = this.avoidLandNow(world, me, desired);
    this.landCache = { t: world.time, want: desired, got };
    return got;
  }

  private avoidLandNow(world: World, me: Ship, desired: number): number {
    const look = Math.max(1200, Math.abs(me.speed) * 110 + me.cls.length * 2);
    const blocked = (h: number) => {
      for (const k of [0.35, 0.7, 1]) {
        const p = add(me.pos, fromAngle(h, look * k));
        for (const isl of world.islands) {
          if (dist(p, { x: isl.cx, y: isl.cy }) > isl.r + 700) continue;
          if (coastDistance(p, isl).d < 350 + me.cls.beam * 4) return true;
        }
      }
      return false;
    };
    if (!blocked(desired)) return desired;
    for (let a = 15; a <= 180; a += 15) {
      for (const s of [1, -1]) {
        const h = wrapAngle(desired + s * a * DEG);
        if (!blocked(h)) return h;
      }
    }
    return wrapAngle(me.heading + Math.PI);
  }
}

/** Where a projectile of speed v from `from` meets a target at p moving at vel (null if it cannot). */
export function intercept(p: Vec2, vel: Vec2, from: Vec2, v: number): { p: Vec2; t: number } | null {
  const P = sub(p, from);
  const a = vel.x * vel.x + vel.y * vel.y - v * v, b = 2 * (P.x * vel.x + P.y * vel.y), c = P.x * P.x + P.y * P.y;
  let t: number;
  if (Math.abs(a) < 1e-6) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
    t = Math.min(...[t1, t2].filter((x) => x > 0));
  }
  if (!isFinite(t) || t <= 0) return null;
  return { p: add(p, scale(vel, t)), t };
}

export class AIDirector {
  commanders = new Map<TeamId, TeamCommander>();
  captains: CaptainAI[] = [];
  constructor(world: World) {
    for (const t of ['blue', 'red'] as TeamId[]) this.commanders.set(t, new TeamCommander(t));
    let seed = world.cfg.seed * 7 + 1;
    for (const s of world.ships) if (s.controller === 'ai') this.captains.push(new CaptainAI(s, this.commanders.get(s.team)!, seed++, world.cfg.difficulty));
  }
  /** Take a ship over (e.g. when the player's ship is lost, or for spectating). */
  addCaptain(world: World, s: Ship) {
    if (this.captains.some((c) => c.ship === s)) return;
    this.captains.push(new CaptainAI(s, this.commanders.get(s.team)!, world.cfg.seed + s.id * 31, world.cfg.difficulty));
  }
  /** Release a ship from AI control (a human takes the helm). */
  removeCaptain(s: Ship) { this.captains = this.captains.filter((c) => c.ship !== s); }
  observe(events: WorldEvent[], world: World) {
    for (const e of events) for (const c of this.captains) c.observe(e, world);
  }
  update(world: World, dt: number) {
    for (const c of this.commanders.values()) c.update(world, dt);
    for (const c of this.captains) c.ship.setCommand(c.update(world, dt), world.time);
  }
}
