# CGV Shattershift - Fracture Run

This repository contains the working concept and playable Three.js prototype for our Computer Graphics and Visualisation group project.

**Working game title:** Fracture Run  
**Repository name:** CGV Shattershift  
**Primary inspiration:** Smash Hit  
**Secondary inspiration:** Temple Run 2

The player automatically travels through a failing glass tower, throws limited energy spheres, avoids obstacles, and uses elevator transitions to reach three distinct sectors:

The story climbs the building, riding a lift up between each stage:

1. **Sector 01 - The Shifting Foundry** (the basement) - third-person chase camera and moving machinery. *Playable.*
2. **Sector 02 - The Meltdown** (the labs) - out of a lift into labs being torched to destroy the evidence, a failed ball launcher as your only tool, a stretch where the power dies, and a glass lift up. *Playable.*
3. **Sector 03 - The Skyline** (the Glass Causeway module) - out of the glass lift, first-person aiming and resource management across the skybridge, until the tower behind you is demolished and the bridge tips into a ramp: sprint, jump, grab the ledge. *Playable.*
4. **The Roof** - the finale: hold out against the scientists and their test subjects until the helicopter comes; then the ride out, the pilot's reveal, and the credits. *Playable.*

Before it all, **the briefing** (from the menu) is a short silent film of how it came to this.

**Endless** (from the menu, separate from the story) runs any one of the four until you go down: the Foundry and the Labs come back as new, faster layouts every lap, the Skyline is randomised chunks, and the Roof is wave after wave with no helicopter. Best results are kept per environment.

## Story

Ascension Tower, level 212. A resonance experiment failed at dawn and its subject did not die. You are **Subject 07**: glass shatters at your touch, and you can throw that resonance as spheres of energy. Dr. Adrian Vale has armed the tower's demolition charges to bury what he made. Climb out with Dr. Elias Okoro, the anaesthetist who leaked it all: the basement foundry, the burning labs, the glass causeway across the skyline, and the helicopter on the roof, before the tower comes down. The story is told in cutscenes with reaction prompts (`src/story/`).

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim - the crosshair follows the mouse; aim assist (Settings) helps with small targets |
| Left mouse | Throw a sphere |
| Right mouse (hold) | Focus - slow time to aim |
| `A` / `D` or left / right | Change lane |
| `W` / `S` or up / down | Sprint / brake (the Skyline); jump / slide (the Foundry, the Labs) |
| `Q` / `E` or mouse wheel | Sphere type: glass, cryo, shock |
| `Space` / `Shift` | Jump / slide |
| `C` | First-person / chase camera |
| `M` | Minimap |
| `V` / VIEW button | Choose which HUD panels show |
| `H` | Hide the whole HUD |
| `P` | Photo mode (filters, save photo, save 360° panorama) |
| `F` | Performance overlay |
| `Esc` | Pause and settings |
| `R` | Run again from the end screen |
| `1` `2` `3` `4` | Demo: jump to Sector 01 (Foundry), 02 (Labs), 03 (Skyline), the Roof - with that stage's story and cutscenes |
| `5` | Demo: ride the Gravity Fault lift (Sector 01 to 02); left mouse fires at the brake clamps |
| `6` | Demo: the quiet ride from the Labs up to the Skyline |
| The Labs and the Roof | Hold left mouse to fire; jump onto fallen ducts (running into one hurts); on the roof `WASD` moves (the open ledges are a long drop) and `Space` dodges or jumps for the ladder; `B` bloom, `K` credits. Photo mode is not available there |
| Cutscenes | Hold `Esc` to skip the talking; reaction prompts show the keys to press |

## Sector 03 - The Skyline (the Glass Causeway module)

A research wing 212 floors up, burning at 03:47 in the morning, in three beats: the **containment ward**, the **skybridge** (which collapses behind you), and the mirrored **resonance atrium**, ending with a three-lock gate and the Calibration Lift. It was built as the game's first level, before the story order was settled; in the story it is the last sector, and its lift goes up to the Roof.

- **Glass everywhere, and all of it real:** ray-traced glass with Fresnel reflection, dispersion and Beer-Lambert absorption; cracks form around the exact point you hit; panes fracture into GPU-simulated shards.
- **Fire, water, smoke:** ray-marched volumetric fire; shoot the glass bulb of a sprinkler to flood it; smoke veils the screen and burns your lungs until you break a smoke vent (the round covers with a glowing cyan ring on the walls).
- **Five case files:** gold holograms standing in columns of light - run through one or shoot it to piece together what happened.
- **From sedated to running for your life:** the run starts slow and blurred as Subject 07 staggers out of the pod, and builds to full pace as the adrenaline kicks in; explosions scare you into a sprint.
- **The building coming down:** telegraphed ceiling collapses, a distant tower falling, the skybridge collapsing behind you, the atrium detonating below the lift.
- **Tools:** three sphere types, four serum power-ups (prism split, thermal sight, kinetic shield, overdrive), sprint/brake, bullet-time focus.
- **Extras:** orthographic minimap, field manual, level preview flythrough, three missions per run, five collectible case files, photo mode with 360° export, and an endless mode of randomised chunks (Endless -> The Skyline).
- **In the story** it is Sector 03: you arrive by the glass lift (no pod, no sedated start) and its lift goes up to the Roof.
- **Graphics pipeline:** custom multi-pass post-processing (screen-space refraction, bloom, FXAA, heat haze, thermal vision, power-up looks), dynamic ray-marched sky, reflection probe, sun shadows, wet reflective floors, and Auto quality with dynamic resolution for lab machines.

See [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) and [`docs/shaders-explained.md`](./docs/shaders-explained.md).

## Menus and settings

The title screen idles on a slow drift through the Skyline's ward. From it you can start the story, pick an Endless environment, preview the Skyline, read its field manual, open settings, or replay the briefing. **Start Story** starts with the wake-up in the ward, then the Foundry.

The start screen also shows the sector briefing and this run's missions, so pressing Start goes straight into play, and **Play as** chooses your character (female or male patient; Level 3 shows them, and the choice is remembered).

**Settings** (also the pause menu) has **Interface** (which HUD panels show - also the VIEW button), aim sensitivity, **graphics quality** (Auto, High, Medium, Low), and **Reduced motion & camera shake**. Choices persist locally. The story briefing, menu and Level 1 have looping background music; Level 3 retains its generated Web Audio effects.

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

During a run, press `1`, `2`, `3`, `4` or `5` (see Controls). These shortcuts are included for project demonstrations and development testing.

## Project documents

- [`docs/project-brief.md`](./docs/project-brief.md) - editable concept, level plan, rubric mapping, architecture, risks, and Sprint 1 backlog.
- [`docs/project-guide.pdf`](./docs/project-guide.pdf) - formatted PDF version of the project guide.
- [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) - Level 1 design sheet: story, map, mechanics, cameras, integration contract, performance budget.
- [`docs/shaders-explained.md`](./docs/shaders-explained.md) - every Level 1 shader explained stage by stage, with a demonstration script.
- [`docs/level-transition.md`](./docs/level-transition.md) - how the Calibration Lift hands over to Level 2 and what changed in `main.js`.
- [`docs/test-plan-level-1.md`](./docs/test-plan-level-1.md) - automated checks, bug log, manual test checklist.
- [`docs/level-2-foundry.md`](./docs/level-2-foundry.md) and [`docs/test-plan-level-2.md`](./docs/test-plan-level-2.md) - Level 2.
- [`docs/elevators.md`](./docs/elevators.md) - the elevators: the Gravity Fault lift (Level 2 to 3), how it plugs into `main.js`, and the plan for Level 3's lifts.
- [`docs/figure-wear-shader.md`](./docs/figure-wear-shader.md) - the player figure (lab subject: scrubs, wristband, IV port) and its wear shader - clean, dusty, bloodied, geared up - block by block.
- [`docs/credits.md`](./docs/credits.md) - credits and asset register.
- [`docs/pull-request-level-1.md`](./docs/pull-request-level-1.md) - pull request description and push steps for Level 1.

## Automated checks

```text
npm install --no-save playwright
npx playwright install chromium
node tests/causeway/run.js
node tests/foundry/run.js
node tests/elevators/run.js
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

Upload the contents of the demo archive so that `index.html` is at the top level. The project uses relative local paths, and Three.js r160 is kept in the repository (`lib/three/`) rather than loaded from a CDN, so the game runs offline and on networks that block jsDelivr (the lab machines do).

## Current status

The whole story is playable from start to finish: the briefing film, the wake-up and the Foundry with Dr. Okoro, the Gravity Fault lift (its brake clamps as reaction prompts), the Labs with the breach, the bend attack and Okoro's sacrifice, the quiet ride up, the Skyline's demolition and bridge jump, the Roof, and the ending in the helicopter with the credits. A death restarts the sector you were in. The character and skin tone picked on the start screen are the player in every level. Endless runs each environment on its own. Menu and Skyline music is managed by `src/audio/music-manager.js`; the Labs and the Roof use generated Web Audio effects. Each module has its own checks (`node tests/<story|meltdown|causeway|foundry|elevators>/run.js`). Frame rates still need to be measured on lab hardware with the `F` overlay.

## Technology

- Three.js and WebGL for rendering
- JavaScript for gameplay and state
- HTML/CSS for the interface
- Custom GLSL vertex and fragment shaders: ray-traced glass, ray-marched fire, clouds and SDF serums, GPU shard physics and particles, and a custom post-processing pipeline

No Unity or other game engine is used.

## Soundtracks and sound effects references

- [Pixabay game-over sound effects](https://pixabay.com/sound-effects/search/game%20over%20sound/)
- [Freesound glass-shatter search](https://freesound.org/search/?q=glass+shatters&page=3#sound)
- [OpenGameArt flame audio search](https://opengameart.org/art-search-advanced?keys=flame&title=&field_art_tags_tid_op=or&field_art_tags_tid=&name=&field_art_type_tid%5B%5D=13&sort_by=count&sort_order=DESC&items_per_page=24&Collection=)
