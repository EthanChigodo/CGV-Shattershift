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
    zones = [{ until: 0.5, speed: 6.8 }, { until: 0.75, speed: 9.0 }, { until: 1.01, speed: 11.6 }],
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

    if (steer) lateral += (steer(distance) - lateral) * Math.min(1, dt * 9);

    for (const mesh of [...L.breakables]) {
      const d = mesh.userData.routeDistance;
      if (!mesh.userData.alive || d <= distance || d - distance > 20) continue;
      if (mesh.userData.kind === "cell" && !shootCells) continue;
      if (mesh.userData.kind === "switch" && !shootSwitches) continue;
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
          : mesh.userData.piston ? "piston" : "gate",
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
    escapeHits: hits.filter((h) => h.duringEscape).length,
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
