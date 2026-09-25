# Test plan and bug log - Level 1: The Glass Causeway

Covers documentation set items 7 (test plan and bug log) and part of 8 (contribution evidence) from the project guide, for Level 1 and its hand-off to Level 2.

---

## 1. How to run the checks

```text
npm install --no-save playwright
npx playwright install chromium
node tests/causeway/run.js
```

`--only=pace,playthrough` runs selected checks. Add `--shots` to regenerate the screenshots in `docs/images/causeway/` from the current build.

The harness serves the repository on a spare port and drives the **real game** (`index.html`) in headless Chromium. Software rendering manages only a frame or two per second, so gameplay is advanced with `__dbg.step()`, which runs the same `updateGame()` the browser runs, without rendering. It exits non-zero on failure.

| Variable | Effect |
| --- | --- |
| `CAUSEWAY_CHROMIUM` | Use a specific Chromium binary |
| `CAUSEWAY_SOFTWARE_GL=0` | Use the real GPU |
| `CAUSEWAY_THREE_LOCAL=path/to/three.module.js` | Serve Three.js locally instead of from the CDN (offline machines) |

Run the Level 2 harness too (`node tests/foundry/run.js`): both must pass before merging.

---

## 2. What is checked, and why

### `layout` - does the authored level follow its own rules?

| Check | Guards against |
| --- | --- |
| No distance where solids block all three lanes | An unavoidable hit |
| Every fire has a sprinkler within 13 m, or a lane free of fire | An unavoidable burn |
| Every smoke zone's vents exist and sit inside the zone | A vent that clears the wrong section |
| Case files 0-4 each appear exactly once | Missing story beats / an impossible "all files" mission |

Also reports the sphere economy (62 spheres available against 30 glass targets).

### `playthrough` - can it be finished, and does Level 2 start?

A bot plays the story level with the real controls: it picks the lane with the least danger in the next 26 m and throws at the most useful target in range (locks in order, sprinklers, caches, doors, then glass in its own lane), holding back optional shots when low. It must reach the lift, ride it, and arrive in Level 2 with the Foundry visible and the player moving, and Level 1 disposed.

### `failure states` - does each way to lose actually lose?

| Scenario | Expected |
| --- | --- |
| No input at all | Dies (currently at ~192 m) |
| Collapse front overtakes the player on the bridge | Run ends with the skybridge message |
| Reach the gate without breaking the locks | Run ends after the 9 s timer with the atrium message |

### `mechanics` - does each system do what the field manual says?

Sprinkler puts out the fire beneath it · reinforced glass cracks on hit 1 and breaks on hit 2 · a serum activates its power-up · a cryo splash puts out a fire · lock III is rejected before lock I · locks I-II-III in order open the gate.

### `pace` - does the run build from sedated to full speed?

Pace is about 6 m/s at the pod and 10.2 m/s at the end of the ward; never below 9.6 m/s during the bridge collapse (which runs at 8.6); measured speed in play ramps; the ward detonation causes a fright surge above pace.

### `aim` - does the crosshair hit what it shows?

A throw with the crosshair on a sprinkler bulb breaks it; 35 px beside it breaks it with aim assist and misses without it; 70 px away misses even with assist (assist must not grab things you were not aiming at). Running through the case file at 186 m collects it.

### `memory` - does restarting leak?

Five restarts; geometry and texture counts from `renderer.info.memory` must stay flat.

### `endless` - does streaming stay bounded?

The bot runs 1.5 km of endless mode; the live object count must stay bounded (it peaks at ~16).

---

## 3. Bug log

Every entry below happened during development and is now covered by a check or a code comment.

| # | Symptom | Cause | Fix | Guarded by |
| --- | --- | --- | --- | --- |
| 1 | High quality rendered a black world; only glass and fire visible | Three force-clears the render target on every `render()` when `scene.background` is a Color, even with `autoClear = false`, wiping the world pass before the glass pass | Detach the background for the glass and FX passes (`postfx.js`) | Screenshots; comment in code |
| 2 | Crash (`causeway is null`) at the moment the lift reached Level 2 | `finishCausewayLift()` disposes Level 1 mid-frame; later code in the same frame still used a flag computed at the top | Re-evaluate `causewayLive` after the state update | `playthrough` |
| 3 | One GPU texture leaked per restart | Three's internal PMREM cache never frees the filtered copy of a render-target cube map | The reflection probe owns its `PMREMGenerator` and output target, and disposes both | `memory` |
| 4 | Screen whited out near fires | Ember point size scale was 220 (sprites ~100 px wide at 10 m), stacking additively | Scale 26; water droplets dimmed too | Visual check |
| 5 | Jagged bright patches on the ward ceiling | Smoke noise sampled at too high a frequency (blocky bilinear texels) and fogged toward the bright sky colour | Low-frequency fbm; smoke fades with distance instead of fogging | Visual check |
| 6 | The pod was 7 m behind the player at the start | Layout placed it at -7 m instead of around the spawn point | Pod at -0.5 m | Visual check |
| 7 | Fire read as a white blob | Emission too high and temperature ramp too hot; fire light 26 flooded nearby walls | Retuned density, ramp and emission; fire light 11 | Visual check |
| 8 | Detonation flash whited out the lift ride | Flash light, sky flash and composite flash all stacking | Each capped | Visual check |
| 9 | ~600 draw calls per frame | Instanced shell pieces for inactive themes still drawn (zero-scale) in every pass; props drawn out to 185 m | Hide unused piece types; theme-aware draw distance | Measured: 150-212 |
| 10 | Level preview labels overlapped | Labels placed independently | Overlap resolution, max three, clamped to the safe area | Visual check |
| 11 | The bot ran out of spheres by 100 m | It re-fired at targets already hit by an in-flight sphere (a bot bug), which exposed a tight economy | Bot claims targets; three extra caches added | `playthrough` |
| 12 | Beat A title and the intro card overlapped | Both shown at run start | Beat A's title is the intro card | Visual check |
| 14 | Sprinklers never showed water (playtest: "I didn't see the sprinklers") | The streak quad's perpendicular mirrored it, so every droplet was back-facing and culled. Found by replacing the shader in-page step by step and replicating the maths on the CPU | Correct perpendicular + double-sided | Visual check; `shaders-explained.md` §7 |
| 15 | HUD crowded; intro card blocked the first seconds of play (playtest) | Everything on by default; missions card shown after Start | Customisable panels with sparse defaults; briefing moved to the start screen; skippable 2.5 s wake-up | Manual checklist |
| 16 | Too bright; glass hard to see; ceiling lights glaring (playtest) | Daytime lighting, HDR strips at 3.3, strong bloom, perfectly clean glass | Night setting, dead/failing fluorescents, bloom threshold 1.35 / strength 0.42, glass grime and soot | Screenshots |
| 17 | Set dressing pushed triangles to 113k | 20-sided cylinders instanced in every slot | 4- and 8-sided cylinders for props | Measured: 58-86k |
| 18 | Aim felt off (playtest) | The crosshair was painted in the centre of the screen while throws went to the mouse pointer; the camera also turned hard toward the pointer, sliding targets out from under it | Crosshair follows the pointer, system cursor hidden in play, calmer look-follow, aim assist, target leading, near-miss tolerance on small targets | `aim` |
| 19 | Blur "dragged on and didn't end" (playtest) | Four causes stacked: the wake-up blur was tied to the 230 m pace curve (~30 s); Auto quality dropped resolution to 62% on slower PCs and kept it there; heat shimmer ran over all 13 wall fires with a screen-sized radius; lens water took ~3 s to dry after each of 10 sprinklers | Blur on its own 40 m curve; Auto ladder cuts hidden work first, resolution floor 85% plus sharpening; shimmer only above gameplay fires, small and close; lens clears in ~1 s | `pace`; screenshots |
| 20 | Vents not visible (playtest) | Mounted flat on the wall at 3.4 m, dark housing: seen edge-on in the dark and smoke | Lower, angled toward the runner, cyan rim that pulses in smoke, sign, visible suction once broken | Visual check |
| 21 | Case files not found (playtest) | Pale cyan (read as glass), above head height, no cue from a distance | Gold hologram, light column and floor ring, chest height, collect by running through, "N of 5" card | `aim` (collection) |
| 13 | Adaptive quality dropped to Low during tests | Software GL is ~1 fps - Auto correctly reacting | Harness pins High | Harness setup |

---

## 4. Manual test checklist (Chrome, over HTTP)

| Area | Test | Expected |
| --- | --- | --- |
| Menu | Start screen idles | Camera drifts through the ward |
| Menu | Start screen | Briefing card shows the sector, this run's missions and controls |
| Menu | Field manual | Every object type and sphere is explained |
| Menu | Preview level | Flythrough with labels; Esc returns to menu |
| Menu | Endless lab before clearing | Disabled with an explanation |
| Intro | Start run | Pod shatters, drop to first person in 2.5 s; a key or click skips; nothing covers the view afterwards |
| Vision | First 10 s | Blurred, doubled vision and sway fade out by ~40 m ("Your vision clears"); after that the image stays sharp, including on a slower PC with Auto quality (resolution never below 85%) |
| Aim | Move the mouse | The crosshair follows the pointer, no system cursor during play; throws land on the crosshair; it turns amber with a ring when locked onto a nearby target |
| Aim | Settings → Aim assist off | Near misses on small targets now miss |
| Vents | Ward smoke, ~120 m | The vent on the left wall is visible from ~20 m (cyan ring, sign), pulses in smoke; breaking it turns it green and smoke spirals in |
| Case files | 50, 186, 410, 642, 714 m | Each is a gold hologram in a light column; running through or shooting it shows "Case file N of 5" |
| Pace | First 30 s | Starts slow and blurred with heavy steps; clears and speeds up through the ward; "Adrenaline" hint; a surge when the ward explodes behind you |
| HUD | VIEW button / `V` | Each panel toggles and the choice persists after reload |
| HUD | `H` | Whole HUD hides and returns |
| Audio | Whole game | No sound, no voice, no sound settings |
| Atmosphere | Run 30 s | Tremors rumble the camera, dust falls, lights black out; wall fires burn; auto-sprinklers shower |
| Controls | A/D, W/S, Space/Shift, Q/E/wheel, hold RMB, C, M, P, F, V, H, Esc, mouse aim | Each responds; W/S change speed gauge |
| Glass | Shoot a pane; crash through a pane | Shatters around the hit point; crash costs integrity |
| Glass | Reinforced pane | Cracks on the first hit, breaks on the second |
| Fire | Stand in fire / shoot the sprinkler / throw cryo | Integrity drains / fire goes out and floor gets wet / fire goes out |
| Smoke | Enter a smoke zone, break a vent | Veil and toxic warning / smoke thins |
| Collapse | Watch a red ring | Dust, then a beam lands blocking the lane |
| Chase | Hold S on the bridge | Warning with distance, then the run ends |
| Serums | Take each | Rule and look apply for the stated time |
| Finale | Shoot III first | "Lock I first", sphere spent, lock survives |
| Finale | I, II, III | Gate lifts; run into the lift |
| Lift | Ride | Doors close, third-person pull-out, orbit, detonation, fade, Level 2 |
| Photo | P, filters, save photo, save 360° | PNGs download; 360 is 2:1 |
| Restart | R on end screen | Fresh run, no page refresh |
| Settings | Quality Low | Post-processing off immediately, game still correct |
| Settings | Reduced motion | No head bob or lean, shorter cinematics, less shake |

---

## 5. Known limitations

- **Frame rate has not been measured on lab hardware** - only draw calls and triangles (in the Level 1 sheet). Press `F` on a lab machine and record the numbers.
- Glass seen through other glass shows the scene behind the first pane only (a screen-space refraction limitation). With the cyan rims it is not noticeable in play.
- The reflection probe sits just ahead of the player, so reflections in far objects are approximate.
- Three.js still loads from a CDN. For offline marking, copy `three.module.js` into the project and change the single import in `src/three.js`.
- No audio, by team decision: sound belongs to another team member.
- The night setting depends on the monitor: on a very dim projector, raise brightness in the OS or use the Medium/Low preset (no dark vignette on Low).
