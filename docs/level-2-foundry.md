# Level design sheet - Level 2: The Shifting Foundry

Owner: Nonkazimulo Dube (environment + UI)
Status: Sprint 1 - environment, UI, and standalone preview complete; integration with the main game pending.

---

## 1. One-sentence distinction test

> Level 2 is about dodging and changing lanes while shooting switches that reshape the route.

Level 1 is aiming and ammunition. Level 3 is gravity and orientation. Level 2 is the only level where **the route itself changes because of what you shoot**, and the only one that asks for movement timing (jump, slide, lane discipline) under pressure.

---

## 2. Identity

| Aspect | Choice |
| --- | --- |
| Mood | Enclosed, pressurised, loud, industrial |
| Palette | Dark blue-grey plating, hazard amber/black, furnace orange, warning red, cyan for anything breakable |
| Materials | Ribbed metal plating, open floor grating, hazard-striped slabs, reinforced cyan glass, slotted furnace grilles |
| Lighting | A light travelling with the player, pooled furnace glow and work lights, red warning strobes, and weak ambient fill. One `brightness` option scales it (default 1.6); in the preview `[` and `]` adjust it live and the choice is remembered. |
| Motion | Pistons, conveyor belts with crates, steam jets, sparks, sliding walls |
| Readability rule | Breakable = cyan glass, glowing, pulsing. Solid hazard = red/amber metal, blocky, never glowing cyan. The player should never have to guess. |

---

## 3. Map

Total route: **764 m**, laid out as straights and arcs rather than one straight corridor.

```
  START                                             J1
    |--------- BEAT A: INTAKE (256m) --------------->\
                                                      \  (90° left, r=9)
                                                       \
    /<------ BEAT B: ROLLING FLOOR (248m) --------------/
   /
  J2  (90° right, r=9)
   \
    \-------- BEAT C: FURNACE THROAT (232m) --------> EXIT
```

| Distance | Section |
| --- | --- |
| 0 - 256 | **Beat A - Intake** |
| 256 - 270 | **Junction 1** — 90° left, widening into a chamber |
| 270 - 518 | **Beat B - Rolling Floor** |
| 518 - 532 | **Junction 2** — 90° right |
| 532 - 764 | **Beat C - Furnace Throat** |

### How the layout is authored

Two kinds of content, deliberately handled differently.

**Set pieces are placed by hand, at fractions of their beat.** Switches, the gates they open, the oscillating walls, the piston banks tied to a switch, the escape gates — their positions carry meaning, so they are authored as `at(0.19)` rather than `48`. Change a beat's length and they redistribute correctly.

**Everything between them is generated at a target spacing.** Routine hazards and dressing come from `_fillHazards` and `_fillDressing`, walking a stretch at roughly `HAZARD_SPACING` metres with deterministic variation and a keep-clear radius around the set pieces. The generator is seeded, so every teammate and every run gets the same level.

The reason for this is practical: the level has now doubled in length twice. Hand-placed distances meant re-typing a hundred numbers each time. The three numbers in `BEAT_LENGTHS` and the two spacing constants now define the whole layout.

Set piece fractions:

| Beat | Fraction | What |
| --- | --- | --- |
| A | 0.10 | Teaching piston, alone |
| A | 0.155 / 0.19 | `ROUTE GATE` switch and the gate it opens |
| A | 0.385 / 0.42 | `INTAKE BYPASS` switch and the optional half-gate |
| B | 0.05 / 0.10 / 0.16 | Piston bank A |
| B | 0.22 | `PISTON LOCK` (disables bank A) |
| B | 0.30 / 0.78 | Oscillating wall pairs |
| B | 0.36 | `WALL RETRACT` |
| B | 0.55 / 0.63 / 0.72 | Piston bank B |
| B | 0.66 | `PRESSURE BLEED` (disables bank B) |
| C | 0.03 | Escape arms |
| C | 0.10 … 0.88 | Eight closing gates |
| C | 0.96 | `EXTRACTION VALVE` |

### Spacing

| | Value | Notes |
| --- | --- | --- |
| Hazards | ~14 m target, 19.7 m median gap | Was around 8 m, which at speed left no room to read the next decision |
| Pressure cells | ~17 m target, 16.9 m median gap | Was 9 m, which crowded the corridor |

### Junction chambers

The corridor swells to about 1.5x width through each turn and eases back, rather than holding a constant width.

This is not decoration. At a 9 m turn radius in an 11.2 m corridor, the outer wall sits roughly 14 m directly in front of the player for the whole corner — a raycast through the middle of the screen at the junction hit `Shell_wallL` and nothing else. The player spent the turn looking at blank metal with no sightline into what came next. Widening opens the corner, gives the machinery somewhere to sit, and lets the vents on the outside of the curve light the way through.

### Beat shape

Each beat is introduction → escalation → finale in miniature, and the beats do the same at level scale: Beat A teaches one idea, Beat B combines it with movement, Beat C applies both under a timer.

---

## 4. Mechanics

### Glass switches reshape the route
Breaking a cyan switch runs an action on the environment:

| Switch | Distance | Effect | Restores a system |
| --- | --- | --- | --- |
| `ROUTE GATE` | 40 m | Retracts the gate blocking the corridor at 48 m | Yes |
| `INTAKE BYPASS` | 98 m | Opens the half-gate closing the right lane at 106 m | No (bonus) |
| `PISTON LOCK` | 166 m | Disables Beat B piston bank A | Yes |
| `WALL RETRACT` | 182 m | Stops both sets of oscillating walls, open | No (bonus) |
| `PRESSURE BLEED` | 214 m | Disables Beat B piston bank B | No (bonus) |
| `EXTRACTION VALVE` | 376 m | Stops every escape gate, ends the escape, completes the level | Yes |

Three of the six restore one of the tower's three systems, which is the level's tie into the game's story of restoring three systems on the way to the control core. The other three are optional relief — a player who spots them has an easier Beat B, a player who misses them has a harder one, and neither can get stuck.

### The score loop

Six route switches across 764 m is not a shooting rhythm, so the level also carries **46 pressure cells** — small cyan glass targets roughly every 17 m, placed across the full corridor width rather than only in the three lanes, so reaching one is an aim rather than a lane change. They are pure score and entirely optional.

| System | Rule | Why |
| --- | --- | --- |
| **Combo** | Builds on each break, up to x9, decays 2.6 s after the last one. A miss or a hit resets it to x1. | Makes a clean run worth more than an accurate one |
| **Spheres** | Start with 20, cap 25. Every shot costs one. Every cell returns one, every switch returns three. | Missing is the only thing that drains you, which is the Smash Hit rule |
| **Sphere recharge** | At zero, one sphere every 4 s | Safety net, see below |
| **Near miss** | Passing within 0.55 m of a hazard without touching it pays 25 × combo | Gives a reason to cut it fine instead of playing wide |
| **Speed** | Three zones: 6.8 m/s for the first half, 9.0 to three quarters, 11.6 for the final quarter, blended at the boundaries | Escalation without changing the mechanics. Top speed sits just under the old flat-out 13.2, which was too quick to read the lane ahead |

**The recharge exists because of a softlock.** In simulation, a player who shot every cell ran out of spheres before the extraction valve — the mandatory switch that completes the level — and the run became not hard but *unfinishable*. Cells were returning a sphere only 55% of the time. They now always return one, and the trickle at zero guarantees a dry player can still open the last gate.

### Collision and impact

Solid hazards actually stop mattering if nothing happens when you touch them, so the level tests and reacts.

`level.collide(playerBox, playerDistance)` tests a world-space box against every hazard within 9 m along the route — normally two or three boxes, not the level's forty. Boxes rather than a centre-to-centre distance check, because a piston head is 2.3 m across and a gate slab 4.6 m; a point threshold either lets the player through the edges of things or trips them on thin air.

`level.impact(strength)` is the environment's reaction. Every pooled light bleeds toward alarm red and spikes with a flicker, every warning strobe in range goes into overdrive, and the alarm decays over about half a second. It lives in the level rather than the HUD deliberately: it should read from any camera, and it survives the preview HUD being replaced by the real game's.

The preview adds the player-side consequences, which belong to the player workstream rather than here: −18 integrity, a 1.1 s mercy window with the avatar blinking, a 0.55 s speed penalty so the hit costs momentum, and trauma-based camera shake (shake is trauma *squared*, which is what makes a big hit feel violent and the tail settle fast instead of buzzing).

**Obstacle heights are set against the player volume, not by eye.** A standing player occupies 0.18-2.08 m and a sliding one 0.18-1.18 m, so:

| Obstacle | Occupies | Blocks standing | Cleared by |
| --- | --- | --- | --- |
| Low barrier | 0.00 - 1.12 m | yes | jump (apex 1.44 m) |
| High barrier | 1.69 - 2.51 m | yes | slide |
| Ceiling piston | 6.03 - 6.78 m retracted, 0.83 - 1.58 m extended | when extended | timing |
| Floor piston | flush in the floor retracted, up to 4.05 m extended | when extended | timing |

All eleven barriers were checked against this: each blocks a standing player, and each is cleared by exactly one input — jump for low, slide for high, neither for the other. Every piston cycles between lethal and safe rather than being a wall (28-31% of the cycle lethal for ceiling pistons, 15% for floor).

Sweeping a player-sized box down all three lanes of the whole route, the only point where all three lanes are blocked at once is 48 m — the mandatory gate before `ROUTE GATE`. That is by design; everywhere else always has a way through.

**Simulated runs** (fixed 60 Hz, so piston phase advances exactly as it would live):

| Player | Hits | Integrity | Outcome |
| --- | --- | --- | --- |
| Shoots everything, holds centre, correct inputs | 0 | 100 | Clears in 94 s. All 46 cells, 100% accuracy, x9 combo, 21,885 points, 3 systems, 10.4 s of 27.9 s left |
| Shoots only the two mandatory switches, never jumps or slides | 4 | 28 | Clears in 95 s, **0 hits during the escape** |

The second row is the one that matters. Before the escape gates were capped, that same player took six gate hits in a row.

### Solid hazards (cannot be destroyed)
- **Piston heads** - hierarchical housing → shaft → head, extending on a sine with a fast snap and a slower retract. Timing, not shooting.
- **Low barrier** - hurdle it.
- **High barrier** - slide under it.
- **Moving walls** - oscillate across the corridor in Beat B.
- **Escape gates** - close in Beat C.

### The escape
Crossing 147 m arms the finale:
- A 26-second containment countdown starts. Reaching zero is a loss condition.
- Each of the four gates starts closing when the player is 24 m away and takes 4 seconds to close fully.
- At roughly two-thirds closed only the **centre lane** is passable, so the escape is a lane-discipline test rather than a pure speed test. The HUD says so explicitly.
- Breaking `EXTRACTION VALVE` stops everything and completes the level.

---

## 5. Camera zones

The level does not own the camera; it publishes the information a camera controller needs.

| Zone | Suggested rig | Why |
| --- | --- | --- |
| Beats A and B | Third-person chase | Shows the avatar, the lanes, and the upcoming hazards |
| Junctions 1 and 2 | Chase, eased | Sampling the camera from a point *behind the player on the same route curve* makes the turn ease instead of snapping. `route.sample(distance - 7.5)` is all it takes. |
| Piston set pieces | Cinematic corner camera | `route.sample(distance + 7, 4.3, 2.9)` - inside the corridor wall, tracking the runner past the machinery |
| Beat C escape | Chase with boom shortening | Otherwise each closing gate swallows the camera as the player passes through it |

Two corrections the preview's chase rig makes, which the real `CameraController` will need too:

1. **Swing wide through turns.** A boom straight back from the player cuts the corner on a 9 m arc and presses against the inside wall. The rig offsets laterally toward the outside of the curve, proportional to how fast the heading is changing.
2. **Shorten the boom when obstructed.** A ray back along the boom against `level.obstacles`; if something is in the way, the camera sits just in front of it. Snaps in fast, eases out slowly, so it does not pump around thin geometry. Without this the Beat C gates close over the camera and the screen fills with hazard stripes.

The level emits a `junction` event 24 m before each turn so the camera controller and the HUD can react together.

---

## 6. Success and failure

**Success:** break `EXTRACTION VALVE` before the containment timer expires. Systems restored (0-3) carries into the score.

Clearing the sector shows **no summary card** — the player runs straight on into the extraction lift and rides it to Level 3, and a card there would interrupt the one transition the game is built around. The level emits `complete`, which is the elevator's cue. The summary is kept for failure, where the run has genuinely ended.

**Failure:**
- Integrity reaches zero from hazard collisions (owned by the player/physics workstream).
- The containment countdown reaches zero - the level closes every gate and emits `escape-end` with `survived: false`.

---

## 7. Assets

**Everything in this level is generated in code. No external models, textures, or sounds, so there is nothing to add to the credits register.**

- All geometry is Three.js primitives (box, cylinder, cone, sphere, torus, capsule, plane).
- All textures are drawn at runtime on a 2D canvas in `textures.js`: ribbed plating, floor grating, hazard stripes, furnace panels, and soft particle sprites.
- Normal maps are produced from those canvases with a Sobel filter (`heightToNormal`), which covers the rubric's normal/bump map requirement with the team's own work.

Audio is **not** implemented here - it belongs to the UI/audio workstream. The level's event emitter is the hook: `switch-broken`, `escape-start`, `beat`, and `complete` are the obvious cues.

---

## 8. Performance budget

### Measured on real hardware

> **These figures are for the 194 m version.** The route has since doubled to 384 m. Structurally the cost should barely move — the shell is instanced, the light pool is still fixed at 11 whether there are 39 emitters or 61 — and draw calls and triangle counts measured at the new length agree (74-262 draws, 13-30k triangles, both within the old range).
>
> **The frame rate at 384 m has not been reliably re-measured.** The attempt ran with the browser pane hidden, which throttles the animation loop; the same section timed 18 ms on one pass and 39 ms on the next. Rather than publish a number that noisy: press `F` in the preview and read the FPS counter while actually playing, with the window visible and focused. That reading is the Sprint 1 deliverable, and it is trustworthy in a way these were not.

AMD Radeon integrated graphics (`nkosi-laptop`), Chromium, 1280×720, shadows on, all 11 dynamic lights:

| Section | Draw calls | Triangles | FPS @ pixelRatio 1.25 | FPS @ pixelRatio 1.0 |
| --- | --- | --- | --- | --- |
| Beat A - Intake | 238 | 19.9k | 32.3 | 47.0 |
| Junction 1 | 264 | 20.4k | 32.5 | - |
| Beat B - Rolling Floor | 85 | 8.7k | 32.7 | 48.8 |
| Beat C - Furnace escape | 82 | 15.8k | 29.9 | 40.9 |

Geometries: 43. Textures: 11 (all procedural).

### The level is fill-rate bound, not geometry bound

This is the useful finding, and it should shape how the whole game is optimised, not just Level 2.

Frame rate barely moved between a 238-draw-call section and an 82-draw-call one — about 32 fps either way. But it tracked **resolution** almost exactly. Isolating each cost at Beat B:

| Change | FPS | Cost |
| --- | --- | --- |
| Baseline (pixelRatio 1.25, shadows, 11 lights) | 31.1 | - |
| Shadows off | 33.6 | shadows ≈ 8% |
| Shadows off, 11 lights down to 3 | 43.6 | lights ≈ 30% |
| Shadows and lights untouched, pixelRatio 0.75 | 59.0 | **resolution ≈ 90%** |

So the bottleneck is pixels multiplied by per-pixel lighting work, which is what you would expect from `MeshStandardMaterial` under eleven lights on an integrated GPU.

**Consequences for the team:**

1. **Cap the render resolution.** The preview now uses `Math.min(devicePixelRatio, 1)`, worth 10-17 fps for one line. `main.js` currently does not cap at all; on a HiDPI lab machine that is four times the pixels for no visible gain at running speed. This is the single highest-value performance change available to the project right now.
2. **Chasing draw calls further is not worth much here.** The instancing work was still right — it took the shell from ~600 draw calls to about a dozen, and it keeps CPU time and memory down — but more of it will not raise the frame rate.
3. **Dynamic light count is the second lever,** ahead of shadows. If a machine still struggles, drop the pool from 11 to 6 before turning shadows off.

### Budget

| Metric | Value |
| --- | --- |
| Draw calls | 82-264 depending on section (includes the shadow-map pass) |
| Triangles | 9k-20k |
| Dynamic lights | 11 fixed (8 point, 3 spot) - never changes, regardless of level content |
| Light emitters | 39 - competing for those 11 lights |

**On brightness and flatness.** The first attempt at "make it brighter" raised the ambient hemisphere fill in step with the brightness setting. That lifts lit and unlit surfaces by the same amount, so the sector got brighter and *flatter* at once, and read as washed out rather than lit. The fix was the opposite of more fill: the ambient contribution is now weak and scales sub-linearly, and shape comes from a light that travels with the player (outside the emitter pool, so it is always there), a stronger directional key, and the pooled lights. The far corridor is allowed to fall off.

Three decisions carry this budget:

1. **The shell is instanced.** The corridor is about thirty repeats of the same dozen boxes. As individual meshes that was ~600 draw calls; as `InstancedMesh` sets it is about a dozen.
2. **Dynamic lights are pooled.** Every vent, strobe, and switch registers as an *emitter*, and a fixed pool of 11 lights binds to whichever emitters are nearest the player each frame. Light position, colour, and intensity are uniforms, so rebinding is free - but changing the light *count* forces a material recompile and a visible stutter, which is exactly what the pool avoids.
3. **Only the nearest work light casts shadows.** Each shadow-casting light re-renders the scene into a depth map.

Animated pieces further than 70 m from the player are not ticked, and pieces further than 95 m are hidden.

---

## 9. Integration contract

Nothing here touches the player, camera, HUD, or destruction systems. To wire it into the main game:

```js
import { FoundryLevel } from "./src/levels/foundry/index.js";
import { FoundryHud } from "./src/ui/foundry-hud.js";

// On entering Level 2:
const level = new FoundryLevel({
  origin: new THREE.Vector3(0, 0, -146), // matches the prototype's Level 2 start
  shadows: false,
  straightRoute: true,  // set false once the player controller follows the route
});
level.addTo(scene);

const hud = new FoundryHud({ dev: false });
hud.bind(level);
hud.show();

// Hand the level's objects to the existing collision arrays:
breakables.push(...level.breakables);
obstacles.push(...level.obstacles);

// Each frame:
level.update({ dt, time, distance, playerPosition });
hud.update({ distance, fps, renderer, level });

// When a projectile raycast hits something:
const hit = level.breakTarget(mesh);   // null if it was not one of our switches
if (hit) score += hit.points;

// Hazard collision - pass a world-space box for the player:
const hits = level.collide(playerBox, distance);
if (hits.length && !invulnerable) {
  integrity -= 18;
  level.impact(1);       // corridor lights flash red, strobes spike
  cameraController.addTrauma(0.8);
}

// On leaving Level 2:
hud.dispose();
level.dispose();   // frees every geometry, material, and texture the level made
```

### `straightRoute`
The current prototype moves the player along `-Z` only. Passing `straightRoute: true` lays the same level out as one straight 194 m corridor so it drops in unchanged; the junctions are simply absent. Once the player controller follows `route.sample(distance)`, set it to `false` and the 90° turns appear with no other change.

### Events

| Event | Payload | Use |
| --- | --- | --- |
| `beat` | `{ index, key, name }` | Sector banner, music change |
| `junction` | `{ direction, gap }` | Camera ease, HUD chevrons |
| `switch-broken` | `{ label, points, position }` | Score, shard effect, sound |
| `system-restored` | `{ label, online, total }` | HUD systems readout |
| `escape-start` | `{ seconds }` | Music sting, camera tighten |
| `escape-tick` | `{ remaining }` | Countdown |
| `escape-end` | `{ survived }` | Win or loss |
| `impact` | `{ strength, alarm }` | HUD damage flash, hit sound |
| `complete` | `{ systemsOnline }` | Hand over to the elevator transition |

---

## 10. Still to do

- **Audio.** Every cue exists as an event; nothing plays yet.
- **Physics library.** Collision is now real box testing rather than a proximity guess, but it is still hand-rolled AABBs. When the team picks a physics library it should replace `FoundryLevel.collide`; nothing else in the level depends on how the test is done.
- **Shard/destruction effect** when a switch breaks - currently a placeholder ring in the preview, and it belongs to the destruction workstream.
- **Jump and slide** are implemented in the preview's dummy runner. The real `PlayerController` needs them, and the high/low barriers are built expecting them.
- **Elevator bay** at the end of the route - the level stops at the exit and emits `complete`; the transition is a separate workstream.
- Decide with the team whether Level 2 adopts the curved route (`straightRoute: false`) for the final build.

---

## 11. How to run it

Serve the repository over HTTP and open the preview:

```text
python -m http.server 4173
```

Then `http://localhost:4173/preview/foundry.html`.

Controls: `A`/`D` lane, `SPACE` jump, `SHIFT` slide, click to shoot a switch, `C` to cycle chase / first-person / cinematic / orbit cameras, `F` for the stats readout, `R` to rebuild the level.
