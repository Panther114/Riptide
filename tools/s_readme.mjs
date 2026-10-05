// README screenshot: a surface action group engagement, mid-battle.
export default async function (page, out) {
  const ev = (f, a) => page.evaluate(f, a);
  const mk = (classId, team, x, y, h, c = 'ai') => ({ classId, team, x, y, heading: h, speed: 14, telegraph: 4, controller: c });
  await ev((ships) => { const r = window.__riptide; r.startBattle({ seed: 31, mapSize: 40000, difficulty: 'officer', wind: 0.5, conditions: 'day', terrain: 'islands', ships }); r.autopilot(); }, [
    mk('iowa', 'blue', -7000, 1500, -0.15, 'player'), mk('baltimore', 'blue', -8400, 2200, -0.15), mk('fletcher', 'blue', -5800, 3200, -0.15), mk('fletcher', 'blue', -6400, 300, -0.15),
    mk('yamato', 'red', 7000, -1500, Math.PI - 0.15), mk('takao', 'red', 8400, -2200, Math.PI - 0.15), mk('kagero', 'red', 5800, -3200, Math.PI - 0.15), mk('kagero', 'red', 6400, -300, Math.PI - 0.15)]);
  await page.mouse.move(1180, 330);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 6; g.renderer.camera.targetZoom = 0.3; });
  await page.waitForTimeout(11000);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.62; g.hud.toggleHelp(); });
  await page.waitForTimeout(3500);
  await ev(() => { const t = document.querySelector('.hud-tip'); if (t) t.style.display = 'none'; });
  await page.screenshot({ path: out });
}
