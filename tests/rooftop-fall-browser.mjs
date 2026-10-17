/** Optional native Chromium WebGL smoke test. Node 24, installed Edge/Chrome;
 * no dependency installs. node tests/rooftop-fall-browser.mjs [--shots]
 * ROOF_FALL_CHROMIUM overrides the Windows Edge path. Isolated temporary profile.
 */
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
const root = fileURLToPath(new URL("../", import.meta.url));
const shots = process.argv.includes("--shots");
const temporary = await mkdtemp(path.join(os.tmpdir(), "fracture-roof-fall-"));
const profile = path.join(temporary, "profile");
const errors = [];
const html = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/lib/three/build/three.module.js","three/addons/":"/lib/three/examples/jsm/"}}</script><link rel="stylesheet" href="/styles.css"></head><body><canvas id="game"></canvas><script type="module">
import * as T from '/src/three.js'; import {MeltdownGame} from '/src/levels/meltdown/game.js';
const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:false});
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;
const game=new MeltdownGame({renderer,assetBase:new URL('/assets/meltdown/',location.href).href,audio:true,summary:true});
globalThis.roofTest={game,renderer,T}; game.show(); await game.enterRoof(); game.begin();
for(let i=0;i<80;i++) game.update(.05,i*.05); game.render(); globalThis.roofReady=true;
</script></body></html>`;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__roof-fall-test") return res.writeHead(200, { "content-type": "text/html" }).end(html);
    if (url.pathname === "/favicon.ico") return res.writeHead(204).end();
    const target = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (!target.startsWith(path.resolve(root) + path.sep)) return res.writeHead(403).end();
    const body = await readFile(target);
    res.writeHead(200, { "content-type": types[path.extname(target)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const portServer = net.createServer();
await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, socket, call;
try {
  const exe = process.env.ROOF_FALL_CHROMIUM ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  browser = spawn(exe, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=960,640", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let launchError; browser.on("error", e => { launchError = e; });
  let tab;
  for (let i = 0; i < 100 && !tab; i++) {
    if (launchError) throw launchError;
    try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page"); } catch {}
    if (!tab) await delay(200);
  }
  assert.ok(tab, "Chromium debugging endpoint unavailable");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let serial = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data), p = pending.get(m.id);
    if (p) { clearTimeout(p.timeout); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
  });
  socket.addEventListener("close", () => { for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(Error("Browser closed")); } pending.clear(); });
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 120000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await call("Runtime.enable"); await call("Log.enable"); await call("Page.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/__roof-fall-test` });
  for (let i = 0; i < 180 && !await evaluate("!!globalThis.roofReady"); i++) await delay(500);
  assert.equal(await evaluate("!!globalThis.roofReady"), true, "roof assets/prewarm not ready");
  console.log("Real Rooftop loaded and rendered");
  await evaluate("roofTest.game.sfx._load('scream-f')");
  await evaluate("globalThis.failed=[];roofTest.game.events.on('failed',r=>failed.push(r));");
  for (const side of [-1, 1]) {
    const entry = await evaluate(`(() => {
      const g=roofTest.game; g._clearRoofFall();g.phase='roof';g.runner.alive=true;g.runner.vitality=100;g.runner.finished=false;g.runner.invulnerable=999;
      g.hud.hideSummary();g.hero.position.set(${side}*15.8,0,0);g.hero.velocity.set(0,0,0);g.hero.knock.set(0,0,0);g.hero.vy=0;g.hero.dodge=0;
      g.held.clear();g.held.add('${side < 0 ? "KeyA" : "KeyD"}');g.snapCamera=true;g._updateRoofCamera(.016);
      for(let i=0;i<80&&g.phase==='roof';i++)g.update(.05,5+i*.05);
      return {phase:g.phase,position:g.hero.position.toArray(),model:!!g.avatar.uniforms};
    })()`);
    assert.equal(entry.phase, "roofFall"); assert.equal(entry.model, true); console.log("Movement entry", side, entry);
    assert.equal(await evaluate("roofTest.game.sfx.roofFall?.channel?.source.loop === true"), true, "scream sustain source ready");
    for (const [label, seconds] of [["side", 0.35], ["follow", 0.55], ["brake", 1.15], ["locked", 0.5], ["exited", 0.55]]) {
      const sample = await evaluate(`(() => { const g=roofTest.game;for(let i=0;i<${Math.round(seconds * 60)};i++)g.update(1/60,20+i/60);g.render();
        const s=g._roofFall;return {phase:g.phase,time:s.time,y:g.hero.position.y,camera:g.camera.position.toArray(),audio:s.audio,
          playerTop:s.playerFrame.top,exitTime:s.exitTime,weaponY:s.weaponPosition.y,weaponExit:s.weaponExitTime,
          dropped:g.launcher.rig.parent===g.scene,bodyPitch:g.avatar.body.rotation.x,calls:roofTest.renderer.info.render.calls};})()`);
      console.log(side, label, sample);
      assert.equal(sample.dropped, true, "same launcher is visible in world space");
      if (label === "follow") assert.ok(Math.abs(Math.cos(sample.bodyPitch)) < 0.4, "laid-out torso");
      if (shots) { const png = await call("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(temporary, `${side < 0 ? "left" : "right"}-${label}.png`), Buffer.from(png.data, "base64")); }
      if (label === "locked") {
        const pause = await evaluate("(() => {const g=roofTest.game;g.setPaused(true);const t=g._roofFall.time;g._updateRoofFrame(.05,99);g.setPaused(false);return g._roofFall.time===t;})()");
        assert.equal(pause, true);
        await evaluate("globalThis.fixedCamera=roofTest.game.camera.position.toArray()");
      }
      if (label === "exited") {
        assert.equal(await evaluate("JSON.stringify(fixedCamera)===JSON.stringify(roofTest.game.camera.position.toArray())"), true);
        assert.ok(sample.playerTop < -1.05, "whole player has crossed bottom of fixed frame");
        assert.ok(sample.weaponExit < sample.exitTime, "weapon exits before player");
        assert.ok(sample.weaponY < sample.y - 10);
        assert.equal(sample.phase, "roofFall", "Game Over waits until after exit and dramatic hold");
      }
    }
    await evaluate("for(let i=0;i<100;i++)roofTest.game.update(.05,40+i*.05);roofTest.game.render();");
    assert.equal(await evaluate("roofTest.game.phase"), "over");
    assert.equal(await evaluate("roofTest.game._roofFall.exitTime!==null && roofTest.game._roofFall.playerFrame.top < -1.05"), true);
  }
  assert.equal(await evaluate("failed.length"), 2);
  // Use the real restart entry path, not merely a fixture that clears fields.
  await evaluate("roofTest.game.enterRoof()");
  const restarted = await evaluate("(() => {const g=roofTest.game;for(let i=0;i<80;i++)g.update(.05,50+i*.05);g.render();return {phase:g.phase,fall:g._roofFall,rig:g.avatar.uniforms.uFalling.value,launcher:g.launcher.rig.visible,attached:g.launcher.rig.parent===g.avatar.shoulder,alive:g.runner.alive};})()");
  assert.deepEqual(restarted, { phase: "roof", fall: null, rig: 0, launcher: true, attached: true, alive: true });
  // Physical internal hatch fall: no facade shot, no camera takeover.
  assert.equal(await evaluate("(() => {const g=roofTest.game;g.hero.position.set(-10,0,3);g.hero.velocity.set(0,0,0);g.hero.vy=0;g.held.clear();for(let i=0;i<80&&g.phase==='roof';i++)g.update(.05,60+i*.05);return g.phase==='over'&&!g._roofFall&&failed.at(-1).title==='DOWN A HATCH';})()"), true);
  const durations = await evaluate("(async()=>{const ctx=roofTest.game.audio.ctx;const files=['/assets/audio/sfx/scream-f.mp3','/assets/audio/sfx/scream-m.mp3','/assets/audio/sound-effects/wind1.wav'];return Promise.all(files.map(async file=>({file,seconds:(await ctx.decodeAudioData(await (await fetch(file)).arrayBuffer())).duration})));})()");
  console.log("Existing audio decoded", durations);
  await evaluate("roofTest.game._clearRoofFall();roofTest.game.unload();");
  assert.equal(await evaluate("roofTest.game._roofFall===null&&roofTest.game.phase==='idle'&&!roofTest.game.sfx.roofFall"), true);
  // Existing isolated Roof AI/ledge/endings checks, using the same real browser.
  const checks = await import("./meltdown/checks/roof.js");
  const result = await checks.run({ evaluate: fn => evaluate(`(${fn.toString()})()`) });
  assert.deepEqual(result.failures, []); console.log("Existing Roof checks", result);
  assert.deepEqual(errors, [], "browser console/WebGL errors");
  console.log("PASS: both ledges, side camera, horizontal pose, detached faster launcher, bottom exit, delayed Game Over, restart; console errors: 0");
  if (shots) console.log("Visual review images:", temporary);
} finally {
  if (socket?.readyState === WebSocket.OPEN) await Promise.race([call("Browser.close").catch(() => {}), delay(2000)]);
  socket?.close();
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([new Promise(resolve => browser.once("exit", resolve)), delay(3000)]); }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // Exact, self-created temporary directory only; never a user's browser profile.
  const target = path.resolve(shots ? profile : temporary);
  if (target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temporary).startsWith("fracture-roof-fall-")) {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
