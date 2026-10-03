import { writeFileSync } from 'node:fs';
import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
const w = new World({ seed: Number(process.argv[2] ?? 77), mapSize: 40000, difficulty: 'officer', wind: 0.5, ships: [
  { classId: 'iowa', team: 'blue', x: -7600, y: 4200, heading: -0.3, controller: 'ai', speed: 13, telegraph: 4 },
  { classId: 'iowa', team: 'red', x: 7600, y: -4200, heading: Math.PI - 0.3, controller: 'ai', speed: 13, telegraph: 4 },
] });
const ai = new AIDirector(w);
const tr: [number, number][][] = [[], []];
const hits: [number, number, string][] = [];
let i = 0;
while (!w.ended && w.time < 1500) {
  ai.update(w, 1 / 30); w.step(1 / 30); ai.observe(w.events, w);
  for (const e of w.events) if (e.type === 'splash' || e.type === 'hit') hits.push([e.pos.x, e.pos.y, e.type === 'hit' ? (e.shell.team === 'blue' ? '#0f0' : '#f80') : (e.shell.team === 'blue' ? '#5fb4ff55' : '#ff6a5555')]);
  w.events.length = 0;
  if (i++ % 60 === 0) w.ships.forEach((s, k) => tr[k].push([s.pos.x, s.pos.y]));
}
const S = 0.03;
const X = (x: number) => (x + 20000) * S, Y = (y: number) => (y + 20000) * S;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" style="background:#0b2531">`;
for (const h of hits) svg += `<circle cx="${X(h[0])}" cy="${Y(h[1])}" r="1.5" fill="${h[2]}"/>`;
tr.forEach((t, k) => { svg += `<polyline fill="none" stroke="${k ? '#ff6a55' : '#5fb4ff'}" stroke-width="2" points="${t.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}"/>`; t.forEach((p, j) => { if (j % 10 === 0) svg += `<text x="${X(p[0]) + 4}" y="${Y(p[1])}" fill="#fff" font-size="10">${j * 2}s</text>`; }); });
svg += `<text x="10" y="20" fill="#fff">t=${w.time.toFixed(0)} ${w.ships.map((s) => s.name + ':' + (s.outReason || 'ok')).join(' / ')}</text></svg>`;
writeFileSync('shots/tracks.svg', svg);
console.log('done', w.time);
