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
  const res = await ev(async () => {
    const R = window.__riptide.game.renderer;
    const names = ['drawChart', 'drawWakes', 'drawShip', 'drawShells', 'drawMarkers', 'drawTexts', 'drawAim', 'drawWorldOverlayLow'];
    const t = {}; for (const n of names) { t[n] = 0; const f = R[n].bind(R); R[n] = (...a) => { const t0 = performance.now(); const r = f(...a); t[n] += performance.now() - t0; return r; }; }
    const fx = R.fx; let tfx = 0; const fd = fx.draw.bind(fx); fx.draw = (...a) => { const t0 = performance.now(); fd(...a); tfx += performance.now() - t0; };
    const G = window.__riptide.game; let tw = 0, tu = 0, th = 0;
    const wr = R.water.render.bind(R.water); R.water.render = (...a) => { const t0 = performance.now(); wr(...a); tw += performance.now() - t0; };
    const st = G.world.step.bind(G.world); G.world.step = (...a) => { const t0 = performance.now(); st(...a); tu += performance.now() - t0; };
    const hu = G.hud.update.bind(G.hud); G.hud.update = (...a) => { const t0 = performance.now(); hu(...a); th += performance.now() - t0; };
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const per = (v) => (v / n).toFixed(2);
    const o = { fps: n / 3, particles: fx.ps.length, fx: per(tfx), water: per(tw), sim: per(tu), hud: per(th) }; for (const k in t) o[k] = per(t[k]); return o;
  });
  console.log(JSON.stringify(res));
}
