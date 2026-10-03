import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import './styles.css';

import { Audio } from './audio/audio';
import { Game } from './game';
import { Input } from './input/input';
import type { BattleConfig } from './sim/types';
import { Menus, attractBattle, quickBattle } from './ui/menus';

const app = document.getElementById('app')!;
const glCanvas = document.createElement('canvas'); glCanvas.className = 'layer water';
const canvas = document.createElement('canvas'); canvas.className = 'layer world';
const hudRoot = document.createElement('div'); hudRoot.className = 'layer hud-root';
app.append(glCanvas, canvas, hudRoot);

const input = new Input(canvas);
const audio = new Audio();
try { const v = Number(localStorage.getItem('riptide.volume')); if (localStorage.getItem('riptide.volume') !== null && Number.isFinite(v)) audio.volume = v; } catch { /* ignore */ }
const game = new Game(glCanvas, canvas, hudRoot, input, audio);
const menus = new Menus(app);

let lastCfg: BattleConfig | null = null;
type State = 'title' | 'battle' | 'paused' | 'results' | 'setup' | 'manual';
let state: State = 'title';

function setState(s: State) {
  state = s;
  document.body.dataset.state = s;
}

function toTitle() {
  game.stop();
  game.start(attractBattle(), 'attract');
  setState('title');
  menus.title({
    quick: () => { audio.ensure(); audio.ui('click'); startBattle(quickBattle(menus.difficulty)); },
    setup: () => { audio.ensure(); audio.ui('click'); toSetup(); },
    help: () => { audio.ensure(); audio.ui('click'); setState('manual'); menus.manual(toTitle); },
  });
}

function toSetup() {
  if (game.mode === 'battle') { game.stop(); game.start(attractBattle(), 'attract'); }
  setState('setup');
  menus.setup(lastCfg, { start: (cfg) => { audio.ui('click'); startBattle(cfg); }, back: toTitle });
}

function startBattle(cfg: BattleConfig) {
  lastCfg = cfg;
  menus.clear();
  setState('battle');
  game.start(cfg, 'battle');
  game.onEnd = (world, me) => {
    setState('results');
    game.hud?.root.classList.add('faded');
    menus.results(world, me, {
      again: () => { audio.ui('click'); startBattle({ ...cfg, seed: Math.floor(Math.random() * 1e9) }); },
      setup: () => { audio.ui('click'); toSetup(); },
      quit: () => { audio.ui('click'); toTitle(); },
    });
  };
}

function pause() {
  if (state !== 'battle') return;
  game.paused = true;
  setState('paused');
  menus.pause({
    resume,
    restart: () => { if (lastCfg) startBattle({ ...lastCfg, seed: Math.floor(Math.random() * 1e9) }); },
    quit: () => toTitle(),
    volume: audio.volume,
    setVolume: (v) => { audio.setVolume(v); try { localStorage.setItem('riptide.volume', String(v)); } catch { /* ignore */ } },
  });
}
function resume() {
  game.paused = false;
  menus.clear();
  setState('battle');
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { if (state === 'battle') pause(); else if (state === 'paused') resume(); else if (state === 'manual' || state === 'setup') toTitle(); }
});
canvas.addEventListener('mousedown', () => audio.ensure());

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.enabled = state === 'battle' || state === 'results';
  game.frame(dt);
  input.endFrame();
  requestAnimationFrame(loop);
}

// test / debugging hook
(window as any).__riptide = {
  game, startBattle, quickBattle, toTitle, pause, resume, menus,
  /** hand the player's ship to the AI (testing / spectating) */
  autopilot() { const p = game.player; if (p) game.ai.addCaptain(game.world, p); },
};

document.fonts?.ready.then(() => {});
toTitle();
requestAnimationFrame(loop);
