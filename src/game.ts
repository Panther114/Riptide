// Game orchestration: owns the world, controllers, renderer, HUD and audio for a
// battle, and translates simulation events into presentation.

import { Vec2, clamp, dist, pointInPolygon, toLocal, fromAngle } from './core/math';
import { AIDirector } from './ai/ai';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { Renderer, TEAM_RGB } from './render/renderer';
import type { Ship } from './sim/ship';
import { STATE_NAMES, newCommand, type BattleConfig, type ShipCommand } from './sim/types';
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
};

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
  paused = false;
  mode: 'battle' | 'attract' = 'battle';
  private cmd: ShipCommand = newCommand();
  private salvos = new Map<number, SalvoTrack>();
  private salvoCount = 0;
  private endTimer = -1;
  onEnd: ((w: World, me: Ship | null) => void) | null = null;
  private hudRoot: HTMLElement;
  private lastAlarm = 0;
  private attractT = 0;
  private attractFocus = 0;
  timeScale = 1;

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
    this.paused = false;
    this.endTimer = -1;
    this.salvos.clear();
    this.salvoCount = 0;
    this.cmd = newCommand();
    if (p) { this.cmd.telegraph = p.telegraph; }
    if (this.hud) { this.hud.root.remove(); this.hud = null; }
    if (mode === 'battle') {
      this.hud = new Hud(this.hudRoot);
      this.audio.startAmbient();
      this.renderer.camera.zoom = 0.06;
      this.renderer.camera.targetZoom = 0.42;
      if (p) { this.renderer.camera.x = p.pos.x; this.renderer.camera.y = p.pos.y; }
      setTimeout(() => this.hud?.showBanner(`<div class="b-k">BATTLE STATIONS</div><div class="b-s">Enemy battleship bearing ${this.bearingTo()} · ${this.rangeTo()}</div>`, 3600), 300);
    } else {
      this.renderer.camera.zoom = 0.5; this.renderer.camera.targetZoom = 0.5;
      this.attractT = 0;
    }
  }

  private bearingTo() {
    const p = this.player; if (!p) return '';
    const e = this.world.enemiesOf(p)[0]; if (!e) return '';
    const b = Math.atan2(e.pos.y - p.pos.y, e.pos.x - p.pos.x);
    return String(Math.round(((b + Math.PI / 2) * 180 / Math.PI + 360) % 360)).padStart(3, '0') + '°';
  }
  private rangeTo() {
    const p = this.player; if (!p) return '';
    const e = this.world.enemiesOf(p)[0]; if (!e) return '';
    return (dist(p.pos, e.pos) / 1000).toFixed(1) + ' km';
  }

  stop() {
    if (this.hud) { this.hud.root.remove(); this.hud = null; }
    this.audio.stopAmbient();
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
      if (me && me.alive) {
        if (inp.hit('KeyW') || inp.hit('ArrowUp')) { this.cmd.telegraph = clamp(this.cmd.telegraph + 1, -2, 4); this.audio.ui('tick'); }
        if (inp.hit('KeyS') || inp.hit('ArrowDown')) { this.cmd.telegraph = clamp(this.cmd.telegraph - 1, -2, 4); this.audio.ui('tick'); }
        const left = inp.down('KeyA') || inp.down('ArrowLeft'), right = inp.down('KeyD') || inp.down('ArrowRight');
        this.cmd.rudder = left && !right ? -1 : right && !left ? 1 : 0;
        if (inp.hit('Digit1')) { this.cmd.ammo = 'AP'; this.audio.ui('ammo'); }
        if (inp.hit('Digit2')) { this.cmd.ammo = 'HC'; this.audio.ui('ammo'); }
        this.cmd.aim = inp.mouse.inside ? cam.screenToWorld(inp.mouse) : this.cmd.aim;
        this.cmd.fire = inp.buttons[0];
        me.setCommand({ ...this.cmd }, this.world.time);
      }
      if (inp.wheel) cam.zoomBy(inp.wheel);
      if (inp.clicked[1]) this.pickLock(cam.screenToWorld(inp.mouse));

      // ---- simulate (sub-stepped)
      const simDt = dt * this.timeScale;
      const steps = Math.max(1, Math.ceil(simDt / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        this.ai.update(this.world, simDt / steps);
        this.world.step(simDt / steps);
        this.ai.observe(this.world.events, this.world);
        this.handleEvents(this.world.events);
        this.world.events.length = 0;
        if (me) me.cmd.fire = false;
      }
      this.renderer.update(this.world, simDt);
      if (me) this.audio.setEngine(me.power, Math.abs(me.speed) / me.cls.maxSpeed);
      this.updateIncoming();

      if (this.world.ended) {
        if (this.endTimer < 0) this.endTimer = 11;
        this.endTimer -= dt;
        if (this.endTimer <= 0 && this.onEnd) { const cb = this.onEnd; this.onEnd = null; cb(this.world, me); }
      }
    } else if (this.mode === 'attract') {
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        this.ai.update(this.world, dt / steps);
        this.world.step(dt / steps);
        this.ai.observe(this.world.events, this.world);
        this.handleEvents(this.world.events, true);
        this.world.events.length = 0;
      }
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
      cam.targetZoom = 0.62 + Math.sin(this.attractT * 0.15) * 0.18;
      // keep the subject on the right third, clear of the title menu
      if (s) focus = { x: s.pos.x - (cam.w * 0.2) / cam.zoom, y: s.pos.y + (cam.h * 0.04) / cam.zoom };
    } else {
      const locked = this.lockId != null ? this.world.shipById(this.lockId) : null;
      if (locked && locked.status !== 'sunk') focus = locked.pos;
      else if (me) focus = me.pos;
      else { const any = this.world.ships.find((s) => s.status !== 'sunk'); if (any) focus = any.pos; }
    }
    cam.update(dtReal, focus, { x: 0, y: 0 });

    // ---- draw
    this.renderer.render(this.world, {
      player: this.mode === 'battle' ? me : null,
      aimWorld: this.mode === 'battle' && me?.alive && !me.outOfAction ? cam.screenToWorld(inp.mouse) : null,
      mouse: inp.mouse,
      lockId: this.lockId,
      rudderHeld: this.cmd.rudder,
      showOverlay: this.mode === 'battle' && !this.paused,
      time: this.world.time,
    });
    if (this.hud) this.hud.update(this.world, me, this.paused ? 0 : dt, this.cmd.rudder, this.lockId);
  }

  private pickLock(w: Vec2) {
    const cam = this.renderer.camera;
    let best: Ship | null = null, bd = Infinity;
    for (const s of this.world.ships) {
      if (s.status === 'sunk') continue;
      const local = toLocal(w, s.pos, s.heading);
      const inside = pointInPolygon(local, s.cls.hull);
      const d = dist(w, s.pos);
      const slop = 28 / cam.zoom;
      if ((inside || d < Math.max(slop, s.cls.length * 0.6)) && d < bd) { bd = d; best = s; }
    }
    const prev = this.lockId;
    this.lockId = best && best.id !== this.playerId ? best.id : null;
    if (prev !== this.lockId) { cam.refocus(); this.audio.ui('click'); }
  }

  private incomingPlayed = new Set<number>();
  private updateIncoming() {
    const me = this.player;
    if (!me || !me.alive) return;
    for (const sh of this.world.shells) {
      if (sh.team === me.team || this.incomingPlayed.has(sh.id)) continue;
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
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          fx.muzzle(e.pos.x, e.pos.y, e.bearing, e.guns);
          if (vol) this.audio.gun(earD(e.pos), e.ship.id === this.playerId);
          if (e.ship.id === this.playerId) cam.addShake(0.28);
          // track own salvo for spotting reports
          if (e.ship.id === this.playerId) {
            const sh = this.world.shells.filter((s) => s.shooter === e.ship.id).slice(-e.guns);
            if (sh.length) {
              const sid = sh[0].salvo;
              const tr = this.salvos.get(sid) ?? { id: sid, shooter: e.ship.id, n: 0, landed: [], hits: 0, pens: 0, aim: sh[0].aimPoint, shot: ++this.salvoCount };
              tr.n += sh.length;
              this.salvos.set(sid, tr);
            }
          }
          break;
        }
        case 'splash': {
          const dye = e.shell.team === 'blue' ? '226,238,250' : '250,232,226';
          fx.splash(e.pos.x, e.pos.y, e.shell.shell.id === 'HC' ? 1.0 : 1.15, dye);
          if (vol) this.audio.splash(earD(e.pos));
          if (me && e.shell.team !== me.team && dist(e.pos, me.pos) < 250) cam.addShake(0.18);
          this.trackSalvo(e.shell.salvo, e.pos, false, false);
          break;
        }
        case 'hit': this.onHit(e, vol, earD(e.pos)); break;
        case 'module': {
          if (e.ship.id === this.playerId && this.hud) {
            const lvl = e.level;
            const name = e.module.name;
            if (lvl === 3) this.hud.alert(`${name.toUpperCase()} DESTROYED`, 'bad', this.consequence(e.ship, e.module.id));
            else if (lvl === 2) this.hud.alert(`${name} heavily damaged`, 'bad', this.consequence(e.ship, e.module.id));
            else if (lvl === 1) this.hud.logLine(`<b>${name}</b> damaged`, 'own');
            if (lvl >= 2 && this.world.time - this.lastAlarm > 2) { this.audio.ui('alarm'); this.lastAlarm = this.world.time; }
          } else if (this.hud && me && e.ship.team !== me.team && e.level === 3) {
            this.hud.logLine(`Enemy <b>${e.module.name}</b> knocked out`, 'good');
          }
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
          else if (this.hud) this.hud.logLine(`${e.ship.name}: ${e.name} flooded`, 'good');
          break;
        }
        case 'moduleFlooded': {
          if (e.ship.id === this.playerId && this.hud) this.hud.alert(`${e.name.toUpperCase()} FLOODED OUT`, 'bad');
          break;
        }
        case 'magazine': {
          const p = e.ship.localToWorld({ x: e.x, y: 0 });
          fx.explosion(p.x, p.y, 2.2, 'magazine');
          if (vol) this.audio.hit(earD(p) * 0.5, 'magazine');
          cam.addShake(e.ship.id === this.playerId ? 1.2 : 0.7);
          this.hud?.showBanner(`<div class="b-k ${e.ship.team === me?.team ? 'bad' : 'good'}">MAGAZINE DETONATION</div><div class="b-s">${e.ship.name.toUpperCase()} HAS BLOWN UP</div>`, 4200);
          break;
        }
        case 'outOfAction': {
          if (!this.hud) break;
          const own = e.ship.team === me?.team;
          if (e.reason !== 'Magazine detonation') this.hud.showBanner(`<div class="b-k ${own ? 'bad' : 'good'}">${e.ship.name.toUpperCase()} OUT OF ACTION</div><div class="b-s">${e.reason}</div>`, 3600);
          this.hud.logLine(`<b>${e.ship.name}</b> out of action — ${e.reason}`, own ? 'bad' : 'good');
          break;
        }
        case 'sinking': {
          const p = e.ship.pos;
          for (let i = 0; i < 6; i++) fx.add({ k: 'steam', x: p.x + (Math.random() - 0.5) * 160, y: p.y + (Math.random() - 0.5) * 20, r: 20, gr: 6, life: 14, a: 0.35, c: '210,215,218' });
          break;
        }
        case 'collision': {
          fx.explosion(e.pos.x, e.pos.y, 0.6, 'nonpen');
          if (vol) this.audio.hit(earD(e.pos), 'nonpen');
          break;
        }
        case 'end': break;
      }
    }
  }

  private consequence(s: Ship, id: string): string {
    const m = s.mod(id);
    switch (m.def.kind) {
      case 'engine': case 'boiler': return `Propulsion power ${Math.round(s.propulsionPower() * 100)}%`;
      case 'steering': return m.level === 3 ? 'Rudder jammed — steering lost' : 'Rudder response reduced';
      case 'director': return 'Fire control degraded — dispersion increased';
      case 'bridge': return m.level === 3 ? 'Conning from aft — helm orders delayed' : 'Helm orders delayed';
      case 'turret': return m.level === 3 ? 'Turret knocked out' : `${s.gunsFor(s.turrets.find((t) => t.def.id === id)!)} guns serviceable`;
      case 'magazine': return 'Ammunition supply disrupted';
      case 'funnel': return 'Boiler draught reduced';
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
    const kindFx = r.kind === 'citadel' ? 'citadel' : r.kind === 'nonpen' || r.kind === 'ricochet' || r.kind === 'shatter' ? r.kind === 'shatter' ? 'nonpen' : r.kind : r.kind === 'he' ? 'he' : 'pen';
    if (r.kind === 'overpen') fx.explosion(e.pos.x, e.pos.y, 0.5, 'nonpen');
    else if (r.kind === 'underwater') fx.splash(e.pos.x, e.pos.y, 1.3, null);
    else fx.explosion(e.pos.x, e.pos.y, 1, kindFx as any);
    if (r.det && r.kind !== 'nonpen') {
      const dp = r.ship.localToWorld(r.det);
      if (dist(dp, e.pos) > 4) fx.explosion(dp.x, dp.y, 0.8, r.kind === 'citadel' ? 'citadel' : 'pen');
      this.renderer.addDecal(r.ship, r.det.x, r.det.y, 6 + Math.random() * 4);
    }
    if (r.kind !== 'ricochet' && r.kind !== 'nonpen') this.renderer.addDecal(r.ship, r.local.x, r.local.y, 4 + Math.random() * 3);
    if (vol) this.audio.hit(d, r.kind === 'citadel' ? 'citadel' : kindFx);
    if (me && r.ship.id === me.id) this.renderer.camera.addShake(r.kind === 'citadel' ? 0.6 : 0.35);
    this.trackSalvo(e.shell.salvo, e.pos, true, !['nonpen', 'ricochet', 'shatter'].includes(r.kind));

    if (!this.hud || !me) return;
    const involved = r.ship.id === me.id || e.shell.shooter === me.id;
    const kt = KIND_TEXT[r.kind] ?? KIND_TEXT.pen;
    const a = r.armor;
    const sub = a ? (e.shell.shell.id === 'AP' ? `${a.thickness} mm ${a.angle > 0 ? `@${Math.round(a.angle * 57.3)}°` : ''} → ${Math.round(a.effective)} vs ${Math.round(a.pen)}` : `${a.thickness} mm ${r.plate}`) : '';
    if (involved || dist(e.pos, this.renderer.camera) < 3000 / Math.max(0.1, this.renderer.camera.zoom * 2)) {
      this.renderer.addText({ x: e.pos.x, y: e.pos.y, text: kt.t, sub: involved ? sub : undefined, color: kt.c, life: 3.2, big: r.kind === 'citadel' });
    }
    if (!involved) return;
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
    // nearest enemy to the aim point
    let tgt: Ship | null = null, bd = Infinity;
    for (const s of this.world.ships) if (s.team !== me.team && s.status !== 'sunk') { const d = dist(s.pos, tr.aim); if (d < bd) { bd = d; tgt = s; } }
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
    this.hud.logLine(`Salvo ${tr.shot}: ${verdict}${lat}${hits}`, 'spot');
  }
}

export { STATE_NAMES, TEAM_RGB };
