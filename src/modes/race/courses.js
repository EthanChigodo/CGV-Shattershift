/**
 * The race's courses: the story's three levels, each wrapped in one shape so
 * the race (race.js) can put two runners on any of them.
 *
 *   const course = await buildCourse("foundry", { scene, renderer, assetBase });
 *   course.sample(distance, lateral, height, out)  -> a world point on it
 *   course.speedAt(distance)                       -> running pace, m/s
 *   course.collide(box, distance)                  -> { hits, panes }
 *   course.groundAt(distance, lateral)             -> floor height (0, a duct's top)
 *   course.breakables()                            -> what a sphere can break
 *   course.breakTarget(mesh, info)                 -> break it (null if it isn't)
 *   course.special(ball, point, reach)             -> a cryo / shock / gravity burst on the world
 *                                                     (cryo: the fires out) -> how many fires it put out
 *   course.surfaceHit(start, end, radius)          -> a wall or ceiling a sphere bounces off
 *   course.solids()                                -> solid things a sphere bounces off
 *   course.update(dt, time, { lead, trail })       -> the world moves on
 *   course.finish                                  -> where the race ends (Infinity: never)
 *   course.dispose()
 *
 * Every course runs straight down -Z (the levels' straight-route option), in
 * three lanes at -3.2, 0, 3.2. Each level hides and streams its scenery
 * around one distance: the race keeps both runners within LEFT_BEHIND metres
 * of each other, and the courses keep the world up round both.
 */

import * as THREE from "../../three.js";
import { RoomEnvironment } from "../../three-addons.js";
import { FoundryLevel } from "../../levels/foundry/index.js";
import { CausewayLevel } from "../../levels/causeway/index.js";
import { MeltdownLevel } from "../../levels/meltdown/index.js";

export const COURSES = {
  foundry: {
    key: "foundry", title: "THE FOUNDRY", sector: "SECTOR 01", colour: "#ff8a3d",
    blurb: "Pistons, presses and barriers - and gates only a switch cell opens. To the extraction valve.",
  },
  labs: {
    key: "labs", title: "THE LABS", sector: "SECTOR 02", colour: "#ff4d5a",
    blurb: "A fire behind each of you, patients in your lane, ducts to climb. Get hurt and the fire gains.",
  },
  skyline: {
    key: "skyline", title: "THE SKYLINE", sector: "SECTOR 03", colour: "#7ef4f1",
    blurb: "Glass, falling beams and fire over a bridge that never ends. Furthest wins.",
  },
};
export const COURSE_ORDER = ["foundry", "labs", "skyline"];

/**
 * The race's difficulties - five, on every course. Each run is also a new
 * layout (a fresh seed), whatever the difficulty.
 *   speed    the pace, x   density  obstacles, x   damage  a hit, x
 *   behind   how far back is "left behind" (m)     regen   s per sphere
 *   extras   the hard extras: slag carts (the Foundry), stalkers and fire waves (the Labs)
 */
export const RACE_TIERS = {
  easy: { key: "easy", name: "Easy", numeral: "I", speed: 0.88, density: 0.7, damage: 0.7, behind: 70, regen: 1.6, extras: false, blurb: "A gentle pace, room to breathe, hits that sting less." },
  normal: { key: "normal", name: "Normal", numeral: "II", speed: 1, density: 1, damage: 1, behind: 55, regen: 2, extras: false, blurb: "The course as the story runs it." },
  hard: { key: "hard", name: "Hard", numeral: "III", speed: 1.1, density: 1.25, damage: 1.25, behind: 45, regen: 2.4, extras: true, blurb: "Faster and fuller - and the hard extras come out." },
  extreme: { key: "extreme", name: "Extreme", numeral: "IV", speed: 1.22, density: 1.5, damage: 1.5, behind: 38, regen: 2.9, extras: true, blurb: "No let-up. A couple of mistakes and you're done." },
  insane: { key: "insane", name: "Insane", numeral: "V", speed: 1.36, density: 1.8, damage: 2, behind: 30, regen: 3.5, extras: true, blurb: "Barely survivable. Stay close or be left behind." },
};
export const TIER_ORDER = Object.keys(RACE_TIERS);
export const LANES = [-3.2, 0, 3.2];

function environment(renderer, scene, { fog, density, background, envStrength = 0.04 }) {
  scene.fog = new THREE.FogExp2(fog, density);
  scene.background = new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), envStrength).texture;
  pmrem.dispose();
  scene.environment = env;
  return env;
}

/**
 * Build a course for a race: `tier` (RACE_TIERS) sets its pace and how full
 * it is; `seed` lays it out - a new seed, a new layout.
 */
export async function buildCourse(key, { scene, renderer, assetBase, tier = RACE_TIERS.normal, seed = 1 + Math.floor(Math.random() * 1e6) }) {
  if (key === "foundry") return foundryCourse({ scene, renderer, tier, seed });
  if (key === "skyline") return skylineCourse({ scene, renderer, tier, seed });
  return labsCourse({ scene, renderer, assetBase, tier, seed });
}

/* ---- Sector 01: the Foundry ---------------------------------------------- */

function foundryCourse({ scene, renderer, tier, seed }) {
  const level = new FoundryLevel({
    origin: new THREE.Vector3(0, 0, 0),
    straightRoute: true,
    shadows: false,
    lightBudget: { points: 6, spots: 2 },
    brightness: 1.7,
    runSpeed: 12 * tier.speed,
    length: 1.4,
    // A new layout each race: the hazards and cells reshuffled.
    variant: seed,
    density: 1.1 * tier.density,
    extras: tier.extras,
    problems: false,
  });
  level.addTo(scene);
  const env = environment(renderer, scene, { fog: 0x141d23, density: 0.0115, background: 0x121a20 });
  const fill = new THREE.HemisphereLight(0xbcd2e0, 0x2a2018, 0.35);
  scene.add(fill);
  const total = level.route.totalLength;
  const mid = new THREE.Vector3();
  return {
    key: "foundry",
    start: 3,
    finish: total - 10,
    sample: (d, lateral, h, out) => out.copy(level.route.sample(d, lateral, h).position),
    // A pace that builds: 8.4 m/s to 12.6 over the course.
    speedAt: (d) => (8.4 + 4.2 * Math.min(1, d / total)) * tier.speed,
    collide: (box, d) => ({ hits: level.collide(box, d), panes: [] }),
    groundAt: () => 0,
    breakables: () => level.breakables,
    breakTarget: (mesh) => level.breakTarget(mesh),
    // (No fires to put out: the Foundry's are its furnaces.)
    special: () => 0,
    surfaceHit: (start, end, radius) => level.surfaceHit(start, end, radius),
    solids: () => level.obstacles,
    update(dt, time, { lead, trail, leadPos, trailPos }) {
      // (The level's own update hides and ticks round one runner and runs the
      // story's escape clock; this keeps both runners' stretch up, no clock.)
      if (level._furnaceTime) level._furnaceTime.value = time;
      for (const e of level._culled) e.piece.visible = e.distance > trail - 40 && e.distance < lead + 95;
      for (const e of level._animated) {
        if (e.distance < trail - 30 || e.distance > lead + 70) continue;
        if (e.frozen > 0) { e.frozen -= dt; continue; }
        e.piece.userData.tick?.(dt, time);
      }
      mid.lerpVectors(leadPos, trailPos, 0.5);
      level.lights.update(mid, time);
    },
    dispose() {
      level.dispose();
      scene.remove(fill);
      env.dispose();
    },
  };
}

/* ---- Sector 03: the Skyline (its endless bridge) ---------------------------- */

function skylineCourse({ scene, renderer, tier, seed }) {
  const ORIGIN_Z = 4000;
  // Its endless generator: a new bridge for every seed.
  const level = new CausewayLevel({ origin: new THREE.Vector3(0, 0, ORIGIN_Z), mode: "endless", quality: "medium", seed, problems: false });
  level.addTo(scene);
  // Lit as the story lights it: by its own moonlight, lamps and fires, and its
  // own haze (thin on the bridge, thick in smoke) - no extra sun or fill, and
  // no room environment: its surfaces reflect its own probe, as in the story.
  scene.fog = new THREE.FogExp2(0x140b09, 0.019);
  scene.background = new THREE.Color(0x08080c);
  scene.environment = null;
  let frame = 0;
  return {
    key: "skyline",
    start: 60,
    finish: Infinity,
    sample: (d, lateral, h, out) => out.set(lateral, h, ORIGIN_Z - d),
    // Faster the further you get, like Endless.
    speedAt: (d) => Math.min(15.5 * tier.speed, (10.4 + d / 220) * tier.speed),
    collide(box, d) {
      const r = level.collide(box, d);
      return { hits: r.hits, panes: r.panes };
    },
    groundAt: () => 0,
    breakables: () => level.breakables,
    breakTarget: (mesh, info) => level.breakTarget(mesh, { ball: "glass", ...info }),
    // Cryo: its fires out and its falling debris frozen, as in the story (index.js splash).
    special: (ball, point, reach) => (ball === "cryo" ? level.splash(point, reach, "cryo").extinguished : 0),
    surfaceHit: (start, end, radius) => level.corridorSurfaceHit(start, end, radius),
    solids: () => level.solids,
    update(dt, time, { trail, trailPos }) {
      // Streamed round the runner behind: the one in front is within reach of its window.
      level.update({ dt, time, distance: trail, player: trailPos, playing: true });
      scene.fog.color.copy(level.fogColor);
      scene.fog.density = level.fogDensity;
      scene.background.copy(level.hazeColor);
      // Its reflections, every few frames.
      frame += 1;
      if (frame % 4 === 0) level.renderProbe?.(renderer, scene);
    },
    dispose() {
      level.dispose();
    },
  };
}

/* ---- Sector 02: the Labs ------------------------------------------------- */

async function labsCourse({ scene, renderer, assetBase, tier, seed }) {
  // (No right-tool problems: a race is about the line, not the tool.)
  const level = new MeltdownLevel({ origin: new THREE.Vector3(0, 0, 0), straightRoute: true, lightPoints: 6, length: 1.2, seed, density: tier.density, extras: tier.extras, problems: false });
  level.addTo(scene);
  const env = environment(renderer, scene, { fog: 0x1a120d, density: 0.012, background: 0x1a120d });
  const fill = new THREE.HemisphereLight(0xffd8b8, 0x24140c, 0.5);
  scene.add(fill);
  await level.loadAssets(assetBase).catch(() => null);
  const total = level.route.totalLength;
  const leadPos = new THREE.Vector3();
  const at = new THREE.Vector3();
  return {
    key: "labs",
    start: 8,
    finish: total - 14,
    fire: true,
    sample: (d, lateral, h, out) => out.copy(level.route.sample(d, lateral, h).position),
    speedAt: (d) => level.speedAt(d) * 1.05 * tier.speed,
    collide: (box, d) => ({ hits: level.collide(box, d), panes: [] }),
    groundAt: (d, lateral) => level.groundAt(d, 0.45, lateral),
    breakables: () => level.breakables,
    breakTarget: (mesh) => level.breakTarget(mesh, 2),
    /**
     * Cryo: the fire walls in reach out - the way clear (as game.js
     * _putOutWall) - and every other fire in reach, the floor vents for good
     * (index.js putOutFires).
     */
    special(ball, point, reach) {
      if (ball !== "cryo") return 0;
      let out = 0;
      for (const wall of level._fireWalls ?? []) {
        const target = wall.group.userData.breakableMeshes?.[0];
        if (wall.group.userData.out || !target) continue;
        if (target.getWorldPosition(at).distanceTo(point) > reach + 1) continue;
        wall.group.userData.putOut();
        const i = level.breakables.indexOf(target);
        if (i >= 0) level.breakables.splice(i, 1);
        out += 1;
      }
      return out + level.putOutFires(point, reach).length;
    },
    surfaceHit: (start, end, radius) => level.surfaceHit(start, end, radius),
    solids: () => level.obstacles,
    /** The fire's front, drawn where it is closest to anyone. */
    setFire: (d) => level.setFireFront(d),
    update(dt, time, { lead, leadPos: lp }) {
      leadPos.copy(lp);
      level.update({ dt, time, distance: lead, playerPosition: leadPos, clock: false });
    },
    dispose() {
      level.dispose();
      scene.remove(fill);
      env.dispose();
    },
  };
}
