export default async function (page, out) {
  await page.mouse.move(400, 450);
  await page.click('[data-a=quick]');
  await page.waitForTimeout(3000);
  const p = await page.evaluate(() => {
    const g = window.__riptide.game, cam = g.renderer.camera; const sp = cam.worldToScreen(g.world.ships[1].pos);
    const x0 = 40, x1 = cam.w - 40, y0 = 80, y1 = cam.h - 200; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ang = Math.atan2(sp.y - cy, sp.x - cx); const k = Math.min((x1 - x0) / 2 / Math.abs(Math.cos(ang)), (y1 - y0) / 2 / Math.abs(Math.sin(ang)));
    let x = cx + Math.cos(ang) * k, y = cy + Math.sin(ang) * k; if (x > cam.w - 210 && y < 205) { if (Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))) y = 210; else x = cam.w - 215; }
    return { x, y };
  });
  await page.mouse.move(p.x, p.y);
  await page.screenshot({ path: out.replace('.png', '_a.png') });
  await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(2000);
  console.log('lock', await page.evaluate(() => window.__riptide.game.lockId));
  await page.screenshot({ path: out.replace('.png', '_b.png') });
}
