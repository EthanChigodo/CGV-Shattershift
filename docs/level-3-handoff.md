# Level 3 handoff notes

**Read this first if you're a new session picking up Level 3 work.** It's
written so you don't have to re-derive context from scratch or make the user
retype decisions. For full design detail (numbers, tables, rationale) see
[`level-3-meltdown.md`](./level-3-meltdown.md) - this is the shorter "what's
the state of things and how do I get moving" version.

Last updated: end of the session that added the Blacked Out beat, the
characters (player choice, patients, scientists), Phase B (the roof), the
polish/performance pass and the test harness.

---

## 1. What this level is

Level 3 of Shattershift (a Temple-Run/Smash-Hit hybrid). Story: you wake as a
test subject, mid-collapse, in a lab being burned to destroy evidence; a
failed experiment (a ball launcher) is your only tool; you run and shoot your
way up through the building - through a stretch where the power has died - to
the roof, where the scientists are waiting and a helicopter is inbound.

- **Phase A - "the escape"**: a 952 m run, four beats (Recovery Ward,
  Containment Corridor, **Blacked Out**, Stairwell Ascent). **Built.**
- **Phase B - "the roof"**: three waves of scientists + patients, open
  ledges to lure chargers off, chaos that ramps up (fire patches,
  explosions, tremors), a hidden 40-58 s helicopter timer, and a rope ladder
  you climb (roof cleared) or have to jump for from the ledge (still
  fighting) - or it leaves without you. **Built.**

Both are in the full game (Level 3 of `index.html`, see §7) and in the
standalone preview. This supersedes the old "Inverted Core" concept still written in
`docs/project-brief.md` §5 - that doc hasn't been updated.

### Decisions the user made (don't re-ask)

- Priorities this round: polish Phase A (frame rate, movement/camera feel,
  lighting/materials, fire/effects), add a dark section, build Phase B.
- **Blacked Out**: after the Experiment Chamber (the warp kills the power),
  ~150 m with one hall, launcher beam + glowing balls as the light.
- **Player**: selectable female/male, in patient scrubs; female is the
  default for testing.
- **Patients**: in tanks/cells, as lurching obstacles, as watchers in the
  dark, and on the roof as the melee enemies the scientists send at you.
- **Enemy animation**: procedural, in code (no Mixamo clips needed).
- Round 2 feedback: the player visibly holds the launcher (two-handed);
  the helicopter must not arrive upside down; boarding is by rope ladder,
  and in the survive case the player has to jump for it themselves; longer
  wait for the helicopter with escalating chaos; blackout smoke must not
  show as lines.
- **Level 3 stays isolated from the other levels** - other developers own
  Levels 1 and 2. Don't touch `src/levels/foundry/*` (Level 3 reuses its
  `route.js` and `LightPool` read-only).
- Round 3: integrate into `main.js`; character selection at the start of the
  game; Level 3 opens by coming out of a lift and Phase A ends by going into
  one up to the roof (placeholders - **another group member is making the
  real elevator and cutscenes**).

---

## 2. How to see it right now

```bash
python -m http.server 4173
```

Full game: `http://localhost:4173/`, pick **Play as**, start, and press `3`
during the run to jump to Level 3. On its own:
`http://localhost:4173/preview/meltdown.html`, hard-refresh
(`Ctrl+Shift+R`), pick a patient, click to start.

Phase A: `A`/`D` lane, hold left mouse to fire, `SPACE`/`W` jump (or mash at a
fallen duct), `SHIFT`/`S` slide (in the air: slam), `C` camera, `B` bloom, `F`
stats, `K` credits, `R` restart. **`P` skips to the roof**, and `?roof` in
the URL starts there. Phase B: `WASD` move, mouse aim + hold to fire, `SPACE`
dodge.

---

## 3. The preview and the game run the same module

Level 3 was built as `preview/meltdown.html` first (the pattern Level 2
used). All of it now lives in `src/levels/meltdown/game.js`, which both the
preview and `main.js` run - fix something once and it is fixed in both.

---

## 4. What's built - file by file

```
src/levels/meltdown/
  game.js        MeltdownGame - the whole level as one module: scene, camera,
                 post, HUD, audio, runner rules, camera rigs, roof input,
                 lift cutscenes, hand-over to the roof. main.js and the
                 preview both drive it.
  elevator.js    PLACEHOLDER lifts (createLift) - the seam for the real
                 elevator; cutscene timelines live in index.js / roof.js.
  index.js       MeltdownLevel - Phase A. Data-driven beats (BEAT_SPECS) and
                 halls (HALLS) -> route with 3 turns; shell, openings, set
                 pieces, obstacle patterns, dressing, signs, fire front;
                 darkness (darknessAt / setFlashlight / watchers);
                 lurching patients; corridor baking; prewarm().
  kit.js         ~35 factories: hazards, pickups, dressing, and people
                 (lurcher, patientWatcher, personStandIn). Visible mesh vs
                 invisible collider split, as before.
  halls.js       buildHall() incl. the new "substation" theme; bakeStatic()
                 and bakeFilled() (merges swapped-in models after loading).
  characters.js  The character pipeline: prepareCharacter, atlasMerge,
                 HumanoidRig (procedural animation for any skeleton),
                 rigPlayerMesh (vertex-shader rig for the unrigged player).
  player.js      PlayerAvatar - the player's body (model + shader rig +
                 contact shadow + launcher mount). Host-owned, reusable.
  roof.js        RoofLevel - Phase B: arena, enemies + AI, orbs, waves,
                 chaos, helicopter timer, extraction window (canGrab /
                 grab / extractionHint), ending cutscenes (as data).
  helicopter.js  The Hind, disarmed, merged, spinning rotors, a swinging
                 rope ladder, orient() (explicit yaw/pitch/bank).
  flashlight.js  LauncherLight - beam spot, volumetric cone shader, ball flares.
  post.js        The grading pass (heat haze, hit split, vignette, grain).
  smoke.js       SmokeBank - soft instanced smoke puffs anchored along the
                 route (the old flat sheets drew hard lines at the walls).
  credits.js     In-game credits data + panel (CC-BY attribution).
  fire.js        GLSL fire/smoke (ramp re-balanced; exposes its clock).
  effects.js     Projectiles (+ setGlow) and Debris (now instanced).
  assets.js      Loader: cached, subsets, characters, helicopter; asset
                 slots with onFilled callbacks. MELTDOWN_ASSETS (Phase A),
                 CHARACTER_ASSETS, ROOF_ASSETS.
  lighting.js    LightPool re-export, ambience with setPower,
                 createEnvironmentDimmer.
  textures.js    Canvas textures (+ floor puddle roughness).

src/audio/meltdown-audio.js  + power down/up, beam on, groan, thud, fall,
                             stinger, rotor bed, zap, growl, scream, whoosh.
src/ui/meltdown-hud.js/.css  + patient toasts, credits panel styles.
src/three-addons.js          + SkeletonUtils, ShaderPass.

preview/meltdown.html/.js    Thin host around MeltdownGame: start screen with
                             the character picker, status line, dev keys.
main.js                      MELTDOWN INTEGRATION block (see §7).
tests/meltdown/              run.js + checks (route, fairness, roof) + lib.
docs/images/meltdown-*.jpg   Screenshots (regenerate: run.js --shots).
```

---

## 5. How the new pieces work

- **Darkness** is a function of route distance (`darknessAt`). Mains-powered
  emitters in the dark beat are simply not registered (a few sputtering and
  red battery ones are); the host scales fog, exposure, environment
  reflections and the beam from `level.state.darkness`. Light *count* never
  changes, so no recompiles.
- **Characters**: see `level-3-meltdown.md` §6. Short version: one draw call
  per character via a runtime texture atlas; bones animated in model space so
  one pose function drives any rig. The patient's hand bones are repaired on
  load (x0.01).
- **Asset slots** now accept `onFilled(model)` - that's how a lurcher or a
  tank occupant gets its `HumanoidRig` when the patient model arrives.
  Characters are cloned with `SkeletonUtils` (own skeleton each).
- **Roof** is self-contained: the host gives it the player's position and
  velocity each frame and gets back a list of hits; balls go through
  `roof.breakTarget()` (same contract as Phase A's); the ending is a
  `roof.cutscene` object with camera/player poses the host applies.
- **Transition**: Phase A `complete` -> fade to black -> hide Phase A's root,
  build the roof, compile while black -> fade in. Roof models load in the
  background during Phase A.

---

## 6. How this was tested

Headless Chromium (SwiftShader) via Playwright - both the harness in
`tests/meltdown/` and ad-hoc scripts. This cloud container can't reach
jsDelivr, so the harness can serve Three.js from a local npm copy
(`MELTDOWN_THREE_DIR`, see `tests/meltdown/lib.js`); on a normal machine it
just uses the CDN.

Headless rendering runs at a few frames a second, so gameplay was verified by
**stepping the game logic directly** (level/roof `update()`, projectiles,
`breakTarget`) and by screenshots at chosen points - the same approach as
last session. Verified: full-route smoke test; fairness sweep (46 clusters, 0
impassable); patients lurch, take a partial hit, go down on the second, stop
blocking; watchers react to the beam; keyboard movement (jump buffer, slam,
lane spring stability at 20 fps); both roof endings play to their summary;
patients can be lured off the ledge; draw-call counts before/after.

**Not done: a human playtest.** Balance is on paper.

---

## 7. How it is wired into `main.js` (done)

Level 3 is one module, `src/levels/meltdown/game.js` (`MeltdownGame`): its own
scene, camera, composer, HUD, audio, runner rules, camera rigs and roof input
(everything that used to be in the preview's host script). Both hosts drive
it the same way - give it the renderer, forward input, call `update` and
`render`:

- **`preview/meltdown-preview.js`** is now a thin wrapper (start screen,
  status line, dev keys R/P, `__meltdown` for the harness).
- **`main.js`** has a `MELTDOWN INTEGRATION - Level 3` block:
  - Level 2's `complete` -> the `lift` state fades to black -> `enterMeltdown()`
    builds it (models were preloaded when Level 2 started) -> fade in inside
    the arrival lift. Digit `3` (demo jump) does the same.
  - While `currentLevel === 3`, `updateGame` hands the frame to the module and
    `renderFrame` renders it instead of the main scene; its HUD replaces the
    game's (`body.mlt-active`). Keys it uses are not also acted on by
    `main.js`; `Esc` still pauses (and suspends its audio).
  - Its `complete` / `failed` events become the game's score and end screen
    (`finishMeltdown`, `endRun(won, reason, detail)`).
  - Restart / quit / demo jumps call `leaveMeltdown()` (frees it, gives the
    renderer its pixel ratio back - Level 3 renders at ratio 1).
  - `MELTDOWN_AUDIO` switches its sound off (see §8).
- `index.html` has the import map, and **Play as** (female/male) on the start
  screen; the choice is shared with the preview (`localStorage`).
- The old "Inverted Core" prototype (gravity lanes, rings, the old lift at
  z = -282) was removed from `main.js`.

The lifts at both ends of Phase A and on the roof are placeholders for a
teammate's elevator and cutscenes - see `level-3-meltdown.md` §3, "The lifts".

---

## 8. Loose ends / known TODOs

- **`docs/credits.md`**: 4 rows (ventilation kit, Javelin, alarm light,
  geothermal factory) still need source URL and licence from whoever
  downloaded them. Poly Haven rows want a confirm.
- The helicopter is a Soviet Hind (red stars on the textures; weapons are
  stripped at load). If that reads wrong for an FBI rescue, the stars could
  be painted out on an atlas the same way the scrubs are recoloured.
- Unused supplied models: `dead_end_weapons`, `weapon_set`, `dragon_flail`.
- **`C:\gx`** on the user's machine may still hold ~400 MB of Blender scratch
  from the first asset batch (outside the repo).
- `project-brief.md` still describes the old Level 3.
- No human playtest; spatial audio not done.
- **Audio:** the rest of the game has no sound by team decision; Level 3
  keeps its own. Ask the team; `MELTDOWN_AUDIO` in `main.js` turns it off.
- "Run again" after dying in Level 3 restarts the whole game from Level 1
  (the game's existing behaviour for every level); `3` jumps back in.

---

## 9. If you're a fresh session and want the short version

Read `index.js`'s header, then `roof.js`'s header, then skim
`characters.js`. Run the preview, play both phases (or press `P`), and run
`node tests/meltdown/run.js` before and after any change.
