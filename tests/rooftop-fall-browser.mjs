/** Optional native Chromium WebGL smoke test. Node 24, installed Edge/Chrome;
 * no dependency installs. node tests/rooftop-fall-browser.mjs [--shots] [--facade] [--full-game]
 * ROOF_FALL_CHROMIUM overrides the Windows Edge path. Isolated temporary profile.
 */
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
const root = fileURLToPath(new URL("../", import.meta.url));
const shots = process.argv.includes("--shots");
const facade = process.argv.includes("--facade");
const fullGame = process.argv.includes("--full-game") || process.argv.includes("--game-only");
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
    if (facade && url.pathname === "/src/levels/meltdown/__facade-baseline.js") {
      return res.writeHead(200, { "content-type": "text/javascript" }).end(execFileSync("git",["show","HEAD:src/levels/meltdown/roof-facade.js"],{cwd:root}));
    }
    if (url.pathname === "/__roof-fall-test") return res.writeHead(200, { "content-type": "text/html" }).end(html);
    if (url.pathname === "/favicon.ico") return res.writeHead(204).end();
    // Exercise the actual entry point under a server subdirectory too.
    const pathname = url.pathname.replace(/^\/fracture-run\//, "/");
    const target = path.resolve(root, "." + decodeURIComponent(pathname));
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
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(" "));
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
  // --game-only is useful when iterating on the shared host/UI, without
  // repeating the independent preview/AI/animation checks below.
  if (!process.argv.includes("--game-only")) {
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
          dropped:g.launcher.rig.parent===g.scene,bodyPitch:g.avatar.body.rotation.x,facadeTime:g.roof.facadeMaterial.userData.facadeTime.value,
          frameInstances:g.roof.facadeFrames.count,calls:roofTest.renderer.info.render.calls};})()`);
      console.log(side, label, sample);
      assert.equal(sample.dropped, true, "same launcher is visible in world space");
      if (label === "follow") assert.ok(Math.abs(Math.cos(sample.bodyPitch)) < 0.4, "laid-out torso");
      if (shots) { const png = await call("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(temporary, `${side < 0 ? "left" : "right"}-${label}.png`), Buffer.from(png.data, "base64")); }
      if (facade && label === "follow" && side === 1) {
        const measurements = await evaluate(`(async()=>{
          const g=roofTest.game,r=roofTest.renderer,gl=r.getContext(),current=g.roof.facadeMaterial;
          const {createRoofFacade}=await import('/src/levels/meltdown/__facade-baseline.js');
          const baseline=createRoofFacade(),results=[];r.info.autoReset=false;
          const rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
          for(const [mode,material,trim] of [['before',baseline,false],['after',current,true]]) {
            g.roof.facadeMesh.material=material;g.roof.facadeFrames.visible=trim;
            for(let i=0;i<3;i++){g.render();gl.finish();}
            const samples=[];for(let i=0;i<8;i++){r.info.reset();const t=performance.now();g.render();gl.finish();samples.push(performance.now()-t);}
            samples.sort((a,b)=>a-b);results.push({mode,medianRenderMs:(samples[3]+samples[4])/2,drawCalls:r.info.render.calls,
              triangles:r.info.render.triangles,textures:r.info.memory.textures,geometries:r.info.memory.geometries,
              viewport:[innerWidth,innerHeight],buffer:[r.domElement.width,r.domElement.height],
              renderer:rendererInfo?gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});
          }
          g.roof.facadeMesh.material=current;g.roof.facadeFrames.visible=true;r.info.autoReset=true;baseline.dispose();g.render();return results;
        })()`);
        console.log("Frozen follow shot / software WebGL / gl.finish render comparison",measurements);
        assert.equal(measurements[1].drawCalls-measurements[0].drawCalls,1,"one instanced facade draw added");
      }
      if (label === "locked") {
        const pause = await evaluate("(() => {const g=roofTest.game;g.setPaused(true);const t=g._roofFall.time,u=g.roof.facadeMaterial.userData.facadeTime.value;g._updateRoofFrame(.05,99);g.setPaused(false);return g._roofFall.time===t&&g.roof.facadeMaterial.userData.facadeTime.value===u;})()");
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
  if (facade) {
    // A known clear pane with a sparse figure, using the production material.
    // Camera/time changes here are a visual test only; real restart follows.
    await evaluate("(()=>{const g=roofTest.game;g.hud.hideSummary();g.ui.fade.style.opacity='0';g.avatar.setVisible(false);g.launcher.rig.visible=false;g.camera.fov=40;g.camera.updateProjectionMatrix();g.camera.position.set(-22,-34.2,-6.5);g.camera.lookAt(-15.9,-34.2,-6.5);})()");
    const fingerprints=[];
    for(const time of [0,5]) {
      const pixels = await evaluate(`(()=>{const g=roofTest.game,r=roofTest.renderer;g.roof.facadeMaterial.userData.facadeTime.value=${time};g.render();
        const gl=r.getContext(),a=new Uint8Array(160*160*4);gl.readPixels(Math.floor(r.domElement.width/2)-80,Math.floor(r.domElement.height/2)-80,160,160,gl.RGBA,gl.UNSIGNED_BYTE,a);
        let hash=0;for(let i=0;i<a.length;i++)hash=(Math.imul(hash,31)+a[i])|0;return hash;})()`);
      fingerprints.push(pixels);
      if(shots){const png=await call("Page.captureScreenshot",{format:"png"});await writeFile(path.join(temporary,`facade-figure-${time}.png`),Buffer.from(png.data,"base64"));}
    }
    assert.notEqual(fingerprints[0],fingerprints[1],"room silhouette moves without advancing enemies or creating objects");
    console.log("Facade close-up silhouette motion pixel hashes",fingerprints);
  }
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
  }
  if (fullGame) {
    // Unlike the isolated preview above, use the real main.js, loader,
    // DeathFX, statistics panel and buttons. No mocked scene or results UI.
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('fractureRunSettings',JSON.stringify({quality:'low'}));` });
    await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/fracture-run/index.html` });
    const waitFor = async (expression, label) => {
      for (let i = 0; i < 180; i++) {
        if (await evaluate(expression)) return;
        await delay(500);
      }
      throw Error(`Timed out: ${label}`);
    };
    await waitFor("!!globalThis.__dbg", "actual main.js boot");
    await evaluate("__dbg.manual=true");
    await waitFor("!__dbg.loadingScreen.visible", "legitimate boot loading finishes");
    await evaluate("__dbg.story.jump('roof');__dbg.newRunReport()");
    const roofReady = async () => {
      await waitFor("__dbg.state==='playing'&&!__dbg.loadingScreen.visible", "legitimate Roof entry loading finishes");
      await evaluate("__dbg.step(80,.05)");
      assert.equal(await evaluate("__dbg.meltdown.phase"), "roof");
    };
    await roofReady();
    const gameplayHud = ".cw-ui,.hud,.sphere-wheel,.mlt-vitals,.mlt-banner,.mlt-toasts,.mlt-prompt,.roof-map,.topbar,.reticle,.message,.sx,.pu-badges,.pu-edge";
    const hudHidden = () => evaluate(`document.body.classList.contains('roof-fall-cinematic')&&[...document.querySelectorAll(${JSON.stringify(gameplayHud)})].every(el=>getComputedStyle(el).display==='none')`);
    await evaluate(`(() => {
      globalThis.transitionCalls=[];
      for(const [object,key,label] of [[__dbg.deathFx,'play','capture'],[__dbg.loadingScreen,'show','loading'],[__dbg.renderer,'compile','compile']]) {
        const original=object[key];object[key]=function(...args){transitionCalls.push(label);return original.apply(this,args);};
      }
    })()`);
    for (const side of [-1, 1]) {
      const entry = await evaluate(`(() => {
        const g=__dbg.meltdown;globalThis.retainedScene=g.scene;globalThis.retainedCamera=g.camera;
        g.runner.invulnerable=999;g.runner.breaks=7;g.runner.downs=2;g.runner.hits=3;g.runner.balls=9;g.roof.state.falls=1;
        g.hero.position.set(${side}*15.8,0,0);g.hero.velocity.set(0,0,0);g.hero.knock.set(0,0,0);g.hero.vy=0;g.hero.dodge=0;
        g.held.clear();g.held.add('${side < 0 ? "KeyA" : "KeyD"}');g.snapCamera=true;g._updateRoofCamera(.016);
        transitionCalls.length=0;
        for(let i=0;i<80&&g.phase==='roof';i++)__dbg.step(1,.05);
        return {phase:g.phase,host:__dbg.state};
      })()`);
      assert.deepEqual(entry, { phase: "roofFall", host: "playing" });
      assert.equal(await hudHidden(),true,"all gameplay statistics hidden immediately on exterior-fall entry");
      // Step physics independently of software-rendering speed, then leave
      // real animation frames running past the loader's old 0.6 s threshold.
      await evaluate("while(__dbg.meltdown._roofFall.time<2.5)__dbg.step(1,1/60);globalThis.finalCamera=__dbg.meltdown.camera.matrixWorld.toArray();__dbg.render()");
      assert.equal(await hudHidden(),true,"stats, sphere wheel and delayed toasts stay hidden throughout the fall");
      if (shots) { const png=await call("Page.captureScreenshot",{format:"png"});await writeFile(path.join(temporary,`full-${side}-camera-stop.png`),Buffer.from(png.data,"base64")); }
      await evaluate("for(let i=0;i<100&&__dbg.state==='playing';i++)__dbg.step(1,1/60)");
      await delay(1200);
      // Keep the existing count-up animation: software WebGL may deliver its
      // final animation frame later than a wall-clock timeout would assume.
      await waitFor("document.querySelector('#finalScore').textContent===String(Math.floor(__dbg.score)).padStart(6,'0')", "existing score count-up completes");
      const overlay = await evaluate(`(() => {
        const d=__dbg,g=d.meltdown,e=document.querySelector('#endScreen'),style=getComputedStyle(e);
        globalThis.frozenStats=JSON.stringify(g.stats);globalThis.facadeTime=g.roof.facadeMaterial.userData.facadeTime.value;
        globalThis.resultRenders=0;const render=g.composer.render;g.composer.render=function(...args){resultRenders++;return render.apply(this,args);};
        return {state:d.state,background:g.roofFallBackground,active:e.classList.contains('active'),liveClass:e.classList.contains('roof-fall-background'),
          sameScene:g.scene===retainedScene&&g.camera===retainedCamera,cameraLocked:JSON.stringify(finalCamera)===JSON.stringify(g.camera.matrixWorld.toArray()),
          playerOut:g._roofFall.playerFrame.top < -1.05&&!g.avatar.body.visible,weaponFirst:g._roofFall.weaponExitTime<g._roofFall.exitTime,
          fade:g.ui.fade.style.opacity,mainFade:document.querySelector('#fadeOverlay').style.opacity,
          blur:style.backdropFilter,cardFilter:getComputedStyle(e.querySelector('.end-card')).filter,backgroundColor:style.backgroundColor,
          title:document.querySelector('#endTitle').textContent,stats:document.querySelector('#endStats').textContent,
          score:document.querySelector('#finalScore').textContent,chips:e.querySelectorAll('#endChips li').length,
          deaths:d.runReport.deaths.length,calls:[...transitionCalls],loader:d.loadingScreen.visible,deathFX:d.deathFx.playing};
      })()`);
      console.log("Full-game live results", side, overlay);
      for(const key of ['background','active','liveClass','sameScene','cameraLocked','playerOut','weaponFirst']) assert.equal(overlay[key],true,key);
      assert.equal(overlay.state,"ended");assert.equal(overlay.title,"YOU FELL");assert.equal(overlay.score,"001250");
      assert.equal(overlay.blur,"blur(5px)");assert.equal(overlay.cardFilter,"none");
      assert.equal(overlay.backgroundColor,"rgba(8, 5, 7, 0.32)");
      assert.equal(Number(overlay.fade),0);assert.equal(Number(overlay.mainFade),0);
      assert.deepEqual(overlay.calls,[]);assert.equal(overlay.loader,false);assert.equal(overlay.deathFX,false);
      for(const value of ['7 broken','2 downed','1 over the edge','3 hits taken']) assert.ok(overlay.stats.includes(value),value);
      assert.ok(overlay.chips>=5);assert.equal(overlay.deaths,side===-1?1:2);
      assert.equal(await hudHidden(),true,"gameplay HUD remains hidden behind unchanged Game Over statistics");
      await evaluate("__dbg.step(60,1/60)");await delay(250);
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const retained = await evaluate("({renders:resultRenders,facadeMoves:__dbg.meltdown.roof.facadeMaterial.userData.facadeTime.value>facadeTime,statsFixed:JSON.stringify(__dbg.meltdown.stats)===frozenStats,cameraFixed:JSON.stringify(__dbg.meltdown.camera.matrixWorld.toArray())===JSON.stringify(finalCamera),statsBefore:JSON.parse(frozenStats),statsAfter:__dbg.meltdown.stats})");
      console.log('Live background retention',side,retained);
      assert.ok(retained.renders>0,'actual render loop continues');
      for(const key of ['facadeMoves','statsFixed','cameraFixed']) assert.equal(retained[key],true,key);
      await call("Emulation.setDeviceMetricsOverride",{width:1000,height:700,deviceScaleFactor:1,mobile:false});
      await delay(100);
      assert.equal(await evaluate("JSON.stringify(finalCamera)===JSON.stringify(__dbg.meltdown.camera.matrixWorld.toArray())&&__dbg.meltdown.roofFallBackground"),true,"resize never resets cinematic camera");
      await call("Emulation.clearDeviceMetricsOverride");
      if(shots){const png=await call("Page.captureScreenshot",{format:"png"});await writeFile(path.join(temporary,`full-${side}-live-results.png`),Buffer.from(png.data,"base64"));}
      if(side===-1) {
        await evaluate("document.querySelector('#restartButton').click()");await roofReady();
        assert.equal(await evaluate("!document.querySelector('#endScreen').classList.contains('active')&&!document.querySelector('#endScreen').classList.contains('roof-fall-background')&&!__dbg.meltdown._roofFall&&__dbg.meltdown.avatar.uniforms.uFalling.value===0&&__dbg.meltdown.launcher.rig.parent===__dbg.meltdown.avatar.shoulder&&__dbg.meltdown.runner.alive"),true,"real Retry button clears overlay, fall, pose, weapon and controls");
        assert.equal(await evaluate("!document.body.classList.contains('roof-fall-cinematic')&&getComputedStyle(document.querySelector('.cw-ui')).display!=='none'&&getComputedStyle(document.querySelector('.sphere-wheel')).display!=='none'"),true,"normal gameplay HUD returns after Retry");
      }
    }
    await evaluate("document.querySelector('#endMenuButton').click()");
    assert.equal(await evaluate("document.body.classList.contains('roof-fall-cinematic')"),false,"menu clears cinematic HUD suppression");
    assert.equal(await evaluate("__dbg.state==='intro'&&!document.querySelector('#endScreen').classList.contains('roof-fall-background')&&!__dbg.meltdown._roofFall&&!__dbg.meltdown.roof&&!__dbg.meltdown.visible&&!__dbg.meltdown.sfx.roofFall"),true,"real Menu button releases Roof and cinematic state");
    await waitFor("!__dbg.loadingScreen.visible","legitimate menu warm-up");
    // Shared deaths must STILL use their existing effects. A hatch is not an
    // exterior cinematic even though both titles are classified as 'fall'.
    await evaluate("__dbg.story.jump('roof')");await roofReady();
    await evaluate("transitionCalls.length=0;const g=__dbg.meltdown;g.hero.position.set(-10,0,3);g.hero.velocity.set(0,0,0);g.hero.vy=0;g.held.clear();for(let i=0;i<80&&g.phase==='roof';i++)__dbg.step(1,.05)");
    assert.equal(await evaluate("__dbg.state==='ended'&&!__dbg.meltdown._roofFall&&__dbg.deathFx.playing&&transitionCalls.includes('capture')&&!document.querySelector('#endScreen').classList.contains('roof-fall-background')"),true,"internal hatch retains shared captured-frame death");
    await evaluate("document.querySelector('#endMenuButton').click()");
    await waitFor("!__dbg.loadingScreen.visible","menu after hatch");
    await evaluate("__dbg.startEndless('skyline');transitionCalls.length=0;__dbg.endRun(false,'fell')");
    assert.equal(await evaluate("__dbg.deathFx.playing&&transitionCalls.includes('capture')&&!document.querySelector('#endScreen').classList.contains('roof-fall-background')"),true,"other-level fall retains existing effect");
    console.log("PASS: actual main.js under /fracture-run/: both live results, no capture/loading/compile, unchanged stats, resize, real Retry/Menu cleanup, hatch and Skyline exclusion");
  }
  assert.deepEqual(errors, [], "browser console/WebGL errors");
  console.log("PASS: requested Rooftop browser checks; console errors: 0");
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
