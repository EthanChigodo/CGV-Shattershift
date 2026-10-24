/**
 * The touch controls (src/systems/touch-controls.js), finger by finger: a
 * page with only the controls on it (page.html), real touch events from the
 * browser (a move every 16 ms, as a finger gives them), and what the game
 * would hear - the keys and mouse presses - checked for each gesture.
 *
 *   node tests/touch/run.js
 *   TOUCH_CHROMIUM=/path/to/chrome node tests/touch/run.js
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../foundry/lib/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = await serve(ROOT);
const launch = { args: ["--no-sandbox"] };
if (process.env.TOUCH_CHROMIUM) launch.executablePath = process.env.TOUCH_CHROMIUM;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${server.origin}/tests/touch/page.html`);
await page.waitForFunction(() => window.ready);
const cdp = await ctx.newCDPSession(page);
const T = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y, id = 0]) => ({ x, y, id })) });
const wait = (ms) => page.waitForTimeout(ms);
// A real finger: a move every 16 ms.
const swipe = async (x, y, dx, dy, ms = 110) => { await T("touchStart", [[x, y]]); const n = Math.max(3, Math.round(ms / 16)); for (let i = 1; i <= n; i++) { await T("touchMove", [[x + (dx * i) / n, y + (dy * i) / n]]); await wait(16); } await T("touchEnd", []); };
const tap = async (x, y) => { await T("touchStart", [[x, y]]); await wait(60); await T("touchEnd", []); };
const hold = async (x, y, ms, drag = 0) => { await T("touchStart", [[x, y]]); for (let t = 0; t < ms; t += 32) { await T("touchMove", [[x + (drag * t) / ms, y]]); await wait(32); } await T("touchEnd", []); };
const take = async () => { await wait(250); const l = await page.evaluate(() => { const x = log.slice(); log.length = 0; return x; }); return l.join(" "); };
let fails = 0;
const expect = (name, got, want) => { const ok = want.test(got); if (!ok) fails++; console.log(ok ? "ok  " : "FAIL", name.padEnd(34), got); };
const set = (o) => page.evaluate((o) => Object.assign(window, o), o);

await set({ hostMode: "run", skyline: false });
await swipe(420, 200, -150, 0); expect("run: swipe left = A", await take(), /^down:KeyA up:KeyA$/);
await swipe(420, 200, 150, 0); expect("run: swipe right = D", await take(), /^down:KeyD up:KeyD$/);
await swipe(420, 280, 0, -150); expect("run: swipe up = W (jump)", await take(), /^down:KeyW up:KeyW$/);
await swipe(420, 120, 0, 150); expect("run: swipe down = S (slide)", await take(), /^down:KeyS up:KeyS$/);
await swipe(420, 200, -110, 0, 60); expect("run: short quick swipe", await take(), /^down:KeyA up:KeyA$/);
await tap(500, 150); expect("run: tap = click there", await take(), /^pointerdown:0:500,150 pointerup:0:500,150$/);
await hold(380, 160, 600); expect("run: hold = press held, then up", await take(), /^pointerdown:0:380,160 pointerup:0:380,160$/);
await hold(380, 160, 600, 120); expect("run: hold and drag = aims", await take(), /^pointerdown:0:3\d\d,160 pointerup:0:4\d\d,160$/);
// Two swipes without lifting: left then left again.
await T("touchStart", [[600, 200]]); for (let i = 1; i <= 6; i++) { await T("touchMove", [[600 - i * 15, 200]]); await wait(16); } for (let i = 1; i <= 6; i++) { await T("touchMove", [[510 - i * 15, 200]]); await wait(16); } await T("touchEnd", []);
expect("run: one long swipe = one move", await take(), /^down:KeyA up:KeyA$/);
// Left then right in one stroke: two moves.
await T("touchStart", [[420, 200]]); for (let i = 1; i <= 5; i++) { await T("touchMove", [[420 - i * 15, 200]]); await wait(16); } for (let i = 1; i <= 8; i++) { await T("touchMove", [[345 + i * 15, 200]]); await wait(16); } await T("touchEnd", []);
expect("run: left then right in one stroke", await take(), /^down:KeyA (up:KeyA )?down:KeyD (up:KeyA )?up:KeyD/);
// The Skyline: swipe up jumps (Space) and sprints (W) while the finger stays down; down slides and brakes.
await set({ skyline: true });
await T("touchStart", [[420, 280]]); for (let i = 1; i <= 6; i++) { await T("touchMove", [[420, 280 - i * 25]]); await wait(16); } await wait(1200);
const mid = await page.evaluate(() => log.join(" ")); await T("touchEnd", []);
expect("skyline: swipe up held = jump + sprint", mid + " | " + await take(), /^down:Space down:KeyW up:Space \| .*up:KeyW$/);
await swipe(420, 120, 0, 150); expect("skyline: swipe down = slide + brake", await take(), /^down:ShiftLeft down:KeyS up:ShiftLeft up:KeyS$|^down:ShiftLeft down:KeyS up:KeyS up:ShiftLeft$/);
await set({ skyline: false });
// The wheel and the focus button.
await tap(780, 330); expect("wheel tap = turn the wheel", await take(), /^wheel$/);
// The roof.
await set({ hostMode: "roof" });
await page.waitForTimeout(100);
await T("touchStart", [[150, 250]]); for (let i = 1; i <= 5; i++) { await T("touchMove", [[150, 250 - i * 12]]); await wait(16); } await wait(300);
const st1 = await page.evaluate(() => [log.join(" "), getComputedStyle(document.querySelector(".tc-stick")).display]);
for (let i = 1; i <= 5; i++) { await T("touchMove", [[150 + i * 12, 190]]); await wait(16); } await wait(200);
const st2 = await page.evaluate(() => log.join(" "));
await T("touchEnd", []);
expect("roof: stick up = W held, shown", `${st1[0]} [${st1[1]}]`, /^down:KeyW \[block\]$/);
expect("roof: stick up-right = W + D", st2, /down:KeyW.*down:KeyD/);
expect("roof: stick let go = all up", await take(), /up:KeyW|up:KeyD/);
await hold(640, 150, 500, 60); expect("roof: right side = fire held, aims", await take(), /^pointerdown:0:640,150 pointerup:0:\d+,150$/);
// Stick and fire at once (two fingers).
await T("touchStart", [[150, 250, 0]]); await T("touchMove", [[150, 200, 0]]); await wait(50);
await T("touchStart", [[150, 200, 0], [640, 150, 1]]); await wait(300);
const both = await page.evaluate(() => log.join(" "));
await T("touchEnd", []); await wait(100);
expect("roof: stick + fire together", both, /down:KeyW.*pointerdown:0:640,150/);
await take();
const dodge = await page.evaluate(() => { const b = document.querySelector(".tc-dodge"); const r = b.getBoundingClientRect(); return [getComputedStyle(b).display, r.x + r.width / 2, r.y + r.height / 2]; });
await tap(dodge[1], dodge[2]); expect(`roof: DODGE button (${dodge[0]})`, await take(), /^down:Space up:Space$/);
const focus = await page.evaluate(() => { const b = document.querySelector(".tc-focus"); const r = b.getBoundingClientRect(); return [getComputedStyle(b).display, r.x + r.width / 2, r.y + r.height / 2]; });
await hold(focus[1], focus[2], 300); expect(`roof: FOCUS button (${focus[0]})`, await take(), /^pointerdown:2:\d+,\d+ pointerup:2:\d+,\d+$/);
// A cutscene: the skip button holds Esc.
await set({ hostMode: "cutscene" }); await wait(100);
const skip = await page.evaluate(() => { const b = document.querySelector(".tc-skip"); const r = b.getBoundingClientRect(); return [getComputedStyle(b).display, r.x + r.width / 2, r.y + r.height / 2]; });
await hold(skip[1], skip[2], 400); expect(`cutscene: HOLD TO SKIP (${skip[0]})`, await take(), /^down:Escape up:Escape$/);
await tap(400, 200); expect("cutscene: tap elsewhere = nothing ours", await take(), /^$/);
// Quick-time hits.
await set({ hostMode: "reaction", wantsKeys: { kind: "press", keys: ["PadLUp"], index: -1 } }); await wait(100);
const labels = await page.evaluate(() => [...document.querySelectorAll(".tc-half b")].map((b) => b.textContent).join("|"));
expect("reaction: halves say what to do", labels, /^SWIPE ↑\|$/);
await swipe(200, 280, 0, -150); expect("reaction: swipe up on the left", await take(), /^down:PadLUp up:PadLUp$/);
await swipe(640, 280, 0, -150); expect("reaction: swipe up on the right", await take(), /^down:PadRUp up:PadRUp$/);
await set({ wantsKeys: { kind: "mash", keys: ["PadRT"], index: -1 } }); await wait(100);
await tap(640, 200); await tap(640, 200); expect("reaction: mash taps on the right", await take(), /^down:PadRT up:PadRT down:PadRT up:PadRT$/);
await tap(200, 200); expect("reaction: tap on the left (not wanted)", await take(), /^$/);
await set({ wantsKeys: { kind: "combo", keys: ["PadLUp", "PadRDown"], index: -1 } }); await wait(100);
const labels2 = await page.evaluate(() => [...document.querySelectorAll(".tc-half b")].map((b) => b.textContent).join("|"));
expect("reaction: both halves for a combo", labels2, /^SWIPE ↑\|SWIPE ↓$/);
// Off: nothing caught (the browser's own taps).
await set({ hostMode: "off" }); await wait(100);
await tap(400, 200); expect("off: nothing caught", await take(), /^$/);
if (errors.length) { fails += errors.length; console.log("page errors", errors); }
console.log(fails ? `\n${fails} FAILED` : "\nAll checks passed.");
await browser.close(); await server.close();
process.exit(fails ? 1 : 0);
