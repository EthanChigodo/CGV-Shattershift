// Run: node --test tests/rooftop-fall.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from '../src/three.js';
import { FallScene } from '../src/levels/meltdown/fall-scene.js';

const rootURL = new URL('../', import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return next(new URL('src/three.js', rootURL).href, context);
  if (specifier.startsWith('three/addons/')) return next(new URL(`lib/three/examples/jsm/${specifier.slice(13)}`, rootURL).href, context);
  return next(specifier, context);
} });
const { MeltdownGame } = await import('../src/levels/meltdown/game.js');

globalThis.window = { addEventListener() {}, removeEventListener() {} };

function scene(face, exterior = true) {
  const parent = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 11.5, 8.5);
  camera.lookAt(0, 0, 0);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.6));
  mesh.position.y = 1;
  body.add(mesh);
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.3, 1.45, 0.05);
  body.add(shoulder);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.25));
  weapon.position.set(-0.2, 0, -0.5);
  weapon.rotation.x = 0.2;
  shoulder.add(weapon);
  const from = face.clone().multiplyScalar(16.2).setY(-0.4);
  root.position.copy(from);
  parent.add(root, camera);
  parent.updateMatrixWorld(true);
  const weaponStart = weapon.getWorldPosition(new THREE.Vector3());
  const calls = [];
  const avatar = {root, body, shadow: {visible:true}, flail: (...args) => calls.push(args)};
  const fall = new FallScene({parent, camera, avatar});
  // Exercise real start/update/restore without DOM-only texture creation.
  fall._build = () => {
    fall.group = new THREE.Group();
    fall.facade = new THREE.Object3D();
    fall.shaft = new THREE.Object3D();
    fall.facadeMaterial = {map:{repeat:{}}, emissiveMap:{repeat:{}}};
    fall.emberState = Array.from({length:56}, () => ({}));
    fall.smokeState = Array.from({length:14}, () => ({}));
    parent.add(fall.group);
  };
  fall._spawnEmber = fall._spawnSmoke = fall._updateParticles = () => {};
  let finishes = 0;
  fall.start({from, velocity: face.clone().multiplyScalar(4).setY(-2), face, exterior, weapon, onDone: () => finishes++});
  return {fall, camera, avatar, parent, shoulder, weapon, weaponStart, calls, finishes: () => finishes};
}

for (const hz of [30, 60, 144]) for (const normal of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
  test(`exterior ${normal}: faster weapon, facade, fixed camera and exit-based hold at ${hz}Hz`, () => {
    const face = new THREE.Vector3(...normal);
    const s = scene(face);
    const {fall:f, camera:c, weapon:w} = s;
    assert.equal(w.parent, s.parent);
    assert.ok(w.position.distanceTo(s.weaponStart) < 1e-10, 'detachment preserves position');
    const orientation = w.quaternion.clone();
    const dt = 1 / hz;
    let pose, position, fov, playerAtFreeze, weaponExit = null;
    let previousSpeed = Infinity;
    for (let i = 0; i < hz * 11 && f.active; i++) {
      const previousPosition = c.position.clone();
      f.update(dt, f.t + dt);
      const speed = c.position.distanceTo(previousPosition) / dt;
      if (f.t >= 1.15) assert.ok(speed <= previousSpeed + 1e-8, 'braking slows continuously without a stop/restart hitch');
      previousSpeed = speed;
      if (f.t > 0.5 && f.t < 1.1) {
        assert.ok(c.getWorldDirection(new THREE.Vector3()).dot(face) < -0.95, 'faces facade');
        assert.ok(c.position.dot(face) > 15.9, 'outside wall');
        assert.ok(f._weaponVelocity.y < f.body.v.y, 'weapon descends faster');
      }
      if (f.t >= 0.4 && weaponExit === null && w.position.clone().project(c).y < -1.3) weaponExit = f.t;
      if (f.frozen) {
        if (!pose) { pose=c.quaternion.clone(); position=c.position.clone(); fov=c.fov; playerAtFreeze=f.body.p.y; }
        assert.ok(c.position.equals(position), 'position stays exactly fixed');
        assert.ok(c.quaternion.equals(pose), 'orientation stays exactly fixed');
        assert.equal(c.fov, fov);
      }
    }
    assert.ok(f.done);
    assert.equal(s.finishes(),1);
    assert.ok(f.exitedAt < 8, 'actual visibility succeeds before fallback');
    assert.ok(weaponExit > 0.4 && weaponExit < f.exitedAt, 'weapon visible initially and exits first');
    assert.ok(f.body.p.y < playerAtFreeze - 10, 'player continues descending');
    assert.ok(f.t - f.exitedAt >= 2 && f.t - f.exitedAt < 2 + dt * 1.01);
    assert.equal(f.black,0);
    assert.equal(f.fogBoost,0);
    assert.ok(!w.quaternion.equals(orientation), 'weapon tumbles');
    f.update(1,20);
    assert.equal(s.finishes(),1, 'summary only once');
    f.restore();
    assert.equal(w.parent,s.shoulder);
    assert.deepEqual(w.position.toArray(),[-0.2,0,-0.5]);
    assert.equal(f.weapon,null);
    assert.equal(f.holdsCamera,false);
  });
}

test('player trajectory, tumble, flail calls and body pivot match the original fall exactly', () => {
  const normal = new THREE.Vector3(1,0,0);
  const improved = scene(normal);
  const original = scene(normal,false);
  for (let i=1;i<=170;i++) {
    for (const s of [improved,original]) s.fall.update(1/60,i/60);
    assert.deepEqual(improved.fall.body.p.toArray(),original.fall.body.p.toArray());
    assert.deepEqual(improved.fall.body.v.toArray(),original.fall.body.v.toArray());
    assert.deepEqual(improved.fall.body.q.toArray(),original.fall.body.q.toArray());
    assert.deepEqual(improved.avatar.body.position.toArray(),original.avatar.body.position.toArray());
  }
  assert.deepEqual(improved.calls,original.calls);
  assert.equal(original.weapon.parent,original.shoulder);
});

test('failed visibility has a bounded fallback, then still waits two seconds', () => {
  const {fall:f, finishes} = scene(new THREE.Vector3(1,0,0));
  f._belowFrame = () => false;
  for (let i=0;i<650 && f.active;i++) f.update(1/60,i/60);
  assert.ok(f.exitedAt >= 8 && f.exitedAt < 8.02);
  assert.ok(f.t >= 10 && f.t < 10.05);
  assert.equal(finishes(),1);
});

test('ordinary lethal rooftop damage retains its summary path and does not start a fall', () => {
  let summary;
  const noop = () => {};
  const game = Object.assign(Object.create(MeltdownGame.prototype), {
    phase:'roof', clock:10, roofClock:5, trauma:0,
    runner:{invulnerable:0,vitality:1,hits:0,alive:true,downs:0,balls:5},
    hero:{position:new THREE.Vector3(),knock:new THREE.Vector3()},
    avatar:{root:new THREE.Object3D()}, arsenal:{absorb:() => false},
    difficulty:{roof:{damage:1}}, roof:{state:{falls:0}},
    hud:{flashDamage:noop,toast:noop}, audio:{stumble:noop}, debris:{sparks:noop},
    _playFall:() => assert.fail('ordinary damage must not enter the cinematic'),
    _end:(...args) => { summary=args; },
  });
  game._roofHit({damage:100,from:new THREE.Vector3(1,0,0),knock:2,source:'blast'});
  assert.equal(game.runner.alive,false);
  assert.equal(summary[0],false);
  assert.equal(summary[1],'THEY GOT YOU');
  assert.equal(summary[4],null, 'ordinary death has no fall presentation marker');
  assert.equal(game._fall,undefined);
});

