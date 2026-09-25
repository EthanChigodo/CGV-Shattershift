# Level 1 → Level 2 transition

How the Calibration Lift hands the run from the Glass Causeway to the Shifting Foundry, what state carries over, and what the Level 2 owner needs to know about the changes to `main.js`.

---

## 1. Where everything lives in world space

Each level is built in its own stretch of world space so no level's geometry, collisions or culling can interfere with another's.

| Level | World z | Built by |
| --- | --- | --- |
| 1 - Glass Causeway | 4000 → 3216 (story); keeps going in endless mode | `CausewayLevel`, origin `CAUSEWAY_ORIGIN_Z = 4000` |
| 3 - Inverted Core | -296 → -430 | Legacy geometry in `main.js` |
| 2 - Shifting Foundry | -1200 → -1964 | `FoundryLevel`, origin `FOUNDRY_ORIGIN_Z = -1200` |

The old Level 1 greybox (panes, walls, and the lift at z = -132) has been removed from `main.js`. The shared floor slabs, rails and arches that Level 3 runs on are untouched, as is the Level 2 → 3 lift at z = -282.

---

## 2. The sequence

```
 gate opens ─► player runs to lift centre (781 m) ─► level emits "lift-enter"
      │
      ▼
 startCausewayLift()             state = "lift", transitionTarget = 2
   · end-of-level bonus          +50/sphere, +10/integrity, +250/case file
   · missions committed          saved to localStorage, Endless unlocked
   · sector report shown         score, time, accuracy, glass, fires, files
      │
      ▼  every frame
 updateCausewayLift(dt)  ──►  causeway.updateLift()
   0.0 - 1.0 s   glass doors slide shut
   0.0 - 1.3 s   camera eases from the eyes to behind the avatar (third person)
   1.0 s  →      cabin accelerates up the shaft to 11 m/s
   1.3 s  →      camera orbits outside the shaft, drifting to look down
   2.4 s         atrium detonates below (two explosions, Vale's last line)
   6.5 - 7.4 s   screen fades to black (#fadeOverlay)
      │
      ▼
 finishCausewayLift()
   · currentLevel = 2, state = "playing"
   · health = 100, ammo += 4                 (same rule as the old prototype lift)
   · lane = centre, camera fov/up reset
   · runZ = FOUNDRY_ORIGIN_Z, cameraThird = true, snapCamera = true
   · setCausewayActive(false)                camera.far back to 150, Level 1 HUD off
   · causeway.dispose(); causeway = null     all Level 1 GPU memory freed
   · setFoundryActive(true)                  Foundry fog, lights, HUD
   · fade back in over ~0.7 s
```

With **Reduced motion** on, the ride is 6.2 s with a slower orbit.

The Level 2 → Level 3 lift is unchanged.

---

## 3. What carries over

| State | Carries? | Notes |
| --- | --- | --- |
| Score | Yes | Including the Level 1 end bonus |
| Spheres | Yes, +4 | Same as the prototype |
| Integrity | Reset to 100 | Same as the prototype |
| Combo | Yes | Decays normally in Level 2 |
| Missions, case files, best score | Saved | Level 1 only; `localStorage` key `fractureRunCauseway` |
| Sphere type, serums, focus meter | **No** | The arsenal is Level 1's toolset. Level 2 throws standard spheres exactly as before |
| Settings | Yes | Shared `fractureRunSettings`, with new keys `quality`, `minimap`, `showFps` |

Level 2's projectiles behave exactly as before: 34 m/s, straight line, no gravity, no bounce. Ballistic arcs, ricochets and floor bounces are Level 1 only.

---

## 4. Changes to `main.js` that affect Level 2

`main.js` was reorganised around the new level. The **Foundry integration block is carried over verbatim** (`buildFoundry`, `setFoundryActive`, `updateFoundryBox`, `updateFoundry`). Things the Level 2 owner should know:

1. **Post-processing now runs for every level.** `PostFX` renders the frame. Level 2 gets bloom (threshold 1.1 - only HDR emissives glow), FXAA, a light vignette and grain. All Level 1 "looks" (smoke veil, thermal, damage tint...) are zeroed outside Level 1 by `clearPostLooks()`. On **Low** quality the post pipeline is off and every level renders exactly as it did before.
2. **Shadows are enabled on the renderer** (`shadowMap.enabled = true`, `autoUpdate = false`). The pipeline sets `needsUpdate` once per frame. The Foundry is still built with `shadows: false`, so nothing changes for it; setting `shadows: true` in `buildFoundry()` would now just work.
3. **Camera layers.** The main camera sees layers 0, 1 and 2. The Foundry is on layer 0, so it is unaffected. The shared raycaster has all layers enabled.
4. **Projectiles share one geometry and one material per sphere type**, and the legacy shard effect now shares one geometry and disposes its materials. This fixes a slow memory leak that affected Levels 2 and 3 (a new geometry per throw and per shard, never freed).
5. **`resetStats()` rebuilds both levels.** It still calls `buildFoundry()` first, then builds the Causeway. `R`, *Run again* and *Restart run* all go through it.
6. **Demo keys:** `1` restarts Level 1, `2` and `3` jump as before, `4` starts Endless lab.
7. **HUD:** while Level 1 is active the body has class `cw-active`, which hides the original bottom HUD bar (Level 1 has its own). Leaving Level 1 removes the class, so the bar is back for Levels 2 and 3 alongside the Foundry HUD, as before.
8. **Sound and voice were removed from the whole game** by team decision (audio is another member's task): the SOUND button, the volume and narration settings, and every speech-synthesis line - including the Level 2 and Level 3 sector briefings and "Gravity fault detected". Level events are the hook for the audio workstream.
9. **Tone-mapping exposure is per level:** 1.0 in Level 1 (night), 1.08 in Levels 2 and 3 (unchanged from before).
10. **HUD panels** are controlled by `settings.hud` (VIEW button, `V`, Settings → Interface, `H` for none). Only Level 1's HUD reads these today; the Foundry HUD could adopt the same `hud-off-*` body classes.
11. **Aiming changed in every level** (the throw code is shared): the crosshair now follows the mouse and the system cursor is hidden during play, where before the crosshair sat in the centre while throws went to the pointer. Aim assist (Settings → Gameplay, on by default) and target leading also apply to the Foundry's switches and cells. The Foundry's own HUD is unchanged.
12. **Auto quality** (all levels) now cuts hidden work before resolution, never renders below 85%, and a sharpening pass runs in the composite for every level except on Low.
13. **`__dbg`** gained `causeway`, `run`, `arsenal`, `missions`, `postfx`, `step()`, `render()`, `setCausewayDistance()`, `setHealth()`, `setAmmo()`, `setPointer()`, `fire`, `resetGame`, `render()`, `keyDown()`/`keyUp()`, `resolveAim()`, `aliveTargets()`, `projectiles`. The existing members are unchanged.

The Foundry harness (`node tests/foundry/run.js`) passes unchanged after these changes.

---

## 5. Testing the transition quickly

In the browser console during a run:

```js
__dbg.setCausewayDistance(740);          // jump near the gate
for (const l of __dbg.causeway.gate.parts.locks) __dbg.shatter(l.mesh, {});   // open it
__dbg.setCausewayDistance(772);          // run into the lift
```

Or run the automated check, which plays the whole level with a bot, rides the lift, and asserts that Level 2 is playing, visible, moving, and that Level 1 was disposed:

```text
node tests/causeway/run.js
```

---

## 6. Checklist before merging changes to either level

- [ ] `node tests/causeway/run.js` passes.
- [ ] `node tests/foundry/run.js` passes.
- [ ] Play from the menu through the lift into the Foundry in Chrome over HTTP; no console errors.
- [ ] Press `R` on the Level 2 end screen: the run restarts in Level 1 with no leftover Foundry HUD.
- [ ] Performance overlay (`F`) in both levels on a lab machine; record the numbers in the level sheets.
- [ ] If you move a level in world space, update its `*_ORIGIN_Z` constant and this document.
