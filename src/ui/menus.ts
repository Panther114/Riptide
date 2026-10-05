// Title screen, battle setup (lobby prototype), pause menu and after-action report.

import { DEG, TAU, clamp, dist } from '../core/math';
import type { Ship } from '../sim/ship';
import type { BattleConfig, Conditions, ShipSpawn, TeamId, Terrain } from '../sim/types';
import type { World } from '../sim/world';
import { CLASS_ORDER, SHIP_CLASSES, TYPE_NAMES } from '../sim/shipClass';
import { generateIslands } from '../sim/terrain';
import { TEAM_COLOR } from '../render/renderer';

const h = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };

export type Difficulty = BattleConfig['difficulty'];

/** A sensible opponent for a 1-v-1: same type, preferably another navy. */
function rival(classId: string, rnd: () => number): string {
  const me = SHIP_CLASSES[classId];
  const same = CLASS_ORDER.filter((id) => SHIP_CLASSES[id].type === me.type && id !== classId);
  const foreign = same.filter((id) => SHIP_CLASSES[id].nation !== me.nation);
  const pool = foreign.length ? foreign : same.length ? same : [classId];
  return pool[Math.floor(rnd() * pool.length)];
}

/** A destroyer to screen a ship: one of her own navy, else one not of the enemy's. */
function escort(classId: string, foeId: string): string {
  const dds = CLASS_ORDER.filter((id) => SHIP_CLASSES[id].type === 'DD');
  const nation = SHIP_CLASSES[classId].nation, foe = SHIP_CLASSES[foeId].nation;
  return dds.find((id) => SHIP_CLASSES[id].nation === nation) ?? dds.find((id) => SHIP_CLASSES[id].nation !== foe) ?? dds[0];
}

/** The default battle: your ship and a destroyer screen against a rival and hers (two destroyers a side if you chose one). */
export function quickBattle(difficulty: Difficulty, seed = Math.floor(Math.random() * 1e9), classId = 'iowa'): BattleConfig {
  const a = (Math.random() - 0.5) * 0.5;
  const cls = SHIP_CLASSES[classId] ?? SHIP_CLASSES.iowa;
  const enemy = classId === 'iowa' && Math.random() < 0.35 ? 'iowa' : rival(cls.id, Math.random);
  // light ships start closer in
  const R = cls.type === 'DD' ? 0.6 : cls.type === 'CA' ? 0.8 : 1;
  const mate = cls.type === 'DD' ? cls.id : escort(cls.id, enemy);
  const foeMate = cls.type === 'DD' ? enemy : escort(enemy, cls.id);
  const ship = (classId: string, team: TeamId, x: number, y: number, controller: 'player' | 'ai'): ShipSpawn =>
    ({ classId, team, x: x * R, y: y * R, heading: (team === 'blue' ? -0.32 : Math.PI - 0.32) + a, speed: 13, telegraph: 4, controller });
  return {
    seed, mapSize: 40000, difficulty, wind: Math.random() * TAU, conditions: 'day', terrain: 'open',
    ships: [
      ship(cls.id, 'blue', -7600, 4200, 'player'), ship(mate, 'blue', -6600, 5600, 'ai'),
      ship(enemy, 'red', 7600, -4200, 'ai'), ship(foeMate, 'red', 6600, -5600, 'ai'),
    ],
  };
}

export function attractBattle(): BattleConfig {
  const pick = Math.floor(Math.random() * 3);
  const mk = (classId: string, team: TeamId, x: number, y: number, hd: number): ShipSpawn => ({ classId, team, x, y, heading: hd, speed: 15, telegraph: 4, controller: 'ai' });
  const ships = pick === 0
    ? [mk('iowa', 'blue', -5200, 2200, -0.2), mk('yamato', 'red', 5200, -2200, Math.PI - 0.2)]
    : pick === 1
      ? [mk('iowa', 'blue', -5200, 2200, -0.2), mk('fletcher', 'blue', -4400, 3400, -0.2), mk('bismarck', 'red', 5200, -2200, Math.PI - 0.2), mk('kagero', 'red', 4400, -3400, Math.PI - 0.2)]
      : [mk('baltimore', 'blue', -4200, 1800, -0.2), mk('fletcher', 'blue', -3600, 2900, -0.2), mk('takao', 'red', 4200, -1800, Math.PI - 0.2), mk('kagero', 'red', 3600, -2900, Math.PI - 0.2)];
  return { seed: Math.floor(Math.random() * 1e9), mapSize: 40000, difficulty: 'admiral', wind: 0.6, ships, conditions: 'day', terrain: 'open' };
}

const PRESETS: { id: string; label: string; conditions?: Conditions; terrain?: Terrain; build: () => ShipSpawn[] }[] = [];
{
  const mk = (classId: string, team: TeamId, x: number, y: number, hd: number, ctl: 'player' | 'ai' = 'ai'): ShipSpawn => ({ classId, team, x, y, heading: hd, speed: 13, telegraph: 4, controller: ctl });
  const B = -0.3, R = Math.PI - 0.3;
  PRESETS.push(
    { id: 'duel', label: 'Iowa v Iowa', build: () => [mk('iowa', 'blue', -7600, 4200, B, 'player'), mk('iowa', 'red', 7600, -4200, R)] },
    { id: 'bis', label: 'Iowa v Bismarck', build: () => [mk('iowa', 'blue', -7600, 4200, B, 'player'), mk('bismarck', 'red', 7600, -4200, R)] },
    { id: 'yam', label: 'Iowa v Yamato', build: () => [mk('iowa', 'blue', -8000, 4400, B, 'player'), mk('yamato', 'red', 8000, -4400, R)] },
    { id: 'sag', label: 'Surface action groups', build: () => [
      mk('iowa', 'blue', -9000, 2000, -0.15, 'player'), mk('baltimore', 'blue', -10400, 2500, -0.15), mk('fletcher', 'blue', -7800, 3800, -0.15), mk('fletcher', 'blue', -8400, 600, -0.15),
      mk('yamato', 'red', 9000, -2000, Math.PI - 0.15), mk('takao', 'red', 10400, -2500, Math.PI - 0.15), mk('kagero', 'red', 7800, -3800, Math.PI - 0.15), mk('kagero', 'red', 8400, -600, Math.PI - 0.15)] },
    { id: 'dd', label: 'Destroyer melee', build: () => [
      mk('fletcher', 'blue', -6000, 1500, -0.2, 'player'), mk('fletcher', 'blue', -6800, 2600, -0.2), mk('fletcher', 'blue', -7600, 3700, -0.2),
      mk('kagero', 'red', 6000, -1500, Math.PI - 0.2), mk('kagero', 'red', 6800, -2600, Math.PI - 0.2), mk('kagero', 'red', 7600, -3700, Math.PI - 0.2)] },
    { id: 'night', label: 'Night torpedo attack', conditions: 'night', terrain: 'islands', build: () => [
      mk('iowa', 'blue', -4000, 2000, -0.1, 'player'), mk('fletcher', 'blue', -2800, 2900, -0.1), mk('fletcher', 'blue', -5200, 1100, -0.1),
      mk('takao', 'red', 9000, -3000, Math.PI - 0.4), mk('kagero', 'red', 8000, -1800, Math.PI - 0.4), mk('kagero', 'red', 9800, -4200, Math.PI - 0.4), mk('kagero', 'red', 10600, -1200, Math.PI - 0.4)] },
    { id: 'strait', label: 'The strait (dusk)', conditions: 'dusk', terrain: 'strait', build: () => [
      mk('bismarck', 'blue', -11000, 0, 0, 'player'), mk('fletcher', 'blue', -9800, 900, 0),
      mk('iowa', 'red', 11000, 0, Math.PI), mk('kagero', 'red', 9800, -900, Math.PI)] },
    { id: 'stand', label: 'Last stand 1v2', build: () => [mk('iowa', 'blue', 0, 6000, -Math.PI / 2, 'player'), mk('bismarck', 'red', -8000, -6000, 0.3), mk('yamato', 'red', 8000, -6000, Math.PI - 0.3)] },
  );
}

export class Menus {
  root: HTMLElement;
  difficulty: Difficulty = 'officer';
  shipChoice = 'iowa';
  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    try {
      const d = localStorage.getItem('riptide.difficulty'); if (d === 'cadet' || d === 'officer' || d === 'admiral') this.difficulty = d;
      const s = localStorage.getItem('riptide.ship'); if (s && SHIP_CLASSES[s]) this.shipChoice = s;
    } catch { /* ignore */ }
  }
  clear() { this.root.innerHTML = ''; }

  // ------------------------------------------------------------ title
  title(cb: { quick: () => void; setup: () => void; help: () => void }) {
    this.clear();
    const shipBtn = (id: string) => { const c = SHIP_CLASSES[id]; return `<button class="chip ship ${id === this.shipChoice ? 'on' : ''}" data-s="${id}"><b>${c.name}</b><small>${c.type} · ${c.nation.toUpperCase()}</small></button>`; };
    const el = h(`
      <div class="screen title-screen">
        <div class="title-block">
          <div class="kicker">WWII SURFACE ACTION · 1941–1945</div>
          <h1>RIPTIDE</h1>
          <div class="subtitle">Battleships, cruisers and destroyers. Armour, torpedoes, smoke and darkness. Bring her home.</div>
          <div class="menu-buttons">
            <button class="btn primary" data-a="quick"><span>Engage</span><small class="eng-sub"></small></button>
            <button class="btn" data-a="setup"><span>Battle Setup</span><small>fleets · ships · teams · night · islands</small></button>
            <button class="btn" data-a="help"><span>Field Manual</span><small>controls &amp; damage model</small></button>
          </div>
          <div class="shipsel"><span>Your ship</span><div class="ships-row">${CLASS_ORDER.map(shipBtn).join('')}</div></div>
          <div class="difficulty">
            <span>Enemy gunnery</span>
            ${(['cadet', 'officer', 'admiral'] as Difficulty[]).map((d) => `<button class="chip ${d === this.difficulty ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}
          </div>
        </div>
        <div class="title-foot"></div>
      </div>`);
    const foot = el.querySelector('.title-foot') as HTMLElement;
    const sub = el.querySelector('.eng-sub') as HTMLElement;
    const refresh = () => { const c = SHIP_CLASSES[this.shipChoice]; foot.textContent = `${c.designation} · ${c.blurb}`; sub.textContent = c.type === 'DD' ? '2 v 2 destroyer action' : `2 v 2 · ${TYPE_NAMES[c.type].toLowerCase()} and destroyer screen`; };
    refresh();
    el.querySelector('[data-a=quick]')!.addEventListener('click', cb.quick);
    el.querySelector('[data-a=setup]')!.addEventListener('click', cb.setup);
    el.querySelector('[data-a=help]')!.addEventListener('click', cb.help);
    el.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => b.addEventListener('click', () => {
      this.difficulty = b.dataset.d as Difficulty;
      try { localStorage.setItem('riptide.difficulty', this.difficulty); } catch { /* ignore */ }
      el.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll<HTMLElement>('[data-s]').forEach((b) => b.addEventListener('click', () => {
      this.shipChoice = b.dataset.s!;
      try { localStorage.setItem('riptide.ship', this.shipChoice); } catch { /* ignore */ }
      el.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
      refresh();
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
          <div class="cols three">
            <section>
              <h3>Ship handling</h3>
              <p><kbd>W</kbd> <kbd>S</kbd> ring the engine telegraph: Full Astern → Stop → Full Ahead. A battleship takes the better part of a minute to answer; a destroyer a few seconds.</p>
              <p><kbd>A</kbd> <kbd>D</kbd> move the rudder one step: hard to port, amidships, hard to starboard. The curved track ahead of the bow shows where the helm order will take you. Mind the islands — running aground holes the bottom.</p>
              <h3>Gunnery</h3>
              <p>The cursor is where you <em>want</em> the shells to fall; the diamonds show where each turret is actually laid. The inner ellipse holds half the shells, the dashed one nine in ten. Turning hard or swinging the aim opens it up.</p>
              <p><kbd>LMB</kbd> fires every turret loaded and on bearing; hold it to ripple. Lead moving targets — while a director survives, a red diamond by each enemy marks where to aim so the salvo and the ship arrive together.</p>
              <p><kbd>RMB</kbd> pins the aim to a fixed point on the sea; hold and drag to move it. Zooming and panning then leave it alone. <kbd>Space</kbd> lets the aim follow the cursor again.</p>
              <p><kbd>1</kbd> AP — must defeat the armour to do real harm; big-gun AP passes straight through a destroyer. <kbd>2</kbd> HE — bursts on contact: wrecks upper works and light ships, starts fires.</p>
              <p><kbd>G</kbd> secondary battery: the dual-purpose mounts engage the nearest enemy in reach on their own. Toggle to hold fire.</p>
            </section>
            <section>
              <h3>Torpedoes &amp; smoke</h3>
              <p><kbd>T</kbd> switches between guns and torpedoes (cruisers &amp; destroyers). The fans show each mount that bears; aim ahead of the ghost hull and click to launch. The Japanese Type 93 runs 20 km and leaves almost no wake; the US Mk 15 reaches 5.5 km. Kagero and Takao carry a reload.</p>
              <p>Torpedo tracks you can see are drawn with a red danger line — turn to comb them. Battleships' torpedo-defence systems absorb a rated charge; beyond it the blast breaks into the machinery.</p>
              <p><kbd>X</kbd> lays a smoke screen (destroyers). Nothing sees through smoke — except radar.</p>
              <h3>Sight &amp; radar</h3>
              <p>You only see what your side has in sight. By day a battleship is visible at about 26 km, a destroyer at 14; at dusk about half that, at night 7 km and 4 km. Gun flashes and fires give a ship away. US ships carry surface radar that sees through darkness and smoke (not through land); lose the main director and the radar goes with it. Ships out of sight leave a "lost" marker at their last known position.</p>
            </section>
            <section>
              <h3>Armour &amp; damage</h3>
              <p>Every shell is traced through the ship: superstructure, turrets, belt, the armoured deck and — on Bismarck — the sloped "turtleback" behind the belt. A penetrating AP shell bursts behind the plate and wrecks whatever is there.</p>
              <ul>
                <li><b>Machinery</b> — less power, lower speed. <b>Steering</b> — slow or jammed rudder.</li>
                <li><b>Directors</b> — worse dispersion, no radar. <b>Bridge</b> — delayed helm.</li>
                <li><b>Turrets</b> lose guns; <b>magazines</b> may be flooded or detonate. Loaded torpedo mounts can explode.</li>
                <li><b>Holes</b> below the waterline flood their section; the ship settles and lists.</li>
              </ul>
              <h3>Damage control</h3>
              <p>Repair parties fight fires, shore up holes, pump and patch machinery on their own. <b>Click</b> a compartment on the damage-control plan to send the nearest party there; right-click returns them to automatic. Turrets and magazines cannot be repaired in action. <kbd>C</kbd> counter-floods the far side to correct a dangerous list — at a cost in buoyancy.</p>
              <h3>Camera</h3>
              <p><kbd>Wheel</kbd> zoom · <kbd>MMB</kbd> lock on a ship / drag to pan · <kbd>Tab</kbd> take the next ship · <kbd>V</kbd> armour plan · <kbd>H</kbd> help · <kbd>M</kbd> mute · <kbd>Esc</kbd> pause</p>
            </section>
          </div>
          <button class="btn primary back"><span>Back</span></button>
        </div>
      </div>`);
    el.querySelector('.back')!.addEventListener('click', back);
    this.root.appendChild(el);
  }

  // ------------------------------------------------------------ pause
  pause(cb: { resume: () => void; restart: () => void; quit: () => void; volume: number; setVolume: (v: number) => void }) {
    this.clear();
    const el = h(`
      <div class="screen pause">
        <div class="sheet small">
          <h2>Paused</h2>
          <label class="vol">Volume <input type="range" min="0" max="100" value="${Math.round(cb.volume * 100)}"></label>
          <button class="btn primary" data-a="resume"><span>Resume</span></button>
          <button class="btn" data-a="restart"><span>Restart battle</span></button>
          <button class="btn" data-a="quit"><span>Quit to title</span></button>
        </div>
      </div>`);
    el.querySelector('[data-a=resume]')!.addEventListener('click', cb.resume);
    const vol = el.querySelector('.vol input') as HTMLInputElement;
    vol.addEventListener('input', () => cb.setVolume(Number(vol.value) / 100));
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
      return `<tr class="${s.team}">
        <td><i style="background:${TEAM_COLOR[s.team]}"></i>${s.name}${me && s.id === me.id ? ' <em>you</em>' : ''}<small class="cls">${s.cls.type} ${s.cls.name}</small></td>
        <td>${s.stats.shells}</td><td>${s.stats.hits} <small>${acc}%</small></td><td>${s.stats.pens}</td><td>${s.stats.citadels}</td>
        <td>${s.stats.secShells ? `${s.stats.secHits}<small>/${s.stats.secShells}</small>` : '—'}</td>
        <td>${s.stats.torpedoes ? `${s.stats.torpHits}<small>/${s.stats.torpedoes}</small>` : '—'}</td>
        <td>${Math.round(s.floodTotal)} t</td>
        <td class="st">${s.outOfAction ? s.outReason : `Fighting · ${s.operableGuns()}/${s.totalGuns} guns`}</td>
      </tr>`;
    };
    const dmg = me ? Array.from(me.modules.values()).filter((m) => m.level > 0 || m.flooded).map((m) => `<span class="dm lv${m.level}">${m.def.name}${m.flooded ? ' (flooded)' : ''}</span>`).join('') : '';
    const verdict = world.time >= world.timeLimit - 1 ? (draw ? 'Indecisive' : won ? 'Held the field' : 'Withdrew') : won ? 'Victory' : draw ? 'Mutual destruction' : 'Defeat';
    const el = h(`
      <div class="screen results">
        <div class="sheet">
          <div class="kicker">AFTER ACTION REPORT · ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} · ${world.conditions.toUpperCase()}</div>
          <h2 class="${won ? 'win' : draw ? '' : 'loss'}">${verdict}</h2>
          <table class="stats">
            <thead><tr><th>Ship</th><th>Shells</th><th>Hits</th><th>Pens</th><th>Citadel</th><th>Sec.</th><th>Torp.</th><th>Flooding</th><th>Status</th></tr></thead>
            <tbody>${world.ships.map(row).join('')}</tbody>
          </table>
          ${me ? `<div class="dmg"><div class="dmg-t">Damage sustained by ${me.cls.prefix} ${me.name}</div>${dmg || '<span class="dm">No significant damage</span>'}</div>` : ''}
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
    const cfg: BattleConfig = initial ? structuredClone(initial) : quickBattle(this.difficulty, undefined, this.shipChoice);
    cfg.difficulty = this.difficulty;
    cfg.conditions ??= 'day';
    cfg.terrain ??= 'open';
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
            <div class="presets">${PRESETS.map((p) => `<button class="chip" data-p="${p.id}">${p.label}</button>`).join('')}</div>
            <div class="ships"></div>
            <div class="add">
              <button class="btn small" data-add="blue"><span>+ Blue ship</span></button>
              <button class="btn small" data-add="red"><span>+ Red ship</span></button>
            </div>
            <div class="opts">
              <label>Map <select class="mapsel"><option value="30000">30 km</option><option value="40000">40 km</option><option value="50000">50 km</option></select></label>
              <label>Light <select class="condsel"><option value="day">Day</option><option value="dusk">Dusk</option><option value="night">Night</option></select></label>
              <label>Waters <select class="terrsel"><option value="open">Open sea</option><option value="islands">Archipelago</option><option value="strait">Strait</option></select></label>
              <label>Enemy skill <select class="diffsel"><option>cadet</option><option>officer</option><option>admiral</option></select></label>
              <button class="chip reroll" title="New island layout">⟳ islands</button>
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
    const condSel = el.querySelector('.condsel') as HTMLSelectElement;
    const terrSel = el.querySelector('.terrsel') as HTMLSelectElement;
    mapSel.value = String(cfg.mapSize);
    diffSel.value = cfg.difficulty;
    condSel.value = cfg.conditions;
    terrSel.value = cfg.terrain;
    let islands = generateIslands(cfg);
    const regen = () => { islands = generateIslands(cfg); };
    mapSel.onchange = () => { cfg.mapSize = Number(mapSel.value); clampShips(); regen(); draw(); };
    diffSel.onchange = () => { cfg.difficulty = diffSel.value as Difficulty; this.difficulty = cfg.difficulty; };
    condSel.onchange = () => { cfg.conditions = condSel.value as Conditions; draw(); };
    terrSel.onchange = () => { cfg.terrain = terrSel.value as Terrain; regen(); draw(); };
    (el.querySelector('.reroll') as HTMLElement).onclick = () => { cfg.seed = Math.floor(Math.random() * 1e9); regen(); draw(); };

    const S = Math.min(560, window.innerHeight - 220, window.innerWidth - 520);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = S * dpr; canvas.height = S * dpr;
    canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
    const ctx = canvas.getContext('2d')!;
    const k = () => S / cfg.mapSize;
    const toS = (x: number, y: number) => ({ x: S / 2 + x * k(), y: S / 2 + y * k() });
    const toW = (x: number, y: number) => ({ x: (x - S / 2) / k(), y: (y - S / 2) / k() });
    const clampShips = () => { const hh = cfg.mapSize / 2 * 0.95; for (const s of cfg.ships) { s.x = clamp(s.x, -hh, hh); s.y = clamp(s.y, -hh, hh); } };

    const renameAll = () => {
      const used = new Set<string>();
      for (const s of cfg.ships) {
        const names = SHIP_CLASSES[s.classId].names;
        if (!s.name || used.has(s.name) || !names.includes(s.name)) s.name = names.find((n) => !used.has(n)) ?? `${SHIP_CLASSES[s.classId].name} ${used.size + 1}`;
        used.add(s.name!);
      }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.7);
      const night = cfg.conditions === 'night', dusk = cfg.conditions === 'dusk';
      g.addColorStop(0, night ? '#0a1f2c' : dusk ? '#20303d' : '#11394a'); g.addColorStop(1, night ? '#040d14' : '#081e28');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(190,225,235,0.08)'; ctx.lineWidth = 1;
      for (let x = -cfg.mapSize / 2; x <= cfg.mapSize / 2; x += 5000) {
        const a = toS(x, -cfg.mapSize / 2), b = toS(x, cfg.mapSize / 2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const c = toS(-cfg.mapSize / 2, x), d = toS(cfg.mapSize / 2, x);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      }
      // islands
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
      for (const isl of islands) {
        ctx.beginPath();
        isl.pts.forEach((p, i) => { const q = toS(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        ctx.closePath();
        ctx.fillStyle = '#7d8a5c'; ctx.fill(); ctx.strokeStyle = 'rgba(220,210,170,0.8)'; ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(190,225,235,0.35)'; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
      ctx.fillText(`5 km grid · ${cfg.conditions}${cfg.conditions !== 'day' ? ` · visual ~${cfg.conditions === 'night' ? 7 : 14} km` : ''}`, 8, S - 8);
      cfg.ships.forEach((s, i) => {
        const p = toS(s.x, s.y);
        const col = TEAM_COLOR[s.team];
        const cls = SHIP_CLASSES[s.classId];
        if (i === sel) {
          // gun range ring and heading handle
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.arc(p.x, p.y, cls.maxRange * k(), 0, TAU); ctx.stroke();
          if (cls.torpedoes) { ctx.strokeStyle = 'rgba(150,225,255,0.18)'; ctx.beginPath(); ctx.arc(p.x, p.y, cls.torpedoes.def.range * k(), 0, TAU); ctx.stroke(); }
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, TAU); ctx.stroke();
          const hx = p.x + Math.cos(s.heading) * 34, hy = p.y + Math.sin(s.heading) * 34;
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fill();
        }
        const z = cls.type === 'DD' ? 0.65 : cls.type === 'CA' ? 0.82 : 1;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(s.heading);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(14 * z, 0); ctx.lineTo(-9 * z, -6 * z); ctx.lineTo(-5 * z, 0); ctx.lineTo(-9 * z, 6 * z); ctx.closePath(); ctx.fill();
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
          <div class="nm"><b>${s.name}</b><select class="clsel" data-k="${i}">${CLASS_ORDER.map((id) => `<option value="${id}" ${id === s.classId ? 'selected' : ''}>${SHIP_CLASSES[id].type} · ${SHIP_CLASSES[id].name}</option>`).join('')}</select></div>
          <button class="chip team" data-t="${i}">${s.team}</button>
          <button class="chip ctl ${s.controller === 'player' ? 'on' : ''}" data-c="${i}">${s.controller === 'player' ? 'You' : 'AI'}</button>
        </div>`).join('');
      list.querySelectorAll<HTMLElement>('.ship-row').forEach((r) => r.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName === 'SELECT') return; sel = Number(r.dataset.i); draw(); }));
      list.querySelectorAll<HTMLSelectElement>('.clsel').forEach((b) => {
        b.addEventListener('click', (e) => e.stopPropagation());
        b.addEventListener('change', () => { const s = cfg.ships[Number(b.dataset.k)]; s.classId = b.value; s.name = undefined; renameAll(); sel = Number(b.dataset.k); draw(); });
      });
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

    const preset = (id: string) => {
      const p = PRESETS.find((q) => q.id === id)!;
      cfg.ships = p.build();
      cfg.conditions = p.conditions ?? 'day';
      cfg.terrain = p.terrain ?? 'open';
      condSel.value = cfg.conditions; terrSel.value = cfg.terrain;
      cfg.ships.forEach((s) => (s.name = undefined));
      renameAll(); regen(); sel = 0; draw();
    };
    el.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => preset(b.dataset.p!)));
    el.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => b.addEventListener('click', () => {
      if (cfg.ships.length >= 14) return;
      const team = b.dataset.add as TeamId;
      const n = cfg.ships.filter((s) => s.team === team).length;
      const like = cfg.ships[sel]?.classId ?? 'iowa';
      cfg.ships.push({ classId: like, team, x: (team === 'blue' ? -1 : 1) * (8000 + n * 1400), y: (team === 'blue' ? 1 : -1) * (3000 + n * 1600), heading: team === 'blue' ? -0.3 : Math.PI - 0.3, speed: 13, telegraph: 4, controller: 'ai' });
      clampShips(); renameAll(); sel = cfg.ships.length - 1; draw();
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
    const onMove = (e: MouseEvent) => {
      if (!drag || !canvas.isConnected) return;
      const m = mpos(e);
      const s = cfg.ships[drag.i];
      if (drag.mode === 'move') { const w = toW(m.x, m.y); s.x = w.x; s.y = w.y; clampShips(); }
      else { const p = toS(s.x, s.y); s.heading = Math.atan2(m.y - p.y, m.x - p.x); }
      draw();
    };
    const onUp = () => { drag = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', (e) => { const s = cfg.ships[sel]; if (s) { s.heading += Math.sign(e.deltaY) * 10 * DEG; draw(); } e.preventDefault(); }, { passive: false });

    const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    el.querySelector('[data-a=back]')!.addEventListener('click', () => { cleanup(); cb.back(); });
    el.querySelector('[data-a=start]')!.addEventListener('click', () => {
      // islands are generated from the seed: keep it when there is land, so the battle matches the preview
      if (cfg.terrain === 'open') cfg.seed = Math.floor(Math.random() * 1e9);
      // spread ships that overlap
      for (let i = 0; i < cfg.ships.length; i++) for (let j = 0; j < i; j++) {
        if (dist(cfg.ships[i], cfg.ships[j]) < 600) cfg.ships[i].y += 700;
      }
      cleanup();
      cb.start(cfg);
    });
    renameAll();
    draw();
  }
}
