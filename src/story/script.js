/**
 * The story's words - every subtitle in every cutscene, in one place.
 *
 * Edit lines here without touching any code. Each scene is a list of lines;
 * a line is { who, text } plus optional timing:
 *
 *   at    seconds from the start of the scene (default: right after the
 *         previous line)
 *   hold  seconds on screen (default: from its length, see readTime)
 *   gap   pause after it before the next untimed line (default 0.25 s)
 *
 * `who` is a key into CAST. Stage directions go in [square brackets] - they
 * are shown in italics and get no voice blip.
 *
 * Names are placeholders the team allowed ("name them anything you want for
 * now"): change them in CAST and every scene follows.
 *
 * Every line is voiced (tools/audio/record.py; the recordings are listed in
 * src/audio/voice-lines.js). A subtitle stays up while its line is spoken;
 * after changing a line's words, run the generator again to re-record it
 * (until then it plays the old blip).
 */

import { VOICE_LINES } from "../audio/voice-lines.js";

export const GAME_TITLE = "FRACTURE RUN";

/**
 * The end credits' own lines (the asset credits come from the credits data).
 * A role with no `names` shows the team's name.
 */
export const STORY_CREDITS = {
  team: "Driven by Design",
  // The group, together - by surname, no one credited with a part: the
  // game is the team's.
  members: ["Ethan Chigodo", "Nkosilathi Dube", "Hlakulo Hlungwani", "Victor Hyginus", "Athalia Mamba", "Tebogo Sebopela"],
  cast: [
    ["Subject 07", "You"],
    ["Dr. Elias Okoro", "scientist_good.glb"],
    ["Dr. Vale", "scientist_evil.glb"],
    ["HALCYON", "The building"],
  ],
  thanks: "Thank you for playing.",
};

export const CAST = {
  okoro: { name: "DR. OKORO", colour: "#6fe3d6", pitch: 1.0 },
  vale: { name: "DR. VALE", colour: "#ff5a4e", pitch: 0.72 },
  pilot: { name: "PILOT", colour: "#c9d1d6", pitch: 0.72 },
  halcyon: { name: "HALCYON", colour: "#ffb547", pitch: 1.5 },
  trailer: { name: "", colour: "#eef4f6", pitch: 0.8 },
  you: { name: "07", colour: "#e8eef2", pitch: 1.15 },
  sfx: { name: "", colour: "#9aa7ad", pitch: 0 },
};

/** Seconds a line stays up: enough to read it twice. */
export function readTime(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1.6, 0.9 + words * 0.32);
}

/**
 * Seconds a line takes: a recorded line as long as it is said (and a breath),
 * so the next one follows straight on; one nobody says (a sound cue, or not
 * recorded yet) long enough to read. An authored hold is kept, but never
 * shorter than the recording.
 */
export function lineHold(line) {
  const spoken = spokenTime(line);
  if (!spoken) return line.hold ?? readTime(line.text);
  return Math.max(line.hold ?? 0, spoken + 0.3);
}

/** Seconds the line's recording speaks for (0: it has none). */
function spokenTime(line) {
  const key = line.text.trim() === "[laughs]" ? "#laugh-maniac" : `${line.who}|${line.text}`;
  return VOICE_LINES[key]?.[1] ?? 0;
}

/**
 * Seconds a line's subtitle stays up: while it is said, and a beat after -
 * not the rest of its slot in the scene (nobody is talking by then). A line
 * nobody says (a sound cue, or not recorded) keeps its whole slot.
 */
export function subtitleTime(line, hold = lineHold(line)) {
  const spoken = spokenTime(line);
  return spoken ? Math.min(hold, Math.max(spoken + 0.25, 1)) : hold;
}

/** Lay out a scene's untimed lines one after another. Returns new objects. */
export function timeLines(lines, start = 0) {
  let t = start;
  return lines.map((line) => {
    const at = line.at ?? t;
    const hold = lineHold(line);
    t = at + hold + (line.gap ?? 0.25);
    return { ...line, at, hold };
  });
}

/** Total length of a timed line list. */
export function linesEnd(lines) {
  return lines.reduce((end, l) => Math.max(end, l.at + l.hold), 0);
}

export const SCENES = {
  /* ---- Phase 2: the opening --------------------------------------- */

  /** 1. Waking from anaesthesia. Okoro over the bed. */
  wake: [
    { who: "sfx", text: "[a slow monitor beep]", at: 0.6, hold: 2.2 },
    { who: "halcyon", text: "Demolition sequence armed. Ascension Tower will be cleared in thirty minutes.", at: 2.4 },
    { who: "okoro", text: "Seven? Seven - can you hear me?", gap: 0.6 },
    { who: "okoro", text: "Easy - don't sit up yet. The anaesthetic's still in you. Breathe... just breathe." },
    { who: "okoro", text: "I'm Elias Okoro. I work here. I'm sorry - I worked here." },
    { who: "okoro", text: "They're blowing up the building! With everyone still in it - with you in it!" },
    { who: "okoro", text: "I need you on your feet - now! Come on, come on - up!" },
    { who: "okoro", text: "Basement first! The service tunnels go round the security doors - stay close to me." },
  ],

  /** 1b. Out of the ward, down the service passage, into the foundry. */
  walkOut: [
    { who: "okoro", text: "This way - quickly! Stay right behind me.", at: 0.8 },
  ],

  /**
   * 2. The Foundry: Okoro talks while you run. Not a cutscene - each line
   * fires when the run reaches `atRoute` (0 = start, 1 = the lift). A line
   * that comes due while another is still up waits for it.
   *
   * `cue` makes Okoro act on the line: "handoff" - he tosses you the bag of
   * glass spheres, which you wear from then on (the counter fills when you
   * catch it); "point" - he points at the next switch.
   * The first switch is ~40 m in, so the hand-off and the lesson come first.
   */
  foundryTalk: [
    { who: "okoro", atRoute: 0.003, cue: "handoff", text: "Here - catch! A bag of glass spheres. They break any glass in this tower." },
    { who: "okoro", atRoute: 0.035, cue: "point", text: "See the glass cells? They're switches - break one and the gate opens!" },
    { who: "okoro", atRoute: 0.085, text: "This is the old foundry. The machines run on their own - don't stop moving!" },
    { who: "okoro", atRoute: 0.22, text: "You want to know what you are? You were Subject 07. Project Ascension!" },
    { who: "okoro", atRoute: 0.33, text: "They grew things in the labs upstairs - 'fixed' people! That's what Vale called it." },
    { who: "okoro", atRoute: 0.44, text: "Vale ran the programme. And when the board came asking questions - he armed the charges instead!" },
    { who: "okoro", atRoute: 0.55, text: "No subjects, no evidence. I couldn't - I couldn't let that happen to you!" },
    { who: "okoro", atRoute: 0.67, text: "There's a helicopter coming for the roof before the countdown ends - that's our way out!" },
    { who: "okoro", atRoute: 0.8, text: "The service lift's just ahead! It goes straight up through the labs." },
    { who: "okoro", atRoute: 0.93, text: "Almost there! Don't look at the counter - just run!" },
  ],

  /* ---- Phase 3: the Gravity Fault lift ------------------------------- */

  /** 3a. The lift lurches; Okoro drops the launcher; you pick it up. */
  liftFault: [
    { who: "halcyon", text: "Gravity fault. Brake failure, cables two and four." },
    { who: "okoro", text: "Hold on to something!" },
    { who: "sfx", text: "[the launcher clatters across the floor]", hold: 1.6 },
    { who: "okoro", text: "The clamps - I can't reach them! Seven, take it!" },
  ],
  /** Shouted between break points (one per break, in order). */
  liftBreaks: [
    { who: "okoro", text: "That one! Hit it!" },
    { who: "okoro", text: "Again - the next one's going!" },
    { who: "okoro", text: "Faster, Seven - faster!" },
    { who: "okoro", text: "Last one - hold it, HOLD IT!" },
  ],
  liftSaved: [
    { who: "sfx", text: "[the brakes catch]", hold: 1.4 },
    { who: "okoro", text: "...You've done that before." },
    { who: "okoro", text: "Keep it. You're better with it than I'll ever be." },
  ],
  liftFall: [{ who: "sfx", text: "[the last cable snaps]", hold: 2 }],

  /* ---- Phase 4: the Labs ------------------------------------------- */

  /** 4. The breach. */
  breach: [
    { who: "halcyon", text: "Containment failure. All incubators open." },
    { who: "okoro", text: "No... no, no, no! Those were sealed!" },
    { who: "sfx", text: "[glass, everywhere, all at once]", hold: 1.6 },
    { who: "okoro", text: "They're out - all of them! Stay in front of me, you've got the gun!" },
    { who: "vale", text: "Elias. You always did get attached to the subjects.", gap: 0.4 },
    { who: "vale", text: "Enjoy your last half hour." },
    { who: "okoro", text: "The lift's at the far end of the labs - go, GO!" },
  ],

  /** 5. A mutant jumps you at a bend. */
  bendAttack: [
    { who: "sfx", text: "[it hits you from the side]", hold: 1.2 },
    { who: "okoro", text: "SEVEN! Push it off - PUSH!" },
  ],
  bendSaved: [
    { who: "okoro", text: "Down!" },
    { who: "sfx", text: "[a pistol shot]", hold: 1.2 },
    { who: "okoro", text: "Are you hurt? ...Good. Keep going." },
  ],

  /** 6. Behind the desk; the lift is blocked; Okoro goes. */
  hide: [
    { who: "okoro", text: "Down - get behind the desk!" },
    { who: "you", text: "[breathing hard]", hold: 1.8 },
    { who: "okoro", text: "There are too many of them... between us and the lift." },
    { who: "okoro", text: "Listen to me. When I go left - you go right. Don't stop. For anything." },
    { who: "you", text: "...", hold: 1.4 },
    { who: "okoro", text: "You were never a subject to me. You were a patient. My patient." },
    { who: "okoro", text: "Take the bag. Everything I found is in it. You'll need it on the roof." },
    { who: "okoro", text: "Now - GO!" },
    { who: "okoro", text: "OVER HERE! COME ON, OVER HERE!", gap: 0.6 },
    { who: "sfx", text: "[the shouting stops]", hold: 2.4 },
  ],

  /* ---- Phase 5: the Skyline and the roof ----------------------------- */

  /** 8a. The tower behind you goes up. */
  blast: [
    { who: "halcyon", text: "Detonation, lower tower." },
    { who: "sfx", text: "[the bridge starts to go]", hold: 1.4 },
  ],
  /** 8b. Pulled up onto the next building, on your back, looking at the sky. */
  latched: [
    { who: "you", text: "[you pull yourself up]", hold: 1.8 },
    { who: "you", text: "[breathing - slower now]", hold: 2.4, gap: 0.6 },
    { who: "halcyon", text: "Detonation in eight minutes." },
  ],
  fallen: [{ who: "sfx", text: "[the wind]", hold: 2 }],

  /*
   * Dr. Vale on the intercom during play (story runs only, no letterbox):
   * the Labs when the power dies, and the roof when the first wave is let out.
   */
  valeBlackout: [{ who: "vale", text: "Lights out, Seven. My patients never needed them." }],
  valeRoof: [{ who: "vale", text: "Did you think I'd leave the roof unguarded? Say hello to my children." }],

  /* ---- Phase 6: the ending ------------------------------------------- */

  ending: [
    { who: "pilot", text: "Hold on back there. It's a rough lift-off." },
    { who: "you", text: "...Thank you." },
    { who: "pilot", text: "Don't thank me. I'm only here to collect.", gap: 0.8 },
    { who: "vale", text: "Hello, Seven. Elias always said you were special." },
    { who: "vale", text: "He was right. Anaesthesia to the roof in thirty minutes. I couldn't have designed a better field test." },
    { who: "vale", text: "Don't worry about the tower. Fire is very good at keeping secrets." },
    { who: "vale", text: "[laughs]", hold: 2.4 },
  ],
};
