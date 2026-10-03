export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await page.click('[data-a=setup]');
  await page.waitForTimeout(500);
  await page.click('[data-p="3v3"]');
  await page.click('[data-a=start]');
  await page.waitForTimeout(500);
  await ev(() => { const r = window.__riptide; r.autopilot(); r.game.timeScale = 5; r.game.renderer.camera.targetZoom = 0.04; });
  await page.mouse.move(900, 300);
  await page.waitForTimeout(20000);
  await ev(() => { window.__riptide.game.timeScale = 1; });
  await page.waitForTimeout(1500);
  await shot('a');
  await ev(() => { const r = window.__riptide; r.game.renderer.camera.targetZoom = 0.18; });
  await page.waitForTimeout(3000);
  await shot('b');
  const fps = await page.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return n / 2; });
  console.log('fps', fps);
}
