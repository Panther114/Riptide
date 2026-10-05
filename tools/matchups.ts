// Headless AI-vs-AI battles across ship matchups: who wins, how, how long, and
// whether anything in the simulation went non-finite.
//   npx tsx tools/matchups.ts [battlesPerMatchup] [filter]
import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
import type { BattleConfig, ShipSpawn, TeamId, Conditions, Terrain } from '../src/sim/types';

export interface Matchup { name: string; blue: string[]; red: string[]; conditions?: Conditions; terrain?: Terrain; range?: number }

export const MATCHUPS: Matchup[] = [
  { name: 'Iowa v Iowa', blue: ['iowa'], red: ['iowa'] },
  { name: 'Iowa v Bismarck', blue: ['iowa'], red: ['bismarck'] },
  { name: 'Iowa v Yamato', blue: ['iowa'], red: ['yamato'] },
  { name: 'Bismarck v Yamato', blue: ['bismarck'], red: ['yamato'] },
  { name: 'Baltimore v Takao', blue: ['baltimore'], red: ['takao'], range: 16000 },
  { name: 'Fletcher v Kagero', blue: ['fletcher'], red: ['kagero'], range: 11000 },
  { name: 'Iowa v 2 Kagero', blue: ['iowa'], red: ['kagero', 'kagero'], range: 16000 },
  { name: 'Iowa v Takao (night)', blue: ['iowa'], red: ['takao'], conditions: 'night', range: 12000 },
  { name: 'SAG v SAG (islands)', blue: ['iowa', 'baltimore', 'fletcher', 'fletcher'], red: ['yamato', 'takao', 'kagero', 'kagero'], terrain: 'islands' },
  { name: 'Mixed strait dusk', blue: ['bismarck', 'fletcher'], red: ['iowa', 'kagero'], terrain: 'strait', conditions: 'dusk' },
];

export function makeConfig(m: Matchup, seed: number): BattleConfig {
  const R = m.range ?? 17500;
  const ships: ShipSpawn[] = [];
  const place = (team: TeamId, list: string[]) => list.forEach((classId, i) => {
    const sgn = team === 'blue' ? -1 : 1;
    ships.push({ classId, team, x: sgn * (R / 2 + i * 900), y: sgn * (-1800 + i * 1500) * -1, heading: team === 'blue' ? -0.25 : Math.PI - 0.25, speed: 12, telegraph: 4, controller: 'ai' });
  });
  place('blue', m.blue); place('red', m.red);
  return { seed, mapSize: 40000, difficulty: 'officer', wind: 0.5, ships, conditions: m.conditions ?? 'day', terrain: m.terrain ?? 'open' };
}

export interface Outcome { winner: TeamId | null; time: number; lines: string[]; nonFinite: string | null; events: Record<string, number> }

export function runBattle(cfg: BattleConfig, limit = 1500, dt = 1 / 30): Outcome {
  const w = new World(cfg);
  const ai = new AIDirector(w);
  const events: Record<string, number> = {};
  let nonFinite: string | null = null;
  while (!w.ended && w.time < limit) {
    ai.update(w, dt); w.step(dt); ai.observe(w.events, w);
    for (const e of w.events) events[e.type] = (events[e.type] ?? 0) + 1;
    w.events.length = 0;
    if (!nonFinite) for (const s of w.ships) {
      for (const [k, v] of Object.entries({ x: s.pos.x, y: s.pos.y, h: s.heading, v: s.speed, list: s.list, trim: s.trim, flood: s.floodTotal })) if (!Number.isFinite(v)) { nonFinite = `${s.name}.${k}=${v} at t=${w.time.toFixed(1)}`; break; }
    }
  }
  const lines = w.ships.map((s) => `${s.team.padEnd(4)} ${(s.cls.id + ' ' + s.name).padEnd(22)} ${s.outOfAction ? s.outReason : 'fighting'} | guns ${s.stats.hits}/${s.stats.shells} sec ${s.stats.secHits}/${s.stats.secShells} torp ${s.stats.torpHits}/${s.stats.torpedoes} | flood ${Math.round(s.floodTotal)}t list ${(s.list * 57.3).toFixed(1)}°`);
  return { winner: w.ended ? w.winner : null, time: w.time, lines, nonFinite, events };
}

if (process.argv[1]?.includes('matchups')) {
  const n = Number(process.argv[2] ?? 3);
  const filter = process.argv[3]?.toLowerCase();
  for (const m of MATCHUPS) {
    if (filter && !m.name.toLowerCase().includes(filter)) continue;
    const tally: Record<string, number> = {};
    const t0 = Date.now();
    for (let k = 0; k < n; k++) {
      const o = runBattle(makeConfig(m, 1000 + k * 17));
      tally[o.winner ?? 'none'] = (tally[o.winner ?? 'none'] ?? 0) + 1;
      console.log(`  [${m.name} #${k}] t=${o.time.toFixed(0)}s winner=${o.winner}${o.nonFinite ? ' NONFINITE ' + o.nonFinite : ''}`);
      for (const l of o.lines) console.log('     ' + l);
    }
    console.log(`== ${m.name}: ${JSON.stringify(tally)} (${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);
  }
}
