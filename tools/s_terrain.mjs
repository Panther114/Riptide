// Terrain rendering check: strait at dusk and an archipelago by day, near and far.
export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  const mk = (classId, team, x, y, h, c = 'ai') => ({ classId, team, x, y, heading: h, speed: 12, telegraph: 4, controller: c });
  for (const [name, terrain, conditions] of [['strait', 'strait', 'dusk'], ['arch', 'islands', 'day']]) {
    await ev((a) => window.__riptide.startBattle({ seed: 4, mapSize: 40000, difficulty: 'officer', wind: 0.3, conditions: a.conditions, terrain: a.terrain, ships: [
      { classId: 'bismarck', team: 'blue', x: -11000, y: 0, heading: 0, speed: 12, telegraph: 4, controller: 'player' }, { classId: 'iowa', team: 'red', x: 11000, y: 0, heading: Math.PI, speed: 12, telegraph: 4, controller: 'ai' }] }), { terrain, conditions });
    await page.waitForTimeout(700);
    await ev(() => { window.__riptide.game.renderer.camera.targetZoom = 0.025; });
    await page.waitForTimeout(1800);
    await shot(name + '_far');
    // fly the camera to the nearest coast
    await ev(() => {
      const g = window.__riptide.game, w = g.world, p = g.player.pos;
      let best = null, bd = 1e12;
      for (const isl of w.islands) for (const q of isl.pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd && Math.abs(q.x) < 18000 && Math.abs(q.y) < 18000) { bd = d; best = q; } }
      g.pan = { x: best.x - p.x, y: best.y - p.y }; g.renderer.camera.targetZoom = 0.3;
    });
    await page.waitForTimeout(2200);
    await shot(name + '_near');
  }
}
