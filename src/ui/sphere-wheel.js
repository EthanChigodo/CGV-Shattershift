/**
 * The sphere wheel, bottom right: which sphere is loaded, after Ghost of
 * Tsushima's stance selector. An X of fine lines; the four spheres on its
 * points as round medallions - glass (a crystal), cryo (a snowflake), shock
 * (a bolt), gravity (a black hole); the one in use enlarged, in its colour, on a lit diamond panel
 * that slides to it when you switch; Q and E in the X (back, on), the
 * spheres you have, and the loaded one's name and cost.
 *
 *   const wheel = new SphereWheel();
 *   wheel.update({ ball: "cryo", spheres: 12, cost: 2, visible: true });
 *   wheel.pulse();   // a switch: the medallion pops
 */

import { BALLS, BALL_ORDER } from "../systems/arsenal.js";

/** Where each sphere sits on the X (in the wheel's 240 x 240 box; the X crosses at 100, 112). */
const SLOTS = { glass: [100, 42], cryo: [170, 112], shock: [100, 182], gravity: [30, 112] };

const ICONS = {
  // A cut crystal: a diamond with its facets.
  glass: `<path d="M0-15 L11-3 L0 15 L-11-3 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M-11-3 H11 M0-15 L-4-3 L0 15 L4-3 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" opacity=".8"/>`,
  // A snowflake: three bars, each end forked.
  cryo: `<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none">
          <path d="M0-15 V15 M-13-7.5 L13 7.5 M-13 7.5 L13-7.5"/>
          <path d="M-4-11 L0-15 L4-11 M-4 11 L0 15 L4 11 M-13.5-2 L-13-7.5 L-8-10 M13.5 2 L13 7.5 L8 10 M-13.5 2 L-13 7.5 L-8 10 M13.5-2 L13-7.5 L8-10" stroke-width="1.6"/>
         </g>`,
  // A black hole: a dark core in a tilted orbit, a spiral arm.
  gravity: `<g fill="none" stroke="currentColor" stroke-linecap="round">
          <ellipse rx="15" ry="6" transform="rotate(-20)" stroke-width="2"/>
          <path d="M-2-12 C 8-12 12-2 6 5 C 1 10-8 8-8 2" stroke-width="1.6"/>
         </g>
         <circle r="5" fill="currentColor"/>`,
  // A bolt.
  shock: `<path d="M3-16 L-9 2 H-1 L-4 16 L9-3 H1 Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
};

function medallion(key) {
  // A ring with four ticks (the stance icons' frame), the sphere's mark inside.
  return `<svg viewBox="-24 -24 48 48" aria-hidden="true">
    <circle r="21" fill="rgba(8,10,12,.72)" stroke="currentColor" stroke-width="1.6"/>
    <circle r="17.5" fill="none" stroke="currentColor" stroke-width=".7" opacity=".5"/>
    <path d="M0-24 V-19 M0 24 V19 M-24 0 H-19 M24 0 H19" stroke="currentColor" stroke-width="2"/>
    ${ICONS[key]}
  </svg>`;
}

export class SphereWheel {
  constructor({ container = document.body } = {}) {
    if (!document.querySelector("link[data-sphere-wheel]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./sphere-wheel.css", import.meta.url).href;
      link.dataset.sphereWheel = "true";
      document.head.appendChild(link);
    }
    this.root = document.createElement("section");
    this.root.className = "sphere-wheel";
    this.root.setAttribute("aria-label", "Sphere in use");
    this.root.innerHTML = `
      <div class="sw-x"><i></i><i></i></div>
      <div class="sw-panel"></div>
      <b class="sw-key sw-q" data-key="Q">Q</b><b class="sw-key sw-e" data-key="E">E</b>
      <div class="sw-count"><strong>0</strong><span>SPHERES</span></div>
      ${BALL_ORDER.map((key) => `<div class="sw-slot" data-ball="${key}" style="--x:${SLOTS[key][0]}px;--y:${SLOTS[key][1]}px;--c:#${BALLS[key].colour.toString(16).padStart(6, "0")}">${medallion(key)}</div>`).join("")}
      <div class="sw-label"><b></b><span></span></div>`;
    container.append(this.root);
    this.slots = Object.fromEntries([...this.root.querySelectorAll(".sw-slot")].map((s) => [s.dataset.ball, s]));
    this.panel = this.root.querySelector(".sw-panel");
    this.count = this.root.querySelector(".sw-count strong");
    this.name = this.root.querySelector(".sw-label b");
    this.costEl = this.root.querySelector(".sw-label span");
    this.state = {};
  }

  /** Each frame: the sphere in use, how many you have, what the next one costs. */
  update({ ball = "glass", spheres = 0, cost = 1, visible = true }) {
    const s = this.state;
    if (visible !== s.visible) {
      s.visible = visible;
      this.root.classList.toggle("show", visible);
    }
    if (!visible) return;
    if (ball !== s.ball) {
      if (s.ball) this.pulse();
      s.ball = ball;
      for (const [key, slot] of Object.entries(this.slots)) slot.classList.toggle("on", key === ball);
      const [x, y] = SLOTS[ball] ?? SLOTS.glass;
      this.panel.style.transform = `translate(${x}px, ${y}px) rotate(45deg)`;
      this.root.style.setProperty("--c", `#${BALLS[ball].colour.toString(16).padStart(6, "0")}`);
      this.name.textContent = BALLS[ball].name.toUpperCase();
    }
    if (spheres !== s.spheres) {
      s.spheres = spheres;
      this.count.textContent = String(Math.max(0, Math.floor(spheres)));
    }
    if (cost !== s.cost || spheres < cost !== s.short) {
      s.cost = cost;
      s.short = spheres < cost;
      this.costEl.textContent = cost === 0 ? "FREE" : `${cost} PER SHOT`;
      this.root.classList.toggle("short", s.short);
    }
  }

  /** A switch: the loaded medallion pops. */
  pulse() {
    this.root.classList.remove("switched");
    void this.root.offsetWidth;
    this.root.classList.add("switched");
  }

  dispose() {
    this.root.remove();
  }
}
