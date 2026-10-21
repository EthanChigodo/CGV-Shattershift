/**
 * Every lift is the same glass cabin (src/elevators/glass-cabin.js), inside
 * as well as out - playtest round 4: "Outside it looks like glass but inside
 * it is steel. Choose one layout for all the elevators."
 *
 * Builds each cabin on its own - the Gravity Fault / quiet ride cabin
 * (elevators/kit.js), the Calibration Lift (common/calibration-lift.js),
 * Level 1's (the Causeway kit, through the same builder) and Level 3's two
 * lifts (meltdown/elevator.js) - and checks:
 *   - every part of the design is there: glass in mullions, conduit posts,
 *     two glass doors with lit edges, a door frame and threshold, the
 *     button panel, two light bars, a handrail, the tread deck;
 *   - the glass, the doors' glass and the steel are the same materials'
 *     settings in every lift (one set: they cannot drift apart);
 *   - from inside, at eye height, looking at every pane and at the closed
 *     doors, the first thing in the way is glass - never a steel panel.
 */

export const cabins = {
  name: "every lift the same glass cabin",
  async run(page) {
    const r = await page.evaluate(async () => {
      const THREE = __dbg.THREE;
      const { buildCabin, Owned } = await import("/src/elevators/kit.js");
      const { createRideUniforms } = await import("/src/elevators/shaders.js");
      const { CalibrationLift } = await import("/src/levels/common/calibration-lift.js");
      const { createLift, FREIGHT_LIFT, ROOF_LIFT } = await import("/src/levels/meltdown/elevator.js");
      const { createMeltdownKit } = await import("/src/levels/meltdown/kit.js");
      const owned = new Owned();
      const kit = createMeltdownKit({});
      const cal = new CalibrationLift({});
      cal.setDoorsOpen(0);
      const lifts = {
        gravity: { root: buildCabin(createRideUniforms(), owned).root, eye: [0, 1.6, 0] },
        calibration: { root: cal.cabin, eye: [0, 1.6, 0], ring: 4.3 },
        labs: { root: createLift(kit, { label: "B2" }), eye: [0, 1.6, FREIGHT_LIFT.depth / 2 + 0.25] },
        roof: { root: createLift(kit, { ...ROOF_LIFT, label: "R" }), eye: [0, 1.6, ROOF_LIFT.depth / 2 + 0.25] },
      };
      if (__dbg.causeway?.kit) lifts.skyline = { root: __dbg.causeway.kit.lift().cabin, eye: null };
      const PARTS = { CabinGlass: 1, CabinMullion: 1, CabinPost: 2, CabinConduit: 2, CabinDoor: 2, CabinDoorEdge: 2, CabinDoorFrame: 3, CabinThreshold: 1, CabinButtons: 1, CabinLight: 2, CabinHandrail: 1, CabinDeck: 1 };
      const out = { parts: {}, missing: [], blocked: [], rays: 0, glass: new Set(), doorGlass: new Set(), steel: new Set() };
      const raycaster = new THREE.Raycaster();
      for (const [name, lift] of Object.entries(lifts)) {
        const root = lift.root;
        root.updateMatrixWorld(true);
        const count = {};
        root.traverse((o) => { if (o.name.startsWith("Cabin")) count[o.name] = (count[o.name] ?? 0) + 1; });
        out.parts[name] = count;
        for (const [part, least] of Object.entries(PARTS)) if ((count[part] ?? 0) < least) out.missing.push(`${name}: ${part} x${count[part] ?? 0}`);
        if (name === "skyline") continue;
        const key = (m) => `${m.color.getHexString()}/${m.opacity}`;
        root.traverse((o) => {
          if (o.name === "CabinGlass") out.glass.add(key(o.material));
          if (o.name === "CabinDoor") out.doorGlass.add(key(o.material));
          if (o.name === "CabinMullion" || o.name === "CabinPost") out.steel.add(key(o.material));
        });
        // From the eye to every pane's centre (a cylinder: round it) and every door leaf's.
        const eye = new THREE.Vector3(...lift.eye);
        const targets = [];
        root.traverse((o) => {
          if (o.name === "CabinDoor") targets.push(o.getWorldPosition(new THREE.Vector3()).setY(1.6));
          if (o.name !== "CabinGlass") return;
          if (lift.ring && o.geometry.type === "CylinderGeometry") {
            for (let i = 0; i < 16; i += 1) {
              const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
              const p = new THREE.Vector3(Math.sin(a) * lift.ring, 1.8, Math.cos(a) * lift.ring);
              if (p.z < 3.3) targets.push(p);
            }
          } else targets.push(o.getWorldPosition(new THREE.Vector3()).setY(Math.min(1.8, o.getWorldPosition(new THREE.Vector3()).y)));
        });
        for (const t of targets) {
          raycaster.set(eye, t.clone().sub(eye).normalize());
          raycaster.far = eye.distanceTo(t) + 0.05;
          const hit = raycaster.intersectObject(root, true).find((h) => h.object.visible && h.distance > 0.05);
          out.rays += 1;
          if (!hit || !hit.object.material.transparent) out.blocked.push(`${name}: ${hit ? hit.object.name || "an opaque mesh" : "nothing"} in front of the glass at ${t.toArray().map((v) => v.toFixed(1))}`);
        }
      }
      return { ...out, glass: [...out.glass], doorGlass: [...out.doorGlass], steel: [...out.steel] };
    });
    const failures = [];
    for (const m of r.missing) failures.push(`missing part - ${m}`);
    for (const b of r.blocked.slice(0, 6)) failures.push(`not glass from inside - ${b}`);
    if (r.glass.length !== 1) failures.push(`the lifts' glass differs: ${r.glass.join(", ")}`);
    if (r.doorGlass.length !== 1) failures.push(`the lifts' door glass differs: ${r.doorGlass.join(", ")}`);
    if (r.steel.length !== 1) failures.push(`the lifts' steel differs: ${r.steel.join(", ")}`);
    if (r.rays < 30) failures.push(`only ${r.rays} sight lines checked`);
    return { failures, notes: { rays: r.rays, parts: r.parts } };
  },
};
