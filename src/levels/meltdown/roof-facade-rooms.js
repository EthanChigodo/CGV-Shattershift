/** Roof-only virtual offices and visual trim; no gameplay objects or assets. */
import * as THREE from "../../three.js";

export const ROOF_FACADE = Object.freeze({ tileWidth: 2.6, floorHeight: 3.6, detailNear: 45, detailFar: 75, trimFloors: 26 });

/** Integer-valued float hash mirrored in GLSL, stable across faces/floors. */
export function facadeWindowState(column, floor, face = 0) {
  const mod = v => ((v % 997) + 997) % 997;
  let seed = mod(column * 157 + floor * 311 + face * 53 + 991);
  seed = mod(seed * seed + seed * 23);
  const next = () => { seed = mod(seed * 37 + 17); return seed / 997; };
  const state = next(), light = next(), layout = next(), actor = next();
  return { state: state < 0.22 ? "reflective" : state < 0.40 ? "dirty" : state < 0.56 ? "cracked" : state < 0.72 ? "broken" : "clear",
    light: light < 0.42 ? "dark" : light < 0.70 ? "dim" : light < 0.95 ? "lit" : "flickering",
    furnished: layout >= 0.15, silhouette: actor > 0.94 && light > 0.5 && state > 0.4 };
}

export const OFFICE_GLSL = /* glsl */ `
uniform float uTowerTime;
varying vec3 vTowerWorld;
varying vec3 vTowerNormal;
float towerHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float towerNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(towerHash(i),towerHash(i+vec2(1,0)),f.x),mix(towerHash(i+vec2(0,1)),towerHash(i+1.0),f.x),f.y);
}
vec4 towerRandom(vec2 cell, float face) {
  float seed=mod(cell.x*157.0+cell.y*311.0+face*53.0+991.0,997.0);
  seed=mod(seed*seed+seed*23.0,997.0);
  seed=mod(seed*37.0+17.0,997.0); float a=seed/997.0;
  seed=mod(seed*37.0+17.0,997.0); float b=seed/997.0;
  seed=mod(seed*37.0+17.0,997.0); float c=seed/997.0;
  seed=mod(seed*37.0+17.0,997.0); return vec4(a,b,c,seed/997.0);
}
// Analytic ray/box projection in one virtual room, not ray marching or an
// extra scene render. Reusable boxes give desks/chairs readable 3D parallax.
void towerBox(vec3 ro,vec3 rd,vec3 inv,vec3 lo,vec3 hi,vec3 colour,inout float nearest,inout vec3 tint) {
  vec3 a=(lo-ro)*inv,b=(hi-ro)*inv,n=min(a,b),f=max(a,b);
  float enter=max(max(n.x,n.y),n.z),leave=min(min(f.x,f.y),f.z);
  if(enter>0.0 && leave>=enter && enter<nearest) {
    nearest=enter;
    vec3 hit=ro+rd*enter,edge=min(abs(hit-lo),abs(hit-hi));
    float shade=edge.y<min(edge.x,edge.z)?1.0:edge.x<edge.z?0.62:0.82;
    tint=colour*shade;
  }
}
float towerSegment(vec2 p,vec2 a,vec2 b) {
  vec2 d=b-a; return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.0,1.0));
}
vec3 towerOffice(vec2 aperture,vec3 rd,vec4 random) {
  vec3 size=vec3(2.25,2.8,3.4+random.z*1.6);
  vec3 ro=vec3(aperture*size.xy,0.001);
  vec3 inv=mix(vec3(-1),vec3(1),step(vec3(0),rd))/max(abs(rd),vec3(0.0001));
  vec3 farT=max(-ro*inv,(size-ro)*inv);
  float nearest=min(min(farT.x,farT.y),farT.z);
  vec3 hit=ro+rd*nearest,room=vec3(0.36,0.39,0.34);
  if(farT.y<min(farT.x,farT.z)) {
    float tile=mod(floor(hit.x*2.0)+floor(hit.z*2.0),2.0);
    room=rd.y<0.0?mix(vec3(0.18,0.15,0.12),vec3(0.25,0.22,0.18),tile):vec3(0.20,0.23,0.22);
  } else {
    room*=0.65+0.35*smoothstep(0.0,2.4,hit.y);
    room*=0.75+0.25*(1.0-hit.z/size.z);
    room*=mix(0.5,1.0,smoothstep(0.08,0.14,hit.y));
  }
  if(random.z>=0.15 && random.z<0.75) {
    float x=random.z<0.45?1.35:0.85;
    towerBox(ro,rd,inv,vec3(x-0.68,0.74,1.9),vec3(x+0.68,0.84,2.7),vec3(0.30,0.21,0.12),nearest,room);
    towerBox(ro,rd,inv,vec3(x-0.60,0.0,2.0),vec3(x-0.52,0.74,2.6),vec3(0.10),nearest,room);
    towerBox(ro,rd,inv,vec3(x+0.52,0.0,2.0),vec3(x+0.60,0.74,2.6),vec3(0.10),nearest,room);
    towerBox(ro,rd,inv,vec3(x-0.30,0.9,2.35),vec3(x+0.30,1.35,2.44),vec3(0.025,0.035,0.04),nearest,room);
    towerBox(ro,rd,inv,vec3(x-0.25,0.95,2.34),vec3(x+0.25,1.30,2.35),vec3(0.10,0.31,0.37),nearest,room);
    towerBox(ro,rd,inv,vec3(x-0.04,0.84,2.38),vec3(x+0.04,0.90,2.42),vec3(0.06),nearest,room);
    // Seat/back/pedestal, offset from the desk rather than covering it.
    towerBox(ro,rd,inv,vec3(0.35,0.43,1.05),vec3(0.94,0.53,1.65),vec3(0.055,0.10,0.11),nearest,room);
    towerBox(ro,rd,inv,vec3(0.35,0.53,1.05),vec3(0.94,1.08,1.15),vec3(0.06,0.13,0.14),nearest,room);
    towerBox(ro,rd,inv,vec3(0.61,0.0,1.28),vec3(0.68,0.43,1.35),vec3(0.08),nearest,room);
  } else if(random.z>=0.75) {
    towerBox(ro,rd,inv,vec3(0.12,0.0,size.z-0.55),vec3(0.22,2.1,size.z-0.1),vec3(0.20,0.15,0.10),nearest,room);
    towerBox(ro,rd,inv,vec3(1.25,0.0,size.z-0.55),vec3(1.35,2.1,size.z-0.1),vec3(0.20,0.15,0.10),nearest,room);
    towerBox(ro,rd,inv,vec3(0.22,0.65,size.z-0.55),vec3(1.25,0.73,size.z-0.1),vec3(0.32,0.26,0.17),nearest,room);
    towerBox(ro,rd,inv,vec3(0.22,1.35,size.z-0.55),vec3(1.25,1.43,size.z-0.1),vec3(0.32,0.26,0.17),nearest,room);
    towerBox(ro,rd,inv,vec3(0.3,0.73,size.z-0.45),vec3(0.8,1.0,size.z-0.15),vec3(0.18,0.21,0.17),nearest,room);
    towerBox(ro,rd,inv,vec3(1.6,0.0,1.4),vec3(1.68,1.5,2.8),vec3(0.21,0.27,0.25),nearest,room);
  }
  // Sparse non-gameplay shadow cards walk BEHIND furniture. No enemies,
  // animation mixers, collisions, allocations or independent timers.
  if(random.w>0.94 && random.y>0.5) {
    float plane=1.65/rd.z;
    if(plane<nearest) {
      vec2 p=(ro+rd*plane).xy;
      float walk=uTowerTime*0.65+random.x*12.0;
      float x=1.12+sin(walk*0.31)*0.65;
      float head=length((p-vec2(x,1.62))/vec2(0.11,0.14))-1.0;
      float torso=max(abs(p.x-x)-0.15,abs(p.y-1.20)-0.30);
      float legs=min(towerSegment(p,vec2(x-0.07,0.94),vec2(x-0.13+sin(walk)*0.12,0.15)),towerSegment(p,vec2(x+0.07,0.94),vec2(x+0.13-sin(walk)*0.12,0.15)))-0.055;
      float arms=min(towerSegment(p,vec2(x-0.15,1.4),vec2(x-0.27,0.87+sin(walk)*0.06)),towerSegment(p,vec2(x+0.15,1.4),vec2(x+0.27,0.84-sin(walk)*0.06)))-0.045;
      float shadow=1.0-smoothstep(-0.015,0.02,min(min(head*0.11,torso),min(legs,arms)));
      room=mix(room,vec3(0.012,0.02,0.018),shadow*0.9);
    }
  }
  return room;
}
`;

/** Visual-only mullions/lintels over the first ~94 m, ONE instanced draw. */
export function createRoofFacadeFrames(material) {
  const placements = [];
  const half = 15.9;
  const height = ROOF_FACADE.trimFloors * ROOF_FACADE.floorHeight;
  const put = (side, along, y, width, frameHeight) => {
    const onX = side < 2;
    const sign = side % 2 === 0 ? 1 : -1;
    placements.push({
      x: onX ? sign * (half + 0.045) : along,
      y,
      z: onX ? along : sign * (half + 0.045),
      w: onX ? 0.11 : width,
      h: frameHeight,
      d: onX ? width : 0.11,
    });
  };
  for (let side = 0; side < 4; side++) {
    for (let floor = 1; floor <= ROOF_FACADE.trimFloors; floor++) {
      for (const edge of [0.12, 0.86]) put(side, 0, (-floor + edge) * ROOF_FACADE.floorHeight, half * 2, 0.065);
    }
    for (let column = -7; column <= 6; column++) for (const edge of [0.12, 0.86]) {
      const along = (column + edge) * ROOF_FACADE.tileWidth;
      if (Math.abs(along) < half - 0.15) put(side, along, -height / 2 - 0.6, 0.055, height);
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, placements.length);
  mesh.name = "RoofFacadeFrames";
  mesh.userData.atmosphereOnly = true;
  const transform = new THREE.Object3D();
  placements.forEach((p, i) => {
    transform.position.set(p.x, p.y, p.z);
    transform.scale.set(p.w, p.h, p.d);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
