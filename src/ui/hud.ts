// Combat HUD (DOM). Minimal, high-contrast, information ordered by urgency:
// alerts > own ship state > gunnery > helm > battle overview.

import { DEG, clamp01, dist, wrapAngle } from '../core/math';
import type { Ship } from '../sim/ship';
import type { World } from '../sim/world';
import { TELEGRAPH, telegraphLabel } from '../sim/types';
import { StatusPanel, STATE_COLORS } from './statusPanel';
import { TEAM_COLOR } from '../render/renderer';

const el = (tag: string, cls?: string, html?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Hud {
  root: HTMLElement;
  status: StatusPanel;
  private log: HTMLElement;
  private alerts: HTMLElement;
  private helm: HTMLElement;
  private guns: HTMLElement;
  private top: HTMLElement;
  private stat: HTMLElement;
  private minimap: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private tick = 0;
  private tip!: HTMLElement;
  private canvasTick = 1;
  private help: HTMLElement;
  private banner: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);

    this.top = el('div', 'hud-top');
    this.root.appendChild(this.top);

    this.alerts = el('div', 'hud-alerts');
    this.root.appendChild(this.alerts);

    this.banner = el('div', 'hud-banner');
    this.root.appendChild(this.banner);
    this.root.appendChild(el('div', 'hud-warn'));

    const mmWrap = el('div', 'hud-minimap panel');
    this.minimap = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.minimap.width = 168 * dpr; this.minimap.height = 168 * dpr;
    this.minimap.style.width = '168px'; this.minimap.style.height = '168px';
    this.mmCtx = this.minimap.getContext('2d')!;
    this.mmCtx.scale(dpr, dpr);
    mmWrap.appendChild(this.minimap);
    this.root.appendChild(mmWrap);

    this.log = el('div', 'hud-log');
    this.root.appendChild(this.log);

    const left = el('div', 'hud-status panel');
    left.appendChild(el('div', 'panel-title', '<span>DAMAGE CONTROL <em class="dc-key">V armour</em></span><span class="dc-name"></span>'));
    const cv = document.createElement('canvas');
    left.appendChild(cv);
    this.status = new StatusPanel(cv);
    this.tip = el('div', 'dc-tip');
    left.appendChild(this.tip);
    this.stat = el('div', 'dc-stats');
    left.appendChild(this.stat);
    this.root.appendChild(left);

    this.helm = el('div', 'hud-helm panel');
    this.root.appendChild(this.helm);
    this.guns = el('div', 'hud-guns panel');
    this.root.appendChild(this.guns);

    this.help = el('div', 'hud-help', `
      <div class="k"><b>W</b>/<b>S</b> engine telegraph</div>
      <div class="k"><b>A</b>/<b>D</b> rudder one step: port · amidships · starboard</div>
      <div class="k"><b>LMB</b> fire ready turrets / launch torpedoes</div>
      <div class="k"><b>RMB</b> set / drag a fixed aim point · <b>Space</b> aim follows cursor</div>
      <div class="k"><b>1</b>/<b>2</b> load AP / HC · <b>T</b> guns ↔ torpedoes</div>
      <div class="k"><b>X</b> smoke · <b>G</b> secondaries · <b>C</b> counter-flood</div>
      <div class="k"><b>Click</b> the damage-control plan to send a party</div>
      <div class="k"><b>Wheel</b> zoom · <b>MMB</b> drag pan · click ship lock</div>
      <div class="k"><b>Tab</b> next ship (fleet battles)</div>
      <div class="k"><b>H</b> hide help · <b>Esc</b> pause</div>`);
    this.root.appendChild(this.help);
    setTimeout(() => this.help.classList.add('hidden'), 35000);
    this.tipEl = el('div', 'hud-tip');
    this.root.appendChild(this.tipEl);
    let seen = false;
    try { seen = localStorage.getItem('riptide.tips') === '1'; } catch { /* private mode */ }
    if (!seen) {
      const tips: [number, string][] = [
        [5, '<b>Find the enemy</b> — middle-click the red arrow at the screen edge to lock the camera on her. Wheel to zoom.'],
        [17, '<b>Lead the target</b> — your shells fly for many seconds. Aim at the red diamond: fire control works out where she will be when your shells land.'],
        [24, '<b>Fix your aim</b> — <b>right-click</b> the sea to pin the aim point there (drag to move it), so zooming and panning leave it alone. <b>Space</b> lets it follow the cursor again.'],
        [52, '<b>Patience pays</b> — a steady point of aim refines the solution: the spread ellipse shrinks by about a third. Turning hard or switching targets starts it over.'],
        [31, '<b>Read the fall of shot</b> — spotting reports on the right say over, short or straddle. Walk your salvos on.'],
        [45, '<b>Angle your ship</b> — keep the enemy ~45° off the bow: all turrets bear and your belt is harder to pierce. <b>A</b>/<b>D</b> steer, <b>W</b>/<b>S</b> engines.'],
        [60, '<b>Damage control</b> — the diagram bottom-left shows every compartment. Hover it, or press <b>V</b> for the armour scheme.'],
      ];
      for (const [t, html] of tips) setTimeout(() => { if (this.root.isConnected) this.showTip(html); }, t * 1000);
      setTimeout(() => { try { localStorage.setItem('riptide.tips', '1'); } catch { /* ignore */ } }, 61000);
    }
    this.buildHelm();
  }

  toggleHelp() { this.help.classList.toggle('hidden'); }
  private tipEl!: HTMLElement;
  private tipTimer = 0;
  showTip(html: string) {
    this.tipEl.innerHTML = html;
    this.tipEl.classList.add('show');
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.tipEl.classList.remove('show'), 10500);
  }

  // ------------------------------------------------------------ log & alerts
  logLine(html: string, cls = '') {
    const line = el('div', 'log-line ' + cls, html);
    this.log.prepend(line);
    while (this.log.children.length > 7) this.log.lastChild!.remove();
    setTimeout(() => line.classList.add('fade'), 9000);
    setTimeout(() => line.remove(), 10500);
  }

  alert(text: string, kind: 'bad' | 'good' | 'info' = 'bad', sub = '') {
    // collapse duplicates
    for (const c of Array.from(this.alerts.children)) if ((c as HTMLElement).dataset.text === text) c.remove();
    const a = el('div', 'alert ' + kind, `<div class="a-main">${text}</div>${sub ? `<div class="a-sub">${sub}</div>` : ''}`);
    a.dataset.text = text;
    this.alerts.prepend(a);
    while (this.alerts.children.length > 3) this.alerts.lastChild!.remove();
    setTimeout(() => a.classList.add('fade'), 3800);
    setTimeout(() => a.remove(), 4500);
  }

  showBanner(html: string, ms = 2600) {
    this.banner.innerHTML = html;
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ helm
  private telegraphEl!: HTMLElement;
  private speedEl!: HTMLElement;
  private headEl!: HTMLElement;
  private rudderCanvas!: HTMLCanvasElement;
  private buildHelm() {
    this.helm.innerHTML = `
      <div class="panel-title"><span>HELM</span><span class="helm-order"></span></div>
      <div class="helm-body">
        <div class="telegraph">${TELEGRAPH.slice().reverse().map((t) => `<div class="tg" data-v="${t.v}">${t.label.replace(' AHEAD', '').replace(' ASTERN', '')}${t.v < 0 ? ' ◂' : ''}</div>`).join('')}</div>
        <div class="helm-main">
          <div class="speed"><span class="v">0.0</span><span class="u">KN</span></div>
          <canvas class="rudder"></canvas>
          <div class="heading">HDG <span>000°</span></div>
        </div>
      </div>`;
    this.telegraphEl = this.helm.querySelector('.telegraph')!;
    this.speedEl = this.helm.querySelector('.speed .v')!;
    this.headEl = this.helm.querySelector('.heading span')!;
    this.rudderCanvas = this.helm.querySelector('canvas.rudder')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.rudderCanvas.width = 150 * dpr; this.rudderCanvas.height = 64 * dpr;
    this.rudderCanvas.style.width = '150px'; this.rudderCanvas.style.height = '64px';
    this.rudderCanvas.getContext('2d')!.scale(dpr, dpr);
  }

  private drawRudder(s: Ship, held: number) {
    const ctx = this.rudderCanvas.getContext('2d')!;
    const w = 150, h = 64;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = 6, R = 46;
    const max = s.cls.rudderMax;
    // arc scale (rudder seen from above: angle swings to port/starboard)
    ctx.strokeStyle = 'rgba(210,228,236,0.25)'; ctx.lineWidth = 6; ctx.lineCap = 'butt';
    const span = 0.85;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI / 2 - span, Math.PI / 2 + span); ctx.stroke();
    // ticks
    ctx.strokeStyle = 'rgba(210,228,236,0.45)'; ctx.lineWidth = 1;
    for (let i = -7; i <= 7; i++) {
      const a = Math.PI / 2 - (i / 7) * span;
      const r0 = R + 5, r1 = R + (i % 7 === 0 || i === 0 ? 10 : 7);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // commanded (ghost)
    const cmdA = Math.PI / 2 - (s.cmd.rudder) * span;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.min(Math.PI / 2, cmdA), Math.max(Math.PI / 2, cmdA)); ctx.stroke();
    // actual rudder
    const a = Math.PI / 2 - (s.rudder / max) * span;
    const jammed = s.steeringFactor() === 0;
    ctx.strokeStyle = jammed ? '#e5534b' : held ? '#ffffff' : 'rgba(150,215,255,1)';
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2)); ctx.stroke();
    ctx.fillStyle = 'rgba(210,228,236,0.8)';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 10px "Barlow Condensed", sans-serif';
    ctx.fillStyle = 'rgba(210,228,236,0.6)';
    ctx.textAlign = 'left'; ctx.fillText('PORT', cx - R - 22, cy + 34);
    ctx.textAlign = 'right'; ctx.fillText('STBD', cx + R + 22, cy + 34);
    ctx.textAlign = 'center';
    ctx.fillStyle = jammed ? '#e5534b' : 'rgba(235,242,245,0.95)';
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    const deg = Math.round(s.rudder / DEG);
    ctx.fillText(jammed ? `JAMMED ${Math.abs(deg)}°${deg > 0 ? 'S' : deg < 0 ? 'P' : ''}` : `${Math.abs(deg)}° ${deg > 0 ? 'STBD' : deg < 0 ? 'PORT' : 'MID'}`, cx, cy + 55);
  }

  // ------------------------------------------------------------ main update
  weapon: 'guns' | 'torpedo' = 'guns';

  update(world: World, me: Ship | null, dt: number, rudderHeld: number, focusId: number | null) {
    this.tick += dt;
    this.canvasTick += dt;
    // canvases redraw at ~30 Hz: plenty for gauges, cheaper on integrated GPUs
    if (this.canvasTick >= 1 / 30) {
      if (me) {
        this.status.draw(me, this.canvasTick, world.time);
        this.drawRudder(me, rudderHeld);
      }
      this.drawMinimap(world, me, focusId);
      this.canvasTick = 0;
    }
    if (this.tick < 0.1) return;
    this.tick = 0;
    this.updateTop(world, me);
    if (!me) return;

    // leaving the battle area / fleet hand-over hints
    const warn = this.root.querySelector('.hud-warn') as HTMLElement;
    let wtxt = '';
    const beyond = Math.max(Math.abs(me.pos.x), Math.abs(me.pos.y)) > world.mapHalf;
    if (me.alive && !me.outOfAction && (beyond || me.outOfBoundsTime > 0)) wtxt = me.outOfBoundsTime > 0 ? `RETURN TO THE BATTLE AREA · ${Math.max(0, 60 - me.outOfBoundsTime).toFixed(0)} s` : 'LEAVING THE BATTLE AREA';
    else if (me.outOfAction && world.ships.some((s) => s.team === me.team && !s.outOfAction && s.status === 'active')) wtxt = 'PRESS TAB TO TAKE COMMAND OF ANOTHER SHIP';
    warn.textContent = wtxt;
    warn.classList.toggle('show', !!wtxt);

    // helm text
    const kn = me.speed / 0.5144;
    this.speedEl.textContent = (kn < 0 ? '−' : '') + Math.abs(kn).toFixed(1);
    const hdg = Math.round(((wrapAngle(me.heading + Math.PI / 2) / DEG) + 360) % 360);
    this.headEl.textContent = String(hdg).padStart(3, '0') + '°';
    for (const c of Array.from(this.telegraphEl.children) as HTMLElement[]) {
      c.classList.toggle('on', Number(c.dataset.v) === me.cmd.telegraph);
    }
    (this.helm.querySelector('.helm-order') as HTMLElement).textContent = `${telegraphLabel(me.cmd.telegraph)} · ${Math.round(me.power * 100)}% PWR`;

    // gunnery panel
    const ammoSel = me.cmd.ammo;
    const ammoTotals = { AP: 0, HC: 0 };
    for (const m of me.ammo.values()) { ammoTotals.AP += m.AP; ammoTotals.HC += m.HC; }
    const fq = clamp01(me.fcSettle - me.fcError * 1.5);
    const fqLabel = me.fcError > 0.3 ? 'DISTURBED' : me.fcSettle > 0.9 ? 'REFINED' : me.fcSettle > 0.45 ? 'TRACKING' : 'RANGING';
    const many = me.turrets.length > 3;
    const tur = me.turrets.map((t) => {
      const lvl = me.mod(t.def.id).level;
      const guns = me.gunsFor(t);
      let state = '', cls = '';
      if (lvl === 3) { state = many ? 'LOST' : 'DESTROYED'; cls = 'dead'; }
      else if (!me.turretOperable(t)) { state = me.mod(t.def.magazine).flooded ? (many ? 'FLOODED' : 'MAG FLOODED') : 'NO AMMO'; cls = 'dead'; }
      else if (t.jam > 0) { state = 'JAMMED'; cls = 'warn'; }
      else if (!t.inArc) { state = many ? 'ARC' : 'BLIND ARC'; cls = 'warn'; }
      else if (!t.loaded) { state = many ? `${t.reload.toFixed(0)}s` : `LOADING ${t.reload.toFixed(0)}s`; cls = 'load'; }
      else if (!t.aligned) { state = many ? 'TRAIN' : 'TRAINING'; cls = 'warn'; }
      else { state = 'READY'; cls = 'ready'; }
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / me.cls.reloadTime);
      const gunsHtml = Array.from({ length: t.def.guns }, (_, i) => `<i class="${i < guns ? 'on' : ''}"></i>`).join('');
      const label = me.mod(t.def.id).def.short;
      return `<div class="turret ${cls}">
        <div class="t-ring" style="--p:${prog}"><span>${label}</span></div>
        <div class="t-info"><div class="t-state">${state}</div><div class="t-guns">${gunsHtml}<em>${t.loaded ?? t.loading}</em></div></div>
      </div>`;
    }).join('');
    // torpedoes, smoke, secondaries
    const extras: string[] = [];
    if (me.cls.torpedoes) {
      const c = me.torpedoCapacity();
      const spare = me.torpedoMounts.reduce((a, m) => a + m.spares * m.def.tubes, 0);
      const reloading = me.torpedoMounts.find((m) => !m.loaded && m.spares > 0 && me.torpedoMountOk(m));
      extras.push(`<div class="am wide ${this.weapon === 'torpedo' ? 'sel torp' : ''}"><b>T</b> TORPEDOES <span>${c.ready}</span>${spare ? `<small>+${spare}${reloading ? ` · ${reloading.reload.toFixed(0)}s` : ''}</small>` : ''}</div>`);
    }
    if (me.cls.smoke) extras.push(`<div class="am ${me.smoking ? 'sel' : ''}"><b>X</b> SMOKE <span>${Math.ceil(me.smokeLeft)}s</span></div>`);
    if (me.cls.secondary) extras.push(`<div class="am ${me.cmd.secondaries !== false ? 'sel' : ''}"><b>G</b> SEC <span>${me.cmd.secondaries !== false ? 'FREE' : 'HOLD'}</span></div>`);
    this.guns.classList.toggle('many', many);
    this.guns.innerHTML = `
      <div class="panel-title"><span>MAIN BATTERY · ${me.cls.gunName}</span><span>${me.stats.hits}/${me.stats.shells} HITS${me.stats.torpedoes ? ` · ${me.stats.torpHits}/${me.stats.torpedoes} TORP` : ''}</span></div>
      <div class="turrets">${tur}</div>
      <div class="ammo">
        <div class="am ${ammoSel === 'AP' && this.weapon === 'guns' ? 'sel' : ''}"><b>1</b> AP <span>${ammoTotals.AP}</span></div>
        <div class="am ${ammoSel === 'HC' && this.weapon === 'guns' ? 'sel' : ''}"><b>2</b> HC <span>${ammoTotals.HC}</span></div>
        <div class="fc"><div class="fc-l">SOLUTION <b>${fqLabel}</b></div><div class="fc-bar"><i style="width:${(fq * 100).toFixed(0)}%"></i></div></div>
      </div>
      ${extras.length ? `<div class="ammo extras">${extras.join('')}</div>` : ''}`;

    // tooltip for the module under the pointer
    const hv = this.status.hover;
    if (hv) {
      let html = '';
      if (hv.startsWith('sec:')) {
        const sec = me.sections.find((q) => 'sec:' + q.def.id === hv)!;
        const w = sec.port + sec.stbd;
        const holes = me.holes.filter((h) => me.sections[h.section] === sec);
        const under = holes.filter((h) => me.waterRise(h.x) - h.z > 0).length;
        const idx = me.sections.indexOf(sec);
        const party = me.dc.findIndex((p) => p.task?.type === 'section' && p.task.index === idx);
        const fires = me.fires.filter((f) => me.sectionAt(f.x) === idx).length;
        html = `<b>${sec.def.name} section</b><span>${Math.round(w)} / ${sec.def.capacity} t flooded · ${holes.length} hole${holes.length === 1 ? '' : 's'}${holes.length ? ` (${under} below water)` : ''}${fires ? ` · ${fires} fire${fires > 1 ? 's' : ''}` : ''}</span>${party >= 0 ? `<span class="dim">Party ${party + 1} working</span>` : me.dcNeeded({ type: 'section', index: idx }) ? '<span class="dim">Click: send damage control</span>' : ''}`;
      } else {
        const m = me.mod(hv);
        const lvl = m.flooded ? 'Flooded' : ['Operational', 'Damaged', 'Heavily damaged', 'Destroyed'][m.level];
        const t = me.turrets.find((q) => q.def.id === hv);
        const zone = me.cls.zones.find((z) => (m.def.rect.x0 + m.def.rect.x1) / 2 >= z.x0 && (m.def.rect.x0 + m.def.rect.x1) / 2 < z.x1);
        const armor = t ? `Face ${t.def.armor.face} · side ${t.def.armor.side} · roof ${t.def.armor.roof} · barbette ${t.def.armor.barbette} mm`
          : m.def.band === 'low' && zone ? `Behind ${zone.belt} mm belt / ${zone.deck} mm deck` : (me.cls.structures.find((q) => q.module === hv)?.armor ?? 16) + ' mm plating';
        const effect = ({ engine: 'Drives a shaft: speed', boiler: 'Raises steam: speed', steering: 'Rudder control', bridge: 'Helm orders', director: 'Fire control & radar', funnel: 'Boiler draught', turret: 'Main battery', magazine: 'Ammunition supply', secondary: 'Secondary battery', torpedo: 'Torpedo tubes — loaded warheads can explode' } as Record<string, string>)[m.def.kind];
        const party = me.dc.findIndex((p) => p.task?.type === 'module' && p.task.id === m.def.id);
        const dcTxt = party >= 0 ? `Party ${party + 1} working` : me.dcNeeded({ type: 'module', id: m.def.id }) ? 'Click: send damage control' : m.hp < m.def.hp && me.repairCap(m) === 0 ? 'Beyond repair in action' : '';
        html = `<b>${m.def.name}</b><span class="lv${m.flooded ? 3 : m.level}">${lvl} · ${Math.round((m.hp / m.def.hp) * 100)}%</span><span>${effect}</span><span class="dim">${armor}</span>${dcTxt ? `<span class="dim">${dcTxt}</span>` : ''}`;
      }
      this.tip.innerHTML = html;
      this.tip.classList.add('show');
    } else this.tip.classList.remove('show');

    // damage control stats
    const r = me.readiness();
    const floodPct = (me.floodTotal / me.cls.reserveBuoyancy) * 100;
    (this.root.querySelector('.dc-name') as HTMLElement).textContent = `${me.cls.prefix} ${me.name.toUpperCase()}`;
    const dcLine = me.dc.map((p, i) => {
      if (!p.task) return `<span class="dcp idle">${i + 1} idle</span>`;
      const what = p.task.type === 'section' ? (me.sections[p.task.index]?.def.name ?? '?') : (me.modules.get(p.task.id)?.def.short ?? '?');
      return `<span class="dcp ${p.manual ? 'man' : ''}">${i + 1} ${what}</span>`;
    }).join('');
    const bar = (label: string, v: number, warn: boolean, txt: string) =>
      `<div class="dc-bar ${warn ? 'warn' : ''}"><span class="l">${label}</span><span class="b"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span class="t">${txt}</span></div>`;
    this.stat.innerHTML =
      bar('BUOYANCY', r.buoyancy, r.buoyancy < 0.5, `${(100 - floodPct).toFixed(0)}%`) +
      bar('PROPULSION', me.power, me.power < 0.5, `${Math.round(me.power * 100)}%`) +
      bar('FIREPOWER', r.firepower, r.firepower < 0.5, `${me.operableGuns()}/${me.totalGuns}`) +
      `<div class="dc-line"><span>FLOOD <b>${me.floodTotal.toFixed(0)} t</b></span><span class="${Math.abs(me.list) > 5 * DEG ? 'fire' : ''}">LIST <b>${(Math.abs(me.list) / DEG).toFixed(1)}° ${me.list > 0.002 ? 'S' : me.list < -0.002 ? 'P' : ''}</b>${me.counterflooding ? ' <em>CF</em>' : ''}</span><span>TRIM <b>${(me.trim * me.cls.length).toFixed(1)} m</b></span><span class="${me.fires.length ? 'fire' : ''}">FIRES <b>${me.fires.length}</b></span></div>` +
      `<div class="dc-line dc-parties"><span class="dct">DC</span>${dcLine}<span class="dck">C counter-flood</span></div>`;
  }

  private updateTop(world: World, me: Ship | null) {
    const t = Math.floor(world.time);
    const clock = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const card = (s: Ship) => {
      const r = s.readiness();
      const hidden = me && s.team !== me.team && !world.isVisibleTo(me.team, s) && !s.outOfAction;
      const seg = (v: number) => `<span class="seg"><i style="width:${hidden ? 0 : (clamp01(v) * 100).toFixed(0)}%"></i></span>`;
      return `<div class="ship-card ${s.team} ${s.outOfAction ? 'out' : ''} ${hidden ? 'hidden' : ''}">
        <div class="sc-name"><small>${s.cls.type}</small> ${s.name.toUpperCase()}${me && s.id === me.id ? ' <em>YOU</em>' : ''}</div>
        <div class="sc-bars" title="Firepower · Mobility · Buoyancy">${seg(r.firepower)}${seg(r.mobility)}${seg(r.buoyancy)}</div>
        ${s.outOfAction ? `<div class="sc-out">${s.outReason}</div>` : hidden ? '<div class="sc-out">not in sight</div>' : ''}
      </div>`;
    };
    const blue = world.ships.filter((s) => s.team === 'blue').map(card).join('');
    const red = world.ships.filter((s) => s.team === 'red').map(card).join('');
    let rangeTxt = '';
    if (me) {
      const foes = world.ships.filter((s) => s.team !== me.team && s.alive && world.isVisibleTo(me.team, s));
      if (foes.length) {
        const d = Math.min(...foes.map((f) => dist(f.pos, me.pos)));
        rangeTxt = `${(d / 1000).toFixed(1)} KM`;
      }
    }
    this.top.innerHTML = `<div class="team blue">${blue}</div>
      <div class="clock"><div class="c-t">${clock}</div><div class="c-r">${rangeTxt}</div></div>
      <div class="team red">${red}</div>`;
  }

  private drawMinimap(world: World, me: Ship | null, focusId: number | null) {
    const ctx = this.mmCtx;
    const S = 168;
    ctx.clearRect(0, 0, S, S);
    const half = world.mapHalf;
    const k = (S - 12) / (half * 2);
    const X = (x: number) => 6 + (x + half) * k, Y = (y: number) => 6 + (y + half) * k;
    ctx.fillStyle = 'rgba(14,38,48,0.6)';
    ctx.fillRect(6, 6, S - 12, S - 12);
    ctx.strokeStyle = 'rgba(190,225,235,0.08)';
    ctx.lineWidth = 1;
    for (let g = -half; g <= half; g += 5000) {
      ctx.beginPath(); ctx.moveTo(X(g), 6); ctx.lineTo(X(g), S - 6); ctx.moveTo(6, Y(g)); ctx.lineTo(S - 6, Y(g)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,190,90,0.35)';
    ctx.strokeRect(6.5, 6.5, S - 13, S - 13);
    if (me && me.alive) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(X(me.pos.x), Y(me.pos.y), me.cls.maxRange * k, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // islands
    ctx.fillStyle = 'rgba(190,175,130,0.75)';
    for (const isl of world.islands) {
      ctx.beginPath();
      isl.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.closePath(); ctx.fill();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(6, 6, S - 12, S - 12); ctx.clip();
    // smoke screens
    ctx.fillStyle = 'rgba(200,205,205,0.25)';
    for (const p of world.smoke) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(1, p.r * k), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    for (const sh of world.shells) {
      if (sh.secondary) continue;
      const u = clamp01(sh.t / sh.T);
      ctx.fillStyle = 'rgba(255,200,120,0.7)';
      ctx.fillRect(X(sh.origin.x + (sh.target.x - sh.origin.x) * u) - 0.5, Y(sh.origin.y + (sh.target.y - sh.origin.y) * u) - 0.5, 1, 1);
    }
    for (const tp of world.torpedoes) {
      if (me && !world.torpedoSpotted(tp, me.team)) continue;
      ctx.fillStyle = me && tp.team !== me.team ? 'rgba(255,120,100,0.9)' : 'rgba(170,230,255,0.9)';
      ctx.fillRect(X(tp.pos.x) - 0.75, Y(tp.pos.y) - 0.75, 1.5, 1.5);
    }
    // last known positions
    if (me) for (const [id, c] of world.contacts[me.team]) {
      const s = world.shipById(id);
      if (!s || s.status === 'sunk' || s.outOfAction || world.isVisibleTo(me.team, s) || world.time - c.t > 240) continue;
      ctx.strokeStyle = TEAM_COLOR[s.team]; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(X(c.pos.x), Y(c.pos.y), 3.5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const s of world.ships) {
      if (s.status === 'sunk') continue;
      if (me && !world.isVisibleTo(me.team, s)) continue;
      const x = X(s.pos.x), y = Y(s.pos.y);
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.heading);
      ctx.fillStyle = s.alive ? TEAM_COLOR[s.team] : 'rgba(150,150,150,0.6)';
      const z = s.cls.type === 'DD' ? 0.7 : s.cls.type === 'CA' ? 0.85 : 1;
      ctx.beginPath(); ctx.moveTo(6 * z, 0); ctx.lineTo(-4 * z, -3.5 * z); ctx.lineTo(-2.5 * z, 0); ctx.lineTo(-4 * z, 3.5 * z); ctx.closePath(); ctx.fill();
      if (me && s.id === me.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
      if (focusId === s.id) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(210,228,236,0.5)';
    ctx.font = '600 9px "Barlow Condensed", sans-serif';
    ctx.fillText('N', S / 2 - 3, 15);
  }
}

export { STATE_COLORS };
