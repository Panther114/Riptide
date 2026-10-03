import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';

const N = Number(process.argv[2] ?? 6);
const diff = (process.argv[3] ?? 'officer') as any;
const results: string[] = [];
for (let k = 0; k < N; k++) {
  const w = new World({ seed: 1000 + k * 17, mapSize: 40000, difficulty: diff, wind: 0.5, ships: [
    { classId: 'iowa', team: 'blue', x: -8000, y: 3000, heading: -0.3, controller: 'ai', speed: 12, telegraph: 4 },
    { classId: 'iowa', team: 'red', x: 8000, y: -3000, heading: Math.PI - 0.3, controller: 'ai', speed: 12, telegraph: 4 },
  ] });
  const ai = new AIDirector(w);
  const dt = 1 / 30;
  const kinds: Record<string, number> = {};
  let firstHit = -1;
  while (!w.ended && w.time < 1500) {
    ai.update(w, dt);
    w.step(dt);
    ai.observe(w.events, w);
    for (const e of w.events) if (e.type === 'hit') { kinds[e.report.kind] = (kinds[e.report.kind] ?? 0) + 1; if (firstHit < 0) firstHit = w.time; }
    w.events.length = 0;
  }
  const s = w.ships.map((s) => `${s.team}:${s.outOfAction ? s.outReason : 'ok'} flood=${s.floodTotal.toFixed(0)} pow=${s.power.toFixed(2)} sal=${s.stats.salvos} shells=${s.stats.shells} hits=${s.stats.hits} (${(s.stats.hits / Math.max(1, s.stats.shells) * 100).toFixed(1)}%) cit=${s.stats.citadels}`).join('\n   ');
  results.push(`#${k} t=${w.time.toFixed(0)}s first hit ${firstHit.toFixed(0)}s winner=${w.winner}\n   ${s}\n   ${JSON.stringify(kinds)}`);
}
console.log(results.join('\n'));
