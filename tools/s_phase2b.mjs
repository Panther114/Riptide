// Second visual pass: torpedoes, smoke, night, damage control, results, close-ups.
export default async function (page, out) {
  const shot = (n, clip) => page.screenshot({ path: out.replace('.png', `_${n}.png`), clip });
  const ev = (f, a) => page.evaluate(f, a);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const mk = (classId, team, x, y, h, c = 'ai') => ({ classId, team, x, y, heading: h, speed: 12, telegraph: 4, controller: c });
  const start = (cfg) => ev((cfg) => { window.__riptide.startBattle(cfg); }, cfg);

  // ---- torpedo attack: Fletcher vs Kagero at close range
  await start({ seed: 5, mapSize: 40000, difficulty: 'officer', wind: 0.3, conditions: 'day', terrain: 'open', ships: [mk('fletcher', 'blue', 0, 0, 0, 'player'), mk('baltimore', 'red', 3800, -2600, Math.PI / 2 + 0.3)] });
  await page.waitForTimeout(700);
  await ev(() => { const g = window.__riptide.game; g.renderer.camera.targetZoom = 0.2; g.world.ships[1].cmd.secondaries = false; });
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1200);
  const lead = await ev(() => { const g = window.__riptide.game; const e = g.world.ships[1]; const me = g.player; const d = Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y); const t = d / me.cls.torpedoes.def.speed; return g.renderer.camera.worldToScreen({ x: e.pos.x + Math.cos(e.heading) * e.speed * t, y: e.pos.y + Math.sin(e.heading) * e.speed * t }); });
  await page.mouse.move(lead.x, lead.y);
  await page.waitForTimeout(900);
  await shot('torp_aim');
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(500);
  await page.mouse.move(lead.x + 30, lead.y + 10);
  await page.waitForTimeout(500);
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(5000);
  await shot('torp_tracks');
  await ev(() => { window.__riptide.game.timeScale = 4; });
  await page.waitForTimeout(6000);
  await ev(() => { window.__riptide.game.timeScale = 1; });
  console.log('torp stats', await ev(() => JSON.stringify(window.__riptide.game.world.ships.map((s) => ({ n: s.name, torp: s.stats.torpedoes, hits: s.stats.torpHits, flood: Math.round(s.floodTotal), st: s.status, out: s.outReason })))));
  await shot('torp_after');

  // ---- smoke screen
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyX');
  await page.keyboard.down('KeyA');
  await ev(() => { const g = window.__riptide.game; g.timeScale = 3; g.renderer.camera.targetZoom = 0.11; });
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyA');
  await ev(() => { window.__riptide.game.timeScale = 1; });
  await page.waitForTimeout(800);
  await shot('smoke');
  console.log('enemy sees us through smoke?', await ev(() => { const g = window.__riptide.game; return g.world.visible.red.has(g.player.id) + ' smoke puffs ' + g.world.smoke.length; }));

  // ---- night, revised lighting
  await start({ seed: 77, mapSize: 40000, difficulty: 'officer', wind: 0.4, conditions: 'night', terrain: 'islands', ships: [
    mk('iowa', 'blue', -6000, 2000, -0.1, 'player'), mk('fletcher', 'blue', -4800, 2900, -0.1), mk('fletcher', 'blue', -7200, 1100, -0.1),
    mk('takao', 'red', 7000, -2000, Math.PI - 0.3), mk('kagero', 'red', 6000, -800, Math.PI - 0.3), mk('kagero', 'red', 7800, -3200, Math.PI - 0.3)] });
  await ev(() => window.__riptide.autopilot());
  await page.waitForTimeout(600);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 6; });
  await page.waitForTimeout(8000);
  await ev(() => { const g = window.__riptide.game; g.timeScale = 1; g.renderer.camera.targetZoom = 0.5; });
  await page.waitForTimeout(2500);
  await shot('night_close');

  // ---- damage control: hurt our ship, then click a compartment on the plan
  await start({ seed: 9, mapSize: 40000, difficulty: 'officer', wind: 0.3, conditions: 'day', terrain: 'open', ships: [mk('iowa', 'blue', 0, 0, 0, 'player'), mk('bismarck', 'red', 30000, 0, Math.PI)] });
  await page.waitForTimeout(600);
  await ev(() => {
    const g = window.__riptide.game, w = g.world, s = g.player;
    w.damageModule(s, 'e2', 90, 'test'); w.damageModule(s, 'dirF', 70, 'test'); w.damageModule(s, 'steer', 50, 'test');
    w.sink.startFire(s, -40, 3, 'high', 1); w.sink.startFire(s, 60, -2, 'low', 1);
    w.sink.addHole(s, 30, 16, -2, 2.5); w.sink.addHole(s, 31, 16, -2.2, 1.5);
  });
  await page.waitForTimeout(3000);
  // click the forward director on the plan: panel canvas maps local x,y → px
  const pt = await ev(() => {
    const cv = document.querySelector('.hud-status canvas'); const r = cv.getBoundingClientRect();
    const L = 270.4, k = (560 - 30) / L, cx = 560 / 2 - 2, cy = 58;
    return { x: r.left + cx + 17 * k, y: r.top + cy + 0 * k };
  });
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(400);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(1500);
  await shot('dc');
  console.log('dc parties', await ev(() => JSON.stringify(window.__riptide.game.player.dc)));
  // list & counter-flood
  await ev(() => { const s = window.__riptide.game.player; s.sections[6].stbd = 1150; s.sections[7].stbd = 1150; });
  await page.waitForTimeout(4000);
  const listBefore = await ev(() => window.__riptide.game.player.list * 57.3);
  await page.keyboard.press('KeyC');
  await ev(() => { window.__riptide.game.timeScale = 4; });
  await page.waitForTimeout(6000);
  await ev(() => { window.__riptide.game.timeScale = 1; });
  const listAfter = await ev(() => window.__riptide.game.player.list * 57.3);
  console.log(`counterflood list ${listBefore.toFixed(1)} -> ${listAfter.toFixed(1)}`);
  await shot('counterflood');

  // ---- close-ups of the art
  for (const id of ['bismarck', 'yamato', 'takao', 'fletcher']) {
    await start({ seed: 3, mapSize: 40000, difficulty: 'officer', wind: 0.3, conditions: 'day', terrain: 'open', ships: [mk(id, 'blue', 0, 0, 0, 'player'), mk('iowa', 'red', 30000, 0, Math.PI)] });
    await ev(() => { const c = window.__riptide.game.renderer.camera; c.zoom = c.targetZoom = 3.2; window.__riptide.game.hud.root.style.display = 'none'; });
    await page.waitForTimeout(1500);
    await shot('close_' + id, { x: 0, y: 200, width: 1600, height: 500 });
  }

  // ---- results screen
  await start({ seed: 4, mapSize: 40000, difficulty: 'officer', wind: 0.3, conditions: 'dusk', terrain: 'strait', ships: [mk('bismarck', 'blue', -11000, 0, 0, 'player'), mk('fletcher', 'blue', -9800, 900, 0), mk('iowa', 'red', 11000, 0, Math.PI), mk('kagero', 'red', 9800, -900, Math.PI)] });
  await page.waitForTimeout(800);
  await ev(() => { const g = window.__riptide.game; g.renderer.camera.targetZoom = 0.04; });
  await page.waitForTimeout(1500);
  await shot('strait');
  await ev(() => { const g = window.__riptide.game; for (const s of g.world.ships) if (s.team === 'red') { s.setOutOfAction('Test'); } });
  await page.waitForTimeout(13000);
  await shot('results');
  console.log('PAGE ERRORS:', errors.length ? errors.join(' | ') : 'none');
}
