/* Procedural WebAudio SFX — no assets, everything synthesized. */

export class SFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastStep = 0;

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 9;
      comp.attack.value = 0.002;
      comp.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  private noise(dur: number, opts: { type?: BiquadFilterType; freq?: number; q?: number; gain?: number; slideTo?: number; delay?: number } = {}) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? "lowpass";
    f.frequency.setValueAtTime(opts.freq ?? 1200, t0);
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slideTo), t0 + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private tone(dur: number, opts: { type?: OscillatorType; freq?: number; slideTo?: number; gain?: number; delay?: number; detune?: number } = {}) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.freq ?? 440, t0);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  pistol() {
    this.noise(0.11, { type: "highpass", freq: 900, gain: 0.5 });
    this.noise(0.16, { freq: 2600, slideTo: 300, gain: 0.55 });
    this.tone(0.09, { type: "square", freq: 190, slideTo: 60, gain: 0.22 });
  }

  shotgun() {
    this.noise(0.3, { freq: 3400, slideTo: 120, gain: 0.85 });
    this.noise(0.42, { freq: 900, slideTo: 60, gain: 0.7 });
    this.tone(0.28, { type: "sine", freq: 120, slideTo: 34, gain: 0.6 });
    this.noise(0.1, { type: "highpass", freq: 2400, gain: 0.35 });
  }

  pump() {
    this.noise(0.05, { type: "bandpass", freq: 2200, q: 4, gain: 0.22 });
    this.noise(0.05, { type: "bandpass", freq: 1500, q: 4, gain: 0.22, delay: 0.13 });
  }

  reload(stage: number) {
    if (stage === 0) this.noise(0.06, { type: "bandpass", freq: 1100, q: 5, gain: 0.3 });
    else if (stage === 1) this.noise(0.05, { type: "bandpass", freq: 2600, q: 6, gain: 0.26 });
    else this.tone(0.06, { type: "square", freq: 700, slideTo: 1400, gain: 0.1 });
  }

  dry() {
    this.tone(0.05, { type: "square", freq: 900, slideTo: 500, gain: 0.12 });
  }

  ricochet() {
    this.tone(0.18, { type: "sawtooth", freq: 2800, slideTo: 200, gain: 0.06 });
  }

  hitEnemy(head: boolean) {
    this.noise(0.07, { type: "bandpass", freq: head ? 3200 : 1600, q: 2, gain: 0.3 });
    this.tone(0.06, { type: "triangle", freq: head ? 620 : 340, slideTo: 120, gain: 0.2 });
  }

  kill() {
    this.tone(0.22, { type: "sawtooth", freq: 220, slideTo: 48, gain: 0.16 });
    this.noise(0.2, { freq: 700, slideTo: 90, gain: 0.24 });
  }

  hurt() {
    this.tone(0.16, { type: "square", freq: 150, slideTo: 55, gain: 0.3 });
    this.noise(0.14, { type: "lowpass", freq: 800, gain: 0.3 });
  }

  explosion() {
    this.noise(0.7, { freq: 4200, slideTo: 40, gain: 0.95 });
    this.tone(0.6, { type: "sine", freq: 90, slideTo: 24, gain: 0.75 });
    this.noise(0.35, { type: "highpass", freq: 1200, slideTo: 200, gain: 0.3 });
  }

  barrelClang() {
    this.tone(0.14, { type: "square", freq: 340, slideTo: 90, gain: 0.18 });
    this.noise(0.08, { type: "bandpass", freq: 900, q: 3, gain: 0.2 });
  }

  waveHorn() {
    this.tone(0.5, { type: "sawtooth", freq: 96, slideTo: 144, gain: 0.22, detune: -12 });
    this.tone(0.5, { type: "sawtooth", freq: 144, slideTo: 216, gain: 0.18, detune: 14, delay: 0.03 });
    this.noise(0.6, { freq: 500, slideTo: 140, gain: 0.22 });
  }

  waveClear() {
    this.tone(0.14, { type: "square", freq: 520, gain: 0.16 });
    this.tone(0.14, { type: "square", freq: 780, gain: 0.16, delay: 0.12 });
    this.tone(0.3, { type: "square", freq: 1040, gain: 0.16, delay: 0.24 });
  }

  pickup(kind: "health" | "ammo") {
    if (kind === "health") {
      this.tone(0.1, { type: "triangle", freq: 620, gain: 0.2 });
      this.tone(0.16, { type: "triangle", freq: 930, gain: 0.2, delay: 0.08 });
    } else {
      this.noise(0.07, { type: "bandpass", freq: 1800, q: 3, gain: 0.26 });
      this.tone(0.1, { type: "square", freq: 300, slideTo: 520, gain: 0.14, delay: 0.05 });
    }
  }

  spawnRoar() {
    this.tone(0.3, { type: "sawtooth", freq: 80, slideTo: 170, gain: 0.12 });
    this.noise(0.25, { freq: 900, slideTo: 200, gain: 0.14 });
  }

  step(sprint: boolean) {
    const now = performance.now();
    if (now - this.lastStep < 140) return;
    this.lastStep = now;
    this.noise(0.06, { type: "lowpass", freq: sprint ? 420 : 300, gain: sprint ? 0.12 : 0.08 });
  }

  swing() {
    this.noise(0.12, { type: "bandpass", freq: 700, slideTo: 2200, q: 2, gain: 0.14 });
  }

  uiMove() {
    this.tone(0.06, { type: "square", freq: 880, slideTo: 660, gain: 0.06 });
  }
}

export const sfx = new SFX();
