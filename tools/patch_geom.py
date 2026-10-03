p = 'src/sim/shipClass.ts'
s = open(p, encoding='utf-8').read()
a = s.index("  zones: [")
b = s.index("  shells: {")
new = '''  // Positions follow the ship's frame plan: 4 ft frames, Frame 0 just aft of the stem,
  // citadel Frames 50-166, machinery Frames 87-151 in eight 8-frame rooms (crew handbook).
  zones: [
    // bow: no belt forward of the citadel, splinter plating only
    { x0: FR(50), x1: 136, belt: 38, beltIncline: 0, beltTop: 3.2, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 38, weatherDeck: 38, citadel: false },
    // citadel: 12.1 in belt inclined 19 deg, tapering lower belt, 1.5 in bomb deck + 6 in armour deck
    { x0: FR(87), x1: FR(50), belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    { x0: FR(151), x1: FR(87), belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    { x0: FR(166), x1: FR(151), belt: 307, beltIncline: 19 * D, beltTop: 3.2, beltBottom: -2.6, lowerBelt: 165, upperSide: 38, deck: 152, weatherDeck: 38, citadel: true },
    // between the citadel and the steering gear: unarmoured side, protective deck only
    { x0: FR(187), x1: FR(166), belt: 38, beltIncline: 0, beltTop: 2.5, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 64, weatherDeck: 38, citadel: false },
    // steering gear box (13.5 in sides, 6.2 in roof)
    { x0: FR(203), x1: FR(187), belt: 343, beltIncline: 0, beltTop: 2.0, beltBottom: -3.5, lowerBelt: 120, upperSide: 25, deck: 158, weatherDeck: 38, citadel: true },
    // stern overhang
    { x0: -136, x1: FR(203), belt: 25, beltIncline: 0, beltTop: 2.5, beltBottom: -3, lowerBelt: 25, upperSide: 25, deck: 38, weatherDeck: 38, citadel: false },
  ],
  modules: [
    { id: 'mag1', name: 'Turret I Magazines', short: 'MAG I', kind: 'magazine', rect: inner(FR(67), FR(51)), band: 'low', hp: 110, turret: 't1', zTop: -2.4 },
    { id: 'mag2', name: 'Turret II Magazines', short: 'MAG II', kind: 'magazine', rect: inner(FR(86), FR(67)), band: 'low', hp: 110, turret: 't2', zTop: -2.4 },
    { id: 'mag3', name: 'Turret III Magazines', short: 'MAG III', kind: 'magazine', rect: inner(FR(165), FR(151)), band: 'low', hp: 110, turret: 't3', zTop: -2.4 },
    { id: 'b1', name: 'No. 1 Fire Room', short: 'FR1', kind: 'boiler', rect: inner(FR(95), FR(87)), band: 'low', hp: 120 },
    { id: 'e1', name: 'No. 1 Engine Room', short: 'ER1', kind: 'engine', rect: inner(FR(103), FR(95)), band: 'low', hp: 130 },
    { id: 'b2', name: 'No. 2 Fire Room', short: 'FR2', kind: 'boiler', rect: inner(FR(111), FR(103)), band: 'low', hp: 120 },
    { id: 'e2', name: 'No. 2 Engine Room', short: 'ER2', kind: 'engine', rect: inner(FR(119), FR(111)), band: 'low', hp: 130 },
    { id: 'b3', name: 'No. 3 Fire Room', short: 'FR3', kind: 'boiler', rect: inner(FR(127), FR(119)), band: 'low', hp: 120 },
    { id: 'e3', name: 'No. 3 Engine Room', short: 'ER3', kind: 'engine', rect: inner(FR(135), FR(127)), band: 'low', hp: 130 },
    { id: 'b4', name: 'No. 4 Fire Room', short: 'FR4', kind: 'boiler', rect: inner(FR(143), FR(135)), band: 'low', hp: 120 },
    { id: 'e4', name: 'No. 4 Engine Room', short: 'ER4', kind: 'engine', rect: inner(FR(151), FR(143)), band: 'low', hp: 130 },
    { id: 'steer', name: 'Steering Gear Rooms', short: 'STEER', kind: 'steering', rect: r(FR(201), FR(189), -6.5, 6.5), band: 'low', hp: 90 },
    { id: 'bridge', name: 'Conning Tower & Bridge', short: 'CT', kind: 'bridge', rect: r(FR(85), FR(79), -4.2, 4.2), band: 'high', hp: 100 },
    { id: 'dirF', name: 'Forward Mk 38 Director', short: 'DIR F', kind: 'director', rect: r(13.5, 20.5, -3.6, 3.6), band: 'high', hp: 70 },
    { id: 'dirA', name: 'Aft Mk 38 Director', short: 'DIR A', kind: 'director', rect: r(-43.5, -37.5, -3.2, 3.2), band: 'high', hp: 70 },
    { id: 'fun1', name: 'Forward Stack', short: 'STK 1', kind: 'funnel', rect: r(1, 12, -3.6, 3.6), band: 'high', hp: 70 },
    { id: 'fun2', name: 'Aft Stack', short: 'STK 2', kind: 'funnel', rect: r(-28, -18, -3.3, 3.3), band: 'high', hp: 70 },
    { id: 't1', name: 'Turret I', short: 'I', kind: 'turret', rect: r(T1X - 7, T1X + 7, -7, 7), band: 'high', hp: 120 },
    { id: 't2', name: 'Turret II', short: 'II', kind: 'turret', rect: r(T2X - 7, T2X + 7, -7, 7), band: 'high', hp: 120 },
    { id: 't3', name: 'Turret III', short: 'III', kind: 'turret', rect: r(T3X - 7, T3X + 7, -7, 7), band: 'high', hp: 120 },
  ],
  turrets: [
    { id: 't1', name: 'Turret I', x: T1X, y: 0, facing: 0, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 13.5, barbetteRadius: 6.4,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag1' },
    { id: 't2', name: 'Turret II', x: T2X, y: 0, facing: 0, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 17.0, barbetteRadius: 6.4,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag2' },
    { id: 't3', name: 'Turret III', x: T3X, y: 0, facing: Math.PI, arc: 150 * D, traverseRate: 4.5 * D, guns: 3, radius: 7.2, height: 13.0, barbetteRadius: 6.4,
      armor: { face: 432, side: 241, rear: 305, roof: 184, barbette: 439 }, magazine: 'mag3' },
  ],
  sections: [
    { id: 's1', name: 'Bow', x0: 108, x1: 136, capacity: 1100 },
    { id: 's2', name: 'Forecastle', x0: FR(50), x1: 108, capacity: 2700 },
    { id: 's3', name: 'Turret I magazines', x0: FR(67), x1: FR(50), capacity: 2300 },
    { id: 's4', name: 'Turret II magazines', x0: FR(87), x1: FR(67), capacity: 2700 },
    { id: 's5', name: 'Fire & engine rooms 1', x0: FR(103), x1: FR(87), capacity: 2400 },
    { id: 's6', name: 'Fire & engine rooms 2', x0: FR(119), x1: FR(103), capacity: 2400 },
    { id: 's7', name: 'Fire & engine rooms 3', x0: FR(135), x1: FR(119), capacity: 2400 },
    { id: 's8', name: 'Fire & engine rooms 4', x0: FR(151), x1: FR(135), capacity: 2350 },
    { id: 's9', name: 'Turret III magazines', x0: FR(166), x1: FR(151), capacity: 2100 },
    { id: 's10', name: 'After compartments', x0: FR(187), x1: FR(166), capacity: 2300 },
    { id: 's11', name: 'Steering gear', x0: FR(203), x1: FR(187), capacity: 1300 },
    { id: 's12', name: 'Stern', x0: -136, x1: FR(203), capacity: 700 },
  ],
  structures: [
    { name: 'Conning tower', rect: r(FR(85), FR(79), -4.2, 4.2), height: 24, armor: 439, module: 'bridge', conning: true },
    { name: 'Forward superstructure', rect: r(-6, 30, -8.5, 8.5), height: 21, armor: 19 },
    { name: 'Forward fire-control tower', rect: r(12, 23, -4.5, 4.5), height: 38, armor: 38, module: 'dirF' },
    { name: 'Forward stack', rect: r(1, 12, -3.6, 3.6), height: 30, armor: 16, module: 'fun1' },
    { name: 'Aft stack', rect: r(-28, -18, -3.3, 3.3), height: 29, armor: 16, module: 'fun2' },
    { name: 'Aft superstructure', rect: r(-49, -14, -7.5, 7.5), height: 18, armor: 16 },
    { name: 'Aft director', rect: r(-43.5, -37.5, -3.2, 3.2), height: 25, armor: 38, module: 'dirA' },
    { name: '5in/38 battery (stbd)', rect: r(-40, 26, 9, 15.5), height: 12.5, armor: 64 },
    { name: '5in/38 battery (port)', rect: r(-40, 26, -15.5, -9), height: 12.5, armor: 64 },
  ],
'''
s = s[:a] + new + s[b:]
s = s.replace(
    "const r = (x0: number, x1: number, y0: number, y1: number): Rect => ({ x0, x1, y0, y1 });",
    """const r = (x0: number, x1: number, y0: number, y1: number): Rect => ({ x0, x1, y0, y1 });
/** Local x (m, + = forward) of hull frame f: 4 ft frames, Frame 0 is 4.5 m abaft the stem. */
export const FR = (f: number) => HALF - 4.5 - f * 1.2192;
/** Torpedo-defence system: four longitudinal bulkheads, ~5.6 m deep each side amidships. */
export const TDS_DEPTH = 5.6;
/** Vital space between the torpedo bulkheads over a frame range. */
const inner = (x0: number, x1: number): Rect => { const hb = Math.min(iowaHalfBeam(x0), iowaHalfBeam(x1)) - TDS_DEPTH; return { x0, x1, y0: -hb, y1: hb }; };
// barbette centres (frames ~59, ~76.5, ~158.5)
export const T1X = FR(59), T2X = FR(76.5), T3X = FR(158.5);""", 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
