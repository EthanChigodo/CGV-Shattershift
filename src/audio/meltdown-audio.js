/**
 * Level 3 audio - every sound synthesized with the Web Audio API.
 *
 * No sample files: nothing to download, nothing for the credits register,
 * and every sound can react to game state continuously (the fire and heart
 * swell as danger rises rather than switching between recordings).
 *
 * Beds (continuous):  smoke-detector chirps, fire roar, fire crackle,
 *                     heartbeat at low vitality. (No siren: the building
 *                     sounds like the Skyline's - the fire, the glass, the
 *                     structure groaning and giving way somewhere above.
 *                     With `useSamples` the game's recorded fire, from
 *                     level1-audio.js, replaces the synthesized roar.)
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
    /** The recorded fire plays (level1-audio.js): no synthesized roar or crackle. */
    this.useSamples = false;
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

    if (!this.useSamples) this._startFire();
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
    this.fireFilter?.frequency.setTargetAtTime(380 + this.danger * 900 + this.fireNear * 900, t, 0.3);
    this.fireGain?.gain.setTargetAtTime(0.1 + this.danger * 0.22 + this.fireNear * 0.35, t, 0.3);
    this.heart = this.danger > 0.72 ? (this.danger - 0.72) / 0.28 : 0;
  }

  /** 0..1 - how close the chasing fire front is. */
  setFireProximity(p) {
    this.fireNear = Math.max(0, Math.min(1, p));
  }

  /* ------------------------------------------------------------ */
  /* Beds                                                          */
  /* ------------------------------------------------------------ */


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
      // Crackle: random short noise pops, more of them when the fire is near
      // (the recorded fire has its own).
      const pops = this.useSamples ? 0 : 1 + Math.round((this.danger + this.fireNear) * 4);
      for (let i = 0; i < pops; i += 1) {
        if (Math.random() < 0.55) this._pop(now + Math.random() * 0.1, 0.02 + (this.danger + this.fireNear) * 0.05);
      }
      // Smoke detectors somewhere down the corridor, chirping on their batteries.
      if (now >= nextChirp) {
        for (let i = 0; i < 3; i += 1) this._beep(now + i * 0.11, 3150, 0.07, 0.012);
        nextChirp = now + 2.6 + Math.random() * 2;
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

  /** The grid dying: everything winds down, a relay slams. */
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

  /** Emergency power comes back. */
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

  /* ------------------------------------------------------------ */
  /* The roof                                                      */
  /* ------------------------------------------------------------ */

  /**
   * The helicopter, 0 (not yet) .. 1 (overhead): low noise chopped at the
   * blade rate, with a turbine whine on top. Built on first use.
   */
  setRotor(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this.rotorGain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 520;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = 5.6;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth).connect(chop.gain);
      this.rotorGain = ctx.createGain();
      this.rotorGain.gain.value = 0;
      src.connect(low).connect(chop).connect(this.rotorGain).connect(this.master);
      const whine = ctx.createOscillator();
      whine.type = "sawtooth";
      whine.frequency.value = 1650;
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0.006;
      whine.connect(whineGain).connect(this.rotorGain);
      src.start();
      lfo.start();
      whine.start();
    }
    this.rotorGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) ** 1.6 * 0.9, t, 0.4);
  }

  /** A scientist's gadget discharging. */
  zap() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 1800, to: 240, duration: 0.35, gain: 0.12, type: "sawtooth" });
    this._burst(t, { duration: 0.2, gain: 0.12, type: "bandpass", freq: 3000, sweepTo: 800 });
  }

  /**
   * A mutant's growl - the telegraph before one charges, and the snarl as it
   * goes for you: a ragged low voice driven into grit, shaped by a throat
   * (two formants), fluttering, with breath under it. Each one different.
   */
  growl(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now();
    const dur = 0.85 + Math.random() * 0.45;
    const level = 0.42 * Math.max(0.2, Math.min(1.2, strength));
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(level, t + 0.07);
    out.gain.setValueAtTime(level, t + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    out.connect(this.master);
    // The throat: two formants in parallel.
    const throat = ctx.createGain();
    for (const [freq, q, gain] of [[380 + Math.random() * 80, 3.5, 1], [1050 + Math.random() * 200, 5, 0.55]]) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      throat.connect(f).connect(g).connect(out);
    }
    // Grit, and the flutter of a rattling throat.
    const shaper = ctx.createWaveShaper();
    shaper.curve = (this._grit ??= (() => {
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = ((1 + 28) * x) / (1 + 28 * Math.abs(x));
      }
      return curve;
    })());
    const flutter = ctx.createGain();
    flutter.gain.value = 0.55;
    const am = ctx.createOscillator();
    am.frequency.value = 22 + Math.random() * 12;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.45;
    am.connect(amDepth).connect(flutter.gain);
    shaper.connect(flutter).connect(throat);
    // The voice: low and detuned, rising into the snarl and falling away,
    // its pitch wandering (a slow, uneven vibrato).
    const base = 55 + Math.random() * 25;
    const oscs = [am];
    for (const [mult, type] of [[1, "sawtooth"], [1.51, "square"], [0.5, "sawtooth"]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      const f0 = base * mult;
      osc.frequency.setValueAtTime(f0 * 0.8, t);
      osc.frequency.linearRampToValueAtTime(f0 * 1.3, t + dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.65, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 6 + Math.random() * 5;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = f0 * 0.09;
      vib.connect(vibDepth).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = mult === 1 ? 0.5 : 0.25;
      osc.connect(g).connect(shaper);
      oscs.push(osc, vib);
    }
    // Breath through the teeth.
    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    const hiss = ctx.createBiquadFilter();
    hiss.type = "bandpass";
    hiss.frequency.value = 1800;
    hiss.Q.value = 0.9;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.18;
    breath.connect(hiss).connect(breathGain).connect(out);
    oscs.push(breath);
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  /**
   * Somewhere above, the building giving way: a deep boom, a long rumble
   * through the floor, a steel beam groaning. (The Skyline's collapse, heard
   * from inside.)
   */
  distantCollapse(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now();
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(260, t);
    low.frequency.exponentialRampToValueAtTime(70, t + 2.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 3.0);
    src.connect(low).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 3.1);
    this._tone(t + 0.05, { freq: 46, to: 28, duration: 1.8, gain: 0.3 * strength });
    // The beam: a slow metallic groan.
    const beam = ctx.createOscillator();
    beam.type = "sawtooth";
    const f = 160 + Math.random() * 80;
    beam.frequency.setValueAtTime(f, t + 0.6);
    beam.frequency.linearRampToValueAtTime(f * 0.72, t + 2.2);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 9;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t + 0.6);
    bg.gain.exponentialRampToValueAtTime(0.06 * strength, t + 0.9);
    bg.gain.exponentialRampToValueAtTime(0.0008, t + 2.3);
    beam.connect(band).connect(bg).connect(this.master);
    beam.start(t + 0.6);
    beam.stop(t + 2.4);
  }

  /** Over the edge. */
  scream() {
    if (!this.ctx) return;
    const t = this._now();
    this._tone(t, { freq: 620, to: 180, duration: 1.4, gain: 0.12, type: "sawtooth" });
    this._tone(t, { freq: 640, to: 190, duration: 1.4, gain: 0.08, type: "triangle" });
  }

  /** A sidestep. */
  whoosh() {
    if (!this.ctx) return;
    this._burst(this._now(), { duration: 0.25, gain: 0.18, type: "bandpass", freq: 900, sweepTo: 2600 });
  }

  stop() {
    clearTimeout(this._loop);
    this.ctx?.close();
    this.ctx = null;
  }
}
