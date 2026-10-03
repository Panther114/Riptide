export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 42)); });
  await page.mouse.move(1000, 350);
  await page.waitForTimeout(1500);
  await ev(() => { const c = window.__riptide.game.renderer.camera; c.targetZoom = 1.6; });
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(3000);
  await shot('close');
  await page.keyboard.up('KeyA');
  await ev(() => { const c = window.__riptide.game.renderer.camera; c.targetZoom = 0.075; });
  await page.waitForTimeout(1500);
  const aimAt = async () => {
    const p = await ev(() => { const g = window.__riptide.game; const me = g.player; const e = g.world.ships[1]; const d = Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y); const tof = (d / 1800) * (1 + d / 30000) + 0.4; const lead = { x: e.pos.x + Math.cos(e.heading) * e.speed * tof, y: e.pos.y + Math.sin(e.heading) * e.speed * tof }; return g.renderer.camera.worldToScreen(lead); });
    await page.mouse.move(p.x, p.y);
  };
  for (let k = 0; k < 3; k++) { await aimAt(); await page.waitForTimeout(1500); await aimAt(); await page.waitForTimeout(1500); await aimAt(); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(4000); }
  await shot('far');
  await ev(() => { window.__riptide.game.timeScale = 1; });
  // watch shells land close to the enemy
  await ev(() => { const g = window.__riptide.game; g.lockId = g.world.ships[1].id; g.renderer.camera.refocus(); g.renderer.camera.targetZoom = 0.9; });
  await page.waitForTimeout(5000);
  await shot('enemy');
  // fast forward the battle
  await ev(() => { window.__riptide.game.timeScale = 6; });
  for (let i = 0; i < 12; i++) { await aimAt(); await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up(); }
  await ev(() => { window.__riptide.game.timeScale = 1; window.__riptide.game.lockId = null; window.__riptide.game.renderer.camera.refocus(); window.__riptide.game.renderer.camera.targetZoom = 1.1; });
  await page.waitForTimeout(2500);
  await shot('later');
  console.log(await ev(() => JSON.stringify(window.__riptide.game.world.ships.map(s => ({ n: s.name, st: s.stats, flood: s.floodTotal, out: s.outReason })))));
}
