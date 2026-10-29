/**
 * The game's master bus: music, voices and effects all go through one gentle
 * limiter on their way out, so a stack of loud moments (an explosion over a
 * line of dialogue over the score) is held instead of clipping. In front of
 * it, the Settings' volumes: the master (everything), the music, and the
 * effects (glass, explosions, fire, machines, the HUD's blips) - voices take
 * the master alone.
 *
 *   source.connect(outputFor(ctx));    // voices: instead of ctx.destination
 *   source.connect(musicFor(ctx));     // the score
 *   source.connect(effectsFor(ctx));   // a sound effect
 *   setVolumes({ master: 0.8, music: 0.6, effects: 0.5 });   // 0..1, the sliders
 */

const OUTPUTS = new WeakMap();
/** Each context's music and effects gains, by kind. */
const BUSES = { music: new WeakMap(), effects: new WeakMap() };
/** Every context's gains, so a slider reaches all of them. */
const LIVE = new Set();
const LEVELS = { master: 1, music: 1, effects: 1 };

/** A slider's 0..1 as a gain: squared, so the middle of the slider sounds like half. */
const gainOf = (v) => Math.max(0, Math.min(1, v)) ** 2;

function set(node, value) {
  const ctx = node.context;
  node.gain.cancelScheduledValues(ctx.currentTime);
  node.gain.setTargetAtTime(value, ctx.currentTime, 0.03);
}

export function outputFor(ctx) {
  let out = OUTPUTS.get(ctx);
  if (!out) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    out = ctx.createGain();
    out.gain.value = gainOf(LEVELS.master);
    out.connect(limiter);
    OUTPUTS.set(ctx, out);
    LIVE.add({ kind: "master", node: out });
  }
  return out;
}

/** A kind of sound's own volume ("music", "effects"), on its way into the master. */
function busFor(ctx, kind) {
  let bus = BUSES[kind].get(ctx);
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = gainOf(LEVELS[kind]);
    bus.connect(outputFor(ctx));
    BUSES[kind].set(ctx, bus);
    LIVE.add({ kind, node: bus });
  }
  return bus;
}

export const musicFor = (ctx) => busFor(ctx, "music");
export const effectsFor = (ctx) => busFor(ctx, "effects");

/** The Settings' sliders (0..1 each; any may be left out). */
export function setVolumes({ master = LEVELS.master, music = LEVELS.music, effects = LEVELS.effects } = {}) {
  LEVELS.master = master;
  LEVELS.music = music;
  LEVELS.effects = effects;
  for (const { kind, node } of LIVE) {
    if (node.context.state === "closed") continue;
    set(node, gainOf(LEVELS[kind]));
  }
}
