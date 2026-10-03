export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => {
    const r = window.__riptide; r.startBattle(r.quickBattle('officer', 3));
    const g = r.game; const e = g.world.ships[1];
    g.lockId = e.id; g.renderer.camera.zoom = g.renderer.camera.targetZoom = 1.6;
    const rnd = () => Math.random();
    e.startFire(60, 3, 'high', 1, rnd); e.startFire(-20, -4, 'high', 0.8, rnd); e.startFire(-100, 2, 'high', 0.9, rnd);
    for (const sec of e.sections.slice(0, 3)) { sec.stbd = sec.def.capacity * 0.45; sec.port = sec.def.capacity * 0.3; }
    e.holes.push({ section: 1, side: 1, x: 100, z: -2, area: 1 });
    g.world.damageModule(e, 't2', 200, 'AP'); g.world.damageModule(e, 'b2', 90, 'AP');
    const me = g.player; me.startFire(20, 6, 'high', 1, rnd); g.world.damageModule(me, 'steer', 200, 'AP'); g.world.damageModule(me, 'e3', 100, 'AP'); g.world.damageModule(me, 't3', 60, 'AP');
    for (const sec of me.sections.slice(6, 9)) { sec.stbd = sec.def.capacity * 0.4; }
    me.holes.push({ section: 7, side: 1, x: -70, z: -3, area: 0.7 });
    for (const [x, y] of [[40, 5], [-10, -8], [80, 2]]) g.renderer.addDecal(e, x, y, 7);
  });
  await page.mouse.move(1100, 300);
  await page.waitForTimeout(6000);
  await shot('a');
  await ev(() => { const g = window.__riptide.game; const e = g.world.ships[1]; e.beginSinking('Foundered — sunk by flooding'); });
  await page.waitForTimeout(12000);
  await shot('sink1');
  await page.waitForTimeout(15000);
  await shot('sink2');
}
