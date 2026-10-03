// Title screen, battle setup (lobby prototype), pause menu and after-action report.

import { DEG, TAU, clamp, dist } from '../core/math';
import type { Ship } from '../sim/ship';
import type { BattleConfig, ShipSpawn, TeamId } from '../sim/types';
import type { World } from '../sim/world';
import { SHIP_CLASSES } from '../sim/shipClass';
import { TEAM_COLOR } from '../render/renderer';

const h = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };

export type Difficulty = BattleConfig['difficulty'];

export function quickBattle(difficulty: Difficulty, seed = Math.floor(Math.random() * 1e9)): BattleConfig {
  const a = (Math.random() - 0.5) * 0.5;
  return {
    seed, mapSize: 40000, difficulty, wind: Math.random() * TAU,
    ships: [
      { classId: 'iowa', team: 'blue', x: -7600, y: 4200, heading: -0.32 + a, speed: 13, telegraph: 4, controller: 'player', name: 'Iowa' },
      { classId: 'iowa', team: 'red', x: 7600, y: -4200, heading: Math.PI - 0.32 + a, speed: 13, telegraph: 4, controller: 'ai', name: 'New Jersey' },
    ],
  };
}

export function attractBattle(): BattleConfig {
  return {
    seed: Math.floor(Math.random() * 1e9), mapSize: 40000, difficulty: 'admiral', wind: 0.6,
    ships: [
      { classId: 'iowa', team: 'blue', x: -5200, y: 2200, heading: -0.2, speed: 15, telegraph: 4, controller: 'ai', name: 'Missouri' },
      { classId: 'iowa', team: 'red', x: 5200, y: -2200, heading: Math.PI - 0.2, speed: 15, telegraph: 4, controller: 'ai', name: 'Wisconsin' },
    ],
  };
}

export class Menus {
  root: HTMLElement;
  difficulty: Difficulty = 'officer';
  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    try { const d = localStorage.getItem('riptide.difficulty'); if (d === 'cadet' || d === 'officer' || d === 'admiral') this.difficulty = d; } catch { /* ignore */ }
  }
  clear() { this.root.innerHTML = ''; }

  // ------------------------------------------------------------ title
  title(cb: { quick: () => void; setup: () => void; help: () => void }) {
    this.clear();
    const el = h(`
      <div class="screen title-screen">
        <div class="title-block">
          <div class="kicker">WHAT-IF SURFACE ACTION · PACIFIC 1944</div>
          <h1>RIPTIDE</h1>
          <div class="subtitle">Two Iowa-class sisters. Nine 16-inch guns each. One of them goes home.</div>
          <div class="menu-buttons">
            <button class="btn primary" data-a="quick"><span>Engage</span><small>1 v 1 battleship duel</small></button>
            <button class="btn" data-a="setup"><span>Battle Setup</span><small>place ships · teams · control</small></button>
            <button class="btn" data-a="help"><span>Field Manual</span><small>controls &amp; damage model</small></button>
          </div>
          <div class="difficulty">
            <span>Enemy gunnery</span>
            ${(['cadet', 'officer', 'admiral'] as Difficulty[]).map((d) => `<button class="chip ${d === this.difficulty ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}
          </div>
        </div>
        <div class="title-foot">Iowa-class fast battleship · 9 × 16"/50 Mk 7 · 307 mm inclined belt · 32.5 kn</div>
      </div>`);
    el.querySelector('[data-a=quick]')!.addEventListener('click', cb.quick);
    el.querySelector('[data-a=setup]')!.addEventListener('click', cb.setup);
    el.querySelector('[data-a=help]')!.addEventListener('click', cb.help);
    el.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => b.addEventListener('click', () => {
      this.difficulty = b.dataset.d as Difficulty;
      try { localStorage.setItem('riptide.difficulty', this.difficulty); } catch { /* ignore */ }
      el.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    this.root.appendChild(el);
  }

  // ------------------------------------------------------------ manual
  manual(back: () => void) {
    this.clear();
    const el = h(`
      <div class="screen manual">
        <div class="sheet">
          <h2>Field Manual</h2>
          <div class="cols">
            <section>
              <h3>Ship handling</h3>
              <p><kbd>W</kbd> <kbd>S</kbd> ring the engine telegraph up or down: Full Astern → Stop → Full Ahead. A 57,000-ton battleship takes the better part of a minute to answer.</p>
              <p><kbd>A</kbd> <kbd>D</kbd> hold the rudder to port or starboard. Release and it returns amidships. The curved track ahead of the bow shows where the current helm order will take you.</p>
              <h3>Gunnery</h3>
              <p>The cursor is where you <em>want</em> the shells to fall. The diamonds show where each turret is <em>actually</em> laid — turrets train at about 4.5° per second, so wait for them to come on.</p>
              <p>The inner ellipse holds about half of all shells, the dashed outer one nine in ten. Dispersion grows with range and opens up while you turn hard or swing the aim; hold steady and the solution settles.</p>
              <p><kbd>LMB</kbd> fires every turret that is loaded and on bearing. Hold it to fire turrets as they come ready. Ring segments around the cursor show each turret's reload.</p>
              <p>Shells take many seconds to arrive. Lead moving targets — a ghost hull appears near the cursor showing where the enemy will be when your salvo lands. Spotting reports (over / short / straddle) appear on the right.</p>
              <p><kbd>1</kbd> AP — armour piercing, delay fuze; it must defeat the armour to do real harm. <kbd>2</kbd> HC — high capacity; bursts on contact, wrecks upperworks and starts fires, but cannot pierce the belt.</p>
            </section>
            <section>
              <h3>Armour &amp; damage</h3>
              <p>Every shell is traced through the ship: superstructure, turrets, the 307&nbsp;mm belt inclined 19°, the 152&nbsp;mm armoured deck and what lies behind. Close in, shells fly flat and strike the belt; far out they plunge onto the deck. Angling your ship makes the belt effectively thicker and invites ricochets.</p>
              <p>A penetrating AP shell bursts a few metres behind the plate and damages whatever is there: fire rooms, engine rooms, magazines, steering gear, directors. Damage shows on the Damage Control diagram, bottom left.</p>
              <ul>
                <li><b>Engines &amp; fire rooms</b> — less power, lower speed.</li>
                <li><b>Steering gear</b> — slow rudder; destroyed, it jams where it is.</li>
                <li><b>Directors</b> — worse dispersion. <b>Bridge</b> — delayed helm orders.</li>
                <li><b>Turrets</b> — lose guns; <b>magazines</b> may be flooded or detonate.</li>
                <li><b>Holes</b> below the waterline flood their section. As she settles, more holes go under. Flooding past reserve buoyancy sinks her.</li>
              </ul>
              <h3>Camera</h3>
              <p><kbd>Wheel</kbd> zooms from the bridge wing to the whole battle area. <kbd>MMB</kbd> on a ship — or on the arrow pointing to an off-screen enemy — locks the camera on it; on open water it returns to your own ship. Locking onto the enemy is the easiest way to aim: zoom in and lay the cursor ahead of the ghost hull.</p>
              <p><kbd>Tab</kbd> take command of the next ship in fleet battles · <kbd>H</kbd> controls hint · <kbd>M</kbd> mute · <kbd>Esc</kbd> pause</p>
            </section>
          </div>
          <button class="btn primary back"><span>Back</span></button>
        </div>
      </div>`);
    el.querySelector('.back')!.addEventListener('click', back);
    this.root.appendChild(el);
  }

  // ------------------------------------------------------------ pause
  pause(cb: { resume: () => void; restart: () => void; quit: () => void }) {
    this.clear();
    const el = h(`
      <div class="screen pause">
        <div class="sheet small">
          <h2>Paused</h2>
          <button class="btn primary" data-a="resume"><span>Resume</span></button>
          <button class="btn" data-a="restart"><span>Restart battle</span></button>
          <button class="btn" data-a="quit"><span>Quit to title</span></button>
        </div>
      </div>`);
    el.querySelector('[data-a=resume]')!.addEventListener('click', cb.resume);
    el.querySelector('[data-a=restart]')!.addEventListener('click', cb.restart);
    el.querySelector('[data-a=quit]')!.addEventListener('click', cb.quit);
    this.root.appendChild(el);
  }

  // ------------------------------------------------------------ after action
  results(world: World, me: Ship | null, cb: { again: () => void; setup: () => void; quit: () => void }) {
    this.clear();
    const won = me ? world.winner === me.team : false;
    const draw = world.winner === null;
    const t = Math.floor(world.endTime);
    const row = (s: Ship) => {
      const acc = s.stats.shells ? ((s.stats.hits / s.stats.shells) * 100).toFixed(1) : '0.0';
      const r = s.readiness();
      return `<tr class="${s.team}">
        <td><i style="background:${TEAM_COLOR[s.team]}"></i>${s.name}${me && s.id === me.id ? ' <em>you</em>' : ''}</td>
        <td>${s.stats.salvos}</td><td>${s.stats.shells}</td><td>${s.stats.hits} <small>${acc}%</small></td><td>${s.stats.pens}</td><td>${s.stats.citadels}</td>
        <td>${Math.round(s.floodTotal)} t</td>
        <td class="st">${s.outOfAction ? s.outReason : `Fighting · ${Math.round(r.firepower * 9)}/9 guns`}</td>
      </tr>`;
    };
    const dmg = me ? Array.from(me.modules.values()).filter((m) => m.level > 0 || m.flooded).map((m) => `<span class="dm lv${m.level}">${m.def.name}${m.flooded ? ' (flooded)' : ''}</span>`).join('') : '';
    const el = h(`
      <div class="screen results">
        <div class="sheet">
          <div class="kicker">AFTER ACTION REPORT · ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</div>
          <h2 class="${won ? 'win' : draw ? '' : 'loss'}">${won ? 'Victory' : draw ? 'Mutual destruction' : 'Defeat'}</h2>
          <table class="stats">
            <thead><tr><th>Ship</th><th>Salvos</th><th>Shells</th><th>Hits</th><th>Pens</th><th>Citadel</th><th>Flooding</th><th>Status</th></tr></thead>
            <tbody>${world.ships.map(row).join('')}</tbody>
          </table>
          ${me ? `<div class="dmg"><div class="dmg-t">Damage sustained by USS ${me.name}</div>${dmg || '<span class="dm">No significant damage</span>'}</div>` : ''}
          <div class="row">
            <button class="btn primary" data-a="again"><span>Rematch</span></button>
            <button class="btn" data-a="setup"><span>Battle setup</span></button>
            <button class="btn" data-a="quit"><span>Title</span></button>
          </div>
        </div>
      </div>`);
    el.querySelector('[data-a=again]')!.addEventListener('click', cb.again);
    el.querySelector('[data-a=setup]')!.addEventListener('click', cb.setup);
    el.querySelector('[data-a=quit]')!.addEventListener('click', cb.quit);
    this.root.appendChild(el);
  }

  // ------------------------------------------------------------ setup / lobby prototype
  setup(initial: BattleConfig | null, cb: { start: (cfg: BattleConfig) => void; back: () => void }) {
    this.clear();
    const cfg: BattleConfig = initial ? structuredClone(initial) : quickBattle(this.difficulty);
    cfg.difficulty = this.difficulty;
    let sel = 0;
    const el = h(`
      <div class="screen setup">
        <div class="setup-grid">
          <div class="map-wrap panel">
            <div class="panel-title"><span>BATTLE AREA</span><span class="map-size"></span></div>
            <canvas class="map"></canvas>
            <div class="map-hint">Drag a ship to place it · drag the ring handle to set its course · right-click removes</div>
          </div>
          <div class="side panel">
            <div class="panel-title"><span>ORDER OF BATTLE</span></div>
            <div class="presets">
              <button class="chip" data-p="duel">Duel 1v1</button>
              <button class="chip" data-p="2v2">2 v 2</button>
              <button class="chip" data-p="3v3">3 v 3 line</button>
              <button class="chip" data-p="stand">Last stand 1v2</button>
            </div>
            <div class="ships"></div>
            <div class="add">
              <button class="btn small" data-add="blue"><span>+ Blue ship</span></button>
              <button class="btn small" data-add="red"><span>+ Red ship</span></button>
            </div>
            <div class="opts">
              <label>Map <select class="mapsel"><option value="30000">30 km</option><option value="40000">40 km</option><option value="50000">50 km</option></select></label>
              <label>Enemy skill <select class="diffsel"><option>cadet</option><option>officer</option><option>admiral</option></select></label>
            </div>
            <div class="row">
              <button class="btn" data-a="back"><span>Back</span></button>
              <button class="btn primary" data-a="start"><span>Begin battle</span></button>
            </div>
          </div>
        </div>
      </div>`);
    this.root.appendChild(el);
    const canvas = el.querySelector('canvas.map') as HTMLCanvasElement;
    const list = el.querySelector('.ships') as HTMLElement;
    const mapSel = el.querySelector('.mapsel') as HTMLSelectElement;
    const diffSel = el.querySelector('.diffsel') as HTMLSelectElement;
    mapSel.value = String(cfg.mapSize);
    diffSel.value = cfg.difficulty;
    mapSel.onchange = () => { cfg.mapSize = Number(mapSel.value); clampShips(); draw(); };
    diffSel.onchange = () => { cfg.difficulty = diffSel.value as Difficulty; this.difficulty = cfg.difficulty; };

    const S = Math.min(560, window.innerHeight - 220, window.innerWidth - 480);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = S * dpr; canvas.height = S * dpr;
    canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
    const ctx = canvas.getContext('2d')!;
    const k = () => S / cfg.mapSize;
    const toS = (x: number, y: number) => ({ x: S / 2 + x * k(), y: S / 2 + y * k() });
    const toW = (x: number, y: number) => ({ x: (x - S / 2) / k(), y: (y - S / 2) / k() });
    const clampShips = () => { const hh = cfg.mapSize / 2 * 0.95; for (const s of cfg.ships) { s.x = clamp(s.x, -hh, hh); s.y = clamp(s.y, -hh, hh); } };

    const names = SHIP_CLASSES.iowa.names;
    const renameAll = () => {
      const used = new Set<string>();
      for (const s of cfg.ships) { if (!s.name || used.has(s.name)) s.name = names.find((n) => !used.has(n)) ?? `Ship ${used.size + 1}`; used.add(s.name!); }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.7);
      g.addColorStop(0, '#11394a'); g.addColorStop(1, '#081e28');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(190,225,235,0.08)'; ctx.lineWidth = 1;
      for (let x = -cfg.mapSize / 2; x <= cfg.mapSize / 2; x += 5000) {
        const a = toS(x, -cfg.mapSize / 2), b = toS(x, cfg.mapSize / 2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const c = toS(-cfg.mapSize / 2, x), d = toS(cfg.mapSize / 2, x);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(190,225,235,0.35)'; ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText('5 km grid', 8, S - 8);
      cfg.ships.forEach((s, i) => {
        const p = toS(s.x, s.y);
        const col = TEAM_COLOR[s.team];
        if (i === sel) {
          // gun range ring and heading handle
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.arc(p.x, p.y, 26000 * k(), 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, TAU); ctx.stroke();
          const hx = p.x + Math.cos(s.heading) * 34, hy = p.y + Math.sin(s.heading) * 34;
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fill();
        }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.heading);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-9, -6); ctx.lineTo(-5, 0); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fill();
        if (s.controller === 'player') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.restore();
        if (i === sel || s.controller === 'player') {
          ctx.fillStyle = 'rgba(230,240,245,0.85)'; ctx.font = '600 11px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
          ctx.fillText((s.name ?? '').toUpperCase() + (s.controller === 'player' ? ' (YOU)' : ''), p.x, p.y - (i === sel ? 40 : 16));
        }
      });
      (el.querySelector('.map-size') as HTMLElement).textContent = `${cfg.mapSize / 1000} × ${cfg.mapSize / 1000} KM`;
      // list
      list.innerHTML = cfg.ships.map((s, i) => `
        <div class="ship-row ${i === sel ? 'sel' : ''} ${s.team}" data-i="${i}">
          <i class="dot"></i>
          <div class="nm"><b>${s.name}</b><small>${SHIP_CLASSES[s.classId].designation}</small></div>
          <button class="chip team" data-t="${i}">${s.team}</button>
          <button class="chip ctl ${s.controller === 'player' ? 'on' : ''}" data-c="${i}">${s.controller === 'player' ? 'You' : 'AI'}</button>
        </div>`).join('');
      list.querySelectorAll<HTMLElement>('.ship-row').forEach((r) => r.addEventListener('click', () => { sel = Number(r.dataset.i); draw(); }));
      list.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); const s = cfg.ships[Number(b.dataset.t)]; s.team = s.team === 'blue' ? 'red' : 'blue'; draw();
      }));
      list.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); const i = Number(b.dataset.c);
        const was = cfg.ships[i].controller === 'player';
        cfg.ships.forEach((s) => (s.controller = 'ai'));
        if (!was) cfg.ships[i].controller = 'player';
        draw();
      }));
      const startBtn = el.querySelector('[data-a=start]') as HTMLButtonElement;
      const teams = new Set(cfg.ships.map((s) => s.team));
      startBtn.disabled = teams.size < 2;
      (startBtn.querySelector('span') as HTMLElement).textContent = cfg.ships.some((s) => s.controller === 'player') ? 'Begin battle' : 'Begin (spectate)';
    };

    const preset = (p: string) => {
      const mk = (team: TeamId, x: number, y: number, hd: number, ctl: 'player' | 'ai' = 'ai'): ShipSpawn => ({ classId: 'iowa', team, x, y, heading: hd, speed: 13, telegraph: 4, controller: ctl });
      if (p === 'duel') cfg.ships = quickBattle(cfg.difficulty).ships;
      if (p === '2v2') cfg.ships = [mk('blue', -8000, 3000, -0.3, 'player'), mk('blue', -9200, 4600, -0.3), mk('red', 8000, -3000, Math.PI - 0.3), mk('red', 9200, -4600, Math.PI - 0.3)];
      if (p === '3v3') cfg.ships = [mk('blue', -9000, 1500, -0.1, 'player'), mk('blue', -10400, 1700, -0.1), mk('blue', -11800, 1900, -0.1), mk('red', 9000, -1500, Math.PI - 0.1), mk('red', 10400, -1700, Math.PI - 0.1), mk('red', 11800, -1900, Math.PI - 0.1)];
      if (p === 'stand') cfg.ships = [mk('blue', 0, 6000, -Math.PI / 2, 'player'), mk('red', -8000, -6000, 0.3), mk('red', 8000, -6000, Math.PI - 0.3)];
      cfg.ships.forEach((s) => (s.name = undefined));
      renameAll(); sel = 0; draw();
    };
    el.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => preset(b.dataset.p!)));
    el.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => b.addEventListener('click', () => {
      if (cfg.ships.length >= 12) return;
      const team = b.dataset.add as TeamId;
      const n = cfg.ships.filter((s) => s.team === team).length;
      cfg.ships.push({ classId: 'iowa', team, x: (team === 'blue' ? -1 : 1) * (8000 + n * 1400), y: (team === 'blue' ? 1 : -1) * (3000 + n * 1600), heading: team === 'blue' ? -0.3 : Math.PI - 0.3, speed: 13, telegraph: 4, controller: 'ai' });
      renameAll(); sel = cfg.ships.length - 1; draw();
    }));

    // dragging
    let drag: { mode: 'move' | 'rot'; i: number } | null = null;
    const mpos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('mousedown', (e) => {
      const m = mpos(e);
      // rotation handle of the selected ship first
      const s0 = cfg.ships[sel];
      if (s0) {
        const p = toS(s0.x, s0.y);
        const hx = p.x + Math.cos(s0.heading) * 34, hy = p.y + Math.sin(s0.heading) * 34;
        if (Math.hypot(m.x - hx, m.y - hy) < 10 && e.button === 0) { drag = { mode: 'rot', i: sel }; return; }
      }
      let best = -1, bd = 18;
      cfg.ships.forEach((s, i) => { const p = toS(s.x, s.y); const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) {
        if (e.button === 2) { if (cfg.ships.length > 2) { cfg.ships.splice(best, 1); sel = 0; } draw(); return; }
        sel = best; drag = { mode: 'move', i: best }; draw();
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const m = mpos(e);
      const s = cfg.ships[drag.i];
      if (drag.mode === 'move') { const w = toW(m.x, m.y); s.x = w.x; s.y = w.y; clampShips(); }
      else { const p = toS(s.x, s.y); s.heading = Math.atan2(m.y - p.y, m.x - p.x); }
      draw();
    });
    window.addEventListener('mouseup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => { const s = cfg.ships[sel]; if (s) { s.heading += Math.sign(e.deltaY) * 10 * DEG; draw(); } e.preventDefault(); }, { passive: false });

    el.querySelector('[data-a=back]')!.addEventListener('click', cb.back);
    el.querySelector('[data-a=start]')!.addEventListener('click', () => {
      cfg.seed = Math.floor(Math.random() * 1e9);
      // spread ships that overlap
      for (let i = 0; i < cfg.ships.length; i++) for (let j = 0; j < i; j++) {
        if (dist(cfg.ships[i], cfg.ships[j]) < 600) cfg.ships[i].y += 700;
      }
      cb.start(cfg);
    });
    renameAll();
    draw();
  }
}
