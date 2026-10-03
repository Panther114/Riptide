export default async function (page, out) {
  const shot = (n, clip) => page.screenshot({ path: out.replace('.png', `_${n}.png`), clip });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 8)); const g = r.game; g.world.damageModule(g.player, 'b2', 70, 'AP'); g.world.damageModule(g.player, 'dirF', 90, 'AP'); g.player.holes.push({ section: 2, side: 1, x: 60, z: -3, area: 0.8 }); });
  await page.waitForTimeout(3000);
  await page.mouse.move(165, 760);
  await page.waitForTimeout(700);
  await shot('tip', { x: 0, y: 520, width: 520, height: 380 });
  await page.mouse.move(350, 760);
  await page.waitForTimeout(700);
  await shot('tip2', { x: 0, y: 520, width: 520, height: 380 });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(500);
  await shot('armor', { x: 0, y: 640, width: 520, height: 260 });
}
