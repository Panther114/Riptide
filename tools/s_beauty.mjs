export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const r = window.__riptide; const cfg = r.quickBattle('admiral', 1234);
    cfg.ships[0].x = -5000; cfg.ships[0].y = 2600; cfg.ships[1].x = 5000; cfg.ships[1].y = -2600;
    r.startBattle(cfg); r.autopilot(); r.game.timeScale = 3; r.game.hud.toggleHelp();
  });
  await page.mouse.move(1180, 300);
  await page.waitForTimeout(14000);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.62; });
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(2200); await shot('p' + i); }
  await ev(() => { const g = window.__riptide.game; g.lockId = g.world.ships[1].id; g.renderer.camera.refocus(); });
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(2200); await shot('e' + i); }
}
