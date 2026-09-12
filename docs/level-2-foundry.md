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
| Lighting | Swinging amber work lights, pulsing furnace glow, red warning strobes |
| Motion | Pistons, conveyor belts with crates, steam jets, sparks, sliding walls |
| Readability rule | Breakable = cyan glass, glowing, pulsing. Solid hazard = red/amber metal, blocky, never glowing cyan. The player should never have to guess. |

---

## 3. Map

Total route: **194 m**, laid out as straights and arcs rather than one straight corridor.

```
  START                                            J1
    |--------- BEAT A: INTAKE (58m) --------------->\
                                                     \  (90° left, r=9)
                                                      \
    /<------- BEAT B: ROLLING FLOOR (56m) -------------/
   /
  J2  (90° right, r=9)
   \
    \--------- BEAT C: FURNACE THROAT (52m) --------> EXIT
```

| Distance | Section | Contents |
| --- | --- | --- |
| 0 - 58 | **Beat A - Intake** | Conveyor, 2 heat vents, 1 ceiling piston, 1 low barrier, blocked gate at 48 m, `ROUTE GATE` switch at 40 m |
| 58 - 72 | **Junction 1** | 90° left turn. Vents on the outside of the curve, strobe on the apex, floor chevrons at 54 m |
| 72 - 128 | **Beat B - Rolling Floor** | 3 conveyors, 3 heat vents, 3 piston banks (different speeds and phases), high barrier (slide) at 88 m, low barrier (jump) at 98 m, oscillating moving walls at 110 m, `PISTON LOCK` switch at 100 m, `WALL RETRACT` switch at 116 m |
| 128 - 142 | **Junction 2** | 90° right turn, same treatment as J1 |
| 142 - 194 | **Beat C - Furnace Throat** | 6 heat vents, 5 warning strobes, escape armed at 147 m, 4 closing gates at 156 / 166 / 176 / 186 m, `EXTRACTION VALVE` switch at 190 m |

### Beat shape

Each beat is introduction → escalation → finale in miniature, and the beats do the same at level scale: Beat A teaches one idea, Beat B combines it with movement, Beat C applies both under a timer.

---

## 4. Mechanics

### Glass switches reshape the route
Breaking a cyan switch runs an action on the environment:

| Switch | Distance | Effect | Restores a system |
| --- | --- | --- | --- |
| `ROUTE GATE` | 40 m | Retracts the gate blocking the corridor at 48 m | Yes |
| `PISTON LOCK` | 100 m | Stops and removes all three Beat B piston banks | Yes |
| `WALL RETRACT` | 116 m | Stops the oscillating walls in the open position | No (bonus) |
| `EXTRACTION VALVE` | 190 m | Stops every escape gate, ends the escape, completes the level | Yes |

Three of the four restore one of the tower's three systems, which is the level's tie into the game's story of restoring three systems on the way to the control core. The fourth is optional relief for a player who wants an easier Beat B.

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
| Beat C escape | Chase, tighter | Keeps both closing gates in frame |

The level emits a `junction` event 24 m before each turn so the camera controller and the HUD can react together.

---

## 6. Success and failure

**Success:** break `EXTRACTION VALVE` before the containment timer expires. Systems restored (0-3) carries into the score.

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
| `complete` | `{ systemsOnline }` | Hand over to the elevator transition |

---

## 10. Still to do

- **Audio.** Every cue exists as an event; nothing plays yet.
- **Real collision.** The preview uses a proximity check as a placeholder. This should move to whichever physics library the team picks in the Sprint 1 backlog.
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
