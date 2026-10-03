/**
 * A short "voice" blip under each subtitle line - there is no voice acting,
 * and silent subtitles read as broken. Three soft syllables, pitched per
 * speaker (CAST[who].pitch in script.js), synthesised on the host's context.
 *
 *   const voice = new StoryVoice(() => audioContext);
 *   voice.blip("okoro");
 */

import { CAST } from "./script.js";

export class StoryVoice {
  constructor(getContext, { volume = 0.08 } = {}) {
    this.getContext = getContext;
    this.volume = volume;
    this.muted = false;
  }

  blip(who) {
    const pitch = CAST[who]?.pitch ?? 1;
    const ctx = this.getContext?.();
    if (!ctx || this.muted || !pitch || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 * pitch;
    filter.Q.value = 1.4;
    filter.connect(out);
    for (let i = 0; i < 3; i += 1) {
      const at = now + i * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(170 * pitch * (1 + (i % 2) * 0.12 - i * 0.04), at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.065);
      osc.connect(gain).connect(filter);
      osc.start(at);
      osc.stop(at + 0.08);
    }
  }
}
