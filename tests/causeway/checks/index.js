/**
 * Level 1 checks. Each export is { name, run(page) -> {failures, notes} }.
 * Every check guards a real design rule or a bug found while building the
 * level - see docs/test-plan-level-1.md.
 */

/** Static layout rules, read straight from the authored layout data. */
export const layout = {
  name: "layout",
  async run(page) {
    return page.evaluate(async () => {
      const { authoredLayout, SMOKE_ZONES, LANES } = await import("./src/levels/causeway/layout.js");
      const entries = authoredLayout();
      const failures = [];
      const laneOf = (x) => (x < -1.6 ? 0 : x > 1.6 ? 2 : 1);

      // 1. Never all three lanes blocked by solids at once.
      const solids = entries.filter((e) => e.type === "hazard" || (e.type === "collapse" && e.kind !== "glass") || e.type === "sculpture");
      for (const a of solids) {
        const blocked = new Set();
        for (const b of solids) if (Math.abs(a.d - b.d) < 3) blocked.add(laneOf(b.x ?? 0));
        if (blocked.size >= 3) failures.push(`all lanes blocked by solids near ${a.d} m`);
      }

      // 2. Every fire can be dealt with: a sprinkler within 13 m, or a clear lane.
      const fires = entries.filter((e) => e.type === "fire");
      for (const f of fires) {
        const sprinkler = entries.some((e) => e.type === "sprinkler" && Math.abs(e.d - f.d) < 13);
        const burning = new Set();
        for (const g of fires) if (Math.abs(g.d - f.d) < 3) {
          for (const [i, x] of LANES.entries()) if (Math.abs(x - g.x) < (g.width ?? 3) / 2 + 0.45) burning.add(i);
        }
        if (!sprinkler && burning.size >= 3) failures.push(`fire at ${f.d} m has no sprinkler and no clear lane`);
      }

      // 3. Every smoke zone has its vents inside it.
      for (const zone of SMOKE_ZONES) {
        for (const id of zone.vents) {
          const vent = entries.find((e) => e.type === "vent" && e.id === id);
          if (!vent) failures.push(`smoke zone ${zone.from}-${zone.to} references missing vent ${id}`);
          else if (vent.d < zone.from - 10 || vent.d > zone.to) failures.push(`vent ${id} at ${vent.d} m is outside its zone`);
        }
      }

      // 4. Five case files, each once.
      const files = entries.filter((e) => e.type === "file").map((e) => e.index).sort();
      if (files.join() !== "0,1,2,3,4") failures.push(`case files are ${files.join()}, expected 0-4`);

      const caches = entries.filter((e) => e.type === "cache").length;
      const panes = entries.filter((e) => e.type === "pane" || e.type === "door").length;
      return {
        failures,
        notes: { entries: entries.length, caches, spheresAvailable: 20 + caches * 3, glassTargets: panes, fires: fires.length },
      };
    });
  },
};

/** The bot plays the whole level, rides the lift, and arrives in Level 2. */
export const playthrough = {
  name: "playthrough",
  async run(page) {
    const r = await page.evaluate(() => window.__bot({ bot: true, maxFrames: 8000, throughLift: true }));
    const failures = [];
    if (!r.lift) failures.push(`never reached the lift (state ${r.state}, ${Math.round(r.dist ?? 0)} m, hp ${Math.round(r.hp)})`);
    else {
      if (r.lift.level !== 2) failures.push(`lift ended in level ${r.lift.level}, expected 2`);
      if (!r.lift.causewayDisposed) failures.push("Level 1 was not disposed after the hand-off");
      if (!r.lift.foundryVisible) failures.push("Foundry not visible after the hand-off");
      if (r.lift.after3s.state !== "playing") failures.push(`Level 2 not playing 3 s after arrival (${r.lift.after3s.state})`);
      if (Number(r.lift.after3s.fd) <= 5) failures.push("player is not moving through the Foundry");
    }
    return {
      failures,
      notes: { score: r.score, hp: Math.round(r.hp), shots: r.shotsFired, stats: r.stats, missions: r.missions },
    };
  },
};

/** Each way to lose actually loses, with the right message. */
export const failureStates = {
  name: "failure states",
  async run(page) {
    return page.evaluate(() => {
      const d = globalThis.__dbg;
      const failures = [];
      const notes = {};

      // Passive player: no input at all must not survive.
      d.resetGame("story");
      for (let i = 0; i < 3000 && d.state === "playing"; i += 1) d.step(1);
      if (d.state !== "ended") failures.push("a player who never moves or throws survived the level");
      notes.passiveDiedAt = Math.round(d.causewayDistance());

      // Bridge collapse: let the front catch the player.
      d.resetGame("story");
      d.setCausewayDistance(300);
      d.setHealth(1e6);
      d.step(5);
      d.causeway.state.chase.active = true;
      d.causeway.state.chase.front = d.causewayDistance() + 1;
      d.step(3);
      if (d.state !== "ended" || !/skybridge/i.test(document.querySelector("#endText").textContent)) failures.push("being caught by the bridge collapse did not end the run");

      // Sealed gate: arrive without breaking the locks.
      d.resetGame("story");
      d.setHealth(1e6);
      d.setCausewayDistance(755);
      for (let i = 0; i < 600 && d.state === "playing"; i += 1) d.step(1);
      if (d.state !== "ended" || !/atrium/i.test(document.querySelector("#endText").textContent)) failures.push("the sealed-gate timer did not end the run");
      return { failures, notes };
    });
  },
};

/** Core mechanics behave as the field manual says. */
export const mechanics = {
  name: "mechanics",
  async run(page) {
    return page.evaluate(() => {
      const d = globalThis.__dbg;
      const T = d.THREE;
      const failures = [];
      d.resetGame("story");
      d.setHealth(1e6);
      const L = () => d.causeway;
      const rec = (kind, near) => L().live.find((r) => r.kind === kind && Math.abs(r.entry.d - near) < 6);

      // Sprinkler puts out the fire below it.
      d.setCausewayDistance(40); d.step(3);
      const fire = rec("fire", 72);
      const sprinkler = rec("sprinkler", 64);
      d.shatter(sprinkler.targets[0], { point: sprinkler.targets[0].getWorldPosition(new T.Vector3()) });
      d.step(90);
      if (fire.intensity > 0.05) failures.push(`sprinkler did not extinguish the fire (intensity ${fire.intensity.toFixed(2)})`);

      // Reinforced glass takes two hits.
      d.setCausewayDistance(80); d.step(3);
      const reinforced = L().live.find((r) => r.kind === "pane" && r.entry.reinforced && Math.abs(r.entry.d - 100) < 1);
      const glass = reinforced.targets[0];
      const first = d.shatter(glass, { point: glass.getWorldPosition(new T.Vector3()) });
      if (!first?.cracked || !glass.userData.alive) failures.push("reinforced glass broke on the first hit");
      d.shatter(glass, { point: glass.getWorldPosition(new T.Vector3()) });
      if (glass.userData.alive) failures.push("reinforced glass survived the second hit");

      // Streaming only moves forward, so checks visit the route in order.
      // Serum pickups activate.
      d.arsenal.reset();
      d.setCausewayDistance(95); d.step(3);
      const serum = rec("serum", 112);
      d.shatter(serum.targets[0], {});
      if (!d.arsenal.isActive("prism")) failures.push("prism serum did not activate");

      // Cryo splash puts out a fire.
      d.setCausewayDistance(125); d.step(3);
      const fire2 = rec("fire", 140);
      L().splash(fire2.world.clone().setY(1), 4.8, "cryo");
      d.step(90);
      if (fire2.intensity > 0.05) failures.push("cryo splash did not extinguish the fire");

      // Lock order is enforced.
      d.setCausewayDistance(730); d.step(3);
      const locks = L().gate.parts.locks;
      const wrong = d.shatter(locks[2].mesh, {});
      if (!wrong?.rejected || !locks[2].mesh.userData.alive) failures.push("lock III broke before lock I");
      for (const lock of locks) d.shatter(lock.mesh, {});
      if (!L().state.finale.open) failures.push("breaking I, II, III in order did not open the gate");

      return { failures, notes: {} };
    });
  },
};

/** Restarting repeatedly must not leak GPU memory. */
export const memory = {
  name: "memory",
  async run(page) {
    return page.evaluate(async () => {
      const d = globalThis.__dbg;
      const sample = async () => {
        d.resetGame("story");
        d.step(10);
        d.render();
        await new Promise((r) => setTimeout(r, 50));
        return { geometries: d.renderer.info.memory.geometries, textures: d.renderer.info.memory.textures };
      };
      const counts = [];
      for (let i = 0; i < 5; i += 1) counts.push(await sample());
      const failures = [];
      const growth = counts.at(-1).geometries - counts[1].geometries;
      const texGrowth = counts.at(-1).textures - counts[1].textures;
      if (growth > 12) failures.push(`geometries grew by ${growth} over 3 restarts`);
      if (texGrowth > 6) failures.push(`textures grew by ${texGrowth} over 3 restarts`);
      return { failures, notes: { counts } };
    });
  },
};

/** Endless mode streams without growing. */
export const endless = {
  name: "endless",
  async run(page) {
    const r = await page.evaluate(() => window.__bot({ bot: true, maxFrames: 3600, mode: "endless" }));
    const failures = [];
    if ((r.dist ?? 0) < 600 && r.state === "playing") failures.push(`endless bot only reached ${Math.round(r.dist)} m`);
    const live = r.log.map((line) => Number(/live=(\d+)/.exec(line)?.[1] ?? 0));
    if (Math.max(...live) > 70) failures.push(`live object count reached ${Math.max(...live)}`);
    return { failures, notes: { distance: Math.round(r.dist ?? 0), maxLive: Math.max(...live), state: r.state } };
  },
};

/** The pace ramps from sedated to full speed, and explosions cause a surge. */
export const pace = {
  name: "pace",
  async run(page) {
    return page.evaluate(() => {
      const d = globalThis.__dbg;
      const failures = [];
      const at = (dist) => d.causewayPace(dist).pace;
      if (at(5) > 6.5) failures.push(`start pace ${at(5).toFixed(1)} m/s is not groggy (expected about 6)`);
      if (Math.abs(at(235) - 10.2) > 0.3) failures.push(`pace at the end of the ward is ${at(235).toFixed(1)} m/s, expected 10.2`);
      // The bridge collapse runs at 8.6 m/s: the player must outpace it from its start.
      const chaseStart = 262;
      for (let x = chaseStart; x < 530; x += 10) if (at(x) < 9.6) failures.push(`pace ${at(x).toFixed(1)} m/s at ${x} m is too close to the collapse speed`);

      // Measured in play: the real speed after running a while at the start and mid-ward.
      d.resetGame("story"); d.setHealth(1e6);
      d.step(60);
      const early = d.run.speed;
      d.setCausewayDistance(200); d.step(90);
      const late = d.run.speed;
      if (!(early < 7.2 && late > 9.4)) failures.push(`measured speed ${early.toFixed(1)} -> ${late.toFixed(1)} m/s does not ramp`);

      // Surge: the ward detonation (242 m) should push speed above pace.
      // Track the biggest gap between actual speed and pace over the next 3 s.
      d.setCausewayDistance(236);
      let surged = 0;
      let excess = 0;
      for (let i = 0; i < 90; i += 1) {
        d.step(1);
        const gap = d.run.speed - at(d.causewayDistance());
        if (gap > excess) { excess = gap; surged = d.run.speed; }
      }
      if (excess < 0.6) failures.push(`no fright surge after the explosion (peak +${excess.toFixed(2)} m/s over pace)`);
      return { failures, notes: { paceAt: { 5: at(5).toFixed(1), 120: at(120).toFixed(1), 235: at(235).toFixed(1), 300: at(300).toFixed(1), 600: at(600).toFixed(1) }, measured: { early: early.toFixed(1), late: late.toFixed(1), surgePeak: surged.toFixed(1), surgeOverPace: excess.toFixed(2) } } };
    });
  },
};

/**
 * Aiming: the crosshair near (not on) a small target still breaks it with aim
 * assist, misses without it, and assist does not grab targets far from the
 * crosshair. Case files are collected by running through them.
 */
export const aim = {
  name: "aim",
  async run(page) {
    return page.evaluate(() => {
      const d = globalThis.__dbg;
      const T = d.THREE;
      const failures = [];
      const toggle = document.querySelector("#aimAssistToggle");
      const trial = (assist, offsetPx) => {
        d.resetGame("story"); d.setHealth(1e6);
        toggle.checked = assist; toggle.dispatchEvent(new Event("change"));
        d.setCausewayDistance(52); d.setLane(1); d.step(4);
        const rec = d.causeway.live.find((r) => r.kind === "sprinkler" && Math.abs(r.entry.d - 64) < 1);
        const bulb = rec.targets[0];
        d.camera.updateMatrixWorld();
        const ndc = bulb.getWorldPosition(new T.Vector3()).project(d.camera);
        d.setPointer(ndc.x + offsetPx / (innerWidth / 2), ndc.y - (offsetPx * 0.5) / (innerHeight / 2));
        d.step(1);
        d.fire();
        for (let i = 0; i < 40 && !rec.active; i += 1) d.step(1);
        return rec.active;
      };
      const results = { centre: trial(true, 0), near35: trial(true, 35), near35NoAssist: trial(false, 35), far70: trial(true, 70) };
      toggle.checked = true; toggle.dispatchEvent(new Event("change"));
      if (!results.centre) failures.push("a throw straight at a sprinkler bulb missed");
      if (!results.near35) failures.push("aim assist did not help a throw 35 px from a sprinkler bulb");
      if (results.near35NoAssist) failures.push("with aim assist off, a throw 35 px wide still hit (assist not switchable)");
      if (results.far70) failures.push("aim assist grabbed a target 70 px from the crosshair");

      // Case file: run through it in its lane.
      d.resetGame("story"); d.setHealth(1e6);
      d.setCausewayDistance(176); d.setLane(0); d.step(1);
      for (let i = 0; i < 90 && !d.causeway.summary().files.length; i += 1) d.step(1);
      const files = d.causeway.summary().files;
      if (!files.includes(1)) failures.push("running through the case file at 186 m did not collect it");
      return { failures, notes: { ...results, fileCollected: files.includes(1) } };
    });
  },
};
