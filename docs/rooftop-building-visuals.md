# Roof tower: cinematic facade

This is limited to the tower below the Roof. The falling shot, player, bazooka,
controls, enemy AI, collision footprint and graphics settings are unchanged.

## Presentation

- Seeded per-face/per-floor windows: reflective, dirty, cracked, broken and clear.
- Uneven missing-glass shapes, thin fracture lines and retained shard reflection.
- Dark, dim, warm/cool lit rooms; only a small subset gently flickers.
- Recessed rooms with floors/ceilings, desks, chairs, monitor screens/stands,
  shelving, boxes and dividers, with some rooms deliberately empty.
- Sparse walking shadow figures, behind furniture and glass, never enemies.
- Weathered wall colour/normal perturbation, panel seams, roughness variation,
  Fresnel response and the existing scene environment/specular lighting.
- One instanced batch of raised window trim over the upper ~94 metres, covering
  the area seen by the cinematic without rebuilding the entire tower.

The window/interior effect is an **opaque parallax illusion**, not alpha-blended
glass over full room models. An analytic room-box projection and a few reusable
furniture boxes create view-dependent depth/occlusion. Jagged opening masks
remove the glass response and expose these virtual interiors. This avoids
sorting, background scene copies, reflection probes, extra window meshes and
the large existing office/enemy model assets. Furniture is simplified geometry
evaluated in GLSL; it is not a photorealistic model or an enterable room.

## Lifetime and performance

`roof-facade.js` owns one material and a shared time uniform. The Roof updates
that uniform in its normal update; during a falling shot only `updateFacade`
continues, without advancing combat or extraction. Pause freezes it. There are
no extra animation loops, listeners or timers. Restart creates fresh facade
state. Roof disposal releases the instanced buffers and its owned geometry;
the existing kit owns the reused trim material.

`roof-facade-rooms.js` holds the reusable GLSL, deterministic window-state helper,
configuration and instanced trim generator. Interior work is skipped for opaque
or fully dark panes; detailed room shading fades from 45 to 75 metres. The trim
has no colliders, gameplay tags or shadow casting. No new textures, lights,
third-party assets or dependencies are added. The facade adds one instanced
draw, and no render pass. It has additional fragment cost: target-PC smoothness
must still be checked, rather than inferred from the draw-call count.

## Verification

```powershell
node --test tests/rooftop-facade.test.mjs tests/rooftop-fall.test.mjs tests/ammo-recovery.test.mjs
node tests/rooftop-fall-browser.mjs --shots --facade
py tools/serve.py 8000
```

The browser test uses installed Chromium/Edge, an isolated temporary profile,
and no package install. `--facade` adds a production-material close-up of a
moving silhouette and frozen-camera before/after measurements against the
committed HEAD facade (run before committing). The comparison includes GPU
completion via `gl.finish`, warmed shaders, identical viewport/scene, eight
samples per mode, total draw/triangle/memory counts. This is headless SOFTWARE
WebGL render latency, not a hardware FPS benchmark or a full gameplay measurement.
`--shots` writes review images outside the repository to the printed temporary
directory. Do not interpret a pixel-hash change alone as visual quality proof;
inspect those images too.

Open `http://localhost:8000/preview/meltdown.html?roof`, fall off both open sides,
and look for damaged panes, room depth, furniture and faint background motion.
The foreground player/bazooka should remain readable. Check pause/resume,
repeated restart and Game Over; try the full game's Roof mode too. Review on
the lab GPU at the intended display resolution. Distant windows intentionally
lose furniture detail; the shadow figures are stylised silhouettes rather than
fully animated zombie models. The existing full Playwright suite still requires
its separately installed dependency.
