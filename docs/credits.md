# Credits and asset register

Documentation set item 6. Every external resource, library, technique and tool used in the project, with its source, licence, modifications, and where it is used. Add to this file whenever anything external enters the repository.

---

## 1. Libraries

| Asset | Creator | Source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- | --- |
| Three.js r160 | Three.js authors | https://threejs.org (loaded from jsDelivr) | MIT | None | Whole game, imported only through `src/three.js` |
| Playwright (dev only, not shipped) | Microsoft | https://playwright.dev | Apache 2.0 | None | `tests/` harnesses |

## 2. Models, textures, sounds

**None.** All geometry is built from Three.js primitives, and all textures are drawn at runtime (`src/levels/causeway/textures.js`, `src/levels/foundry/textures.js`). There are no audio files.

## 3. Published techniques

These are well-known graphics techniques, implemented in our own code. They are credited because the maths or the approach comes from published work.

| Technique | Source | Where |
| --- | --- | --- |
| Fresnel approximation | C. Schlick, "An Inexpensive BRDF Model for Physically-based Rendering", 1994 | Glass, shards |
| Snell's law refraction, Beer-Lambert absorption | Standard optics | Glass |
| Ray/box intersection (slab method) | T. Kay and J. Kajiya, "Ray Tracing Complex Scenes", SIGGRAPH 1986 | Fire |
| Smooth minimum, SDF normals by tetrahedral differences, 3D value noise from a 2D texture | Inigo Quilez, articles at https://iquilezles.org | Serum capsule, noise lattice |
| FXAA | T. Lottes, NVIDIA, 2009 | Composite pass |
| ACES filmic tone-mapping curve (fitted) | K. Narkowicz, 2016 | 360° capture |
| Gaussian blur with linear sampling | D. Rákos, 2010 | Bloom |
| Rodrigues' rotation formula | Standard mathematics | GPU shard physics |
| Sobel filter for normal maps | Standard image processing | Both levels' textures |

## 4. Tools and assistance

| Tool | Use | Note |
| --- | --- | --- |
| Claude (Anthropic AI assistant) | Helped write Level 1's code, shaders, tests and documentation | **Declare this according to the course's policy on AI assistance.** Every team member presenting Level 1 should be able to explain the code; `docs/shaders-explained.md` is written for that purpose |

## 5. Reference games (inspiration only, no assets used)

| Game | Developer | What we took |
| --- | --- | --- |
| Smash Hit | Mediocre AB | Throwing spheres, glass destruction, limited ammunition |
| Temple Run 2 | Imangi Studios | Chase camera, lanes, obstacle anticipation |
