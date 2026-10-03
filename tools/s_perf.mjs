export default async function (page) {
  const fps = () => page.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return n / 2; });
  await page.evaluate(() => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 42)); r.game.renderer.camera.targetZoom = 0.5; });
  await page.mouse.move(1100, 300);
  await page.waitForTimeout(2000);
  console.log('full', await fps());
  await page.evaluate(() => { const g = window.__riptide.game; g.renderer.water.__r = g.renderer.water.render; g.renderer.water.render = () => {}; });
  console.log('no water', await fps());
  await page.evaluate(() => { const g = window.__riptide.game; g.renderer.water.render = g.renderer.water.__r; g.renderer.__render = g.renderer.render; g.renderer.render = function (w, o) { this.water.render(this.camera.cx, this.camera.cy, this.camera.zoom * this.camera.dpr * this.waterScale, this.time, w.cfg.wind); }; });
  console.log('water only', await fps());
  await page.evaluate(() => { const g = window.__riptide.game; g.renderer.render = g.renderer.__render; g.hud.update = () => {}; });
  console.log('no hud', await fps());
}
