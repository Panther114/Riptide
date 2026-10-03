// Raw input collection. Edge-triggered events are consumed once per frame.

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouse = { x: window.innerWidth / 2, y: window.innerHeight / 3, inside: true };
  buttons = [false, false, false];
  clicked = [false, false, false];
  wheel = 0;
  private el: HTMLElement;
  enabled = true;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = [false, false, false]; });
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    el.addEventListener('mousedown', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button <= 2) { this.buttons[e.button] = true; this.clicked[e.button] = true; }
      if (e.button === 1) e.preventDefault(); // no autoscroll
    });
    window.addEventListener('mouseup', (e) => { if (e.button <= 2) this.buttons[e.button] = false; });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 || 1); e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('auxclick', (e) => e.preventDefault());
  }

  down(code: string) { return this.enabled && this.keys.has(code); }
  hit(code: string) { return this.enabled && this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.clicked = [false, false, false];
    this.wheel = 0;
  }
}
