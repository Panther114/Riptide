import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
const w = new World({ seed: 1, mapSize: 40000, difficulty: 'officer', wind: 0.5, ships: [
  { classId: 'iowa', team: 'blue', x: -8000, y: 3000, heading: -0.3, controller: 'ai', speed: 12, telegraph: 4 },
  { classId: 'iowa', team: 'red', x: 8000, y: -3000, heading: Math.PI - 0.3, controller: 'ai', speed: 12, telegraph: 4 },
] });
const ai = new AIDirector(w);
for (let i = 0; i < 30 * 40; i++) {
  ai.update(w, 1/30); w.step(1/30); ai.observe(w.events, w); w.events.length = 0;
  if (i % 150 === 0) { const s = w.ships[0]; console.log(w.time.toFixed(1), s.pos.x.toFixed(0), s.pos.y.toFixed(0), s.speed.toFixed(1), 'fc', s.fcError.toFixed(2), 'aim', JSON.stringify(s.cmd.aim), s.turrets.map(t => `${t.loaded}/${t.reload.toFixed(1)}/${t.aligned}/${t.inArc}`).join(' ')); }
}
