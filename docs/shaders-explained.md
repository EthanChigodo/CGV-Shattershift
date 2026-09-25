# Shaders explained - Level 1

A study guide for demonstrating and explaining the custom GLSL in Level 1. Every shader is original code written for this project on top of Three.js `ShaderMaterial`; no shader add-ons or libraries are used.

For each shader: **what it is for**, **its inputs** (uniforms are set once per draw from JavaScript; attributes are per vertex), **what the vertex stage does**, **what the fragment stage does**, and **questions a marker might ask**.

---

## 0. Two ideas used everywhere

### Ray tracing vs ray marching

Both shoot a ray per pixel. They differ in how they find what the ray hits.

| | Ray tracing (analytic) | Ray marching |
| --- | --- | --- |
| How | Solve an equation for the exact hit: ray/plane, ray/sphere, ray/box | Step along the ray, sampling a field at each step |
| Used for | Glass (refraction path through the slab), serum capsule shell (ray/sphere), fire bounding box (ray/box) | Fire density, clouds, the serum's inner shape (sphere tracing a signed distance field) |
| Cost | One formula | N samples (quality setting controls N) |

The level uses both, often together: the fire shader ray-*traces* the box to find where to start and stop, then ray-*marches* between those points.

### Noise (`shaders/common.js`)

Fire, clouds, smoke and cracks all need smooth randomness. Evaluating procedural 3D noise in GLSL costs dozens of hashes per call, so we pre-bake a 256×256 texture (`createNoiseTexture` in `textures.js`):

- the **R** channel is random,
- the **G** channel is R shifted by (37, 17) texels.

`noise3(p)` offsets the texture lookup by `(37, 17) × floor(p.z)`. One bilinear fetch then returns the lattice value on **two neighbouring z slices** (R = this slice, G = next slice), and `mix(r, g, fract(z))` finishes a trilinear 3D value noise. That is one texture read instead of eight hashes. `fbm3` sums four octaves (each double the frequency, half the amplitude) for natural detail.

---

## 1. Glass - `shaders/glass.js`

**Purpose.** Every pane, door, window, mirror wall and the lift cabin. The core of Level 1's identity.

**Inputs.**

| Uniform | Meaning |
| --- | --- |
| `uEnv` (samplerCube) | Live reflection probe (`probe.js`) |
| `uSceneTex`, `uHasScene`, `uResolution` | Snapshot of the scene behind the glass (post pipeline pass 2) |
| `uIor`, `uDispersion` | Index of refraction (1.5) and its spread across R, G, B |
| `uThickness`, `uAbsorb` | Slab thickness and per-channel absorption coefficients |
| `uCrack`, `uImpact` | Crack amount and impact point in pane-local metres |
| `uEdge`, `uHighlight`, `uMirror`, `uFrost` | Cyan rim, aim highlight, mirror amount, frosting |

**Vertex stage.** Passes world position, world normal and the local position. Supports instancing (`#ifdef USE_INSTANCING` multiplies by `instanceMatrix`), which is how the corridor windows are one draw call.

**Fragment stage, in order.**

1. **Two-sided normal.** If the normal faces away from the viewer it is flipped, so glass works from both sides.
2. **Cracks.** Around `uImpact`: radial spokes (the angle is quantised into 13 sectors; distance to the nearest sector line, wobbled by noise) plus concentric rings broken into arcs by a hash. The crack mask perturbs the normal, so reflections and refractions shatter along the cracks. Near the impact the glass frosts.
3. **Fresnel (Schlick).** `F0 = ((n-1)/(n+1))²` is about 0.04 for glass. `F = F0 + (1-F0)(1-cosθ)⁵`. Head-on almost everything transmits; at grazing angles almost everything reflects.
4. **Reflection.** `reflect(V, N)` looked up in the probe cube map.
5. **Refraction with dispersion.** `refract(V, N, 1/IOR)` is Snell's law. It is done three times, with IOR −dispersion, IOR, and IOR +dispersion, for R, G, B. The difference between each refracted ray and the straight-through ray is projected into view space and becomes a screen-space offset into the scene snapshot. The three channels land in slightly different places: rainbow fringes at glancing angles and in cracks.
6. **Absorption (Beer-Lambert).** The refracted ray's path through the slab is `thickness / cos(θt)`. Light surviving is `exp(-absorb × path)`. Thick reinforced glass, and any glass seen edge-on, is visibly greener and darker.
7. **Combine.** `mix(transmitted, reflected, F)`, add the cyan rim (readability), add crack glints.

**Grime (step 5).** Real glass is visible mostly by what is on it. 2D fbm makes smudges and dust that catch light (their brightness follows the reflection's luminance, so they glow when fire is reflected), and the top of each pane is soot-stained. In the dark lab this is what lets the player see clean glass at all.

**Low quality fallback.** No snapshot, so the pane is alpha-blended with alpha from the Fresnel term.

**Questions.**
- *Why not `MeshPhysicalMaterial` with `transmission`?* Three's transmission re-renders all opaque objects into a second target for every frame glass is visible. Our pipeline already has the scene in a render target, so glass reads a copy of it: same idea, no second scene render, and we control dispersion, absorption and cracks.
- *What is "ray traced" here?* The path of the refracted ray through the slab is computed analytically per pixel (Snell's law, then its length through the thickness) to get absorption, and reflection/refraction directions are traced into the environment.
- *Why does glass not reflect itself?* Glass is on its own render layer that the probe cameras cannot see.

---

## 2. Reflection probe - `probe.js` (not a shader, but feeds every reflection)

A `CubeCamera` renders the level into six faces of a cube map. Rendering all six every frame would mean drawing the level seven times, so the probe renders **one face per frame** (a full refresh every six frames). Rough PBR materials (floor, steel) need a blurred version per roughness; the probe runs Three's `PMREMGenerator` on the cube once per completed cycle and owns the result, so it can be freed when the level unloads.

---

## 3. Volumetric fire - `shaders/fire.js`

**Purpose.** Every fire in the level. The gameplay value (`uIntensity`) is what sprinklers and cryo spheres drive to zero.

**Inputs.** `uTime`, `uIntensity` (0-1), `uSeed` (per fire), `uScale` (box size in metres, so noise is isotropic in the world), `uNoise`. Define `STEPS` (18 high, 10 low).

**Vertex stage.** Moves the camera into the box's object space with `inverse(modelMatrix) * cameraPosition`, so the fragment stage can march in a unit cube whatever the fire's position or size.

**Fragment stage.**
1. Ray from the object-space camera through this fragment.
2. **Slab method** ray/box intersection: for each axis compute entry/exit distances, take the largest entry and smallest exit → `tNear`, `tFar`. If the camera is inside, start at 0.
3. March `STEPS` samples. At each: a flame shape (a radius that narrows with height) multiplied by vertically stretched fbm noise that scrolls upward over time. That scrolling is what makes flames lick upward.
4. **Temperature** from density and height → colour ramp: dark red → orange → yellow.
5. **Front-to-back compositing.** Each step's opacity is `1 - exp(-density × step × k)` (Beer-Lambert). Emission is added weighted by the remaining transmittance; stop early when nearly opaque.
6. Additive blending; fades with distance by hand (additive light should fade to nothing, not to fog colour).

**Tricks worth mentioning.** Rendered `BackSide` so the rasterised face is the exit face - the effect still works with the camera inside the fire. A per-pixel random start offset (dither) hides the banding a low step count would cause.

**Questions.** *Why a box and not particles?* A volume has real depth and parallax as you run past, costs one draw call, and shrinking `uIntensity` makes it gutter out smoothly.

---

## 4. Night sky and clouds - `shaders/sky.js`

**Purpose.** The 03:47 night sky over a burning city.

**Vertex stage.** The sphere follows the player and outputs `gl_Position = clip.xyww`, which forces depth to exactly 1.0 (the far plane). The sky can never clip or cover anything.

**Fragment stage.**
- **Atmosphere:** deep navy zenith, and an orange band `exp(-|y|·8)` on the horizon - the city burning below the clouds.
- **Stars:** the view direction is scaled into a 3D grid of cells; a hash of each cell decides whether it holds a star (about 1 in 360), drawn as a small disc that twinkles with time and fades near the horizon and behind cloud.
- **Moon:** a smoothstepped disc on `dot(dir, moonDir)` plus a faint halo.
- **Cloud deck (ray marching):** for `CLOUD_STEPS` heights between 1.0 and 1.6, intersect the view ray with a horizontal plane (`t = h / dir.y`), sample 2D fbm there, accumulate opacity front to back. Clouds are dark silhouettes; lower layers catch the orange glow from below.
- **Cloud sea below:** rays pointing down hit a cloud floor lit in patches by the fires in the city under it.
- **`uBurn`** (fires, progress, explosions) strengthens the glow and the smoke plumes on the horizon behind the player; **`uFlash`** adds detonation pulses.

**Skyline.** One `InstancedMesh` of towers. Windows are generated from world position in the fragment shader (floor/column grid + hash for which are lit - warm or cool - some burning), whole towers are blacked out by a per-tower hash (power cuts), and the lower facades glow with fire light from the streets. In the vertex shader each tower's origin is wrapped with `mod()` around the camera's z, so the skyline is infinite for endless mode at zero CPU cost.

---

## 5. Serum capsule - `shaders/objects.js` → `createSerumMaterial`

**Purpose.** Power-up pickups. The showcase for SDF ray marching.

**Fragment stage.**
1. **Analytic ray/sphere intersection** with the capsule shell (radius 0.5): solve `|o + t·d|² = r²`, a quadratic in `t`. Missing the sphere discards the pixel.
2. Fresnel rim from the shell normal.
3. Refract into the shell (IOR 1.33).
4. **Sphere tracing** a signed distance field: four orbiting blobs merged with a *smooth minimum* (`smin`), plus a per-serum shape - a rotating octahedron (prism), a gyroid lattice (thermal), a hollow shell (shield), spikes (overdrive). Each step advances by the distance to the nearest surface, which is guaranteed safe.
5. On a hit, the normal comes from the SDF gradient (tetrahedral central differences); shade with diffuse, rim and a glowing core.

**Question.** *What is a signed distance field?* A function that returns, for any point, the distance to the nearest surface (negative inside). It lets us describe smooth blended shapes with a few lines of maths instead of meshes.

---

## 6. Smaller object shaders - `shaders/objects.js`

| Shader | What to say |
| --- | --- |
| **Crystal** (sphere caches, locks) | Flat facets from screen-space derivatives: `normalize(cross(dFdx(pos), dFdy(pos)))`. Inner pulse travels outward with `sin(time - length(pos))`. Probe reflection on the facets. |
| **Hologram** (case files) | Text is a canvas texture; the shader adds scan lines from world height, a scrolling band, flicker from a hashed time step, and a frame from UV distance to the edge. Additive, tinted gold for case files so they never read as breakable glass. |
| **Beacon column** (case files) | An open cylinder drawn additively. Brightest at the floor and fading upward (`pow(1 - uv.y, 1.4)` - `uv.y` is 0 at the bottom of a `CylinderGeometry`); brightest where the surface faces the viewer (`abs(dot(normal, view))²`), which makes a thin tube read as a volume of light rather than a pipe; bands scroll upward with time. One shared material for all five files. |
| **Kinetic shield** | Fresnel rim, a hexagonal grid computed from spherical coordinates (distance to nearest hex edge on two offset grids), and a ripple that travels across the sphere from the impact direction. |
| **Energy conduit** (gate, lift) | The team's original energy idea redone: the **vertex stage** pushes vertices along the normal with a travelling sine (geometry pulses), the **fragment stage** draws flowing bands. `uCharge` rises as locks break and as the lift powers up - game state driving a shader. |

---

## 7. GPU physics - `shaders/particles.js`

The CPU never updates a particle. Random seeds are written into attributes once; the vertex shader computes position as a **closed-form function of time**.

### Glass shards

`buildFractureGeometry` (JavaScript, once per break) fractures the pane **around the actual hit point**: jittered spokes × jittered rings form cells, each cell is clamped to the pane rectangle and extruded to the pane thickness. Each shard gets a velocity - outward from the impact plus along the sphere's direction, strongest near the impact - and a random spin axis.

The vertex shader then does rigid-body motion per shard:

- **Flight:** `p = c + v·t − ½·g·t²`.
- **Floor bounce:** solve `c.y + v.y·t − ½·g·t² = floor` for the landing time. After it: vertical velocity is reflected with restitution 0.28, horizontal velocity keeps 35% (friction), and spin decays.
- **Rotation:** Rodrigues' formula rotates each vertex about the shard's axis by `speed × time`.
- Shards that land off the edge of the bridge keep falling.

**Question.** *Why not a physics library?* The guide warns about physics costing frame rate. Shards only need to look right for three seconds, and a closed-form solution in the vertex shader costs nothing on the CPU no matter how many there are.

### Sprinkler water - velocity-aligned streaks

Falling water is seen as streaks, not dots. Each droplet is an instanced quad. The vertex shader computes the droplet's position `p(t)` and velocity `v(t)` in closed form, projects `p` and a tail point `p − v·0.07` into view space, and builds the quad along the line between them with a small width perpendicular to it - a motion-blurred streak that always faces the camera.

*A bug worth telling:* the first version built the perpendicular as `(−dir.y, dir.x)`. That mirrors the quad, so its triangles always wound clockwise on screen and **back-face culling removed every droplet** - the shader compiled, the droplets were in the right places (checked by replicating the maths on the CPU), and nothing drew. Using `(dir.y, −dir.x)` keeps the winding facing the camera. The playtest report "I didn't see the sprinklers sprinkling" was this bug.

### Particle systems

| System | Inputs | Motion |
| --- | --- | --- |
| **Embers** | `uSlots[6]` = nearest six fires | Rise with a swirl over a looping lifetime; slot chosen by `gl_VertexID % 6` |
| **Sprinkler water** | `uSlots[4]` = nearest open heads | Cone spray with gravity, clamped at the floor, stretched droplets |
| **Ceiling smoke** | `uProfile[16]` = smoke density every 10 m | Billboards anchored in world space and wrapped into a window around the player; density interpolated from the profile, so a cleared vent visibly thins the smoke |
| **Vent suction** | `uVents[4]` / `uNormals[4]` = the four nearest broken vents | Each puff starts on a disc ~3 m out along the vent's normal and spirals in (`t^1.6`, so it speeds up and shrinks near the mouth). The spiral uses a tangent basis built from the normal: `t1 = normalize(cross(n, up))`, `t2 = cross(n, t1)` |
| **Soot columns** | The same six fire slots as the embers | Billboards rise from each fire, lit orange at the base and black above, and spread out along the ceiling when they reach it |
| **Bursts** (dust, steam, sparks, fluid, cryo, shock, fireball) | Origin + age | Spherical directions with closed-form drag `(1 − e^(−kt))/k` and gravity. Tremors use dust bursts with no upward component, so it falls from the ceiling |

---

## 8. Lab monitors and ceiling fluorescents

**Monitors** (`kit.js` → `createMonitorMaterial`): one instanced screen material for the whole level. `gl_InstanceID` is hashed into a per-screen state - dead, blue error screen, rolling static, or a red containment alarm - and time drives scan lines, horizontal tearing on random frames, and flicker.

**Fluorescents** (`shell.js` → `updateFixtures`): not a custom shader - a `MeshBasicMaterial` on an `InstancedMesh` with **per-instance colour**. Each frame the CPU writes a colour for each of the 60 tubes: dead (near black), failing (a product of two sines flicks it on and off), or on (with a slight hum). During a tremor the level drives most of them off. Sixty colour writes a frame is trivially cheap and costs no extra draw calls.

## 9. Wet floor - `kit.js` → `wetFloor()`

Not a new shader: Three's standard PBR shader patched with `onBeforeCompile`. One uniform `uWet` (0-1, rises near open sprinklers) darkens the albedo and lerps roughness toward the **puddle roughness map**, so puddles become mirrors that reflect the probe. This keeps Three's lighting and shadows and adds one behaviour.

---

## 10. Post-processing - `src/fx/postfx.js`

**Pipeline (high/medium).**

1. **World pass** into an HDR (half-float) render target.
2. **Snapshot** copy (full resolution on high) - what glass refracts.
3. **Glass pass** into the same target, then 4. **FX pass**. The scene background is detached for these two passes, because Three force-clears the target when the background is a colour.
5. **Bloom:** soft-threshold bright pass at quarter resolution, then two iterations of a separable 9-tap Gaussian done in 5 bilinear fetches (the "linear sampling" trick).
6. **Composite** to the screen.

**Composite, in order.**

| Step | How |
| --- | --- |
| Heat haze | Near each of four fires (projected to screen), the UV lookup is displaced by sine waves, fading with distance from the fire's screen position |
| Lens water | Under a sprinkler, two layers of screen cells each may hold a droplet sliding slowly down; inside a droplet the UV is offset by the distance to its centre, so it refracts the image like a tiny lens. Dries off after you leave the shower |
| FXAA | Detects edges by comparing the luma of four diagonal neighbours, then blends along the edge direction (luma taken on `x/(1+x)` so HDR highlights do not dominate) |
| Chromatic aberration | Red and blue sampled offset toward/away from the centre; grows with damage, prism, overdrive |
| Sharpening | Unsharp mask: each pixel is pushed away from the average of its four neighbours, `colour += clamp(colour - avg, -0.12, 0.12) * uSharpen`. It restores the crispness FXAA takes off; the clamp stops bright HDR edges (fire, strips) from ringing. `uSharpen` is 0.35 at full resolution and rises as Auto quality lowers the render scale, so the image stays crisp |
| Sedation | At the start of Level 1 only: six taps on a slowly rotating ring blur the image (more toward the edges), a second sample drifting on two slow sines gives a faint double image, and colour is partly desaturated. `uSedation` falls from 1 to 0 over the first 40 m (about six seconds), then the whole branch is skipped |
| Speed lines | Radial blur toward the centre when sprinting or in overdrive |
| Bloom + tone mapping | Bloom added in HDR, then ACES filmic tone mapping |
| Looks | Smoke veil (desaturate, close in from the edges), **thermal** (luma + warmth → iron-bow palette), overdrive, prism, focus, damage, heat, photo filters (noir, archive/sepia) |
| Finish | Vignette plus a **heartbeat pulse** (two Gaussian bumps per beat, at a rate of 70-150 bpm driven by fear: low integrity, smoke, fire), flash, film grain, sRGB output |

**Question.** *What is the point of the three-pass render?* Glass needs to see what is behind it (so opaque first), and a flame in front of glass must not be overwritten by the glass (so effects last).

---

## 11. 360° capture - `src/fx/photo-mode.js`

A 1024² `CubeCamera` renders the full sphere of view. A full-screen shader converts it to equirectangular: each output pixel's `(u, v)` → longitude `(u − 0.5)·2π` and latitude `(v − 0.5)·π` → a direction → a cube-map sample. It tone-maps (ACES) and sRGB-encodes by hand because Three only does that when drawing to the screen. Pixels are read back, flipped (WebGL rows run bottom-up) and saved as a 2:1 PNG that any 360 viewer opens.

---

## Demonstration script (2 minutes)

1. Settings → Performance overlay on. Show draw calls and resolution scale.
2. First pane: point out the cyan rim (readability), grime and soot, Fresnel (look at it edge-on), refraction and colour fringes. Move the mouse: the crosshair follows it, and turns amber with a ring when aim assist locks onto a target.
3. Shoot reinforced glass once: cracks form around the exact hit point. Shoot again: shards fracture outward from that point and bounce.
4. Fire: walk past it to show parallax (it is a volume) and the soot rolling along the ceiling. Shoot the sprinkler bulb: the shower starts, the fire gutters out, the floor turns into a mirror; run under it for water on the lens.
5. In the ward smoke, point out a vent's pulsing cyan ring; break it and show the smoke spiralling in. Walk through the gold light column of a case file. Take the thermal serum in the smoke on the bridge: the smoke clears and the palette changes.
6. Press `P`: photo mode, switch filters, save a 360° panorama.
7. Reach the lift: the camera pulls out to third person, the atrium detonates below.
