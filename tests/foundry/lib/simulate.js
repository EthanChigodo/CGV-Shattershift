/**
 * The in-page playthrough simulator.
 *
 * Installed into the preview page as `window.__sim`. It steps a virtual runner
 * through the whole level at a fixed 60Hz, so piston phase, gate closing, and
 * the escape countdown all advance exactly as they would in a live run - but
 * deterministically, in a couple of seconds, and without needing anyone to
 * actually play it.
 *
 * This is what caught the sphere softlock and the escape death spiral. Neither
 * shows up in a few minutes of hands-on play; both are obvious the moment you
 * read the numbers at the end of a full run.
 */

const SOURCE = String.raw`
window.__sim = function (options) {
  const {
    shootCells = true,
    shootSwitches = true,
    useInputs = true,
    steer = null,
    startSpheres = 20,
    maxSpheres = 25,
    rechargeSeconds = 4,
    comboWindow = 2.6,
    zones = [{ until: 0.5, speed: 7.8 }, { until: 0.75, speed: 10.2 }, { until: 1.01, speed: 12.6 }],
  } = options || {};

  const f = globalThis.__foundry;
  const THREE = f.THREE;
  const L = f.level;

  const speedAt = (p) => (zones.find((z) => p < z.until) || zones[zones.length - 1]).speed;

  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  const dt = 1 / 60;

  let distance = 0, time = 0, invuln = 0, slow = 0, integrity = 100;
  let score = 0, combo = 1, comboTimer = 0, maxCombo = 1;
  let spheres = startSpheres, recharge = 0;
  let cells = 0, near = 0, shots = 0, breaks = 0;
  let lateral = 0, minSpheres = startSpheres, dryAt = null;
  const hits = [];
  const grazed = new Map();
  let guard = 0;

  const escapeFrom = L._escapeTrigger ?? Infinity;

  // A player chooses lanes. Look 4-16 m ahead: a lane is bad if a piston (or,
  // for someone who never jumps or slides, any barrier) is in it; stay put if
  // the current lane is fine, else move to the nearest good one. (The bots
  // used to run the whole level in the middle lane - which the level then
  // had to allow, and which is exactly what made the middle a free ride.)
  const LANES = [-3.2, 0, 3.2];
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _p = new THREE.Vector3();
  for (const e of L._hazardIndex) {
    if (e.lateral !== undefined) continue;
    L.route.sample(e.distance, 0, 0, _a);
    L.route.sample(e.distance, 1, 0, _b);
    e.mesh.getWorldPosition(_p);
    e.lateral = _p.sub(_a).dot(_b.sub(_a));
  }
  let laneIndex = 1;
  const autoSteer = (d) => {
    // Pistons and barriers only: the shutter gates close in from the sides and
    // are what the middle lane is for, so they are not something to steer from.
    const bad = (lane) => L._hazardIndex.some((e) => e.distance - d > 2.5 && e.distance - d < 10 &&
      Math.abs(e.lateral - lane) < 1.6 && (e.mesh.userData.piston || (!useInputs && e.mesh.userData.barrier)));
    // In the escape the gates close the side lanes: head for the middle.
    if (d >= escapeFrom - 6 && laneIndex !== 1 && !bad(LANES[1])) laneIndex = 1;
    if (bad(LANES[laneIndex])) {
      const order = [laneIndex - 1, laneIndex + 1, laneIndex - 2, laneIndex + 2].filter((i) => i >= 0 && i < 3);
      const next = order.find((i) => !bad(LANES[i]));
      if (next !== undefined) laneIndex = next;
    }
    return LANES[laneIndex];
  };
  const steering = steer ?? autoSteer;

  while (distance < L.route.totalLength - 2 && integrity > 0 && guard++ < 400000) {
    const progress = distance / L.route.totalLength;
    distance += speedAt(progress) * (slow > 0 ? 0.45 : 1) * dt;
    time += dt;
    invuln = Math.max(0, invuln - dt);
    slow = Math.max(0, slow - dt);
    if (comboTimer > 0) { comboTimer = Math.max(0, comboTimer - dt); if (comboTimer === 0) combo = 1; }
    for (const [m, left] of grazed) { if (left - dt <= 0) grazed.delete(m); else grazed.set(m, left - dt); }

    if (spheres <= 0) {
      if (dryAt === null) dryAt = Math.round(distance);
      recharge += dt;
      if (recharge >= rechargeSeconds) { recharge = 0; spheres += 1; }
    } else {
      recharge = 0;
    }

    lateral += (steering(distance) - lateral) * Math.min(1, dt * 9);

    for (const mesh of [...L.breakables]) {
      const d = mesh.userData.routeDistance;
      if (!mesh.userData.alive || d <= distance || d - distance > 20) continue;
      if (mesh.userData.kind === "cell" && !shootCells) continue;
      if (mesh.userData.kind === "switch" && !shootSwitches) continue;
      // A drop forge's valve: a player waits for the hammer to be up (open).
      if (mesh.userData.kind === "valve" && (!shootSwitches || !mesh.userData.open)) continue;
      if (spheres <= 0) break;
      spheres -= 1; shots += 1;
      minSpheres = Math.min(minSpheres, spheres);
      const result = L.breakTarget(mesh);
      if (result) {
        score += result.points * combo;
        spheres = Math.min(maxSpheres, spheres + (result.spheres || 0));
        breaks += 1;
        if (result.kind === "cell") cells += 1;
        combo = Math.min(9, combo + 1);
        maxCombo = Math.max(maxCombo, combo);
        comboTimer = comboWindow;
      }
    }

    const nearBarrier = L._hazardIndex.find(
      (e) => Math.abs(e.distance - distance) < 1.8 && e.mesh.userData.barrier
    );
    const sliding = useInputs && nearBarrier && nearBarrier.mesh.userData.barrier === "high";
    const jumping = useInputs && nearBarrier && nearBarrier.mesh.userData.barrier === "low";
    const height = sliding ? 1.0 : 1.9;
    const lift = jumping ? 1.44 : 0;

    L.route.sample(distance, lateral, lift, centre);
    centre.y += 0.18 + height / 2;
    box.setFromCenterAndSize(centre, size.set(0.9, height, 0.9));

    L.update({ dt, time, distance, playerPosition: centre });

    const probe = L.probe(box, distance);
    for (const mesh of probe.grazes) {
      if (grazed.has(mesh)) continue;
      grazed.set(mesh, 1.4);
      near += 1;
      score += 25 * combo;
    }

    if (probe.hits.length && invuln <= 0) {
      const mesh = probe.hits[0];
      hits.push({
        at: Math.round(distance),
        kind: mesh.userData.barrier
          ? "barrier-" + mesh.userData.barrier
          : mesh.userData.piston ? "piston" : mesh.userData.forge ? "forge" : "gate",
        duringEscape: distance >= escapeFrom,
      });
      integrity -= 18; invuln = 1.1; slow = 0.55; combo = 1; comboTimer = 0;
    }
  }

  return {
    survived: integrity > 0,
    complete: L.state.complete,
    integrity,
    score: Math.round(score),
    cells, near, maxCombo, shots, breaks,
    accuracy: shots ? Math.round((breaks / shots) * 100) : 0,
    spheresLeft: spheres,
    minSpheres,
    ranDryAt: dryAt,
    hits: hits.length,
    // The death spiral this guards against is the gates; a player who never
    // jumps meeting the escape's barriers is their own miss.
    escapeHits: hits.filter((h) => h.duringEscape && h.kind === "gate").length,
    hitList: hits.slice(0, 10).map((h) => h.at + "m " + h.kind),
    systems: L.state.systemsOnline,
    escapeLeft: +L.state.escape.remaining.toFixed(1),
    reached: Math.round(distance),
    seconds: +time.toFixed(1),
  };
};
`;

export async function installSimulator(page) {
  await page.evaluate(SOURCE);
}
