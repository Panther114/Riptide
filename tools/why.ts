import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
for (let k = 0; k < Number(process.argv[2] ?? 6); k++) {
  const w = new World({ seed: Number(process.argv[3] ?? 500) + k * 13, mapSize: 40000, difficulty: 'officer', wind: 0.5, ships: [
    { classId: 'iowa', team: 'blue', x: -7600, y: 4200, heading: -0.3, controller: 'ai', speed: 13, telegraph: 4 },
    { classId: 'iowa', team: 'red', x: 7600, y: -4200, heading: Math.PI - 0.3, controller: 'ai', speed: 13, telegraph: 4 },
  ] });
  const ai = new AIDirector(w);
  const kinds: Record<string, number> = {};
  const ranges: number[] = [];
  while (!w.ended && w.time < 1500) {
    ai.update(w, 1 / 30); w.step(1 / 30); ai.observe(w.events, w);
    for (const e of w.events) if (e.type === 'hit') { kinds[e.report.kind] = (kinds[e.report.kind] ?? 0) + 1; if (e.report.magazineDetonation) console.log('   DET:', e.report.kind, e.report.plate, e.report.text, JSON.stringify(e.report.det), 'z', e.report.z.toFixed(1)); }
    w.events.length = 0;
    if (Math.round(w.time * 30) % 1800 === 0) ranges.push(Math.round(Math.hypot(w.ships[0].pos.x - w.ships[1].pos.x, w.ships[0].pos.y - w.ships[1].pos.y) / 100) / 10);
  }
  const loser = w.ships.find((s) => s.outOfAction)!;
  console.log(`#${k} t=${w.time.toFixed(0)} ${loser.name}: ${loser.outReason}; ranges(km/min)=${ranges.join(',')}`);
  console.log('   turrets:', loser.turrets.map((t) => `${t.def.id} lvl${loser.mod(t.def.id).level} mag${loser.mod(t.def.magazine).level}${loser.mod(t.def.magazine).flooded ? 'F' : ''} ammo${JSON.stringify(loser.ammo.get(t.def.magazine))}`).join(' | '));
  console.log('   flood', Math.round(loser.floodTotal), 'kinds', JSON.stringify(kinds));
}
