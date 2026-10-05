# RIPTIDE — 2D WWII surface action

A top-down naval combat game: battleships, heavy cruisers and destroyers of the US, German and
Japanese navies, with a semi-realistic shell/armour/compartment simulation, torpedoes, smoke,
night and radar underneath arcade controls.

![](docs/screenshot.png)

## Running it

| | |
|---|---|
| **Quick start (Windows)** | double-click `quickrun.bat` → frees port 47823, starts the dev server, opens http://localhost:47823 (`quickrun.bat noopen` skips the browser) |
| **Just play** | open `dist/index.html` in Chrome / Edge / Firefox (single self-contained file, works offline from disk) |
| **Develop** | `npm install` then `npm run dev` → http://localhost:5173 |
| **Build** | `npm run build` → `dist/index.html` |
| **Test** | `npm test` (58 headless simulation checks) · `npm run matchups -- 4` (AI-vs-AI balance table) |
| **Serve a build** | `npm run build` then `npm start` → http://localhost:8080 (or `$PORT`) |
| **Docker** | `docker build -t riptide .` then `docker run -p 8080:8080 riptide` |

## Deploying to Railway

The repo deploys to [Railway](https://railway.com) with no settings to fill in. `railway.json` points Railway at
the `Dockerfile`, which builds the game and serves it with a small dependency-free Node server (`server.mjs`)
with brotli/gzip compression and a `/healthz` health check.

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick this repository.
2. When the first deploy finishes, open the service's **Settings → Networking → Generate Domain**.

Railway sets `PORT` itself. Every push to the default branch redeploys.

## Ships

| Class | Type | Main battery | Protection | Special |
|---|---|---|---|---|
| **Iowa** (US, 1943) | BB | 9 × 16"/50 Mk 7 | 307 mm belt @ 19°, 152 mm deck | 20 × 5"/38, SG radar, 32.5 kn |
| **Bismarck** (DE, 1940) | BB | 8 × 38 cm SK C/34 | 320 mm belt + 110 mm turtleback slope, 80–95 mm deck | 12 × 15 cm, FuMO 23 radar |
| **Yamato** (JP, 1945) | BB | 9 × 46 cm Type 94 | 410 mm belt @ 20°, 200–230 mm deck, 650 mm turret faces | 2°/s turrets, 40 s reload, 27 kn |
| **Baltimore** (US, 1943) | CA | 9 × 8"/55 (335 lb SH AP) | 152 mm belt, 64 mm deck | 12 × 5"/38, SG radar |
| **Takao** (JP, 1942) | CA | 10 × 20.3 cm | 102–127 mm belt, 25 mm gunhouses | 16 × Type 93 tubes + reload, no radar |
| **Fletcher** (US, 1942) | DD | 5 × 5"/38 | none | 10 × Mk 15 (fast/slow settings), SG radar, smoke |
| **Kagero** (JP, 1941) | DD | 6 × 12.7 cm | none | 8 × Type 93 "Long Lance" + 8 reloads, smoke |

Every class is pure data in `src/sim/classes/` — hull curve, armour zones, modules, turrets,
secondary mounts, torpedo mounts, watertight sections, superstructure and an art description —
and the simulation, the procedural artwork and the damage-control plan are all built from it.

## Controls

| Input | Action |
|---|---|
| `W` / `S` | Engine telegraph up / down (Full Astern … Stop … Full Ahead) |
| `A` / `D` (hold) | Rudder to port / starboard; released, it returns amidships |
| Mouse | Requested fall-of-shot point (or torpedo aim) |
| `LMB` | Fire every turret that is loaded and on bearing (hold to ripple) · in torpedo mode: launch |
| `1` / `2` | Load AP / HC for the next reload |
| `T` | Guns ↔ torpedoes (cruisers & destroyers) |
| `X` | Smoke generators on/off (destroyers) |
| `G` | Secondary battery weapons-free / hold fire |
| `C` | Counter-flood to correct a list |
| Click the damage-control plan | Send a repair party to that compartment (right-click: back to automatic) |
| Wheel | Zoom from close tactical view to the whole battle area |
| `MMB` | On a ship: lock camera on it · drag: pan |
| `V` | Damage-control diagram ↔ armour scheme |
| `Tab` | Fleet battles: take command of the next ship of your side |
| `H` · `M` · `Esc` | Controls hint · mute · pause |

## What is simulated

**Ballistics.** Striking velocity, angle of fall and penetration follow the shape of the real
16"/50 Mk 8 curves; every other gun reuses them on an "equivalent range" scaled by its own
maximum range, with muzzle penetration back-solved from NavWeaps tables (38 cm: 510 mm at 10 km,
46 cm: 494 mm at 18.3 km, 8" Mk 21: 254 mm at 9.9 km — all checked by `npm test`). Time of flight
is compressed ~2× for pace. Dispersion is a 2D normal distribution that grows with range, yaw,
swinging the aim, director damage and list; the ellipses at the cursor are its 50 % / 90 % contours.

**Armour.** Each shell is traced in 3D through superstructure, turrets (face/side/rear/roof/barbette),
upper side, belt, lower belt, weather deck and the armoured deck. Obliquity combines fall angle,
belt incline and hull curvature; AP caps normalise; high obliquity ricochets; thin plates are
overmatched. A heavy belt strips the AP cap, so on **Bismarck** the bare shell then meets the 110 mm
slope at a glancing angle and usually bounces — near-immune at close range, weak (80–95 mm flat
deck) against plunging fire. Big-gun AP passes straight through an unarmoured destroyer without
arming its fuze; HE wrecks it.

**Torpedoes.** Spreads run as real entities at game-doubled speed; they hit where they cross a hull.
Battleship torpedo-defence systems absorb a rated charge (Iowa 320 kg, Bismarck 250, Yamato 400):
within it only the outer voids flood; beyond it the blast breaks into the machinery and magazines.
A torpedo floods every compartment its blast spans, and can break a destroyer's back. The Type 93
runs 20 km almost wakeless; the Mk 15 runs 5.5 km at 45 kn, or 13.7 km on its slow setting (chosen
automatically by aim distance). Loaded tubes on a wrecked mount can detonate on deck.

**Secondary batteries.** Dual-purpose mounts are live: each picks the nearest visible enemy in its
arc and range, leads it, and fires on its own with its own dispersion; wrecking the battery group
silences it.

**Sight, radar, smoke, terrain.** A side only sees what one of its ships can see: visual range by
light (day ~26 km for a battleship, dusk half, night ~7 km) × target size (destroyers ~0.55), with
gun flashes and fires giving ships away; surface radar (US SG, FuMO 23, Type 22) sees through
darkness and smoke but not land, and dies with the main director. Smoke screens block sight lines.
Islands and coastlines block radar and sight, end torpedo runs, take the shells that land on them,
and running aground holes the bottom. Ships out of sight leave a last-known-position marker.

**Consequences & damage control.** Machinery → power → speed; steering damaged → slow or jammed
rudder; directors → dispersion and radar; bridge → delayed helm; turrets lose guns; holes below
the current waterline flood their section through an orifice-flow model; the ship settles, trims
and lists. Damage-control parties (BB 3–4, CA 2, DD 1) fight fires, shore holes, pump and patch
machinery automatically by priority, or where the captain sends them; turrets and magazines cannot
be repaired in action. Counter-flooding trades buoyancy for an even keel. A ship is **out of
action** when sunk, blown up, broken in two, her weapons silenced, or crippled.

**AI.** A `TeamCommander` per side assigns targets (destroyers go for the heavy ships) and sets
doctrine from relative strength; a `CaptainAI` per ship fights by role: battleships and cruisers
angle the belt and work the range band, destroyers run in on an intercept course weaving and under
smoke, launch on a computed intercept solution and retire to reload. Every captain only engages what
its side can see, walks salvos on by spotting (correcting for salvos still in the air), combs
visible torpedo tracks, counter-floods, and steers clear of land.

## Architecture

```
src/
  sim/          pure simulation — no DOM. World, Ship, damage model, ballistics, terrain
    classes/    one data file per ship class
  ai/           TeamCommander + CaptainAI (produce ShipCommands like any other controller)
  render/       WebGL water + 2D canvas world renderer, procedural ship art, particles, camera
  ui/           HUD (DOM + canvas gauges), damage-control plan, menus/lobby
  audio/        fully procedural WebAudio sound
  game.ts       glue: input → commands, fixed-tick sim → events → presentation
```

- Every ship is driven only through a `ShipCommand` (helm, aim, fire, ammo, torpedo, smoke,
  secondaries, and one-shot damage-control orders). The local player, the AI, or later a network
  peer all produce the same structure.
- The sim steps at a fixed 60 Hz with a seeded RNG, so the same seed and inputs reproduce a battle
  exactly (`npm test` checks this) — the basis for replays and lockstep multiplayer.
- A battle is a `BattleConfig`: ships, light (`day`/`dusk`/`night`), waters (`open`/`islands`/
  `strait`, or explicit island outlines). The **Battle Setup** screen is a lobby prototype: pick each
  ship's class, drag ships on the map, set course, assign teams, choose who you command, light and
  waters, with presets for battleship duels, surface action groups, destroyer melee, a night torpedo
  attack and the strait.

## Tools

`tools/` holds the headless harnesses: `test.ts` (`npm test`), `matchups.ts` (AI-vs-AI table),
`pentest.ts` (armour probe), `why.ts`, `tracks.ts`, and Playwright scripts
(`node tools/shot.mjs <url> <script> <out.png>`, e.g. `tools/s_phase2.mjs`) that drive the built game
in a background headless Chrome or Edge.

## Sources

NavWeaps gun pages (16"/50 Mk 7, 38 cm/52 SK C/34, 46 cm/45 Type 94, 8"/55 Mk 12/15, 20 cm/50
3rd Year No. 2, 5"/38 Mk 12); N. Okun, *Armor protection of KM Bismarck* (combinedfleet.com);
Navy General Board, *Yamato class armor*; Wikipedia articles on the Bismarck, Yamato, Baltimore,
Takao, Fletcher and Kagerō classes, the Type 93 and Mark 15 torpedoes, and WWII radar; NavWeaps /
combinedfleet radar summaries.
