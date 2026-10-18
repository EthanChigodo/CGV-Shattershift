/**
 * Controller checks: the game played with a pad alone (src/systems/pad-input.js),
 * on index.html with a pretend pad (fake-pad.js) in place of a real one.
 *
 *   node tests/controllers/run.js            # every check
 *   node tests/controllers/run.js menus      # just the named check(s)
 *
 *   menus    the ring through the menus: activate, back, tabs, sliders;
 *            the glyphs (✕ on a DualSense, A on an Xbox pad, keys again after the mouse)
 *   skyline  aim, throw, Focus, sphere type, quick-time prompts, pause on Options, rumble
 *   foundry  lane changes on the d-pad and the stick, a throw
 *   roof     analog movement, twin-stick aim, holding fire, the dodge
 *
 * Screenshots (the ring, the prompts) go to tests/controllers/shots/.
 * Uses the Level 3 harness's server and browser setup (tests/meltdown/lib.js).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve, launch, openPage } from "../meltdown/lib.js";
import { installFakePad, XBOX } from "./fake-pad.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS = path.join(HERE, "shots");

/** Stepping helpers in the page (the game runs on __dbg.step; the pad on __fakePad.frame). */
function installHelpers() {
  __dbg.manual = true;
  window.__c = {
    step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
    /** Pad and game together, frame by frame. */
    play(n = 1) { for (let i = 0; i < n; i += 1) { __fakePad.frame(); __dbg.step(1, 1 / 30); } },
    async wait(fn, ms = 120000) {
      const t0 = performance.now();
      while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
      return fn();
    },
    active: () => [...document.querySelectorAll(".screen.active")].map((s) => s.id).join(","),
    focus: () => document.activeElement?.id || document.activeElement?.dataset?.tab || document.activeElement?.textContent.trim().slice(0, 24),
    clearScreens() { for (const s of document.querySelectorAll(".screen.active")) s.classList.remove("active"); },
  };
}

/* ---- menus ----------------------------------------------------------------- */

async function menus(page, check) {
  const m = await page.evaluate(() => {
    const out = {};
    const p = __fakePad;
    p.connect();
    p.frame();
    out.toast = document.querySelector("#message").textContent;
    p.tap("down"); // the first press only shows the ring
    out.classes = document.documentElement.className;
    out.boot = __c.focus();
    out.ring = document.querySelector(".pad-focus")?.id;
    p.tap("right");
    out.skip = __c.focus();
    p.tap("cross");
    p.frame();
    out.menu = __c.active();
    out.menuFocus = __c.focus();
    p.tap("down");
    out.down = __c.focus();
    p.tap("cross");
    p.frame();
    out.chapters = __c.active();
    p.tap("circle");
    p.frame();
    out.back = __c.active();
    out.backFocus = __c.focus();
    // The field manual's tabs on R1 / L1.
    // Down to it by name: the menu's order changes as modes are added.
    for (let i = 0; i < 12 && __c.focus() !== "manualButton"; i += 1) p.tap("down");
    out.manualButton = __c.focus();
    p.tap("cross");
    p.frame();
    out.manual = __c.active();
    const selected = () => document.querySelector("#manualScreen [role=tab][aria-selected=true]")?.dataset.tab;
    p.tap("r1");
    out.tabNext = selected();
    p.tap("l1");
    p.tap("l1");
    out.tabWrap = selected();
    p.tap("circle");
    p.frame();
    // Settings: a checkbox, then the aim slider.
    for (let i = 0; i < 12 && __c.focus() !== "settingsButton"; i += 1) p.tap("down");
    out.settingsButton = __c.focus();
    p.tap("cross");
    p.frame();
    out.settings = __c.active();
    const first = document.activeElement;
    const was = first.checked;
    p.tap("cross");
    out.toggled = first.type === "checkbox" && first.checked !== was;
    p.tap("cross");
    for (let i = 0; i < 40 && __c.focus() !== "sensitivitySlider"; i += 1) p.tap("down");
    out.slider = __c.focus();
    const before = Number(document.querySelector("#sensitivitySlider").value);
    p.tap("right");
    out.sliderStep = Number(document.querySelector("#sensitivitySlider").value) - before;
    out.saved = JSON.parse(localStorage.getItem("fractureRunSettings") ?? "{}").sensitivity;
    p.tap("left");
    for (let i = 0; i < 60 && __c.focus() !== "padSensitivitySlider"; i += 1) p.tap("down");
    out.padSlider = __c.focus();
    out.padStatus = document.querySelector("#padStatus").textContent;
    out.padMap = [...document.querySelectorAll("[data-pad-controls] kbd")].slice(0, 8).map((k) => k.textContent);
    return out;
  });
  check("connecting a pad says so", m.toast === "CONTROLLER CONNECTED - DualSense", m.toast);
  check("a pad in use marks <html> (pad-active pad-ps)", /pad-active/.test(m.classes) && /pad-ps/.test(m.classes), m.classes);
  check("the ring starts on the screen's main action", m.boot === "storyBeginButton" && m.ring === "storyBeginButton", `${m.boot} ${m.ring}`);
  check("the d-pad moves it (right)", m.skip === "storySkipToMenuButton", m.skip);
  check("✕ presses: skip to the menu", m.menu === "startScreen" && m.menuFocus === "startButton", `${m.menu} ${m.menuFocus}`);
  check("down, ✕: Chapters", m.down === "chaptersButton" && m.chapters === "chaptersScreen", `${m.down} ${m.chapters}`);
  check("○ goes back, to where the ring was", m.back === "startScreen" && m.backFocus === "chaptersButton", `${m.back} ${m.backFocus}`);
  check("R1 / L1 switch the manual's tabs (round)", m.manual === "manualScreen" && m.tabNext === "m-foundry" && m.tabWrap === "m-roof", JSON.stringify([m.manualButton, m.manual, m.tabNext, m.tabWrap]));
  check("Settings by pad; ✕ ticks a box", m.settings === "settingsScreen" && m.toggled, `${m.settingsButton} ${m.settings} ${m.toggled}`);
  check("left / right move a slider (and it is saved)", m.slider === "sensitivitySlider" && m.sliderStep === 5 && m.saved === 105, `${m.slider} ${m.sliderStep} ${m.saved}`);
  check("Settings > Controller: the pad, its sensitivity, its buttons", m.padSlider === "padSensitivitySlider" && /DualSense/.test(m.padStatus) && m.padMap.includes("✕"), JSON.stringify(m));
  // (The menu's first load may still be up over it: the pad works behind it, the picture waits.)
  await page.waitForFunction(() => __dbg.loadingScreen.root.hidden, null, { timeout: 120000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, "settings-controller.png") });

  // The glyphs: PlayStation, then Xbox, then the keyboard again.
  const g = await page.evaluate((xboxId) => {
    const kbds = (sel) => [...document.querySelectorAll(`${sel} kbd`)].map((k) => k.textContent + (k.classList.contains("pad-dupe") ? "(hidden)" : ""));
    const card = document.querySelector(".pu-card-keys");
    const prose = () => ({
      end: kbds(".end-keys"),
      launch: kbds("#launchControls"),
      skip: kbds(".story-skip"),
      resume: document.querySelector("#resumeButton small").textContent,
      manual: [...document.querySelectorAll("#manualScreen article p")].map((p) => p.textContent).find((t) => /jump \(/.test(t)),
      serum: `${card.querySelector(":scope > kbd").textContent} / keyboard words hidden: ${[...card.querySelectorAll("[data-pad-hide]")].every((s) => getComputedStyle(s).display === "none")}`,
    });
    const ps = prose();
    __fakePad.connect(xboxId, 1);
    __fakePad.tap("cross", 1); // the ring is on a slider: ✕ does nothing there
    const xbox = { classes: document.documentElement.className, ...prose() };
    return { ps, xbox };
  }, XBOX);
  check("PlayStation glyphs: the end screen's R and Esc", g.ps.end.join() === "✕,Options", g.ps.end.join());
  check("...the launch controls (A D -> one stick, Mouse -> R-stick, RMB -> L2)", g.ps.launch.join().replace(/‑/g, "-") === "L-stick,L-stick(hidden),R-stick,L-stick,L-stick(hidden),L1,R1,L2", g.ps.launch.join());
  check("...hold Options to skip", g.ps.skip.join() === "Options", g.ps.skip.join());
  check("...prose: 'Or press Esc', the manual's '(Space or W)'", g.ps.resume === "Or press Options" && /\(✕ or up\)/.test(g.ps.manual), `${g.ps.resume} | ${g.ps.manual}`);
  check("...the serum card: just ✕", g.ps.serum === "✕ / keyboard words hidden: true", g.ps.serum);
  check("Xbox glyphs on an Xbox pad", /pad-xbox/.test(g.xbox.classes) && g.xbox.end.join() === "A,Menu" && g.xbox.skip.join() === "Menu", JSON.stringify(g.xbox));

  await page.mouse.move(300, 300);
  await page.mouse.move(340, 320);
  const k = await page.evaluate(() => ({
    classes: document.documentElement.className,
    end: [...document.querySelectorAll(".end-keys kbd")].map((x) => x.textContent).join(),
    launch: [...document.querySelectorAll("#launchControls kbd")].map((x) => x.textContent).join(),
    dupes: document.querySelectorAll(".pad-dupe").length,
    resume: document.querySelector("#resumeButton small").textContent,
  }));
  check("the mouse takes over: keys again", !/pad-active/.test(k.classes) && k.end === "R,Esc" && k.launch === "A,D,MOUSE,W,S,Q,E,RMB" && !k.dupes && k.resume === "Or press Esc", JSON.stringify(k));
}

/* ---- skyline ---------------------------------------------------------------- */

async function skyline(page, check) {
  const s = await page.evaluate(async () => {
    const out = {};
    const p = __fakePad;
    __c.clearScreens();
    __dbg.startEndless("skyline");
    __c.step(20);
    p.connect();
    // Aim right with the stick: the crosshair goes right.
    const x0 = parseFloat(document.querySelector("#reticle").style.left) || innerWidth / 2;
    p.axes(0, 0, 1, 0);
    __c.play(12);
    p.axes(0, 0, 0, 0);
    __c.play(1);
    out.aimed = (parseFloat(document.querySelector("#reticle").style.left) || 0) - x0;
    out.device = document.documentElement.className;
    // R2: a throw.
    const shots = __dbg.run.shots;
    p.tap("r2");
    __c.step(4);
    out.thrown = __dbg.run.shots - shots;
    out.flying = __dbg.projectiles.length;
    // L2 held: Focus.
    p.set("l2", true);
    p.frame();
    out.focus = __dbg.run.focusing;
    p.set("l2", false);
    p.frame();
    out.focusOff = !__dbg.run.focusing;
    // R1: the next sphere.
    const ball = __dbg.arsenal.ball;
    p.tap("r1");
    out.ball = [ball, __dbg.arsenal.ball];
    p.tap("l1");
    // A glass break is felt. (After a moment: the throw above may have broken
    // a pane already, and glass rumbles at most every 60 ms.)
    await new Promise((resolve) => setTimeout(resolve, 150));
    const fx = p.get().vibrationActuator.effects.length;
    const pane = __dbg.aliveTargets().find((t) => t.userData.kind === "pane" && t.userData.alive !== false);
    if (pane) __dbg.shatter(pane, {});
    out.rumble = p.get().vibrationActuator.effects.length - fx;
    return out;
  });
  check("the right stick aims (the crosshair moves)", s.aimed > 60, `${s.aimed}px`);
  check("R2 throws", s.thrown >= 1 && s.flying >= 1, JSON.stringify(s));
  check("L2 holds Focus", s.focus && s.focusOff, `${s.focus} ${s.focusOff}`);
  check("R1 changes the sphere", s.ball[0] !== s.ball[1], s.ball.join(" -> "));
  check("glass breaking rumbles the pad", s.rumble >= 1, String(s.rumble));

  // Quick-time prompts: the button drawn is the button that answers.
  const r = await page.evaluate(() => {
    const out = {};
    const p = __fakePad;
    const R = __dbg.story.layer.reactions;
    const glyphs = () => [...document.querySelectorAll(".story-react .story-key b")].map((b) => b.textContent);
    __dbg.story.layer.ui.show();
    R.start({ kind: "press", keys: ["KeyR"], window: 30 });
    out.press = glyphs();
    p.tap("triangle");
    out.pressState = R.state;
    R.start({ kind: "combo", keys: ["KeyF", "KeyT"], window: 30 });
    out.combo = glyphs();
    p.set("square", true);
    p.set("r1", true);
    p.frame();
    p.set("square", false);
    p.set("r1", false);
    p.frame();
    out.comboState = R.state;
    R.start({ kind: "press", keys: ["KeyR"], window: 30 });
    p.tap("cross");
    out.wrong = `${R.state} ${R.failReason}`;
    R.start({ kind: "mash", keys: ["Space"], time: 30, gain: 0.1, decay: 0 });
    out.mashLabel = document.querySelector(".story-react .label").textContent;
    for (let i = 0; i < 12 && R.state === "running"; i += 1) p.tap("cross");
    out.mashState = R.state;
    R.start({ kind: "sequence", keys: ["KeyZ", "KeyX"], window: 30, label: "GRAB" });
    out.sequence = glyphs();
    __dbg.render();
    return out;
  });
  await page.screenshot({ path: path.join(SHOTS, "prompt-ps.png") });
  const r2 = await page.evaluate(() => {
    const p = __fakePad;
    const R = __dbg.story.layer.reactions;
    p.tap("cross");
    p.tap("circle");
    const state = R.state;
    __dbg.story.layer.ui.hideReaction();
    return { state };
  });
  check("prompt: R is △ on a DualSense, and △ answers it", r.press.join() === "△" && r.pressState === "success", `${r.press} ${r.pressState}`);
  check("prompt: F + T is □ + R1, both pressed", r.combo.join() === "□,R1" && r.comboState === "success", `${r.combo} ${r.comboState}`);
  check("prompt: another face button is a wrong key", r.wrong === "fail wrong key", r.wrong);
  check("prompt: 'TAP SPACE FAST' is 'TAP ✕ FAST', and ✕ fills it", /TAP ✕ FAST/.test(r.mashLabel) && r.mashState === "success", `${r.mashLabel} ${r.mashState}`);
  check("prompt: a sequence in order (✕ then ○)", r.sequence.join() === "✕,○" && r2.state === "success", `${r.sequence} ${r2.state}`);

  // Options pauses; ✕ on Resume resumes; R1 the tabs; ○ resumes too.
  const pause = await page.evaluate(async () => {
    const out = {};
    const p = __fakePad;
    p.tap("options");
    out.paused = __dbg.paused;
    out.screen = __c.active();
    out.focus = __c.focus();
    // (The moves list was just written: its key names are swapped at the next microtask, before any paint.)
    await null;
    out.moves = [...document.querySelectorAll("[data-moves] kbd")].map((k) => k.textContent).filter((t, i, a) => a.indexOf(t) === i);
    __dbg.render();
    return out;
  });
  await page.screenshot({ path: path.join(SHOTS, "pause-ps.png") });
  const resume = await page.evaluate(() => {
    const out = {};
    const p = __fakePad;
    p.tap("cross");
    p.frame();
    out.resumed = !__dbg.paused;
    p.tap("options");
    p.tap("r1");
    out.tab = document.querySelector("#pauseScreen [role=tab][aria-selected=true]")?.dataset.tab;
    p.tap("circle");
    p.frame();
    out.closed = !__dbg.paused && !__c.active();
    return out;
  });
  check("Options pauses, the ring on Resume", pause.paused && pause.screen === "pauseScreen" && pause.focus === "resumeButton", JSON.stringify(pause));
  check("the pause menu's moves name the pad's buttons", ["✕", "○", "R2", "L2", "L1", "R1", "Options"].every((g) => pause.moves.includes(g)), pause.moves.join(" "));
  check("✕ on Resume resumes; R1 a tab; ○ closes the pause", resume.resumed && resume.tab === "spheres" && resume.closed, JSON.stringify(resume));
}

/* ---- foundry ---------------------------------------------------------------- */

async function foundry(page, check) {
  const f = await page.evaluate(async () => {
    const out = {};
    const p = __fakePad;
    __c.clearScreens();
    __dbg.startEndless("foundry");
    out.ready = await __c.wait(() => __dbg.state === "playing" && !!__dbg.foundry, 240000);
    __c.step(10);
    p.connect();
    const x0 = __dbg.playerX;
    p.tap("left");
    __c.step(25);
    out.left = [x0, __dbg.playerX];
    // The stick: a flick right, back to the middle lane.
    p.axes(0.95, 0.1, 0, 0);
    __c.play(1);
    p.axes(0, 0, 0, 0);
    __c.play(25);
    out.right = __dbg.playerX;
    // Held: one lane, then a repeat.
    p.axes(1, 0, 0, 0);
    __c.play(1);
    const one = __dbg.playerX;
    __c.play(14);
    p.axes(0, 0, 0, 0);
    __c.play(25);
    out.held = [one, __dbg.playerX];
    const shots = __dbg.run.shots;
    p.tap("r2");
    __c.step(15);
    out.thrown = __dbg.run.shots - shots;
    return out;
  });
  check("the Foundry starts", f.ready, JSON.stringify(f));
  check("d-pad left: one lane left", Math.abs(f.left[0]) < 0.3 && f.left[1] < -2.8, f.left.join(" -> "));
  check("a flick of the stick: one lane right", Math.abs(f.right) < 0.3, String(f.right));
  check("the stick held right: across, then held at the edge", f.held[1] > 2.8, f.held.join(" -> "));
  check("R2 throws by hand", f.thrown >= 1, String(f.thrown));
}

/* ---- roof ------------------------------------------------------------------- */

async function roof(page, check) {
  const r = await page.evaluate(async () => {
    const out = {};
    const p = __fakePad;
    __c.clearScreens();
    __dbg.startEndless("roof");
    const m = () => __dbg.meltdown;
    out.ready = await __c.wait(() => m()?.phase === "roof" && __dbg.state === "playing", 400000);
    if (!out.ready) return out;
    const hero = m().hero;
    const safe = () => { m().runner.invulnerable = 999; m().runner.vitality = 100; };
    safe();
    p.connect();
    // Walk right and a little up the screen, at half tilt: analog.
    const from = hero.position.clone();
    p.axes(0.5, -0.25, 0, 0);
    for (let i = 0; i < 30; i += 1) { safe(); __c.play(1); }
    const walked = hero.position.clone().sub(from);
    out.walk = [walked.x, walked.z];
    out.halfSpeed = hero.velocity.length();
    p.axes(1, 0, 0, 0);
    for (let i = 0; i < 20; i += 1) { safe(); __c.play(1); }
    out.fullSpeed = hero.velocity.length();
    p.axes(0, 0, 0, 0);
    for (let i = 0; i < 15; i += 1) { safe(); __c.play(1); }
    out.stopped = hero.velocity.length();
    // Aim to the left with the right stick: the hero turns that way.
    p.axes(0, 0, -1, 0);
    for (let i = 0; i < 10; i += 1) { safe(); __c.play(1); }
    out.aim = hero.aim.x - hero.position.x;
    // Hold R2: the launcher keeps firing.
    const shots = m().runner.shots;
    p.set("r2", true);
    for (let i = 0; i < 30; i += 1) { safe(); __c.play(1); }
    p.set("r2", false);
    __c.play(1);
    out.fired = m().runner.shots - shots;
    out.firing = m().runner.firing;
    p.axes(0, 0, 0, 0);
    // ✕: a dodge.
    p.set("cross", true);
    __c.play(1);
    out.dodge = hero.dodge;
    p.set("cross", false);
    __c.play(1);
    __dbg.render();
    return out;
  });
  check("the roof starts", r.ready, JSON.stringify(r));
  if (!r.ready) return;
  check("the left stick walks the roof (right and up the screen)", r.walk[0] > 1 && r.walk[1] < -0.3, r.walk.map((v) => v.toFixed(2)).join(", "));
  check("...analog: half a push walks slower than a full one", r.halfSpeed > 0.5 && r.halfSpeed < r.fullSpeed * 0.75 && r.stopped < 0.3, `${r.halfSpeed.toFixed(2)} ${r.fullSpeed.toFixed(2)} ${r.stopped.toFixed(2)}`);
  check("the right stick aims (twin-stick)", r.aim < -3, r.aim.toFixed(2));
  check("R2 held fires, let go stops", r.fired >= 3 && !r.firing, `${r.fired} ${r.firing}`);
  check("✕ dodges", r.dodge > 0, String(r.dodge));
  await page.screenshot({ path: path.join(SHOTS, "roof-pad.png") });
}

const ALL = { menus, skyline, foundry, roof };

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  await mkdir(SHOTS, { recursive: true });
  const only = process.argv.slice(2);
  const names = only.length ? Object.keys(ALL).filter((n) => only.includes(n)) : Object.keys(ALL);
  const server = await serve(ROOT);
  console.log(`serving ${ROOT}\n`);
  const browser = await launch(chromium);
  const errors = [];
  let failed = 0;

  for (const name of names) {
    process.stdout.write(`${name} ... `);
    // The game's whole post chain in software GL: a small frame keeps it affordable.
    const tab = await openPage(browser, { width: 960, height: 540 });
    const page = tab.page;
    page.setDefaultTimeout(600000);
    await page.addInitScript(installFakePad);
    await page.addInitScript(() => {
      localStorage.setItem("fractureRun.serumsSeen", JSON.stringify(["prism", "thermal", "shield", "overdrive", "infinite", "restore"]));
    });
    const failures = [];
    const check = (label, ok, detail = "") => {
      if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
    };
    try {
      await page.goto(`${server.origin}/index.html`, { waitUntil: "load", timeout: 180000 });
      await page.waitForFunction(() => globalThis.__dbg?.story && document.querySelector(".screen.active"), null, { timeout: 180000 });
      await page.evaluate(installHelpers);
      await ALL[name](page, check);
      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL (${failures.length})`);
        for (const f of failures) console.log(`  x ${f}`);
      } else console.log("ok");
    } catch (error) {
      failed += 1;
      console.log("ERROR");
      console.log(`  x ${error.message}`);
    }
    errors.push(...tab.errors);
    await page.close();
  }

  await browser.close();
  await server.close();
  const real = errors.filter((e) => !/toNonIndexed/.test(e));
  if (real.length) {
    console.log(`\npage errors (${real.length}):`);
    for (const e of real.slice(0, 10)) console.log(`  ${e}`);
    failed += real.length;
  }
  console.log(failed ? `\n${failed} problem(s).` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
