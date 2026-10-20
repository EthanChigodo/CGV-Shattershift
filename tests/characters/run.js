/**
 * Checks for the rigged characters (src/figure/rigged.js, tools/characters/).
 *
 *   node tests/characters/run.js
 *   CHARACTERS_FIXTURE=/path/to/built/folder node tests/characters/run.js
 *
 * 1. The empty manifest (as committed): the game loads today's characters
 *    exactly as before - the shader-rigged player, the procedural patients -
 *    asks for nothing but the manifest, and the preview says there's nothing.
 * 2. With a built folder (manifest.json + GLBs from build.py; skipped without
 *    CHARACTERS_FIXTURE): the preview plays every role's clips, crossfades,
 *    syncs a run to speed, layers a hit, holds a death, tints skin and hair;
 *    the Labs load the rigged player and patients. No console errors.
 *
 * The fixture is served under /assets/characters/fixture/ (page routes), so
 * nothing is copied into the repository.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { serve, launch, openPage } from "../meltdown/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const FIXTURE = process.env.CHARACTERS_FIXTURE ? path.resolve(process.env.CHARACTERS_FIXTURE) : null;

async function withFixture(page) {
  if (!FIXTURE) return;
  await page.route("**/assets/characters/fixture/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split("/assets/characters/fixture/")[1]);
    const file = path.join(FIXTURE, rel);
    if (!file.startsWith(FIXTURE) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({ path: file, contentType: file.endsWith(".json") ? "application/json" : "model/gltf-binary" });
  });
}

/** The Labs harness, loaded; returns what was asked of assets/characters/. */
async function openLabs(page, origin, query = "") {
  const requests = [];
  page.on("response", (r) => {
    if (r.url().includes("/assets/characters/")) requests.push([new URL(r.url()).pathname, r.status()]);
  });
  await page.goto(`${origin}/preview/meltdown.html${query}`, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => globalThis.__meltdown?.level && globalThis.__meltdown.assetsReady, null, { timeout: 240000, polling: 1000 });
  return requests;
}

const checks = [
  {
    name: "empty manifest: today's characters, nothing else asked for",
    async run(page, origin) {
      const failures = [];
      const requests = await openLabs(page, origin);
      const state = await page.evaluate(() => {
        const m = globalThis.__meltdown;
        let rigged = 0;
        let skinned = 0;
        m.scene.traverse((o) => {
          if (o.userData.character?.rigged) rigged += 1;
          if (o.isSkinnedMesh) skinned += 1;
        });
        const u = m.avatar.uniforms;
        return {
          rigged,
          skinned,
          avatarRigged: Boolean(m.avatar.rigged),
          shaderRig: Boolean(u?.uPhase && m.avatar.model?.getObjectByName("CharacterMerged")),
          look: Boolean(m.avatar.look?.setSkinTone),
        };
      });
      if (state.rigged) failures.push(`${state.rigged} rigged characters with an empty manifest`);
      if (state.avatarRigged) failures.push("the player is rigged with an empty manifest");
      if (!state.shaderRig) failures.push("the player is not today's shader-rigged model");
      if (!state.look) failures.push("the player has no look (skin/hair/wear)");
      if (!state.skinned) failures.push("no skinned patients in the Labs (today's models did not load)");
      const other = requests.filter(([p]) => !p.endsWith("/assets/characters/manifest.json"));
      if (other.length) failures.push(`asked for more than the manifest: ${JSON.stringify(other)}`);
      if (!requests.some(([p, s]) => p.endsWith("manifest.json") && s === 200)) failures.push(`manifest not served: ${JSON.stringify(requests)}`);
      return { failures, notes: { ...state, requests: requests.length } };
    },
  },
  {
    name: "empty manifest: the preview says there is nothing yet",
    async run(page, origin) {
      await page.goto(`${origin}/preview/characters.html`, { waitUntil: "load" });
      const roles = await page.evaluate(() => globalThis.__chars.ready);
      const empty = await page.evaluate(() => !document.getElementById("empty").hidden);
      const failures = [];
      if (roles.length) failures.push(`roles listed: ${roles}`);
      if (!empty) failures.push("no 'nothing yet' message");
      return { failures, notes: { roles: roles.length } };
    },
  },
  {
    name: "stand-ins: clips, crossfades, speed sync, hit, death, tints (preview)",
    fixture: true,
    async run(page, origin) {
      await withFixture(page);
      await page.goto(`${origin}/preview/characters.html?characters=fixture`, { waitUntil: "load" });
      const roles = await page.evaluate(() => globalThis.__chars.ready);
      const failures = [];
      if (!roles.length) return { failures: ["no roles in the fixture manifest"], notes: {} };
      const notes = { roles };
      for (const role of roles) {
        const r = await page.evaluate(async (role) => {
          const c = globalThis.__chars;
          await c.select(role);
          const rig = c.state.rig;
          const out = { role, clips: [...rig.clips.keys()], errors: [] };
          // Every clip plays.
          for (const name of out.clips) {
            c.play(name);
            c.step(3);
            if (!rig.shot && rig.base?.name !== name && rig.mode !== "proc") out.errors.push(`${name} did not play (${rig.base?.name})`);
          }
          // A crossfade: both actions weighted part-way through.
          if (rig.has("idle") && (rig.has("walk") || rig.has("run"))) {
            const move = rig.has("run") ? "run" : "walk";
            c.play("idle");
            c.step(12);
            c.play(move);
            c.step(3);
            const w = [...rig.actions.entries()].map(([n, a]) => [n, +a.getEffectiveWeight().toFixed(2)]).filter(([, v]) => v > 0);
            out.fade = w;
            if (w.length < 2) out.errors.push(`no crossfade idle -> ${move}: ${JSON.stringify(w)}`);
            // Speed sync: about twice the speed (around the clip's own), a faster cycle.
            const own = rig.clipSpeed(rig.base.name) ?? 3;
            rig.pose({ clip: [move], speed: own * 0.8, dt: 0.02 });
            const slow = rig.base.action.timeScale;
            rig.pose({ clip: [move], speed: own * 1.6, dt: 0.02 });
            const fast = rig.base.action.timeScale;
            out.rates = [+slow.toFixed(2), +fast.toFixed(2)];
            if (!(fast > slow * 1.4)) out.errors.push(`run rate does not follow speed: ${slow} -> ${fast}`);
            rig.apply();
          }
          // A hit over the motion (a clip if it has one, the spring share otherwise).
          const share = rig.react();
          if (rig.has("hit") && !(rig.overlays.length || rig.shot?.name?.startsWith("hit"))) out.errors.push("hit clip did not play");
          if (!(share > 0)) out.errors.push("react() returned no spring share");
          // A death holds its last frame.
          if (rig.has("die")) {
            rig.die();
            for (let i = 0; i < 90; i += 1) rig.update(1 / 30).apply();
            const a = rig.shot?.action;
            out.die = a ? +(a.time / a.getClip().duration).toFixed(2) : null;
            if (!a || a.time < a.getClip().duration - 1e-3) out.errors.push(`death not held at its end (${out.die})`);
            c.step(1);
          }
          // Skin and hair: the uniforms take the choice.
          const look = c.state.look;
          look.setSkinTone("dark");
          look.setHairColour("blonde");
          const tinted = [];
          c.state.model.traverse((o) => {
            if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData.figure) tinted.push([m.userData.figure.uniforms.uRigToneOn.value, m.userData.figure.uniforms.uRigHairOn.value]);
          });
          if (!tinted.length || !tinted.every(([t, h]) => t === 1 && h === 1)) out.errors.push(`tint not applied: ${JSON.stringify(tinted)}`);
          look.setSkinTone("light");
          look.setHairColour("natural");
          return out;
        }, role);
        notes[role] = { clips: r.clips.length, fade: r.fade, rates: r.rates, die: r.die };
        for (const e of r.errors) failures.push(`${role}: ${e}`);
      }
      return { failures, notes };
    },
  },
  {
    name: "stand-ins: the Labs load the rigged player and patients",
    fixture: true,
    async run(page, origin) {
      await withFixture(page);
      await openLabs(page, origin, "?characters=fixture");
      const state = await page.evaluate(() => {
        const m = globalThis.__meltdown;
        const roles = new Set();
        let clipRigs = 0;
        m.scene.traverse((o) => {
          if (o.userData.character?.rigged) roles.add(o.userData.character.role);
        });
        for (const l of m.level._lurchers ?? []) {
          l.group.userData.tick?.(1 / 30, 1);
          l.group.traverse((o) => {
            if (o.userData.character?.rigged) clipRigs += 1;
          });
        }
        m.begin();
        m.teleport(120, { camera: 0 });
        for (let i = 0; i < 20; i += 1) m.game.update(1 / 30, 10 + i / 30);
        const body = m.avatar.rigged;
        return { roles: [...roles], clipRigs, avatar: body ? { role: m.avatar.model.userData.character.role, clip: body.rig.base?.name, hold: +body.hold.toFixed(2) } : null };
      });
      const failures = [];
      if (!state.avatar) failures.push("the player is not rigged");
      else if (state.avatar.clip !== "run") failures.push(`the running player plays ${state.avatar.clip}, not run`);
      if (!state.roles.some((r) => r.startsWith("patient"))) failures.push(`no rigged patients in the Labs: ${state.roles}`);
      return { failures, notes: state };
    },
  },
];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  const server = await serve(ROOT);
  const browser = await launch(chromium);
  let failed = 0;
  if (FIXTURE && !existsSync(path.join(FIXTURE, "manifest.json"))) {
    console.error(`CHARACTERS_FIXTURE has no manifest.json: ${FIXTURE}`);
    process.exit(2);
  }
  for (const check of checks) {
    if (check.fixture && !FIXTURE) {
      console.log(`${check.name} ... skipped (set CHARACTERS_FIXTURE to a build.py output folder)`);
      continue;
    }
    process.stdout.write(`${check.name} ... `);
    const { page, errors } = await openPage(browser, { width: 960, height: 600 });
    try {
      const { failures, notes } = await check.run(page, server.origin);
      const pageErrors = errors.filter((e) => !/favicon/i.test(e));
      for (const e of pageErrors) failures.push(`console: ${e}`);
      if (failures.length) {
        failed += 1;
        console.log("FAIL");
        for (const f of failures) console.log(`  - ${f}`);
      } else console.log("ok");
      console.log(`  ${JSON.stringify(notes)}`);
    } catch (error) {
      failed += 1;
      console.log(`ERROR ${error.message}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  await server.close();
  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall character checks passed");
}

main();
