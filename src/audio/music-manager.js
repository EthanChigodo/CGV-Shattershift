/**
 * Persistent background music for the application shell.
 *
 * Music lives above individual level objects so rebuilding a level does not
 * rebuild or seek its soundtrack. Tracks are decoded into AudioBuffers: most
 * wrap directly at the PCM boundary, while tracks configured for overlap have
 * their tail and opening blended once before the looping source starts.
 */

export const MUSIC_VOLUME = Object.freeze({
  story: 0.38,
  menu: 0.46,
  gameplay: 0.62,
  elevatorLevelBed: 0.04,
  elevator: 0.34,
  paused: 0.31,
  gameOver: 0.25,
  theme: 0.56,
});

export const MUSIC_TIMING = Object.freeze({
  crossfade: 1.0,
  storyLoopOverlap: 1.5,
  elevatorLoopOverlap: 1.2,
  duck: 0.35,
  restore: 0.6,
});

const TRACKS = Object.freeze({
  story: new URL("../../assets/audio/soundtracks/leberch-piano-story-601906.mp3", import.meta.url).href,
  menu: new URL("../../assets/audio/soundtracks/852268__holizna__trap-melody-loop-5-ebmin-165-bpm.wav", import.meta.url).href,
  round1: new URL("../../assets/audio/soundtracks/GalacticTemple.ogg", import.meta.url).href,
  elevator: new URL("../../assets/audio/soundtracks/freesound_community-lift-music-by-kk-30497.mp3", import.meta.url).href,
});

export class MusicManager {
  constructor({ tracks = TRACKS } = {}) {
    this.tracks = tracks;
    this.context = null;
    this.buffers = new Map();
    this.bufferPromises = new Map();
    this.loopStarts = new Map();
    this.channels = new Set();
    this.active = null;
    this.elevator = null;
    this.elevatorInside = false;
    this.elevatorTransition = 0;
    this.wantedTrack = null;
    this.baseVolume = 0;
    this.duck = null;
    this.transition = 0;
  }

  /** Called freely from user gestures; safe and silent when already unlocked. */
  async unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") {
      try { await this.context.resume(); } catch (error) { return false; }
    }
    if (this.context.state !== "running") return false;
    await this._applyIntent(this.transition);
    await this._applyElevatorIntent(this.elevatorTransition);
    return true;
  }

  showMenu() {
    this._setIntent("menu", MUSIC_VOLUME.menu, null, MUSIC_TIMING.crossfade);
  }

  showStory() {
    this._setIntent("story", MUSIC_VOLUME.story, null, MUSIC_TIMING.crossfade);
  }

  playRound1() {
    this._setIntent("round1", MUSIC_VOLUME.gameplay, null, MUSIC_TIMING.crossfade);
    // The lift is late in each route; warm its buffer now so the entry
    // crossfade never waits on a network/decode round trip.
    if (this.context?.state === "running") this._load("elevator");
  }

  /**
   * The main theme (the menu's track) over the ending and the credits: it
   * swells in slowly and carries on into the menu.
   */
  playTheme() {
    this._setIntent("menu", MUSIC_VOLUME.theme, null, 3.0);
  }

  fadeOut() {
    this._setIntent(null, 0, null, MUSIC_TIMING.crossfade);
  }

  /**
   * Make the lift's interior track primary without replacing the Level track.
   * The Level source keeps advancing quietly, so leaving the cabin restores
   * the same playback instance and position.
   */
  enterElevator() {
    if (this.elevatorInside || this.wantedTrack !== "round1") return;
    this.elevatorInside = true;
    this.elevatorTransition += 1;
    this._applyElevatorIntent(this.elevatorTransition);
    this._rampMusicMix(MUSIC_TIMING.crossfade);
  }

  /** A muted lift source is retained for this gameplay session for clean reversals. */
  exitElevator(seconds = MUSIC_TIMING.crossfade) {
    if (!this.elevatorInside) return;
    this.elevatorInside = false;
    this.elevatorTransition += 1;
    this._rampMusicMix(seconds);
  }

  pauseDuck() {
    this.duck = "paused";
    this._rampMusicMix(MUSIC_TIMING.duck);
  }

  gameOverDuck() {
    this.duck = "gameOver";
    this._rampMusicMix(MUSIC_TIMING.duck);
  }

  restore() {
    this.duck = null;
    this._rampMusicMix(MUSIC_TIMING.restore);
  }

  _setIntent(track, volume, duck, seconds) {
    if (track === "round1") this.exitElevator(seconds);
    else this._clearElevator(seconds);
    this.wantedTrack = track;
    this.baseVolume = volume;
    this.duck = duck;
    this.transition += 1;
    this._applyIntent(this.transition, seconds);
  }

  _targetVolume() {
    if (this.elevatorInside && this.active?.track === "round1") {
      return MUSIC_VOLUME.elevatorLevelBed * this._duckFactor();
    }
    if (this.duck === "paused") return MUSIC_VOLUME.paused;
    if (this.duck === "gameOver") return MUSIC_VOLUME.gameOver;
    return this.baseVolume;
  }

  _duckFactor() {
    if (this.duck === "paused") return MUSIC_VOLUME.paused / MUSIC_VOLUME.gameplay;
    if (this.duck === "gameOver") return MUSIC_VOLUME.gameOver / MUSIC_VOLUME.gameplay;
    return 1;
  }

  _elevatorTargetVolume() {
    return this.elevatorInside ? MUSIC_VOLUME.elevator * this._duckFactor() : 0;
  }

  async _load(track) {
    if (this.buffers.has(track)) return this.buffers.get(track);
    if (!this.bufferPromises.has(track)) {
      const request = fetch(this.tracks[track])
        .then((response) => {
          if (!response.ok) throw new Error(`Music request failed (${response.status}): ${this.tracks[track]}`);
          return response.arrayBuffer();
        })
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => {
          this._prepareLoop(track, buffer);
          this.buffers.set(track, buffer);
          return buffer;
        })
        .catch((error) => {
          this.bufferPromises.delete(track);
          console.warn("Background music could not be loaded.", error);
          return null;
        });
      this.bufferPromises.set(track, request);
    }
    return this.bufferPromises.get(track);
  }

  /**
   * Blend a track's tail into its opening, then loop back after that opening.
   * This keeps the first play intact and produces a real overlap on every
   * later wrap without timers or additional AudioBufferSourceNodes.
   */
  _prepareLoop(track, buffer) {
    const requested = track === "story"
      ? MUSIC_TIMING.storyLoopOverlap
      : track === "elevator" ? MUSIC_TIMING.elevatorLoopOverlap : 0;
    const frames = Math.min(Math.floor(requested * buffer.sampleRate), Math.floor(buffer.length / 4));
    if (frames < 2) { this.loopStarts.set(track, 0); return; }

    const tailStart = buffer.length - frames;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i += 1) {
        const mix = i / (frames - 1);
        const tailGain = Math.cos(mix * Math.PI * 0.5);
        const headGain = Math.sin(mix * Math.PI * 0.5);
        samples[tailStart + i] = samples[tailStart + i] * tailGain + samples[i] * headGain;
      }
    }
    this.loopStarts.set(track, frames / buffer.sampleRate);
  }

  async _applyIntent(token, seconds = MUSIC_TIMING.crossfade) {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running") return;
    const track = this.wantedTrack;
    if (!track) {
      this._retire(this.active, seconds);
      this.active = null;
      return;
    }
    if (this.active?.track === track) {
      this._rampActive(this._targetVolume(), seconds);
      return;
    }

    const buffer = await this._load(track);
    if (!buffer || token !== this.transition || track !== this.wantedTrack) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = this.loopStarts.get(track) ?? 0;
    source.loopEnd = buffer.duration;
    source.connect(gain);
    const channel = { track, source, gain, startedAt: now, buffer };
    this.channels.add(channel);
    source.onended = () => {
      this.channels.delete(channel);
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
    this._ramp(gain.gain, this._targetVolume(), seconds);

    const previous = this.active;
    this.active = channel;
    this._retire(previous, seconds);
  }

  async _applyElevatorIntent(token) {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running" || !this.elevatorInside || this.wantedTrack !== "round1") return;
    if (this.elevator) {
      this._rampMusicMix(MUSIC_TIMING.crossfade);
      return;
    }
    const buffer = await this._load("elevator");
    if (!buffer || token !== this.elevatorTransition || !this.elevatorInside || this.wantedTrack !== "round1") return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = this.loopStarts.get("elevator") ?? 0;
    source.loopEnd = buffer.duration;
    source.connect(gain);
    const channel = { track: "elevator", source, gain, startedAt: now, buffer };
    this.elevator = channel;
    this.channels.add(channel);
    source.onended = () => {
      this.channels.delete(channel);
      if (this.elevator === channel) this.elevator = null;
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
    this._rampMusicMix(MUSIC_TIMING.crossfade);
  }

  _rampMusicMix(seconds) {
    this._rampActive(this._targetVolume(), seconds);
    if (this.elevator) this._ramp(this.elevator.gain.gain, this._elevatorTargetVolume(), seconds);
  }

  _clearElevator(seconds) {
    this.elevatorInside = false;
    this.elevatorTransition += 1;
    const channel = this.elevator;
    this.elevator = null;
    this._retire(channel, seconds);
  }

  _rampActive(volume, seconds) {
    if (this.active) this._ramp(this.active.gain.gain, volume, seconds);
  }

  _ramp(param, value, seconds) {
    const now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  }

  _retire(channel, seconds) {
    if (!channel || !this.context) return;
    const now = this.context.currentTime;
    this._ramp(channel.gain.gain, 0, seconds);
    try { channel.source.stop(now + seconds + 0.05); } catch (error) {}
  }

  /** Read-only diagnostics used by local checks and the browser console. */
  snapshot() {
    let elapsed = null;
    if (this.active && this.context) {
      const raw = this.context.currentTime - this.active.startedAt;
      const duration = this.active.buffer.duration;
      const loopStart = this.loopStarts.get(this.active.track) ?? 0;
      elapsed = raw < duration ? raw : loopStart + ((raw - duration) % (duration - loopStart));
    }
    return {
      contextState: this.context?.state ?? "locked",
      wantedTrack: this.wantedTrack,
      activeTrack: this.active?.track ?? null,
      playbackSeconds: elapsed,
      volume: this.active?.gain.gain.value ?? 0,
      duck: this.duck,
      loopStartSeconds: this.active ? (this.loopStarts.get(this.active.track) ?? 0) : 0,
      sourceCount: this.channels.size,
      elevatorInside: this.elevatorInside,
      elevatorVolume: this.elevator?.gain.gain.value ?? 0,
      elevatorPlaybackSeconds: this._playbackSeconds(this.elevator),
    };
  }

  _playbackSeconds(channel) {
    if (!channel || !this.context) return null;
    const raw = this.context.currentTime - channel.startedAt;
    const duration = channel.buffer.duration;
    const loopStart = this.loopStarts.get(channel.track) ?? 0;
    return raw < duration ? raw : loopStart + ((raw - duration) % (duration - loopStart));
  }
}

