# CGV Shattershift - Fracture Run

This repository contains the working concept and playable Three.js prototype for our Computer Graphics and Visualisation group project.

**Working game title:** Fracture Run  
**Repository name:** CGV Shattershift  
**Primary inspiration:** Smash Hit  
**Secondary inspiration:** Temple Run 2

The player automatically travels through a failing glass tower, throws limited energy spheres, avoids obstacles, and uses elevator transitions to reach three distinct sectors:

1. **The Glass Causeway** - first-person aiming and resource management in a burning lab. *Playable.*
2. **The Shifting Foundry** - third-person chase camera and moving machinery. *Playable.*
3. **The Meltdown** - out of a lift into a burning lab being torched to destroy the evidence, a failed ball launcher as your only tool, a stretch where the power dies, then a lift to the roof, a fight, and a rescue helicopter. *Playable.*

## Story

Ascension Tower, level 212. A resonance experiment failed at dawn and its subject did not die. You are **Subject 07**: glass shatters at your touch, and you can throw that resonance as spheres of energy. Dr. Vale has armed the tower's demolition charges to bury what she made. Escape the lab across the Causeway, ride the Calibration Lift up through the Foundry, and reach the control core before the tower comes down.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim - the crosshair follows the mouse; aim assist (Settings) helps with small targets |
| Left mouse | Throw a sphere |
| Right mouse (hold) | Focus - slow time to aim (Level 1) |
| `A` / `D` or left / right | Change lane |
| `W` / `S` or up / down | Sprint / brake (Level 1); jump / slide (Level 3) |
| `Q` / `E` or mouse wheel | Sphere type: glass, cryo, shock (Level 1) |
| `Space` / `Shift` | Jump / slide |
| `C` | First-person / chase camera |
| `M` | Minimap |
| `V` / VIEW button | Choose which HUD panels show |
| `H` | Hide the whole HUD |
| `P` | Photo mode (filters, save photo, save 360° panorama) |
| `F` | Performance overlay |
| `Esc` | Pause and settings |
| `R` | Run again from the end screen |
| `1` `2` `3` `4` | Demo: restart Level 1, jump to Level 2, jump to Level 3, start Endless lab |
| Level 3 | Hold left mouse to fire (it overheats); mash `Space` at a fallen duct; on the roof `WASD` moves and `Space` dodges or jumps for the ladder; `B` bloom, `K` credits. Photo mode is not available in Level 3 |

## Level 1 - The Glass Causeway

A research wing 212 floors up, burning at 03:47 in the morning, in three beats: the **containment ward**, the **skybridge** (which collapses behind you), and the mirrored **resonance atrium**, ending with a three-lock gate and the Calibration Lift that goes down to Level 2.

- **Glass everywhere, and all of it real:** ray-traced glass with Fresnel reflection, dispersion and Beer-Lambert absorption; cracks form around the exact point you hit; panes fracture into GPU-simulated shards.
- **Fire, water, smoke:** ray-marched volumetric fire; shoot the glass bulb of a sprinkler to flood it; smoke veils the screen and burns your lungs until you break a smoke vent (the round covers with a glowing cyan ring on the walls).
- **Five case files:** gold holograms standing in columns of light - run through one or shoot it to piece together what happened.
- **From sedated to running for your life:** the run starts slow and blurred as Subject 07 staggers out of the pod, and builds to full pace as the adrenaline kicks in; explosions scare you into a sprint.
- **The building coming down:** telegraphed ceiling collapses, a distant tower falling, the skybridge collapsing behind you, the atrium detonating below the lift.
- **Tools:** three sphere types, four serum power-ups (prism split, thermal sight, kinetic shield, overdrive), sprint/brake, bullet-time focus.
- **Extras:** orthographic minimap, field manual, level preview flythrough, three missions per run, five collectible case files, photo mode with 360° export, and an **Endless lab** mode of randomised chunks (unlocked by clearing Level 1).
- **Graphics pipeline:** custom multi-pass post-processing (screen-space refraction, bloom, FXAA, heat haze, thermal vision, power-up looks), dynamic ray-marched sky, reflection probe, sun shadows, wet reflective floors, and Auto quality with dynamic resolution for lab machines.

See [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) and [`docs/shaders-explained.md`](./docs/shaders-explained.md).

## Menus and settings

The title screen idles on a slow drift through the ward. From it you can start a run, start Endless lab, preview the level, read the field manual, open settings, or replay the briefing. **Start Run** plays a 2.5-second wake-up (the pod shatters, the camera drops into first person); any key or click skips it.

The start screen also shows the sector briefing and this run's missions, so pressing Start goes straight into play, and **Play as** chooses your character (female or male patient; Level 3 shows them, and the choice is remembered).

**Settings** (also the pause menu) has **Interface** (which HUD panels show - also the VIEW button), aim sensitivity, **graphics quality** (Auto, High, Medium, Low), and **Reduced motion & camera shake**. Choices persist locally. There is no sound in this build; audio is a separate task.

## Play locally

The game uses JavaScript modules, so serve the folder over HTTP rather than double-clicking `index.html`.

### Python

Open a terminal in this folder and run:

```text
python -m http.server 4173
```

Then open `http://localhost:4173/` in Chrome.

If `python` is not recognised on Windows, try:

```text
py -m http.server 4173
```

Stop the server with `Ctrl+C`.

## Demo shortcuts

During a run, press `1`, `2`, `3` or `4` (see Controls). These shortcuts are included for project demonstrations and development testing.

## Project documents

- [`docs/project-brief.md`](./docs/project-brief.md) - editable concept, level plan, rubric mapping, architecture, risks, and Sprint 1 backlog.
- [`docs/project-guide.pdf`](./docs/project-guide.pdf) - formatted PDF version of the project guide.
- [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) - Level 1 design sheet: story, map, mechanics, cameras, integration contract, performance budget.
- [`docs/shaders-explained.md`](./docs/shaders-explained.md) - every Level 1 shader explained stage by stage, with a demonstration script.
- [`docs/level-transition.md`](./docs/level-transition.md) - how the Calibration Lift hands over to Level 2 and what changed in `main.js`.
- [`docs/test-plan-level-1.md`](./docs/test-plan-level-1.md) - automated checks, bug log, manual test checklist.
- [`docs/level-2-foundry.md`](./docs/level-2-foundry.md) and [`docs/test-plan-level-2.md`](./docs/test-plan-level-2.md) - Level 2.
- [`docs/credits.md`](./docs/credits.md) - credits and asset register.
- [`docs/pull-request-level-1.md`](./docs/pull-request-level-1.md) - pull request description and push steps for Level 1.

## Automated checks

```text
npm install --no-save playwright
npx playwright install chromium
node tests/causeway/run.js
node tests/foundry/run.js
```

## Team workflow

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before making changes. In short: create a small branch for each task, commit focused changes, and open a pull request for another teammate to review.

## Sharing and deployment

### Quickest method

1. Download the repository as a ZIP or clone it with Git.
2. Each teammate extracts the archive.
3. They open a terminal in the extracted folder and use the local-server command above.
4. They open `http://localhost:4173/` in Chrome.

### GitHub Pages

1. In GitHub, open **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.
4. Share the Pages URL after GitHub finishes publishing.

### Department LAMP server

Upload the contents of the demo archive so that `index.html` is at the top level. The project uses relative local paths. It currently loads Three.js from an HTTPS CDN, so the marking browser must have Internet access. Before the final submission, the group should place a local copy of `three.module.js` in the project and update the import in `main.js` if fully offline operation is required.

## Current status

Levels 1, 2 and 3 are playable and connected: the Calibration Lift from Level 1 to 2, and a fade from the end of Level 2 into Level 3, which opens with the player stepping out of a lift (Level 3's lifts and their cutscenes are placeholders a teammate is replacing - see [`docs/level-3-meltdown.md`](./docs/level-3-meltdown.md)). Sound, music and voice are not part of this build (another team member owns audio; the levels emit events for it to hook into). Frame rates still need to be measured on lab hardware with the `F` overlay.

## Technology

- Three.js and WebGL for rendering
- JavaScript for gameplay and state
- HTML/CSS for the interface
- Custom GLSL vertex and fragment shaders: ray-traced glass, ray-marched fire, clouds and SDF serums, GPU shard physics and particles, and a custom post-processing pipeline

No Unity or other game engine is used.
