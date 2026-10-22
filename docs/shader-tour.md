# Shader tour - every hand-made shader, and where to see it

Every shader below is our own GLSL. There are two ways it gets onto the GPU:

- **`ShaderMaterial`** - we write the whole vertex and fragment shader.
- **`onBeforeCompile`** - we take Three's own lit material and splice our GLSL
  into it at its `#include` points (string `.replace()`), so the object keeps
  Three's lighting, shadows and skinning and only gains our effect.

Level 1 (the Skyline) is covered line by line in
[shaders-explained.md](shaders-explained.md), and the wear shader in
[figure-wear-shader.md](figure-wear-shader.md). This page is the map: what
each shader is, where you see it, and the one idea that makes it work.

Two building blocks turn up again and again:

- **Noise / fbm** - a cheap hash gives a random number per grid point, value
  noise blends the corners smoothly (`f*f*(3-2f)`), fbm adds 4-5 octaves of it
  (double the frequency, half the strength each time). Fire, smoke, clouds,
  dissolves and haze are all built from it.
- **Fresnel / view angle** - `dot(normal, toCamera)` is 1 face-on and 0 at the
  silhouette. Glass, shields, holograms and beams use it for bright rims or
  soft edges.

---

## Everywhere (shared)

| Shader | File | Where to see it | How it works |
| --- | --- | --- | --- |
| **Post-processing pipeline** | `src/fx/postfx.js` | Every frame of the Foundry and the Skyline: bloom on lights, heat haze near fire, red edges when hit, the sedation blur at the start, water drops on the lens under sprinklers, the heartbeat vignette | Our own pipeline of full-screen passes (no EffectComposer): scene into an HDR target -> snapshot for glass refraction -> glass -> fire/smoke -> bloom (bright-pass + separable Gaussian blur at quarter res) -> composite (haze, FXAA, chromatic aberration, ACES tone mapping, vignette, grain, the "looks"). |
| **Sphere bursts** (shell + ice) | `src/fx/sphere-impact.js` | Throw a shock, cryo or gravity sphere anywhere | Shell: lit at its rim, clear in the middle (Fresnel), only the outside drawn so a camera inside it is not blinded. Ice: flat facets with the normal from screen-space derivatives (`dFdx`/`dFdy`), so every face catches the light differently. |
| **GPU glass shards** | `src/levels/causeway/shaders/particles.js` (used by `src/fx/shatter.js`) | Break any glass in any level | The CPU only spawns them. The vertex shader computes each shard's position as a closed-form function of time: ballistic flight, spin by Rodrigues' rotation formula, one floor bounce with restitution and friction. Hundreds of shards cost nothing per frame. |
| **Police helicopter searchlights** | `src/fx/police-helicopters.js` | Skyline and roof backgrounds, the briefing | A cone of lit haze: brightest along its axis, soft at the edges (view angle), fading toward where it lands. Additive. |
| **360 photo capture** | `src/fx/photo-mode.js` | Photo mode (Skyline/Foundry), 360 capture | A CubeCamera renders 6 faces; a full-screen shader turns each output pixel into longitude/latitude -> a direction -> a cube-map sample (equirectangular projection), and tone-maps and sRGB-encodes by hand. |
| **Player body rig** | `src/levels/meltdown/characters.js` | Your character in every level | The player mesh is static: running, leaning, sliding, jumping, holding the launcher, climbing the ladder are all bent in the **vertex shader** from a few uniforms (`uPhase`, `uStride`, `uLean`, `uCrouch`, `uTuck`, `uHold`, `uReachUp`). |
| **Figure wear** | `src/figure/look.js` ([doc](figure-wear-shader.md)) | Your character getting dusty (Foundry), bloodied and scratched (Labs), then the vest (Skyline) | Spliced into the character's own material. Which garment a pixel is comes from its atlas UV; where on the body from the rest-pose position; damage from 3D noise compared to thresholds that move with `wear`, so dirt spreads by itself. Tears are painted (the t-shirt underneath), not cut out. Skin tone is a per-channel tint here too. |

## Sector 01 - The Foundry (`src/levels/foundry/index.js`)

| Shader | Where to see it | How it works |
| --- | --- | --- |
| **Light shafts** | Under the ceiling lamps every 16 m | Additive cones under each lamp: bright near the lamp and fading toward the floor (`vH * vH`), and soft at the silhouette from the view angle (`pow(abs(dot(N, V)), 1.5)`) - dusty air catching the light without a hard edge. |
| **Furnace fire** | The furnace mouths in the side walls | Noise scrolled upward pushed through a fire colour ramp (white-yellow at the bed, orange above), flickering. Instanced: every furnace in the corridor is one draw call. |
| **Embers** | Sparks drifting up out of each furnace | Points whose whole life (rise, drift, fade, loop) is computed in the vertex shader from per-point seeds - no CPU update. |

## The lifts (`src/elevators/`)

| Shader | File | Where to see it | How it works |
| --- | --- | --- | --- |
| **Tower facade** | `shaders.js` | Outside the Gravity Fault and quiet-ride lifts | Windows are a grid in **world space**, so any box gets lit offices, dark glass, and burning floors below a "fire line" - no textures to load. |
| **Storm sky** | `shaders.js` | Behind the tower during the rides | Gradient, fire glow on the horizon, drifting fbm clouds lit from below, lightning flashes (`uFlash`). |
| **City below** | `shaders.js` | Looking down from the lift | Street grid, lit windows, fires, all procedural. |
| **Energy conduits** | `shaders.js` | The cabin's conduits | Flowing bands and edge glow over time; `uFault` turns it from cyan to alarm red and makes it stutter when the cable snaps. |
| **Diagnostic hologram** | `diagnostic.js` | The top-down picture-in-picture during the clamps | An orthographic camera with one override material: edges bright where surfaces turn away, height bands, scanlines, additive so structure shows through structure. |
| **Brake sparks** | `sparks.js` | The brakes biting after the freefall | Each spark is drawn as a streak along its velocity plus a hot head, cooling white -> orange, additive. |
| **Cabin glass cracking** | `glass.js` | The Gravity Fault's panes cracking before they blow out | A crack texture revealed by a radius growing from the impact point, so you watch the cracks spread; frost near the impact. |

## Sector 02 - The Labs (`src/levels/meltdown/`)

| Shader | File | Where to see it | How it works |
| --- | --- | --- | --- |
| **Fire and its smoke** | `fire.js` | The fire chasing you, burning patches | Instanced camera-facing quads (billboards built in the vertex shader). Fragment: a teardrop shape licked sideways by scrolling fbm, a black-body colour ramp. Additive, so tongues stack into a hot core with no sorting. |
| **Smoke bank** | `smoke.js` | Smoke under the ceiling; it drops lower and thicker in the blackout | Instanced soft puffs that fade radially and as the camera nears them, so there are no hard edges where smoke meets a wall. |
| **Flashlight beam** | `flashlight.js` | The blackout: the beam from your launcher | A cone with world-space noise (smoke stays put as the beam sweeps), soft edges from the view angle, fades along its length and near the camera. Additive. |
| **Ash dissolve** | `ash.js` | A patient (Labs) or a zombie (roof) burning away | Spliced into the model's own material: noise compared to a threshold that falls from the head down, `discard` past it, a glowing ember band just before it, charring as it goes. |
| **Heat signature** | `kit.js` -> `heatSignature` | The thermal serum: patients white-hot through the dark and smoke | Spliced into the patients' materials: a glow strongest at the silhouette (Fresnel), scaled by the serum's strength. |
| **Ambient occlusion (SSAO)** | `ao.js` | High quality: contact shadows in corners, under desks | Rebuilds view-space position and normal from the depth buffer and darkens each pixel by how much of a small hemisphere around it is inside geometry (12 rotated samples). |
| **Grading pass** | `post.js` | Heat haze as the fire closes in, colour split when hit, tunnel vision near death, grain | One full-screen pass driven by four gameplay numbers (`uHeat`, `uHit`, `uDanger`, `uDark`). |

## Sector 03 - The Skyline (`src/levels/causeway/`) - in depth in [shaders-explained.md](shaders-explained.md)

| Shader | File | Where to see it | How it works |
| --- | --- | --- | --- |
| **Ray-traced glass** | `shaders/glass.js` | Every pane | Reflection from a live probe weighted by Fresnel (Schlick); refraction by Snell's law with a different index per colour (dispersion fringes); Beer-Lambert absorption by path length (thick glass looks greener). |
| **Volumetric fire** | `shaders/fire.js` | The fires; cryo and sprinklers shrink them | Ray marching through a box: slab intersection, then samples of a noise density field, temperature -> black-body colour, front-to-back accumulation. Drawn BackSide so it works with the camera inside. `uIntensity` is the gameplay link. |
| **Night sky and clouds** | `shaders/sky.js` | Above and below the bridge | Stars from a 3D cell hash, the moon, a ray-marched cloud deck lit orange from below, a cloud sea under the tower; `uBurn` and `uFlash` from the demolition. |
| **Skyline towers** | `shaders/sky.js` | The city around the bridge | One InstancedMesh of towers with procedural windows and roof warning lights. |
| **Serum capsule** | `shaders/objects.js` | The serums | Ray/sphere intersection for the glass shell, then a signed-distance-field ray march for the living serum inside. |
| **Sphere cache crystal** | `shaders/objects.js` | Sphere caches | Faceted crystal with an inner pulse. |
| **Case-file hologram** | `shaders/objects.js` | The case files (collectibles) | Scan lines, flicker, a text texture. |
| **Kinetic shield** | `shaders/objects.js` | The shield serum's bubble | Fresnel rim, hexagon cells, a ripple when hit. |
| **Energy conduits** | `shaders/objects.js` | Conduits on the lift and gates | Flowing bands driven by game-state uniforms. |
| **Beacon column** | `shaders/objects.js` | Light rising over collectibles | An open cylinder, brightest at the floor, brightest face-on, bands scrolling up. |
| **Particles** | `shaders/particles.js` | Embers, sprinkler water (velocity-aligned streaks), soot, smoke pulled into broken vents, ceiling smoke, bursts | All GPU-driven: seeds in attributes, positions computed from time in the vertex shader. |
| **Lab monitors** | `kit.js` | Screens left on emergency power | Each instance (`gl_InstanceID`) hashes to its own state - dead, blue error, static, red alarm - with scan lines, tearing and flicker. |
| **Wet floor** | `kit.js` -> `wetFloor()` | Under open sprinklers | Spliced into the standard floor material: a puddle map turns the floor into a mirror there, keeping PBR lighting and shadows. |
| **Lift spiral** | `index.js` | Riding the lift up at the end of the Skyline | Points spiralling up around the cabin, computed in the shader. |

## The Roof (`src/levels/meltdown/`)

| Shader | File | Where to see it | How it works |
| --- | --- | --- | --- |
| **City windows** | `city.js` -> `worldWindows` | The towers around the roof | Spliced into the tower material: windows mapped in **world space** (8 x 16 windows a tile, 3.5 m each), so a 400 m tower isn't a stretched 40 m one; dark roofs. |
| **Streets far below** | `city.js` | Looking over the parapet | One plane: an avenue grid in sodium orange with traffic moving along it (white one way, red the other). |
| **Sky dome** | `roof.js` | Above the roof | A sphere drawn from inside (BackSide, no depth write): night sky going orange at the horizon from the city lit below, smoke drifting across it (noise), a few stars through the gaps. |
| **Ash dissolve** | `ash.js` | Zombies shot down | As in the Labs. |

---

## If you can only demo a few

1. **Glass** (Skyline) - Fresnel, Snell, Beer-Lambert: real physics per pixel.
2. **Volumetric fire** (Skyline) - ray marching; throw cryo at it to show `uIntensity`.
3. **Ash dissolve** (roof) - extending Three's own material with `onBeforeCompile`.
4. **Figure wear** (any level, compare Foundry vs Labs) - noise thresholds, rest-pose space.
5. **GPU shards** (break anything) - physics in the vertex shader.
6. **Flashlight** (Labs blackout) - faking volumetric light with a mesh.
