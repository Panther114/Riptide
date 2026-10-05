// Procedural sound: everything is synthesised with WebAudio (no samples), and
// attenuated/filtered by distance from the camera focus.

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noise!: AudioBuffer;
  private ambient: { g: GainNode; src: AudioBufferSourceNode } | null = null;
  private engine: { g: GainNode; o: OscillatorNode; f: BiquadFilterNode } | null = null;
  volume = 0.8;
  muted = false;

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // 3 s of brown-ish noise
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.035 * w) / 1.035; d[i] = last * 3.2 + w * 0.12; }
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); }

  private noiseSrc(rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise; s.playbackRate.value = rate;
    s.loop = true;
    return s;
  }

  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const ctx = this.ctx;
    const src = this.noiseSrc(0.6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.3;
    const g = ctx.createGain(); g.gain.value = 0.0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 2.5);
    this.ambient = { g, src };
    // engine/turbine rumble
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 110;
    const eg = ctx.createGain(); eg.gain.value = 0;
    o.connect(ef).connect(eg).connect(this.master);
    o.start();
    this.engine = { g: eg, o, f: ef };
  }

  stopAmbient() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.ambient) { this.ambient.g.gain.linearRampToValueAtTime(0, t + 0.8); const s = this.ambient.src; setTimeout(() => s.stop(), 1000); this.ambient = null; }
    if (this.engine) { this.engine.g.gain.linearRampToValueAtTime(0, t + 0.5); const o = this.engine.o; setTimeout(() => o.stop(), 700); this.engine = null; }
  }

  setEngine(power: number, speedFrac: number) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.o.frequency.setTargetAtTime(30 + speedFrac * 26, t, 0.5);
    this.engine.g.gain.setTargetAtTime(0.025 + speedFrac * 0.05 * power, t, 0.5);
  }

  /** distance attenuation: d in metres from listener, zoomFactor widens hearing when zoomed out */
  private att(d: number, ref = 1500) { return 1 / (1 + Math.pow(d / ref, 1.4)); }

  /** k: calibre scale (16" = 1): smaller guns bark higher, shorter and quieter. */
  gun(d: number, own: boolean, k = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.min(d / 2400, 3.5) * (own ? 0 : 1);
    const a = this.att(d, 3000 * Math.max(0.4, k)) * (own ? 1 : 0.8) * (0.35 + 0.65 * k);
    if (a < 0.01) return;
    const len = 0.45 + 0.55 * k, pitch = 1 / Math.max(0.35, k);
    // low thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70 * pitch, t); o.frequency.exponentialRampToValueAtTime(28 * pitch, t + 0.6 * len);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9 * a, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4 * len);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 1.5 * len);
    // blast body
    const n = this.noiseSrc((own ? 1 : 0.7) * Math.sqrt(pitch));
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime((own ? 2400 : 700) * Math.sqrt(pitch), t); f.frequency.exponentialRampToValueAtTime(140 * pitch, t + 1.8 * len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.1 * a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 * len);
    n.connect(f).connect(g).connect(this.master); n.start(t, Math.random() * 2); n.stop(t + 2.7 * len);
    // crack
    if (own) {
      const c = this.noiseSrc(2.5);
      const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 1500;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.5 * a, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      c.connect(cf).connect(cg).connect(this.master); c.start(t, Math.random()); c.stop(t + 0.2);
    }
  }

  splash(d: number, big = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const a = this.att(d, 1200) * 0.55 * big;
    if (a < 0.01) return;
    const n = this.noiseSrc(1.2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + 1.2); f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(f).connect(g).connect(this.master); n.start(t, Math.random() * 2); n.stop(t + 1.7);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.4 * a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.6);
  }

  hit(d: number, kind: string) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const a = this.att(d, 1600);
    if (a < 0.01) return;
    if (kind === 'nonpen' || kind === 'ricochet') {
      // metallic clang: inharmonic partials
      for (const [fr, dec] of [[420, 0.9], [697, 0.7], [1180, 0.5], [1730, 0.35]]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr * (0.95 + Math.random() * 0.1);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.18 * a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + dec + 0.05);
      }
      if (kind === 'ricochet') {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2400, t + 0.05); o.frequency.exponentialRampToValueAtTime(600, t + 0.7);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * a, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.8);
      }
      return;
    }
    const big = kind === 'magazine' ? 3 : kind === 'citadel' ? 1.6 : 1;
    const n = this.noiseSrc(0.8 / Math.sqrt(big));
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.5 * big);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.min(1.6, 1.1 * a * big), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 * big);
    n.connect(f).connect(g).connect(this.master); n.start(t, Math.random() * 2); n.stop(t + 2.3 * big);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(22, t + 1.2 * big);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9 * a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4 * big);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 1.5 * big);
  }

  /** incoming shell "freight train" rumble */
  incoming(d: number, dur: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const a = this.att(d, 500) * 0.35;
    if (a < 0.02) return;
    const n = this.noiseSrc(0.9);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(f).connect(g).connect(this.master); n.start(t, Math.random() * 2); n.stop(t + dur + 0.1);
  }

  /** Distance-independent confirmation that our salvo did harm. */
  confirm(strength: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140 + strength * 40, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 + strength * 0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
    const n = this.noiseSrc(1.6);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.06 * (1 + strength), t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f).connect(ng).connect(this.master); n.start(t, Math.random()); n.stop(t + 0.15);
  }

  ui(kind: 'click' | 'tick' | 'alarm' | 'ammo') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    if (kind === 'alarm') {
      o.type = 'square'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(520, t + 0.16);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.setValueAtTime(0.05, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.36);
      return;
    }
    o.type = 'triangle';
    o.frequency.value = kind === 'click' ? 900 : kind === 'ammo' ? 520 : 1300;
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.08);
  }
}
