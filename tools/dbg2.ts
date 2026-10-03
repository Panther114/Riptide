import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
const w = new World({ seed: 5, mapSize: 40000, difficulty: 'admiral', wind: 0, ships: [
  { classId: 'iowa', team: 'blue', x: -600, y: 0, heading: 0, controller: 'ai', speed: 15, telegraph: 4 },
  { classId: 'iowa', team: 'red', x: 600, y: 0, heading: Math.PI, controller: 'ai', speed: 15, telegraph: 4 }] });
const ai = new AIDirector(w);
for (let i = 0; i < 30 * 120; i++) {
  ai.update(w, 1 / 30); w.step(1 / 30); ai.observe(w.events, w);
  for (const e of w.events) if (e.type === 'fire' || e.type === 'hit') { }
  w.events.length = 0;
  if (i % 300 === 0) { const s = w.ships[0], o = w.ships[1]; console.log(w.time.toFixed(0), 'd', Math.hypot(s.pos.x - o.pos.x, s.pos.y - o.pos.y).toFixed(0), 'fc', s.fcError.toFixed(2), s.turrets.map((t) => `${t.loaded}/${t.aligned}/${t.inArc}`).join(' '), 'salvos', s.stats.salvos, o.stats.salvos, 'pos', s.pos.x.toFixed(0), s.pos.y.toFixed(0)); }
}
