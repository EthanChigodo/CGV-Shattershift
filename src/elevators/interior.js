/**
 * The elevator interior - one reusable cabin for every ride between levels
 * (Tebogo's task sheet: "one reusable scene for every transition and for the
 * unlimited mode").
 *
 * An enclosed freight lift: brushed-steel walls, handrails, a rubber floor,
 * two sliding doors, a floor display over them, a button panel, a ceiling
 * light that can flicker, a speaker grille, and a security camera in the
 * corner with a blinking red light. The walls carry the environmental
 * storytelling the sheet asks for: tally marks and messages scratched by
 * earlier test subjects, and a torn lab badge on the floor.
 *
 * Every surface is a canvas texture drawn here - no files to load.
 *
 * Local frame: floor at y = 0, centred on x = z = 0. The doors are the -Z
 * wall (someone standing in the cabin looking at the doors faces -Z, which
 * is the Performer's yaw 0). One unit is one metre.
 *
 *   const cabin = buildInterior(owned);
 *   scene.add(cabin.root);
 *   cabin.setDoors(0..1);       // 0 shut, 1 open
 *   cabin.setLight(0..1);       // the ceiling light
 *   cabin.setFloor("12", "up"); // the display over the doors
 *   cabin.update(dt, time, speed);
 */

import * as THREE from "../three.js";

/** Inside dimensions. */
export const INTERIOR = { halfWidth: 1.2, halfDepth: 1.1, height: 2.6 };

function canvasTexture(owned, w, h, draw, { repeat = null } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d"), w, h);
  const texture = owned.add(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  return texture;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Brushed steel panels: fine horizontal streaks, panel seams, rivets. */
function steel(ctx, w, h, rand) {
  ctx.fillStyle = "#7c8287";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    const v = 110 + Math.floor(rand() * 30);
    ctx.fillStyle = `rgba(${v},${v + 4},${v + 8},0.35)`;
    ctx.fillRect(0, y, w, 1);
  }
  // Panel seams: two panels across, a horizontal seam low down.
  ctx.fillStyle = "rgba(20,22,24,0.8)";
  ctx.fillRect(w / 2 - 2, 0, 4, h);
  ctx.fillRect(0, h * 0.72, w, 3);
  ctx.fillStyle = "rgba(230,235,240,0.25)";
  ctx.fillRect(w / 2 + 2, 0, 1, h);
  // Rivets along the seams.
  for (let y = 18; y < h; y += 44) {
    for (const x of [w / 2 - 12, w / 2 + 12]) {
      ctx.fillStyle = "#4b5054";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Grime at the bottom.
  const g = ctx.createLinearGradient(0, h * 0.75, 0, h);
  g.addColorStop(0, "rgba(40,32,24,0)");
  g.addColorStop(1, "rgba(40,32,24,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
}

/** Scratched into the steel: thin bright strokes with a dark edge. */
function scratch(ctx, draw) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(20,20,20,0.5)";
  ctx.lineWidth = 3.4;
  draw();
  ctx.strokeStyle = "rgba(235,238,240,0.8)";
  ctx.lineWidth = 1.6;
  draw();
  ctx.restore();
}

function scratchedText(ctx, text, x, y, size, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${size}px "Courier New", monospace`;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(20,20,20,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeText(text, 0, 0);
  ctx.strokeStyle = "rgba(235,238,240,0.85)";
  ctx.lineWidth = 1.2;
  ctx.strokeText(text, 0, 0);
  ctx.restore();
}

export function buildInterior(owned) {
  const root = new THREE.Group();
  root.name = "ElevatorInterior";
  const { halfWidth: W, halfDepth: D, height: H } = INTERIOR;
  const rand = seeded(7);
  const box = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const plane = owned.add(new THREE.PlaneGeometry(1, 1));

  // ---- Materials ----------------------------------------------------------
  const wallPlain = canvasTexture(owned, 512, 512, (ctx, w, h) => steel(ctx, w, h, rand));
  // The left wall: tally marks and messages from the subjects before.
  const wallStory = canvasTexture(owned, 512, 512, (ctx, w, h) => {
    steel(ctx, w, h, rand);
    // Tally marks, in fives, at shoulder height.
    for (let group = 0; group < 6; group += 1) {
      const gx = 40 + group * 46;
      const gy = 150 + (group % 2) * 6;
      scratch(ctx, () => {
        ctx.beginPath();
        for (let i = 0; i < 4; i += 1) {
          ctx.moveTo(gx + i * 7, gy);
          ctx.lineTo(gx + i * 7 + 2, gy + 34);
        }
        ctx.moveTo(gx - 4, gy + 26);
        ctx.lineTo(gx + 28, gy + 6);
        ctx.stroke();
      });
    }
    scratchedText(ctx, "S-04 WAS HERE", 60, 270, 30, -0.06);
    scratchedText(ctx, "THEY LIE ABOUT THE ROOF", 250, 330, 22, 0.04);
    scratchedText(ctx, "DONT LET THEM PUT YOU UNDER", 40, 390, 20, -0.02);
    scratchedText(ctx, "S-09", 380, 120, 26, 0.1);
  });
  const wallMat = owned.add(new THREE.MeshStandardMaterial({ map: wallPlain, metalness: 0.55, roughness: 0.42 }));
  const storyMat = owned.add(new THREE.MeshStandardMaterial({ map: wallStory, metalness: 0.55, roughness: 0.42 }));
  const trim = owned.add(new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.8, roughness: 0.35 }));
  const rail = owned.add(new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.95, roughness: 0.2 }));
  const floorTex = canvasTexture(owned, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#1c1d1f";
    ctx.fillRect(0, 0, w, h);
    // Raised rubber studs.
    for (let y = 8; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? 16 : 8; x < w; x += 16) {
        ctx.fillStyle = "#2c2d30";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Scuffs.
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `rgba(90,80,70,${0.05 + rand() * 0.1})`;
      ctx.fillRect(rand() * w, rand() * h, 20 + rand() * 40, 2 + rand() * 4);
    }
  }, { repeat: [2, 2] });
  const floorMat = owned.add(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  const ceilingMat = owned.add(new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.4, roughness: 0.6 }));
  const lampMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.4) }));

  const add = (geometry, material, sx, sy, sz, x, y, z, parent = root) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const wall = (material, w, h, x, y, z, ry) => {
    const mesh = add(plane, material, w, h, 1, x, y, z);
    mesh.rotation.y = ry;
    return mesh;
  };

  // ---- Shell ----------------------------------------------------------------
  const floor = add(plane, floorMat, 2 * W, 2 * D, 1, 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = add(plane, ceilingMat, 2 * W, 2 * D, 1, 0, H, 0);
  ceiling.rotation.x = Math.PI / 2;
  wall(wallMat, 2 * W, H, 0, H / 2, D, Math.PI); // back
  wall(storyMat, 2 * D, H, -W, H / 2, 0, Math.PI / 2); // left (the messages)
  wall(wallMat, 2 * D, H, W, H / 2, 0, -Math.PI / 2); // right
  // Front wall either side of the doors, and above them.
  const doorW = 1.3;
  const doorH = 2.15;
  const side = (2 * W - doorW) / 2;
  for (const s of [-1, 1]) wall(wallMat, side, H, s * (doorW / 2 + side / 2), H / 2, -D, 0);
  wall(wallMat, doorW, H - doorH, 0, doorH + (H - doorH) / 2, -D, 0);
  // Skirting and a corner trim.
  for (const [sx, sz, x, z] of [[2 * W, 0.02, 0, D - 0.01], [0.02, 2 * D, -W + 0.01, 0], [0.02, 2 * D, W - 0.01, 0]]) add(box, trim, sx, 0.12, sz, x, 0.06, z);
  // Handrails on the back and both sides.
  const railGeo = owned.add(new THREE.CylinderGeometry(0.022, 0.022, 1, 12));
  const rails = [
    [2 * W - 0.3, 0, 0.95, D - 0.07, Math.PI / 2, "z"],
    [2 * D - 0.4, -W + 0.07, 0.95, 0.1, Math.PI / 2, "x"],
    [2 * D - 0.4, W - 0.07, 0.95, 0.1, Math.PI / 2, "x"],
  ];
  for (const [len, x, y, z, angle, axis] of rails) {
    const r = add(railGeo, rail, 1, len, 1, x, y, z);
    if (axis === "z") r.rotation.z = angle;
    else r.rotation.x = angle;
  }

  // ---- Doors ---------------------------------------------------------------
  const doorTex = canvasTexture(owned, 256, 512, (ctx, w, h) => {
    steel(ctx, w, h, rand);
    ctx.fillStyle = "rgba(20,22,24,0.35)";
    ctx.fillRect(0, h * 0.1, w, 2);
    ctx.fillRect(0, h * 0.9, w, 2);
  });
  const doorMat = owned.add(new THREE.MeshStandardMaterial({ map: doorTex, metalness: 0.6, roughness: 0.35 }));
  const leaves = [-1, 1].map((s) => {
    // Just outside the front wall, so they slide away behind it; a hair
    // narrower than half, so the seam between them shows.
    const leaf = add(box, doorMat, doorW / 2 - 0.004, doorH, 0.04, (s * doorW) / 4, doorH / 2, -D - 0.03);
    leaf.userData.side = s;
    return leaf;
  });
  // Light leaking through the seam between the leaves (floors passing),
  // and the bright world outside when they open.
  const seamMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }));
  const seam = add(plane, seamMat, 0.012, doorH, 1, 0, doorH / 2, -D - 0.06);
  // Outside: daylight down a glass walkway (the skybridge).
  const outsideTex = canvasTexture(owned, 256, 384, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, "#cfe3f2");
    sky.addColorStop(1, "#fff6e6");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // The walkway floor, running away to a vanishing point.
    const vx = w * 0.5;
    const vy = h * 0.6;
    ctx.fillStyle = "#8d949a";
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, h);
    ctx.lineTo(vx - 10, vy);
    ctx.lineTo(vx + 10, vy);
    ctx.lineTo(w * 1.2, h);
    ctx.closePath();
    ctx.fill();
    // Glass frames either side.
    ctx.strokeStyle = "rgba(70,80,90,0.35)";
    ctx.lineWidth = 3;
    for (let k = 0; k < 6; k += 1) {
      const f = 1 / (1 + k * 0.9);
      const x0 = vx - (vx + 20) * f;
      const x1 = vx + (w - vx + 20) * f;
      const yTop = vy - vy * f * 1.2;
      const yBot = vy + (h - vy) * f;
      ctx.beginPath();
      ctx.moveTo(x0, yBot);
      ctx.lineTo(x0, yTop);
      ctx.moveTo(x1, yBot);
      ctx.lineTo(x1, yTop);
      ctx.stroke();
    }
  });
  const outsideMat = owned.add(new THREE.MeshBasicMaterial({ map: outsideTex, color: new THREE.Color(1.7, 1.66, 1.6) }));
  add(plane, outsideMat, doorW + 0.3, doorH + 0.2, 1, 0, doorH / 2, -D - 0.12);
  // The door frame.
  for (const s of [-1, 1]) add(box, trim, 0.05, doorH, 0.03, s * (doorW / 2 + 0.02), doorH / 2, -D + 0.012);
  add(box, trim, doorW + 0.09, 0.05, 0.03, 0, doorH + 0.02, -D + 0.012);

  // ---- Floor display over the doors ------------------------------------------
  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = 256;
  displayCanvas.height = 96;
  const displayTex = owned.add(new THREE.CanvasTexture(displayCanvas));
  displayTex.colorSpace = THREE.SRGBColorSpace;
  let lastDisplay = "";
  const drawDisplay = (text, dir) => {
    const key = `${text}|${dir}`;
    if (key === lastDisplay) return;
    lastDisplay = key;
    const ctx = displayCanvas.getContext("2d");
    ctx.fillStyle = "#070504";
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = "#ff9a2e";
    ctx.font = "bold 60px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 150, 52);
    if (dir) {
      ctx.beginPath();
      const up = dir === "up";
      ctx.moveTo(48, up ? 30 : 70);
      ctx.lineTo(70, up ? 62 : 38);
      ctx.lineTo(26, up ? 62 : 38);
      ctx.closePath();
      ctx.fill();
    }
    displayTex.needsUpdate = true;
  };
  const displayMat = owned.add(new THREE.MeshBasicMaterial({ map: displayTex }));
  add(box, trim, 0.62, 0.26, 0.04, 0, doorH + 0.22, -D + 0.03);
  add(plane, displayMat, 0.54, 0.2, 1, 0, doorH + 0.22, -D + 0.055);

  // ---- Button panel, right of the doors -----------------------------------------
  const floors = ["R", "SB", "40", "30", "20", "10", "L", "B1"];
  const panelTex = canvasTexture(owned, 128, 384, (ctx, w, h) => {
    ctx.fillStyle = "#9aa1a7";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#5a6066";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    floors.forEach((label, i) => {
      const y = 36 + i * 42;
      ctx.fillStyle = "#3a3f44";
      ctx.beginPath();
      ctx.arc(w / 2 + 18, y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#23272a";
      ctx.fillText(label, w / 2 - 22, y);
    });
  });
  const panelMat = owned.add(new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.7, roughness: 0.35 }));
  const panelX = doorW / 2 + 0.2;
  add(plane, panelMat, 0.16, 0.48, 1, panelX, 1.25, -D + 0.012);
  // The lit button (moves to whichever floor is pressed).
  const buttonMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.3) }));
  const buttonGeo = owned.add(new THREE.CircleGeometry(0.018, 20));
  const litButton = new THREE.Mesh(buttonGeo, buttonMat);
  litButton.visible = false;
  root.add(litButton);
  const buttonPos = (label) => {
    const i = Math.max(0, floors.indexOf(label));
    const v = (36 + i * 42) / 384;
    return new THREE.Vector3(panelX + 0.16 * ((64 + 18) / 128 - 0.5), 1.25 + 0.48 * (0.5 - v), -D + 0.016);
  };

  // ---- Speaker grille, top left of the front wall -------------------------------
  const grilleTex = canvasTexture(owned, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = "#3b4045";
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0c0d";
    for (let y = 16; y < 120; y += 10) {
      for (let x = 16; x < 120; x += 10) {
        if ((x - 64) ** 2 + (y - 64) ** 2 < 50 ** 2) {
          ctx.beginPath();
          ctx.arc(x, y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  const grilleMat = owned.add(new THREE.MeshStandardMaterial({ map: grilleTex, transparent: true, metalness: 0.6, roughness: 0.5 }));
  add(plane, grilleMat, 0.22, 0.22, 1, -(doorW / 2 + side / 2), 2.2, -D + 0.012);

  // ---- Security camera, back right corner of the ceiling ---------------------------
  const camGroup = new THREE.Group();
  camGroup.position.set(W - 0.14, H - 0.02, D - 0.14);
  root.add(camGroup);
  const domeGlass = owned.add(new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.85 }));
  const base = new THREE.Mesh(owned.add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20)), trim);
  const dome = new THREE.Mesh(owned.add(new THREE.SphereGeometry(0.085, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), domeGlass);
  dome.position.y = -0.015;
  const ledMat = owned.add(new THREE.MeshBasicMaterial({ color: 0x220000 }));
  const led = new THREE.Mesh(owned.add(new THREE.SphereGeometry(0.009, 8, 6)), ledMat);
  led.position.set(-0.06, -0.03, -0.06);
  camGroup.add(base, dome, led);

  // ---- The torn lab badge on the floor ---------------------------------------------
  const badgeTex = canvasTexture(owned, 128, 192, (ctx, w, h) => {
    ctx.fillStyle = "#e9ecee";
    ctx.beginPath();
    // Torn: a ragged bottom edge.
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h * 0.78);
    for (let x = w; x >= 0; x -= 12) ctx.lineTo(x, h * (0.78 + (x / 12) % 2 * 0.06));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1d6f8a";
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HALCYON LABS", w / 2, 23);
    ctx.fillStyle = "#b9c0c6";
    ctx.fillRect(34, 46, 60, 64);
    ctx.fillStyle = "#333";
    ctx.font = "13px sans-serif";
    ctx.fillText("ACCESS: B2", w / 2, 132);
  });
  const badgeMat = owned.add(new THREE.MeshStandardMaterial({ map: badgeTex, transparent: true, roughness: 0.6, side: THREE.DoubleSide }));
  const badge = add(plane, badgeMat, 0.08, 0.12, 1, -0.7, 0.004, -0.5);
  badge.rotation.set(-Math.PI / 2, 0, 0.7);

  // ---- Light -------------------------------------------------------------------
  add(plane, lampMat, 0.9, 0.4, 1, 0, H - 0.01, 0).rotation.x = Math.PI / 2;
  const light = new THREE.PointLight(0xfff0dc, 7, 7, 1.5);
  light.position.set(0, H - 0.3, 0);
  root.add(light);
  const fill = new THREE.HemisphereLight(0x8a93a0, 0x241e18, 0.35);
  root.add(fill);
  const LAMP = new THREE.Color(1.6, 1.55, 1.4);

  const api = {
    root,
    doorWidth: doorW,
    doorHeight: doorH,
    /** Where someone stands with their back to the back wall. */
    backWall: new THREE.Vector3(0, 0, D - 0.32),
    open: 0,
    /** 0 = shut, 1 = open. Eased. */
    setDoors(t) {
      const k = THREE.MathUtils.clamp(t, 0, 1);
      api.open = k;
      const e = k * k * (3 - 2 * k);
      for (const leaf of leaves) leaf.position.x = (leaf.userData.side * doorW) / 4 + leaf.userData.side * (doorW / 2 - 0.02) * e;
      seam.visible = k < 0.02;
    },
    /** The ceiling light, 0..1. */
    setLight(v) {
      const k = THREE.MathUtils.clamp(v, 0, 1);
      light.intensity = 7 * k;
      lampMat.color.copy(LAMP).multiplyScalar(0.08 + 0.92 * k);
      fill.intensity = 0.12 + 0.23 * k;
    },
    /** The display over the doors: a floor label, and "up" / "down" / null. */
    setFloor(label, dir = null) {
      drawDisplay(String(label), dir);
    },
    /** Light the button for a floor (a label from the panel), or none. */
    press(label) {
      litButton.visible = !!label;
      if (label) litButton.position.copy(buttonPos(label));
    },
    /** Floors passing: light leaks through the door seam. `speed` in m/s. */
    update(dt, time, speed = 0) {
      const pass = speed > 0.2 ? Math.pow(0.5 + 0.5 * Math.sin((time * speed) / 1.3), 6) : 0;
      seamMat.color.setRGB(1.4 * pass, 1.3 * pass, 1.1 * pass);
      // The camera's recording light blinks.
      const on = Math.sin(time * 5) > 0.6;
      ledMat.color.setRGB(on ? 2.2 : 0.15, 0.02, 0.02);
    },
  };
  api.setDoors(0);
  api.setLight(1);
  api.setFloor("L", null);
  return api;
}
