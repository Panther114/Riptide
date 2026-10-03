// Smooth follow camera. Zoom is smoothed in log space; focus changes ease from
// the old view centre onto a (possibly moving) new focus with a smootherstep.

import { Vec2, clamp, damp, lerp } from '../core/math';

export const ZOOM_MIN = 0.018;   // px per metre — whole battlefield
export const ZOOM_MAX = 3.2;     // px per metre — close tactical view

export class Camera {
  x = 0; y = 0;
  zoom = 0.35;
  targetZoom = 0.35;
  w = 1; h = 1; dpr = 1;
  private trans: { from: Vec2; t: number; dur: number } | null = null;
  shake = 0;
  private shakeOff = { x: 0, y: 0 };
  lookAhead = { x: 0, y: 0 };

  resize(w: number, h: number, dpr: number) { this.w = w; this.h = h; this.dpr = dpr; }

  zoomBy(steps: number) {
    this.targetZoom = clamp(this.targetZoom * Math.pow(0.84, steps), ZOOM_MIN, ZOOM_MAX);
  }

  /** Begin a smooth transition to a new focus. */
  refocus() { this.trans = { from: { x: this.x, y: this.y }, t: 0, dur: 1.1 }; }

  update(dt: number, focus: Vec2, ahead: Vec2) {
    const lz = Math.log(this.zoom), tz = Math.log(this.targetZoom);
    this.zoom = Math.exp(lz + (tz - lz) * damp(9, dt));
    this.lookAhead.x += (ahead.x - this.lookAhead.x) * damp(2.2, dt);
    this.lookAhead.y += (ahead.y - this.lookAhead.y) * damp(2.2, dt);
    const fx = focus.x + this.lookAhead.x, fy = focus.y + this.lookAhead.y;
    if (this.trans) {
      this.trans.t += dt;
      const u = clamp(this.trans.t / this.trans.dur, 0, 1);
      const e = u * u * u * (u * (u * 6 - 15) + 10);
      this.x = lerp(this.trans.from.x, fx, e);
      this.y = lerp(this.trans.from.y, fy, e);
      if (u >= 1) this.trans = null;
    } else {
      this.x = fx; this.y = fy;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 9;
    this.shakeOff.x = (Math.random() - 0.5) * s;
    this.shakeOff.y = (Math.random() - 0.5) * s;
  }

  addShake(a: number) { this.shake = Math.min(1.2, Math.max(this.shake, a)); }

  get cx() { return this.x + this.shakeOff.x / this.zoom; }
  get cy() { return this.y + this.shakeOff.y / this.zoom; }

  worldToScreen(p: Vec2): Vec2 { return { x: (p.x - this.cx) * this.zoom + this.w / 2, y: (p.y - this.cy) * this.zoom + this.h / 2 }; }
  screenToWorld(p: Vec2): Vec2 { return { x: (p.x - this.w / 2) / this.zoom + this.cx, y: (p.y - this.h / 2) / this.zoom + this.cy }; }

  /** Apply the world transform to a 2D context (context is in CSS pixels * dpr). */
  apply(ctx: CanvasRenderingContext2D) {
    const z = this.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, (this.w / 2 - this.cx * this.zoom) * this.dpr, (this.h / 2 - this.cy * this.zoom) * this.dpr);
  }
}
