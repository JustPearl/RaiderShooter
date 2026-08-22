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

  private noise(dur: number, opts: { type?: BiquadFilterType; freq?: number; q?: number; gain?: number; slideTo?: number; delay?: number; hp?: number } = {}) {
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
    if (opts.hp) {
      /* band-limit the transient instead of high-passing it into a hiss */
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = opts.hp;
      hpf.Q.value = 0.6;
      src.connect(hpf).connect(f).connect(g).connect(this.master);
    } else {
      src.connect(f).connect(g).connect(this.master);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* small per-shot variation so gunfire never sounds like a looped sample */
  private j(v: number, r = 0.14) {
    return v * (1 + (Math.random() * 2 - 1) * r);
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
    /* crack — full-band impulse (band-limited, NOT high-passed), fast decay.
       High-passing the transient is what made it hiss. */
    this.noise(0.085, { hp: 320, freq: 4800 * this.j(1), gain: this.j(0.5) });
    /* the "bang" — fixed mid-band body, no filter sweep (sweeps sound laser-y) */
    this.noise(0.075, { hp: 90, freq: 1050 * this.j(1), gain: this.j(0.38) });
    /* chest thump */
    this.tone(0.055, { type: "sine", freq: 148 * this.j(1), slideTo: 46, gain: this.j(0.3) });
    /* slide: clack back, lock forward */
    this.noise(0.028, { type: "bandpass", freq: 1300 * this.j(1), q: 4.5, gain: 0.1, delay: 0.085 });
    this.noise(0.022, { type: "bandpass", freq: 860 * this.j(1), q: 4, gain: 0.08, delay: 0.13 });
    /* one quiet wall reflection — sells the factory space */
    this.noise(0.07, { freq: 620, gain: 0.055 * this.j(1), delay: 0.1 });
  }

  smg() {
    /* tight open-bolt 9mm — same impulse recipe as the sidearm but shorter.
       The crack is a band-limited impulse and the body is a FIXED mid-band
       (NO descending filter sweep — that sweep is what reads as a laser
       "pew" at 12 rps). Only the sub-bass thump slides, which reads as
       impact, not laser. */
    this.noise(0.05, { hp: 340, freq: 4400 * this.j(1), gain: this.j(0.4) });
    this.noise(0.045, { hp: 110, freq: 1300 * this.j(1), gain: this.j(0.3) });
    this.tone(0.04, { type: "sine", freq: 160 * this.j(1), slideTo: 58, gain: this.j(0.14) });
    /* bolt clack trailing the crack */
    this.noise(0.02, { type: "bandpass", freq: 2150, q: 8, gain: 0.06, delay: 0.042 });
  }

  shotgun() {
    /* crack — same band-limited impulse recipe, wider */
    this.noise(0.06, { hp: 260, freq: 4000 * this.j(1), gain: this.j(0.48) });
    /* the boom — this is the weight of it */
    this.noise(0.32, { hp: 60, freq: 2600 * this.j(1), slideTo: 90, gain: this.j(0.78) });
    /* heavy mid body — fixed cutoff, fast decay */
    this.noise(0.16, { hp: 120, freq: 900 * this.j(1), gain: this.j(0.42) });
    /* deep thump + chamber resonance */
    this.tone(0.28, { type: "sine", freq: 104 * this.j(1), slideTo: 28, gain: this.j(0.55) });
    this.tone(0.17, { type: "triangle", freq: 64 * this.j(1), slideTo: 42, gain: 0.24, delay: 0.012 });
    /* spent shell hitting the floor plates a beat later */
    this.noise(0.05, { type: "bandpass", freq: 3100 * this.j(1), q: 8, gain: 0.07, delay: 0.17 });
    /* room reflection */
    this.noise(0.1, { freq: 480, gain: 0.065, delay: 0.11 });
  }

  pump() {
    /* forend slides back, then slams home and locks */
    this.noise(0.045, { type: "bandpass", freq: 1750, q: 5, gain: 0.18 });
    this.noise(0.05, { type: "bandpass", freq: 2450, q: 7, gain: 0.24, delay: 0.13 });
    this.tone(0.05, { type: "square", freq: 430, slideTo: 170, gain: 0.055, delay: 0.13 });
  }

  reload(stage: number) {
    if (stage === 0) {
      /* mag release thud + recoil spring */
      this.noise(0.05, { type: "bandpass", freq: 780, q: 4, gain: 0.26 });
      this.noise(0.13, { type: "highpass", freq: 3100, gain: 0.045, delay: 0.04 });
    } else if (stage === 1) {
      /* shell onto the lifter, then shoved up into the tube */
      this.noise(0.035, { type: "bandpass", freq: 2650, q: 6, gain: 0.2 });
      this.noise(0.04, { type: "bandpass", freq: 1250, q: 5, gain: 0.15, delay: 0.065 });
    } else {
      /* slide / action bar snaps home */
      this.noise(0.04, { type: "bandpass", freq: 2150, q: 8, gain: 0.24 });
      this.tone(0.05, { type: "square", freq: 640, slideTo: 215, gain: 0.07 });
    }
  }

  dry() {
    /* striker click on an empty chamber */
    this.noise(0.028, { type: "bandpass", freq: 2500, q: 10, gain: 0.19 });
    this.tone(0.04, { type: "square", freq: 840, slideTo: 430, gain: 0.07, delay: 0.012 });
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
