/** Actual Rooftop integration: real model, movement, shared QTE input and live end screen. */
import path from "node:path";
import { mkdir } from "node:fs/promises";
export const name = "abduction";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [], notes = {};
  const check = (label, value, detail) => { if (!value) failures.push(`${label}: ${JSON.stringify(detail)}`); };
  const dir = path.join(shots, "abduction");
  await mkdir(dir, { recursive: true });
  const shot = async (name) => {
    await page.evaluate(async () => { __dbg.render(); await new Promise(requestAnimationFrame); __dbg.render(); await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
  };
  await page.evaluate(() => {
    __dbg.manual = true;
    window.__ab = {
      get g() { return __dbg.story.getMeltdown(); }, get f() { return this.g._flying; },
      step(n = 1) { __dbg.step(n, 1 / 30); },
      until(fn, max = 600) { let i = 0; while (!fn() && i++ < max) this.step(); if (!fn()) throw new Error(`Timed out: phase=${this.g.phase}, flight=${this.f?.state}, ending=${this.g.roof?.state.ending}`); return true; },
      async ready() {
        const start = performance.now();
        while (performance.now() - start < 180000) {
          this.step();
          if (this.g?.phase === "roof" && __dbg.state === "playing" && !__dbg.loadingScreen.visible) {
            this.step(20); this.g.runner.invulnerable = 999;
            this.g.roof.state.heliAt = 999; // Keep extraction out of the isolated encounter test.
            for (const d of this.g.roof.demolitions ?? []) d.cutaway = false;
            this.f.spawnIn = this.f.attackIn = 999;
            return true;
          }
          await new Promise((r) => setTimeout(r, 30));
        }
        return false;
      },
      async place() {
        const { safeAbductionSpot } = await import("/src/levels/meltdown/flying-zombies.js");
        const m = this.g;
        const p = safeAbductionSpot(m.roof, new __dbg.THREE.Vector3(0, 0, 5));
        m.hero.position.copy(p); m.hero.velocity.set(0,0,0); m.hero.knock.set(0,0,0); m.hero.vy = 0;
        m.avatar.root.position.copy(p); m.avatar.root.rotation.set(0,0,0);
        m.roofView = "top"; m.snapCamera = true; this.step(2);
      },
      attack() {
        const f = this.f;
        this.until(() => this.g.phase === "roof" && !this.g.roof.cutscene && f.state === "idle");
        const a = f.actors.find((a) => a.active && a.state === "circle") ?? f._spawn();
        return f._warn(a);
      },
    };
    __dbg.story.jump("roof");
  });
  const ready = await page.evaluate(() => __ab.ready());
  check("roof ready", ready, ready);
  if (!ready) return { failures, notes };
  await page.evaluate(() => __ab.place());
  const warning = await page.evaluate(() => {
    const g = __ab.g, f = __ab.f;
    const began = __ab.attack(); __ab.step(30);
    return { began, visible: f.marker.visible, target: f.target.toArray(), player: g.hero.position.toArray(), profile: f.attacker.model.userData.character?.profile, sourceProfile: g.roof.assets.get("patient").template.userData.character?.profile, wings: f.attacker.wings.length, breakable: g.roof.breakables.some((b) => f.root.getObjectById(b.id)), max: f.tune.maximum, key: g.difficulty.key, warning: f.tune.warning };
  });
  notes.warning = warning;
  check("existing patient model with wings and no combat registration", warning.profile === warning.sourceProfile && warning.wings === 2 && !warning.breakable, warning);
  check("warning targets the player's current rooftop position", warning.began && warning.visible && Math.abs(warning.target[0] - warning.player[0]) < 0.01 && Math.abs(warning.target[2] - warning.player[2]) < 0.01, warning);
  await shot("01-target-warning");

  const miss = await page.evaluate(() => {
    const g = __ab.g, f = __ab.f;
    g.held.add("KeyD"); __ab.step(30); g.held.clear();
    __ab.until(() => f.state === "idle");
    return { phase: g.phase, parent: g.launcher.rig.parent === g.avatar.shoulder, cooldown: f.attackIn, marker: f.marker.visible };
  });
  notes.miss = miss;
  check("walking out avoids capture and preserves the held gun", miss.phase === "roof" && miss.parent && miss.cooldown > 0 && !miss.marker, miss);

  await page.evaluate(async () => { __ab.step(130); await __ab.place(); __ab.attack(); __ab.until(() => __ab.f.state === "carried"); __ab.step(18); });
  const grab = await page.evaluate(() => {
    const g = __ab.g, f = __ab.f, T = __dbg.THREE;
    const before = g.runner.balls; g._shoot();
    g.camera.updateMatrixWorld(true);
    const face = f._headWorld(f.attacker, new T.Vector3());
    const eye = g.camera.getWorldPosition(new T.Vector3());
    return { phase: g.phase, attached: g.avatar.root.parent === f.attacker.carry, height: g.hero.position.y, inHands: g.launcher.rig.parent === g.camera, body: g.avatar.root.visible, ui: f.reactions === __dbg.story.layer.reactions, prompt: __dbg.story.layer.ui.reactLabel.textContent, ammo: g.runner.balls === before, face: face.clone().project(g.camera).toArray(), close: eye.distanceTo(face), presses: f.tune.presses, limit: f.tune.qte };
  });
  notes.grab = grab;
  check("capture lifts the attached player, seen first person with the launcher in hand", grab.phase === "roofAbduct" && grab.attached && grab.height > 0.5 && grab.inHands && !grab.body && grab.ammo, grab);
  check("existing shared SPACE mash UI", grab.ui && /BREAK FREE.*SPACE/.test(grab.prompt), grab);
  check("the close-up: its face in the middle, above the prompt", grab.close < 2 && Math.abs(grab.face[0]) < 0.4 && grab.face[1] > 0.15 && grab.face[1] < 0.85 && grab.face[2] < 1, grab);
  await shot("02-first-person-struggle");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  const held = await page.evaluate(() => ({ presses: __ab.f.reactions._s.presses, dodge: __ab.g.hero.dodge }));
  await page.keyboard.up("Space");
  check("holding SPACE counts once and does not dodge", held.presses === 1 && held.dodge === 0, held);
  for (let i = 1; i < grab.presses; i++) { await page.keyboard.press("Space"); await page.evaluate(() => __ab.step(2)); }
  await page.evaluate(() => __ab.until(() => __ab.f.fired));
  await shot("03-point-blank-shot");
  const escape = await page.evaluate(() => {
    const f = __ab.f, grabber = f.attacker;
    __ab.until(() => __ab.g.phase === "roof");
    const blasted = grabber.state === "blasted", high = grabber.root.position.y;
    __ab.step(22);
    const g = __ab.g;
    g.runner.balls = 20; const before = g.runner.shots; g._shoot();
    return { phase: g.phase, y: g.hero.position.y, parent: g.avatar.root.parent === g.scene, body: g.avatar.root.visible, onShoulder: g.launcher.rig.parent === g.avatar.shoulder, shooting: g.runner.shots > before, ground: g.roof.groundAt(g.hero.position), blasted, falling: grabber.root.position.y < high || !grabber.active };
  });
  notes.escape = escape;
  check("escape: shot off, landed safely, still armed", escape.phase === "roof" && escape.y === 0 && escape.parent && escape.body && escape.onShoulder && escape.shooting && escape.ground === 0 && escape.blasted && escape.falling, escape);
  await shot("04-escaped-armed");

  // A second grab followed by no input exercises the separate capture death.
  await page.evaluate(async () => { __ab.step(140); await __ab.place(); __ab.attack(); __ab.until(() => __ab.f.bitten); __ab.step(4); });
  await shot("05-bitten");
  const lids = await page.evaluate(() => { __ab.until(() => __ab.f.elapsed >= 1.3); return Number(document.querySelector(".abduction-lids")?.style.opacity ?? -1); });
  notes.lids = lids;
  check("the bite: eyes closing to black", lids > 0.8, lids);
  await page.evaluate(() => { __ab.until(() => __ab.f.state === "sky"); __ab.until(() => __ab.f.skyTime >= 0.6); });
  await shot("05a-initial-sky-ascent");
  await page.evaluate(() => __ab.until(() => __ab.f.skyTime >= 1.2));
  const ascent = await page.evaluate(() => {
    const f = __ab.f, g = __ab.g;
    const cam = g.camera.position.clone(), q = g.camera.quaternion.clone(), y = g.hero.position.y, weatherTime = g.roof.weather.time.value;
    __ab.step(15);
    return { up: g.camera.getWorldDirection(new __dbg.THREE.Vector3()).y, fixed: cam.equals(g.camera.position) && q.equals(g.camera.quaternion), climbing: g.hero.position.y > y, attached: g.avatar.root.parent === f.attacker.carry, falling: !!g._fall?.active, liveWeather: g.roof.weather.time.value > weatherTime };
  });
  notes.ascent = ascent;
  check("failure keeps player attached and climbs past a fixed oblique camera with live weather", ascent.up > 0.1 && ascent.up < 0.35 && ascent.fixed && ascent.climbing && ascent.attached && !ascent.falling && ascent.liveWeather, ascent);
  await shot("05-carried-into-sky");
  await page.evaluate(() => __ab.until(() => __ab.f.gameOverShown));
  const over = await page.evaluate(() => {
    const f = __ab.f, g = __ab.g; __ab.until(() => __dbg.state === "ended");
    const carrier = f.attacker.root.position.clone(), player = g.hero.position.clone(), delay = f.skyTime;
    const wing = f.attacker.wings[0].rotation.y, camera = g.camera.position.clone(), rotation = g.camera.quaternion.clone();
    __ab.step(15);
    return { title: document.querySelector("#endTitle").textContent, active: document.querySelector("#endScreen").classList.contains("active"), delay, fx: __dbg.deathFx.playing, up: g.camera.getWorldDirection(new __dbg.THREE.Vector3()).y, fade: g.fade.value, attached: g.avatar.root.parent === f.attacker.carry, carrierMoving: !carrier.equals(f.attacker.root.position), playerMoving: g.hero.position.y > player.y, wingsMoving: f.attacker.wings[0].rotation.y !== wing, cameraFixed: camera.equals(g.camera.position) && rotation.equals(g.camera.quaternion), flightState: f.state };
  });
  notes.over = over;
  check("existing capture summary appears after 3.5 seconds over the live sky", over.title === "YOU WERE CAPTURED!" && over.active && over.delay >= 3.5 && over.delay < 3.56 && !over.fx && over.up > 0.1 && over.up < 0.35 && over.fade === 0, over);
  check("captured pair and wings continue moving behind Game Over while the camera stays put", over.attached && over.carrierMoving && over.playerMoving && over.wingsMoving && over.cameraFixed && over.flightState === "sky", over);
  await shot("06-capture-game-over-live");
  const heldOver = await page.evaluate(() => {
    const g = __ab.g, cam = g.camera.position.clone(), q = g.camera.quaternion.clone(), weather = g.roof.weather.time.value;
    // Even a pending normal cutaway must not overwrite the final sky camera.
    g.roof.cutscene = { kind: "cutaway", camera: new __dbg.THREE.Vector3(0,99,99), look: new __dbg.THREE.Vector3(), player: g.hero.position.clone() };
    __ab.step(90);
    return { fixed: cam.equals(g.camera.position) && q.equals(g.camera.quaternion), live: g.roof.weather.time.value > weather };
  });
  notes.heldOver = heldOver;
  check("later rooftop cutaways cannot replace the live sky camera behind statistics", heldOver.fixed && heldOver.live, heldOver);
  const restart = await page.evaluate(async () => {
    const old = __ab.f; __dbg.restartRun(); const ready = await __ab.ready();
    const g = __ab.g;
    return { ready, disposed: old.disposed, detachedGroup: old.root.parent === null, weapon: g.launcher.rig.parent === g.avatar.shoulder, controls: !g._flying.controlsPlayer, ui: !__dbg.story.layer.ui.react.classList.contains("show"), y: g.hero.position.y };
  });
  notes.restart = restart;
  check("retry clears old actors/QTE and restores player and gun", restart.ready && restart.disposed && restart.detachedGroup && restart.weapon && restart.controls && restart.ui && restart.y === 0, restart);
  await page.evaluate(async () => { await __ab.place(); __ab.attack(); __ab.until(() => __ab.f.state === "carried"); window.__leavingAbduction = __ab.f; });
  await page.keyboard.press("Escape");
  await page.locator("#quitButton").click();
  const quit = await page.evaluate(() => ({ menu: __dbg.state === "intro", disposed: __leavingAbduction.disposed, detached: __leavingAbduction.root.parent === null, qte: __dbg.story.layer.reactions.running, classLeft: document.body.classList.contains("story-cutscene") }));
  notes.quit = quit;
  check("quitting during the QTE clears actors, input and overlays", quit.menu && quit.disposed && quit.detached && !quit.qte && !quit.classLeft, quit);
  return { failures, notes };
}
