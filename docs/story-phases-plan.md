# Story cutscenes: plan for Phases 2-7

This is the plan for the rest of the story work: what each phase delivers,
how it will be built, and how we'll know it's done. Phase 1 (the shared
systems in `src/story/`) is finished; see `docs/level-3-handoff.md` §0.6
for what it contains. The story itself (the cast, the 10 beats and the
decisions the team made) is in §0.3 of the same file.

| Phase | What | Status |
|---|---|---|
| 1 | Shared systems: dialogue script, cutscene player, reaction hits, Okoro, preview, tests | **Done** |
| 2 | Opening: wake-up in the ward, walk to the basement, Okoro in the Foundry | Next |
| 3 | The Gravity Fault lift: gun drop, reaction hits, death and retry | Planned |
| 4 | Labs: breach, bend attack, hiding + sacrifice, grief in the lift | Planned |
| 5 | Skyline and roof: explosion, sprint, jump and latch; helicopter latch | Planned |
| 6 | Ending: pilot reveal, title card, credits | Planned |
| 7 | Graphics pass: running animation and physics, lighting, textures | Planned |

Contents:

1. [How every phase is built](#1-how-every-phase-is-built)
2. [Work shared by several phases](#2-work-shared-by-several-phases)
3. Phases: [2](#phase-2-the-opening) ·
   [3](#phase-3-the-gravity-fault-lift) · [4](#phase-4-the-labs) ·
   [5](#phase-5-the-skyline-and-the-roof) · [6](#phase-6-the-ending) ·
   [7](#phase-7-graphics-pass)
4. [Testing criteria (all phases)](#4-testing-criteria-all-phases)
5. [Risks and open questions](#5-risks-and-open-questions)

---

## 1. How every phase is built

Each phase uses the same recipe, so the work stays predictable and each
push is playable:

1. **Words first.** Lines go in `src/story/script.js`. Most are already
   drafted there for every beat. The camera timing reads the line times
   (`cue(lines, "...")` in `scenes.js`), so rewording a line moves the
   camera with it.
2. **A scene factory** in `src/story/scenes.js`, written against *anchors*
   (where the bed is, where the desk is, where the lift door is), never
   against fixed coordinates. The preview's recovery room is only a test
   stage; each phase hands the factory the anchors of its real location.
3. **A stage**, when the location doesn't exist yet: a small set built in
   code under `src/story/stages/` (the ward, the helicopter cabin). It
   reuses existing kits and materials (Labs walls, `office_desk.glb`,
   `helicopter.glb`), so it matches the levels.
4. **Host wiring** where the level runs:
   - `main.js` for the Foundry, the Skyline and the flow between stages.
   - `src/levels/meltdown/game.js` for the Labs and the roof.
   - `src/elevators/gravity-fault.js` for the lift.

   The host gives the `CutscenePlayer` its camera, forwards its events to
   the level ("open the incubators", "break the bridge") and owns the
   consequences: death, retry, moving on.
5. **Story only.** Every cutscene is gated on `runKind === "story"`.
   Endless never sees one. A check in each phase proves it.
6. **A debug jump** for each scene: `__dbg.story.play("wake")` and so on,
   plus a demo key. Tests, and teammates, can reach any scene in seconds.
7. **Tests, screenshots, handover, push** (§4), then the next phase.

---

## 2. Work shared by several phases

Done once, in the first phase that needs it:

- **Input while a cutscene plays.**
  - Movement and fire are ignored. The level's `update` gets
    `cutscene: true`, or the host stops forwarding input.
  - Reaction keys reach `ReactionHits` first, because it listens in the
    capture phase.
- **Esc: pause vs skip.** Esc is already the pause key. While a cutscene
  runs:
  - A **tap** (under 0.25 s) opens the pause menu, and pause freezes the
    cutscene clock.
  - A **hold** skips.

  `CutscenePlayer` already captures Esc while active. The tap-to-pause
  rule gets added there.
- **One story layer per page.** A single `StoryUI`, `ReactionHits`,
  `CutscenePlayer` and `StoryVoice` live in `main.js` and are shared by
  every level.
  - The player's `camera` is set per scene: the main camera, the Labs'
    camera, or the lift's camera.
  - `blurTargets` covers the main canvas. Each level that has its own
    canvas, such as the Labs, adds its canvas while it is active.
  - `StoryVoice` uses the music manager's audio context.
- **Okoro across scenes.** Each level's scene gets its own `Companion`
  instance. The model template is loaded once and cached by
  `loadMeltdownAssets`, so a new instance is cheap.
- **Settings.** Two toggles go in the game's settings menu, saved with the
  other settings:
  - "Longer reaction windows".
  - "Hold instead of mash".

  They feed `ReactionHits.setOptions`. Added in Phase 3, when reactions
  first reach the game.
- **Story checkpoints.** A failed reaction retries at that reaction, which
  is built in. Dying in normal gameplay keeps the current behaviour,
  restarting the stage, and the stage's opening cutscene is then skipped
  automatically. Seen-once flags per scene are kept for the session so a
  restart doesn't replay talk.
- **Reduced motion.** With the existing setting on:
  - Head bob, sway and camera shake drop to a quarter.
  - Blink and blur effects are shortened.
  - Fast cuts replace whip-pans.
- **Pistol prop.** Okoro needs a pistol in Phase 4. `dead_end_weapons.glb`
  and `weapon_set.glb` are already in `assets/` (unused), so we'll pick one,
  normalise it like the other props and credit it in game.

---

## Phase 2: the opening

**The player sees:**
1. Black, then the monitor beep and HALCYON's countdown.
2. Eyelids fail to open twice, then open into a blurred ward ceiling.
3. Okoro leans in and talks, they sit up and stand.
4. He beckons and leads them out to the basement.
5. Gameplay starts in the Foundry with Okoro running a few metres ahead,
   talking (subtitles above the HUD).
6. Early on he hands over spheres from his bag; the sphere counter fills as
   he does.

**Build:**
- `src/story/stages/ward.js`: a recovery ward (bed, IV stand, monitor,
  curtains, Labs ward walls) placed just behind the Foundry's start, in
  the main scene. Its door opens onto the Foundry's first stretch.
- `startCampaign()` in `main.js` starts the wake scene (`wakeScene`, already
  built) before `enterFoundry()`. The scene's last shot ends behind Okoro
  at the Foundry start, so control hands over with no cut. Then the ward is
  disposed.
- **Okoro in the Foundry:**
  - A `Companion` with the bag, placed each frame with `follow(foundry.route,
    playerDistance + lead, lateral)`.
  - The lead eases between 4 and 7 m. He uses the "run" action at the
    player's speed and is never hit by hazards.
  - He keeps to the free lane. The Foundry's layout data knows which lanes
    are blocked, so he swaps lanes ahead of each hazard with a short
    sideways blend, and never stands inside a closed gate.
- **Talk during play:** the `foundryTalk` lines fire on route progress (as
  the preview's walk-and-talk does), with `ui.setGameplay(true)`.
- **Sphere hand-off:**
  - The story start gives 0 spheres. At line 2 Okoro does the "offer" pose
    and +12 arrive with a pickup sound.
  - Before that, the first switch is out of reach, so nothing needs a
    sphere yet.
- **Obstacles (the team allowed changes):**
  - A gentler first 15% of the route, so the player can listen.
  - One "Okoro points" beat before the first glass switch, to teach
    breaking cells.

  No other layout changes in this phase.
- **Lift door:** at the Foundry's end Okoro reaches the Calibration Lift
  first and waits inside, holding the doors.

**Testing criteria:**
- Story start plays the wake scene, then the Foundry with
  `currentLevel === 2` and Okoro present. Endless Foundry has no wake scene
  and no Okoro.
- Holding Esc skips straight to Foundry control. A tap opens pause, and
  the cutscene clock does not advance while paused.
- Okoro stays 3-8 m ahead for the whole route (sampled every metre), is
  never inside a hazard's box, and never blocks the player's lane at the
  moment they reach him.
- Every `foundryTalk` line is shown once, in order, and none overlaps
  another.
- Spheres are 0 before the hand-off and 12 after it, and no switch requires
  a sphere before the hand-off.
- Death and restart in the Foundry skips the wake scene the second time.
- Screenshots:
  - Lids opening.
  - Okoro over the bed.
  - Standing.
  - The first Foundry frame with Okoro ahead.
  - The sphere hand-off.
  - Okoro at the lift.
- All existing suites still pass (the Foundry checks and the story route
  script).

---

## Phase 3: the Gravity Fault lift

**The player sees:**
1. Okoro in the cabin, holding the launcher.
2. The tremor and the free fall, as now; he drops the launcher, which
   clatters across the floor.
3. The player picks it up: a reaction prompt replaces today's automatic
   pickup.
4. At each of the brake clamps, a reaction hit instead of aiming and
   shooting, harder each time:
   1. One key.
   2. Two together.
   3. Three in order.
   4. Four in order, then mash to hold the last clamp.
5. Okoro shouts between clamps.
6. On a miss, the cable gives and the lift falls: red flash, black, "the
   last cable snaps". Then a retry at that clamp.
7. Success: the brakes catch, and Okoro says "keep it".

**Build** (in the teammate's `gravity-fault.js`; the team said they're fine
with it):
- An option `new GravityFaultRide({ story: true, reactions, player })`.
  Without it, the ride behaves exactly as today, so Endless and the demo
  key keep the shooting version.
- **Launcher phase:** the launcher already falls through the roof. In story
  mode Okoro is holding it at the start of the phase and the "drop" event
  frees it into the cabin's loose-object physics. "Pickup" waits for a
  one-key reaction instead of a timer.
- **Clamps phase:** each clamp becomes a reaction point (`reactionLadder(i)`).
  The ride already has 3 clamps; the story adds the 4th (the "last one -
  hold it" clamp) as the brake itself.
  - On success: the existing clamp-hit code runs, including the camera
    change (first person, then outside, then the orthographic diagnostic
    view) and a launcher shot at the clamp. **The brief's "shoot the
    stabilisers" is still visibly true; the reaction is the trigger.**
  - On failure: a new `fall` phase drops the cabin, using the free-fall code
    with no brake. Then the host calls `player.retry()`, which rewinds to
    just before the failed clamp and resets the cabin's height and the
    clamp states to that point.
- **Okoro:** a `Companion` in the ride's scene, in the cabin, with
  "hold", "crouch" and "point" actions; the clamp lines from `liftBreaks`.
- **Settings:** the two reaction toggles go into the settings menu (§2).

**Testing criteria:**
- Story ride: drop, pickup reaction, 4 clamps in difficulty order (kinds
  press, combo, sequence, sequence+mash; key counts 1, 2, 3, 4; windows
  shrinking).
- Playing every reaction correctly reaches `arrive`, then the Labs.
- Failing clamp 3 plays the fall and death, then retries at clamp 3, with
  clamps 1-2 still locked and the cabin back at clamp 3's height. Failing
  the same clamp five times in a row never softlocks.
- A wrong key fails; movement keys are ignored; holding Esc during a
  reaction doesn't skip it.
- Both settings toggles work in the game: windows are 1.6× longer, and a
  mash becomes a hold.
- **The non-story ride is unchanged:** the existing `tests/elevators` suite
  passes untouched, and the demo key still gives the shooting version.
- Screenshots:
  - Okoro holding the launcher.
  - The drop.
  - The pickup prompt.
  - Each of the four clamp prompts.
  - The fall.
  - The brakes catching.

---

## Phase 4: the Labs

Four scenes inside Level 3's corridor. `MeltdownGame` already has cutscene
plumbing (`_applyCutscene`, the arrival and departure scenes) that these
plug into.

**4a. The breach** (start of the Labs, the RECOVERY WARD beat):
- **Player sees:**
  1. The lift opens with Okoro beside you.
  2. HALCYON: "Containment failure".
  3. The incubators along the ward burst in sequence; patients spill out
     and stagger off.
  4. Dr. Vale appears on a wall monitor (his model, framed head and
     shoulders, rendered to a texture) and taunts Okoro.
  5. "Go!", and gameplay starts.
- **Build:**
  - The ward's patient tanks (from `index.js`) get a `burst()` driven by
    events.
  - The released patients become the corridor's lurching obstacles. They
    already exist as obstacle types, and the breach just "explains" them.
  - The monitor is a `WebGLRenderTarget` showing a small scene with Vale's
    `Companion` in "talk".

**4b. Okoro in the Labs:** the same follower as in the Foundry (`follow`
on the Labs route), running ahead and firing his pistol at patients in the
side lanes. The shots are cosmetic: muzzle flash, sound, the patient
staggers. He never takes the player's targets.

**4c. The bend attack** (the first quarter-turn, end of the ward beat):
- **Player sees:**
  1. A patient lunges from the blind side of the bend.
  2. First person, its face in yours; the camera is knocked down.
  3. `struggleReaction()` (mash Space) while it pushes; the red tint grows
     with its progress.
  4. Okoro shoots it off and checks on you.
- **On failure:** the patient wins, vitality takes a heavy hit (not instant
  death; the Labs' vitality system decides), then a retry of the struggle.
- **Build:** a scene at the bend's route distance; the patient is one of
  the existing patient clones, posed by script.

**4d. Blocked lift, the desk, the sacrifice** (end of the Labs, replacing
the current run into the Calibration Lift):
- **Player sees:**
  1. A crowd of patients between you and the lift.
  2. A cut to crouching behind an office desk (`office_desk.glb`) with
     Okoro.
  3. The `hide` dialogue.
  4. He hands you the bag (it moves from his `Companion` to the player's
     HUD inventory).
  5. He runs left shouting; the crowd turns and follows him.
  6. The player runs right into the lift (scripted, first person); the
     doors close on the shouting stopping. His death is *heard*, not shown.
- **Build:** a scene staged with the departure lift anchors. The crowd is
  6-8 patient clones with simple steering: toward Okoro once he runs.

**4e. Grief:** the lift ride up. Breathing, the camera low, slow blinks,
"...Elias". This reuses the departure ride camera with the overlays from
`grief`.

**Testing criteria:**
- The 4 scenes play in story, in order, at the right route distances, and
  none in Endless Labs.
- During the breach:
  - Every incubator in the ward bursts once.
  - The monitor renders Vale.
  - No hazard can hit the player.
- Okoro never enters the player's lane within 6 m of them. His pistol never
  breaks a breakable or changes the player's stats.
- Bend struggle: success gives no damage. Failure costs vitality (not
  death unless vitality was already low) and retries. The struggle can't
  start mid-jump or mid-slide; it waits for the player to land.
- Desk scene:
  - The bag transfers.
  - Okoro is gone from the corridor afterwards.
  - The lift departs.
  - The grief scene plays and hands over to the Skyline exactly as the
    corridor-complete flow does today.
- The playthrough check (scripted player, phantom-hit detection) still
  passes with Okoro and the scenes in. The fairness check is unchanged.
- Screenshots:
  - Each incubator burst.
  - Vale on the monitor.
  - The bend attack.
  - Behind the desk.
  - Okoro running off.
  - The doors closing.
  - Grief.

---

## Phase 5: the Skyline and the roof

**The Skyline** (`src/levels/causeway/`): the existing route is the ward
(0-240 m), the skybridge (240-540) and the atrium (540-784, with the lift
at 781).

- **Player sees:**
  1. Normal play across the skybridge.
  2. Near its end (about 500 m), the tower behind blows: a first-person
     look back as the fireball rises, the bridge buckling behind you.
  3. `sprintReaction()` (alternate A/D): the camera runs, the bridge
     collapses at your heels.
  4. A jump off the broken end; slow motion mid-air.
  5. `latchReaction()` (two keys, fast) to catch the next building's edge.
  6. **Miss:** you fall (a look down, the wind, black) and retry from the
     sprint.
  7. **Catch:** hands on the ledge, pull up, roll onto your back, the sky,
     an exhale. Get up; the atrium continues to the lift as now.
- **Build:**
  - The existing collapse chase (262-528) already drops bridge sections
    behind you. The blast extends it: an event at 500 m starts the scene,
    and `causeway` gets a `breakBridge(from, to)` that drops the rest of
    the span.
  - A gap of about 5 m between the bridge end and the atrium building, with
    a ledge mesh to catch.
  - The scene's camera is driven along the route.
  - The pull-up uses the player's arms (`reachUp` on the player rig already
    exists for the ladder).
- **Decision taken:** keep the atrium after the latch, because the brief's
  Level 1 plan ends at an elevator atrium. The atrium's lift (Level 1's
  original) carries you up to the roof as now.

**The roof:** the helicopter's rope-ladder jump (`game.js` `_jump`, roof
ending) gets the same `latchReaction()` in story mode:
- Catch: the existing climb cutscene.
- Miss: the fall, then a retry from just before the jump, while the
  helicopter waits.

**Testing criteria:**
- Story Skyline: the blast fires once at the right distance; no blast in
  Endless Skyline.
- **Sprint:**
  - Success reaches the jump.
  - Failure means the bridge takes you, then a retry from the sprint.
- **Latch:**
  - Success: the pull-up and lie-back play, then control returns in the
    atrium with full input.
  - Failure: the fall, then a retry from the sprint.
- The atrium and its lift are unchanged after the latch, and the existing
  Causeway suite (8 checks) still passes. The checks that drive the bridge
  run the story scene via the debug jump.
- Roof story: the ladder jump requires the latch. A miss retries while the
  helicopter is still there, and the helicopter timer doesn't run out
  during retries. Endless Roof is unchanged.
- Screenshots:
  - The fireball look-back.
  - The sprint prompt.
  - Mid-air.
  - The latch prompt.
  - Hands on the ledge.
  - On the back, looking at the sky.
  - The ladder latch.

---

## Phase 6: the ending

**The player sees:**
1. Inside the helicopter cabin, first person, the city burning below.
2. The pilot's back and helmet; the small talk.
3. "I'm only here to collect."
4. The camera turns: the pilot is Dr. Vale.
5. His lines, the dark joke, the laugh.
6. A cut outside as the helicopter flies away from the burning tower;
   fade to black.
7. **FRACTURE RUN** on black, then the credits roll.

**Build:**
- `src/story/stages/cabin.js`: a helicopter interior. Seats, bulkhead, open
  side door, cockpit. Built in code, matched to `helicopter.glb`'s exterior.
- Vale is a `Companion` with `scientistEvil` in a "sit" pose, in a pilot
  helmet prop that comes off at the reveal.
- The roof's victory flow (`_roofSummary(true, ...)`) runs the ending scene
  first, then the title (`ui.title(GAME_TITLE)`), then a **credits roll**.
  The credits roll is new:
  - It scrolls the team, then the asset credits from
    `src/levels/meltdown/credits.js`, then the Level 1 and Foundry credits.
  - Then the existing end screen with the score.

**Testing criteria:**
- Story victory runs the ending, the title and the credits, then the end
  screen. The "barely out" ending variant gets the same ending scene. A
  roof death never shows it. Endless Roof never shows it.
- The reveal happens on cue (the camera's facing flips to Vale within the
  line "Hello, Seven").
- The title shows on black for at least 3 s, with nothing else visible.
- The credits include every model the game actually loads: a check
  compares the loaded asset names with the credits list.
- Skipping the ending goes to the title. Skipping the credits goes to the
  end screen.
- Screenshots:
  - The cabin.
  - The pilot from behind.
  - The reveal.
  - The laugh.
  - Flying away.
  - The title card.
  - The credits.

---

## Phase 7: graphics pass

The team's request: "fix the graphics and the player running physics to
make it look more realistic, same thing with lighting and textures."

**Running animation and physics** (the player's vertex-shader rig in
`characters.js` and `PlayerAvatar`, plus the runner movement in each
level):
- **Feet:**
  - Stride length and cadence from real speed (run ~2.6-3.2 steps/s).
  - A short contact phase where the foot stays planted.
  - Knee lift on the forward swing.
- **Body:**
  - The pelvis bobs twice per cycle and drops on contact.
  - Hips rotate against the shoulders; arms counter-swing with bent
    elbows.
  - Lean comes from acceleration, not just speed. Lane changes bank into
    the turn, with a step-over.
- **Movement:**
  - Acceleration and deceleration ramps instead of instant speed changes.
  - Landing squash and a recovery step after jumps.
  - Slides keep momentum and bleed speed.
- **The first-person camera** bobs on footfalls (tied to the stride phase,
  not a sine on time) and dips on landings.

**Lighting:**
- Real shadows from one key light per area (shadow-mapped, budgeted by the
  quality setting).
- Per-area light probes or environment maps, so materials pick up the
  area's colour.
- Ambient occlusion: SSAO at high quality, baked or fake contact darkening
  at low.
- Consistent exposure and tone mapping across levels.

**Textures:**
- Swap the code-painted canvas textures for real PBR sets (albedo, normal,
  roughness), CC0 from Poly Haven or ambientCG: floors, walls, metal,
  concrete, glass grime.
- Resized to 1K and compressed (KTX2 where supported), within a GPU-memory
  budget per level.
- Credited like the models.

**Testing criteria:**
- Before/after screenshot sets from fixed cameras in every level, reviewed
  side by side.
- Gait checks:
  - Feet don't slide more than 3 cm during contact.
  - Cadence lands in the target range at 3 test speeds.
  - No NaN poses.
  - The runner's hitbox is unchanged, so the fairness and playthrough
    checks still pass with identical numbers.
- **Performance budget:**
  - Frame time at "auto" quality stays within 10% of today's on the
    headless benchmark.
  - "Low" quality gets no shadows and no SSAO.
  - Texture memory per level is logged and stays under budget.
- No new console warnings; all suites pass.

---

## 4. Testing criteria (all phases)

**Automated:**
- Every phase extends `tests/story/` with a check file per scene group,
  driving the **real game** (`index.html` via `__dbg`) as well as the
  preview. Each check asserts:
  - The scene starts at the right trigger, in story only.
  - Lines appear in order, once.
  - Events fire in order, once, also when skipped.
  - Every reaction succeeds when played right, fails when played wrong,
    and retries to the right point.
  - Control returns to gameplay with input working and no HUD hidden.
  - No console errors.
- **A full-story playthrough script** (extending today's story route
  script): menu, then every cutscene and every reaction (played correctly,
  plus one deliberate failure per reaction kind), then the credits.
  Phase 6's version is the release gate.
- **Endless guard:** each Endless environment runs a lap and asserts that
  no cutscene, no Okoro and no reaction ever appeared.
- **Existing suites:** `tests/meltdown`, `tests/causeway`,
  `tests/elevators` and `tests/story` must all pass before every push.

**Screenshots:** every phase's list above, captured headless, looked at
before pushing, and attached to the phase's commit notes in the handover.

**Manual** (things headless testing can't judge, for the team):
- Timing feel: reaction windows and line pacing.
- Readability of subtitles over each level.
- Audio mix.
- Motion comfort with reduced motion on and off.
- A full playthrough on a lab machine at "auto" quality.

**Done means:**
1. The phase's criteria pass.
2. All suites are green.
3. Screenshots reviewed.
4. The handover's phase table updated.
5. Pushed to `feat/level3`.

---

## 5. Risks and open questions

- **The course brief's lift requirement.** The brief says the player
  *shoots three stabilisers* while the camera moves between interior,
  exterior and top-down orthographic views. Phase 3 keeps this:
  - Each successful reaction fires the launcher at the clamp.
  - Each clamp still switches the camera.
  - The non-story ride keeps aiming as today.

  If markers expect aimed shooting in the story too, the alternative is
  "aim with the mouse within the reaction window".
- **No animation clips.** The scientists and patients are animated in
  code. Deaths, the desk crouch and the gun drop are staged with poses,
  framing and sound rather than full-body animation. The sacrifice is
  heard, not seen, by design.
- **Teammate code.** Phase 3 edits `gravity-fault.js`. The team said that's
  fine; the non-story path is kept identical and its suite must pass
  unchanged.
- **Okoro in fast levels.** If following the route ahead of the player
  ever looks wrong at high speed (the Labs' stairwell runs at 14 m/s), he
  drops back behind the player for that stretch and talks over his
  shoulder instead.
- **Performance.** An extra skinned character and the canvas blur cost
  frame time; both get checked against the budget in each phase. The blur
  only runs during cutscenes.
- **Names are placeholders** (Dr. Elias Okoro, Dr. Vale); they change in
  one place, `CAST` in `script.js`.
