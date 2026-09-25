/**
 * Level 3 audio - every sound synthesized with the Web Audio API.
 *
 * No sample files: nothing to download, nothing for the credits register,
 * and every sound can react to game state continuously (the siren and fire
 * swell as danger rises rather than switching between recordings).
 *
 * Beds (continuous):  building siren, smoke-detector chirps, fire roar,
 *                     fire crackle, heartbeat at low vitality.
 * One-shots:          launcher shot, glass crack/shatter, concrete crash,
 *                     metal clang, player stumble, pickup, power-up,
 *                     overheat whine + lockout clunk, duct push, warp,
 *                     power failure, patient groan / hit / fall, the
 *                     stinger when your beam finds someone in the dark,
 *                     the beam clicking on.
 *
 * Browsers only allow audio after a user gesture, so nothing starts until
 * `start()` is called from a click/keypress handler.
 */

export class MeltdownAudio {
  constructor({ volume = 0.8 } = {}) {
    this.volume = volume;
    this.ctx = null;
    this.danger = 0;
    this.fireNear = 0;
    this.heart = 0;
  }

  get ready() {
    return Boolean(this.ctx);
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = this._noiseBuffer(2);
    this.brown = this._brownBuffer(4);

    this._startSiren();
    this._startFire();
    this._scheduleLoop();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  /** 0..1 - how close the player is to being caught. */
  setDanger(d) {
    this.danger = Math.max(0, Math.min(1, d));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(this._sirenDucked ? 0.008 : 0.05 + this.danger * 0.06, t, 0.3);
    this.fireFilter.frequency.setTargetAtTime(380 + this.danger * 900 + this.fireNear * 900, t, 0.3);
    this.fireGain.gain.setTargetAtTime(0.1 + this.danger * 0.22 + this.fireNear * 0.35, t, 0.3);
    this.heart = this.danger > 0.72 ? (this.danger - 0.72) / 0.28 : 0;
  }

  /** 0..1 - how close the chasing fire front is. */
  setFireProximity(p) {
    this.fireNear = Math.max(0, Math.min(1, p));
  }

  /* ------------------------------------------------------------ */
  /* Beds                                                          */
  /* ------------------------------------------------------------ */

  _startSiren() {
    const ctx = this.ctx;
    // Two detuned saws swept by a slow LFO: the classic rising/falling wail.
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0.05;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 0.8;
    band.connect(this.sirenGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.28;
    const depth = ctx.createGain();
    depth.gain.value = 240;
    lfo.connect(depth);
    for (const detune of [0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 720;
      osc.detune.value = detune;
      depth.connect(osc.frequency);
      osc.connect(band);
      osc.start();
    }
    lfo.start();
  }

  _startFire() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    this.fireFilter = ctx.createBiquadFilter();
    this.fireFilter.type = "lowpass";
    this.fireFilter.frequency.value = 420;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0.1;
    // Slow amplitude wobble so the roar breathes.
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.4;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.04;
    wobble.connect(wobbleDepth).connect(this.fireGain.gain);
    wobble.start();
    src.connect(this.fireFilter).connect(this.fireGain).connect(this.master);
    src.start();
  }

  /** Crackle, detector chirps, and heartbeat, scheduled a little ahead. */
  _scheduleLoop() {
    let nextChirp = 0;
    let nextBeat = 0;
    const tick = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // Crackle: random short noise pops, more of them when the fire is near.
      const pops = 1 + Math.round((this.danger + this.fireNear) * 4);
      for (let i = 0; i < pops; i += 1) {
        if (Math.random() < 0.55) this._pop(now + Math.random() * 0.1, 0.02 + (this.danger + this.fireNear) * 0.05);
      }
      if (now >= nextChirp) {
        for (let i = 0; i < 3; i += 1) this._beep(now + i * 0.11, 3150, 0.07, 0.018);
        nextChirp = now + 1.4;
      }
      if (this.heart > 0 && now >= nextBeat) {
        const interval = 0.85 - this.heart * 0.4;
        this._thump(now, 0.45 * this.heart + 0.15);
        this._thump(now + 0.16, 0.3 * this.heart + 0.1);
        nextBeat = now + interval;
      }
      this._loop = setTimeout(tick, 100);
    };
    tick();
  }

  /* ------------------------------------------------------------ */
  /* Building blocks                                               */
  /* ------------------------------------------------------------ */

  _noiseBuffer(seconds) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _brownBuffer(seconds) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  /** Filtered noise burst with an exponential decay. */
  _burst(time, { duration = 0.2, gain = 0.3, type = "bandpass", freq = 2000, q = 1, sweepTo = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, time);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, time + duration);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0008, time + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(time, Math.random() * 1.5);
    src.stop(time + duration + 0.05);
  }

  _tone(time, { freq = 440, to = null, duration = 0.2, gain = 0.2, type = "sine" } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, time + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0008, time + duration);
    osc.connect(g).connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  _pop(time, gain) {
    this._burst(time, { duration: 0.03 + Math.random() * 0.04, gain, type: "highpass", freq: 1200 + Math.random() * 2500 });
  }

  _beep(time, freq, duration, gain) {
    this._tone(time, { freq, duration, gain, type: "square" });
  }

  _thump(time, gain) {
    this._tone(time, { freq: 70, to: 38, duration: 0.18, gain });
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* ------------------------------------------------------------ */
  /* One-shots                                                     */
  /* ------------------------------------------------------------ */

  shot(weak = false) {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: weak ? 140 : 210, to: 55, duration: 0.16, gain: weak ? 0.25 : 0.4, type: "triangle" });
    this._burst(t, { duration: 0.09, gain: 0.25, type: "bandpass", freq: 1800, sweepTo: 500 });
  }

  glassCrack() {
    if (!this.ctx) return;
    const t = this._now();
    this._burst(t, { duration: 0.12, gain: 0.35, type: "highpass", freq: 3500 });
    this._tone(t, { freq: 2600, to: 1900, duration: 0.18, gain: 0.08 });
  }

  glassShatter(big = true) {
    if (!this.ctx) return;
    const t = this._now();
    this._burst(t, { duration: big ? 0.7 : 0.35, gain: big ? 0.55 : 0.35, type: "highpass", freq: 2800 });
    // Tinkling fragments: a cluster of short bright pings.
    const n = big ? 14 : 6;
    for (let i = 0; i < n; i += 1) {
      this._tone(t + 0.02 + Math.random() * (big ? 0.6 : 0.25), { freq: 2500 + Math.random() * 4500, duration: 0.05 + Math.random() * 0.08, gain: 0.05 });
    }
    this._tone(t, { freq: 160, to: 60, duration: 0.2, gain: 0.25 });
  }

  crash(strength = 1) {
    if (!this.ctx) return;
    const t = this._now();
    this._burst(t, { duration: 0.9, gain: 0.5 * strength, type: "lowpass", freq: 700, sweepTo: 120 });
    this._tone(t, { freq: 60, to: 28, duration: 0.6, gain: 0.55 * strength });
    for (let i = 0; i < 6; i += 1) this._pop(t + 0.1 + Math.random() * 0.5, 0.12 * strength);
  }

  clang() {
    if (!this.ctx) return;
    const t = this._now();
    for (const f of [420, 1130, 1870]) this._tone(t, { freq: f, duration: 0.35, gain: 0.07, type: "triangle" });
    this._burst(t, { duration: 0.05, gain: 0.15, freq: 3000 });
  }

  stumble() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 110, to: 45, duration: 0.3, gain: 0.5 });
    this._burst(t, { duration: 0.3, gain: 0.35, type: "lowpass", freq: 900 });
    // Dropped balls clattering away.
    for (let i = 0; i < 5; i += 1) this._tone(t + 0.12 + i * 0.09 + Math.random() * 0.05, { freq: 900 + Math.random() * 500, duration: 0.06, gain: 0.06, type: "triangle" });
  }

  pickup() {
    if (!this.ctx) return;
    const t = this._now();
    [660, 880, 1320].forEach((f, i) => this._tone(t + i * 0.06, { freq: f, duration: 0.14, gain: 0.12, type: "triangle" }));
  }

  powerup() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 300, to: 1500, duration: 0.45, gain: 0.18, type: "sawtooth" });
    [880, 1100, 1320, 1760].forEach((f, i) => this._tone(t + 0.1 + i * 0.07, { freq: f, duration: 0.2, gain: 0.08 }));
  }

  overheat() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 400, to: 2200, duration: 0.6, gain: 0.12, type: "sawtooth" });
    this._burst(t + 0.55, { duration: 0.5, gain: 0.3, type: "highpass", freq: 1500 }); // steam vent
    this._tone(t + 0.55, { freq: 90, to: 50, duration: 0.2, gain: 0.35, type: "square" }); // lockout clunk
  }

  dry() {
    if (!this.ctx) return;
    this._tone(this._now(), { freq: 220, duration: 0.05, gain: 0.1, type: "square" });
  }

  ductPush(progress) {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 180 + progress * 140, to: 120, duration: 0.18, gain: 0.25, type: "square" });
    this._burst(t, { duration: 0.12, gain: 0.15, type: "bandpass", freq: 700 });
  }

  warp() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 60, to: 900, duration: 2.5, gain: 0.2, type: "sawtooth" });
    this._tone(t + 0.3, { freq: 1200, to: 80, duration: 3, gain: 0.12, type: "sine" });
  }

  /** The grid dying: everything winds down, a relay slams, the siren chokes. */
  powerDown() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 120, to: 30, duration: 2.2, gain: 0.35, type: "sawtooth" });
    this._tone(t, { freq: 60, to: 22, duration: 2.6, gain: 0.3 });
    this._burst(t + 0.05, { duration: 0.12, gain: 0.45, type: "bandpass", freq: 900 });
    this._tone(t + 0.1, { freq: 95, to: 50, duration: 0.25, gain: 0.4, type: "square" });
    this.sirenGain?.gain.setTargetAtTime(0.008, t, 0.4);
    this._sirenDucked = true;
  }

  /** Emergency power: the siren comes back. */
  powerUp() {
    if (!this.ctx || !this._sirenDucked) return;
    this._sirenDucked = false;
    const t = this._now();
    this._tone(t, { freq: 40, to: 160, duration: 1.2, gain: 0.25, type: "sawtooth" });
    this._burst(t + 1.1, { duration: 0.1, gain: 0.35, type: "bandpass", freq: 1200 });
  }

  /** The launcher's light snapping on. */
  beamOn() {
    if (!this.ctx) return;
    const t = this._now();
    this._burst(t, { duration: 0.04, gain: 0.25, type: "highpass", freq: 4000 });
    this._tone(t + 0.02, { freq: 7800, to: 7000, duration: 0.5, gain: 0.015 });
  }

  /** A patient stepping out: a wet, rising moan. */
  groan(strength = 1) {
    if (!this.ctx) return;
    const t = this._now();
    const f = 85 + Math.random() * 40;
    this._tone(t, { freq: f, to: f * 1.5, duration: 0.7, gain: 0.16 * strength, type: "sawtooth" });
    this._tone(t, { freq: f * 1.02, to: f * 1.35, duration: 0.8, gain: 0.12 * strength, type: "triangle" });
    this._burst(t, { duration: 0.6, gain: 0.08 * strength, type: "bandpass", freq: 500, q: 3 });
  }

  /** A ball into a body. */
  thud() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 140, to: 60, duration: 0.14, gain: 0.35 });
    this._burst(t, { duration: 0.1, gain: 0.2, type: "lowpass", freq: 700 });
  }

  /** A body hitting the floor. */
  bodyFall() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t + 0.35, { freq: 90, to: 40, duration: 0.3, gain: 0.4 });
    this._burst(t + 0.35, { duration: 0.35, gain: 0.25, type: "lowpass", freq: 500 });
  }

  /** The beam lands on someone standing in the dark. */
  stinger() {
    if (!this.ctx) return;
    const t = this._now();
    for (const f of [311, 330, 466]) this._tone(t, { freq: f * 2, to: f * 2.03, duration: 1.4, gain: 0.05, type: "sawtooth" });
    this._burst(t, { duration: 0.8, gain: 0.12, type: "highpass", freq: 2500, sweepTo: 6000 });
  }

  stop() {
    clearTimeout(this._loop);
    this.ctx?.close();
    this.ctx = null;
  }
}
