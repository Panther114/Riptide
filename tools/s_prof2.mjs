export default async function (page, out) {
  const ev = (f, a) => page.evaluate(f, a);
  await page.click('[data-a=setup]');
  await page.waitForTimeout(500);
  await page.click('[data-p="3v3"]');
  await page.click('[data-a=start]');
  await page.waitForTimeout(500);
  await ev(() => { const r = window.__riptide; r.autopilot(); r.game.timeScale = 5; r.game.renderer.camera.targetZoom = 0.18; });
  await page.mouse.move(900, 300);
  await page.waitForTimeout(15000);
  await ev(() => { window.__riptide.game.timeScale = 1; });
  const fps = () => ev(async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return n / 2; });
  console.log('base', await fps());
  for (const k of ['fx', 'drawWakes', 'drawShip', 'water', 'hud', 'all2d']) {
    await ev((k) => {
      const G = window.__riptide.game, R = G.renderer;
      window.__saved = window.__saved || {};
      if (k === 'fx') { window.__saved.fx = R.fx.draw; R.fx.draw = () => {}; }
      else if (k === 'water') { window.__saved.w = R.water.render; R.water.render = () => {}; }
      else if (k === 'hud') { G.hud.root.style.display = 'none'; }
      else if (k === 'all2d') { R.canvas.style.display = 'none'; }
      else { window.__saved[k] = R[k]; R[k] = () => {}; }
    }, k);
    console.log('without', k, await fps());
  }
}
