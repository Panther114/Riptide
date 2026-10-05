# Riptide roadmap

## Status (October 2026)

Phases 0–2 are done. Riptide now has seven historical classes across three navies (Iowa,
Bismarck, Yamato, Baltimore, Takao, Fletcher, Kagero), secondary batteries, torpedoes with
torpedo-defence systems, smoke, visibility with radar and day/dusk/night, damage-control parties
and counter-flooding, islands and straits, role-based AI, a fixed-tick deterministic sim, and a
58-check headless test suite (`npm test`). See the README for the full feature list and sources.

Phases 3–4 remain. They are ordered by dependency, and each item names where the work happens.

---

## Done

### Phase 0: Foundation fixes
- Module lookups go by kind (`Ship.modsOf`), so no Iowa ids are hard-coded. Gun counts come from
  `TurretDef.guns`, and hull extents and art come from class data.
- Every gun has its own ballistics (`ShellDef.penRef`, `ballisticRange`).
- The sim is deterministic: seeded RNG everywhere and a fixed 60 Hz tick in `game.ts`. A test checks that two runs are identical.
- `npm test` runs the regression suite (`tools/test.ts`); `npm run matchups` prints the AI-vs-AI balance table.

### Phase 1: More ships
- Bismarck (turtleback, AP decapping), Yamato, Baltimore, Takao, Fletcher and Kagero, using NavWeaps,
  Okun and Wikipedia figures.
- A generic, data-driven art builder (`render/shipArt.ts`) with per-navy turret styles and liveries.
- A class picker on the title screen and per ship in Battle Setup, plus new presets.

### Phase 2: Combat depth
- Live secondary batteries.
- Torpedoes: spreads, fast/slow settings, TDS ratings, broken backs, deck explosions, and AI attack/evasion.
- Smoke screens.
- Sight and radar under three light conditions, with last-known markers.
- Damage-control parties: automatic, or sent by clicking the plan. Counter-flooding.
- Islands and a strait, with grounding, land blocking sight and radar, and AI land avoidance.

---

## Phase 3: Fleet command and game modes

- **Fleet orders**: let the player act as admiral, giving `TeamCommander` orders (line ahead,
  turn together, focus target, open range, torpedo attack). The doctrine layer already exists.
- **Historical scenarios**: Denmark Strait (Bismarck v Hood/Prince of Wales needs a British
  class), Second Guadalcanal (Washington v Kirishima), Surigao Strait, and Samar (Taffy 3's
  Fletchers v Yamato; the core ships already exist). Each is a `BattleConfig` with
  explicit `islands`, win conditions and briefing text.
- **Replays and kill-cam**: the sim is deterministic, so a replay is just `seed + command log`.
  Record `ShipCommand`s per tick in `game.ts` and play them back.
- **More classes**: the Royal Navy (King George V, Hood, a Tribal-class destroyer), light
  cruisers (Cleveland, Atlanta), and the 1944 Iowa/Yamato radar fits. Each is one data file.
- **Campaign/career**: a persistent ship, crew experience and refits between battles.

## Phase 4: Multiplayer

1. Determinism and the fixed tick are done.
2. A small Node WebSocket server runs `World` authoritatively. Clients send `ShipCommand`s
   (including `orders`) and receive snapshots plus events; the renderer interpolates. Visibility
   must be filtered per team on the server, which `World.visible` already computes.
3. Lobby networking: Battle Setup becomes shared state with seat claiming.

## Ongoing polish

- A settings screen: keybinds, graphics quality, UI scale, colour-blind team colours.
- Starshell and searchlights for night actions; rain squalls as moving visibility cells.
- An explicit choice of torpedo speed setting for the player (it is automatic now).
- A performance budget for 16+ ships (`tools/s_perf2.mjs`): a spatial grid for detection, shells and collisions.
- A tutorial mission covering angling, immune zones, AP vs HE, torpedo leads and smoke.
