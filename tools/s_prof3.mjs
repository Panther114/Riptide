export default async function (page, out) {
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const r = window.__riptide; const mk = (team, x, y, hd, ctl = 'ai') => ({ classId: 'iowa', team, x, y, heading: hd, speed: 13, telegraph: 4, controller: ctl });
    r.startBattle({ seed: 99, mapSize: 40000, difficulty: 'officer', wind: 0.4, ships: [mk('blue', -9000, 1500, -0.1, 'player'), mk('blue', -10400, 1700, -0.1), mk('blue', -11800, 1900, -0.1), mk('red', 9000, -1500, Math.PI - 0.1), mk('red', 10400, -1700, Math.PI - 0.1), mk('red', 11800, -1900, Math.PI - 0.1)] });
    r.autopilot(); r.game.timeScale = 5; r.game.renderer.camera.targetZoom = 0.18;
  });
  await page.mouse.move(900, 300);
  await page.waitForTimeout(15000);
  await ev(() => { window.__riptide.game.timeScale = 0.0001; });
  const fps = () => ev(async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return n / 2.5; });
  console.log('base', await fps(), await fps());
  for (const k of ['fx', 'drawWakes', 'drawShip', 'water', 'hud', 'world2d']) {
    await ev((k) => {
      const G = window.__riptide.game, R = G.renderer; const S = (window.__S = {});
      if (k === 'fx') { S.f = () => (R.fx.draw = S.o); S.o = R.fx.draw; R.fx.draw = () => {}; }
      else if (k === 'water') { S.o = R.water.render; S.f = () => (R.water.render = S.o); R.water.render = () => {}; }
      else if (k === 'hud') { G.hud.root.style.display = 'none'; S.f = () => (G.hud.root.style.display = ''); }
      else if (k === 'world2d') { R.canvas.style.display = 'none'; S.f = () => (R.canvas.style.display = ''); }
      else { S.o = R[k]; R[k] = () => {}; S.f = () => (R[k] = S.o); }
    }, k);
    console.log('without', k, await fps());
    await ev(() => window.__S.f());
  }
}
