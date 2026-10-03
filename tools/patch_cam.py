p='src/input/input.ts'
s=open(p).read()
s=s.replace("  wheel = 0;\n","  wheel = 0;\n  /** middle-button drag (px since last frame) and a click that did not drag */\n  midDrag = { x: 0, y: 0 };\n  midClick = false;\n  private midDown: { x: number; y: number; moved: number } | null = null;\n",1)
s=s.replace("window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });",
"window.addEventListener('mousemove', (e) => { if (this.midDown) { const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y; this.midDrag.x += dx; this.midDrag.y += dy; this.midDown.moved += Math.abs(dx) + Math.abs(dy); } this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });")
s=s.replace("if (e.button === 1) e.preventDefault(); // no autoscroll","if (e.button === 1) { e.preventDefault(); this.midDown = { x: e.clientX, y: e.clientY, moved: 0 }; } // no autoscroll")
s=s.replace("window.addEventListener('mouseup', (e) => { if (e.button <= 2) this.buttons[e.button] = false; });","window.addEventListener('mouseup', (e) => { if (e.button <= 2) this.buttons[e.button] = false; if (e.button === 1 && this.midDown) { if (this.midDown.moved < 6) this.midClick = true; this.midDown = null; } });")
s=s.replace("    this.wheel = 0;\n  }","    this.wheel = 0;\n    this.midDrag.x = 0; this.midDrag.y = 0;\n    this.midClick = false;\n  }")
open(p,'w').write(s)
p='src/game.ts'
s=open(p).read()
s=s.replace("      if (inp.clicked[1]) this.pickLock(cam.screenToWorld(inp.mouse));","      if (inp.midClick) this.pickLock(cam.screenToWorld(inp.mouse));\n      if (inp.midDrag.x || inp.midDrag.y) { this.pan.x -= inp.midDrag.x / cam.zoom; this.pan.y -= inp.midDrag.y / cam.zoom; }")
s=s.replace("    cam.update(dtReal, focus, { x: 0, y: 0 });","    cam.update(dtReal, { x: focus.x + this.pan.x, y: focus.y + this.pan.y }, { x: 0, y: 0 });")
s=s.replace("  timeScale = 1;\n","  timeScale = 1;\n  /** free-look offset from the focused ship (middle-drag) */\n  pan = { x: 0, y: 0 };\n",1)
s=s.replace("""    const prev = this.lockId;
    this.lockId = best && best.id !== this.playerId ? best.id : null;
    if (prev !== this.lockId) { cam.refocus(); this.audio.ui('click'); }""","""    // empty water: keep the current view; own ship: back to following it; other ship: lock on
    if (!best) return;
    this.lockId = best.id !== this.playerId ? best.id : null;
    this.pan = { x: 0, y: 0 };
    cam.refocus(); this.audio.ui('click');""")
s=s.replace("    this.lockId = null;\n    this.paused = false;","    this.lockId = null;\n    this.pan = { x: 0, y: 0 };\n    this.paused = false;")
open(p,'w').write(s)
p='src/ui/hud.ts'
s=open(p).read()
s=s.replace("<b>MMB</b> lock camera","<b>MMB</b> drag pan · click ship lock")
open(p,'w').write(s)
