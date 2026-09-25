# Level 3 handoff notes

**Read this first if you're a new session picking up Level 3 work.** It's
written so you don't have to re-derive context from scratch or make the user
retype the last several hours of decisions. For full design detail (numbers,
tables, rationale) see [`level-3-meltdown.md`](./level-3-meltdown.md) - this
doc is the shorter "what's the state of things and how do I get moving"
version.

Last updated: end of the session that built Phase A end-to-end with the
user's supplied 3D assets, real projectile physics, a custom fire shader, and
synthesized audio.

---

## 1. What this level is

Level 3 of Shattershift (a Temple-Run/Smash-Hit hybrid). Story: the player
wakes mid-collapse in a lab where kidnapped test subjects were experimented
on; the staff triggered a self-destruct to burn evidence before the FBI
arrives; a failed experiment (a ball launcher) is the only tool; the player
runs/shoots their way up through the building to a roof extraction.

Two phases:

- **Phase A - "the escape"**: a run through the collapsing building. **This is
  built** and is what the rest of this doc is about.
- **Phase B - "the roof"**: a small combat encounter against the scientists
  before the helicopter arrives. **Design only, no code.** See
  `level-3-meltdown.md` §4.

This supersedes the old "Inverted Core" gravity-boss concept that's still
written in `docs/project-brief.md` §5. That doc hasn't been updated yet -
don't treat it as current for Level 3.

---

## 2. How to see it right now

```bash
python -m http.server 4173
```

Open `http://localhost:4173/preview/meltdown.html`, hard-refresh
(`Ctrl+Shift+R` - Python's server doesn't send cache-busting headers and the
browser will happily serve you stale JS otherwise), click to start.

Controls: `A`/`D` lane, hold left mouse to fire, `SPACE` jump (or mash it at a
fallen duct to push through), `SHIFT` slide, `C` cycles camera, `B` toggles
bloom, `F` toggles a dev stats readout, `R` restarts.

This is **not wired into the main game yet**. `main.js` still has the old
Level 3 stub (gravity-tilt camera code left over from the Inverted Core
concept). Integrating this level means replacing that stub - see §7.

---

## 3. Why it exists as a standalone preview (not in main.js)

Same pattern Level 2 used: `src/levels/foundry/` was built and proven as
`preview/foundry.html` before being wired into `main.js`. Level 3 follows the
same path and is at the same "preview complete, integration pending" stage.
The preview's dummy runner (movement, camera, launcher, vitality/balls rules)
is scaffolding meant to be thrown away and replaced by the real player and
camera controllers when it's wired in - it is **not** meant to be preserved
as-is.

---

## 4. What's built - file by file

```
src/levels/meltdown/
  index.js       MeltdownLevel class - the level itself. Route (3 beats, 2
                 turns), 6 halls, corridor dressing, obstacle placement,
                 hidden timer, breakTarget()/collide() contract, the chasing
                 fire front. This is the file to read first to understand
                 the level's shape.
  kit.js         ~30 factory functions: every hazard, pickup, and dressing
                 piece. Each hazard separates its visible mesh from an
                 invisible collider box, so the collider never changes even
                 after a real imported model gets swapped in.
  halls.js       buildHall() - builds one of the 6 big rooms from a theme
                 (ward/lab/containment/experiment/archive/boiler), plus
                 bakeStatic() which merges hundreds of static meshes into a
                 handful of draw calls per hall afterward.
  fire.js        Custom GLSL fire + smoke shader (instanced camera-facing
                 quads, fractal noise, black-body colour ramp). No texture
                 sprites, no external smoke asset.
  assets.js      Loads the 14 converted .glb models, and the "asset slot"
                 system: kit pieces build a procedural stand-in + an empty
                 slot describing the box a real model should fill;
                 fillAssetSlots() swaps them in once loading finishes. Level
                 is fully playable before this resolves.
  textures.js    All wall/floor/sign textures, drawn on canvas at runtime
                 (same approach as Level 2 - nothing to credit).
  effects.js     Projectiles (real ballistic balls with gravity, ray-swept
                 collision, bounce) and Debris (pooled shards/sparks/dust).
  lighting.js    Thin wrapper reusing Level 2's LightPool + a
                 danger-reactive ambience (reddens as vitality drops).

src/audio/meltdown-audio.js   All sound synthesized live via Web Audio API.
                               No sample files - nothing to credit, and every
                               bed reacts continuously to game state.

src/ui/meltdown-hud.js/.css   The HUD. Deliberately sparse: only ball count
                               and vitality are ever shown persistently (per
                               the brief). Everything else - the phase
                               timer, hall names, power-ups, warnings - is a
                               toast or a one-time banner.

src/three-addons.js           Single place Three.js *add-ons* (GLTFLoader,
                               EffectComposer/bloom, RoomEnvironment,
                               BufferGeometryUtils) are imported from,
                               mirroring how src/three.js centralises the
                               core import. Needs an import map (see §7).

preview/meltdown.html          Preview page. Has the import map add-ons need.
preview/meltdown-preview.js    Scaffolding: dummy runner, 4 camera rigs,
                                launcher/vitality/overheat rules, wires
                                projectiles+debris+audio+HUD together.

assets/meltdown/*.glb          14 converted models, ~7MB total.
tools/assets/                  Headless Blender conversion scripts + a
                                README recording exactly what was exported
                                from what (source object names, settings).
docs/credits.md                Asset register. 4 rows still say TODO for
                                source/licence - see §8.
docs/level-3-meltdown.md       The full design doc (numbers, rationale,
                                Phase B design). Longer and more detailed
                                than this file.
```

---

## 5. How the big pieces work (so you don't have to reverse-engineer them)

### Route and halls

`index.js` builds a route with `createRoute()` (reused from
`src/levels/foundry/route.js` - straight segments + two 90-degree arcs,
identical math to Level 2's junctions). Six large rooms ("halls") sit at
fixed points along the route; the corridor shell simply skips instancing
wall/floor stations inside a hall's span, and `buildHall()` builds that room
independently with its own width, height, and theme-based dressing. The
corridor between halls carries the actual obstacle patterns.

### Hazards: visible mesh vs. invisible collider

Every hazard factory in `kit.js` returns a group containing decorative
meshes plus one or more **invisible** `THREE.Mesh` colliders (material
`visible: true` but zero opacity - not `mesh.visible = false`, which the
shared `collide()` test treats as "hazard cleared/disabled"; this was an
actual bug caught during testing, see §6). This split is what let real
imported models (assets.js) get swapped in for procedural stand-ins without
touching any collision code.

### Obstacle patterns, not single hazards

Early version: one hazard per lane-position, trivially dodged by standing in
another lane. Current version (`_buildPatterns()` in `index.js`): every
obstacle is placed as a **pattern** - e.g. "two lanes blocked, one open",
"all three lanes need a different response (jump/slide/shoot)", "a laser
grid that sweeps through the only safe height". Patterns escalate by tier
(beat 1/2/3). A scripted fairness check (see §6) confirmed every pattern
cluster in the level has at least one way through.

### The chasing fire

`_buildFireFront()` in `index.js` creates a group of fire-shader instances
that the **host** (not the level) repositions every frame via
`level.setFireFront(distance)`. The host computes that distance directly
from player vitality (`playerDistance - (4 + vitality * 0.42)`), so the
fire's visible distance behind the player *is* vitality made literal. When
the player stumbles, the preview's camera briefly swings to show the fire
gaining (`runner.lookBack`), matching the brief's "you look back and see the
fire catching up" ask.

### Projectiles and breakage

`effects.js`'s `Projectiles` class fires real spheres with gravity, not
raycast-instant hits: each frame it ray-sweeps the ball's travel segment (so
it can't tunnel through thin glass at speed), checks breakables first then
solids, and either breaks/bounces. `Debris` is pooled shards/sparks/dust
recycled with no per-hit allocation. Both are host-owned (created in
`meltdown-preview.js`), not level-owned - same split as vitality/balls.

### Assets

`assets.js` defines named slots (`MELTDOWN_ASSETS`). A kit piece calls
`assetSlot(name, fitSpec, placeholders)` and adds it as a child immediately
(so the level is playable with a procedural stand-in). `loadMeltdownAssets()`
loads every `.glb` async; `fillAssetSlots()` walks the tree afterward,
measures each model's real bounding box, scales/rotates it to fit the slot's
spec, and hides the placeholder. A few heavy multi-mesh models (`ventilation`
parts, `officeDesk`, `launcher`, `ventFan`) get merged by material on load to
cut draw calls.

### Why Blender got installed

The user supplied 14 asset archives (`.zip`/`.rar`, mostly Poly-Haven-style
`.blend` + raw 4K EXR textures, plus a couple of `.fbx`/`.obj` kits). None
were web-ready. There's no Blender on this machine by default - it was
installed via `winget install BlenderFoundation.Blender` (with the user's
explicit go-ahead, asked via AskUserQuestion first) and driven **headless**
(`blender -b --python tools/assets/convert.py --`) to resize textures,
decimate heavy meshes, and export `.glb`. See `tools/assets/README.md` for
the exact commands used per asset - they're reproducible, nobody needs to
open Blender by hand to redo this.

---

## 6. How this was tested (given no human playtest happened)

The browser tool used in this session throttles `requestAnimationFrame` hard
when its pane isn't actively being screenshotted, which makes real-time
"hold click and watch what happens" testing unreliable. The workaround used
throughout: **script the game logic directly** via `javascript_tool` against
`window.__meltdown` (exposed by the preview for exactly this) rather than
relying on wall-clock waits. Concretely, what was actually verified:

- **Full-route smoke test**: instantiate `MeltdownLevel`, step
  `level.update()` across the entire 788m route, assert no exceptions and
  that every expected event fires once (beat/hall/sign/hazard-fall/
  hazard-land/warp-start/warp-end/complete).
- **Fairness check**: for every obstacle cluster, sweep all 3 lanes x 3
  poses (run/jump-apex/slide) x time 0-5s (with animated hazards ticked)
  with every falling hazard already landed, using the *exact* same
  `collide()` box math the game uses. Result: 38 clusters, 0 impassable.
- **Projectile/breakage test**: fire a scripted ball at a glass pane, confirm
  it breaks, spawns debris, and the collider is properly disabled afterward
  (`glassColliderDisabled: true`, `stillBreakable: false`); confirmed a
  reinforced pane needs the right number of weakened vs. full-power hits.
  Also: real bug found and fixed here (`mesh.visible=false` colliders were
  silently skipped by `collide()` - fixed by using zero-opacity material
  instead of `.visible=false`).
- **Asset loading**: confirmed all 14 models load, all 476 asset slots (at
  the time) get filled, no console errors on a hard-refreshed load.
- **Visual spot-checks**: screenshots at handpicked distances (each hall,
  the mandatory duct-bridge crossing, the fire front up close, the
  experiment ring, a fallen duct mid-fall) to sanity-check that things look
  like what they're supposed to.

**What was NOT done**: an actual continuous human-feel playtest (holding
movement/fire keys and watching the run develop in real time). The pacing
numbers in `level-3-meltdown.md` §3 (drain rates, timer, obstacle spacing)
are budgeted on paper and proven *passable*, not proven *fun* or *well-paced*.
That's the highest-value next step if you're picking this up.

---

## 7. Wiring into `main.js` - what that actually involves

Not done. When someone does it:

1. `index.html` needs the same import map `preview/meltdown.html` has (see
   that file's `<head>`) - the GLTFLoader/bloom/RoomEnvironment add-ons
   import the bare specifier `"three"`, which needs to resolve to the exact
   same URL `src/three.js` uses, or you get two copies of Three loaded.
2. Replace the old Level 3 stub in `main.js` (the `camera.up` gravity-tilt
   code, search for `currentLevel === 3`) with `MeltdownLevel` +
   `MeltdownHud`, following exactly the pattern already used for
   `FoundryLevel`/`FoundryHud` a few lines above it in the same file.
3. The preview's dummy runner logic (vitality/balls/overheat/launcher rules,
   camera rigs) needs to be reconciled with whatever the real
   `PlayerController`/`CameraController` end up being - it's meant as a
   reference for the rules, not code to paste in as-is.
4. `level.loadAssets(baseUrl, {onProgress})` is async - decide how/whether
   the main game shows a loading indicator for it (the preview's HUD has
   `setLoading()` already, if useful).

---

## 7b. Second asset batch (characters, weapons, helicopter)

Twelve more Sketchfab models were converted into `assets/meltdown/` but are
**not wired into anything yet** and are **not** in `MELTDOWN_ASSETS` in
`assets.js` (add them there when you use them). Details and full attribution
in `docs/credits.md` and `tools/assets/README.md`.

- **Main characters (user's decision):** `player_female.glb` and
  `player_male.glb` (renamed from the SCP scientist models). The obvious next
  step is replacing the preview's capsule avatar with one of these.
  **They are not rigged** - no skeleton, no animations - so they can only be
  shown as a static pose for now. A running animation needs them rigged first
  (Mixamo's free auto-rigger is the usual route), then an animation clip.
- **Phase B enemy candidates:** `scientist_radioman`, `scientist_colossus`,
  `scientist_rust` (all rigged, no animations), plus weapons/gadgets
  (`weapon`, `steampunk_weapon`, `dead_end_weapons`, `weapon_set`,
  `dragon_flail`).
- **Phase B rescue helicopter:** `helicopter.glb` (Hind).
- **`patient.glb`**: a test-subject figure - good for the occupied specimen
  tanks and holding cells.
- All are **CC-BY-4.0**: attribution is legally required *in the game's
  credits screen*, not just `docs/credits.md`.

---

## 8. Loose ends / known TODOs

- **`docs/credits.md`**: 4 asset rows (ventilation kit, Javelin launcher,
  alarm light, geothermal factory) need their actual source URL and licence
  filled in by whoever downloaded them - it can't be read from the files
  themselves. The Poly Haven rows also want a quick confirm-against-the-
  actual-download-page pass.
- **`C:\gx`** on this machine still has ~400MB of Blender conversion scratch
  files (extracted source archives, intermediate exports). Harmless to
  delete, wasn't cleaned up because it's outside the repo and a path-root
  delete got blocked by a safety guard.
- **Phase B** is 100% unbuilt - see `level-3-meltdown.md` §4 for the design.
- **No playtest** - see §6.
- **`project-brief.md`** still describes the old Inverted Core concept for
  Level 3 and hasn't been updated to match.

---

## 9. If you're a fresh session and want the short version

Read `index.js` top-to-bottom first (it's commented as a guide to the whole
level), then skim `kit.js` for what hazard/dressing pieces exist. Run the
preview, hard-refresh, and just play it before changing anything - most
questions about "why does X work this way" are answered by seeing it. If
something seems broken, check whether it's a real bug or the browser-pane
frame-throttling artifact described in §6 first.
