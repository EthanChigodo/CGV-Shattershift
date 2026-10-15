/**
 * Cut the trailer: the captured clips (capture.mjs), the title cards
 * (cards.mjs) and the game's own music and sounds, into
 * dist/trailer/fracture-run-trailer.mp4 (1920x1080, 30 fps).
 *
 *   FFMPEG=path/to/ffmpeg node tools/trailer/assemble.mjs
 *
 * The edit is the EDIT list below: a moody opening on the briefing's piano,
 * the characters frozen GTA-style with their names, then the title on the
 * drop of the menu's trap loop (165 BPM - every cut after it lands on a bar)
 * and the run through all four places, ending on the helicopter.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { ffmpeg } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = process.env.TRAILER_OUT ?? path.join(ROOT, "dist", "trailer");
const clip = (name) => path.join(OUT, "clips", `${name}.mp4`);
const card = (name) => path.join(OUT, "cards", `${name}.png`);
const audio = (file) => path.join(ROOT, "assets", "audio", file);

const BAR = (60 / 165) * 4; // one bar of the trap loop, in seconds
const FPS = 30;

/**
 * The edit. Each entry is one shot on screen:
 *   clip, from, dur     a stretch of a captured clip
 *   freeze              hold its first frame instead, comic-book style (GTA's character art)
 *   black               nothing but the card
 *   card                a title card laid over it (fading in and out)
 *   fade                fade in from / out to black (the opening)
 *   sfx                 a sound on the cut: shatter, whoosh, boom
 * `drop: true` marks where the music changes from the piano to the trap loop.
 */
const EDIT = [
  // ---- The opening: the tower, and what is happening in it --------------------------
  { clip: "lift-ride", from: 2.2, dur: 4.6, card: "tower", fade: true },
  { clip: "char-okoro", from: 0.6, dur: 3.6, card: "vo-halcyon", fade: true },
  { clip: "char-breach", from: 1.5, dur: 4.0, card: "vo-vale", fade: true },
  { clip: "skyline-blast", from: 3.0, dur: 3.8, card: "vo-okoro", fade: true, sfx: "boom" },
  // ---- Who's who ----------------------------------------------------------------------
  { clip: "char-07", from: 0.8, dur: 1.9 },
  { clip: "slowmo-shock", from: 1.2, dur: 1.7, freeze: true, card: "name-07", sfx: "whoosh" },
  { clip: "char-okoro", from: 4.0, dur: 1.2 },
  { clip: "char-okoro", from: 5.2, dur: 1.7, freeze: true, card: "name-okoro", sfx: "whoosh" },
  { clip: "skyline-blast", from: 1.0, dur: 1.2 },
  { clip: "skyline-blast", from: 2.3, dur: 1.7, freeze: true, card: "name-vale", sfx: "whoosh" },
  // ---- The drop -------------------------------------------------------------------------
  { black: true, dur: BAR, card: "title", drop: true, sfx: "shatter" },
  // ---- Sector 01 -------------------------------------------------------------------------
  { clip: "foundry-front", from: 1.0, dur: 2 * BAR, card: "sector-1", sfx: "whoosh" },
  { clip: "foundry-low", from: 1.0, dur: BAR },
  { clip: "foundry-side", from: 0.8, dur: BAR },
  { clip: "foundry-escape", from: 0.5, dur: BAR, card: "feat-difficulty" },
  { clip: "foundry-drone", from: 0.5, dur: BAR },
  // ---- Between: the Gravity Fault -------------------------------------------------------
  { clip: "lift-ride", from: 14.2, dur: 2 * BAR, sfx: "shatter" },
  // ---- Sector 02 -------------------------------------------------------------------------
  { clip: "labs-front", from: 1.0, dur: 2 * BAR, card: "sector-2", sfx: "whoosh" },
  { clip: "labs-low", from: 1.5, dur: BAR, sfx: "shatter" },
  { clip: "labs-fire", from: 1.0, dur: BAR },
  { clip: "labs-blackout", from: 1.0, dur: 2 * BAR },
  { clip: "slowmo-shock", from: 0.2, dur: 2 * BAR, card: "feat-break", sfx: "shatter" },
  // ---- Sector 03 -------------------------------------------------------------------------
  { clip: "skyline-glass", from: 1.0, dur: 2 * BAR, card: "sector-3", sfx: "whoosh" },
  { clip: "skyline-blast", from: 5.4, dur: BAR, sfx: "boom" },
  { clip: "skyline-atrium", from: 0.5, dur: 2 * BAR },
  // ---- The Roof ---------------------------------------------------------------------------
  { clip: "roof-orbit", from: 1.0, dur: 2 * BAR, card: "sector-4", sfx: "whoosh" },
  { clip: "roof-chaos", from: 2.9, dur: BAR },
  { clip: "slowmo-cryo", from: 0.3, dur: BAR, card: "feat-spheres", sfx: "shatter" },
  { clip: "roof-heli", from: 0.8, dur: 3 * BAR },
  // ---- The end -----------------------------------------------------------------------------
  { end: true, dur: 5.5, sfx: "boom" },
];

const SFX = {
  shatter: { file: "sound-effects/eaglaxle-glass-shattering-461637.mp3", volume: 0.9 },
  whoosh: { file: "sound-effects/floraphonic-swing-whoosh-9-198502.mp3", volume: 0.8 },
  boom: { file: "sound-effects/dragon-studio-falling-tree-356127.mp3", volume: 0.9 },
};
const PIANO = audio("soundtracks/leberch-piano-story-601906.mp3");
const TRAP = audio("soundtracks/852268__holizna__trap-melody-loop-5-ebmin-165-bpm.wav");
/** Letterbox bars, top and bottom, in pixels (of 1080). */
const BARS = 92;

async function main() {
  const inputs = [];
  const filters = [];
  const labels = [];
  const add = (args) => { inputs.push(...args); return inputs.filter((a) => a === "-i").length - 1; };

  let t = 0;
  let dropAt = null;
  const cues = []; // [seconds, sfx]
  for (const [i, s] of EDIT.entries()) {
    const d = s.dur;
    let v;
    if (s.end) {
      const n = add(["-loop", "1", "-t", String(d), "-i", card("end")]);
      filters.push(`[${n}:v]fps=${FPS},scale=1920:1080,format=yuv420p,fade=in:st=0:d=0.4,fade=out:st=${(d - 1.4).toFixed(3)}:d=1.4[s${i}]`);
    } else if (s.black) {
      const n = add(["-f", "lavfi", "-t", String(d), "-i", `color=black:s=1920x1080:r=${FPS}`]);
      filters.push(`[${n}:v]format=yuv420p[b${i}]`);
      v = `b${i}`;
    } else {
      if (!existsSync(clip(s.clip))) throw new Error(`missing clip ${s.clip} - run capture.mjs first`);
      if (s.freeze) {
        // One frame, held, drawn like a comic: flat colours under ink outlines, a white flash in.
        const n = add(["-ss", String(s.from), "-i", clip(s.clip)]);
        const frames = Math.round(d * FPS);
        filters.push(
          `[${n}:v]trim=end_frame=1,loop=loop=${frames - 1}:size=1:start=0,setpts=N/${FPS}/TB,fps=${FPS},scale=1920:1080,hqdn3d=4:4:6:6,format=gbrp,split[fa${i}][fb${i}]`,
          `[fa${i}]eq=saturation=1.35:contrast=1.2:gamma=1.05,format=gbrp,lutrgb=r='trunc(val/32)*32+16':g='trunc(val/32)*32+16':b='trunc(val/32)*32+16',format=gbrp[fp${i}]`,
          `[fb${i}]edgedetect=low=0.04:high=0.11,dilation,negate,format=gbrp[fe${i}]`,
          `[fp${i}][fe${i}]blend=all_mode=multiply,vignette=PI/5,format=yuv420p,fade=in:st=0:d=0.18:color=white[f${i}]`,
        );
        v = `f${i}`;
      } else {
        const n = add(["-ss", String(s.from), "-t", String(d + 0.2), "-i", clip(s.clip)]);
        const fade = s.fade ? `,fade=in:st=0:d=0.5,fade=out:st=${(d - 0.5).toFixed(3)}:d=0.5` : "";
        filters.push(`[${n}:v]trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},scale=1920:1080,format=yuv420p${fade}[c${i}]`);
        v = `c${i}`;
      }
    }
    if (!s.end) {
      if (s.card) {
        const n = add(["-loop", "1", "-t", String(d), "-i", card(s.card)]);
        filters.push(
          `[${n}:v]fps=${FPS},format=rgba,fade=in:st=0:d=0.25:alpha=1,fade=out:st=${Math.max(0, d - 0.3).toFixed(3)}:d=0.3:alpha=1[k${i}]`,
          `[${v}][k${i}]overlay=0:0:shortest=1,format=yuv420p[s${i}]`,
        );
      } else filters.push(`[${v}]null[s${i}]`);
    }
    labels.push(`[s${i}]`);
    if (s.drop) dropAt = t;
    if (s.sfx) cues.push([t, s.sfx]);
    t += d;
  }
  const total = t;
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0,` +
    `drawbox=x=0:y=0:w=iw:h=${BARS}:color=black:t=fill,drawbox=x=0:y=ih-${BARS}:w=iw:h=${BARS}:color=black:t=fill[vout]`);

  // ---- Sound: the piano until the drop, the trap loop from it, effects on the cuts. ----
  const piano = add(["-i", PIANO]);
  const trap = add(["-stream_loop", "-1", "-i", TRAP]);
  const mix = [];
  filters.push(`[${piano}:a]atrim=0:${(dropAt + 0.2).toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${(dropAt - 1.2).toFixed(3)}:d=1.4,volume=0.85,aresample=48000[pa]`);
  mix.push("[pa]");
  const tail = total - dropAt;
  filters.push(`[${trap}:a]atrim=0:${tail.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${(tail - 3).toFixed(3)}:d=3,volume=0.9,aresample=48000,adelay=${Math.round(dropAt * 1000)}:all=1[ta]`);
  mix.push("[ta]");
  for (const [j, [at, kind]] of cues.entries()) {
    const n = add(["-i", audio(SFX[kind].file)]);
    filters.push(`[${n}:a]atrim=0:3,afade=t=out:st=2:d=1,volume=${SFX[kind].volume},aresample=48000,adelay=${Math.max(0, Math.round(at * 1000 - 60))}:all=1[x${j}]`);
    mix.push(`[x${j}]`);
  }
  filters.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},alimiter=limit=0.95[aout]`);

  const output = path.join(OUT, "fracture-run-trailer.mp4");
  console.log(`${EDIT.length} shots, ${total.toFixed(1)} s, drop at ${dropAt.toFixed(1)} s`);
  await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output], { quiet: false });
  console.log(`-> ${path.relative(ROOT, output)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
