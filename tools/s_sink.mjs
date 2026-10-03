export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const r = window.__riptide; r.startBattle(r.quickBattle('officer', 3));
    const g = r.game; g.onEnd = null; const e = g.world.ships[1];
    g.lockId = e.id; g.renderer.camera.zoom = g.renderer.camera.targetZoom = 1.2;
    for (const sec of e.sections.slice(0, 4)) { sec.stbd = sec.def.capacity * 0.5; sec.port = sec.def.capacity * 0.45; }
    e.startFire(-40, 3, 'high', 1, Math.random);
  });
  await page.mouse.move(1100, 300);
  await page.waitForTimeout(3000);
  await ev(() => { const g = window.__riptide.game; g.world.ships[1].beginSinking('Foundered'); });
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(11000); await shot('s' + i); }
}
