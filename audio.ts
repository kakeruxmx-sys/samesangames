// Fully synthesized, original audio (no sample files, nothing copyrighted). WebAudio with HRTF 3D panning,
// distance attenuation, ambience (wind/rain/drone), randomized horror cues, heartbeat and killer-proximity changes.
export type Snd = string;

export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode; sfxBus!: GainNode; ambBus!: GainNode; musicBus!: GainNode;
  noise!: AudioBuffer;
  volume = 0.8;
  private ambNodes: { wind?: GainNode; rain?: GainNode; drone?: GainNode; droneF?: BiquadFilterNode; windF?: BiquadFilterNode; tense?: GainNode } = {};
  private musicOn = false; private musicTimer: number | null = null;
  private hbT = 0; private terror = 0; private distort = 0;
  private lastCue = 0; private lastScare = 0; private quietUntil = 0;
  private nodesAlive = 0;
  muted = false;

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {}); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
    comp.connect(this.master);
    this.sfxBus = ctx.createGain(); this.ambBus = ctx.createGain(); this.musicBus = ctx.createGain();
    this.sfxBus.connect(comp); this.ambBus.connect(comp); this.musicBus.connect(comp);
    this.ambBus.gain.value = 0; this.musicBus.gain.value = 0.5;
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; // pink-ish noise
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }

  // ---------------------------------------------------------------- listener
  setListener(x: number, y: number, z: number, yaw: number) {
    const c = this.ctx; if (!c) return;
    const L = c.listener as any;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    if (L.positionX) {
      const t = c.currentTime;
      L.positionX.setTargetAtTime(x, t, 0.02); L.positionY.setTargetAtTime(y, t, 0.02); L.positionZ.setTargetAtTime(z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(0, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(0, t, 0.02); L.upY.setTargetAtTime(1, t, 0.02); L.upZ.setTargetAtTime(0, t, 0.02);
    } else { L.setPosition?.(x, y, z); L.setOrientation?.(fx, 0, fz, 0, 1, 0); }
  }

  // ---------------------------------------------------------------- primitives
  private out(x: number | null, z: number | null, ref = 6, y = 1.2): AudioNode {
    const c = this.ctx!;
    if (x === null || z === null) return this.sfxBus;
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 80; p.rolloffFactor = 1.3;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.sfxBus);
    return p;
  }
  private env(g: GainNode, t0: number, a: number, d: number, peak: number) {
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  private nz(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, att = 0.005, f2?: number) {
    const c = this.ctx!; const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur); fl.Q.value = q;
    const g = c.createGain(); this.env(g, t0, att, dur, peak);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t0, Math.random() * 1.5); s.stop(t0 + att + dur + 0.05);
  }
  private tone(dest: AudioNode, t0: number, type: OscillatorType, f: number, f2: number, dur: number, peak: number, att = 0.005, detune = 0) {
    const c = this.ctx!; const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); if (f2 !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    o.detune.value = detune; const g = c.createGain(); this.env(g, t0, att, dur, peak);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + att + dur + 0.05);
  }

  /** positional one-shot sound. `v` is a 0..1 loudness hint from the server. */
  play(kind: Snd, x: number | null = null, z: number | null = null, v = 1) {
    const c = this.ctx; if (!c || this.muted || c.state !== 'running') return;
    if (this.nodesAlive > 90) return;
    this.nodesAlive++; setTimeout(() => { this.nodesAlive--; }, 1200);
    const t = c.currentTime + 0.005;
    const o = this.out(x, z, kind.startsWith('cast') || kind === 'gen_done' || kind === 'seal' ? 14 : 5);
    const vol = 0.5 * v;
    switch (true) {
      case kind === 'step': this.nz(o, t, 0.07, 'bandpass', 700 + Math.random() * 300, 1.4, 0.7 * vol); this.tone(o, t, 'sine', 120, 70, 0.07, 0.35 * vol); break;
      case kind === 'step_k': this.tone(o, t, 'sine', 80, 38, 0.2, 0.9 * vol); this.nz(o, t, 0.12, 'lowpass', 500, 0.7, 0.6 * vol); this.nz(o, t + 0.01, 0.05, 'highpass', 3000, 1, 0.12 * vol); break;
      case kind === 'scrape': this.tone(o, t, 'sawtooth', 160, 110, 0.18, 0.18 * vol); this.nz(o, t, 0.2, 'bandpass', 1200, 2, 0.25 * vol); break;
      case kind === 'transform': this.tone(o, t, 'sine', 300, 1400, 0.45, 0.35 * vol); this.tone(o, t + 0.05, 'triangle', 450, 1800, 0.4, 0.2 * vol); this.nz(o, t, 0.4, 'highpass', 4000, 1, 0.25 * vol, 0.02); break;
      case kind === 'untransform': this.tone(o, t, 'sine', 1300, 260, 0.35, 0.35 * vol); this.nz(o, t, 0.3, 'highpass', 3000, 1, 0.2 * vol); break;
      case kind === 'swing': this.nz(o, t, 0.22, 'bandpass', 600, 1.2, 0.8 * vol, 0.05, 2600); break;
      case kind === 'seal': this.tone(o, t, 'sine', 70, 28, 1.3, 1 * vol); this.tone(o, t, 'sawtooth', 200, 40, 1.0, 0.25 * vol); this.nz(o, t, 1.0, 'lowpass', 1800, 1, 0.4 * vol, 0.3, 200); break;
      case kind === 'sigil': for (const f of [740, 1110, 1480]) this.tone(o, t, 'sine', f, f, 1.2, 0.3 * vol); break;
      case kind === 'repair': this.tone(o, t, 'square', 230, 200, 0.06, 0.18 * vol); this.nz(o, t + 0.02, 0.05, 'highpass', 2500, 2, 0.25 * vol); this.tone(o, t + 0.17, 'square', 330, 250, 0.05, 0.14 * vol); break;
      case kind === 'gen_done': [261, 329, 392, 523].forEach((f, i) => this.tone(o, t + i * 0.1, 'triangle', f, f, 0.6, 0.3 * vol)); this.tone(o, t, 'sawtooth', 55, 55, 1.4, 0.2 * vol); break;
      case kind === 'rescue_work': this.nz(o, t, 0.3, 'bandpass', 900, 3, 0.2 * vol, 0.05); break;
      case kind === 'rescue': [392, 494, 587, 784].forEach((f, i) => this.tone(o, t + i * 0.08, 'sine', f, f, 0.8, 0.32 * vol)); break;
      case kind === 'gate_work': this.tone(o, t, 'sawtooth', 70, 60, 0.5, 0.35 * vol); this.nz(o, t, 0.5, 'lowpass', 400, 1, 0.4 * vol); break;
      case kind === 'gate_open': this.tone(o, t, 'sawtooth', 110, 220, 1.8, 0.4 * vol, 0.4); this.tone(o, t, 'sine', 220, 440, 1.8, 0.3 * vol, 0.4); this.nz(o, t, 1.6, 'bandpass', 500, 1, 0.3 * vol, 0.5, 2000); break;
      case kind === 'cast_echo0' || kind === 'cast_echo1' || kind === 'cast_echo2': { const f = kind === 'cast_echo0' ? 900 : kind === 'cast_echo1' ? 120 : 600; this.tone(o, t, 'sine', f, f * 2.2, 0.7, 0.5 * vol, 0.1); this.tone(o, t + 0.15, 'sine', f * 1.5, f * 3, 0.6, 0.3 * vol); break; }
      case kind.startsWith('cast_stitcher'): for (let i = 0; i < 4; i++) this.nz(o, t + i * 0.09, 0.04, 'highpass', 5000, 1.5, 0.35 * vol); this.tone(o, t + 0.3, 'triangle', 330, 210, 0.5, 0.2 * vol); break;
      case kind.startsWith('cast_mimic'): this.tone(o, t, 'sawtooth', 140, 90, 0.9, 0.3 * vol, 0.1, 40); this.tone(o, t, 'sawtooth', 143, 95, 0.9, 0.3 * vol, 0.1, -40); this.nz(o, t, 0.6, 'bandpass', 1100, 6, 0.3 * vol, 0.1); break;
      case kind.startsWith('cast_chronos'): for (let i = 0; i < 6; i++) this.tone(o, t + i * 0.12, 'square', 1800, 1800, 0.03, 0.18 * vol); this.nz(o, t + 0.2, 0.7, 'bandpass', 3000, 1, 0.3 * vol, 0.3, 300); break;
      case kind.startsWith('cast_lumen'): this.tone(o, t, 'sine', 48, 44, 1.5, 0.8 * vol, 0.3); this.nz(o, t, 1.2, 'highpass', 6000, 1, 0.12 * vol, 0.4); this.tone(o, t, 'triangle', 1200, 1250, 1.2, 0.08 * vol, 0.4); break;
      case kind === 'creak': { const f = 90 + Math.random() * 120; this.tone(o, t, 'sawtooth', f, f * (0.6 + Math.random() * 0.7), 0.5 + Math.random() * 0.6, 0.12 * vol, 0.15); this.nz(o, t, 0.7, 'bandpass', 400 + Math.random() * 500, 8, 0.1 * vol, 0.2); break; }
      case kind === 'thud': this.tone(o, t, 'sine', 60, 30, 0.35, 0.8 * vol); this.nz(o, t, 0.2, 'lowpass', 300, 1, 0.4 * vol); break;
      case kind === 'door': this.tone(o, t, 'sawtooth', 120, 80, 0.8, 0.14 * vol, 0.2); this.nz(o, t + 0.6, 0.12, 'lowpass', 400, 1, 0.5 * vol); break;
      case kind === 'buzz': this.tone(o, t, 'sawtooth', 100, 100, 0.2, 0.1 * vol); this.nz(o, t, 0.2, 'highpass', 3000, 1, 0.1 * vol); break;
      case kind === 'ui': this.tone(o, t, 'sine', 600, 600, 0.08, 0.25); break;
      case kind === 'ui_ok': this.tone(o, t, 'sine', 500, 800, 0.15, 0.3); break;
      case kind === 'alert': this.tone(o, t, 'square', 880, 880, 0.12, 0.2); this.tone(o, t + 0.16, 'square', 660, 660, 0.12, 0.2); break;
      case kind === 'win': [392, 494, 587, 784, 988].forEach((f, i) => this.tone(o, t + i * 0.14, 'triangle', f, f, 1.0, 0.3)); break;
      case kind === 'lose': [220, 196, 165, 110].forEach((f, i) => this.tone(o, t + i * 0.25, 'sawtooth', f, f * 0.97, 1.2, 0.2, 0.05)); this.tone(o, t, 'sine', 55, 40, 2.5, 0.5); break;
      case kind === 'scare': this.tone(o, t, 'sawtooth', 350, 90, 0.4, 0.5, 0.003); this.tone(o, t, 'sawtooth', 371, 95, 0.4, 0.5, 0.003); this.nz(o, t, 0.35, 'highpass', 2500, 1, 0.6, 0.003); break;
      case kind === 'hit': this.tone(o, t, 'sine', 90, 35, 0.3, 1 * vol); this.nz(o, t, 0.25, 'lowpass', 900, 1, 0.8 * vol); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- ambience + tension (game)
  startAmbience(theme: { rain: number; wind: number }) {
    const c = this.ctx; if (!c) return;
    this.stopAmbience();
    const mk = (type: BiquadFilterType, f: number, q: number, gain: number) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = gain; s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start(); return { s, g, fl };
    };
    const wind = mk('bandpass', 380, 0.9, 0.5 * theme.wind);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.35 * theme.wind; lfo.connect(lg); lg.connect(wind.g.gain); lfo.start();
    const lf2 = c.createOscillator(); lf2.frequency.value = 0.07; const lg2 = c.createGain(); lg2.gain.value = 160; lf2.connect(lg2); lg2.connect(wind.fl.frequency); lf2.start();
    const rain = mk('highpass', 3500, 0.5, 0.1 * theme.rain);
    const drone = c.createGain(); drone.gain.value = 0.22; drone.connect(this.ambBus);
    const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 220; df.connect(drone);
    for (const f of [55, 55.7, 82.5, 110.4]) { const o = c.createOscillator(); o.type = f > 80 ? 'sine' : 'sawtooth'; o.frequency.value = f; const og = c.createGain(); og.gain.value = f > 80 ? 0.25 : 0.4; o.connect(og); og.connect(df); o.start(); }
    const tense = c.createGain(); tense.gain.value = 0; tense.connect(this.ambBus);
    for (const f of [466, 493.9, 932]) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const tr = c.createOscillator(); tr.frequency.value = 5.5; const tg = c.createGain(); tg.gain.value = 0.3; tr.connect(tg); const og = c.createGain(); og.gain.value = 0.35; tg.connect(og.gain); o.connect(og); og.connect(tense); o.start(); tr.start(); }
    this.ambNodes = { wind: wind.g, rain: rain.g, drone, droneF: df, windF: wind.fl, tense };
    this.ambBus.gain.cancelScheduledValues(0); this.ambBus.gain.setTargetAtTime(1, c.currentTime, 1.5);
    this.musicBus.gain.setTargetAtTime(0, c.currentTime, 0.5);
    (this as any)._ambStop = () => { try { wind.s.stop(); rain.s.stop(); lfo.stop(); lf2.stop(); } catch { /* */ } };
  }
  stopAmbience() {
    const c = this.ctx; if (!c) return;
    this.ambBus.gain.setTargetAtTime(0, c.currentTime, 0.3);
    const old = this.ambNodes; const stop = (this as any)._ambStop; this.ambNodes = {};
    setTimeout(() => { stop?.(); try { old.drone?.disconnect(); old.tense?.disconnect(); } catch { /* */ } }, 1500);
    (this as any)._ambStop = null;
  }

  /** every frame: terror 0..1 (killer nearness), distort seconds, delta time, listener position for scheduled random cues */
  tick(dt: number, terror: number, distort: boolean, lx: number, lz: number, playing: boolean) {
    const c = this.ctx; if (!c || !playing) return;
    this.terror += (terror - this.terror) * Math.min(1, dt * 3);
    const T = this.terror, t = c.currentTime;
    const a = this.ambNodes;
    if (a.droneF) a.droneF.frequency.setTargetAtTime(180 + 500 * T, t, 0.3);
    if (a.drone) a.drone.gain.setTargetAtTime((0.2 + 0.25 * T) * (t < this.quietUntil ? 0.05 : 1), t, 0.2);
    if (a.wind) a.wind.gain.setTargetAtTime((t < this.quietUntil ? 0.02 : 0.5 * (1 - 0.6 * T)), t, 0.4);
    if (a.rain) a.rain.gain.setTargetAtTime(t < this.quietUntil ? 0 : 0.1 * (1 - 0.5 * T), t, 0.4);
    if (a.tense) a.tense.gain.setTargetAtTime(0.18 * Math.max(0, T - 0.35) * 1.5, t, 0.3);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(distort ? 0.35 : 1, t, 0.15);
    // heartbeat
    if (T > 0.25) {
      this.hbT -= dt;
      if (this.hbT <= 0) {
        this.hbT = 1.15 - 0.75 * T;
        const v = 0.35 + 0.55 * T;
        this.tone(this.sfxBus, t, 'sine', 62, 38, 0.18, v * 0.9, 0.004);
        this.tone(this.sfxBus, t + 0.18, 'sine', 56, 34, 0.2, v * 0.65, 0.004);
      }
    }
    // randomized, unpredictable cues (never on a fixed timer)
    const now = performance.now() / 1000;
    if (now - this.lastCue > 7 + Math.random() * 16) {
      this.lastCue = now + Math.random() * 6;
      const r = Math.random();
      const ang = Math.random() * Math.PI * 2, dist = 10 + Math.random() * 25;
      const cx = lx + Math.cos(ang) * dist, cz = lz + Math.sin(ang) * dist;
      if (r < 0.34) this.play('creak', cx, cz, 0.7);
      else if (r < 0.5) this.play('thud', cx, cz, 0.55);
      else if (r < 0.64) this.play('door', cx, cz, 0.6);
      else if (r < 0.78) this.play('buzz', lx + Math.cos(ang) * 6, lz + Math.sin(ang) * 6, 0.6);
      else if (r < 0.9) this.quietUntil = t + 1.6 + Math.random() * 2.5; // sudden silence
      else if (now - this.lastScare > 120 && T < 0.3) { this.lastScare = now; this.play('scare', cx, cz, 0.5); } // rare, short sting
    }
  }

  // ---------------------------------------------------------------- menu music (generative, original)
  startMusic() {
    const c = this.ctx; if (!c || this.musicOn) return; this.musicOn = true;
    this.musicBus.gain.setTargetAtTime(0.5, c.currentTime, 0.5);
    const chords = [[110, 164.8, 220, 261.6], [98, 146.8, 196, 233.1], [87.3, 130.8, 174.6, 220], [98, 146.8, 196, 246.9]];
    const pent = [440, 523.3, 587.3, 659.3, 784, 880, 1046.5];
    let i = 0;
    const bar = () => {
      if (!this.musicOn || !this.ctx) return;
      const t = this.ctx.currentTime + 0.05, ch = chords[i++ % chords.length];
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(this.musicBus);
      for (const f of ch) { for (const dt of [-6, 6]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 2.2); g.gain.linearRampToValueAtTime(0.0001, t + 6.2); o.connect(g); g.connect(lp); o.start(t); o.stop(t + 6.4); } }
      for (let k = 0; k < 3; k++) if (Math.random() < 0.8) { const nf = pent[Math.floor(Math.random() * pent.length)]; this.tone(this.musicBus, t + 0.8 + Math.random() * 4.5, 'sine', nf, nf, 1.6, 0.06 + Math.random() * 0.04, 0.01); }
      this.musicTimer = window.setTimeout(bar, 5800);
    };
    bar();
  }
  stopMusic() { this.musicOn = false; if (this.musicTimer) clearTimeout(this.musicTimer); this.musicTimer = null; if (this.ctx) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); }
}
