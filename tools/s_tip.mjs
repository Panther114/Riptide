export default async function (page, out) {
  await page.mouse.move(400, 450);
  await page.click('[data-a=quick]');
  await page.mouse.move(1000, 300);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: out });
  // wait for an incoming salvo around us
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => { const g = window.__riptide.game; let m = Infinity; for (const s of g.world.shells) if (s.team !== g.player.team) m = Math.min(m, s.T - s.t); return m; });
    if (t < 5) { await page.screenshot({ path: out.replace('.png', '_in.png') }); break; }
    await page.waitForTimeout(500);
  }
}
