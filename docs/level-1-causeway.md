# Level design sheet - Level 1: The Glass Causeway

Status: Sprint 1 - playable and integrated into the main game, with a working hand-off to Level 2. Revision 4 (playtest feedback): short wake-up blur and sharp vision after it, the crosshair shows the real aim point, aim assist, visible vents and case files. Revision 2: night setting, destroyed-lab set dressing, visible sprinklers, tremors, customisable HUD, no audio, nothing blocking the start of play.
Code: `src/levels/causeway/` (level), `src/fx/` (post-processing, minimap, photo mode), `src/systems/` (spheres, serums, missions), `src/ui/causeway-hud.*` (HUD).

![The containment ward](./images/causeway/ward.jpg)

---

## 1. One-sentence distinction test

> Level 1 is about aiming and deciding what to break with limited ammunition.

Every system in the level feeds that decision. Spheres are scarce (20 to start, +3 per cache). Glass, sprinkler bulbs, vent covers, case files, specimen tanks, serums and the finale locks all compete for them. Cryo and shock spheres cost 2 and 3, so choosing *which* sphere is part of the decision too. Level 2 is about movement timing; Level 3 is about orientation. Level 1 is the aiming level.

---

## 2. Story

Ascension Tower, level 212: the Meridian resonance laboratory, **03:47**. Trial seven ran through the night and failed; the subject did not die. **Subject 07** wakes in a containment pod able to hold glass-shattering resonance as a sphere of energy - which is why the player throws spheres. **Dr. Vale**, frightened of what she made, has armed the tower's demolition charges. The only way out is up, through three sectors, to the control core that can cancel the sequence.

The story is told without cutscenes that stop play:

| Device | Where |
| --- | --- |
| Briefing text (story screen, rewritten; no voice) | Before the menu |
| Sector briefing card with this run's missions | Start screen, before pressing Start |
| Wake-up: the pod shatters, camera drops into first person (2.5 s, any key or click skips) | Start of run |
| Intercom subtitles from HALCYON (facility AI, cyan) and Dr. Vale (amber) - one line, can be switched off | Triggered by distance |
| Five case files - gold holograms, each in a column of light; run through or shoot one to read it; persist between runs | See "Case files" in section 6 |
| Scripted events: ward detonation behind you, a distant tower collapsing, the skybridge collapsing behind you, the atrium detonating below the lift | Beats B and C |

---

## 3. Time of day and atmosphere

**03:47, night.** A secret overnight trial is when this would happen, and night is what makes the level frightening: the building's own lights have failed, so it is lit by what is going wrong.

| Light source | Role |
| --- | --- |
| Moonlight (cool, weak, casts shadows through the windows) | The only "daylight" |
| Fires - gameplay fires in the lanes and fires burning along the walls | Main light, flickering, pooled to the four nearest |
| Battery emergency lamps on the walls (warm) | Pooled to the three nearest; brown out in tremors |
| Ceiling fluorescents - each one dead, failing (flickering) or still on | Per-instance colour, black out in tremors |
| Red alarm beacons, green exit signs, glitching monitors | Colour accents |
| The city burning below the clouds | Orange glow on the horizon and cloud undersides; smoke plumes behind |

**Fear and collapse.** Random tremors (more frequent as the run goes on and during the bridge collapse) rumble the camera, shake dust and sparks from the ceiling, and black out the lights. The view sways with fast, shallow breathing and the screen edges pulse with a heartbeat at the patient's ECG rate - both stronger when integrity is low or the air is smoky. Running through a sprinkler leaves water on the lens.

**A destroyed lab.** Every eight-metre section is wrecked differently, from a hash of its index (the same every run): knocked-over lab benches with glitching monitors, gas cylinders (some fallen), fire extinguishers, biohazard bins, hanging ceiling tiles and cables, dead light fittings, scattered lab papers, rubble, scorch marks and cracks on floors and walls, fire glowing through wall breaches, emergency lamps, exit signs, and frost-covered cryo tanks in the atrium. Walls are soot-stained toward the top with soot streaks running down; ceiling tiles are water-stained, sooted and partly missing; the floor is cracked.

## 4. Identity

| Aspect | Choice |
| --- | --- |
| Mood | A lab at night that is burning and coming down around a frightened patient |
| Palette | Soot-stained lab white, night blue, fire orange, emergency amber, alarm red; cyan only for breakable and "this way" |
| Materials | White ceramic panels, tiled floor with a puddle roughness map, diamond-tread steel deck, brushed steel, ray-traced glass, mirrored glass |
| Lighting | Moonlight with shadows, fire, emergency lamps, failing fluorescents, red alarms, impact flashes, restrained bloom (see section 3) |
| Motion | Rotating glass sculptures, falling ceiling, collapsing bridge, spinning vent fans, rising smoke and embers, sprinkler spray |
| Readability rule | Breakable = glass with a glowing cyan rim. Solid = dark steel with amber stripes, never cyan. Warning = red ring on the floor. |

The guide asked for a "bright, abstract corridor of glass bridges, rotating panels, reflective walls, and open sky". The glass bridges, rotating sculptures, mirrored atrium and open sky are all here; after playtesting, the team moved the level to night to make it a disaster rather than a showroom.

---

## 5. Map

Route: **784 m** straight along -Z, built in its own world space starting at `z = 4000` so it never overlaps Level 3's geometry.

```
 POD  BEAT A: CONTAINMENT WARD  DOOR  BEAT B: SKYBRIDGE       DOOR  BEAT C: RESONANCE ATRIUM   GATE LIFT
  0 ---------------------------- 238 ------------------------- 538 ---------------------------- 768  781
      teach: throw, lanes,           collapse chase 262-528,        mirrors, fire walls,       locks
      sprinklers, vents, smoke       sculptures, thick smoke        overdrive, 3-lock finale    I II III
```

| Beat | Distance | Introduces | Finale |
| --- | --- | --- | --- |
| A - Containment Ward | 0 - 240 | Throwing, lanes, sphere caches, reinforced glass, sprinklers, vents, smoke, first ceiling collapse | Security door (two hits) and the ward detonating behind you |
| B - Skybridge | 240 - 540 | Open sky, the collapse chase, rotating sculptures, falling glass, thermal serum in heavy smoke | Second security door |
| C - Resonance Atrium | 540 - 784 | Mirrored walls, twin fire walls, overdrive, everything combined | Three locks in order, then the lift |

![Fire and sprinkler](./images/causeway/fire-sprinkler.jpg)

### How the layout is authored

`layout.js` holds the level as data: `{ d, type, ...params }` entries, where `d` is metres along the route. The level **streams** them: an entry is built when the player is 185 m away and disposed 32 m after it is passed. The same code runs the authored level and endless mode (see section 9), and GPU memory stays flat however far the player runs.

The corridor shell is an **instanced treadmill** (`shell.js`): 30 eight-metre slots, one `InstancedMesh` per piece type, re-stamped ahead of the player as slots fall behind. Pieces belonging to other themes are hidden, so each pass only draws the pieces in view.

---

## 6. Mechanics

### Spheres (resource)

| Sphere | Cost | Effect |
| --- | --- | --- |
| Glass | 1 | Standard. Punches through panes and keeps going (Smash Hit feel) |
| Cryo | 2 | Puts out every fire within 4.8 m, freezes falling debris for 2.5 s |
| Shock | 3 | Shatters every glass target within 5.2 m, breaks reinforced glass in one hit |

Switch with `Q` / `E` or the mouse wheel. Spheres ricochet off solid hazards and bounce on the floor.

### Aiming

| Rule | Why |
| --- | --- |
| **The crosshair follows the mouse** and the system cursor is hidden in play. Throws go exactly where the crosshair is | The first build painted the crosshair in the centre of the screen while throws went to the mouse pointer, so it lied about where you were aiming |
| **Aim assist** (Settings → Gameplay, on by default): if the crosshair is near a breakable target on screen, the throw goes to it. Each target's catch radius is its own on-screen size plus 30 px, and nearer targets win ties. The crosshair turns amber and gains a ring, and the target brightens, while locked | Sprinkler bulbs, locks, vents and caches are small and you are running: a 35 px near miss now hits, a 70 px one still misses |
| **Leading moving targets**: each target's velocity is tracked (smoothed over frames, in game time so bullet time is handled), and the throw aims where it will be when the sphere arrives | Falling glass and spinning sculpture blades |
| **Ballistic compensation**: the sphere is aimed high by exactly the drop over its flight time, so it arcs onto the target | Cryo and shock spheres are heavier |
| **Near misses count on small targets**: a sphere passing within its radius + 0.25 m of a small target's bounding sphere breaks it | A frame-by-frame line test can step past a small bulb |
| **Calm camera**: the view drifts toward the aim by at most ~1 m at 14 m, smoothed | Turning the view hard toward the pointer slid the world out from under the crosshair |

This applies in every level, since the throw code is shared (see `docs/level-transition.md`). The `aim` check tests it.

Start 20. Each cache +3 (14 caches, 62 spheres available in total against 30 glass targets and many optional ones). At zero, one sphere recharges every 2.5 s, so the lock finale can never soft-lock.

### Serums (power-ups)

Shoot the capsule or run through it. Each one is a visible transformation driven by the post-processing shader:

| Serum | Duration | Rule | Look |
| --- | --- | --- | --- |
| Prism split | 10 s | Every throw fires three spheres in a fan | Rainbow dispersion fringe around the frame |
| Thermal sight | 12 s | Smoke and fog thin by 70-80% | Iron-bow thermal palette; fire burns white |
| Kinetic shield | 25 s | Absorbs the next two impacts (solid, glass, fire) | Hex-cell Fresnel bubble with impact ripple |
| Overdrive | 8 s | Free throws, +3 m/s | Saturated, pulsing magenta edges, speed streaks |

### Environment systems

| System | How it works | Why |
| --- | --- | --- |
| **Fire** | Ray-marched volume. Burns 18 integrity per second while you stand in it, adds smoke nearby, lights the corridor | The level's main hazard that *can* be removed |
| **Sprinklers** | The small red glass bulb is shootable - exactly how real sprinkler heads trigger. Floods the fires within 13 m and wets the floor into a mirror. Ten more heads have already burst in the heat and shower the route | Rewards spotting a small target instead of dodging |
| **Wall fires** | Burning along the walls, outside the lanes: light, smoke and soot, never damage | The building is on fire everywhere, not only where the gameplay is |
| **Tremors** | Random rumbles, dust, sparks and blackouts (section 3) | Signals the collapse; raises tension |
| **Smoke** | Authored smoke zones plus smoke from each fire. Thick smoke veils the screen, drops the fog, and drains integrity above 55% | Makes the air a resource |
| **Vents** | A round frosted cover on the wall, mounted low (2.5 m; 3 m in the atrium) and turned ~35° toward the approaching runner, with a glowing cyan ring (the breakable colour) that pulses harder the smokier the air, a backlit "SMOKE VENT" sign, and a red status lamp. Throw any sphere at the cover: the ring and lamp turn green, the fan spins up, smoke visibly spirals into it, and that zone's smoke falls by up to 85%. Six vents: two in each beat's smoke zone | Counter to smoke; built to be found exactly when you need it |
| **Ceiling collapse** | Red ring and dust at 44 m, falls at 21 m. Beams land as lane-blocking solids; glass panels can be shot mid-air for 400 | Telegraphed danger |
| **Bridge collapse chase** | From 262 m the bridge falls away behind you at 8.6 m/s. Braking (S) too long lets it catch you | Gives the speed control a reason to exist |
| **Rotating sculptures** | Steel pole blocks the centre lane; two glass blades sweep the outer lanes | Shoot or time |
| **Security doors** | Full-width reinforced glass. Two hits, or crash through for 24 damage | Mandatory shooting moments |
| **Finale gate** | Locks I, II, III must break in order; wrong order is rejected. Reach the gate with them intact and you have 9 s before the atrium falls | The level's final aiming test |

### Pace: from sedated to running for your life

Subject 07 has just been woken from a sedated pod, so the run does not start at full speed:

| Stretch | Pace | What the player feels |
| --- | --- | --- |
| Pod, 0-40 m (about 6 s) | 6.0 m/s | Heavy uneven steps, slow drifting gaze, blurred and slightly doubled vision, drained colour, slow heartbeat, sluggish lane changes. The blur and sway fade out by 40 m: "Your vision clears" |
| Ward, 40-230 m | 6.0 → 10.2 m/s (smooth) | Sharp vision; the body is still catching up, so the pace keeps climbing and the heartbeat quickens; "Adrenaline: you can run now" at full pace |
| Skybridge, 240-540 m | Up to 11.0 m/s | Peak pace while the bridge collapses behind (the collapse runs at 8.6 m/s, so the player always outpaces it unless they brake) |
| Atrium, 540 m on | 10.2 m/s | Settles so the lock finale stays about aiming |
| Explosions | +up to ~1 m/s surge, fading over ~3 s | The ward detonating behind you, and the distant tower collapsing, scare the patient into running |

The groggy start doubles as the tutorial: the first pane, cache and sprinkler arrive while the player still has time to think. The **eyes and the legs recover on different curves on purpose**: the first version tied the blur to the pace, so it lingered for ~30 s; playtesting asked for proper vision early. `causewayPace(distance)` in `main.js` returns `pace`, `sedation` (speed and pulse, 20-230 m) and `drowsy` (blur and sway, 4-40 m). Endless mode keeps its own ramp (base pace + 1 m/s every 300 m, cap +6).

### Case files

Five collectibles that tell the story. Each is a **gold** hologram (gold so it never reads as breakable glass) above a floor projector, standing in a **column of light** with a glowing ring on the floor, visible from far down the corridor. They float at chest height in a lane: **run through one or shoot it**. A card shows the text and "Case file N of 5 recovered". Found files persist between runs and count toward the "Recover all 5 case files" mission.

| # | Where | Lane |
| --- | --- | --- |
| 1 | Ward, 50 m - just past the first sphere cache | Centre |
| 2 | Ward, 186 m - in the smoke, before the security door | Left |
| 3 | Skybridge, 410 m - between the two vents | Centre |
| 4 | Atrium, 642 m - after the fallen beam | Right |
| 5 | Atrium, 714 m - just before the lock finale | Centre |

### Player tools

| Tool | Input |
| --- | --- |
| Lanes | `A` / `D` |
| Sprint / brake (+4.4 m/s over the current pace; brake to 5.2, never below 4) | `W` / `S` |
| Focus - bullet time at 38% speed, meter refills over time and on breaks | Hold right mouse |
| Jump / slide (shared with Level 2) | `Space` / `Shift` |
| Camera: first person / chase | `C` |
| Minimap - orthographic picture-in-picture (off by default) | `M` |
| Choose which HUD panels show | `V` or the VIEW button |
| Hide the whole HUD | `H` |
| Photo mode with filters and 360° export | `P` |
| Performance overlay | `F` |

### Scoring

Glass 150, reinforced 300, mirror 220, cache 250, sprinkler/vent 100, file 500, lock 500, mid-air glass 400, near miss 25; all multiplied by the combo (up to x9, decays after 2.6 s, reset by a miss or a hit). Distance pays 2 points per metre. Reaching the lift adds 50 per sphere, 10 per integrity point, and 250 per case file. Each completed mission is worth 750.

### Missions and replay

Three missions per run, drawn from a pool of 13 and rotated by run count so replays ask for different things (e.g. "Open 3 sprinklers", "Shatter 2 falling panels mid-air", "Reach the lift in under 100 s"). Completed missions, case files found, best scores and best endless distance persist in `localStorage`. Clearing Level 1 once unlocks **Endless lab**.

---

## 7. Camera zones

| Moment | Camera | Detail |
| --- | --- | --- |
| Title screen | Cinematic drift | Slow sway through the ward |
| Wake-up | Orbit → first person | 2.5 s: the pod shatters, the camera smooth-steps down into the eyes. Any key or click skips |
| Play | First person (default) | Lateral position eased, forward exact (no lag at speed); looks slightly toward the aim; head bob; breathing sway; leans into lane changes; tremor rumble; FOV widens with speed and overdrive, narrows in focus |
| Play | Chase (`C`) | Behind and above; the avatar and shield bubble are visible |
| Minimap | Orthographic, top-down | Picture-in-picture viewport of the same scene, icon layer only |
| Lift | First person → third person → orbit | Pulls back to reveal the avatar in the cabin, then orbits outside the shaft as the atrium detonates below |
| Photo mode | Free orbit | Drag, zoom, FOV |
| Level preview | Guided flythrough | World-attached labels explain each object |

`Reduced motion & camera shake` in Settings removes head bob, breathing sway and lean, shortens the cinematics, and quarters camera shake and tremors.

### HUD

Every panel is optional (VIEW button, `V`, or Settings → Interface; `H` hides everything). Defaults are deliberately sparse:

| Panel | Default |
| --- | --- |
| Spheres and score, vitals (ECG, integrity, air), sphere type/speed/focus, intercom subtitles, hints and section titles, active serums | On |
| Missions (they are on the start screen), minimap, performance overlay | Off |

---

## 8. Success and failure

**Success:** break locks I-II-III, run into the Calibration Lift. The level emits `lift-enter`; the host plays the lift ride and hands over to Level 2 (see `docs/level-transition.md`).

**Failure** (each has its own end-screen explanation):

| Cause | Message |
| --- | --- |
| Integrity 0 from impacts | "Shift lanes earlier and preserve your spheres." |
| Fire | "Open sprinklers or throw cryo spheres." |
| Smoke | "Break vent covers to clear the air." |
| Caught by the bridge collapse | "Sprint with W when the collapse closes in." |
| Gate timer | "Break locks I, II, III in order." |

`R` restarts without refreshing the page.

---

## 9. Endless lab

`EndlessGenerator` in `layout.js` stitches randomised chunks forever: pane gauntlets, fire lanes with their sprinkler, hazard-plus-glass pairs, collapses, sculptures, specimen rows, serums. Themes cycle every 240 m, speed rises 1 m/s every 300 m (cap +6), and the generator enforces the authored level's two rules - never block all three lanes with solids, and never go more than ~34 m without a sphere cache.

---

## 10. Integration contract

`CausewayLevel` follows the same shape as `FoundryLevel`, so the host treats both the same way.

| Member | Purpose |
| --- | --- |
| `new CausewayLevel({ origin, mode, quality })` | `mode` is `"story"` or `"endless"`; `quality` is `"high" \| "medium" \| "low"` |
| `addTo(scene)` / `dispose()` | Lifecycle. `dispose()` frees every geometry, material, texture and render target |
| `update({ dt, time, distance, player, playing })` | Advance the world. `playing: false` for menu, preview and lift |
| `breakables` / `solids` | Meshes a projectile can break / bounce off, near the player |
| `collide(playerBox, distance)` | `{ hits, panes, grazes, pickups }` |
| `breakTarget(mesh, { point, direction, ball, body })` | Break or crack; returns points, spheres, label, serum, file, or `rejected` for a wrong lock |
| `splash(point, radius, ball)` | Cryo and shock area effects |
| `fireExposure(box)`, `state.smoke`, `state.chase`, `state.finale` | Hazard state the host turns into damage and HUD |
| `stopDistance` | Furthest the player may run (gate, then lift centre) |
| `menuCamera`, `updateIntro`, `previewCamera`, `updateLift` | Cinematics |
| `renderProbe(renderer, scene)` | Render one reflection-probe face; call after the main render |
| `wetExposure(player)`, `state.tremor.level`, `skipIntro()` | Lens water, tremor strength, skip the wake-up |
| `events.on(name, fn)` | `radio`, `title`, `hint`, `file`, `serum`, `sprinkler`, `vent`, `extinguish`, `explosion`, `tremor`, `collapse-warning`, `chase-start`, `gate-armed`, `lock`, `gate-open`, `gate-sealed`, `crushed`, `lift-enter` |

### Scene hierarchy

```
CausewayRoot                 at origin; local z = -distance
|-- Sky                      far-plane sphere, ray-marched clouds (follows the player)
|-- Skyline                  one InstancedMesh, towers wrap around the camera
|-- CollapsingTower          scripted distant collapse
|-- Shell                    instanced treadmill (30 slots x ~60 piece types, incl. set dressing)
|-- Props                    streamed objects, each at (x, y, -d)
|-- Effects
|   `-- WorldSpaceFX         offset by -origin so particles and shards work in world space
|-- Lighting                 moon + target (follows player), sky fill, 4 fire, 3 emergency, 2 alarm, 1 flash
`-- PlayerFX                 kinetic shield bubble
```

Why it is parented this way: props are children of the root so the whole level moves as one; particle systems and GPU shards compute world-space positions in their shaders, so their holder cancels the root offset; the sun and its target follow the player so a small shadow map always covers the screen; the shield follows the player but is not parented to the avatar, so the figure itself is unchanged.

### Render layers

| Layer | Contents | Seen by |
| --- | --- | --- |
| 0 WORLD | Opaque level, sky | Main camera, probe, 360 capture |
| 1 GLASS | Glass, shards, crystals, locks | Main camera (glass pass), 360 capture - never the probe (no self-reflection or feedback) |
| 2 FX | Fire, smoke, embers, water, bursts, serums | Main camera (last pass), probe |
| 3 MINIMAP | Flat icons | Minimap camera only |

---

## 11. Assets

**Everything is generated in code. No external models, textures or sounds.** Geometry is Three.js primitives; textures are drawn on canvases at runtime in `textures.js` (cracked and sooted lab tile, soot-streaked ceramic wall, stained ceiling tiles, tread deck, brushed steel, hazard paint, lab papers, crack/scorch decals, signage, hologram text); normal maps come from those canvases through a Sobel filter; the 3D noise used by every shader is a 256×256 `DataTexture`. Techniques adapted from published work are credited in `docs/credits.md`.

There is **no sound or voice** in this build - audio belongs to another team member. The event emitter is the hook for the audio workstream (`explosion`, `tremor`, `sprinkler`, `lock`, `gate-open`, `lift-enter`, ...).

---

## 12. Performance budget

Measured with `renderer.info` across **every render call in a frame** (shadow map, world, glass, effects, one probe face, bloom, composite, minimap), High quality, 960×540:

| Section | Draw calls | Triangles |
| --- | --- | --- |
| Ward | 233 | 68k |
| Fire and sprinkler | 277 | 87k |
| Vent / smoke section | 247 | 81k |
| Skybridge | 232 | 75k |
| Atrium | 236 | 80k |
| Gate | 184 | 58k |

Revision 2 added ~20 set-dressing piece types (one draw call each per pass) and the soot, water and emergency-light systems; dressing uses 4- and 8-sided cylinders to hold the triangle count. For comparison, Level 2 measured 74-262 draw calls. These numbers were taken in software rendering, so **frame rate must be measured on real lab hardware**: press `F` in game.

What keeps it there:

| Technique | Saving |
| --- | --- |
| Instanced shell and set dressing, unused piece types hidden | Every piece type is one call for the whole route, whatever the wreckage |
| Streaming spawn/despawn, theme-aware draw distance (120 m indoors, 165 m on the bridge) | Bounded object count: 13-45 live objects |
| Reflection probe renders one 128² face per frame | 1/6 of a cube per frame instead of 6 |
| Shadow map rendered once per frame, not once per render call | The probe and minimap do not redraw it |
| Pooled lights: fixed count, rebound to the nearest emitters | No shader recompiles mid-run |
| GPU-driven shards, embers, water, smoke, bursts | Zero CPU per particle |
| Auto quality ladder (below) | Holds frame rate without making the image soft |
| Level disposal on the lift | Level 1's GPU memory is freed before Level 2 runs |

**Auto quality ladder.** When frame time stays above 21 ms (under ~48 fps) for over a second, Auto steps down in order of how little it shows: (1) the reflection probe updates every other frame; (2) "lite" post-processing - half-resolution refraction snapshot and a smaller bloom buffer; (3) render resolution in 7.5% steps, **never below 85%**, with an unsharp-mask sharpening pass that strengthens as resolution drops; (4) only above ~34 ms (under ~30 fps) does it switch to Low. It steps back up when there is headroom. The first build went straight to resolution and down to 62%, which is why the image went soft on slower machines and stayed that way.

Quality presets: **High** (full post, full-resolution refraction, 2048 shadow map, 18 fire steps), **Medium** (half-res refraction, 0.85 render scale, 1024 shadows), **Low** (no post-processing, no shadows, 10 fire steps, 64² probe updated every third frame, 2 fire lights). Level detail (steps, lights, probe size) applies from the next run; post-processing switches immediately.
