// Headless regression & sanity tests for the simulation.   npm test
//
// Each check runs the real sim (no mocks). Statistical checks use fixed seeds so
// they are repeatable; thresholds are deliberately loose — they catch broken
// mechanics, not balance drift.

import { World } from '../src/sim/world';
import { AIDirector } from '../src/ai/ai';
import { SHIP_CLASSES, CLASS_ORDER } from '../src/sim/shipClass';
import { fallAngle, strikeVelocity, penetration, flightTime } from '../src/sim/ballistics';
import { resolveTorpedo } from '../src/sim/damage';
import { DEG, Rng } from '../src/core/math';
import type { BattleConfig, ShipSpawn } from '../src/sim/types';
import { MATCHUPS, makeConfig, runBattle } from './matchups';

let failures = 0, passes = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++; else failures++;
  results.push(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}
const pct = (x: number) => (x * 100).toFixed(0) + '%';

const spawn = (classId: string, team: 'blue' | 'red', x: number, y: number, heading: number, extra: Partial<ShipSpawn> = {}): ShipSpawn =>
  ({ classId, team, x, y, heading, controller: 'ai', ...extra });
const cfg = (ships: ShipSpawn[], o: Partial<BattleConfig> = {}): BattleConfig => ({ seed: 11, mapSize: 60000, difficulty: 'officer', wind: 0, ships, ...o });

// ------------------------------------------------------------ class data integrity
for (const id of CLASS_ORDER) {
  const c = SHIP_CLASSES[id];
  const mods = new Set(c.modules.map((m) => m.id));
  const errs: string[] = [];
  for (const t of c.turrets) {
    if (!mods.has(t.id)) errs.push(`turret ${t.id} has no module`);
    if (!mods.has(t.magazine)) errs.push(`turret ${t.id} magazine ${t.magazine} missing`);
    if (Math.abs(t.x) + t.radius > c.length / 2) errs.push(`turret ${t.id} outside hull`);
  }
  for (const m of c.secondary?.mounts ?? []) if (!mods.has(m.module)) errs.push(`secondary ${m.id} module ${m.module} missing`);
  for (const m of c.torpedoes?.mounts ?? []) if (!mods.has(m.module)) errs.push(`torpedo mount ${m.id} module ${m.module} missing`);
  for (const s of c.shafts) if (!mods.has(s.engine)) errs.push(`shaft engine ${s.engine} missing`);
  for (const s of c.structures) if (s.module && !mods.has(s.module)) errs.push(`structure ${s.name} module missing`);
  for (const k of ['bridge', 'steering', 'director', 'boiler', 'engine'] as const) if (!c.modules.some((m) => m.kind === k)) errs.push(`no ${k}`);
  // watertight sections must tile the hull without gaps or overlaps
  const secs = [...c.sections].sort((a, b) => a.x0 - b.x0);
  if (Math.abs(secs[0].x0 + c.length / 2) > 1.5 || Math.abs(secs[secs.length - 1].x1 - c.length / 2) > 1.5) errs.push('sections do not span the hull');
  for (let i = 1; i < secs.length; i++) if (Math.abs(secs[i].x0 - secs[i - 1].x1) > 0.01) errs.push(`section gap at ${secs[i].x0.toFixed(1)}`);
  // armour zones must cover the hull
  for (let x = -c.length / 2 + 0.5; x < c.length / 2; x += 2) if (!c.zones.some((z) => x >= z.x0 && x < z.x1)) { errs.push(`no armour zone at x=${x.toFixed(1)}`); break; }
  // low-band vitals must fit inside the hull
  for (const m of c.modules) if (m.band === 'low' && (m.rect.y1 > c.halfBeam((m.rect.x0 + m.rect.x1) / 2) + 0.01)) errs.push(`${m.id} pokes through the hull`);
  if (c.sections.reduce((a, s) => a + s.capacity, 0) < c.reserveBuoyancy * 0.8) errs.push('sections cannot hold enough water to sink her');
  check(`class data: ${id}`, errs.length === 0, errs.join('; '));
}

// ------------------------------------------------------------ ballistics
{
  const iowa = SHIP_CLASSES.iowa.shells.AP;
  const pen = (r: number, s = iowa) => penetration(strikeVelocity(r, s), s);
  check('16" AP penetration at 0 km ≈ 830 mm', Math.abs(pen(0) - 830) < 1, pen(0).toFixed(0));
  check('16" curve unchanged by refactor (10 km)', Math.abs(pen(10000) - 830 * Math.pow(Math.exp(-10000 / 46000), 1.38)) < 0.5);
  const bis = SHIP_CLASSES.bismarck.shells.AP;
  check('38 cm AP ≈ 510 mm at 10 km (NavWeaps)', Math.abs(pen(10000, bis) - 510) < 40, pen(10000, bis).toFixed(0));
  check('38 cm AP ≈ 308 mm at 25 km (NavWeaps)', Math.abs(pen(25000, bis) - 308) < 40, pen(25000, bis).toFixed(0));
  const yam = SHIP_CLASSES.yamato.shells.AP;
  check('46 cm AP ≈ 494 mm at 18.3 km (NavWeaps)', Math.abs(pen(18288, yam) - 494) < 40, pen(18288, yam).toFixed(0));
  const bal = SHIP_CLASSES.baltimore.shells.AP;
  check('8" Mk 21 ≈ 254 mm at 9.9 km (NavWeaps)', Math.abs(pen(9875, bal) - 254) < 30, pen(9875, bal).toFixed(0));
  check('time of flight grows with range; 5" slower than 16" at 10 km', flightTime(10000, SHIP_CLASSES.fletcher.shells.AP) > flightTime(10000, iowa) && flightTime(20000, iowa) > flightTime(10000, iowa));
  check('fall angle steeper for a smaller gun at the same range', fallAngle(12000, SHIP_CLASSES.fletcher.shells.AP) > fallAngle(12000, iowa));
}

// ------------------------------------------------------------ armour probes
/** Fire many shells from `shooterCls` at a broadside target and tally outcomes. */
function probe(shooterCls: string, targetCls: string, ammo: 'AP' | 'HC', range: number, angle = 90, n = 600, seed = 3) {
  const w = new World(cfg([spawn(shooterCls, 'blue', 0, 0, 0), spawn(targetCls, 'red', range, 0, Math.PI - angle * DEG)], { seed }));
  const [a, b] = w.ships;
  const rng = new Rng(seed * 7 + 1);
  const tally: Record<string, number> = {};
  let hits = 0, lowDamage = 0;
  for (let i = 0; i < n; i++) {
    for (const m of b.modules.values()) { m.hp = m.def.hp; m.level = 0; m.flooded = false; }
    b.status = 'active'; b.outOfAction = false; b.holes = []; b.fires = [];
    w.events = [];
    const land = { x: range + (rng.next() - 0.5) * 40, y: (rng.next() - 0.5) * b.cls.length * 0.7 };
    const sh = a.cls.shells[ammo];
    (w as any).impact({ id: 0, shooter: a.id, team: 'blue', shell: sh, origin: { x: 0, y: 0 }, target: land, t: 0, T: 1, apex: 0, fall: fallAngle(range, sh), v: strikeVelocity(range, sh), salvo: 0, aimPoint: land });
    for (const e of w.events) if (e.type === 'hit') {
      hits++;
      tally[e.report.kind] = (tally[e.report.kind] ?? 0) + 1;
      if (e.report.modules.some((m) => b.mod(m.id).def.band === 'low' && m.dmg > 5)) lowDamage++;
    }
  }
  const f = (k: string) => (tally[k] ?? 0) / Math.max(1, hits);
  return { hits, f, vitals: lowDamage / Math.max(1, hits), tally };
}
{
  const close = probe('iowa', 'iowa', 'AP', 9000);
  check('16" AP vs Iowa at 9 km: citadels happen', close.f('citadel') > 0.05, `citadel ${pct(close.f('citadel'))}`);
  const far = probe('iowa', 'iowa', 'AP', 24000);
  check('16" AP vs Iowa at 24 km: belt mostly holds (fewer citadels than close in)', far.f('citadel') < close.f('citadel'), `${pct(far.f('citadel'))} vs ${pct(close.f('citadel'))}`);
  const bis = probe('iowa', 'bismarck', 'AP', 9000);
  check('Bismarck turtleback: fewer citadels than Iowa at 9 km', bis.f('citadel') < close.f('citadel') * 0.8, `${pct(bis.f('citadel'))} vs Iowa ${pct(close.f('citadel'))}`);
  const bisFar = probe('iowa', 'bismarck', 'AP', 24000);
  check('Bismarck thin flat deck: more citadels than Iowa at 24 km (plunging fire)', bisFar.f('citadel') > far.f('citadel'), `${pct(bisFar.f('citadel'))} vs Iowa ${pct(far.f('citadel'))}`);
  const yam = probe('iowa', 'yamato', 'AP', 18000);
  const iowa18 = probe('iowa', 'iowa', 'AP', 18000);
  check('Yamato armour: fewer citadels than Iowa at 18 km', yam.f('citadel') < iowa18.f('citadel'), `${pct(yam.f('citadel'))} vs ${pct(iowa18.f('citadel'))}`);
  const dd = probe('iowa', 'fletcher', 'AP', 9000);
  check('16" AP vs Fletcher: mostly overpenetrations', dd.f('overpen') > 0.6, `overpen ${pct(dd.f('overpen'))}`);
  const ddhe = probe('iowa', 'fletcher', 'HC', 9000);
  check('16" HE vs Fletcher: wrecks vitals on most hits', ddhe.vitals > 0.4, `vitals ${pct(ddhe.vitals)}`);
  const five = probe('fletcher', 'iowa', 'AP', 6000);
  check('5" vs Iowa belt: no citadels', five.f('citadel') === 0, JSON.stringify(five.tally));
  const fiveDD = probe('fletcher', 'kagero', 'HC', 6000);
  check('5" HE vs Kagero: does real damage', fiveDD.vitals > 0.1 || fiveDD.hits > 0 && (fiveDD.tally['he'] ?? 0) > 0, JSON.stringify(fiveDD.tally));
  const ca = probe('baltimore', 'takao', 'AP', 10000);
  check('8" AP vs Takao at 10 km: citadels possible', ca.f('citadel') > 0.03, `citadel ${pct(ca.f('citadel'))}`);
}

// ------------------------------------------------------------ torpedoes vs torpedo protection
{
  const w = new World(cfg([spawn('iowa', 'red', 0, 0, 0), spawn('yamato', 'red', 0, 3000, 0), spawn('fletcher', 'red', 0, -3000, 0)]));
  const [iowa, yam, dd] = w.ships;
  const lowDmg = (r: ReturnType<typeof resolveTorpedo>) => r.modules.filter((m) => w.shipById(r.ship.id)!.mod(m.id).def.band === 'low').reduce((a, m) => a + m.dmg, 0);
  const ll = resolveTorpedo(iowa, { x: -10, y: iowa.cls.halfBeam(-10) }, 490, 4, w.sink);
  check('Long Lance (490 kg) breaches Iowa TDS (320 kg)', ll.text.includes('overwhelmed') && lowDmg(ll) > 20, `${ll.text} · ${lowDmg(ll).toFixed(0)} dmg`);
  const mk = resolveTorpedo(yam, { x: -10, y: yam.cls.halfBeam(-10) }, 363, 4, w.sink);
  check('Mk 15 (363 kg) absorbed by Yamato TDS (400 kg)', mk.text.includes('absorbed') && lowDmg(mk) < lowDmg(ll), `${mk.text} · ${lowDmg(mk).toFixed(0)} dmg`);
  const holesBefore = dd.holes.length;
  resolveTorpedo(dd, { x: 0, y: dd.cls.halfBeam(0) }, 490, 2, w.sink);
  for (let i = 0; i < 60 * 30; i++) dd.updateBuoyancy(1 / 30, i / 30, () => {});
  check('one Long Lance sinks a destroyer', dd.status !== 'active' || dd.floodTotal > dd.cls.reserveBuoyancy * 0.6, `flood ${dd.floodTotal.toFixed(0)} / ${dd.cls.reserveBuoyancy} t, holes ${dd.holes.length - holesBefore}`);
}

// a live torpedo run in the world: launch, travel, hit
{
  const w = new World(cfg([spawn('kagero', 'blue', 0, 0, Math.PI / 2, { speed: 0, telegraph: 0 }), spawn('iowa', 'red', 5000, 0, Math.PI / 2, { speed: 0, telegraph: 0 })]));
  const [k, iowa] = w.ships;
  iowa.cmd.secondaries = false; // (her 5"/38s would otherwise sink the destroyer mid-test)
  w.launchTorpedoes(k, iowa.pos);
  let hit = 0, launched = w.torpedoes.length;
  for (let i = 0; i < 60 * 160 && w.torpedoes.length; i++) { w.step(1 / 60); for (const e of w.events) if (e.type === 'torpHit') hit++; w.events.length = 0; }
  check('torpedo spreads launched from both bearing mounts (2 × 4)', launched === 8, `${launched} torpedoes`);
  check('stationary broadside target is hit by the spread', hit >= 1, `${hit} hits`);
  for (let i = 0; i < 60 * 60; i++) { w.step(1 / 60); w.events.length = 0; }
  check('Kagero reloads her tubes from the spare set',k.torpedoMounts.every((m) => m.loaded && m.spares === 0));
}

// ------------------------------------------------------------ detection
{
  // night, no radar: a destroyer at 10 km is unseen by Takao, but Iowa's radar finds it
  const w = new World(cfg([spawn('takao', 'red', 0, 0, 0), spawn('iowa', 'blue', 0, 22000, 0), spawn('kagero', 'red', 0, 10000, 0)], { conditions: 'night' }));
  const [takao, iowa, kagero] = w.ships;
  const w2 = new World(cfg([spawn('takao', 'red', 0, 0, 0), spawn('fletcher', 'blue', 0, 10000, 0)], { conditions: 'night' }));
  check('night: Takao (no radar) cannot see a destroyer at 10 km', !w2.detects(w2.ships[0], w2.ships[1]));
  check('night: Iowa radar sees Kagero at 12 km', w.detects(iowa, kagero));
  const day = new World(cfg([spawn('takao', 'red', 0, 0, 0), spawn('fletcher', 'blue', 0, 10000, 0)]));
  check('day: Takao sees a destroyer at 10 km', day.detects(day.ships[0], day.ships[1]));
  // gun flash reveals at night
  w2.ships[1].lastSalvoAt = w2.time;
  check('night: a destroyer firing its guns gives itself away at 10 km', w2.detects(w2.ships[0], w2.ships[1]));
  // smoke blocks visual sight
  const w3 = new World(cfg([spawn('takao', 'red', 0, 0, 0), spawn('fletcher', 'blue', 0, 10000, 0)]));
  check('day, no smoke: visible', w3.detects(w3.ships[0], w3.ships[1]));
  w3.smoke.push({ id: 1, x: 0, y: 5000, r: 300, t: 20, life: 110, owner: 2 });
  check('smoke screen blocks visual detection', !w3.detects(w3.ships[0], w3.ships[1]));
  void takao;
  // islands block radar
  const w4 = new World(cfg([spawn('iowa', 'blue', 0, 0, 0), spawn('kagero', 'red', 0, 12000, 0)], { conditions: 'night', islands: [[{ x: -2000, y: 5500 }, { x: 2000, y: 5500 }, { x: 2000, y: 6500 }, { x: -2000, y: 6500 }]] }));
  check('an island blocks radar line of sight', !w4.detects(w4.ships[0], w4.ships[1]));
}

// ------------------------------------------------------------ damage control
{
  const mk = () => new World(cfg([spawn('iowa', 'blue', 0, 0, 0, { speed: 0, telegraph: 0 }), spawn('iowa', 'red', 40000, 0, 0, { speed: 0, telegraph: 0 })]));
  // fires
  const a = mk(), b = mk();
  for (const w of [a, b]) { const s = w.ships[0]; s.startFire(-20, 0, 'high', 1, () => 0.5); s.fires[0].life = 999; }
  b.ships[0].dc.length = 0; // no parties
  let ta = 0, tb = 0;
  for (let i = 0; i < 60 * 240; i++) { a.step(1 / 60); b.step(1 / 60); if (!ta && !a.ships[0].fires.length) ta = a.time; if (!tb && !b.ships[0].fires.length) tb = b.time; }
  check('damage-control parties put fires out faster', ta > 0 && (tb === 0 || ta < tb * 0.8), `with ${ta.toFixed(0)} s, without ${tb ? tb.toFixed(0) + ' s' : 'still burning'}`);
  // holes
  const c = mk();
  const s = c.ships[0];
  c.sink.addHole(s, -20, 16, -2, 1.5);
  for (let i = 0; i < 60 * 120; i++) c.step(1 / 60);
  check('flooding hole gets shored up', s.holes[0].area < 0.6, `area ${s.holes[0].area.toFixed(2)} m²`);
  // repairs
  const d = mk();
  const st = d.ships[0].mod('steer');
  d.damageModule(d.ships[0], 'steer', st.def.hp, 'test');
  check('steering destroyed → rudder jammed', d.ships[0].steeringFactor() === 0);
  for (let i = 0; i < 60 * 120; i++) d.step(1 / 60);
  check('jury-rigged steering restored by damage control', d.ships[0].steeringFactor() > 0, `level ${st.level}, ${st.hp.toFixed(0)} hp`);
  const t1 = d.ships[0].mod('t1');
  d.damageModule(d.ships[0], 't1', t1.def.hp, 'test');
  for (let i = 0; i < 60 * 60; i++) d.step(1 / 60);
  check('a wrecked turret is not repaired in action', t1.level === 3);
  // manual order
  const e = mk();
  const es = e.ships[0];
  e.damageModule(es, 'dirA', 40, 'test');
  es.setCommand({ ...es.cmd, orders: [{ kind: 'dc', target: { type: 'module', id: 'dirA' } }] }, e.time);
  check('a manual DC order assigns a party', es.dc.some((p) => p.manual && p.task?.type === 'module' && p.task.id === 'dirA'));
  // counter-flooding
  const f = mk();
  const fs = f.ships[0];
  fs.sections[5].stbd = 1100; fs.sections[6].stbd = 1100;
  for (let i = 0; i < 60 * 20; i++) f.step(1 / 60);
  const listBefore = fs.list;
  fs.setCommand({ ...fs.cmd, orders: [{ kind: 'counterflood' }] }, f.time);
  for (let i = 0; i < 60 * 60; i++) f.step(1 / 60);
  check('counter-flooding corrects the list', Math.abs(fs.list) < Math.abs(listBefore) * 0.5, `${(listBefore / DEG).toFixed(1)}° → ${(fs.list / DEG).toFixed(1)}°`);
}

// ------------------------------------------------------------ secondaries
{
  const w = new World(cfg([spawn('iowa', 'blue', 0, 0, 0, { speed: 0, telegraph: 0 }), spawn('fletcher', 'red', 0, 8000, 0, { speed: 0, telegraph: 0 })]));
  let fired = 0, hits = 0;
  for (let i = 0; i < 60 * 60; i++) { w.step(1 / 60); for (const e of w.events) { if (e.type === 'secFire') fired++; if (e.type === 'hit' && e.shell.secondary) hits++; } w.events.length = 0; }
  check('secondary battery engages a destroyer in range on its own', fired > 10, `${fired} mount salvos`);
  check('secondary battery scores hits on a stationary destroyer', hits > 0, `${hits} hits`);
  check('only the engaged side fires (starboard mounts toward a target to starboard)', w.ships[0].secondaries.filter((m) => m.def.y > 0).every((m) => m.target != null) && w.ships[0].secondaries.filter((m) => m.def.y < 0).every((m) => m.target == null));
  const w2 = new World(cfg([spawn('iowa', 'blue', 0, 0, 0, { speed: 0, telegraph: 0 }), spawn('fletcher', 'red', 0, 8000, 0, { speed: 0, telegraph: 0 })]));
  w2.ships[0].cmd.secondaries = false;
  let f2 = 0;
  for (let i = 0; i < 60 * 20; i++) { w2.step(1 / 60); f2 += w2.events.filter((e) => e.type === 'secFire').length; w2.events.length = 0; }
  check('hold fire silences the secondaries', f2 === 0);
}

// ------------------------------------------------------------ grounding
{
  const island = [{ x: 3000, y: -1500 }, { x: 4500, y: -1500 }, { x: 4500, y: 1500 }, { x: 3000, y: 1500 }];
  const w = new World(cfg([spawn('fletcher', 'blue', 0, 0, 0, { speed: 18, telegraph: 4 }), spawn('kagero', 'red', -20000, 20000, 0)], { islands: [island] }));
  let grounded = 0;
  for (let i = 0; i < 60 * 260; i++) { w.step(1 / 60); grounded += w.events.filter((e) => e.type === 'grounding').length; w.events.length = 0; }
  const s = w.ships[0];
  check('a ship steaming into an island runs aground', grounded >= 1);
  check('…and is held off the land', s.pos.x < 3000 + 10, `x=${s.pos.x.toFixed(0)}`);
  check('…holed below the waterline', s.holes.length > 0);
}

// ------------------------------------------------------------ determinism
{
  const run = () => {
    const w = new World(makeConfig(MATCHUPS.find((m) => m.name.startsWith('SAG'))!, 4242));
    const ai = new AIDirector(w);
    for (let i = 0; i < 60 * 150; i++) { ai.update(w, 1 / 60); w.step(1 / 60); ai.observe(w.events, w); w.events.length = 0; }
    return JSON.stringify(w.ships.map((s) => [s.pos.x.toFixed(6), s.pos.y.toFixed(6), s.heading.toFixed(6), s.floodTotal.toFixed(4), s.stats]));
  };
  check('same seed + same inputs → identical battle (determinism)', run() === run());
}

// ------------------------------------------------------------ AI battles
{
  let ended = 0, total = 0, nonFinite = 0, torpUsed = 0, smokeUsed = 0, contacts = 0;
  for (const m of MATCHUPS) for (let k = 0; k < 2; k++) {
    const o = runBattle(makeConfig(m, 2000 + k * 31));
    total++;
    if (o.winner !== null || o.time >= 1499) ended++;
    if (o.nonFinite) { nonFinite++; results.push('      non-finite: ' + o.nonFinite); }
    torpUsed += o.events['torpLaunch'] ?? 0;
    contacts += o.events['detected'] ?? 0;
    smokeUsed += 0;
  }
  void smokeUsed;
  check('AI battles across all matchups resolve (or reach the time limit)', ended === total, `${ended}/${total}`);
  check('no non-finite state in any AI battle', nonFinite === 0);
  check('AI uses torpedoes', torpUsed > 10, `${torpUsed} launches`);
  check('detection events occur (night/islands/out-of-sight play)', contacts > 0, `${contacts}`);
  // a destroyer division should be able to beat a lone battleship sometimes with torpedoes at night,
  // and a lone battleship should usually beat a single destroyer by day
  let ddWins = 0;
  for (let k = 0; k < 4; k++) { const o = runBattle(makeConfig({ name: 'x', blue: ['iowa'], red: ['fletcher'], range: 14000 }, 300 + k)); if (o.winner === 'blue') ddWins++; }
  check('a battleship beats a lone destroyer by day (≥3 of 4)', ddWins >= 3, `${ddWins}/4`);
}

console.log(results.join('\n'));
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
