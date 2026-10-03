export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const r = window.__riptide;
    const cfg = r.quickBattle('admiral', 11);
    cfg.ships[0].x = -3000; cfg.ships[0].y = 1500; cfg.ships[1].x = 3000; cfg.ships[1].y = -1500;
    r.startBattle(cfg); r.autopilot();
    const g = r.game; g.renderer.camera.zoom = 0.55; g.renderer.camera.targetZoom = 0.55;
  });
  await page.mouse.move(800, 450);
  await page.waitForTimeout(9000);
  for (let i = 0; i < 6; i++) {
    await ev((i) => { const g = window.__riptide.game; g.lockId = g.world.ships[i % 2].id; g.renderer.camera.targetZoom = i < 3 ? 1.1 : 0.7; }, i);
    await page.waitForTimeout(3500);
    await shot('f' + i);
  }
  // force a magazine detonation and a sinking for visuals
  await ev(() => { const g = window.__riptide.game; const e = g.world.ships[1]; g.lockId = e.id; g.renderer.camera.targetZoom = 0.8; g.world.sink.detonateMagazine(e, 50); });
  await page.waitForTimeout(700); await shot('boom0');
  await page.waitForTimeout(2500); await shot('boom1');
  await page.waitForTimeout(8000); await shot('boom2');
}
