import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
// Edge cases: point-blank range, ram course, many ships; check for NaN/exceptions.
const cases = [
  { name: 'pointblank', ships: [[-600, 0, 0], [600, 0, Math.PI]] },
  { name: 'ram', ships: [[-1500, 0, 0], [1500, 30, Math.PI]] },
  { name: 'edge', ships: [[19000, 19000, 0.7], [-19000, -19000, 3.9]] },
];
for (const c of cases) {
  const w = new World({ seed: 5, mapSize: 40000, difficulty: 'admiral', wind: 0, ships: c.ships.map(([x, y, h], i) => ({ classId: 'iowa', team: i ? 'red' : 'blue', x, y, heading: h, controller: 'ai', speed: 15, telegraph: 4 })) as any });
  const ai = new AIDirector(w);
  let ev = 0;
  while (!w.ended && w.time < 900) {
    ai.update(w, 1 / 30); w.step(1 / 30); ai.observe(w.events, w); ev += w.events.length; w.events.length = 0;
    for (const s of w.ships) if (!Number.isFinite(s.pos.x + s.pos.y + s.heading + s.speed + s.floodTotal)) throw new Error('NaN in ' + c.name);
  }
  console.log(c.name, 't=', w.time.toFixed(0), w.ships.map((s) => `${s.name}:${s.outReason || 'ok'}`).join(' / '), 'events', ev);
}
// 6v6
const ships: any[] = [];
for (let i = 0; i < 6; i++) { ships.push({ classId: 'iowa', team: 'blue', x: -9000 - i * 1400, y: 1500 + i * 300, heading: -0.1, controller: 'ai', speed: 13, telegraph: 4 }); ships.push({ classId: 'iowa', team: 'red', x: 9000 + i * 1400, y: -1500 - i * 300, heading: Math.PI - 0.1, controller: 'ai', speed: 13, telegraph: 4 }); }
const w = new World({ seed: 9, mapSize: 50000, difficulty: 'officer', wind: 0, ships });
const ai = new AIDirector(w);
const t0 = performance.now();
while (!w.ended && w.time < 1800) { ai.update(w, 1 / 30); w.step(1 / 30); ai.observe(w.events, w); w.events.length = 0; }
console.log('6v6 t=', w.time.toFixed(0), 'winner', w.winner, 'sim ms/s', ((performance.now() - t0) / w.time).toFixed(2), w.ships.map((s) => (s.outReason || 'ok').slice(0, 12)).join(','));
