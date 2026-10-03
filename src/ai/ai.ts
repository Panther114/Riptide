// Ship AI, organised in two layers so it scales to fleet actions:
//
//   TeamCommander  — one per team. Looks at the whole picture every few seconds,
//                    assigns targets (concentration of fire), and sets doctrine:
//                    the range band to fight at, and whether to press or open.
//   CaptainAI      — one per AI ship. Ship-handling and gunnery: keeps guns
//                    bearing while angling the armour, manages range, evades
//                    incoming salvos, and runs a spotting/bracketing loop to walk
//                    salvos onto the target from observed fall of shot.
//
// The AI reads only what a real ship could observe: enemy position and motion
// (with ranging noise), visible fires/list, and its own fall of shot.

import { DEG, Rng, Vec2, angleDiff, clamp, dist, fromAngle, wrapAngle, add, scale } from '../core/math';
import { flightTime } from '../sim/ballistics';
import type { Ship } from '../sim/ship';
import type { World, WorldEvent } from '../sim/world';
import type { ShipCommand, TeamId } from '../sim/types';

interface Doctrine { minRange: number; maxRange: number; press: boolean }

const SKILL = {
  cadet: { rangeErr: 650, latErr: 110, correct: 0.45, react: 1.6, patience: 0.55, trackNoise: 1.6 },
  officer: { rangeErr: 340, latErr: 50, correct: 0.68, react: 1.0, patience: 0.75, trackNoise: 0.8 },
  admiral: { rangeErr: 320, latErr: 45, correct: 0.72, react: 0.6, patience: 0.9, trackNoise: 0.7 },
};

export class TeamCommander {
  team: TeamId;
  targets = new Map<number, number>(); // ship id -> target id
  doctrine: Doctrine = { minRange: 12000, maxRange: 17000, press: false };
  private timer = 0;
  constructor(team: TeamId) { this.team = team; }

  update(world: World, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 4;
    const mine = world.ships.filter((s) => s.team === this.team && !s.outOfAction);
    const foes = world.ships.filter((s) => s.team !== this.team && !s.outOfAction);
    if (!foes.length) return;
    // Concentrate fire: prefer damaged and close enemies, but spread if heavily outnumbering.
    const score = (me: Ship, f: Ship) => {
      const r = f.readiness();
      return dist(me.pos, f.pos) / 1000 + r.firepower * 6 + r.buoyancy * 3 - (f.fires.length ? 1 : 0);
    };
    const load = new Map<number, number>();
    for (const me of mine) {
      let best: Ship | null = null, bs = Infinity;
      for (const f of foes) {
        const s = score(me, f) + (load.get(f.id) ?? 0) * (mine.length > foes.length * 2 ? 3 : 0.5);
        if (s < bs) { bs = s; best = f; }
      }
      if (best) { this.targets.set(me.id, best.id); load.set(best.id, (load.get(best.id) ?? 0) + 1); }
    }
    // Doctrine: compare our fighting strength to theirs.
    const str = (arr: Ship[]) => arr.reduce((a, s) => { const r = s.readiness(); return a + r.firepower * 0.6 + r.buoyancy * 0.25 + r.mobility * 0.15; }, 0);
    const ratio = str(mine) / Math.max(0.01, str(foes));
    if (ratio > 1.35) this.doctrine = { minRange: 9000, maxRange: 13500, press: true };
    else if (ratio < 0.7) this.doctrine = { minRange: 15500, maxRange: 21000, press: false };
    else this.doctrine = { minRange: 11500, maxRange: 16500, press: false };
  }
}

interface Track { pos: Vec2; vel: Vec2; t: number }

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
  private observing: { salvo: number; target: number; errs: number[]; latErrs: number[]; t: number }[] = [];
  private reactTimer = 0;
  private holdFire = 0;
  private ammo: 'AP' | 'HC' = 'AP';

  constructor(ship: Ship, cmdr: TeamCommander, seed: number, difficulty: keyof typeof SKILL) {
    this.ship = ship; this.cmdr = cmdr;
    this.rng = new Rng(seed);
    this.skill = SKILL[difficulty];
    this.weaveTimer = 10 + this.rng.next() * 15;
  }

  /** Observe world events — fall of shot of our own salvos, enemy gun flashes. */
  observe(e: WorldEvent, world: World) {
    const me = this.ship;
    if (e.type === 'splash' || e.type === 'hit') {
      const sh = e.shell;
      if (sh.shooter !== me.id) {
        // incoming fire landing close: urge to change course (chasing salvos)
        if (dist(e.type === 'splash' ? e.pos : e.pos, me.pos) < 600 && this.weaveTimer > 3) this.weaveTimer = 1 + this.rng.next() * 3 * this.skill.react;
        return;
      }
      const tgt = world.shipById(this.cmdr.targets.get(me.id) ?? -1);
      if (!tgt) return;
      let ob = this.observing.find((o) => o.salvo === sh.salvo);
      if (!ob) { ob = { salvo: sh.salvo, target: tgt.id, errs: [], latErrs: [], t: world.time }; this.observing.push(ob); }
      // Spotters estimate whether splashes fell over or short, and left or right.
      const fwd = fromAngle(Math.atan2(sh.target.y - sh.origin.y, sh.target.x - sh.origin.x));
      const rel = { x: (e.type === 'splash' ? e.pos.x : e.pos.x) - tgt.pos.x, y: (e.type === 'splash' ? e.pos.y : e.pos.y) - tgt.pos.y };
      const along = rel.x * fwd.x + rel.y * fwd.y;
      const across = rel.x * -fwd.y + rel.y * fwd.x;
      const noise = this.rng.gauss() * 60 * this.skill.trackNoise;
      ob.errs.push(e.type === 'hit' ? along * 0.3 : along + noise);
      ob.latErrs.push(across + this.rng.gauss() * 20);
    }
  }

  update(world: World, dt: number): ShipCommand {
    const me = this.ship;
    const cmd: ShipCommand = { telegraph: this.telegraph, rudder: 0, aim: null, fire: false, ammo: this.ammo };
    if (!me.alive) return cmd;
    const tgt = world.shipById(this.cmdr.targets.get(me.id) ?? -1) ?? world.enemiesOf(me).find((s) => !s.outOfAction);

    // process spotting reports once the whole salvo has landed
    for (let i = this.observing.length - 1; i >= 0; i--) {
      const ob = this.observing[i];
      if (world.time - ob.t > 1.5) {
        if (ob.target === this.biasTarget && ob.errs.length) {
          const mean = ob.errs.reduce((a, b) => a + b, 0) / ob.errs.length;
          const lat = ob.latErrs.reduce((a, b) => a + b, 0) / ob.latErrs.length;
          this.rangeBias -= mean * this.skill.correct;
          this.latBias -= lat * this.skill.correct * 0.8;
        }
        this.observing.splice(i, 1);
      }
    }

    // ------------------------------------------------ tracking (noisy observation)
    let est: Track | null = null;
    if (tgt && !tgt.outOfAction) {
      const range = dist(me.pos, tgt.pos);
      const noise = (range / 1000) * 9 * this.skill.trackNoise;
      const meas = { x: tgt.pos.x + this.rng.gauss() * noise, y: tgt.pos.y + this.rng.gauss() * noise };
      const prev = this.track.get(tgt.id);
      // rangefinder/plot updates about once a second; predict in between
      if (!prev) est = { pos: meas, vel: { x: 0, y: 0 }, t: world.time };
      else if (world.time - prev.t >= 1) {
        const pdt = world.time - prev.t;
        const pred = add(prev.pos, scale(prev.vel, pdt));
        const a = 0.3, b = 0.05;
        const res = { x: meas.x - pred.x, y: meas.y - pred.y };
        est = { pos: add(pred, scale(res, a)), vel: add(prev.vel, scale(res, b / pdt)), t: world.time };
      } else est = prev;
      this.track.set(tgt.id, est);
      if (this.biasTarget !== tgt.id) {
        this.biasTarget = tgt.id;
        this.rangeBias = this.rng.gauss() * this.skill.rangeErr;
        this.latBias = this.rng.gauss() * this.skill.latErr;
      }
    }

    // ------------------------------------------------ navigation
    const doc = this.cmdr.doctrine;
    let desired = me.heading;
    if (tgt && est) {
      const range = dist(me.pos, est.pos);
      const brg = Math.atan2(est.pos.y - me.pos.y, est.pos.x - me.pos.x);
      // Decide which side to fight on, with hysteresis.
      this.sideTimer -= dt;
      const relNow = angleDiff(me.heading, brg);
      if (this.sideTimer <= 0) { this.side = relNow >= 0 ? 1 : -1; this.sideTimer = 40; }
      // Target off-bow angle: ~50° keeps all three turrets bearing while angling the belt.
      let off = 50 * DEG;
      if (range > doc.maxRange) off = doc.press ? 22 * DEG : 32 * DEG;
      else if (range < doc.minRange) off = 118 * DEG;
      const r = me.readiness();
      if (r.buoyancy < 0.45 || r.firepower < 0.34) off = Math.max(off, 105 * DEG); // break off, but keep guns bearing
      desired = wrapAngle(brg - this.side * off);

      // weave to throw off the enemy's fire control
      this.weaveTimer -= dt;
      if (this.weaveTimer <= 0) {
        this.weave = (this.rng.next() - 0.5) * 2 * 24 * DEG;
        this.weaveTimer = 18 + this.rng.next() * 22;
      }
      desired = wrapAngle(desired + this.weave);
    }
    // stay inside the battle area
    const half = world.mapHalf * 0.86;
    const edge = Math.max(Math.abs(me.pos.x), Math.abs(me.pos.y));
    if (edge > half) {
      const toCenter = Math.atan2(-me.pos.y, -me.pos.x);
      const w = clamp((edge - half) / (world.mapHalf * 0.12), 0, 1);
      desired = wrapAngle(desired + angleDiff(desired, toCenter) * w);
    }
    // avoid collisions with any ship nearby
    for (const o of world.ships) {
      if (o === me || o.status === 'sunk') continue;
      const d = dist(me.pos, o.pos);
      if (d < 1400) {
        const away = Math.atan2(me.pos.y - o.pos.y, me.pos.x - o.pos.x);
        const w = clamp((1400 - d) / 900, 0, 1);
        desired = wrapAngle(desired + angleDiff(desired, away) * w * 0.8);
      }
    }
    const err = angleDiff(me.heading, desired);
    cmd.rudder = clamp(err * 2.6 - me.yawRate * 18, -1, 1);
    if (Math.abs(cmd.rudder) < 0.06) cmd.rudder = 0;
    this.telegraph = 4;
    cmd.telegraph = this.telegraph;

    // ------------------------------------------------ gunnery
    if (tgt && est && !tgt.outOfAction) {
      const now = add(est.pos, scale(est.vel, world.time - est.t));
      const range = dist(me.pos, now);
      const tof = flightTime(range);
      // lead the target: predicted position at impact
      let aim = add(now, scale(est.vel, tof));
      const brg = Math.atan2(aim.y - me.pos.y, aim.x - me.pos.x);
      const fwd = fromAngle(brg), lat = { x: -fwd.y, y: fwd.x };
      aim = add(aim, add(scale(fwd, this.rangeBias), scale(lat, this.latBias)));
      // aim slightly at the waterline of the near side rather than the centre
      cmd.aim = aim;
      // ammo: AP at fighting ranges; HC at long range or when the target is badly angled
      const tgtAngle = Math.abs(Math.cos(angleDiff(tgt.heading, Math.atan2(me.pos.y - tgt.pos.y, me.pos.x - tgt.pos.x))));
      this.ammo = range > 21000 || tgtAngle > 0.93 ? 'HC' : 'AP';
      cmd.ammo = this.ammo;

      const ready = me.turrets.filter((t) => t.loaded && t.aligned && me.gunsFor(t) > 0).length;
      const operable = me.turrets.filter((t) => me.turretOperable(t)).length;
      const loadingSoon = me.turrets.filter((t) => !t.loaded && me.turretOperable(t) && t.reload < 4).length;
      const solid = me.fcError < 0.35 * (2 - this.skill.patience);
      this.holdFire -= dt;
      if (range < me.cls.maxRange * 0.99 && solid && this.holdFire <= 0) {
        if (ready >= Math.max(1, operable - (loadingSoon ? 0 : 1)) || (ready >= 1 && operable === 1)) {
          cmd.fire = true;
          this.holdFire = 1.5;
        }
      }
    }
    return cmd;
  }
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
    this.captains.push(new CaptainAI(s, this.commanders.get(s.team)!, world.cfg.seed + s.id * 31, world.cfg.difficulty));
  }
  observe(events: WorldEvent[], world: World) {
    for (const e of events) for (const c of this.captains) c.observe(e, world);
  }
  update(world: World, dt: number) {
    for (const c of this.commanders.values()) c.update(world, dt);
    for (const c of this.captains) c.ship.setCommand(c.update(world, dt), world.time);
  }
}
