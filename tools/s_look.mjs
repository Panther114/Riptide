export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 21)); r.autopilot(); r.game.timeScale = 6; });
  await page.mouse.move(1150, 330);
  await page.waitForTimeout(16000);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.33; });
  await page.waitForTimeout(2500);
  await shot('mid');
  // lock on enemy and wait for our shells to land
  await ev(() => { const g = window.__riptide.game; g.lockId = g.world.ships[1].id; g.renderer.camera.refocus(); g.renderer.camera.targetZoom = 0.75; });
  for (let i = 0; i < 8; i++) {
    const t = await ev(() => { const g = window.__riptide.game; let m = Infinity; for (const s of g.world.shells) if (s.shooter === g.player.id) m = Math.min(m, s.T - s.t); return m; });
    if (t < 1.2) { await page.waitForTimeout(Math.max(0, t * 1000 + 250)); await shot('impact' + i); await page.waitForTimeout(1500); await shot('after' + i); break; }
    await page.waitForTimeout(Math.min(2000, isFinite(t) ? (t - 1) * 1000 : 2000));
  }
}
