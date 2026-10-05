// Visual verification for the new ship classes and systems.
//   node tools/shot.mjs file:///D:/devs/Riptide/dist/index.html tools/s_phase2.mjs shots/p2.png
export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  const ev = (f, a) => page.evaluate(f, a);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForTimeout(800);
  await shot('title');
  // every class, close up
  for (const id of ['iowa', 'bismarck', 'yamato', 'baltimore', 'takao', 'fletcher', 'kagero']) {
    await ev((id) => { const r = window.__riptide; r.startBattle(r.quickBattle('officer', 7, id)); }, id);
    await page.mouse.move(1150, 300);
    await page.waitForTimeout(600);
    await ev(() => { const g = window.__riptide.game; const c = g.renderer.camera; c.targetZoom = c.zoom = 2.6 * Math.sqrt(270 / g.player.cls.length) * 0.75; g.timeScale = 1; });
    await page.waitForTimeout(2600);
    await shot('cls_' + id);
  }
  // torpedo aim mode on a Kagero facing an Iowa
  await ev(() => { const r = window.__riptide; const cfg = r.quickBattle('officer', 9, 'kagero'); cfg.ships[1].classId = 'iowa'; cfg.ships[1].x = 3000; cfg.ships[1].y = -1500; cfg.ships[0].x = -3000; cfg.ships[0].y = 1500; r.startBattle(cfg); });
  await page.waitForTimeout(800);
  await ev(() => { const c = window.__riptide.game.renderer.camera; c.targetZoom = 0.16; });
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1500);
  const enemy = await ev(() => { const g = window.__riptide.game; const e = g.world.ships[1]; return g.renderer.camera.worldToScreen({ x: e.pos.x + Math.cos(e.heading) * 1200, y: e.pos.y + Math.sin(e.heading) * 1200 }); });
  await page.mouse.move(enemy.x, enemy.y);
  await page.waitForTimeout(1500);
  await shot('torp_aim');
  await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(3000);
  await shot('torp_run');
  // a night surface action among islands, fast-forwarded
  await ev(() => {
    const r = window.__riptide;
    const mk = (classId, team, x, y, h, c = 'ai') => ({ classId, team, x, y, heading: h, speed: 13, telegraph: 4, controller: c });
    r.startBattle({ seed: 77, mapSize: 40000, difficulty: 'officer', wind: 0.4, conditions: 'night', terrain: 'islands', ships: [
      mk('iowa', 'blue', -6000, 2000, -0.1, 'player'), mk('fletcher', 'blue', -4800, 2900, -0.1), mk('fletcher', 'blue', -7200, 1100, -0.1),
      mk('takao', 'red', 7000, -2000, Math.PI - 0.3), mk('kagero', 'red', 6000, -800, Math.PI - 0.3), mk('kagero', 'red', 7800, -3200, Math.PI - 0.3)] });
    window.__riptide.autopilot();
  });
  await page.waitForTimeout(800);
  await ev(() => { const g = window.__riptide.game; g.renderer.camera.targetZoom = 0.05; g.timeScale = 8; });
  await page.waitForTimeout(9000);
  await shot('night_far');
  await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.35; });
  await page.waitForTimeout(2500);
  await shot('night_close');
  // damage control: hover the plan, click a compartment
  await page.mouse.move(250, 760);
  await page.waitForTimeout(400);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(800);
  await shot('dc_click');
  // battle setup with a preset
  await ev(() => { window.__riptide.toTitle(); });
  await page.waitForTimeout(500);
  await page.click('[data-a=setup]');
  await page.waitForTimeout(400);
  await page.click('[data-p=night]');
  await page.waitForTimeout(400);
  await shot('setup');
  await ev(() => window.__riptide.toTitle());
  await page.click('[data-a=help]');
  await page.waitForTimeout(500);
  await shot('manual');
  console.log('PAGE ERRORS:', errors.length ? errors.join(' | ') : 'none');
  console.log(await ev(() => JSON.stringify(window.__riptide.game.world.ships.map((s) => ({ n: s.name, c: s.cls.id, st: s.status, out: s.outReason })))));
}
