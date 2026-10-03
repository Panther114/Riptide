export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await page.mouse.move(300, 450);
  await page.click('[data-a=quick]');
  await page.waitForTimeout(1500);
  const key = async (k, ms = 80) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
  await key('KeyS'); await key('KeyW');
  await key('KeyD', 2500);
  // lock camera on enemy with MMB
  const ep = await ev(() => { const g = window.__riptide.game; const c = g.renderer.camera; c.targetZoom = 0.05; return null; });
  await page.waitForTimeout(1500);
  const p = await ev(() => { const g = window.__riptide.game; return g.renderer.camera.worldToScreen(g.world.ships[1].pos); });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(1300);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(50); }
  await page.waitForTimeout(1200);
  await key('Digit2');
  for (let k = 0; k < 6; k++) {
    const q = await ev(() => { const g = window.__riptide.game; const me = g.player, e = g.world.ships[1]; const d = Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y); const tof = (d / 1800) * (1 + d / 30000) + 0.4; return g.renderer.camera.worldToScreen({ x: e.pos.x + Math.cos(e.heading) * e.speed * tof, y: e.pos.y + Math.sin(e.heading) * e.speed * tof }); });
    await page.mouse.move(q.x, q.y, { steps: 5 });
    await page.waitForTimeout(2500);
    await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
    if (k === 2) { await key('Digit1'); await shot('aim'); }
    await page.waitForTimeout(2000);
  }
  await shot('fight');
  // unlock (MMB on empty water)
  await page.mouse.move(200, 200);
  await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await shot('pause');
  await page.click('[data-a=resume]');
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(600);
  await shot('back');
  console.log(await ev(() => JSON.stringify({ state: document.body.dataset.state, t: window.__riptide.game.world.time, me: window.__riptide.game.player.stats, tg: window.__riptide.game.player.telegraph })));
}
