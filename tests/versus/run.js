/**
 * Versus (Rooftop Showdown) checks, on the real game (index.html).
 *
 *   node tests/versus/run.js            # the checks, screenshots in tests/versus/shots/
 *
 * Two controllers are faked in the page (navigator.getGamepads returns two
 * "standard" pads whose sticks and buttons the checks set), and the game is
 * stepped by hand (__dbg.manual / __dbg.step) - software GL is far too slow to
 * play in real time. What is proved:
 *
 *   - the menu's Versus button opens the lobby; each pad joins with cross,
 *     shows as its device, and readies up; the match starts by itself
 *   - the match draws split screen: two side-by-side viewports, each half the
 *     canvas, with the scissor test on
 *   - the two players move and fire independently (each pad drives its own)
 *   - a sphere from one player hits the other (integrity down, the hit counted)
 *   - shock on the ladder knocks a climber off; climbing to the top wins the round
 *   - winning enough rounds ends the match on the winner's screen
 *   - quitting puts the single-player game back: the menu, a full-screen
 *     viewport and no scissor, the input flag down
 *   - a keyboard can join too (F: keyboard and mouse)
 *
 * Uses the Level 3 harness's server and browser (tests/meltdown/lib.js); set
 * MELTDOWN_CHROMIUM to a Chromium binary if Playwright's own is not installed.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve, launch, openPage } from "../meltdown/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS = path.join(HERE, "shots");

/** Two fake pads, an Xbox and a DualSense, driven from the checks. */
function fakePads() {
  const BUTTONS = ["cross", "circle", "square", "triangle", "l1", "r1", "l2", "r2", "share", "options", "l3", "r3", "up", "down", "left", "right", "home"];
  const pad = (index, id) => ({
    id, index, connected: true, mapping: "standard", timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: BUTTONS.map(() => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: null,
  });
  const pads = [
    pad(0, "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"),
    pad(1, "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"),
  ];
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
  window.__pads = {
    pads,
    set(n, name, down) {
      const b = pads[n].buttons[BUTTONS.indexOf(name)];
      b.pressed = down;
      b.value = down ? 1 : 0;
    },
    stick(n, which, x, y) {
      const i = which === "left" ? 0 : 2;
      pads[n].axes[i] = x;
      pads[n].axes[i + 1] = y;
    },
  };
  // The checks' players have seen every serum card already.
  localStorage.setItem("fractureRun.serumsSeen", JSON.stringify(["prism", "thermal", "shield", "overdrive", "infinite", "restore"]));
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  await mkdir(SHOTS, { recursive: true });
  const server = await serve(ROOT);
  const browser = await launch(chromium);
  const { page, errors } = await openPage(browser, { width: 960, height: 540 });
  page.setDefaultTimeout(240000);
  await page.addInitScript(fakePads);
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail && !ok ? `  (${detail})` : ""}`);
    if (!ok) failures.push(label);
  };
  const shot = async (name) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: "jpeg", quality: 78 });
  };

  try {
    await page.goto(`${server.origin}/index.html`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => globalThis.__dbg?.versus, null, { timeout: 180000 });
    // Off the opening screen to the menu, the game's own clock stopped.
    await page.waitForFunction(() => !document.querySelector(".loading-screen.show, .loading-screen:not([hidden])") || true);
    await page.evaluate(() => {
      __dbg.manual = true;
      window.__t = {
        step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
        tap(n, name) { __pads.set(n, name, true); this.step(1); __pads.set(n, name, false); this.step(1); },
        get v() { return __dbg.versus; },
        get m() { return __dbg.versus.match; },
        get s() { return __dbg.versus.state; },
      };
    });
    await page.evaluate(() => document.querySelector("#storySkipToMenuButton")?.click());
    await page.waitForFunction(() => document.querySelector("#startScreen")?.classList.contains("active"), null, { timeout: 120000 });

    // ---- The lobby ------------------------------------------------------------
    await page.evaluate(() => document.querySelector("#versusButton").click());
    const lobby = await page.evaluate(async () => {
      const opened = __t.v.active && __t.v.lobby.isOpen;
      const { versusActive } = await import("/src/versus/active.js");
      __t.step(2);
      __t.tap(0, "cross");
      __t.tap(1, "cross");
      const joined = __t.s.lobby.slots.map((s) => s?.device ?? null);
      const devices = [...document.querySelectorAll(".vs-slot-device")].map((n) => n.textContent.trim());
      __t.tap(1, "right");
      return { opened, flag: versusActive, joined, devices, character2: __t.s.lobby.slots[1]?.character };
    });
    check("the Versus button opens the lobby and raises the input flag", lobby.opened && lobby.flag, JSON.stringify(lobby));
    check("both pads join, one slot each", lobby.joined[0] === "pad:0" && lobby.joined[1] === "pad:1", JSON.stringify(lobby.joined));
    check("each slot shows its device", /xbox/i.test(lobby.devices[0] ?? "") && /playstation/i.test(lobby.devices[1] ?? ""), JSON.stringify(lobby.devices));
    await shot("01-lobby");

    // Ready up: the countdown starts the match by itself.
    const started = await page.evaluate(async () => {
      __t.tap(0, "cross");
      __t.tap(1, "cross");
      const ready = __t.s.lobby?.slots.every((s) => s?.ready);
      for (let i = 0; i < 140 && __t.v.lobby.isOpen; i += 1) __t.step(1);
      const t0 = performance.now();
      while (!__t.v.running && performance.now() - t0 < 200000) {
        await new Promise((r) => setTimeout(r, 200));
        __t.step(1);
      }
      return { ready, running: __t.v.running, phase: __t.m?.phase };
    });
    check("both ready: the match starts", started.ready && started.running && started.phase === "intro", JSON.stringify(started));

    // ---- Split screen -----------------------------------------------------------
    await page.evaluate(() => __t.step(30));
    await shot("02-round-intro");
    const split = await page.evaluate(() => {
      __dbg.render();
      const views = __t.m.split.lastViews;
      const size = __dbg.renderer.getSize(new __dbg.THREE.Vector2());
      return { views, size: [size.x, size.y], after: __dbg.renderer.getScissorTest() };
    });
    const [v1, v2] = split.views;
    check("two views, side by side, each half the canvas, scissored",
      split.views.length === 2 && v1.scissor && v2.scissor && v1.x === 0 && v2.x > v1.w - 1 && Math.abs(v1.w - split.size[0] / 2) < 4 && v1.h === split.size[1],
      JSON.stringify(split));
    check("the renderer is left without the scissor after the frame", split.after === false);

    // ---- Moving and firing, independently ------------------------------------------
    const move = await page.evaluate(() => {
      __t.step(80); // through the intro
      const before = __t.s.match.players.map((p) => [p.x, p.z]);
      __pads.stick(0, "left", 1, 0); // P1 right
      __pads.stick(1, "left", 0, -1); // P2 up (north)
      __t.step(20);
      __pads.stick(0, "left", 0, 0);
      __pads.stick(1, "left", 0, 0);
      __t.step(4);
      const after = __t.s.match.players.map((p) => [p.x, p.z]);
      return { phase: __t.m.phase, before, after };
    });
    const dx1 = move.after[0][0] - move.before[0][0];
    const dz1 = move.after[0][1] - move.before[0][1];
    const dx2 = move.after[1][0] - move.before[1][0];
    const dz2 = move.after[1][1] - move.before[1][1];
    check("pad 1 moves P1 (east) and only P1", move.phase === "fight" && dx1 > 1.5 && Math.abs(dz1) < 0.6, JSON.stringify(move));
    check("pad 2 moves P2 (north) and only P2", dz2 < -1.5 && Math.abs(dx2) < 0.6, JSON.stringify(move));

    const fire = await page.evaluate(() => {
      const shots = () => __t.m.players.map((p) => p.stats.shots);
      const a = shots();
      __pads.set(0, "r2", true);
      __t.step(10);
      __pads.set(0, "r2", false);
      const b = shots();
      __pads.set(1, "r2", true);
      __t.step(4);
      __pads.set(1, "r2", false);
      const c = shots();
      return { a, b, c };
    });
    check("R2 on pad 1 fires for P1 alone", fire.b[0] > fire.a[0] && fire.b[1] === fire.a[1], JSON.stringify(fire));
    check("R2 on pad 2 fires for P2 alone", fire.c[1] > fire.b[1] && fire.c[0] === fire.b[0], JSON.stringify(fire));
    await shot("03-split-gameplay");

    // ---- Hitting the rival -------------------------------------------------------------
    const hit = await page.evaluate(() => {
      const m = __t.m;
      const [p1, p2] = m.players;
      // Face to face across open roof, P1 aiming straight at P2.
      p1.position.set(-4, 0, 3);
      p2.position.set(4, 0, 3);
      p1.invulnerable = p2.invulnerable = 0;
      p1.arsenal.select("glass");
      p1.spheres = 20;
      const before = { integrity: p2.integrity, hits: p1.stats.rivalHits };
      __pads.stick(0, "right", 1, 0);
      __pads.set(0, "r2", true);
      for (let i = 0; i < 40 && p1.stats.rivalHits === before.hits; i += 1) {
        p1.position.set(-4, 0, 3);
        p2.position.set(4, 0, 3);
        __t.step(1);
      }
      __pads.set(0, "r2", false);
      __pads.stick(0, "right", 0, 0);
      return { before, after: { integrity: p2.integrity, hits: p1.stats.rivalHits }, feed: p2.feed.map((f) => f.text) };
    });
    check("a sphere from P1 hits P2", hit.after.hits > hit.before.hits && hit.after.integrity < hit.before.integrity, JSON.stringify(hit));

    // ---- The ladder ------------------------------------------------------------------------
    const ladder = await page.evaluate(() => {
      const m = __t.m;
      const roof = m.roof;
      // Bring the helicopter in now, to the east ledge.
      roof.callHelicopter(1);
      roof.heliLeft = 0.05;
      for (let i = 0; i < 120 && !roof.ladderReady; i += 1) __t.step(1);
      const [p1, p2] = m.players;
      for (const e of roof.enemies) if (e.alive) roof.breakTarget(e.hurt, 99);
      const foot = roof.ladderPoint(0);
      p1.position.set(foot.x - 3, 0, foot.z);
      p1.state = "alive";
      p1.invulnerable = 0;
      __t.step(1);
      const canReach = roof.canReachLadder(p1.position);
      __t.tap(0, "cross"); // jump for it
      __t.step(20);
      const onLadder = p1.state;
      for (let i = 0; i < 5; i += 1) __t.tap(0, "cross");
      const climbed = p1.ladder.h;
      return { ready: roof.ladderReady, side: roof.heliSide, canReach, onLadder, climbed };
    });
    check("the helicopter holds off the ledge with the ladder ready", ladder.ready && ladder.side === 1, JSON.stringify(ladder));
    check("P1 jumps for the ladder from the ledge", ladder.canReach && ladder.onLadder === "ladder", JSON.stringify(ladder));
    check("mashing cross climbs", ladder.climbed > 1, JSON.stringify(ladder));
    // P2 at the ledge, shooting up at the climber: the ladder fight.
    await page.evaluate(() => {
      const [p1, p2] = __t.m.players;
      const foot = __t.m.roof.ladderPoint(0);
      p2.position.set(foot.x - 7, 0, foot.z + 2.5);
      p2.state = "alive";
      p2.invulnerable = 0;
      p2.arsenal.select("shock");
      p2.spheres = 30;
      __pads.stick(1, "right", 1, -0.3); // a pad's y axis is down-positive: up and right
      __t.step(3);
    });
    await shot("04-ladder-fight");
    const knock = await page.evaluate(() => {
      const [p1, p2] = __t.m.players;
      __pads.set(1, "r2", true);
      for (let i = 0; i < 60 && p1.state === "ladder"; i += 1) {
        const foot = __t.m.roof.ladderPoint(0);
        p2.position.set(foot.x - 7, 0, foot.z + 2.5);
        __t.step(1);
      }
      __pads.set(1, "r2", false);
      __pads.stick(1, "right", 0, 0);
      return { state: p1.state, knockOffs: p2.stats.knockOffs, ladder: __t.s.match.ladder };
    });
    check("shock from P2 knocks P1 off the ladder", knock.state === "falling" && knock.knockOffs === 1 && !knock.ladder, JSON.stringify(knock));

    const won = await page.evaluate(() => {
      const m = __t.m;
      const [p1, p2] = m.players;
      for (let i = 0; i < 160 && p1.state !== "alive"; i += 1) __t.step(1); // P1 back at the lift
      // P2 climbs all the way.
      const foot = m.roof.ladderPoint(0);
      p2.position.set(foot.x - 3, 0, foot.z);
      p2.state = "alive";
      __t.step(1);
      __t.tap(1, "cross");
      __t.step(20);
      for (let i = 0; i < 40 && m.phase === "fight"; i += 1) __t.tap(1, "cross");
      return { phase: m.phase, winner: m.roundWinner?.index, wins: m.players.map((p) => p.stats.roundsWon), respawned: p1.state };
    });
    check("P1 respawns after the fall", won.respawned === "alive", JSON.stringify(won));
    check("climbing to the top wins the round", won.phase === "outro" && won.winner === 1 && won.wins[1] === 1, JSON.stringify(won));
    await page.evaluate(() => __t.step(45));
    await shot("05-round-won");

    // ---- To the end of the match ------------------------------------------------------------------
    const over = await page.evaluate(() => {
      const m = __t.m;
      for (let i = 0; i < 400 && m.phase !== "fight"; i += 1) __t.step(1); // the next round's intro
      const round = m.round;
      m.roof.callHelicopter(-1);
      m.roof.heliLeft = 0.05;
      for (let i = 0; i < 120 && !m.roof.ladderReady; i += 1) __t.step(1);
      const p2 = m.players[1];
      const foot = m.roof.ladderPoint(0);
      p2.position.set(foot.x + 3, 0, foot.z);
      p2.invulnerable = 0;
      __t.step(1);
      __t.tap(1, "cross");
      __t.step(20);
      for (let i = 0; i < 40 && m.phase === "fight"; i += 1) __t.tap(1, "cross");
      for (let i = 0; i < 400 && m.phase !== "over"; i += 1) __t.step(1);
      __t.step(30);
      return {
        round, phase: m.phase, winner: m.matchWinner?.index, side: m.roof.heliSide,
        card: !document.querySelector(".vs-winner").hidden, title: document.querySelector(".vs-winner-title")?.textContent,
        rows: document.querySelectorAll(".vs-stats tbody tr").length, layout: m.split.layout,
      };
    });
    check("round two is played (west ledge this time)", over.round === 2 && over.side === -1, JSON.stringify(over));
    check("two rounds won: the match ends on the winner's screen", over.phase === "over" && over.winner === 1 && over.card && /P2/.test(over.title ?? "") && over.rows >= 6, JSON.stringify(over));
    await shot("06-winner");

    // ---- Back to the menu --------------------------------------------------------------------------
    const quit = await page.evaluate(async () => {
      __t.tap(0, "circle");
      __t.step(2);
      __dbg.render();
      const r = __dbg.renderer;
      const vp = r.getViewport(new __dbg.THREE.Vector4());
      const size = r.getSize(new __dbg.THREE.Vector2());
      const { versusActive } = await import("/src/versus/active.js");
      return {
        active: __t.v.active, running: __t.v.running, flag: versusActive, menu: document.querySelector("#startScreen").classList.contains("active"),
        viewport: [vp.x, vp.y, vp.z, vp.w], size: [size.x, size.y], scissor: r.getScissorTest(), hud: document.querySelector(".vs-hud").hidden,
      };
    });
    check("quitting returns to the main menu with the input flag down", !quit.active && !quit.running && !quit.flag && quit.menu, JSON.stringify(quit));
    check("single-player rendering is back: full-screen viewport, no scissor", quit.viewport[0] === 0 && quit.viewport[1] === 0 && quit.viewport[2] === quit.size[0] && quit.viewport[3] === quit.size[1] && !quit.scissor && quit.hud, JSON.stringify(quit));

    // ---- A keyboard joins too ----------------------------------------------------------------------
    await page.evaluate(() => document.querySelector("#versusButton").click());
    await page.evaluate(() => __t.step(2));
    await page.keyboard.press("KeyF");
    const keys = await page.evaluate(() => {
      __t.step(2);
      const slots = __t.s.lobby.slots.map((s) => s?.device ?? null);
      return { slots };
    });
    check("F on the keyboard joins as keyboard and mouse", keys.slots.includes("keys-left"), JSON.stringify(keys));
    await page.keyboard.press("Escape");
    const left = await page.evaluate(() => { __t.step(2); return { active: __t.v.active, menu: document.querySelector("#startScreen").classList.contains("active") }; });
    check("Esc leaves the lobby for the menu", !left.active && left.menu, JSON.stringify(left));
  } catch (error) {
    failures.push(error.message);
    console.log(`ERROR ${error.message}`);
  }

  const real = errors.filter((e) => !/toNonIndexed|favicon/.test(e));
  if (real.length) {
    console.log(`page errors (${real.length}):`);
    for (const e of real.slice(0, 10)) console.log(`  ${e}`);
  }
  for (const [k, v] of Object.entries(notes)) console.log(`  · ${k}: ${JSON.stringify(v)}`);
  await browser.close();
  await server.close();
  const failed = failures.length + real.length;
  console.log(failed ? `\n${failed} problem(s).` : "\nAll versus checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
