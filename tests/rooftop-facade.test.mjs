import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "../src/three.js";
import { createRoofFacade } from "../src/levels/meltdown/roof-facade.js";
import { facadeWindowState, createRoofFacadeFrames, ROOF_FACADE, OFFICE_GLSL } from "../src/levels/meltdown/roof-facade-rooms.js";
const root = new URL("../",import.meta.url);
registerHooks({resolve(s,c,next) {
  if(s==="three") return next(new URL("src/three.js",root).href,c);
  if(s.startsWith("three/addons/")) return next(new URL(`lib/three/examples/jsm/${s.slice(13)}`,root).href,c);
  return next(s,c);
}});
const { RoofLevel } = await import("../src/levels/meltdown/roof.js");

test("deterministic upper tower includes all glass states, lights, empty and furnished rooms", () => {
  const states = new Set(), lights = new Set(); let figures=0, empty=0, total=0;
  for(let face=0;face<4;face++) for(let floor=-26;floor<0;floor++) for(let col=-6;col<=5;col++) {
    const a=facadeWindowState(col,floor,face);
    assert.deepEqual(a,facadeWindowState(col,floor,face));
    states.add(a.state);lights.add(a.light);figures+=Number(a.silhouette);empty+=Number(!a.furnished);total++;
  }
  assert.deepEqual([...states].sort(),["broken","clear","cracked","dirty","reflective"]);
  assert.deepEqual([...lights].sort(),["dark","dim","flickering","lit"]);
  assert.ok(figures>0 && figures/total<0.05,"silhouettes stay sparse");
  assert.ok(empty>0 && empty/total<0.25);
});

test("both cinematic-facing sides have varied, lit, damaged and occupied windows on the actual descent", () => {
  for(const face of [0,1]) {
    const rooms=[];
    for(let floor=-15;floor<=-1;floor++) for(let column=-3;column<=2;column++) rooms.push(facadeWindowState(column,floor,face));
    for(const type of ["broken","cracked","clear","reflective","dirty"]) assert.ok(rooms.some(r=>r.state===type),`${face}: ${type}`);
    assert.ok(rooms.some(r=>r.silhouette),`${face}: at least one background figure`);
    assert.ok(rooms.some(r=>r.light==="dark") && rooms.some(r=>r.light==="lit"));
  }
});

test("one opaque PBR material retains lighting, fog and antialiasing; no textures or passes", () => {
  const m=createRoofFacade();
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  m.onBeforeCompile(shader);
  assert.equal(m.transparent,false);assert.equal(m.map,null);assert.equal(m.emissiveMap,null);
  assert.equal(shader.uniforms.uTowerTime,m.userData.facadeTime);
  for(const token of ["towerOffice","towerHole","towerCracks","towerInside","towerDirty","towerBump","towerFresnel","towerDetail","fwidth","#include <fog_fragment>","#include <lights_fragment_maps>"]) assert.ok(shader.fragmentShader.includes(token),token);
  assert.ok(OFFICE_GLSL.includes("towerBox"));assert.ok(OFFICE_GLSL.includes("towerSegment"));
  assert.ok(ROOF_FACADE.detailFar>ROOF_FACADE.detailNear && ROOF_FACADE.detailFar<=80);
  m.dispose();
});

test("visual clock updates the shared uniform without rebuilding materials; invalid/backward dt ignored", () => {
  const facadeMaterial=createRoofFacade();
  const roof=Object.assign(Object.create(RoofLevel.prototype),{facadeMaterial});
  const ref=facadeMaterial.userData.facadeTime;
  roof.updateFacade(0.5);roof.updateFacade(0.25);roof.updateFacade(-1);roof.updateFacade(NaN);
  assert.equal(ref.value,0.75);assert.equal(facadeMaterial.userData.facadeTime,ref);
  assert.equal(facadeMaterial.version,0);facadeMaterial.dispose();
});

test("trim is a bounded non-collidable instanced batch below the playable roof and disposes", () => {
  const material=new THREE.MeshStandardMaterial();
  const mesh=createRoofFacadeFrames(material);
  assert.equal(mesh.isInstancedMesh,true);assert.equal(mesh.material,material);
  assert.ok(mesh.count>200 && mesh.count<400);assert.equal(mesh.userData.atmosphereOnly,true);
  assert.equal(mesh.castShadow,false);assert.equal(mesh.userData.breakable,undefined);
  assert.ok(mesh.boundingBox.max.y<0 && mesh.boundingBox.min.y>-100);
  assert.ok(mesh.boundingBox.max.x<16.1 && mesh.boundingBox.min.x>-16.1);
  assert.ok(mesh.boundingBox.max.z<16.1 && mesh.boundingBox.min.z>-16.1);
  const matrix=new THREE.Matrix4();
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));}
  let released=0;mesh.addEventListener("dispose",()=>released++);mesh.dispose();assert.equal(released,1);
  mesh.geometry.dispose();material.dispose();
});
