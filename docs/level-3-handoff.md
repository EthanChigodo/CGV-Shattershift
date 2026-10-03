# Level 3 handoff notes

**Read this first if you're a new session picking up Level 3 work.** It's
written so you don't have to re-derive context from scratch or make the user
retype decisions. For full design detail (numbers, tables, rationale) see
[`level-3-meltdown.md`](./level-3-meltdown.md) - this is the shorter "what's
the state of things and how do I get moving" version.

Last updated: the session building the story cutscenes (§0.3 - phase
table there shows what's done). Before that it reordered the story
(Foundry -> Labs -> Skyline -> Roof), added Endless for every environment,
and brought Level 1's glass physics and sound to every level.

---

## 0. Where the game is going - the team's plan

This is the user's (and team's) direction for the whole game, in their
words where possible. §0.2 is **built**; §0.3 is **being built** (see its phase table); §0.4 is
**planned** - build it only when asked.

### 0.1 Why the order changed

The original order didn't make sense for a building you escape *upwards*:

| Now | Was | Environment | Why it's here |
| --- | --- | --- | --- |
| **Sector 01** | Level 2 | The Shifting Foundry | It's a **basement** - the lowest floor of the building, so it's where you start. |
| **Sector 02** | Level 3 (Phase A) | The Meltdown's corridors - "the Labs" | It's **set in the labs**, the middle of the building. |
| **Sector 03** | Level 1 | The Glass Causeway - "the Skyline" | It's **up in the skyline** (skybridges, glass, the city below), which leads naturally to the roof. |
| **Finale** | Level 3 (Phase B) | The Roof | The **helipad** - the helicopter out. |

You ride a lift up between each stage.

### 0.2 What's built for it (this session)

- The story runs Foundry -> Labs -> Skyline -> Roof, with the sector numbers
  in every HUD renumbered to match.
- Foundry -> Labs: you run into the glass Calibration Lift and the
  teammate's **Gravity Fault** ride takes over (`src/elevators/`: tremors,
  the cable snaps, free fall, shoot the brake clamps; Level 3's launcher
  crashes through the lift roof and Subject 07 picks it up - which is why
  you have it in the Labs).
- Labs -> Skyline: the glass lift at the end of the Labs' corridor.
- The Skyline **no longer starts in the pod**: you arrive in the glass lift,
  the doors open, you step out awake and at full pace (no sedated start).
  (Decided: "replaced with a lift arrival".)
- Skyline -> Roof: the Causeway's own Calibration Lift, then the roof's lift
  housing. The Roof is the finale (decided: "the roof and helicopter move to
  the very end").
- **Weapons stay as they are** (decided): spheres by hand in the Foundry and
  the Skyline, the launcher in the Labs and on the Roof.
- **Endless**, separate from the story (the user's request: "an endless
  for all the levels ... each environment so they can choose, including the
  roof ... a separate setting from the storyline"): menu -> Endless -> pick
  the Foundry, the Labs, the Skyline or the Roof. Best result kept per
  environment.
- **Level 1's physics and sound everywhere** (the user's request: "add the
  cool physics and sound from the previous level 1 to all the levels"):
  - Glass shards: `src/fx/shatter.js` (`ShatterFX`) wraps Level 1's GPU
    shard shaders (`causeway/shaders/particles.js`) with its own small
    reflection cube map. Panes in the Labs fracture radially around the hit
    point; everything else (Foundry cells and switches, sacks, power-ups,
    roof sacks) bursts into tumbling chunks that bounce once on the floor.
  - Throws in the Foundry: the Glass sphere's gravity arc (aim-compensated),
    floor bounce, ricochet off hazards, grazes on small targets, and glass
    spheres punching through cells, as in Level 1. The Labs and Roof keep
    the launcher (it already had ball gravity, ricochets and bounces).
  - Sound: `Level1Audio` (the sampled Level 1 effects) plays in every level
    - throw, glass break, broken glass underfoot, ricochet, impact, pickups,
    game over, the lift hum; fire ambience in the Labs. `MeltdownGame` takes
    the host's instance (`sfx` option); standalone (the preview) it makes
    its own on its audio context. It layers on top of the Labs' synthesised
    `MeltdownAudio`, which is unchanged.

### 0.3 The story and its cutscenes (being built now, in phases)

The user's plan, agreed in detail (the user said "go with your
suggestions"). **All cutscenes are first person.** Dialogue is subtitles
(speaker-coloured, a short blip per line - no voice acting). Story only;
Endless has no cutscenes.

**Cast** (names are placeholders the user allowed - "name them anything you
want for now"):

- **Subject 07** - the player (scrubs, picked at the start).
- **Dr. Elias Okoro** - the good scientist ("he"). Model:
  `assets/meltdown/scientist_good.glb` (a teammate's, no animation - animated
  in code by `HumanoidRig`). Carries a bag of everything he collected.
- **Dr. Vale** - the villain. Already in the game as the voice who armed
  the charges; he is the **helicopter pilot** in the final twist. Model:
  `assets/meltdown/scientist_evil.glb`. Okoro names him early (Foundry
  walk), and he should appear once on a monitor/intercom in the Labs, so the
  twist lands.

**Beats, in order:**

1. **Wake-up (cutscene).** Blurry, blinking first person; Okoro wakes you
   from anaesthesia, urgent: they have to hurry.
2. **To the basement / the Foundry (gameplay + subtitles).** Okoro leads
   (runs a few metres ahead, unaffected by hazards) and explains what's going
   on as you go. He hands you spheres from his bag. The user allowed
   changing the Foundry's obstacles if it helps the story.
3. **Foundry -> Labs elevator (the teammate's Gravity Fault ride).** Okoro
   holds the launcher; instead of the gun appearing, **he drops it and you
   pick it up** to stabilise the lift, then he lets you keep it ("you're
   good with it"). The ride's shooting becomes **reaction button hits**: one
   sequence per break point, harder each time (single key -> two-key combo
   -> 3-4 key sequences with shorter windows -> a mash bar on the last).
   Miss one and the lift falls - you die and **retry at that reaction, not
   the whole cutscene**. (User: the teammate "will be fine with it".)
4. **Labs: the breach (cutscene).** The incubators fail; the mutants get
   out and scatter. You and Okoro head for the elevator.
5. **Labs: the bend attack (cutscene).** A mutant jumps you at a bend; mash
   to hold it off until Okoro shoots it (he keeps a pistol from the bag).
6. **Labs: the elevator is blocked (cutscene).** Mutants between you and
   the lift; you hide behind a desk and talk; Okoro creates a distraction and
   sacrifices himself so you reach the lift (heard more than seen - the
   models have no death animation).
7. **The lift up (cutscene).** Panting, grieving.
8. **The Skyline (gameplay as now)**, then near the end of the bridge **the
   tower behind you blows (cutscene)**; **mash two keys** to sprint as the
   bridge comes down; **jump**; a **double reaction hit to latch** onto the
   next building's edge - miss and you fall. You **pull yourself up, lie on
   your back looking at the sky, exhale**, get up and walk to that
   building's elevator up to the roof.
9. **The Roof (gameplay as now)**; the helicopter jump uses the **same
   double-reaction latch**.
10. **Ending (cutscene).** In the helicopter talking to the pilot; the
    camera turns - the pilot is **Dr. Vale**; a dark joke, an evil laugh;
    fade to black as it flies off; **the game's title**; then the credits.

**Agreed details:** hold Esc to skip any cutscene; a failed reaction
retries at the reaction; a settings toggle for longer reaction windows and
"hold instead of mash"; all dialogue in one script file so the team can edit
lines without touching code.

**Phases** (commit and push after each):

| Phase | What | Status |
|---|---|---|
| 1 | Shared systems: dialogue script, cutscene player (first-person camera, letterbox, subtitles, skip), reaction hits, the scientist companion, a preview page and tests | **in progress** |
| 2 | Opening: wake-up, the walk to the basement, Okoro in the Foundry | planned |
| 3 | The elevator: gun drop, reaction hits, death and retry | planned |
| 4 | Labs: breach, bend attack, hiding + sacrifice, grief in the lift | planned |
| 5 | Skyline and roof: explosion, sprint, jump and latch; helicopter latch | planned |
| 6 | Ending: pilot reveal, title card, credits | planned |
| 7 | Graphics pass (requested by the team): more realistic running physics/animation, lighting and textures | planned |

### 0.4 Other wishes (planned)

- **Bring the Glass Causeway's visuals and obstacles into the Labs** - "stuff
  like the spinning glass" (the rotating sculpture: a steel pole with glass
  blades sweeping the outer lanes), and similar. Note: the Causeway's glass
  uses Level 1's own refraction pipeline (`src/fx/postfx.js` +
  `src/levels/causeway/shaders/glass.js`); Level 3 renders with its own
  composer, so the pieces need Level 3-compatible materials (the way
  `src/levels/common/calibration-lift.js` rebuilt Level 1's lift).

### 0.5 Loose threads in the story (flagged to the user, not fixed yet)

- **Dr. Vale's radio line** as you enter the Skyline - *"Seven? You're awake.
  You were never supposed to wake up."* - belongs to the old pod wake-up
  (it's in `src/levels/causeway/layout.js`, Level 1's script). Rewrite with
  the cutscenes. Level 1's `updateIntro` / pod code is now unused and could
  seed the new opening cutscene.
- **One goal:** older text says "reach the control core and cancel the
  demolition"; the story now ends with the helicopter on the roof.
- **One name:** the player is "Subject 07" in the game and "Patient
  0417/0932" in the Level 3 preview's picker.
- ~~The ally scientist needs a name~~ - Dr. Elias Okoro (see §0.3).
- **Sector 03 was built as a first level** (the Causeway): slow teaching
  start, missions, the field manual and the preview flythrough are all about
  it. The slow start is gone in the story; its difficulty as the *final*
  level still wants a look.

---

## 1. What "Level 3" (the Meltdown module) is now

`src/levels/meltdown/` is two stages of the story plus two Endless modes:

- **Phase A - the corridors = Sector 02, "the Labs"**: a 952 m run, four
  beats (Recovery Ward, Containment Corridor, **Blacked Out**, Stairwell
  Ascent), patients in tanks and lurching into the lanes, a fire front
  driven by your vitality, a blackout where the launcher is your light. You
  arrive in a (placeholder) freight lift and leave in the glass Calibration
  Lift.
- **Phase B - the Roof = the finale**: three waves of scientists + patients,
  open ledges to lure chargers off, chaos that ramps up (fire patches,
  explosions, tremors), a hidden 40-58 s helicopter timer, and a rope ladder
  you climb (roof cleared) or have to jump for from the ledge (still
  fighting) - or it leaves without you.
- **Endless Labs**: lap after lap of the corridor, reshuffled each lap
  (`MeltdownLevel` `seed`), 7 % faster each, no countdown.
- **Endless Roof**: `RoofLevel` `endless` - no helicopter, waves forever
  (bigger as it goes), the roof comes apart over two minutes; scored in
  seconds survived.

This supersedes the old "Inverted Core" concept still written in
`docs/project-brief.md` §5 - that doc hasn't been updated.

### Decisions the user made (don't re-ask)

- **Blacked Out**: after the Experiment Chamber (the warp kills the power),
  ~150 m with one hall, launcher beam + glowing balls as the light.
- **Player**: selectable female/male, in patient scrubs; female is the
  default. The chosen character is the player's body in **every** stage.
- **Patients**: in tanks/cells, as lurching obstacles, as watchers in the
  dark, and on the roof as the melee enemies the scientists send at you.
- **Enemy animation**: procedural, in code (no Mixamo clips needed).
- The player visibly holds the launcher (two-handed); the helicopter must not
  arrive upside down; boarding is by rope ladder, and in the survive case the
  player has to jump for it themselves; escalating chaos while you wait;
  blackout smoke must not show as lines.
- Level 1's elevator (the glass Calibration Lift) ends the Foundry and the
  Labs as well as the Skyline.
- **Story order: Foundry -> Labs -> Skyline -> Roof; the roof moves to the
  very end; the pod start becomes a lift arrival; weapons stay as they are;
  Endless for every environment, separate from the story** (see §0).
- **Other developers own Levels 1 and 2** and the elevator ride
  (`src/elevators/`). Change their code only as far as a request needs, and
  say so.

---

## 2. How to see it right now

```bash
python -m http.server 4173
```

Full game: `http://localhost:4173/`. Pick **Play as**, then **Start Story**
(starts in the Foundry) or **Endless** (pick an environment). During a run,
demo keys **1-4** jump to the Foundry, the Labs, the Skyline, the Roof;
**5** rides the Gravity Fault lift.

Level 3 on its own: `http://localhost:4173/preview/meltdown.html`,
hard-refresh (`Ctrl+Shift+R`), pick a patient, click to start - it plays the
corridor then the roof (mode `"full"`). `P` skips to the roof, `R` restarts,
`?roof` in the URL starts there.

Labs: `A`/`D` lane, hold left mouse to fire, `SPACE`/`W` jump (or mash at a
fallen duct), `SHIFT`/`S` slide (in the air: slam), `C` camera, `B` bloom,
`F` stats, `K` credits. Roof: `WASD` move, mouse aim + hold to fire, `SPACE`
dodge (or jump for the ladder).

Three.js is now **in the repo** (`lib/three/`, from `main`), so this runs
offline and on the lab network.

---

## 3. The preview and the game run the same module

All of Level 3 lives in `src/levels/meltdown/game.js` (`MeltdownGame`),
which both the preview and `main.js` run - fix something once and it is
fixed in both. Its `mode` says which use it is in: `"full"` (the preview:
corridor then roof), `"corridor"` (the story's Labs - stops after the lift
and emits `corridor-complete`), `"endless-labs"`, `"endless-roof"`;
`enterRoof()` goes straight to the roof.

---

## 4. What's built - file by file

```
src/levels/meltdown/
  game.js        MeltdownGame - the whole level as one module: scene, camera,
                 post, HUD, audio, runner rules, camera rigs, roof input,
                 lift cutscenes, modes (see §3), endless laps.
  elevator.js    PLACEHOLDER lifts (createLift): the freight lift you arrive
                 in at the start of the Labs, and the roof's lift housing.
  index.js       MeltdownLevel - Phase A. Data-driven beats (BEAT_SPECS) and
                 halls (HALLS) -> route with 3 turns; shell, openings, set
                 pieces, obstacle patterns, dressing, signs, fire front;
                 darkness; lurching patients; the lifts at both ends and
                 their cutscenes (arrival / departure); `seed` for endless.
  kit.js         ~35 factories: hazards, pickups, dressing, and people.
  halls.js       buildHall(), bakeStatic(), bakeFilled().
  characters.js  prepareCharacter, atlasMerge, HumanoidRig (procedural
                 animation for any skeleton), rigPlayerMesh (vertex-shader
                 rig for the unrigged player).
  player.js      PlayerAvatar - the player's body; also used by main.js for
                 Levels 1 and 2 (arms free) and by the Gravity Fault ride.
  roof.js        RoofLevel - Phase B: arena, enemies + AI, orbs, waves,
                 chaos, helicopter, extraction window, endings, the lift
                 arrival; `endless` survival.
  helicopter.js  The Hind, disarmed, merged, spinning rotors, rope ladder.
  flashlight.js  LauncherLight - beam spot, volumetric cone, ball flares.
  post.js        The grading pass (heat haze, hit split, vignette, grain).
  smoke.js       SmokeBank - soft instanced smoke puffs.
  credits.js     In-game credits data + panel (CC-BY attribution).
  fire.js, effects.js, assets.js, lighting.js, textures.js

src/levels/common/calibration-lift.js
                 Level 1's glass Calibration Lift rebuilt as a shared prop +
                 ride (doors, rise, orbiting camera, arrival doors). Used at
                 the end of the Foundry, the end of the Labs, and the start
                 of the Skyline.
src/elevators/   (teammate) The Gravity Fault ride, Foundry -> Labs.
src/audio/meltdown-audio.js   Level 3's synthesised sound.
src/fx/shatter.js            Level 1's GPU glass shards for the Foundry, Labs, Roof.
src/ui/meltdown-hud.js/.css   Level 3's HUD.

preview/meltdown.html/.js    Thin host around MeltdownGame.
main.js                      The story and Endless flow (see §7).
tests/meltdown/              run.js + checks: route, fairness, roof,
                             playthrough (a scripted player, bot.js).
```

---

## 5. How the pieces work

- **Darkness** is a function of route distance (`darknessAt`); the host
  scales fog, exposure, reflections and the beam from `level.state.darkness`.
  Light *count* never changes, so no recompiles.
- **Characters**: one draw call per character via a runtime texture atlas;
  bones animated in model space so one pose function drives any rig.
- **Roof** is self-contained: the host gives it the player's position and
  velocity each frame and gets back hits; the endings and the lift arrival
  are `roof.cutscene` data the host applies.
- **Cutscenes are data** (camera, look target, player pose/action, fade,
  shake), produced by the levels and applied by `game.js` - the lift
  arrival/departure in `index.js`, the roof's arrival and endings in
  `roof.js`. Each step also emits an event (`lift-arrived`, `lift-open`,
  `lift-exit`, `lift-close`, `lift-depart`, `arrived`) - the hooks for the
  planned story cutscenes.

---

## 6. How this was tested

Headless Chromium (SwiftShader) via Playwright: `tests/meltdown/run.js`
(Level 3), `tests/causeway/run.js` (Level 1, drives the full game), and
`tests/elevators/run.js` (the Gravity Fault ride), plus ad-hoc scripts that
drive the whole story and every Endless mode through `__dbg`.

Headless rendering runs at a few frames a second, so gameplay is verified by
**stepping the game logic directly** and by screenshots. The **playthrough**
check plays Phase A with a scripted player and fails on any hit with nothing
actually in the way (it caught a NaN-hitbox bug that killed players who
touched nothing).

**Not done: a human playtest.** Balance is on paper.

---

## 7. How it is wired into `main.js`

- `currentLevel` names the **environment** - 1 Causeway (the Skyline), 2
  Foundry, 3 Meltdown (the Labs and the Roof) - so each level's code keeps
  its id. `sectorNumber()` gives the story order the player sees.
- **Story:** `startCampaign()` -> `enterFoundry()` -> (Calibration Lift ->
  `startGravityLift()` -> `finishGravityLift()`) -> `enterMeltdown()` (mode
  `"corridor"`) -> `corridor-complete` -> `enterSkyline()` (lift arrival in
  `updateLaunch`) -> the Causeway's lift -> `finishCausewayLift()` ->
  `enterRoof()` -> the Roof's `complete` / `failed` -> the end screen.
- **Endless:** `startEndless(env)`; the Foundry laps in `foundryLap()`
  (`FoundryLevel` `variant`, 7 % faster each); the Labs and the Roof use
  `MeltdownGame`'s endless modes; the Skyline is the Causeway's own endless.
  Bests in `localStorage` (`fractureRunEndlessBest`), shown on the picker.
- "Run again" / "Restart run" / `R` repeat the same kind of run
  (`restartRun()`). `resetGame(mode)` still plays the Causeway directly (the
  Level 1 harness uses it).
- While `currentLevel === 3`, `updateGame` hands the frame to the module and
  `renderFrame` renders it; its HUD replaces the game's (`body.mlt-active`);
  `Esc` still pauses. `leaveMeltdown()` frees it.
- **Play as** on the start screen; the chosen character is the body in every
  stage.
- `MELTDOWN_AUDIO` switches Level 3's own sound off (the rest of the game's
  audio is a teammate's workstream - `src/audio/music-manager.js`,
  `level1-audio.js`).

---

## 8. Loose ends / known TODOs

- The story loose threads in §0.5, and the planned work in §0.3-§0.4.
- **`docs/credits.md`**: 4 rows (ventilation kit, Javelin, alarm light,
  geothermal factory) still need source URL and licence from whoever
  downloaded them. Poly Haven rows want a confirm.
- The helicopter is a Soviet Hind (red stars on the textures; weapons are
  stripped at load). If that reads wrong for a rescue, the stars could be
  painted out on an atlas the same way the scrubs are recoloured.
- Unused supplied models: `dead_end_weapons`, `weapon_set`, `dragon_flail`.
- `project-brief.md` still describes the old Level 3 and the old order.
- No human playtest; spatial audio not done.

---

## 9. If you're a fresh session and want the short version

Read §0, then `game.js`'s header, `index.js`'s header and `roof.js`'s
header. Run the game and the preview, and run `node tests/meltdown/run.js`
(and `tests/causeway/run.js`, `tests/elevators/run.js` if you touch
`main.js`) before and after any change.
