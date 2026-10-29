/**
 * The game's recorded and rendered sounds, sharing the music manager's
 * unlocked AudioContext. Started for Level 1 (the Skyline's fire, water and
 * glass), now every level's: the patients (growls, moans, what is left of
 * their speech), the tower's fire alarm, the player's voice (pain, and a
 * breath in the cutscenes that call for one - none while you run),
 * explosions and the building coming down, and the cutscenes' sound cues.
 *
 * The sets in assets/audio/creatures and assets/audio/sfx are real
 * recordings, cut, layered and mastered by tools/audio/sounds_build.py - see
 * tools/audio/README.md (and docs/credits.md for who recorded them).
 *
 * Sounds load lazily: the first click fetches the original Level 1 set and
 * the player's voice; each stage preloads its own (`preloadStage`).
 */

import { effectsFor } from "./output.js";

export const LEVEL1_SFX_VOLUME = Object.freeze({
  /*
   * Balanced by measured loudness (EBU R128) against the dialogue, which
   * plays at about -19 LUFS: one-shots land around -20 to -24, the beds
   * (fire, water, wind, the alarm) around -25 to -29, the music
   * under it all. The supplied recordings vary by 30 dB between files, hence
   * gains above 1 for the quiet ones (the glass, the wind, the ricochet).
   */
  fire: 1.0,
  impact: 1.5,
  water: 0.25,
  glass: 2.4,
  podBreak: 1.1,
  falling: 0.6,
  gameOver: 0.7,
  glassStep: 0.25,
  elevatorMechanical: 1.0,
  wind: 3.5,
  throw: 0.45,
  pickup: 0.6,
  wall: 4.0,
  ui: 0.22,
  alarm: 0.38,
  // The built sets are mastered to a common loudness: one gain each.
  patient: 1.3,
  player: 1.0,
  blast: 0.5,
  cue: 0.75,
});

export const LEVEL1_SFX_RANGE = Object.freeze({
  fireNear: 2.5,
  fireMax: 18,
  waterNear: 2,
  waterMax: 14,
});

export const LEVEL1_SFX_TIMING = Object.freeze({
  elevatorMechanicalFade: 0.35,
  elevatorMechanicalLoopOverlap: 0.75,
});

const url = (path) => new URL(`../../assets/audio/${path}`, import.meta.url).href;

const ASSETS = {
  fire: url("sound-effects/vanzetpictures-fire-457848.mp3"),
  impact: url("sound-effects/sumaga123-wood-hit-432148.mp3"),
  water: url("sound-effects/fire_sprinkler_water_flow_splash.wav"),
  glass: url("sound-effects/eaglaxle-glass-shattering-461637.mp3"),
  podBreak: url("sound-effects/universfield-glass-bottle-breaking-351297.mp3"),
  falling: url("sound-effects/dragon-studio-falling-tree-356127.mp3"),
  gameOver: url("sound-effects/universfield-marimba-game-over-250960.mp3"),
  glassStep: url("sound-effects/368343__johandeecke__glass-hit-32.wav"),
  elevatorMechanical: url("soundtracks/174908__oneirophile__noisy-old-elevator.wav"),
  wind: url("sound-effects/wind1.wav"),
  throw: url("sound-effects/floraphonic-swing-whoosh-9-198502.mp3"),
  pickup: url("sound-effects/floraphonic-arcade-ui-6-229503.mp3"),
  wall: url("sound-effects/freesound_community-wall-hit-1-100717.mp3"),
  ui: url("sound-effects/justsomesounds-click-sound-432501.mp3"),
};
const ORIGINAL = Object.keys(ASSETS);

/** Sets with variants: one is picked at random each time (never the same twice running). */
export const GROUPS = Object.freeze({
  "patient-growl": 6,
  "patient-moan": 6,
  "patient-speech": 8,
  "patient-shriek": 4,
  "patient-pain": 5,
  "patient-death": 4,
  "patient-roar": 2,
  "patient-horde": 2,
  explosion: 2,
  "distant-collapse": 2,
  "metal-groan": 2,
  "hurt-f": 3,
  "hurt-m": 3,
});
for (const [group, count] of Object.entries(GROUPS)) {
  for (let i = 1; i <= count; i += 1) {
    const name = `${group}-${i}`;
    if (group.startsWith("patient-")) ASSETS[name] = url(`creatures/${name}.mp3`);
    else if (group.startsWith("hurt-")) ASSETS[name] = url(`sfx/hurt-${i}-${group.slice(-1)}.mp3`);
    else ASSETS[name] = url(`sfx/${name}.mp3`);
  }
}
for (const name of [
  "fire-alarm", "demolition-charges", "building-collapse", "debris", "sprinkler-burst", "glass-cascade",
  "monitor-beep", "pistol", "clatter", "brake", "cable-snap", "lift-chime", "lift-doors", "body-hit", "clank", "spark",
]) ASSETS[name] = url(`sfx/${name}.mp3`);
for (const g of ["f", "m"]) {
  for (const kind of ["pant", "scared", "recover"]) ASSETS[`breath-${kind}-${g}`] = url(`sfx/breath-${kind}-${g}.mp3`);
  for (const kind of ["grunt", "scream"]) ASSETS[`${kind}-${g}`] = url(`sfx/${kind}-${g}.mp3`);
}

/** What each stage will want, fetched as it starts. */
const STAGE_SETS = {
  common: ["fire-alarm", "explosion", "distant-collapse", "debris", "glass-cascade", "clank"],
  player: ["breath-pant", "hurt", "grunt", "scream"],
  foundry: ["metal-groan", "spark"],
  lift: ["cable-snap", "brake", "clatter", "lift-chime", "lift-doors", "metal-groan", "spark", "breath-scared", "breath-recover"],
  labs: ["patient-growl", "patient-moan", "patient-speech", "patient-shriek", "patient-pain", "patient-death", "patient-horde", "pistol", "body-hit", "breath-scared", "monitor-beep"],
  skyline: ["demolition-charges", "building-collapse", "metal-groan", "sprinkler-burst", "breath-recover"],
  roof: ["patient-growl", "patient-moan", "patient-shriek", "patient-pain", "patient-death", "patient-roar", "patient-horde", "building-collapse", "scream", "grunt", "hurt", "breath-scared", "body-hit"],
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoothstep = (edge0, edge1, value) => {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

export class Level1Audio {
  constructor(getContext) {
    this.getContext = getContext;
    this.context = null;
    this.buffers = new Map();
    this.loads = new Map();
    this.loopStarts = new Map();
    this.buses = null;
    this.ambient = new Map();
    this.falling = new Map();
    this.gameOverChannel = null;
    this.gameplayChannels = new Set();
    this.cooldowns = new Map();
    this.lastPick = new Map();
    this.debris = [];
    this.generation = 0;
    this.paused = false;
    this.ended = false;
    this.lastGlassStep = -Infinity;
    /** The character picked: "f" or "m" (the player's breath and voice). */
    this.gender = "f";
    this.voiceDucked = false;
  }

  unlock() {
    const context = this.getContext();
    if (!context) return false;
    this.context = context;
    this._ensureBuses();
    // Decode lazily, but begin fetching after the same gesture that unlocks music.
    for (const name of ORIGINAL) this._load(name);
    this.preloadStage("player");
    return true;
  }

  /** "playerFemale" / "playerMale" (meltdown's CHARACTERS keys). */
  setCharacter(name) {
    this.gender = name === "playerMale" ? "m" : "f";
    if (this.context) this.preloadStage("player");
  }

  /** Fetch and decode a stage's sounds ahead of need (common, player, foundry, lift, labs, skyline, roof). */
  preloadStage(stage) {
    if (!this.context) return;
    for (const item of STAGE_SETS[stage] ?? []) {
      for (const name of this._expand(item)) this._load(name);
    }
  }

  _expand(item) {
    if (GROUPS[item]) return Array.from({ length: GROUPS[item] }, (_, i) => `${item}-${i + 1}`);
    if (item === "hurt") return this._expand(`hurt-${this.gender}`);
    if (ASSETS[item]) return [item];
    if (ASSETS[`${item}-${this.gender}`]) return [`${item}-${this.gender}`];
    return [];
  }

  _ensureBuses() {
    if (this.buses || !this.context) return;
    const make = (volume) => {
      const gain = this.context.createGain();
      gain.gain.value = volume;
      // (Its sounds are the effects: the Settings' effects volume, then the master.)
      gain.connect(effectsFor(this.context));
      return gain;
    };
    this.buses = { sfx: make(0.9), ambient: make(0.8), ui: make(0.8) };
  }

  async _load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (!this.context || !ASSETS[name]) return null;
    if (!this.loads.has(name)) {
      const request = fetch(ASSETS[name])
        .then((response) => {
          if (!response.ok) throw new Error(`SFX request failed (${response.status}): ${ASSETS[name]}`);
          return response.arrayBuffer();
        })
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => {
          if (name === "elevatorMechanical") {
            this._prepareLoop(name, buffer, LEVEL1_SFX_TIMING.elevatorMechanicalLoopOverlap);
          }
          return buffer;
        })
        .then((buffer) => { this.buffers.set(name, buffer); return buffer; })
        .catch((error) => {
          this.loads.delete(name);
          console.warn(`Sound effect could not be loaded: ${name}`, error);
          return null;
        });
      this.loads.set(name, request);
    }
    return this.loads.get(name);
  }

  /** A variant of a group, never the one played last. */
  _pick(group) {
    const count = GROUPS[group] ?? 1;
    let i = 1 + Math.floor(Math.random() * count);
    if (count > 1 && i === this.lastPick.get(group)) i = (i % count) + 1;
    this.lastPick.set(group, i);
    return `${group}-${i}`;
  }

  async _play(name, {
    volume = LEVEL1_SFX_VOLUME[name], bus = "sfx", cooldown = 0, cooldownKey = name,
    playbackRate = 1, offset = 0, gameplay = true, pan = 0, lowpass = 0, delay = 0,
    duration = 0, isCurrent = null,
  } = {}) {
    if (!this.context || !this.buses) return null;
    const now = this.context.currentTime;
    const last = this.cooldowns.get(cooldownKey) ?? -Infinity;
    if (cooldown && now - last < cooldown) return null;
    this.cooldowns.set(cooldownKey, now);
    const generation = gameplay ? this.generation : null;
    const buffer = await this._load(name);
    if (!buffer || (gameplay && generation !== this.generation) || (isCurrent && !isCurrent())) return null;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume ?? 0.5;
    let node = source;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      node = node.connect(filter);
    }
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node = node.connect(panner);
    }
    node.connect(gain).connect(this.buses[bus]);
    const channel = { source, gain, name };
    if (gameplay) this.gameplayChannels.add(channel);
    source.onended = () => {
      this.gameplayChannels.delete(channel);
      source.disconnect();
      gain.disconnect();
      if (this.gameOverChannel === channel) this.gameOverChannel = null;
    };
    const start = ctx.currentTime + delay;
    const at = Math.min(offset, Math.max(0, buffer.duration - 0.02));
    if (duration > 0) {
      const clip = Math.min(duration, buffer.duration - at);
      const end = start + clip / playbackRate;
      gain.gain.setValueAtTime(volume ?? 0.5, Math.max(start, end - 0.07));
      gain.gain.linearRampToValueAtTime(0, end);
      source.start(start, at, clip);
    } else source.start(start, at);
    return channel;
  }

  /** Any named sound or group, once: { volume, pan, lowpass, playbackRate, cooldown, delay }. */
  play(name, options = {}) {
    if (GROUPS[name]) return this._play(this._pick(name), { cooldownKey: name, volume: LEVEL1_SFX_VOLUME.blast, ...options });
    return this._play(name, { volume: LEVEL1_SFX_VOLUME.cue, ...options });
  }

  uiClick() { this._play("ui", { bus: "ui", cooldown: 0.035, gameplay: false }); }
  throwBall() { this._play("throw", { cooldown: 0.08 }); }
  serumCollected() { this._play("pickup"); }
  sphereCollected() { this._play("pickup"); }
  podBreak() { this._play("podBreak"); }
  surfaceRicochet() { this._play("wall"); }
  glassBreak() {
    // A little different every time: the recording re-pitched.
    this._play("glass", { cooldown: 0.045, playbackRate: 0.86 + Math.random() * 0.3 });
  }
  impact(strength = 1) {
    this._play("impact", { volume: LEVEL1_SFX_VOLUME.impact * clamp(strength, 0.55, 1.15), cooldown: 0.18 });
  }

  /* ---- The patients ------------------------------------------------- */

  /**
   * One of them: growl, moan, speech, shriek, pain, death, roar, horde.
   * `distance` (metres) quietens and muffles it; `pan` -1..1 places it.
   */
  patient(kind, { strength = 1, distance = 0, pan = 0, cooldown = 0.25 } = {}) {
    const group = `patient-${kind}`;
    if (!GROUPS[group]) return null;
    // Far off they are quieter and duller, but never lost under the music.
    const far = smoothstep(10, 60, distance);
    return this._play(this._pick(group), {
      volume: LEVEL1_SFX_VOLUME.patient * clamp(strength, 0.2, 1.4) * (1 - far * 0.55),
      cooldown,
      cooldownKey: group,
      playbackRate: 0.9 + Math.random() * 0.18,
      pan,
      lowpass: far > 0.1 ? 10000 - far * 6500 : 0,
    });
  }

  /* ---- The player --------------------------------------------------- */

  /** The player's own voice - grunts, pain, screams, breathing (Settings > Sound). */
  get playerVoice() {
    return this._playerVoice ?? true;
  }

  set playerVoice(on) {
    this._playerVoice = Boolean(on);
    if (!on) this.stopAbductionVoice();
  }

  /** Hit: a grunt of pain (the character's own voice). */
  hurt(strength = 1) {
    if (!this.playerVoice) return;
    this._play(this._pick(`hurt-${this.gender}`), { volume: LEVEL1_SFX_VOLUME.player * clamp(strength, 0.5, 1.2), cooldown: 0.45, cooldownKey: "hurt" });
  }

  /** Effort: a jump, a climb, pulling yourself up. */
  grunt() {
    if (!this.playerVoice) return;
    this._play(`grunt-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 0.6 });
  }

  /** Over the edge. */
  fallScream() {
    if (!this.playerVoice) return;
    this._play(`scream-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 2 });
  }

  /** A breath one-shot: "pant" (out of breath), "scared" (hiding), "recover" (slowing down). */
  breath(kind) {
    if (!this.playerVoice) return;
    this._play(`breath-${kind}-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 1.5, cooldownKey: `breath-${kind}` });
  }

  /** One owned, non-looping human voice for rooftop abduction only. */
  async playAbductionVoice(kind, { intensity = 0, replace = false } = {}) {
    if (!this.context || !this.buses || !this.playerVoice || this.paused) return null;
    const old = this.abductionVoice;
    const busy = old && (old.pending || this.gameplayChannels.has(old.channel));
    if (busy && !replace) return null;
    this.stopAbductionVoice(0.05);
    const token = this._abductionVoiceToken;
    const level = clamp(intensity);
    const gender = this.gender;
    let name, volume, rate = 1, duration = 0;
    if (kind === "grab" || kind === "capture") {
      name = `scream-${gender}`;
      volume = LEVEL1_SFX_VOLUME.player * (kind === "capture" ? 1.25 : 0.85);
      rate = kind === "capture" ? 0.98 : 1.04;
      // A short panic cry leaves room for the struggle. The escape failure
      // uses the full recording, with additional distance attenuation below.
      if (kind === "grab") duration = 0.85;
    } else if (kind === "escape") {
      name = `grunt-${gender}`; volume = LEVEL1_SFX_VOLUME.player; duration = 0.7;
    } else if (kind === "struggle") {
      const choices = [`grunt-${gender}`, `hurt-1-${gender}`, `breath-scared-${gender}`, `hurt-2-${gender}`, `hurt-3-${gender}`];
      const previous = this.lastPick.get("abduction-effort") ?? -1;
      let pick = Math.floor(Math.random() * choices.length);
      if (pick === previous) pick = (pick + 1) % choices.length;
      this.lastPick.set("abduction-effort", pick);
      name = choices[pick];
      volume = LEVEL1_SFX_VOLUME.player * (0.55 + level * 0.3);
      rate = 0.98 + level * 0.06;
      duration = name.startsWith("breath-") ? 0.7 : 0.55;
    } else return null;
    const slot = { kind, pending: true, channel: null, volume };
    this.abductionVoice = slot;
    const current = () => token === this._abductionVoiceToken && this.abductionVoice === slot && this.playerVoice && !this.paused;
    const channel = await this._play(name, { volume, playbackRate: rate, duration, delay: busy ? 0.08 : 0, isCurrent: current });
    if (channel && !current()) {
      this._stop(channel);
      return null;
    }
    if (!channel) {
      if (this.abductionVoice === slot) this.abductionVoice = null;
      return null;
    }
    slot.pending = false; slot.channel = channel;
    const ended = channel.source.onended;
    channel.source.onended = () => {
      ended?.();
      if (this.abductionVoice === slot) this.abductionVoice = null;
    };
    return channel;
  }

  /** Fade the failed-capture scream as its attached character recedes. */
  updateAbductionVoice(distance) {
    const voice = this.abductionVoice;
    if (voice?.kind !== "capture" || !voice.channel || !this.context) return;
    if (!this.playerVoice) { this.stopAbductionVoice(); return; }
    this._ramp(voice.channel.gain.gain, voice.volume * (1 - smoothstep(10, 75, distance)), 0.1);
  }

  stopAbductionVoice(seconds = 0.06) {
    this._abductionVoiceToken = (this._abductionVoiceToken ?? 0) + 1;
    const voice = this.abductionVoice;
    this.abductionVoice = null;
    if (voice?.channel) {
      if (seconds > 0) this._fadeAndStop(voice.channel, seconds);
      else this._stop(voice.channel);
    }
  }

  /* ---- The weather (synthesized) ------------------------------------ */

  /** A second of noise, made once. */
  _noise() {
    if (this._noiseBuffer || !this.context) return this._noiseBuffer;
    const ctx = this.context;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    this._noiseBuffer = b;
    return b;
  }

  /** Rain, 0..1 (0 stops it): a hiss of filtered noise, looped. */
  rain(level = 0) {
    if (!this.context) this.unlock();
    const ctx = this.context;
    if (!ctx) return;
    this._ensureBuses();
    if (!this._rain && level > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this._noise();
      src.loop = true;
      const hi = ctx.createBiquadFilter();
      hi.type = "highpass";
      hi.frequency.value = 900;
      const lo = ctx.createBiquadFilter();
      lo.type = "lowpass";
      lo.frequency.value = 6500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hi).connect(lo).connect(gain).connect(this.buses.ambient);
      src.start();
      this._rain = { src, gain };
    }
    if (this._rain) {
      this._rain.gain.gain.setTargetAtTime(level * 0.16, ctx.currentTime, 0.8);
      if (level <= 0) {
        const r = this._rain;
        this._rain = null;
        setTimeout(() => { try { r.src.stop(); } catch {} }, 3000);
      }
    }
  }

  /** Thunder, 0..1 (nearer is louder and sharper): a crack, then the rumble rolling away. */
  thunder(power = 1) {
    const ctx = this.context;
    if (!ctx) return;
    this._ensureBuses();
    const t = ctx.currentTime;
    const p = Math.max(0.2, Math.min(1, power));
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    src.playbackRate.value = 0.5 + Math.random() * 0.2;
    const lo = ctx.createBiquadFilter();
    lo.type = "lowpass";
    lo.frequency.setValueAtTime(900 * p + 200, t);
    lo.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.55 * p, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.18 * p, t + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 4.2);
    src.connect(lo).connect(gain).connect(this.buses.sfx);
    src.start(t);
    src.stop(t + 4.4);
  }

  /* ---- The building ------------------------------------------------- */

  /** The fire alarm, 0..1, muffled 0..1 (a floor away, through concrete). */
  updateAlarm(level, muffle = 0) {
    this._setAmbient("fire-alarm", clamp(level) * LEVEL1_SFX_VOLUME.alarm, 0, { lowpass: muffle > 0.01 ? 16000 - clamp(muffle) * 15000 : 0 });
  }

  explosion(strength = 1, pan = 0) {
    this.play("explosion", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.3, 1.2), pan, cooldown: 0.15 });
  }

  /** Somewhere above or beyond: the building giving way. */
  distantCollapse(strength = 1) {
    this.play("distant-collapse", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.3, 1.2), cooldown: 1.5 });
  }

  /** The tower coming down (the Skyline's demolition, the ending). */
  buildingCollapse(strength = 1) {
    this._play("building-collapse", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), cooldown: 3 });
  }

  demolitionCharges(strength = 1) {
    this._play("demolition-charges", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), cooldown: 2 });
  }

  metalGroan(strength = 1, pan = 0) {
    this.play("metal-groan", { volume: LEVEL1_SFX_VOLUME.blast * 0.8 * clamp(strength, 0.2, 1.2), pan, cooldown: 1.2 });
  }

  /** Chunks coming down and settling. */
  debrisFall(strength = 1, pan = 0) {
    this._play("debris", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), pan, cooldown: 0.4 });
  }

  sprinklerBurst(pan = 0) {
    this._play("sprinkler-burst", { volume: LEVEL1_SFX_VOLUME.cue, pan, cooldown: 0.3 });
  }

  glassCascade(strength = 1) {
    this._play("glass-cascade", { volume: LEVEL1_SFX_VOLUME.cue * clamp(strength, 0.3, 1.2), cooldown: 1 });
  }

  async gameOver() {
    if (this.gameOverChannel) return;
    this.ended = true;
    this._applyAmbientTargets();
    for (const channel of this.falling.values()) this._fadeAndStop(channel, 0.1);
    this.falling.clear();
    this.gameOverChannel = await this._play("gameOver", { cooldown: 0.5 });
  }

  stopGameOver(seconds = 0.12) {
    const channel = this.gameOverChannel;
    this.gameOverChannel = null;
    if (!channel || !this.context) return;
    this._fadeAndStop(channel, seconds);
  }

  async startFalling(id) {
    if (this.falling.has(id)) return;
    const generation = this.generation;
    const buffer = await this._load("falling");
    if (!buffer || generation !== this.generation || this.falling.has(id)) return;
    // The supplied eight-second tree clip is much longer than the ~1 second
    // ceiling fall. Use its final 1.35 seconds, then stop on the real landing.
    const channel = await this._play("falling", { offset: Math.max(0, buffer.duration - 1.35), cooldown: 0 });
    if (channel) this.falling.set(id, channel);
  }

  stopFalling(id) {
    const channel = this.falling.get(id);
    if (!channel) return;
    this.falling.delete(id);
    this._fadeAndStop(channel, 0.1);
  }

  addGlassDebris(position, radius = 1.8) {
    if (!this.context) return;
    this.debris.push({ x: position.x, z: position.z, radius: clamp(radius, 1.2, 3.5), expires: this.context.currentTime + 5 });
    if (this.debris.length > 20) this.debris.shift();
  }

  updateBrokenGlass(position, moving) {
    if (!this.context || this.paused || this.ended || !moving) return;
    const now = this.context.currentTime;
    this.debris = this.debris.filter((zone) => zone.expires > now);
    const onGlass = this.debris.some((zone) => Math.hypot(position.x - zone.x, position.z - zone.z) <= zone.radius);
    if (onGlass && now - this.lastGlassStep >= 0.58) {
      this.lastGlassStep = now;
      this._play("glassStep", { cooldown: 0.52, playbackRate: 0.9 + Math.random() * 0.2 });
    }
  }

  updateEnvironment(environment) {
    if (!environment) return;
    const fire = environment.fire;
    const fireLevel = fire
      ? (1 - smoothstep(LEVEL1_SFX_RANGE.fireNear, LEVEL1_SFX_RANGE.fireMax, fire.distance)) * fire.intensity
      : 0;
    const water = environment.water;
    const waterLevel = water
      ? (1 - smoothstep(LEVEL1_SFX_RANGE.waterNear, LEVEL1_SFX_RANGE.waterMax, water.distance)) * water.flow
      : 0;
    this._setAmbient("fire", fireLevel * LEVEL1_SFX_VOLUME.fire, fire?.offsetX ?? 0);
    this._setAmbient("water", waterLevel * LEVEL1_SFX_VOLUME.water, water?.offsetX ?? 0);
  }

  /** Wind across the top of a tower (the Roof): 0..1. */
  updateWind(level) {
    this._setAmbient("wind", clamp(level) * LEVEL1_SFX_VOLUME.wind, 0);
  }

  updateElevator(velocity, active) {
    const level = active ? smoothstep(0.2, 5, Math.abs(velocity)) * LEVEL1_SFX_VOLUME.elevatorMechanical : 0;
    this._setAmbient("elevatorMechanical", level, 0, { seconds: LEVEL1_SFX_TIMING.elevatorMechanicalFade });
  }

  async _setAmbient(name, volume, offsetX, { lowpass = 0, rate = 1, seconds = 0.18 } = {}) {
    const desired = { volume, pan: clamp(offsetX / 7, -0.65, 0.65), lowpass, rate };
    let channel = this.ambient.get(name);
    if (channel === undefined && volume > 0.001 && this.context) {
      // A placeholder while it loads, so a second call does not start a second loop.
      this.ambient.set(name, null);
      (this.pendingAmbient ??= new Map()).set(name, desired);
      const generation = this.generation;
      const buffer = await this._load(name);
      if (generation !== this.generation || this.ambient.get(name) !== null) return;
      if (!buffer) { this.ambient.delete(name); return; }
      const ctx = this.context;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner?.() ?? null;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 20000;
      source.buffer = buffer;
      source.loop = true;
      // A loop blended across its seam (_prepareLoop) restarts after the blend;
      // others skip the encoder's silent padding at either end, so there is no gap.
      const [start, end] = loopBounds(buffer);
      source.loopStart = this.loopStarts.get(name) ?? start;
      source.loopEnd = this.loopStarts.has(name) ? buffer.duration : end;
      gain.gain.value = 0;
      let node = source.connect(filter);
      if (panner) node = node.connect(panner);
      node.connect(gain);
      gain.connect(this.buses.ambient);
      channel = { source, gain, panner, filter, desired: this.pendingAmbient.get(name) ?? desired };
      this.pendingAmbient.delete(name);
      this.ambient.set(name, channel);
      source.start(0, start);
      this._rampAmbient(channel, 0.18);
      return;
    }
    if (!channel) {
      // Still loading: remember the latest wish for when it is ready.
      this.pendingAmbient?.set(name, desired);
      return;
    }
    channel.desired = desired;
    this._rampAmbient(channel, seconds);
  }

  _rampAmbient(channel, seconds) {
    if (!this.context || !channel) return;
    const factor = this.paused ? 0 : this.ended ? 0.45 : 1;
    const d = channel.desired;
    this._ramp(channel.gain.gain, d.volume * factor, seconds);
    if (channel.panner) this._ramp(channel.panner.pan, d.pan, seconds);
    if (channel.filter) this._ramp(channel.filter.frequency, d.lowpass || 20000, seconds);
    if (d.rate && Math.abs(channel.source.playbackRate.value - d.rate) > 0.005) this._ramp(channel.source.playbackRate, d.rate, 0.5);
  }

  _applyAmbientTargets() {
    for (const channel of this.ambient.values()) this._rampAmbient(channel, 0.18);
  }

  /** Someone is talking: the beds (fire, alarm, wind) step back a little. */
  duckForVoice(on) {
    if (!this.buses || on === this.voiceDucked) return;
    this.voiceDucked = on;
    this._ramp(this.buses.ambient.gain, on ? 0.5 : 0.8, on ? 0.25 : 0.6);
  }

  /** Blend noisy ambience across its PCM boundary once, then loop the blend. */
  _prepareLoop(name, buffer, overlap) {
    const frames = Math.min(Math.floor(overlap * buffer.sampleRate), Math.floor(buffer.length / 4));
    if (frames < 2) { this.loopStarts.set(name, 0); return; }
    const tailStart = buffer.length - frames;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i += 1) {
        const mix = i / (frames - 1);
        samples[tailStart + i] = samples[tailStart + i] * Math.cos(mix * Math.PI * 0.5)
          + samples[i] * Math.sin(mix * Math.PI * 0.5);
      }
    }
    this.loopStarts.set(name, frames / buffer.sampleRate);
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.stopAbductionVoice();
    if (this.buses) this._ramp(this.buses.sfx.gain, paused ? 0 : 0.9, 0.12);
    this._applyAmbientTargets();
  }

  startLevel() {
    this.cleanupLevel();
    this.paused = false;
    this.ended = false;
  }

  cleanupLevel() {
    this.stopAbductionVoice(0);
    this.generation += 1;
    this.paused = false;
    this.ended = false;
    this.stopGameOver();
    for (const channel of this.ambient.values()) if (channel) this._fadeAndStop(channel, 0.12);
    for (const channel of this.falling.values()) this._fadeAndStop(channel, 0.08);
    for (const channel of [...this.gameplayChannels]) this._stop(channel);
    this.ambient.clear();
    this.pendingAmbient?.clear();
    this.falling.clear();
    this.gameplayChannels.clear();
    this.debris.length = 0;
    this.cooldowns.clear();
    this.lastGlassStep = -Infinity;
  }

  _ramp(param, value, seconds) {
    const now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.linearRampToValueAtTime(value, now + seconds);
  }

  _fadeAndStop(channel, seconds) {
    if (!this.context) return;
    this._ramp(channel.gain.gain, 0, seconds);
    try { channel.source.stop(this.context.currentTime + seconds + 0.02); } catch (error) {}
  }

  _stop(channel) {
    try { channel.source.stop(); } catch (error) {}
  }

  snapshot() {
    return {
      ambient: [...this.ambient.keys()],
      falling: this.falling.size,
      gameplayChannels: this.gameplayChannels.size,
      debrisZones: this.debris.length,
      gameOver: Boolean(this.gameOverChannel),
      paused: this.paused,
      ended: this.ended,
      loaded: this.buffers.size,
    };
  }
}

/**
 * Where a looped buffer's sound really starts and ends: an mp3 decoder may
 * leave the encoder's padding (exact silence) at either end, which a loop
 * would play as a gap.
 */
export function loopBounds(buffer) {
  const data = buffer.getChannelData(0);
  const quiet = 1e-4;
  let a = 0;
  let b = data.length - 1;
  const limit = Math.min(data.length >> 2, Math.round(buffer.sampleRate * 0.1));
  while (a < limit && Math.abs(data[a]) < quiet) a += 1;
  while (data.length - 1 - b < limit && Math.abs(data[b]) < quiet) b -= 1;
  return [a / buffer.sampleRate, (b + 1) / buffer.sampleRate];
}
