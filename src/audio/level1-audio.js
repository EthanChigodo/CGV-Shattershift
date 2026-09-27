/** Level 1 sound effects, sharing the music manager's unlocked AudioContext. */

export const LEVEL1_SFX_VOLUME = Object.freeze({
  fire: 0.24,
  impact: 0.34,
  water: 0.22,
  glass: 0.42,
  podBreak: 0.46,
  falling: 0.28,
  gameOver: 0.44,
  glassStep: 0.12,
  elevator: 0.36,
  throw: 0.26,
  pickup: 0.28,
  wall: 0.32,
  ui: 0.22,
});

export const LEVEL1_SFX_RANGE = Object.freeze({
  fireNear: 2.5,
  fireMax: 18,
  waterNear: 1.5,
  waterMax: 9,
});

const ASSETS = Object.freeze({
  fire: new URL("../../assets/audio/sound-effects/vanzetpictures-fire-457848.mp3", import.meta.url).href,
  impact: new URL("../../assets/audio/sound-effects/sumaga123-wood-hit-432148.mp3", import.meta.url).href,
  water: new URL("../../assets/audio/sound-effects/fire_sprinkler_water_flow_splash.wav", import.meta.url).href,
  glass: new URL("../../assets/audio/sound-effects/eaglaxle-glass-shattering-461637.mp3", import.meta.url).href,
  podBreak: new URL("../../assets/audio/sound-effects/universfield-glass-bottle-breaking-351297.mp3", import.meta.url).href,
  falling: new URL("../../assets/audio/sound-effects/dragon-studio-falling-tree-356127.mp3", import.meta.url).href,
  gameOver: new URL("../../assets/audio/sound-effects/universfield-marimba-game-over-250960.mp3", import.meta.url).href,
  glassStep: new URL("../../assets/audio/sound-effects/368343__johandeecke__glass-hit-32.wav", import.meta.url).href,
  elevator: new URL("../../assets/audio/sound-effects/wind1.wav", import.meta.url).href,
  throw: new URL("../../assets/audio/sound-effects/floraphonic-swing-whoosh-9-198502.mp3", import.meta.url).href,
  pickup: new URL("../../assets/audio/sound-effects/floraphonic-arcade-ui-6-229503.mp3", import.meta.url).href,
  wall: new URL("../../assets/audio/sound-effects/freesound_community-wall-hit-1-100717.mp3", import.meta.url).href,
  ui: new URL("../../assets/audio/sound-effects/justsomesounds-click-sound-432501.mp3", import.meta.url).href,
});

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
    this.buses = null;
    this.ambient = new Map();
    this.falling = new Map();
    this.gameOverChannel = null;
    this.gameplayChannels = new Set();
    this.cooldowns = new Map();
    this.debris = [];
    this.generation = 0;
    this.paused = false;
    this.ended = false;
    this.lastGlassStep = -Infinity;
  }

  unlock() {
    const context = this.getContext();
    if (!context) return false;
    this.context = context;
    this._ensureBuses();
    // Decode lazily, but begin fetching after the same gesture that unlocks music.
    for (const name of Object.keys(ASSETS)) this._load(name);
    return true;
  }

  _ensureBuses() {
    if (this.buses || !this.context) return;
    const make = (volume) => {
      const gain = this.context.createGain();
      gain.gain.value = volume;
      gain.connect(this.context.destination);
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
        .then((buffer) => { this.buffers.set(name, buffer); return buffer; })
        .catch((error) => {
          this.loads.delete(name);
          console.warn(`Level 1 sound effect could not be loaded: ${name}`, error);
          return null;
        });
      this.loads.set(name, request);
    }
    return this.loads.get(name);
  }

  async _play(name, { volume = LEVEL1_SFX_VOLUME[name], bus = "sfx", cooldown = 0, playbackRate = 1, offset = 0, gameplay = true } = {}) {
    if (!this.context || !this.buses) return null;
    const now = this.context.currentTime;
    const last = this.cooldowns.get(name) ?? -Infinity;
    if (cooldown && now - last < cooldown) return null;
    this.cooldowns.set(name, now);
    const generation = gameplay ? this.generation : null;
    const buffer = await this._load(name);
    if (!buffer || (gameplay && generation !== this.generation)) return null;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.buses[bus]);
    const channel = { source, gain, name };
    if (gameplay) this.gameplayChannels.add(channel);
    source.onended = () => {
      this.gameplayChannels.delete(channel);
      source.disconnect();
      gain.disconnect();
      if (this.gameOverChannel === channel) this.gameOverChannel = null;
    };
    source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.02)));
    return channel;
  }

  uiClick() { this._play("ui", { bus: "ui", cooldown: 0.035, gameplay: false }); }
  throwBall() { this._play("throw", { cooldown: 0.08 }); }
  serumCollected() { this._play("pickup"); }
  sphereCollected() { this._play("pickup"); }
  podBreak() { this._play("podBreak"); }
  wallRicochet() { this._play("wall"); }
  glassBreak() { this._play("glass", { cooldown: 0.045 }); }
  impact(strength = 1) {
    this._play("impact", { volume: LEVEL1_SFX_VOLUME.impact * clamp(strength, 0.55, 1.15), cooldown: 0.18 });
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
      this._play("glassStep", { cooldown: 0.52 });
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

  updateElevator(velocity, active) {
    const level = active ? smoothstep(0.2, 5, velocity) * LEVEL1_SFX_VOLUME.elevator : 0;
    this._setAmbient("elevator", level, 0);
  }

  async _setAmbient(name, volume, offsetX) {
    const desired = { volume, pan: clamp(offsetX / 7, -0.65, 0.65) };
    let channel = this.ambient.get(name);
    if (!channel && volume > 0.001 && this.context) {
      const generation = this.generation;
      const buffer = await this._load(name);
      if (!buffer || generation !== this.generation || this.ambient.has(name)) return;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner?.() ?? null;
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      if (panner) source.connect(panner).connect(gain);
      else source.connect(gain);
      gain.connect(this.buses.ambient);
      channel = { source, gain, panner, desired };
      this.ambient.set(name, channel);
      source.start();
    }
    if (!channel) return;
    channel.desired = desired;
    this._rampAmbient(channel, 0.18);
  }

  _rampAmbient(channel, seconds) {
    if (!this.context) return;
    const factor = this.paused ? 0 : this.ended ? 0.45 : 1;
    this._ramp(channel.gain.gain, channel.desired.volume * factor, seconds);
    if (channel.panner) this._ramp(channel.panner.pan, channel.desired.pan, seconds);
  }

  _applyAmbientTargets() {
    for (const channel of this.ambient.values()) this._rampAmbient(channel, 0.18);
  }

  setPaused(paused) {
    this.paused = paused;
    if (this.buses) this._ramp(this.buses.sfx.gain, paused ? 0 : 0.9, 0.12);
    this._applyAmbientTargets();
  }

  startLevel() {
    this.cleanupLevel();
    this.paused = false;
    this.ended = false;
  }

  cleanupLevel() {
    this.generation += 1;
    this.paused = false;
    this.ended = false;
    this.stopGameOver();
    for (const channel of this.ambient.values()) this._fadeAndStop(channel, 0.12);
    for (const channel of this.falling.values()) this._fadeAndStop(channel, 0.08);
    for (const channel of [...this.gameplayChannels]) this._stop(channel);
    this.ambient.clear();
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
    };
  }
}
