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
      <div class="k"><b>A</b>/<b>D</b> hold rudder</div>
      <div class="k"><b>LMB</b> fire ready turrets</div>
      <div class="k"><b>1</b>/<b>2</b> load AP / HC</div>
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
        [17, '<b>Lead the target</b> — your shells fly for many seconds. Put the cursor ahead of the dashed ghost hull and click to fire.'],
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
    const fq = clamp01(1 - (me.dispersionMult() - 1) / 1.4);
    const fqLabel = fq > 0.8 ? 'STEADY' : fq > 0.55 ? 'SETTLING' : 'DISTURBED';
    const tur = me.turrets.map((t) => {
      const lvl = me.mod(t.def.id).level;
      const guns = me.gunsFor(t);
      let state = '', cls = '';
      if (lvl === 3) { state = 'DESTROYED'; cls = 'dead'; }
      else if (!me.turretOperable(t)) { state = me.mod(t.def.magazine).flooded ? 'MAG FLOODED' : 'NO AMMO'; cls = 'dead'; }
      else if (t.jam > 0) { state = 'JAMMED'; cls = 'warn'; }
      else if (!t.inArc) { state = 'BLIND ARC'; cls = 'warn'; }
      else if (!t.loaded) { state = `LOADING ${t.reload.toFixed(0)}s`; cls = 'load'; }
      else if (!t.aligned) { state = 'TRAINING'; cls = 'warn'; }
      else { state = 'READY'; cls = 'ready'; }
      const prog = t.loaded ? 1 : 1 - clamp01(t.reload / me.cls.reloadTime);
      const gunsHtml = [0, 1, 2].map((i) => `<i class="${i < guns ? 'on' : ''}"></i>`).join('');
      return `<div class="turret ${cls}">
        <div class="t-ring" style="--p:${prog}"><span>${t.def.name.replace('Turret ', '')}</span></div>
        <div class="t-info"><div class="t-state">${state}</div><div class="t-guns">${gunsHtml}<em>${t.loaded ?? t.loading}</em></div></div>
      </div>`;
    }).join('');
    this.guns.innerHTML = `
      <div class="panel-title"><span>MAIN BATTERY · 16"/50 MK 7</span><span>${me.stats.hits}/${me.stats.shells} HITS</span></div>
      <div class="turrets">${tur}</div>
      <div class="ammo">
        <div class="am ${ammoSel === 'AP' ? 'sel' : ''}"><b>1</b> AP <span>${ammoTotals.AP}</span></div>
        <div class="am ${ammoSel === 'HC' ? 'sel' : ''}"><b>2</b> HC <span>${ammoTotals.HC}</span></div>
        <div class="fc"><div class="fc-l">SOLUTION <b>${fqLabel}</b></div><div class="fc-bar"><i style="width:${(fq * 100).toFixed(0)}%"></i></div></div>
      </div>`;

    // tooltip for the module under the pointer
    const hv = this.status.hover;
    if (hv) {
      let html = '';
      if (hv.startsWith('sec:')) {
        const sec = me.sections.find((q) => 'sec:' + q.def.id === hv)!;
        const w = sec.port + sec.stbd;
        const holes = me.holes.filter((h) => me.sections[h.section] === sec);
        const under = holes.filter((h) => me.waterRise(h.x) - h.z > 0).length;
        html = `<b>${sec.def.name} section</b><span>${Math.round(w)} / ${sec.def.capacity} t flooded · ${holes.length} hole${holes.length === 1 ? '' : 's'}${holes.length ? ` (${under} below water)` : ''}</span>`;
      } else {
        const m = me.mod(hv);
        const lvl = m.flooded ? 'Flooded' : ['Operational', 'Damaged', 'Heavily damaged', 'Destroyed'][m.level];
        const t = me.turrets.find((q) => q.def.id === hv);
        const zone = me.cls.zones.find((z) => (m.def.rect.x0 + m.def.rect.x1) / 2 >= z.x0 && (m.def.rect.x0 + m.def.rect.x1) / 2 < z.x1);
        const armor = t ? `Face ${t.def.armor.face} · side ${t.def.armor.side} · roof ${t.def.armor.roof} · barbette ${t.def.armor.barbette} mm`
          : m.def.band === 'low' && zone ? `Behind ${zone.belt} mm belt / ${zone.deck} mm deck` : (me.cls.structures.find((q) => q.module === hv)?.armor ?? 16) + ' mm plating';
        const effect = ({ engine: 'Drives one shaft: speed', boiler: 'Raises steam: speed', steering: 'Rudder control', bridge: 'Helm orders', director: 'Fire control: dispersion', funnel: 'Boiler draught', turret: 'Main battery', magazine: 'Ammunition supply' } as Record<string, string>)[m.def.kind];
        html = `<b>${m.def.name}</b><span class="lv${m.flooded ? 3 : m.level}">${lvl} · ${Math.round((m.hp / m.def.hp) * 100)}%</span><span>${effect}</span><span class="dim">${armor}</span>`;
      }
      this.tip.innerHTML = html;
      this.tip.classList.add('show');
    } else this.tip.classList.remove('show');

    // damage control stats
    const r = me.readiness();
    const floodPct = (me.floodTotal / me.cls.reserveBuoyancy) * 100;
    (this.root.querySelector('.dc-name') as HTMLElement).textContent = `USS ${me.name.toUpperCase()}`;
    const bar = (label: string, v: number, warn: boolean, txt: string) =>
      `<div class="dc-bar ${warn ? 'warn' : ''}"><span class="l">${label}</span><span class="b"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span class="t">${txt}</span></div>`;
    this.stat.innerHTML =
      bar('BUOYANCY', r.buoyancy, r.buoyancy < 0.5, `${(100 - floodPct).toFixed(0)}%`) +
      bar('PROPULSION', me.power, me.power < 0.5, `${Math.round(me.power * 100)}%`) +
      bar('FIREPOWER', r.firepower, r.firepower < 0.5, `${me.turrets.reduce((a, t) => a + (me.turretOperable(t) ? me.gunsFor(t) : 0), 0)}/9`) +
      `<div class="dc-line"><span>FLOOD <b>${me.floodTotal.toFixed(0)} t</b></span><span>LIST <b>${(Math.abs(me.list) / DEG).toFixed(1)}° ${me.list > 0.002 ? 'S' : me.list < -0.002 ? 'P' : ''}</b></span><span>TRIM <b>${(me.trim * 270).toFixed(1)} m</b></span><span class="${me.fires.length ? 'fire' : ''}">FIRES <b>${me.fires.length}</b></span></div>`;
  }

  private updateTop(world: World, me: Ship | null) {
    const t = Math.floor(world.time);
    const clock = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const card = (s: Ship) => {
      const r = s.readiness();
      const seg = (v: number) => `<span class="seg"><i style="width:${(clamp01(v) * 100).toFixed(0)}%"></i></span>`;
      return `<div class="ship-card ${s.team} ${s.outOfAction ? 'out' : ''}">
        <div class="sc-name">${s.name.toUpperCase()}${me && s.id === me.id ? ' <em>YOU</em>' : ''}</div>
        <div class="sc-bars" title="Firepower · Mobility · Buoyancy">${seg(r.firepower)}${seg(r.mobility)}${seg(r.buoyancy)}</div>
        ${s.outOfAction ? `<div class="sc-out">${s.outReason}</div>` : ''}
      </div>`;
    };
    const blue = world.ships.filter((s) => s.team === 'blue').map(card).join('');
    const red = world.ships.filter((s) => s.team === 'red').map(card).join('');
    let rangeTxt = '';
    if (me) {
      const foes = world.ships.filter((s) => s.team !== me.team && s.alive);
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
    for (const sh of world.shells) {
      const u = clamp01(sh.t / sh.T);
      ctx.fillStyle = 'rgba(255,200,120,0.7)';
      ctx.fillRect(X(sh.origin.x + (sh.target.x - sh.origin.x) * u) - 0.5, Y(sh.origin.y + (sh.target.y - sh.origin.y) * u) - 0.5, 1, 1);
    }
    for (const s of world.ships) {
      if (s.status === 'sunk') continue;
      const x = X(s.pos.x), y = Y(s.pos.y);
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.heading);
      ctx.fillStyle = s.alive ? TEAM_COLOR[s.team] : 'rgba(150,150,150,0.6)';
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
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
