export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { const r = window.__riptide; r.startBattle(r.quickBattle('admiral', 7)); r.autopilot(); r.game.timeScale = 8; });
  await page.mouse.move(800, 300);
  let n = 0;
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(2000);
    const st = await ev(() => { const g = window.__riptide.game; return { t: g.world.time, ended: g.world.ended, state: document.body.dataset.state, ships: g.world.ships.map((s) => `${s.name}:${s.outReason || 'ok'}:${Math.round(s.floodTotal)}`).join(' | ') }; });
    if (i % 5 === 0) console.log(JSON.stringify(st));
    if (i === 12 || i === 25) { await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.9; }); await page.waitForTimeout(3500); await shot('mid' + (n++)); await ev(() => { window.__riptide.game.timeScale = 8; }); }
    if (st.state === 'results') { await page.waitForTimeout(800); await shot('results'); break; }
    if (st.ended) { await ev(() => { window.__riptide.game.timeScale = 1; }); await shot('end'); }
  }
}
