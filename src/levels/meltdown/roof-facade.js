/** World-space windows on the tower's existing single mesh. No probes/passes. */
import * as THREE from "../../three.js";

export function createRoofFacade() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0.12,
    emissive: 0xffffff, emissiveIntensity: 0.55, envMapIntensity: 1.1,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTowerWorld;\nvarying vec3 vTowerNormal;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vTowerWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTowerNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vTowerWorld;
        varying vec3 vTowerNormal;
        float towerHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec2 towerGrid = vec2(abs(vTowerNormal.x) > 0.5 ? vTowerWorld.z : vTowerWorld.x, vTowerWorld.y) / vec2(2.6, 3.6);
        vec2 towerCell = floor(towerGrid);
        vec2 towerUV = fract(towerGrid);
        vec2 towerAA = max(fwidth(towerGrid), vec2(0.002));
        vec2 towerPane = smoothstep(vec2(0.12), vec2(0.12) + towerAA, towerUV) *
          (1.0 - smoothstep(vec2(0.86) - towerAA, vec2(0.86), towerUV));
        float towerGlass = towerPane.x * towerPane.y * (1.0 - step(0.5, abs(vTowerNormal.y)));
        float towerVariation = towerHash(towerCell);
        vec3 towerTint = mix(vec3(0.045, 0.085, 0.12), vec3(0.10, 0.16, 0.19), towerVariation);
        // Recessed upper edge and a gentle room gradient, not a flat decal.
        float towerDepth = mix(0.45, 1.0, smoothstep(0.15, 0.38, towerUV.y));
        towerTint *= towerDepth;
        diffuseColor.rgb *= mix(vec3(0.19, 0.20, 0.21), towerTint, towerGlass);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.86, 0.16 + towerVariation * 0.15, towerGlass);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.08, 0.38, towerGlass);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        vec3 towerLight = mix(vec3(0.38, 0.58, 0.82), vec3(1.0, 0.60, 0.24), step(0.35, towerVariation));
        totalEmissiveRadiance *= towerLight * step(0.85, towerVariation) * towerGlass * towerDepth * 0.7;`)
      .replace("#include <opaque_fragment>", `
        vec3 towerN = normalize(vTowerNormal);
        vec3 towerV = normalize(cameraPosition - vTowerWorld);
        float towerFresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(towerN, towerV)), 5.0);
        vec3 towerR = reflect(-towerV, towerN);
        vec3 towerSky = mix(vec3(0.14, 0.075, 0.035), vec3(0.065, 0.14, 0.25), smoothstep(-0.3, 0.6, towerR.y));
        // Distant silhouettes in the reflected horizon. Direction-space, not
        // screen-space or time noise: they remain attached to the environment.
        float towerAzimuth = atan(towerR.z, towerR.x) * 12.0;
        float towerNeighbour = towerHash(vec2(floor(towerAzimuth), 17.0));
        float towerHorizon = 1.0 - smoothstep(-0.2, 0.05 + towerNeighbour * 0.28, towerR.y);
        towerSky *= 1.0 - 0.55 * towerHorizon;
        outgoingLight += towerSky * towerFresnel * towerGlass * (0.65 + towerVariation * 0.25);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => "roof-cinematic-facade-v1";
  return material;
}
