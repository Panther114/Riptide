export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 5)); const c = r.game.renderer.camera; c.zoom = c.targetZoom = 3.2; });
  await page.mouse.move(1300, 200);
  await page.waitForTimeout(4000);
  await shot('z3');
  await ev(() => { const c = window.__riptide.game.renderer.camera; c.targetZoom = 1.5; });
  await page.waitForTimeout(2000);
  await shot('z15');
}
