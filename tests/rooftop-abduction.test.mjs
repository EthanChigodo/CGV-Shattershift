import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from '../src/three.js';
const base = new URL('../', import.meta.url);
registerHooks({resolve(s,c,next) {
  if(s === 'three') return next(new URL('src/three.js',base).href,c);
  if(s.startsWith('three/addons/')) return next(new URL('lib/three/examples/jsm/'+s.slice(13),base).href,c);
  return next(s,c);
}});
const { FlyingZombieEncounter, ABDUCTION, FLIGHT, abductionReaction, safeAbductionSpot } = await import('../src/levels/meltdown/flying-zombies.js');
const { ReactionHits } = await import('../src/story/reaction.js');
const { MeltdownGame } = await import('../src/levels/meltdown/game.js');
const classes = new Set();
globalThis.document = {body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}};
const noop=()=>{};
function harness(key='normal', hz=60) {
  const scene=new THREE.Scene(), root=new THREE.Group(), body=new THREE.Group(), shoulder=new THREE.Object3D();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.7,1.8,.5)); mesh.position.y=.9;
  body.add(mesh,shoulder); shoulder.position.set(.3,1.45,0); root.add(body); scene.add(root);
  const weapon=new THREE.Mesh(new THREE.BoxGeometry(.25,.25,1.2));
  weapon.position.set(-.2,0,-.5); shoulder.add(weapon);
  const camera=new THREE.PerspectiveCamera(60,16/9,.1,500); camera.position.set(0,10,9);camera.lookAt(0,1,0);scene.add(camera);
  const template=new THREE.Group(); template.userData.character={}; template.add(new THREE.Mesh(new THREE.BoxGeometry(.8,1.8,.5)));
  const handL=new THREE.Bone(),handR=new THREE.Bone();handL.name='handL';handR.name='handR';template.add(handL,handR);
  const roof={assets:new Map([['patient',{template}]]),state:{ending:null},cutscene:null,breakables:[],enemies:[],solids:[],
    blocked:(p,r)=>p.x > 2-r && p.x < 4+r && p.z > 2-r && p.z < 4+r,
    groundAt:p=>Math.abs(p.x)>16||Math.abs(p.z)>16||(Math.abs(p.x-10)<.6&&Math.abs(p.z)<.6)?null:0};
  const ui={root:{hidden:true},show(){this.root.hidden=false;},hide(){this.root.hidden=true;},showReaction(s){this.spec=s;},updateReaction(s){this.progress=s;},hideReaction:noop,endReaction:noop};
  const reactions=new ReactionHits(ui,{difficulty:key});
  const g=Object.assign(Object.create(MeltdownGame.prototype),{
    scene,camera,roof,difficulty:{key},phase:'roof',paused:false,look:{yaw:0},
    hero:{position:new THREE.Vector3(),velocity:new THREE.Vector3(),knock:new THREE.Vector3(),vy:0,yaw:0},
    avatar:{root,body,shoulder,hold:1,reachUp:0,shadow:{visible:true},update:noop,flail(time,k){this.lastFlail={time,k};}},
    launcher:{rig:weapon,heatMaterials:[],recoil:0},runner:{alive:true,vitality:100,balls:10,invulnerable:0,shots:0},
    arsenal:{level:()=>0},held:new Set(),charge:{cancel:noop},hud:{toast:noop,hideBanner:noop,setPrompt:noop},ammoHint:{hide:noop},
    audio:new Proxy({},{get:(_,key)=>key === 'ctx' ? null : noop}),_patientSound:noop,
    _roofSummary(won,title,extra){this.result={won,title,extra};this.phase='over';}
  });
  const layer={ui,reactions,stopTalk:noop,player:{active:false}};
  const f=new FlyingZombieEncounter(g,{layer,random:()=>.5});g._flying=f;
  let time=0;
  const step=(n=1)=>{for(let i=0;i<n;i++){time+=1/hz;f.update(1/hz,time);}};
  const until=(fn,limit=hz*30)=>{let i=0;while(!fn()&&i++<limit)step();assert.ok(fn(),'state reached: '+f.state);};
  const attack=()=>{const a=f._spawn();assert.ok(f._warn(a));return a;};
  return {g,f,ui,reactions,roof,scene,weapon,shoulder,root,template,step,until,attack};
}

for(const [key,count,warning,time,presses] of [['easy',1,3.5,5,6],['normal',2,3,4,8],['hard',2,2,2.5,10]]) {
  test(`${key}: capped separate models, animated wings and exact QTE balancing`,()=>{
    const h=harness(key); const {f,roof,reactions}=h;
    assert.deepEqual([f.tune.maximum,f.tune.warning,f.tune.qte,f.tune.presses],[count,warning,time,presses]);
    for(let i=0;i<5;i++)f._spawn();
    assert.equal(f.activeCount,count);
    const actor=f.actors[0];assert.notEqual(actor.model,h.template);
    assert.equal(actor.model.children[0].geometry,h.template.children[0].geometry,'existing model geometry reused');
    assert.equal(roof.enemies.length,0);assert.equal(roof.breakables.length,0);
    const flap=actor.wings[0].rotation.y;h.step();assert.notEqual(actor.wings[0].rotation.y,flap);
    actor.body.updateMatrixWorld(true);
    const bodyUp=new THREE.Vector3(0,1,0).transformDirection(actor.body.matrixWorld);
    assert.ok(Math.abs(bodyUp.y)<0.2,'the flying body stays close to horizontal');
    assert.ok(actor.rig.bones.handL.children.some(o=>o.name==='FlyingZombieClaw'),'left claw follows its animated hand');
    assert.ok(actor.rig.bones.handR.children.some(o=>o.name==='FlyingZombieClaw'),'right claw follows its animated hand');
    assert.ok(f._warn(actor));assert.equal(f._warn(f.actors[1]??actor),false,'only one attacker');
    reactions.start(abductionReaction(ABDUCTION[key],reactions.options));
    for(let i=0;i<presses-1;i++){reactions.keyDown('Space');reactions.keyUp('Space');reactions.update(.1);}
    assert.equal(reactions.state,'running');
    for(let i=0;i<20;i++)reactions.keyDown('Space',true);
    assert.equal(reactions.state,'running','holding does not repeat');
    reactions.keyDown('Space');assert.equal(reactions.state,'success');
    f.dispose();
  });
}

test('random intervals are bounded and spawning begins after the arrival grace',()=>{
  const h=harness('normal');h.f.attackIn=1000;
  h.step(5*60);assert.equal(h.f.activeCount,0);
  h.step(4*60);assert.equal(h.f.activeCount,1);assert.ok(h.f.spawnIn>=7&&h.f.spawnIn<=14);
  h.step(14*60);assert.equal(h.f.activeCount,2);
  h.step(30*60);assert.equal(h.f.activeCount,2);h.f.dispose();
});

test('target tracks briefly then locks; moving out causes a miss without dropping the gun',()=>{
  const h=harness();h.attack();h.g.hero.position.x=1;h.step(20);assert.equal(h.f.target.x,1);
  h.step(40);const target=h.f.target.clone();h.g.hero.position.x=7;
  h.until(()=>h.f.state==='idle');assert.ok(h.f.target.equals(target));
  assert.equal(h.weapon.parent,h.shoulder);assert.equal(h.f.weapon,null);
  assert.ok(h.f.attackIn>=12);assert.equal(h.g.phase,'roof');assert.equal(h.f.marker.visible,false);h.f.dispose();
});

for(const hz of [30,60,144]) test(`grab, safe drop, escape, proximity E pickup and cleanup at ${hz}Hz`,()=>{
  const h=harness('normal',hz);h.attack();
  h.until(()=>h.f.state==='dive');
  h.scene.updateMatrixWorld(true);const start=h.weapon.getWorldPosition(new THREE.Vector3()), q=h.weapon.getWorldQuaternion(new THREE.Quaternion());
  h.until(()=>h.f.state==='grab');
  assert.equal(h.g.phase,'roofAbduct');assert.equal(h.root.parent,h.f.attacker.carry);
  assert.ok(h.weapon.position.distanceTo(start)<1e-8);assert.ok(h.weapon.quaternion.angleTo(q)<1e-7);
  assert.equal(h.weapon.parent,h.scene);assert.equal(h.f.weapon,h.weapon);
  h.g._shoot();assert.equal(h.g.runner.balls,10,'no shooting while abducted');
  const grabber=h.f.attacker;grabber.lastPose=null;grabber.rig.pose=(pose)=>{grabber.lastPose=pose;};
  h.until(()=>h.f.state==='carried');const y=h.g.hero.position.y;h.step(Math.ceil(hz*.5));assert.ok(h.g.hero.position.y>y);
  assert.ok(Math.abs(h.root.rotation.x-Math.PI/2)<0.06,'player uses the horizontal fall pose while carried');
  assert.equal(h.g.avatar.body.position.y,-1,'captured body pivots around the hips');
  assert.ok(h.g.avatar.lastFlail?.k>0.75,'the existing rooftop-fall flail animates the captured player');
  assert.ok(grabber.lastPose?.reach>0.5,'the zombie reaches with its animated arms during capture');
  assert.ok(h.f.drop.landed);const floorWeapon=h.weapon.position.clone();
  assert.ok(new THREE.Box3().setFromObject(h.weapon).min.y>=.04);
  for(let i=0;i<8;i++){h.reactions.keyDown('Space');h.reactions.keyUp('Space');h.step();}
  h.until(()=>h.g.phase==='roof');assert.equal(h.g.hero.position.y,0);
  assert.equal(h.root.parent,h.scene);assert.equal(h.g.avatar.hold,0);assert.ok(h.weapon.position.equals(floorWeapon));
  assert.equal(h.roof.groundAt(h.g.hero.position),0);assert.equal(h.roof.blocked(h.g.hero.position,.45),false);
  h.g._shoot();assert.equal(h.g.runner.balls,10,'unarmed shooting blocked');
  h.g.hero.position.set(-12,0,-12);assert.equal(h.f.pickup(),false);
  h.g.hero.position.copy(h.f.drop.to).setY(0);
  assert.ok(h.f.pickupPrompt.includes('E'));assert.equal(h.g.onKeyDown({code:'KeyE',repeat:false}),true);
  assert.equal(h.f.weapon,null);assert.equal(h.weapon.parent,h.shoulder);assert.equal(h.g.avatar.hold,1);
  const group=h.f.root;h.f.dispose();h.f.dispose();assert.equal(group.parent,null);assert.equal(h.f.actors.length,0);
});

for(const key of ['easy','normal','hard']) test(`${key}: QTE failure carries attached player along a 45-degree path past a fixed oblique camera`,()=>{
  const h=harness(key);h.attack();h.until(()=>h.f.state==='sky');
  const carrier=h.f.attacker, carry=h.root.parent;assert.equal(carry,carrier.carry);
  assert.ok(Math.abs(h.f.skyVelocity.y-Math.hypot(h.f.skyVelocity.x,h.f.skyVelocity.z))<1e-8,'vertical and horizontal speeds make a 45-degree path');
  h.until(()=>h.f.skyTime>FLIGHT.skyTransition+.05);
  const position=h.g.camera.position.clone(),rotation=h.g.camera.quaternion.clone(),y=h.g.hero.position.y;
  const cameraUp=h.g.camera.getWorldDirection(new THREE.Vector3()).y;
  assert.ok(cameraUp>.1&&cameraUp<.35,'camera looks toward the sky without pointing straight up');
  const start=carrier.root.position.clone();h.step(30);assert.ok(h.g.hero.position.y>y);assert.equal(h.root.parent,carry);
  const moved=carrier.root.position.clone().sub(start);
  assert.ok(Math.abs(moved.y-Math.hypot(moved.x,moved.z))<0.03,'failed capture moves up and outward at the same speed');
  assert.ok(h.g.camera.position.equals(position));assert.ok(h.g.camera.quaternion.equals(rotation));
  h.until(()=>h.f.state==='hold');assert.ok(h.f.vanishedAt<FLIGHT.skyFallback,'visibility succeeds without fallback');
  h.step(100);assert.equal(h.g.result,undefined);
  h.until(()=>h.f.state==='done');
  assert.equal(h.g.result.title,'YOU WERE CAPTURED!');assert.equal(h.g.result.extra.deathScene,'capture');
  assert.ok(h.f.skyTime-h.f.vanishedAt>=2&&h.f.skyTime-h.f.vanishedAt<2.02);
  assert.ok(h.g.camera.position.equals(position));assert.ok(h.g.camera.quaternion.equals(rotation));
  h.f.dispose();assert.equal(h.root.parent,h.scene);assert.equal(h.weapon.parent,h.shoulder);assert.equal(h.ui.root.hidden,true);
});

test('failed capture bearings vary, and an active second flyer keeps moving behind Game Over',()=>{
  const bearings=[];
  for(const randomValue of [0.1,0.9]){
    const h=harness();
    h.f.attacker=h.f._spawn();h.f.attacker.root.position.set(8,5,0);h.f.landingSpot=new THREE.Vector3();
    h.f.random=()=>randomValue;h.f._startSky();bearings.push(h.f.skyDirection.clone());h.f.dispose();
  }
  assert.ok(bearings[0].angleTo(bearings[1])>0.5,'each abduction can take a different outward bearing');

  const h=harness();h.attack();h.f._spawn();h.until(()=>h.f.state==='sky');
  h.until(()=>h.f.state==='done');
  const background=h.f.actors.find(a=>a!==h.f.attacker&&a.active&&a.state==='circle');assert.ok(background);
  const position=background.root.position.clone(),wing=background.wings[0].rotation.y;
  h.f.update(1/60,h.f.time+1/60);
  assert.ok(!background.root.position.equals(position),'secondary flyer continues circling behind the summary');
  assert.notEqual(background.wings[0].rotation.y,wing,'secondary flyer continues flapping behind the summary');
  h.f.dispose();
});

test('safe placements avoid cover, hatch holes and ledges; no valid spot prevents grabbing',()=>{
  const h=harness();
  for(const origin of [new THREE.Vector3(3,0,3),new THREE.Vector3(10,0,0),new THREE.Vector3(17,0,1)]){
    const p=safeAbductionSpot(h.roof,origin);assert.ok(p);assert.ok(Math.abs(p.x)<=13.5&&Math.abs(p.z)<=13.5);assert.equal(h.roof.blocked(p,1.1),false);assert.equal(h.roof.groundAt(p),0);
  }
  assert.equal(safeAbductionSpot({blocked:()=>true,groundAt:()=>0},new THREE.Vector3()),null);
  h.f.dispose();
});

test('pause freezes carry, weapon and QTE; edge fall keeps the existing dropped weapon separate',()=>{
  const h=harness();h.attack();h.until(()=>h.f.state==='carried');
  h.g.setPaused(true);const y=h.g.hero.position.y,t=h.reactions._s.total,weapon=h.weapon.position.clone();h.step(60);
  h.reactions._onKeyDown({code:'Space',repeat:false});assert.equal(h.reactions._s.presses,0);
  assert.equal(h.reactions._s.total,t);assert.equal(h.g.hero.position.y,y);assert.ok(h.weapon.position.equals(weapon));
  h.g.setPaused(false);assert.equal(h.reactions.paused,false);
  for(let i=0;i<8;i++){h.reactions.keyDown('Space');h.reactions.keyUp('Space');}h.until(()=>h.g.phase==='roof');
  const groundParent=h.weapon.parent;h.g.phase='roofFall';h.step();assert.equal(h.f.weapon,h.weapon);assert.equal(h.weapon.parent,groundParent);assert.equal(h.f.marker.visible,false);
  h.f.dispose();assert.equal(classes.size,0);
});


test('accessibility reuses long windows, hold conversion and pad glyph mapping without changing shared options',()=>{
  for(const key of ['easy','normal','hard']){
    const options={difficulty:key,longWindows:true,holdInsteadOfMash:true,pad:true};
    const r=new ReactionHits(null,options);const snapshot={...r.options};
    r.start(abductionReaction(ABDUCTION[key],r.options));
    assert.equal(r.wants.kind,'hold');assert.deepEqual(r.wants.keys,['PadRT']);
    assert.equal(r._s.time,ABDUCTION[key].qte*1.6);assert.deepEqual(r.options,snapshot);
    r.keyDown('PadRT');for(let i=0;i<600&&r.running;i++)r.update(1/60);
    assert.equal(r.state,'success');r.dispose();
  }
});

test('repeated captures reuse one dropped weapon and cleanup cancels an active QTE',()=>{
  const h=harness();h.attack();h.until(()=>h.f.state==='carried');
  for(let i=0;i<8;i++){h.reactions.keyDown('Space');h.reactions.keyUp('Space');}
  h.until(()=>h.f.state==='idle');const weapon=h.f.weapon,drop=h.f.drop;
  h.attack();h.until(()=>h.f.state==='carried');
  assert.equal(h.f.weapon,weapon);assert.equal(h.f.drop,drop);
  let count=0;h.scene.traverse(o=>{if(o===weapon)count++;});assert.equal(count,1);
  assert.equal(h.g.onKeyDown({code:'KeyV'}),true,'view shortcuts are captured');
  assert.equal(h.g.onKeyDown({code:'Digit1'}),true,'debug scene switches are captured');
  assert.equal(h.g.onKeyDown({code:'Escape'}),false,'pause remains available');
  h.g._clearFlyingZombies();assert.equal(h.g._flying,null);assert.equal(h.reactions.state,'idle');
  assert.equal(h.root.parent,h.scene);assert.equal(h.weapon.parent,h.shoulder);
});

test('sky visibility fallback cannot stall the capture death and still holds two seconds',()=>{
  const h=harness();h.attack();h.until(()=>h.f.state==='sky');h.f._outOfSkyFrame=()=>false;
  h.until(()=>h.f.state==='done');
  assert.ok(h.f.vanishedAt>=12&&h.f.vanishedAt<12.02);
  assert.ok(h.f.skyTime>=14&&h.f.skyTime<14.04);h.f.dispose();
});
