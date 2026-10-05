// Frame-rate probe for a busy fleet action (8 ships, night, islands) at normal and 4x speed.
export default async function (page) {
  const fps = () => page.evaluate(async () => { let n = 0; const t0 = performance.now(); let worst = 0, last = t0; await new Promise((res) => { const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; n++; if (t - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return `${(n / 3).toFixed(0)} fps (worst frame ${worst.toFixed(0)} ms)`; });
  const mk = (classId, team, x, y, h, c = 'ai') => ({ classId, team, x, y, heading: h, speed: 13, telegraph: 4, controller: c });
  await page.evaluate((ships) => { const r = window.__riptide; r.startBattle({ seed: 8, mapSize: 40000, difficulty: 'officer', wind: 0.4, conditions: 'night', terrain: 'islands', ships }); r.autopilot(); }, [
    mk('iowa', 'blue', -9000, 2000, -0.15, 'player'), mk('baltimore', 'blue', -10400, 2500, -0.15), mk('fletcher', 'blue', -7800, 3800, -0.15), mk('fletcher', 'blue', -8400, 600, -0.15),
    mk('yamato', 'red', 9000, -2000, Math.PI - 0.15), mk('takao', 'red', 10400, -2500, Math.PI - 0.15), mk('kagero', 'red', 7800, -3800, Math.PI - 0.15), mk('kagero', 'red', 8400, -600, Math.PI - 0.15)]);
  await page.mouse.move(1100, 300);
  await page.evaluate(() => { const g = window.__riptide.game; g.timeScale = 6; g.renderer.camera.targetZoom = 0.25; });
  await page.waitForTimeout(12000); // let the fleets close and start shooting
  await page.evaluate(() => { window.__riptide.game.timeScale = 1; });
  console.log('fleet night, zoom 0.25, 1x:', await fps());
  await page.evaluate(() => { window.__riptide.game.renderer.camera.targetZoom = 0.04; });
  await page.waitForTimeout(800);
  console.log('fleet night, zoomed out, 1x:', await fps());
  await page.evaluate(() => { window.__riptide.game.timeScale = 4; });
  console.log('fleet night, zoomed out, 4x:', await fps());
  console.log('particles', await page.evaluate(() => window.__riptide.game.renderer.fx.ps.length), 'shells', await page.evaluate(() => window.__riptide.game.world.shells.length), 'smoke', await page.evaluate(() => window.__riptide.game.world.smoke.length));
}
