/** Roof tower only: parallax offices and damaged glass on the existing mesh. */
import * as THREE from "../../three.js";
import { OFFICE_GLSL, ROOF_FACADE } from "./roof-facade-rooms.js";

export function createRoofFacade() {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0.12,
    emissive: 0xffffff, emissiveIntensity: 1, envMapIntensity: 0.8,
  });
  material.name = "RoofFacadeOffices";
  material.userData.facadeTime = time;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTowerTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTowerWorld;\nvarying vec3 vTowerNormal;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vTowerWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTowerNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${OFFICE_GLSL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec3 towerN = normalize(vTowerNormal);
        vec3 towerV = normalize(cameraPosition-vTowerWorld);
        vec3 towerU = abs(towerN.x)>0.5 ? vec3(0,0,1) : vec3(1,0,0);
        vec2 towerPlane = vec2(dot(vTowerWorld,towerU),vTowerWorld.y);
        vec2 towerGrid = towerPlane / vec2(${ROOF_FACADE.tileWidth},${ROOF_FACADE.floorHeight});
        vec2 towerCell = floor(towerGrid), towerUV = fract(towerGrid);
        float towerFace = abs(towerN.x)>0.5 ? (towerN.x>0.0?0.0:1.0) : (towerN.z>0.0?2.0:3.0);
        vec4 towerRnd = towerRandom(towerCell,towerFace);
        float towerVariation = towerRnd.x;
        vec2 towerAA = max(fwidth(towerGrid),vec2(0.002));
        vec2 towerPane = smoothstep(vec2(0.12),vec2(0.12)+towerAA,towerUV)*(1.0-smoothstep(vec2(0.86)-towerAA,vec2(0.86),towerUV));
        float towerGlass = towerPane.x*towerPane.y*(1.0-step(0.5,abs(towerN.y)));
        vec2 towerAperture = clamp((towerUV-0.12)/0.74,0.0,1.0);
        float towerBroken = step(0.56,towerVariation)*(1.0-step(0.72,towerVariation));
        float towerCracked = step(0.40,towerVariation)*(1.0-step(0.56,towerVariation));
        float towerDirty = step(0.22,towerVariation)*(1.0-step(0.40,towerVariation));
        float towerHole = 0.0, towerCracks = 0.0;
        // Only damaged panes evaluate fracture geometry. Each angular sector
        // uses the line between two unequal vertices: sharp broken edges,
        // rather than a smooth circular cutout or repeated star-shaped hole.
        if(towerGlass>0.001 && towerBroken+towerCracked>0.5) {
          vec2 towerImpact = towerAperture-(vec2(0.31,0.34)+towerRnd.zw*0.31);
          float towerAngle = atan(towerImpact.y,towerImpact.x), towerRadius = length(towerImpact);
          float towerSlice = floor((towerAngle/6.2831853+0.5)*9.0);
          float towerEdgeA = 0.16+0.36*towerHash(towerCell*7.0+vec2(towerSlice,towerFace*3.0));
          float towerEdgeB = 0.16+0.36*towerHash(towerCell*7.0+vec2(mod(towerSlice+1.0,9.0),towerFace*3.0));
          float towerA = -3.14159265+towerSlice*0.6981317;
          vec2 towerDir = vec2(cos(towerA),sin(towerA));
          vec2 towerVertex = towerDir*towerEdgeA;
          vec2 towerNext = mat2(0.76604444,0.64278761,-0.64278761,0.76604444)*towerDir*towerEdgeB;
          vec2 towerEdge = towerNext-towerVertex, towerFrom = towerImpact-towerVertex;
          float towerJagged = -(towerEdge.x*towerFrom.y-towerEdge.y*towerFrom.x)/max(length(towerEdge),0.001);
          float towerHoleAA = max(length(towerAA)*0.9,0.003);
          towerHole = towerBroken*(1.0-smoothstep(-towerHoleAA,towerHoleAA,towerJagged));
          towerHole = max(towerHole,towerBroken*(1.0-step(0.16,towerRnd.z)));
          float towerCrackAA = max(length(towerAA)*2.0/max(towerRadius,0.06),0.015);
          towerCracks = (1.0-smoothstep(0.009,0.009+towerCrackAA*0.5,abs(sin(towerAngle*(3.0+floor(towerRnd.w*3.0))+towerRnd.z*4.0+towerRadius*0.9)))) *
            (1.0-towerHole)*smoothstep(0.05,0.12,towerRadius);
        }
        float towerGrit = towerNoise(towerPlane*4.0);
        float towerStain = towerNoise(vec2(towerPlane.x*2.1,towerPlane.y*0.18));
        vec3 towerTint = mix(vec3(0.026,0.055,0.075),vec3(0.07,0.12,0.14),towerRnd.z);
        towerTint *= 1.0-towerDirty*(0.3+0.4*towerStain);
        float towerInside = max(step(0.72,towerVariation)*0.78,towerCracked*0.58+towerHole)*towerGlass;
        float towerLight = towerRnd.y<0.42 ? 0.018 : towerRnd.y<0.70 ? 0.25 : towerRnd.y<0.95 ? 0.95 : 1.35;
        if(towerRnd.y>0.95) towerLight *= 0.88+0.12*sin(uTowerTime*2.1+towerVariation*9.0)*sin(uTowerTime*1.3+2.0);
        vec3 towerRoom = vec3(0.15,0.18,0.16);
        float towerDetail = 1.0-smoothstep(${ROOF_FACADE.detailNear}.0,${ROOF_FACADE.detailFar}.0,distance(cameraPosition,vTowerWorld));
        if(towerInside>0.01 && towerDetail>0.001 && towerLight>0.03) {
          vec3 towerRay = normalize(vec3(-dot(towerV,towerU),-towerV.y,max(0.06,dot(towerV,towerN))));
          towerRoom = mix(towerRoom,towerOffice(towerAperture,towerRay,towerRnd),towerDetail);
        }
        vec3 towerWall = mix(vec3(0.12,0.14,0.15),vec3(0.23,0.25,0.24),towerGrit*0.5+0.25);
        towerWall *= 0.72+0.28*towerStain;
        float towerSeam = 1.0-smoothstep(0.012,0.012+max(towerAA.y,0.002),abs(towerUV.y-0.06));
        towerWall *= 1.0-towerSeam*0.45;
        diffuseColor.rgb *= mix(towerWall,towerTint,towerGlass)*(1.0-towerInside*0.95);
        diffuseColor.rgb += towerCracks*towerGlass*0.09;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.88,0.13+towerRnd.z*0.18+towerDirty*0.4,towerGlass);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.06,0.32,towerGlass)*(1.0-towerHole);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 towerBump = towerU*(towerGrit-0.5)+vec3(0,1,0)*(towerStain-0.5);
        normal = normalize(normal+mat3(viewMatrix)*towerBump*0.14*(1.0-towerGlass));`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        vec3 towerRoomLight = mix(vec3(0.62,0.77,0.85),vec3(1.0,0.78,0.51),step(0.35,towerRnd.z));
        totalEmissiveRadiance *= towerRoom*towerRoomLight*towerLight*towerInside;`)
      .replace("#include <opaque_fragment>", `
        float towerFresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(towerN, towerV)), 5.0);
        vec3 towerR = reflect(-towerV, towerN);
        vec3 towerSky = mix(vec3(0.14, 0.075, 0.035), vec3(0.065, 0.14, 0.25), smoothstep(-0.3, 0.6, towerR.y));
        outgoingLight += towerSky*towerFresnel*towerGlass*(1.0-towerHole)*(1.0-towerInside*0.6)*(0.7+towerRnd.z*0.2);
        outgoingLight += towerCracks*towerGlass*vec3(0.06,0.09,0.11);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => "roof-facade-parallax-offices-v2";
  return material;
}
