import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071318);
scene.fog = new THREE.FogExp2(0x071318, 0.018);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 280);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const lanes = [-3.2, 0, 3.2];
const breakables = [];
const projectiles = [];
const shards = [];
const obstacles = [];
let state = "intro";
let lane = 1;
let playerX = 0;
let runZ = 7;
let ammo = 12;
let health = 100;
let score = 0;
let cameraThird = false;
let muted = false;
let liftTimer = 0;
let messageTimer = 0;
let currentLevel = 1;
let transitionTarget = 0;
let heightLane = 0;
let playerY = 0;

const ui = {
  level: document.querySelector("#level"), ammo: document.querySelector("#ammo"), health: document.querySelector("#health"), score: document.querySelector("#score"),
  camera: document.querySelector("#cameraMode"), reticle: document.querySelector("#reticle"), message: document.querySelector("#message"),
  start: document.querySelector("#startScreen"), end: document.querySelector("#endScreen"), final: document.querySelector("#finalScore"),
  endEyebrow: document.querySelector("#endEyebrow"), endTitle: document.querySelector("#endTitle"), endText: document.querySelector("#endText")
};

scene.add(new THREE.HemisphereLight(0xa7f6ff, 0x12222a, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(-8, 16, 12);
scene.add(sun);

const floorMaterial = new THREE.MeshPhysicalMaterial({ color: 0x19414b, roughness: 0.25, metalness: 0.45, transparent: true, opacity: 0.72 });
for (let z = 4; z > -438; z -= 8) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.2, 7.3), floorMaterial);
  slab.position.set(0, -0.2, z);
  scene.add(slab);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0x3e9aaa, transparent: true, opacity: 0.32 }));
  edge.position.copy(slab.position); scene.add(edge);
}

const railMat = new THREE.MeshStandardMaterial({ color: 0x254854, metalness: 0.75, roughness: 0.26 });
for (const side of [-5.2, 5.2]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 442), railMat);
  rail.position.set(side, 1.1, -216); scene.add(rail);
}

const archGeo = new THREE.BoxGeometry(0.24, 6, 0.24);
for (let z = 0; z > -438; z -= 12) {
  for (const x of [-5.1, 5.1]) { const p = new THREE.Mesh(archGeo, railMat); p.position.set(x, 2.8, z); scene.add(p); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(10.4, .24, .24), railMat); top.position.set(0, 5.7, z); scene.add(top);
}

const starGeo = new THREE.BufferGeometry();
const starData = new Float32Array(900);
for (let i = 0; i < starData.length; i += 3) { starData[i] = (Math.random() - .5) * 90; starData[i+1] = Math.random() * 40; starData[i+2] = -Math.random() * 210; }
starGeo.setAttribute("position", new THREE.BufferAttribute(starData, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x91edf0, size: .08, transparent: true, opacity: .5 })));

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x7ef4f1, transmission: .5, transparent: true, opacity: .52, roughness: .06, metalness: .05, thickness: .35, emissive: 0x123b42, emissiveIntensity: .5 });
const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xffcf66, transmission: .15, roughness: .15, metalness: .1, emissive: 0x8f4a08, emissiveIntensity: 1.2 });
const hazardMat = new THREE.MeshStandardMaterial({ color: 0x752f36, roughness: .28, metalness: .68, emissive: 0x31090d, emissiveIntensity: .6 });

function addPane(x, z, wide = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(wide ? 2.8 : 2.25, 3.8, .18), glassMat.clone());
  mesh.position.set(x, 1.9, z); mesh.userData = { kind: "pane", alive: true, points: 150 };
  scene.add(mesh); breakables.push(mesh); obstacles.push(mesh); return mesh;
}

function addCrystal(x, y, z) {
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(.65, 0), crystalMat.clone());
  mesh.position.set(x, y, z); mesh.rotation.z = Math.PI / 4; mesh.userData = { kind: "crystal", alive: true, points: 250 };
  scene.add(mesh); breakables.push(mesh); return mesh;
}

function addHazard(x, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.7, 1), hazardMat);
  mesh.position.set(x, 1.35, z); mesh.userData = { kind: "hazard", hit: false };
  scene.add(mesh); obstacles.push(mesh);
  return mesh;
}

addPane(0, -13, true); addCrystal(-3.2, 1.2, -21); addPane(3.2, -29); addHazard(-3.2, -38);
addPane(0, -47); addCrystal(3.2, 2.1, -55); addHazard(0, -65); addPane(-3.2, -74);
addPane(3.2, -82); addCrystal(0, 2.5, -92); addHazard(3.2, -101); addPane(0, -110, true);
addCrystal(-3.2, 1.4, -118);

function addLift(z) {
  const group = new THREE.Group(); group.position.z = z;
  const liftFloor = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, .4, 8), railMat); liftFloor.position.y = .05; group.add(liftFloor);
  for (const x of [-4.3, 4.3]) { const wall = new THREE.Mesh(new THREE.BoxGeometry(.22, 6.8, 8.4), glassMat); wall.position.set(x, 3.4, 0); group.add(wall); }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5.5, .24), glassMat); gate.position.set(0, 2.75, -3.8); group.add(gate);
  scene.add(group); return group;
}
addLift(-132); addLift(-282);

const energyUniforms = { uTime: { value: 0 }, uLift: { value: 0 } };
const energyMat = new THREE.ShaderMaterial({
  uniforms: energyUniforms, transparent: true, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vUv; varying float vWave; uniform float uTime; void main(){vUv=uv; vec3 p=position; vWave=sin(p.y*3.0+uTime*4.0)*0.06; p.x+=vWave; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
  fragmentShader: `varying vec2 vUv; varying float vWave; uniform float uTime; uniform float uLift; void main(){float band=0.45+0.45*sin(vUv.y*28.0-uTime*5.0); float edge=pow(abs(vUv.x-.5)*2.0,3.0); vec3 col=mix(vec3(.05,.55,.62),vec3(.55,1.0,.92),band+uLift*.25); gl_FragColor=vec4(col,(.18+band*.42+edge*.25));}`
});
for (const z of [-132, -282, -430]) { const core = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, 7, 20, 1, true), energyMat); core.position.set(0, 3.5, z); scene.add(core); }

// Level 2: a darker mechanical foundry with moving machinery and lane hazards.
const foundryMetal = new THREE.MeshStandardMaterial({ color: 0x263138, metalness: .88, roughness: .3 });
const furnaceMat = new THREE.MeshStandardMaterial({ color: 0x3f1710, emissive: 0xff5a19, emissiveIntensity: 1.8, roughness: .5 });
for (let z = -152; z > -272; z -= 14) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(10.5, .38, .45), foundryMetal); beam.position.set(0, 5.3, z); scene.add(beam);
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 5.2, 10), furnaceMat); vent.rotation.z = Math.PI / 2; vent.position.set(z % 28 ? -4.7 : 4.7, 2.1, z - 5); scene.add(vent);
}
function addMover(x, z, range, speed) {
  const mesh = addHazard(x, z); mesh.scale.set(1.15, 1.5, 1.1); mesh.userData.mover = { base: x, range, speed, phase: Math.random() * Math.PI * 2 }; return mesh;
}
addPane(-3.2, -158); addMover(0, -169, 3.2, 1.4); addCrystal(3.2, 2.4, -180);
addMover(-2.4, -192, 2.2, 1.8); addPane(3.2, -204); addHazard(0, -215);
addCrystal(-3.2, 1.5, -225); addMover(1.5, -238, 2.8, 2.1); addPane(0, -251, true); addHazard(-3.2, -263);

// Level 3: fractured rings, vertical lanes, and a reactor suspended in a storm.
const ringMat = new THREE.MeshStandardMaterial({ color: 0x161a22, metalness: .92, roughness: .18, emissive: 0x173e4b, emissiveIntensity: .75 });
const gravityRings = [];
for (let z = -302; z > -426; z -= 18) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, .22, 10, 42), ringMat); ring.position.set(0, 3, z); ring.userData.spin = (z % 36 ? 1 : -1) * (.22 + Math.random() * .22); scene.add(ring); gravityRings.push(ring);
}
addCrystal(0, 1.2, -310); addPane(-3.2, -323); addHazard(3.2, -336);
addCrystal(3.2, 3.4, -349); addPane(0, -362, true); addHazard(-3.2, -375);
addCrystal(-3.2, 5.1, -388); addPane(3.2, -401); addPane(0, -414, true);

const avatar = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, 1.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0xe7f9fa, roughness: .3, metalness: .45 })); body.position.y = 1.1; avatar.add(body);
const pack = new THREE.Mesh(new THREE.BoxGeometry(.65, .8, .3), railMat); pack.position.set(0, 1.2, .42); avatar.add(pack); scene.add(avatar);

function updateUI() {
  ui.level.textContent = `0${currentLevel} / 03`;
  ui.ammo.textContent = ammo; ui.health.textContent = health; ui.score.textContent = String(score).padStart(6, "0");
  ui.camera.textContent = currentLevel === 3 ? "CORE ORBIT" : cameraThird ? "CHASE VIEW" : "FIRST PERSON";
}

function showMessage(text) { ui.message.textContent = text; ui.message.classList.add("show"); messageTimer = 1.2; }

function resetGame() {
  ammo = 18; health = 100; score = 0; lane = 1; playerX = 0; playerY = 0; heightLane = 0;
  runZ = 7; cameraThird = false; liftTimer = 0; currentLevel = 1; transitionTarget = 0;
  for (const mesh of breakables) { mesh.visible = true; mesh.userData.alive = true; mesh.scale.setScalar(1); }
  for (const mesh of obstacles) mesh.userData.hit = false;
  for (const p of projectiles) scene.remove(p.mesh); projectiles.length = 0;
  for (const s of shards) scene.remove(s.mesh); shards.length = 0;
  ui.end.classList.remove("active"); state = "playing"; updateUI(); showMessage("SECTOR LINKED // MOVE");
}

function fire() {
  if (state !== "playing" || ammo <= 0) { if (state === "playing") showMessage("NO SPHERES"); return; }
  ammo--;
  raycaster.setFromCamera(pointer, camera);
  const origin = camera.position.clone();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.18, 14, 14), new THREE.MeshBasicMaterial({ color: 0xbaffff }));
  mesh.position.copy(origin); scene.add(mesh);
  projectiles.push({ mesh, velocity: raycaster.ray.direction.clone().multiplyScalar(34), life: 3 });
  updateUI();
}

function shatter(target) {
  if (!target.userData.alive) return;
  target.userData.alive = false; target.visible = false; score += target.userData.points;
  if (target.userData.kind === "crystal") { ammo += 3; showMessage("+3 SPHERES"); } else { showMessage("GLASS FRACTURED"); }
  const count = target.userData.kind === "crystal" ? 8 : 14;
  for (let i = 0; i < count; i++) {
    const material = new THREE.MeshBasicMaterial({ color: target.userData.kind === "crystal" ? 0xffcf66 : 0x7ef4f1, transparent: true, opacity: .78 });
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(.08 + Math.random() * .14), material);
    mesh.position.copy(target.position); scene.add(mesh);
    shards.push({ mesh, velocity: new THREE.Vector3((Math.random()-.5)*6, Math.random()*5, (Math.random()-.5)*5), life: 1.4 });
  }
  updateUI();
}

function endRun(won) {
  state = "ended"; ui.final.textContent = String(score).padStart(6, "0");
  ui.endEyebrow.textContent = won ? "SECTOR COMPLETE" : "RUN TERMINATED";
  ui.endTitle.textContent = won ? "CALIBRATION LIFT REACHED" : "CAUSEWAY FRACTURED";
  ui.endText.textContent = won ? "The Causeway, Foundry, and Inverted Core are stable. The full three-level prototype is complete." : "The tower rejected this run. Shift lanes earlier and preserve your spheres.";
  ui.end.classList.add("active");
}

function demoJump(level) {
  if (state !== "playing") return;
  currentLevel = level; playerY = 0; heightLane = 0; health = 100;
  if (level === 1) { runZ = 7; cameraThird = false; }
  if (level === 2) { runZ = -146; cameraThird = true; }
  if (level === 3) { runZ = -296; cameraThird = true; }
  showMessage(`DEMO JUMP // LEVEL ${level}`); updateUI();
}

function updateGame(dt, time) {
  energyUniforms.uTime.value = time;
  avatar.position.set(playerX, playerY, runZ + .5); avatar.visible = cameraThird || currentLevel === 3 || state === "lift";
  body.rotation.z = Math.sin(time * 9) * .035;

  if (state === "playing") {
    runZ -= dt * (currentLevel === 2 ? 9.2 : currentLevel === 3 ? 8.7 : 8.1);
    playerX += (lanes[lane] - playerX) * Math.min(1, dt * 9);
    const targetY = currentLevel === 3 ? [0, 2.1, 4.1][heightLane] : 0;
    playerY += (targetY - playerY) * Math.min(1, dt * 6);
    for (const item of obstacles) if (item.userData.mover) {
      const m = item.userData.mover; item.position.x = m.base + Math.sin(time * m.speed + m.phase) * m.range;
    }
    for (const item of obstacles) {
      const playerCentreY = playerY + 1.35;
      if (!item.userData.hit && Math.abs(item.position.z - runZ) < .65 && Math.abs(item.position.x - playerX) < 1.3 && Math.abs(item.position.y - playerCentreY) < 2.1) {
        item.userData.hit = true;
        if (item.userData.kind === "pane" && item.userData.alive) { health -= 18; shatter(item); }
        if (item.userData.kind === "hazard") { health -= 30; showMessage("INTEGRITY DAMAGED"); }
        updateUI(); if (health <= 0) endRun(false);
      }
    }
    if (currentLevel === 1 && runZ < -124) { state = "lift"; liftTimer = 0; transitionTarget = 2; showMessage("CALIBRATION LIFT // FOUNDRY"); }
    if (currentLevel === 2 && runZ < -274) { state = "lift"; liftTimer = 0; transitionTarget = 3; showMessage("GRAVITY LIFT // CORE"); }
    if (currentLevel === 3 && runZ < -422) { score += Math.max(0, ammo * 50 + health * 10); updateUI(); endRun(true); }
  } else if (state === "lift") {
    liftTimer += dt; energyUniforms.uLift.value = Math.min(1, liftTimer / 2);
    avatar.position.y = Math.min(6, liftTimer * 1.3);
    if (liftTimer > 3.6) {
      currentLevel = transitionTarget; state = "playing"; liftTimer = 0; playerY = 0; heightLane = 0;
      health = 100; ammo += 4;
      if (currentLevel === 2) { runZ = -146; cameraThird = true; showMessage("LEVEL 2 // SHIFTING FOUNDRY"); }
      if (currentLevel === 3) { runZ = -296; cameraThird = true; showMessage("LEVEL 3 // INVERTED CORE"); }
      updateUI();
    }
  }

  const forward = new THREE.Vector3(0, 1.25, runZ - 12);
  const desired = cameraThird ? new THREE.Vector3(playerX, 4.2, runZ + 8.5) : new THREE.Vector3(playerX, 1.8, runZ + .7);
  if (currentLevel === 3 && state === "playing") {
    desired.set(playerX + Math.sin(time * .55) * 6.5, playerY + 4.6 + Math.cos(time * .45), runZ + 7.2);
    forward.set(playerX, playerY + 1.5, runZ - 11);
    camera.up.lerp(new THREE.Vector3(Math.sin(runZ * .045) * .55, 1, 0).normalize(), Math.min(1, dt * 2));
  } else camera.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 4));
  if (state === "lift") {
    const liftZ = transitionTarget === 2 ? -132 : -282;
    desired.set(Math.sin(liftTimer * .9) * 8, 4 + liftTimer * .5, liftZ + 8 + Math.cos(liftTimer * .9) * 4); forward.set(0, 3.5 + liftTimer, liftZ);
  }
  camera.position.lerp(desired, 1 - Math.exp(-dt * 7)); camera.lookAt(forward);

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(breakables.filter(x => x.userData.alive), false);
  ui.reticle.classList.toggle("hot", hits.length > 0);

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; const old = p.mesh.position.clone(); p.mesh.position.addScaledVector(p.velocity, dt); p.life -= dt;
    const segment = p.mesh.position.clone().sub(old); raycaster.set(old, segment.clone().normalize()); raycaster.far = segment.length() + .35;
    const hit = raycaster.intersectObjects(breakables.filter(x => x.userData.alive), false)[0];
    if (hit) { shatter(hit.object); p.life = 0; }
    if (p.life <= 0) { scene.remove(p.mesh); projectiles.splice(i, 1); }
  }

  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]; s.velocity.y -= dt * 5; s.mesh.position.addScaledVector(s.velocity, dt); s.mesh.rotation.x += dt * 4; s.life -= dt; s.mesh.material.opacity = Math.max(0, s.life / 1.4);
    if (s.life <= 0) { scene.remove(s.mesh); shards.splice(i, 1); }
  }

  for (const crystal of breakables.filter(x => x.userData.kind === "crystal" && x.userData.alive)) crystal.rotation.y += dt * 1.8;
  for (const ring of gravityRings) { ring.rotation.z += dt * ring.userData.spin; ring.rotation.x = Math.sin(time * .4 + ring.position.z) * .18; }
  if (messageTimer > 0) { messageTimer -= dt; if (messageTimer <= 0) ui.message.classList.remove("show"); }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(.033, clock.getDelta());
  updateGame(dt, clock.elapsedTime);
  renderer.render(scene, camera);
}

document.querySelector("#startButton").addEventListener("click", () => { ui.start.classList.remove("active"); resetGame(); });
document.querySelector("#restartButton").addEventListener("click", resetGame);
document.querySelector("#soundButton").addEventListener("click", (event) => { muted = !muted; event.currentTarget.textContent = muted ? "MUTED" : "SOUND"; });
addEventListener("pointermove", (event) => { pointer.x = (event.clientX / innerWidth) * 2 - 1; pointer.y = -(event.clientY / innerHeight) * 2 + 1; });
addEventListener("pointerdown", (event) => { if (event.button === 0 && !event.target.closest("button")) fire(); });
addEventListener("keydown", (event) => {
  if (event.code === "Digit1") demoJump(1);
  if (event.code === "Digit2") demoJump(2);
  if (event.code === "Digit3") demoJump(3);
  if (event.code === "KeyA" || event.code === "ArrowLeft") lane = Math.max(0, lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") lane = Math.min(2, lane + 1);
  if ((event.code === "KeyW" || event.code === "ArrowUp") && currentLevel === 3) heightLane = Math.min(2, heightLane + 1);
  if ((event.code === "KeyS" || event.code === "ArrowDown") && currentLevel === 3) heightLane = Math.max(0, heightLane - 1);
  if (event.code === "KeyC" && (state === "playing" || state === "lift")) { cameraThird = !cameraThird; updateUI(); showMessage(cameraThird ? "CHASE CAMERA" : "FIRST-PERSON CAMERA"); }
});
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

updateUI();
camera.position.set(0, 1.8, 8);
animate();
