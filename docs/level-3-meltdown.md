# Level design sheet - Level 3: The Meltdown

Owner: TBD (Level 3 workstream)
Status: **Phase A (the escape) is built** as a standalone preview - environment, 13 obstacle types, projectile physics and breakage, custom fire shader, chasing fire front, synthesized audio, imported models, HUD. Integration into `main.js` is pending (the same stage Level 2 reached before its integration). **Phase B (the roof) is design-only.** Supersedes the "Inverted Core" gravity/boss concept in `project-brief.md` §5; see "Relationship to the project brief".

**Run it:** from the repo root, `python -m http.server 4173`, then open `http://localhost:4173/preview/meltdown.html` in Chrome and click to start. If you have opened it before, hard-refresh (`Ctrl+Shift+R`) - Python's server lets the browser cache the old scripts.

**Controls:** `A`/`D` lane - hold left mouse to fire (it overheats) - `SPACE` jump, or mash it at a fallen duct - `SHIFT` slide - `C` camera (chase / first person / cinematic / orbit) - `B` bloom - `F` stats - `R` restart.

---

## 1. One-sentence distinction test

> Level 3 is about staying ahead of a fire that never stops closing in, then surviving an unknown length of time against people trying to stop you from getting off the roof.

Level 1 is aiming and ammunition. Level 2 is dodging and switches that reshape the route. Level 3 is **pressure with no way to fully clear it** - the fire in Phase A never turns off the way Level 2's pistons do, and the helicopter in Phase B never gives you a countdown to plan around.

---

## 2. Story framing

You regain consciousness mid-collapse: sirens, smoke alarms, the building coming apart. The lab staff triggered a self-destruct to destroy evidence before the FBI arrives. A failed experiment - a ball launcher - is the only tool at hand. You climb from the sub-level where the tests happened to the roof, where a rescue helicopter is inbound. The scientists responsible are still up there.

- **Phase A - the escape**: built (section 3).
- **Phase B - the roof**: design (section 4).

### Relationship to the project brief

`project-brief.md` describes Level 3 as "The Inverted Core" - a gravity-flipping arena with a reactor boss. This design keeps the brief's *intent* (spatial disorientation, a memorable final set piece) but delivers it through the reality-warp beat at the experiment ring and the rooftop encounter. The project brief's Level 3 section and rubric table should be updated once the team signs off.

---

## 3. Phase A - the escape (as built)

### Layout

Three beats joined by two 90-degree turns (Level 2's exact arc math, reused from `src/levels/foundry/route.js`). Each beat contains **two large halls** with their own identity; the corridors between them are where obstacle patterns come thick and fast. 788 m in total.

| Beat | Halls (in order) | Wall finish | Obstacle tier |
| --- | --- | --- | --- |
| A - Recovery Ward | Recovery Ward, Research Lab | Clinical tile with grime | 1 |
| B - Containment Corridor | Containment Block, **Experiment Chamber** | Riveted steel panels, hazard chevrons | 2 |
| C - Stairwell Ascent | Records Archive, Boiler Hall | Stained, cracked concrete | 3 |

**Halls** are 44 m long, 32-36 m wide and 11-17 m tall (the corridor is 14 m wide and 8.4 m tall), entered through doorways in their end walls. Each is dressed to what it was used for:

- *Recovery Ward* - bed bays with privacy curtains, restraint-strapped gurneys (some tipped), IV stands, ceiling fans.
- *Research Lab* - rows of lab benches with microscopes and sample beakers, shelving, specimen tanks.
- *Containment Block* - glass holding cells along both walls, most with an occupied tank inside; chain-link pens.
- *Experiment Chamber* - the failed experiment itself: a giant ring standing across the route (you run through it), energy halos, sparks, fires either side. The reality-warp fires here.
- *Records Archive* - tall shelving in rows, some toppled, piles of burning records ("destroying the evidence").
- *Boiler Hall* - industrial pipe rigs on both walls, vent fan units, cages, fire everywhere.

All halls get hanging work lamps (pooled lights), hazard-banded pillars with alarm beacons, security cameras, duct runs under the roof, fires and smoke.

**Corridors** get: per-beat wall finish; pilasters and wall pipes for rhythm; **real openings cut into the walls** - cracked observation windows into lit rooms or burning rooms, doorways (shut, ajar, or with fire behind), and blown-out wall breaches with fire inside; plus duct runs, utility boxes, cameras, gurneys, cables, broken flickering lights, and wall-base fires whose density rises beat by beat (every ~34 m -> ~22 m -> ~13 m).

### Obstacles

The first version felt easy because a single hazard in one lane is dodged by standing in another. Every obstacle is now placed as a **pattern** that forces a decision.

| Obstacle | Answer | Notes |
| --- | --- | --- |
| Concrete barrier (your model) | Jump | |
| Hanging hazard beam | Slide | |
| Rubble wall (sometimes burning) | Change lane | Too tall to jump |
| Falling ceiling chunk | Dodge, then jump the rubble | Red landing ring telegraphs where it drops |
| Fallen air duct (your duct model) | **Stops you** - mash Space x6 | Every second pushing, the fire gains |
| Floor gap, fire burning up through it | Jump | |
| Mandatory gap + fallen-duct bridge | Take the duct's lane | Outer lanes are fire, jump doesn't clear |
| Pendulum weight | Lane timing | |
| Security laser grid - low / high / sweeping | Jump / slide / time it | Sweep catches both at mid-height |
| Erupting fire vents | Lane or timing | Grates glow before each burst; tier 3 runs two out of phase across all lanes |
| Toppling shelf (your shelf model) | Far lane, or jump it once down | Tips across two lanes as you approach |
| Rolling gas cylinder | Jump or time it | Rolls across all three lanes |
| Sliding lab desk (your desk + microscope) | Jump or time it | |
| **Glass pane** | **Shoot it**, or crash through (a hit) | 1 / 2 / 3 hits by tier - "things got stronger"; the roof door is the last one |

Patterns per tier: tier 1 mostly single-decision gates at ~17 m spacing; tier 2 adds sweeping lasers, vents, shelves, carts, gap combos at ~13.5 m; tier 3 adds out-of-phase vents and stacked double patterns at ~11.5 m.

**Fairness is verified, not assumed.** A scripted check sweeps every obstacle cluster across every lane x pose (run, jump apex, slide) x time (0-5 s) with all falling hazards already down: **38 clusters, 0 impassable** (4 need a glass pane shot, 6 need a jump or slide, 2 need timing, the rest need the right lane).

### The fire

- **Custom GLSL fire** (`fire.js`): instanced camera-facing flame quads, one draw call per fire; fractal noise scrolled upward, shaped into licking tongues, pushed through a black-body colour ramp. Additive, tuned so overlapping tongues build a yellow core rather than clipping white. Smoke uses the same vertex stage with a slow grey fragment stage. The supplied smoke `.glb` was not used: it is 3,459 separately animated planes (~3,500 draw calls a frame).
- **The fire front** chases you: a wall of fire filling the corridor (or hall) behind the player, lighting the walls orange. Its distance behind you **is** your vitality made visible (`4 + vitality x 0.42` m - 46 m at full health, 14 m at 25).
- **Look back:** when you stumble, the camera swings round to show the fire gaining for ~0.9 s, per the brief. Skipped under reduced motion.

### Physics you can see

- **Balls are real projectiles** (`effects.js`): pooled, launched from the launcher's muzzle toward the reticle at 72 m/s plus your running speed, under gravity. Each frame sweeps a ray along the ball's path (no tunnelling through thin glass at speed), bounces off solid hazards with sparks, and bounces on the floor.
- **Breakage:** pooled shards with velocity, spin, gravity, floor bounce and friction (70 for a pane, spread across the pane), spark bursts, dust puffs. Cracks spread on reinforced glass before it goes. Landing ceiling chunks, ducts and shelves throw concrete/metal debris and dust and shake the camera by proximity. Stumbling spills your dropped balls onto the floor.

### Player rules (host-side, in the preview)

| | Value |
| --- | --- |
| Vitality | 100. Passive drain 0.35 / 0.55 / 0.8 per second by beat (~39 lost over a clean run). A hit: -14, -6 fire burst, drop 25% of balls, 1.1 s mercy window. So ~3 hits survivable. |
| Hidden timer | 105 s (~1.3x a clean run). Never on the HUD - only on evac signs as you pass them. |
| Balls | Start 26, max 45. Sacks: +5 / +6 / +7, taking 1 / 2 / 3 hits by beat. |
| Launcher | Hold to fire, ~7.5 shots/s. +9 heat/shot, cools 16/s. At 100: 3 s lockout, then 6 s weakened (half-power shots). |
| Power-ups | Coolant (clear heat, 4 s no heat), Adrenaline (6 s drain pause), Overcharge (next 6 shots break anything), Barrier (5 s hit immunity). |
| Speed | 8.2 -> 11 -> 14 m/s by progress. Level 2 capped at 11.6; this is faster on purpose. |

Only balls and vitality are persistent on screen. Heat shows on the launcher itself (it glows red) and the reticle (red when locked out, dashed when weakened).

### Your models

All 14 supplied source files were converted to web-ready `.glb` (textures cut from 4K to 512-1024 px, heavy meshes decimated, ~7 MB total) with Blender run headless - see `tools/assets/README.md`. Used: Javelin (the launcher, in first person and on the player's shoulder), concrete barrier, desk, microscope, shelves, chain-link fence, security camera, utility box, ceiling fan, alarm light, the ventilation kit (straight duct section + grille, assembled into duct runs and the fallen ducts; fan unit), and two pieces of the geothermal scene (pipe rig, experiment ring). The level is fully playable with procedural stand-ins while models stream in. Sources and licences: `docs/credits.md` (**four rows still need their source filled in**).

### Visual and performance approach

- Bloom (UnrealBloomPass) at half resolution with a high threshold, so only fire, lasers and energy glow.
- An environment map (RoomEnvironment) so metal - steel walls, the imported props - actually reflects instead of rendering black; kept to low strength.
- Danger pushes fog density and colour toward red, lowers exposure, reddens the ambient light, swells the siren and fire audio.
- Pixel ratio capped at 1 (Level 2 measured this game as fill-rate bound). Corridor shell instanced; each hall's static geometry merged by material after build; lights pooled (fixed count, never recompiles); pieces beyond 110 m hidden.
- No transmissive glass anywhere: transmission makes Three.js re-render the scene into a buffer every frame.

---

## 4. Phase B - the roof (design only)

New territory for this codebase: no other level has NPCs. Keeping this deliberately small in scope.

### Setup

A helipad rooftop, small enough to read at a glance: a handful of AC units/satellite dishes as partial cover, a clear ledge boundary on at least two sides. Vitality carries over from Phase A at a partial refill (+25%, not a full reset).

### Enemies (a mix)

**2 melee rushers + 2 ranged gadget-users**, spawned in two waves of two.

- **Melee rusher** - notices you, telegraphs (~0.5 s), charges in a straight line. Sidestep near the edge and they go over - an instant kill that costs no balls. If they connect: vitality hit and knockback.
- **Ranged gadget-user** - holds distance, fires a slow, dodgeable projectile from its "invention". Counter-play is cover or 2-3 ball hits.
- 2-3 ball sacks on the roof so an empty-handed arrival is not locked out.

### Win conditions (both valid, different outcome)

1. **All enemies defeated** (balls or lured off the edge) -> **victory cutscene**: player braces on the ledge, helicopter arrives, boards plainly victorious.
2. **The hidden helicopter timer elapses while an enemy is still alive** -> **survive cutscene**: a scrambled, mid-motion leap onto the moving helicopter.

Losing is the same as elsewhere: vitality reaches 0.

### Helicopter timer

Hidden, randomised per attempt in a 25-45 s range. The only tells are the rotor sound growing and, late, a glimpse of the helicopter.

### Cutscenes

Reuse the scripted-camera pattern already in `main.js` (the `state === "launch"` intro sequence) rather than a new system.

### Combat feel

Balls hitting an enemy should read like breaking glass - impact, sound, debris burst - with a knockback/stagger instead of shattering. The Phase A projectile and debris systems (`effects.js`) are built to be reused for this.

---

## 5. Audio (as built)

Everything is synthesized live with the Web Audio API (`src/audio/meltdown-audio.js`) - no sample files, nothing to credit, and every bed reacts to game state continuously.

| Cue | Behaviour |
| --- | --- |
| Building siren | Two detuned saws swept by a slow LFO; louder with danger |
| Smoke detectors | Triple chirps every ~1.4 s |
| Fire roar | Brown noise through a low-pass; opens up and swells as danger rises and the fire front closes in |
| Crackle | Random noise pops, more frequent near the fire |
| Heartbeat | Kicks in past ~72% danger, speeding up |
| Launcher shot | Pitch-drop thump (weaker when the launcher is weakened) |
| Glass | Crack on damage; shatter with tinkling fragments on break |
| Crash | Landing chunks/ducts/shelves, scaled by distance |
| Stumble | Impact plus your dropped balls clattering away |
| Pickup, power-up, overheat whine + lockout clunk, duct push, warp sweep | One-shots |

Phase B additions (rotor, enemy tells) and spatial positioning (`PannerNode`) are still to do.

---

## 6. Open questions

- **Balance is first-pass.** Drain, timer, speed and pattern spacing are budgeted on paper and every obstacle is proven *passable*, but none of it has been through a real human playtest yet.
- Phase B enemy models: primitives or a sourced/rigged character? Affects the credits register.
- One win screen with different flavour text, or two summary variants?
- Top speed (14 m/s) exceeds what Level 2 found readable (13.2). Deliberate for the final level, but worth watching in playtests.

---

## 7. Still to do

- **Credits:** fill in source and licence for the four **TODO** rows in `docs/credits.md` (ventilation kit, Javelin, alarm light, geothermal factory) and confirm the Poly Haven rows.
- **Integration** into `main.js` (replace the old Level 3 gravity-tilt stub). `index.html` will need the same import map as `preview/meltdown.html`, because the model loaders and bloom are Three.js add-ons that import the bare name `three`.
- **Phase B** - enemies, ledge-lure, helicopter timer, the two cutscenes.
- **Playtest and balance pass.**
