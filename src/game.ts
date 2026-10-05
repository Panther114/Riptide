// Game orchestration: owns the world, controllers, renderer, HUD and audio for a
// battle, and translates simulation events into presentation.

import { Vec2, clamp, dist, pointInPolygon, toLocal, fromAngle } from './core/math';
import { AIDirector } from './ai/ai';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { Renderer, TEAM_RGB, edgePointer } from './render/renderer';
import type { Ship } from './sim/ship';
import { STATE_NAMES, newCommand, type BattleConfig, type Order, type ShipCommand } from './sim/types';
import { World, WorldEvent } from './sim/world';
import { Hud } from './ui/hud';

const KIND_TEXT: Record<string, { t: string; c: string }> = {
  citadel: { t: 'CITADEL', c: '#ff5d55' },
  pen: { t: 'PENETRATION', c: '#ffb547' },
  overpen: { t: 'OVERPENETRATION', c: '#e4e9ec' },
  nonpen: { t: 'NO PENETRATION', c: '#9fb6c8' },
  ricochet: { t: 'RICOCHET', c: '#9fb6c8' },
  underwater: { t: 'BELOW WATERLINE', c: '#6cc0ff' },
  he: { t: 'HE HIT', c: '#ffd27a' },
  shatter: { t: 'SHATTERED', c: '#9fb6c8' },
  torpedo: { t: 'TORPEDO HIT', c: '#7fd4ff' },
};

/** Fixed simulation tick: the same inputs always give the same battle (replays, lockstep). */
export const SIM_DT = 1 / 60;

interface SalvoTrack { id: number; shooter: number; n: number; landed: Vec2[]; hits: number; pens: number; aim: Vec2; shot: number }

export class Game {
  world!: World;
  ai!: AIDirector;
  renderer: Renderer;
  hud: Hud | null = null;
  audio: Audio;
  input: Input;
  playerId: number | null = null;
  lockId: number | null = null;
  /** Gun aim held at a fixed point on the sea (right button) instead of following the cursor (Space). */
  aimFixed = false;
  aimPoint: Vec2 | null = null;
  paused = false;
  mode: 'battle' | 'attract' = 'battle';
  weapon: 'guns' | 'torpedo' = 'guns';
  private cmd: ShipCommand = newCommand();
  private orders: Order[] = [];
  private salvos = new Map<number, SalvoTrack>();
  private salvoCount = 0;
  private endTimer = -1;
  onEnd: ((w: World, me: Ship | null) => void) | null = null;
  private hudRoot: HTMLElement;
  private lastAlarm = 0;
  private attractT = 0;
  private attractFocus = 0;
  timeScale = 1;
  /** free-look offset from the focused ship (middle-drag) */
  pan = { x: 0, y: 0 };
  private slowmo = 0;
  private lastOut: Ship | null = null;
  private acc = 0;
  private lastSpot = -99;

  constructor(glCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement, hudRoot: HTMLElement, input: Input, audio: Audio) {
    this.renderer = new Renderer(glCanvas, canvas);
    this.input = input;
    this.audio = audio;
    this.hudRoot = hudRoot;
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
  }

  get player(): Ship | null { return this.playerId != null ? this.world.shipById(this.playerId) ?? null : null; }

  start(cfg: BattleConfig, mode: 'battle' | 'attract' = 'battle') {
    this.mode = mode;
    this.world = new World(cfg);
    this.ai = new AIDirector(this.world);
    this.renderer.reset();
    const p = this.world.ships.find((s) => s.controller === 'player');
    this.playerId = p ? p.id : null;
    this.lockId = null;
    this.aimFixed = false; this.aimPoint = null;
    this.pan = { x: 0, y: 0 };
    this.paused = false;
    this.endTimer = -1;
    this.salvos.clear();
    this.salvoCount = 0;
    this.lastOut = null;
    this.acc = 0;
    this.weapon = 'guns';
    this.orders = [];
    this.cmd = newCommand();
    if (p) { this.cmd.telegraph = p.telegraph; }
    if (this.hud) { this.hud.root.remove(); this.hud = null; }
    if (mode === 'battle') {
      this.hud = new Hud(this.hudRoot);
      this.hud.status.onOrder = (t) => {
        this.orders.push(t === 'auto' ? { kind: 'dcAuto' } : { kind: 'dc', target: t });
        this.audio.ui('click');
      };
      this.audio.startAmbient();
      this.renderer.camera.zoom = 0.06;
      this.renderer.camera.targetZoom = p ? 0.42 * Math.max(0.55, Math.sqrt(p.cls.length / 270)) : 0.2;
      if (p) { this.renderer.camera.x = p.pos.x; this.renderer.camera.y = p.pos.y; }
      setTimeout(() => this.hud?.showBanner(`<div class="b-k">BATTLE STATIONS</div><div class="b-s">${this.contactReport()}</div>`, 3600), 300);
    } else {
      this.renderer.camera.zoom = 0.5; this.renderer.camera.targetZoom = 0.5;
      this.attractT = 0;
    }
  }

  private contactReport() {
    const p = this.player; if (!p) return 'Observing';
    const seen = this.world.visibleEnemiesOf(p);
    const light = this.world.conditions === 'night' ? 'Night action · ' : this.world.conditions === 'dusk' ? 'Dusk · ' : '';
    if (!seen.length) return `${light}No contact — the enemy is beyond visual range${p.radarRange() ? ' and radar' : ''}`;
    const e = seen.reduce((a, b) => (dist(a.pos, p.pos) < dist(b.pos, p.pos) ? a : b));
    const b = Math.atan2(e.pos.y - p.pos.y, e.pos.x - p.pos.x);
    const brg = String(Math.round(((b + Math.PI / 2) * 180 / Math.PI + 360) % 360)).padStart(3, '0') + '°';
    const what = seen.length > 1 ? `${seen.length} enemy ships` : `Enemy ${e.cls.name}-class`;
    return `${light}${what} bearing ${brg} · ${(dist(p.pos, e.pos) / 1000).toFixed(1)} km`;
  }

  stop() {
    if (this.hud) { this.hud.root.remove(); this.hud = null; }
    this.audio.stopAmbient();
  }

  /** Advance the simulation by exactly one fixed tick. */
  private tick(quiet: boolean) {
    const me = this.player;
    this.ai.update(this.world, SIM_DT);
    this.world.step(SIM_DT);
    this.ai.observe(this.world.events, this.world);
    this.handleEvents(this.world.events, quiet);
    this.world.events.length = 0;
    if (me) { me.cmd.fire = false; me.cmd.torpedo = null; }
  }

  // ------------------------------------------------------------- frame
  frame(dtReal: number) {
    const inp = this.input;
    const cam = this.renderer.camera;
    const dt = Math.min(dtReal, 0.05);
    const me = this.player;
    this.renderer.trackPerf(dtReal);

    if (this.mode === 'battle' && !this.paused) {
      // ---- controls
      if (inp.hit('KeyH')) this.hud?.toggleHelp();
      if (inp.hit('KeyM')) this.audio.toggleMute();
      if (inp.hit('Tab')) this.switchShip();
      if (inp.hit('KeyV') && this.hud) { this.hud.status.armorView = !this.hud.status.armorView; this.audio.ui('tick'); }
      if (me && me.alive) {
        if (inp.hit('KeyW') || inp.hit('ArrowUp')) { this.cmd.telegraph = clamp(this.cmd.telegraph + 1, -2, 4); this.audio.ui('tick'); }
        if (inp.hit('KeyS') || inp.hit('ArrowDown')) { this.cmd.telegraph = clamp(this.cmd.telegraph - 1, -2, 4); this.audio.ui('tick'); }
        // rudder orders step one notch per press: port · amidships · starboard
        const helm = (d: number) => {
          const next = clamp(Math.round(this.cmd.rudder) + d, -1, 1);
          if (next !== this.cmd.rudder) { this.cmd.rudder = next; this.audio.ui('tick'); }
        };
        if (inp.hit('KeyA') || inp.hit('ArrowLeft')) helm(-1);
        if (inp.hit('KeyD') || inp.hit('ArrowRight')) helm(1);
        if (inp.hit('Digit1')) { this.cmd.ammo = 'AP'; this.weapon = 'guns'; this.audio.ui('ammo'); }
        if (inp.hit('Digit2')) { this.cmd.ammo = 'HC'; this.weapon = 'guns'; this.audio.ui('ammo'); }
        if (inp.hit('KeyT') && me.cls.torpedoes) { this.weapon = this.weapon === 'guns' ? 'torpedo' : 'guns'; this.audio.ui('ammo'); }
        if (inp.hit('KeyX') && me.cls.smoke) {
          this.cmd.smoke = !this.cmd.smoke; this.audio.ui('tick');
          if (this.cmd.smoke && me.smokeLeft <= 0) this.hud?.alert('SMOKE GENERATORS EXHAUSTED', 'info');
        }
        if (inp.hit('KeyG') && me.cls.secondary) { this.cmd.secondaries = this.cmd.secondaries === false; this.audio.ui('tick'); this.hud?.logLine(`Secondary battery: <b>${this.cmd.secondaries ? 'weapons free' : 'hold fire'}</b>`, 'dim'); }
        if (inp.hit('KeyC')) {
          if (Math.abs(me.list) > 0.6 * Math.PI / 180) { this.orders.push({ kind: 'counterflood' }); this.hud?.logLine('<b>Counter-flooding</b> to correct the list', 'own'); }
          else this.hud?.logLine('No list to correct', 'dim');
          this.audio.ui('click');
        }
        // gun aim: a fixed point on the sea, set or dragged with the right button (so zooming and
        // panning leave it alone), or Space to have it follow the cursor again
        const cursor = inp.mouse.inside ? cam.screenToWorld(inp.mouse) : null;
        if (inp.buttons[2] && cursor) {
          if (inp.clicked[2] && !this.aimFixed) this.audio.ui('tick');
          this.aimFixed = true; this.aimPoint = cursor;
        }
        if (inp.hit('Space')) {
          this.aimFixed = !this.aimFixed;
          if (this.aimFixed) this.aimPoint = this.cmd.aim ? { ...this.cmd.aim } : cursor;
          this.audio.ui('tick');
        }
        if (this.aimFixed && !this.aimPoint) this.aimFixed = false;
        if (this.weapon === 'guns' && this.aimFixed) this.cmd.aim = this.aimPoint;
        else this.cmd.aim = cursor ?? this.cmd.aim;
        if (this.weapon === 'torpedo') {
          this.cmd.fire = false;
          this.cmd.torpedo = inp.clicked[0] && this.cmd.aim ? { ...this.cmd.aim } : null;
          if (this.cmd.torpedo && !me.torpedoMounts.some((m) => m.loaded && me.torpedoMountOk(m) && me.torpedoBearing(m, Math.atan2(this.cmd.torpedo!.y - me.pos.y, this.cmd.torpedo!.x - me.pos.x)) != null)) {
            this.hud?.alert(me.torpedoCapacity().ready ? 'TUBES DO NOT BEAR' : 'TUBES EMPTY', 'info');
          }
        } else { this.cmd.fire = inp.buttons[0]; this.cmd.torpedo = null; }
        this.cmd.orders = this.orders.length ? this.orders : undefined;
        me.setCommand({ ...this.cmd }, this.world.time);
        this.orders = [];
        this.cmd.orders = undefined;
      }
      if (this.hud) this.hud.weapon = this.weapon;
      if (inp.wheel) cam.zoomBy(inp.wheel);
      if (inp.midClick) this.pickLock(cam.screenToWorld(inp.mouse));
      if (inp.midDrag.x || inp.midDrag.y) { this.pan.x -= inp.midDrag.x / cam.zoom; this.pan.y -= inp.midDrag.y / cam.zoom; }

      // ---- simulate (fixed tick)
      // brief slow motion for the decisive moments
      this.slowmo = Math.max(0, this.slowmo - dtReal);
      const simDt = dt * this.timeScale * (this.slowmo > 0 ? 0.3 + 0.7 * (1 - Math.min(1, this.slowmo / 1.2)) : 1);
      this.acc = Math.min(this.acc + simDt, SIM_DT * 40);
      let n = 0;
      while (this.acc >= SIM_DT && n < 40) { this.tick(false); this.acc -= SIM_DT; n++; }
      this.renderer.update(this.world, simDt);
      if (me) this.audio.setEngine(me.power, Math.abs(me.speed) / me.cls.maxSpeed);
      this.updateIncoming();

      if (this.world.ended) {
        if (this.endTimer < 0) this.endTimer = 11;
        this.endTimer -= dt;
        if (this.endTimer <= 0 && this.onEnd) { const cb = this.onEnd; this.onEnd = null; cb(this.world, me); }
      }
    } else if (this.mode === 'attract') {
      this.acc = Math.min(this.acc + dt, SIM_DT * 6);
      while (this.acc >= SIM_DT) { this.tick(true); this.acc -= SIM_DT; }
      this.renderer.update(this.world, dt);
      this.attractT += dt;
      if (this.attractT > 22) { this.attractT = 0; this.attractFocus++; cam.refocus(); }
      if (this.world.ended && this.world.time - this.world.endTime > 20) this.start(this.world.cfg, 'attract');
    } else {
      if (inp.wheel) cam.zoomBy(inp.wheel);
    }

    // ---- camera
    let focus: Vec2 = { x: cam.x, y: cam.y };
    if (this.mode === 'attract') {
      const live = this.world.ships.filter((s) => s.status !== 'sunk');
      const s = live[this.attractFocus % Math.max(1, live.length)];
      cam.targetZoom = (0.62 + Math.sin(this.attractT * 0.15) * 0.18) * (s ? Math.max(0.6, Math.sqrt(s.cls.length / 270)) : 1);
      // keep the subject on the right third, clear of the title menu
      if (s) focus = { x: s.pos.x - (cam.w * 0.2) / cam.zoom, y: s.pos.y + (cam.h * 0.04) / cam.zoom };
    } else {
      const locked = this.lockId != null ? this.world.shipById(this.lockId) : null;
      if (locked && locked.status !== 'sunk' && this.renderer.seen(this.world, locked)) focus = locked.pos;
      else if (me) focus = me.pos;
      else { const any = this.world.ships.find((s) => s.status !== 'sunk'); if (any) focus = any.pos; }
    }
    cam.update(dtReal, { x: focus.x + this.pan.x, y: focus.y + this.pan.y }, { x: 0, y: 0 });

    // ---- draw
    this.renderer.render(this.world, {
      player: this.mode === 'battle' ? me : null,
      aimWorld: this.mode === 'battle' && me?.alive && !me.outOfAction ? (this.weapon === 'guns' && this.aimFixed && this.aimPoint ? this.aimPoint : cam.screenToWorld(inp.mouse)) : null,
      aimFixed: this.weapon === 'guns' && this.aimFixed,
      mouse: inp.mouse,
      lockId: this.lockId,
      rudderHeld: this.cmd.rudder,
      showOverlay: this.mode === 'battle' && !this.paused,
      time: this.world.time,
      weapon: this.weapon,
      viewTeam: this.mode === 'battle' && me ? me.team : null,
    });
    if (this.hud) this.hud.update(this.world, me, this.paused ? 0 : dt, this.cmd.rudder, this.lockId);
  }

  /** Take command of the next fighting ship of our team (fleet battles). */
  switchShip() {
    const me = this.player;
    if (!me) return;
    const allies = this.world.ships.filter((s) => s.team === me.team && !s.outOfAction && s.status === 'active');
    if (!allies.length) return;
    const idx = allies.findIndex((s) => s.id === me.id);
    const next = allies[(idx + 1) % allies.length];
    if (next.id === me.id) return;
    // the old ship goes back to the AI (if still fighting); the new one comes to us
    if (!me.outOfAction) { me.controller = 'ai'; this.ai.addCaptain(this.world, me); }
    me.cmd.fire = false;
    this.ai.removeCaptain(next);
    next.controller = 'player';
    this.playerId = next.id;
    this.cmd = { ...next.cmd, rudder: 0, fire: false, torpedo: null, aim: null, orders: undefined };
    this.weapon = 'guns';
    this.lockId = null;
    this.aimFixed = false; this.aimPoint = null;
    this.renderer.camera.refocus();
    this.renderer.camera.targetZoom = 0.42 * Math.max(0.55, Math.sqrt(next.cls.length / 270));
    this.audio.ui('click');
    this.hud?.showBanner(`<div class="b-k">TAKING COMMAND</div><div class="b-s">${next.cls.prefix} ${next.name.toUpperCase()} · ${next.cls.designation}</div>`, 2200);
  }

  /** The ship under a world point (hull or nearby), or under an edge-of-screen pointer. */
  private shipAt(w: Vec2): Ship | null {
    const cam = this.renderer.camera;
    let best: Ship | null = null, bd = Infinity;
    for (const s of this.world.ships) {
      if (s.status === 'sunk' || !this.renderer.seen(this.world, s)) continue;
      const local = toLocal(w, s.pos, s.heading);
      const inside = pointInPolygon(local, s.cls.hull);
      const d = dist(w, s.pos);
      const slop = 28 / cam.zoom;
      if ((inside || d < Math.max(slop, s.cls.length * 0.6)) && d < bd) { bd = d; best = s; }
    }
    // the edge-of-screen pointers to off-screen ships are clickable too
    if (!best) {
      const m = this.input.mouse;
      for (const s of this.world.ships) {
        if (s.status === 'sunk' || s.id === this.playerId || !this.renderer.seen(this.world, s)) continue;
        const ep = edgePointer(cam, cam.worldToScreen(s.pos));
        if (ep && Math.hypot(ep.x - m.x, ep.y - m.y) < 45) { best = s; break; }
      }
    }
    return best;
  }

  private pickLock(w: Vec2) {
    const cam = this.renderer.camera;
    const best = this.shipAt(w);
    // empty water: keep the current view; own ship: back to following it; other ship: lock on
    if (!best) return;
    this.lockId = best.id !== this.playerId ? best.id : null;
    this.pan = { x: 0, y: 0 };
    cam.refocus(); this.audio.ui('click');
  }

  private incomingPlayed = new Set<number>();
  private updateIncoming() {
    const me = this.player;
    if (!me || !me.alive) return;
    for (const sh of this.world.shells) {
      if (sh.team === me.team || sh.secondary || this.incomingPlayed.has(sh.id)) continue;
      const remain = sh.T - sh.t;
      if (remain < 1.6 && remain > 0) {
        this.incomingPlayed.add(sh.id);
        const d = dist(sh.target, me.pos);
        if (d < 900) this.audio.incoming(d, remain);
      }
    }
    if (this.incomingPlayed.size > 400) this.incomingPlayed.clear();
  }

  // ------------------------------------------------------------- events -> presentation
  private handleEvents(events: WorldEvent[], quiet = false) {
    const me = this.player;
    const cam = this.renderer.camera;
    const fx = this.renderer.fx;
    const ear = { x: cam.x, y: cam.y };
    const earD = (p: Vec2) => dist(p, ear) * Math.max(0.35, Math.min(1, cam.zoom * 2.2));
    const vol = quiet ? 0 : 1;
    const view = this.mode === 'battle' && me ? me.team : null;
    const seen = (s: Ship) => view == null || this.world.isVisibleTo(view, s);
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const t = e.ship.turrets[e.turret].def;
          const k = Math.max(0.3, Math.sqrt(e.ship.cls.shells.AP.caliber / 406));
          fx.muzzle(e.pos.x, e.pos.y, e.bearing, e.guns, { barrel: t.barrel, spacing: t.spacing, k });
          if (vol) this.audio.gun(earD(e.pos), e.ship.id === this.playerId, k);
          if (e.ship.id === this.playerId) cam.addShake(0.28 * k);
          // track own salvo for spotting reports
          if (e.ship.id === this.playerId) {
            const sh = this.world.shells.filter((s) => s.shooter === e.ship.id && !s.secondary).slice(-e.guns);
            if (sh.length) {
              const sid = sh[0].salvo;
              const tr = this.salvos.get(sid) ?? { id: sid, shooter: e.ship.id, n: 0, landed: [], hits: 0, pens: 0, aim: sh[0].aimPoint, shot: ++this.salvoCount };
              tr.n += sh.length;
              this.salvos.set(sid, tr);
            }
          }
          break;
        }
        case 'secFire': {
          const k = Math.max(0.22, Math.sqrt(e.caliber / 406) * 0.8);
          fx.muzzle(e.pos.x, e.pos.y, e.bearing, e.guns, { barrel: 6, spacing: 1.2, k });
          if (vol && dist(e.pos, ear) < 6000) this.audio.gun(earD(e.pos) * 1.6, false, k);
          break;
        }
        case 'splash': {
          const dye = e.shell.team === 'blue' ? '226,238,250' : '250,232,226';
          const k = Math.max(0.3, Math.sqrt(e.shell.shell.caliber / 406));
          fx.splash(e.pos.x, e.pos.y, (e.shell.shell.id === 'HC' ? 1.5 : 1.7) * k, dye);
          if (vol && (!e.shell.secondary || dist(e.pos, ear) < 3000)) this.audio.splash(earD(e.pos), k);
          if (me && e.shell.team !== me.team && dist(e.pos, me.pos) < 250 && !e.shell.secondary) cam.addShake(0.18 * k);
          this.trackSalvo(e.shell.salvo, e.pos, false, false);
          break;
        }
        case 'landHit': {
          const k = Math.max(0.3, Math.sqrt(e.shell.shell.caliber / 406));
          fx.explosion(e.pos.x, e.pos.y, 0.8 * k, 'he');
          this.trackSalvo(e.shell.salvo, e.pos, false, false);
          break;
        }
        case 'hit': this.onHit(e, vol, earD(e.pos)); break;
        case 'torpLaunch': {
          for (let i = 0; i < e.count; i++) fx.torpedoLaunch(e.pos.x, e.pos.y, e.bearing);
          if (e.ship.id === this.playerId) { this.hud?.logLine(`<b>Torpedoes away</b> — ${e.count} × ${e.ship.cls.torpedoes!.def.name}`, 'own'); this.audio.ui('ammo'); }
          break;
        }
        case 'torpHit': {
          const r = e.report;
          fx.splash(e.pos.x, e.pos.y, 2.6, null);
          fx.explosion(e.pos.x, e.pos.y, 1.4, 'citadel');
          this.renderer.addDecal(r.ship, r.local.x, r.local.y, 7);
          if (vol) this.audio.hit(earD(e.pos) * 0.7, 'citadel');
          if (me && r.ship.id === me.id) { cam.addShake(0.9); this.hud?.alert('TORPEDO HIT', 'bad', r.text); this.audio.ui('alarm'); }
          if (seen(r.ship) || (me && e.torpedo.shooter === me.id)) {
            this.renderer.addText({ x: e.pos.x, y: e.pos.y, text: KIND_TEXT.torpedo.t, sub: r.plate === 'torpedo protection' ? (r.text.includes('overwhelmed') ? 'TDS breached' : 'absorbed by TDS') : 'unprotected hull', color: KIND_TEXT.torpedo.c, life: 3.6, big: true });
          }
          if (this.hud && me && e.torpedo.shooter === me.id && r.ship.team !== me.team) { this.hud.logLine(`<b class="k" style="color:${KIND_TEXT.torpedo.c}">TORPEDO HIT</b> on ${r.ship.name} — ${r.text}`, 'deal'); this.audio.confirm(2); }
          else if (this.hud && me && r.ship.team === me.team && r.ship.id !== me.id) this.hud.logLine(`${r.ship.name} torpedoed`, 'bad');
          break;
        }
        case 'torpEnd': {
          if (e.land) fx.explosion(e.pos.x, e.pos.y, 0.9, 'he');
          break;
        }
        case 'torpExplosion': {
          fx.explosion(e.pos.x, e.pos.y, 1.6, 'citadel');
          if (vol) this.audio.hit(earD(e.pos) * 0.6, 'magazine');
          if (e.ship.id === this.playerId) { this.hud?.alert('TORPEDOES DETONATED ON DECK', 'bad', e.name); cam.addShake(1); }
          else if (this.hud && seen(e.ship)) this.hud.logLine(`<b>${e.ship.name}</b>: torpedoes exploded on deck`, me && e.ship.team !== me.team ? 'good' : 'bad');
          break;
        }
        case 'module': {
          if (e.ship.id === this.playerId && this.hud) {
            const lvl = e.level;
            const name = e.module.name;
            if (lvl === 3) this.hud.alert(`${name.toUpperCase()} DESTROYED`, 'bad', this.consequence(e.ship, e.module.id));
            else if (lvl === 2) this.hud.alert(`${name} heavily damaged`, 'bad', this.consequence(e.ship, e.module.id));
            else if (lvl === 1) this.hud.logLine(`<b>${name}</b> damaged`, 'own');
            if (lvl >= 2 && this.world.time - this.lastAlarm > 2) { this.audio.ui('alarm'); this.lastAlarm = this.world.time; }
          } else if (this.hud && me && e.ship.team !== me.team && e.level === 3 && seen(e.ship)) {
            this.hud.logLine(`Enemy <b>${e.module.name}</b> knocked out`, 'good');
          }
          break;
        }
        case 'repaired': {
          if (e.ship.id === this.playerId && this.hud) this.hud.logLine(`Damage control: <b>${e.name}</b> ${e.name.endsWith('out') ? '' : `restored to ${STATE_NAMES[e.level].toLowerCase()}`}`, 'spot');
          break;
        }
        case 'fireStart': {
          if (e.ship.id === this.playerId && this.hud) {
            const loc = this.locationName(e.ship, e.x);
            this.hud.alert(`FIRE — ${loc.toUpperCase()}`, 'bad');
          }
          break;
        }
        case 'magFlooded': {
          if (e.ship.id === this.playerId && this.hud) this.hud.alert(`${e.name.toUpperCase()} FLOODED`, 'bad', 'Damage control flooded the magazine to prevent detonation — turret cannot reload');
          else if (this.hud && seen(e.ship)) this.hud.logLine(`${e.ship.name}: ${e.name} flooded`, me && e.ship.team === me.team ? 'bad' : 'good');
          break;
        }
        case 'moduleFlooded': {
          if (e.ship.id === this.playerId && this.hud) this.hud.alert(`${e.name.toUpperCase()} FLOODED OUT`, 'bad');
          break;
        }
        case 'magazine': {
          const p = e.ship.localToWorld({ x: e.x, y: 0 });
          const k = Math.max(0.45, Math.sqrt(e.ship.cls.displacement / 50000));
          fx.explosion(p.x, p.y, 2.2 * k, 'magazine');
          if (this.mode === 'battle') this.slowmo = 2.6;
          if (vol) this.audio.hit(earD(p) * 0.5, 'magazine');
          cam.addShake(e.ship.id === this.playerId ? 1.2 : 0.7);
          this.hud?.showBanner(`<div class="b-k ${e.ship.team === me?.team ? 'bad' : 'good'}">MAGAZINE DETONATION</div><div class="b-s">${e.ship.name.toUpperCase()} HAS BLOWN UP</div>`, 4200);
          break;
        }
        case 'brokeInTwo': {
          const p = e.ship.localToWorld({ x: e.x, y: 0 });
          fx.splash(p.x, p.y, 3, null);
          fx.explosion(p.x, p.y, 1.2, 'citadel');
          if (this.mode === 'battle') this.slowmo = Math.max(this.slowmo, 1.6);
          this.hud?.showBanner(`<div class="b-k ${e.ship.team === me?.team ? 'bad' : 'good'}">BROKEN IN TWO</div><div class="b-s">${e.ship.name.toUpperCase()} — TORPEDOED AMIDSHIPS</div>`, 3800);
          break;
        }
        case 'outOfAction': {
          this.lastOut = e.ship;
          if (!this.hud) break;
          const own = e.ship.team === me?.team;
          if (e.reason !== 'Magazine detonation' && !e.reason.startsWith('Broke')) this.hud.showBanner(`<div class="b-k ${own ? 'bad' : 'good'}">${e.ship.name.toUpperCase()} OUT OF ACTION</div><div class="b-s">${e.reason}</div>`, 3600);
          this.hud.logLine(`<b>${e.ship.name}</b> out of action — ${e.reason}`, own ? 'bad' : 'good');
          break;
        }
        case 'sinking': {
          const p = e.ship.pos;
          const k = e.ship.cls.length / 270;
          for (let i = 0; i < 6; i++) fx.add({ k: 'steam', x: p.x + (Math.random() - 0.5) * 160 * k, y: p.y + (Math.random() - 0.5) * 20 * k, r: 20 * Math.max(0.4, k), gr: 6, life: 14, a: 0.35, c: '210,215,218' });
          break;
        }
        case 'collision': {
          fx.explosion(e.pos.x, e.pos.y, 0.6, 'nonpen');
          if (vol) this.audio.hit(earD(e.pos), 'nonpen');
          if (me && (e.a.id === me.id || e.b.id === me.id)) this.hud?.alert('COLLISION', 'bad', `${e.a.name} and ${e.b.name}`);
          break;
        }
        case 'grounding': {
          fx.explosion(e.pos.x, e.pos.y, 0.5, 'nonpen');
          if (e.ship.id === this.playerId) { this.hud?.alert('AGROUND', 'bad', 'Hull holed — ring astern to back off'); cam.addShake(0.8); }
          break;
        }
        case 'detected': {
          if (this.hud && me && e.by === me.team && this.world.time > 2) {
            const s = e.ship;
            const near = this.world.ships.filter((o) => o.team === me.team && o.status === 'active').reduce((a, b) => (dist(a.pos, s.pos) < dist(b.pos, s.pos) ? a : b), me);
            this.hud.logLine(`<b class="k" style="color:#ff8a70">CONTACT</b> ${s.cls.type} <b>${s.name}</b> · ${(dist(near.pos, s.pos) / 1000).toFixed(1)} km`, 'spot');
          }
          break;
        }
        case 'end': {
          if (this.mode !== 'battle') break;
          this.slowmo = Math.max(this.slowmo, 1.6);
          // frame the decisive moment: the ship that just went out of action
          if (this.lastOut && this.lastOut.id !== this.playerId) { this.lockId = this.lastOut.id; this.renderer.camera.refocus(); }
          this.renderer.camera.targetZoom = Math.max(this.renderer.camera.targetZoom, 0.45);
          break;
        }
      }
    }
  }

  private consequence(s: Ship, id: string): string {
    const m = s.mod(id);
    switch (m.def.kind) {
      case 'engine': case 'boiler': return `Propulsion power ${Math.round(s.propulsionPower() * 100)}%`;
      case 'steering': return m.level === 3 ? 'Rudder jammed — steering lost' : 'Rudder response reduced';
      case 'director': return s.cls.radar && m.level === 3 && s.modsOf('director')[0] === m ? 'Fire control degraded — radar lost' : 'Fire control degraded — dispersion increased';
      case 'bridge': return m.level === 3 ? 'Conning from aft — helm orders delayed' : 'Helm orders delayed';
      case 'turret': return m.level === 3 ? 'Turret knocked out' : `${s.gunsFor(s.turrets.find((t) => t.def.id === id)!)} guns serviceable`;
      case 'magazine': return 'Ammunition supply disrupted';
      case 'funnel': return 'Boiler draught reduced';
      case 'secondary': return m.level === 3 ? 'Secondary battery silenced' : 'Secondary battery firing slower';
      case 'torpedo': return m.level === 3 ? 'Torpedo mount wrecked' : 'Torpedo mount damaged';
    }
    return '';
  }

  private locationName(s: Ship, x: number): string {
    const sec = s.sections[s.sectionAt(x)];
    return sec.def.name;
  }

  private onHit(e: Extract<WorldEvent, { type: 'hit' }>, vol: number, d: number) {
    const r = e.report;
    const fx = this.renderer.fx;
    const me = this.player;
    const k = Math.max(0.3, Math.sqrt(e.shell.shell.caliber / 406));
    const kindFx = r.kind === 'citadel' ? 'citadel' : r.kind === 'nonpen' || r.kind === 'ricochet' || r.kind === 'shatter' ? r.kind === 'shatter' ? 'nonpen' : r.kind : r.kind === 'he' ? 'he' : 'pen';
    if (r.kind === 'overpen') fx.explosion(e.pos.x, e.pos.y, 0.5 * k, 'nonpen');
    else if (r.kind === 'underwater') fx.splash(e.pos.x, e.pos.y, 1.3 * k, null);
    else fx.explosion(e.pos.x, e.pos.y, k, kindFx as any);
    if (r.det && r.kind !== 'nonpen') {
      const dp = r.ship.localToWorld(r.det);
      if (dist(dp, e.pos) > 4) fx.explosion(dp.x, dp.y, 0.8 * k, r.kind === 'citadel' ? 'citadel' : 'pen');
      this.renderer.addDecal(r.ship, r.det.x, r.det.y, (6 + Math.random() * 4) * k);
    }
    if (r.kind !== 'ricochet' && r.kind !== 'nonpen') this.renderer.addDecal(r.ship, r.local.x, r.local.y, (4 + Math.random() * 3) * k);
    if (vol && (!e.shell.secondary || d < 2500)) this.audio.hit(d, r.kind === 'citadel' ? 'citadel' : kindFx);
    if (me && r.ship.id === me.id) {
      this.renderer.camera.addShake((r.kind === 'citadel' ? 0.6 : 0.35) * k);
      this.hud?.status.addStrike(r, e.shell);
    }
    this.trackSalvo(e.shell.salvo, e.pos, true, !['nonpen', 'ricochet', 'shatter'].includes(r.kind));

    if (!this.hud || !me) return;
    const involved = r.ship.id === me.id || e.shell.shooter === me.id;
    // the secondary battery's steady patter only gets floating verdicts when it matters
    if (e.shell.secondary && !(involved && (r.kind === 'citadel' || r.modules.some((m) => m.after <= 0)))) return;
    const kt = KIND_TEXT[r.kind] ?? KIND_TEXT.pen;
    const a = r.armor;
    const sub = a ? (e.shell.shell.id === 'AP' ? `${a.thickness} mm ${a.angle > 0 ? `@${Math.round(a.angle * 57.3)}°` : ''} → ${Math.round(a.effective)} vs ${Math.round(a.pen)}` : `${a.thickness} mm ${r.plate}`) : '';
    const visible = this.world.isVisibleTo(me.team, r.ship);
    if (involved || (visible && dist(e.pos, this.renderer.camera) < 3000 / Math.max(0.1, this.renderer.camera.zoom * 2))) {
      this.renderer.addText({ x: e.pos.x, y: e.pos.y, text: kt.t, sub: involved ? sub : undefined, color: kt.c, life: 3.2, big: r.kind === 'citadel' });
    }
    if (!involved || e.shell.secondary) return;
    if (e.shell.shooter === me.id && vol && !['nonpen', 'ricochet', 'shatter'].includes(r.kind)) this.audio.confirm(r.kind === 'citadel' ? 2 : r.modules.length ? 1 : 0);
    const mods = r.modules.filter((m) => m.dmg >= 4).sort((x, y) => y.dmg - x.dmg).slice(0, 2);
    const modTxt = mods.map((m) => {
      const lvl = r.ship.mod(m.id).level;
      return `<span class="lv${lvl}">${m.name}${lvl === 3 ? ' ✕' : ''}</span>`;
    }).join(', ');
    const plate = r.plate ? ` · ${r.plate}` : '';
    const armorTxt = a && e.shell.shell.id === 'AP' ? ` <i>${Math.round(a.effective)}/${Math.round(a.pen)} mm</i>` : '';
    const extra = [r.fire ? 'fire' : '', r.flooding ? 'flooding' : ''].filter(Boolean).join(', ');
    if (r.ship.id === me.id) {
      this.hud.logLine(`<b class="k" style="color:${kt.c}">${kt.t}</b> received${plate}${armorTxt}${modTxt ? ' — ' + modTxt : ''}${extra ? ` <em>${extra}</em>` : ''}`, 'own');
    } else {
      this.hud.logLine(`<b class="k" style="color:${kt.c}">${kt.t}</b> on ${r.ship.name}${plate}${armorTxt}${modTxt ? ' — ' + modTxt : ''}${extra ? ` <em>${extra}</em>` : ''}`, 'deal');
    }
  }

  /** Spotting report for the player's salvos: over/short/straddle. */
  private trackSalvo(id: number, pos: Vec2, hit: boolean, pen: boolean) {
    const tr = this.salvos.get(id);
    if (!tr) return;
    tr.landed.push(pos);
    if (hit) tr.hits++;
    if (pen) tr.pens++;
    if (tr.landed.length < tr.n) return;
    this.salvos.delete(id);
    const me = this.world.shipById(tr.shooter);
    if (!me || !this.hud) return;
    // nearest visible enemy to the aim point
    let tgt: Ship | null = null, bd = Infinity;
    for (const s of this.world.ships) if (s.team !== me.team && s.status !== 'sunk' && this.world.isVisibleTo(me.team, s)) { const d = dist(s.pos, tr.aim); if (d < bd) { bd = d; tgt = s; } }
    if (!tgt || bd > 2500) { this.hud.logLine(`Salvo ${tr.shot}: ${tr.n} rounds — no target near fall of shot`, 'dim'); return; }
    const brg = Math.atan2(tgt.pos.y - me.pos.y, tgt.pos.x - me.pos.x);
    const f = fromAngle(brg);
    let over = 0, short = 0, sumA = 0, sumL = 0;
    for (const p of tr.landed) {
      const rx = p.x - tgt.pos.x, ry = p.y - tgt.pos.y;
      const along = rx * f.x + ry * f.y, lat = -rx * f.y + ry * f.x;
      sumA += along; sumL += lat;
      if (along > 15) over++; else if (along < -15) short++;
    }
    const mA = sumA / tr.landed.length, mL = sumL / tr.landed.length;
    let verdict: string;
    if (over && short) verdict = '<b class="good">STRADDLE</b>';
    else if (Math.abs(mA) < 60) verdict = 'on range';
    else verdict = mA > 0 ? `<b>OVER</b> ${Math.round(mA)} m` : `<b>SHORT</b> ${Math.round(-mA)} m`;
    const lat = Math.abs(mL) > 40 ? ` · ${Math.round(Math.abs(mL))} m ${mL > 0 ? 'right' : 'left'}` : '';
    const hits = tr.hits ? ` — <b class="good">${tr.hits} hit${tr.hits > 1 ? 's' : ''}</b>` : '';
    // quick-firing guns: report at most every few seconds unless something hit
    if (!tr.hits && this.world.time - this.lastSpot < 4) return;
    this.lastSpot = this.world.time;
    this.hud.logLine(`Salvo ${tr.shot}: ${verdict}${lat}${hits}`, 'spot');
  }
}

export { STATE_NAMES, TEAM_RGB };
