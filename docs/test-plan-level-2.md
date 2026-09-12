# Test plan and bug log — Level 2: The Shifting Foundry

Owner: Nonkazimulo Dube

Covers documentation set items 7 (test plan and bug log) and part of 8 (contribution evidence) from the project guide.

---

## 1. How to run the checks

```text
npm install --no-save playwright
npx playwright install chromium
node tests/foundry/run.js
```

Add `--shots` to regenerate the screenshots in `docs/images/` from the current build, so the documentation images can never drift from the code.

The harness serves the repository itself on a spare port and drives the Level 2 preview in headless Chromium, so nothing needs to be started first. It exits non-zero on failure and is ready to drop into CI.

Environment variables: `FOUNDRY_CHROMIUM` to point at a specific Chromium binary, `FOUNDRY_SOFTWARE_GL=0` to use the real GPU instead of software rendering.

---

## 2. What is checked, and why each check exists

Every check below corresponds to a bug that actually happened. They are regression tests, not decoration — reintroducing any of these bugs fails the run.

### `geometry` — do obstacles physically do what they look like?

| Check | Guards against |
| --- | --- |
| Every collidable hazard is also in `level.obstacles` | The Beat A half-gate was collidable inside the level but never exposed to the host game, so the real collision system would have ignored it |
| Every barrier blocks a standing player | High "slide under" barriers sat above head height and were pure scenery |
| Low barriers clear with a jump and *not* a slide; high barriers the reverse | Each obstacle must have exactly one correct input |
| Every piston is lethal for part of its cycle and safe for the rest (asserted between 1% and 70%) | Ceiling pistons could never reach the player; floor pistons overlapped them permanently |
| Exactly one place blocks all three lanes | More than one is a dead end. **None** means the mandatory `ROUTE GATE` is not blocking, and the player can walk past the level's teaching moment |

### `balance` — can it be finished, and is it fair?

Runs two full simulated playthroughs at a fixed 60 Hz, so piston phase, gate closing and the countdown advance exactly as in a live run.

| Check | Guards against |
| --- | --- |
| A skilled run completes, restores 3/3 systems, takes no hits | The level must be clearable cleanly |
| A skilled run never reaches zero spheres | The softlock, below |
| A player who never jumps or slides still completes | The level should be survivable played badly, not only played well |
| That player takes at most one hit during the escape | The death spiral, below |
| A skilled run finishes with time left, but not more than half the run in hand | The countdown must be a real loss condition, not decoration |

### `performance` — structural cost

Frame rate is deliberately **not** asserted; it depends on the machine, the window size and whether the tab is focused. What is asserted is machine-independent: worst-case draw calls under 420, the dynamic light count staying fixed, and GPU resources not growing across repeated level reloads.

For an actual frame rate, open `preview/foundry.html` and press `F`.

---

## 3. Bug log

| # | Bug | How it was found | Fix | Verified by |
| --- | --- | --- | --- | --- |
| 1 | **Ceiling pistons could never hit the player.** They bottomed out at 2.4 m; a standing player is 2.08 m. Nine pistons were decorative. | Probing each hazard's bounding box against a player-sized box at every point in its cycle. Invisible by eye — they animate convincingly. | Reach 3.6 → 5.2, so the head slams to just above the floor | `geometry`, piston duty cycle |
| 2 | **Floor pistons overlapped the player permanently.** Parked at 0.9 m, they were a solid wall at rest rather than a timed hazard. | Same probe — duty cycle came back at 100% | Retract flush into the floor; the player box starts 0.18 m up | `geometry`, piston duty cycle |
| 3 | **"Slide under" barriers were scenery.** All four sat at 3.14–3.96 m, a metre clear of a standing player's head. | Barrier clearance matrix: does it block standing, and which input clears it | Moved to 1.69–2.51 m, set against the player volume rather than by eye | `geometry`, barrier checks |
| 4 | **The Beat A half-gate was missing from `level.obstacles`.** Collidable within the level, invisible to the host game. | Cross-checking the internal hazard index against the exposed obstacle list | Added on construction | `geometry`, first check |
| 5 | **Escape death spiral.** Gates closed fully; one impact cost speed, the lost speed meant arriving after the next gate had shut, which cost more speed. A simulated run took six gate hits in a row. | Full simulated playthrough — invisible in short hands-on testing because you have to be *already* behind for it to start | Gates stop at 82% closed while the clock runs, leaving the centre lane passable; they only slam shut when the timer expires | `balance`, escape hits |
| 6 | **Sphere softlock.** Cells returned a sphere only 55% of the time, so a player who shot every cell reached the mandatory extraction valve with nothing to shoot it with. The level was not hard, it was unfinishable. | Reading the sphere count at the end of a simulated run that shot everything | Cells always return the sphere they cost; a trickle issues one every 4 s at zero | `balance`, `ranDryAt` |
| 7 | **Junctions were blind corners.** At a 9 m turn radius the corridor's outer wall sat ~14 m dead ahead for the whole turn. | A centre-screen raycast at the junction returned `Shell_wallL` and nothing else | Junctions widen to ~1.5× and ease back, opening a sightline | Visual, `docs/images/junction-one.jpg` |
| 8 | **Closing gates swallowed the chase camera** in Beat C, filling the screen with hazard stripes. | Screenshots during the escape | Camera shortens its boom when the view is obstructed | Visual |
| 9 | **Raising brightness made the level flatter.** Ambient fill lifts lit and unlit surfaces equally. | Comparing screenshots at brightness 1.0 and 1.6 — brighter, but less readable | Weak sub-linear ambient; shape from a light travelling with the player | Visual |
| 10 | **The countdown could never expire.** A fixed 26 s against a stretch that took ~5 s to run. | Reading the timer at the end of a simulated run | Derived from distance and run speed | `balance`, escape time in hand |

### A note on how most of these were found

Bugs 1, 2, 3, 5 and 6 are all the same shape: **the level looked correct and behaved wrongly.** Pistons animated convincingly while passing through nobody; barriers looked like obstacles you would duck under; the sphere economy looked generous right up until the last switch. None of them would reliably surface by playing the level for a few minutes, because playing it does not tell you *why* nothing happened.

What found them was measuring against the player volume and reading the numbers at the end of a complete run. That is the argument for keeping this harness in the repository rather than treating testing as something done by hand before a demo.

---

## 4. Known limitations

- **Frame rate is not measured here.** The only trustworthy reading is the on-screen counter (`F`) with the window visible and focused — a hidden or throttled tab gives numbers that vary by 2× between runs.
- **Collision is hand-rolled AABBs.** When the team picks a physics library it should replace `FoundryLevel.collide`; nothing else in the level depends on how the test is done.
- **The simulation drives the level directly**, not through the preview's input handling, so it verifies the level and its rules rather than the controls.
- **No audio testing.** There is no audio yet; the level emits events where the cues belong.
