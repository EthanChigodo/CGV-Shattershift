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
- **Phase B - "the roof"**: two waves of scientists + patients, open ledges
  to lure chargers off, a hidden helicopter timer, two endings. **Built.**

Both live in the standalone preview. **Neither is wired into `main.js` yet**
(see §7). This supersedes the old "Inverted Core" concept still written in
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
- **Level 3 stays isolated from the other levels** - other developers own
  Levels 1 and 2. Don't touch `src/levels/foundry/*` (Level 3 reuses its
  `route.js` and `LightPool` read-only).

---

## 2. How to see it right now

```bash
python -m http.server 4173
```

Open `http://localhost:4173/preview/meltdown.html`, hard-refresh
(`Ctrl+Shift+R`), pick a patient, click to start.

Phase A: `A`/`D` lane, hold left mouse to fire, `SPACE`/`W` jump (or mash at a
fallen duct), `SHIFT`/`S` slide (in the air: slam), `C` camera, `B` bloom, `F`
stats, `K` credits, `R` restart. **`P` skips to the roof**, and `?roof` in
the URL starts there. Phase B: `WASD` move, mouse aim + hold to fire, `SPACE`
dodge.

---

## 3. Why it's a standalone preview

Same pattern Level 2 used: build and prove it as `preview/<level>.html`, then
wire it into `main.js`. The preview's runner rules and camera rigs
(`preview/meltdown-preview.js`) are the reference for the integration, not
code to paste - but the pieces that should survive integration now live in
`src/` (player body, beam, grading pass, roof, credits).

---

## 4. What's built - file by file

```
src/levels/meltdown/
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
                 helicopter timer, both ending cutscenes (as data).
  helicopter.js  The Hind, disarmed, merged, with spinning rotors.
  flashlight.js  LauncherLight - beam spot, volumetric cone shader, ball flares.
  post.js        The grading pass (heat haze, hit split, vignette, grain).
  smoke.js       SmokeCeiling - noise-shaded smoke layers over the player.
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

preview/meltdown.html/.js    Host: Phase A runner + roof mode + transitions,
                             character picker, credits button.
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

## 7. Wiring into `main.js` - what that involves

Not done (and Level 1/2 owners are separate - coordinate before touching
shared code). When someone does it:

1. `index.html` needs the import map from `preview/meltdown.html` (add-ons
   import the bare `"three"`, which must resolve to the URL `src/three.js`
   uses).
2. Replace the old Level 3 stub in `main.js` (the gravity-tilt camera code,
   `currentLevel === 3`) with `MeltdownLevel` + `MeltdownHud`, following the
   `FoundryLevel`/`FoundryHud` pattern there. Use `PlayerAvatar`,
   `LauncherLight`, `createGradePass`, `createEnvironmentDimmer` and
   `createCreditsPanel` as they are; take the runner rules, springs and roof
   input from `preview/meltdown-preview.js`.
3. Phase B: on `complete`, run the same fade -> hide -> `new RoofLevel({
   assets })` -> `prewarm` -> fade sequence the preview does.
4. `loadAssets` is async and cached; start loading the roof set
   (`ROOF_NAMES` in the preview) once Phase A's models are in.
5. The game-wide credits screen must include `MELTDOWN_CREDITS` (CC-BY).

---

## 8. Loose ends / known TODOs

- **`docs/credits.md`**: 4 rows (ventilation kit, Javelin, alarm light,
  geothermal factory) still need source URL and licence from whoever
  downloaded them. Poly Haven rows want a confirm.
- **`scientist_colossus.glb`** is in the repo but unused: Nazi insignia on
  its textures (helmet, badge, boots). Recommend deleting it from the repo -
  not done without the user's say-so.
- The helicopter is a Soviet Hind (red stars on the textures; weapons are
  stripped at load). If that reads wrong for an FBI rescue, the stars could
  be painted out on an atlas the same way the scrubs are recoloured.
- Unused supplied models: `dead_end_weapons`, `weapon_set`, `dragon_flail`.
- **`C:\gx`** on the user's machine may still hold ~400 MB of Blender scratch
  from the first asset batch (outside the repo).
- `project-brief.md` still describes the old Level 3.
- No human playtest; spatial audio not done.

---

## 9. If you're a fresh session and want the short version

Read `index.js`'s header, then `roof.js`'s header, then skim
`characters.js`. Run the preview, play both phases (or press `P`), and run
`node tests/meltdown/run.js` before and after any change.
