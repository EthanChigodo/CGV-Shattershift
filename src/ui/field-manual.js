/**
 * The Field Manual (index.html #manualScreen), drawn as the Trophies & Stats
 * screen is: a header, tabs along the top (Q / E, or L1 / R1), a scrolling
 * page of cards. Seven tabs:
 *
 *   MOVES        every move, the keyboard's keys and the controller's buttons
 *                side by side (in the controller plugged in's names), where
 *                each one works
 *   SPHERES & SERUMS, 01 FOUNDRY, 02 LABS, 03 SKYLINE, THE ROOF
 *                everything you meet: a badge in its colour, its name, what
 *                to do with it (break it, avoid it, collect it - or a tool),
 *                and how it works
 *   MULTIPLAYER  the Arena's and the Race's controls and rules
 *
 *   const manual = new FieldManual(section);
 *   manual.open("moves");
 */

import { padLabel } from "../systems/input-glyphs.js";
import { ensureTrophyStyles } from "./trophy-toast.js";

/** Marks for the cards, on a 24 x 24 grid, in strokes. */
const ICONS = {
  glass: `<path d="M12 3l7 9-7 9-7-9z"/><path d="M5 12h14M12 3l-2.5 9L12 21l2.5-9z" stroke-width="1.1" opacity=".8"/>`,
  cryo: `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>`,
  shock: `<path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z"/>`,
  gravity: `<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-20 12 12)"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`,
  sack: `<path d="M8 6h8l-1.5 3c3 1.5 4.5 4 4.5 7 0 3-2.5 5-7 5s-7-2-7-5c0-3 1.5-5.5 4.5-7z"/><path d="M9.5 6l1-3h3l1 3"/>`,
  pad: `<path d="M7 7h10c3 0 4.5 2.2 5 5l.6 3.6c.4 2.4-1.8 3.8-3.6 2.4L16 16H8l-3 2c-1.8 1.4-4-.1-3.6-2.4L2 12c.5-2.8 2-5 5-5z"/><path d="M7 10v4M5 12h4"/>`,
  recharge: `<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/><path d="M20 4v4h-4"/>`,
  capsule: `<rect x="8" y="2.5" width="8" height="19" rx="4"/><path d="M8 12h8"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor"/>`,
  shield: `<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/>`,
  prism: `<path d="M12 3l9 16H3z"/><path d="M2 12h6M16 9l6-3M16 15l6 3"/>`,
  file: `<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M8 12h8M8 15.5h8M8 19h5"/>`,
  cell: `<circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21M8.5 21h7"/>`,
  piston: `<path d="M5 3h14v5H5zM10 8v6M14 8v6M6 14h12v3H6zM4 21h16"/>`,
  barrier: `<path d="M3 10h18v5H3zM6 15v6M18 15v6"/><path d="M6 10l3 5M11 10l3 5M16 10l3 5" stroke-width="1.2"/>`,
  cart: `<path d="M4 9h16l-2 8H6z"/><circle cx="8" cy="20" r="1.6"/><circle cx="16" cy="20" r="1.6"/><path d="M8 9c1-2 2-3 4-3s3 1 4 3" stroke-width="1.2"/>`,
  charge: `<rect x="5" y="8" width="14" height="10" rx="1.5"/><path d="M9 8V5h6v3M12 11v4"/><circle cx="12" cy="13" r="4.2" stroke-width="1"/>`,
  fire: `<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.4 3.6-9 2.4 1.6 3.4 3.6 3.4 5.6 1-.8 1.6-2 1.7-3.4 2.4 1.8 4.3 4.3 4.3 6.8 0 3.4-2.5 6-6.5 6z"/>`,
  duct: `<path d="M3 9h18v7H3z"/><path d="M7 9v7M11 9v7M15 9v7M19 9v7" stroke-width="1"/><path d="M3 19h18"/>`,
  patient: `<circle cx="12" cy="5" r="2.4"/><path d="M12 7.5v6M12 13.5l-3 7M12 13.5l3 7M12 9.5l-5 2.5M12 9.5l6 -1"/>`,
  light: `<path d="M3 9h5l3-3v12l-3-3H3z"/><path d="M14 8l7-3M14 12h8M14 16l7 3"/>`,
  laser: `<path d="M3 6h18M3 12h18M3 18h18" stroke-dasharray="3 2"/><path d="M3 4v16M21 4v16"/>`,
  wave: `<path d="M3 20h18"/><path d="M5 20c0-4 2-5 2-8M12 20c0-5 2-6 2-10M19 20c0-4 2-5 2-7" stroke-width="1.6"/>`,
  pane: `<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 8l2 3-3 4M14 6l-1 5 3 3" stroke-width="1.1"/>`,
  reinforced: `<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 9h14M5 15h14M12 3v18" stroke-width="1.1"/>`,
  hazard: `<path d="M12 3l10 17H2z"/><path d="M12 9v5M12 17v.5"/>`,
  sprinkler: `<path d="M12 3v5M8 8h8"/><circle cx="12" cy="11" r="2.2"/><path d="M8 15l-1 3M12 15v4M16 15l1 3"/>`,
  vent: `<circle cx="12" cy="12" r="8.5"/><path d="M12 12c0-3 2-5 4-5M12 12c3 0 5 2 5 4M12 12c0 3-2 5-4 5M12 12c-3 0-5-2-5-4"/>`,
  collapse: `<path d="M4 4h16"/><path d="M8 4l-2 7M16 4l2 7M10 13l-3 7M14 13l3 7"/><circle cx="12" cy="20" r="1.4" fill="currentColor"/>`,
  sculpture: `<path d="M12 3v18M12 8l7 3M12 8l-7 3M12 14l6 4M12 14l-6 4"/>`,
  tank: `<rect x="6" y="3" width="12" height="18" rx="5"/><path d="M6 9h12" stroke-width="1"/><circle cx="12" cy="14" r="2"/>`,
  lock: `<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>`,
  sprint: `<path d="M13 4.5a1.8 1.8 0 1 0 0 .1M12 8l-3 5h4l-2 7M12 8l4 4 3-1M9 13l-4 1"/>`,
  hatch: `<path d="M4 9h16v11H4z"/><path d="M4 9l3-5h10l3 5" stroke-width="1.3"/><path d="M8 14h8" stroke-dasharray="2 2"/>`,
  scientist: `<circle cx="12" cy="6" r="3"/><path d="M6 21v-5c0-3 3-5 6-5s6 2 6 5v5"/><circle cx="19" cy="9" r="1.6" fill="currentColor"/>`,
  canister: `<rect x="7" y="5" width="10" height="16" rx="2"/><path d="M10 2h4v3M7 11h10"/>`,
  crate: `<path d="M5 10h14v11H5zM5 10l7-3 7 3M12 7v14"/><path d="M8 3c2 2 6 2 8 0" stroke-width="1.2"/>`,
  brute: `<circle cx="12" cy="5" r="2.8"/><path d="M5 21l1.5-8c.4-2 2.5-4 5.5-4s5.1 2 5.5 4L19 21M8 13l-3 4M16 13l3 4"/>`,
  heli: `<path d="M3 5h18M12 5v3"/><path d="M6 12.5c0-2.5 2.2-4.5 5.5-4.5h2c2.8 0 4.5 1.8 4.5 4.3V15H8.5C7 15 6 14 6 12.5z"/><path d="M8 18.5h9"/>`,
  crown: `<path d="M3 8l4.5 4L12 4.5 16.5 12 21 8l-2 11H5z"/>`,
  flag: `<path d="M5 22V3"/><path d="M5 4h14v9H5"/><path d="M5 4h3.5v3H5zM12 4h3.5v3H12zM8.5 7H12v3H8.5zM15.5 7H19v3h-3.5zM5 10h3.5v3H5zM12 10h3.5v3H12z" fill="currentColor" stroke="none"/>`,
  focus: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`,
};

const TONES = {
  white: "#e9f6ff", cyan: "#5ef0ff", violet: "#c77dff", indigo: "#8f7cff", amber: "#ffd23f", fire: "#ff8a1f",
  hazard: "#ff5a4e", green: "#7dff9a", serum: "#ff5ad0", blue: "#4d8dff", glass: "#9ff3ff", pink: "#ff2f8e",
};
const ACTS = { break: "Break it", avoid: "Avoid it", collect: "Collect it", tool: "Your tool", solve: "Solve it", rules: "How it works" };
/**
 * The legend's five (the rules cards explain themselves). "Solve it": the
 * right-tool problems (src/systems/problems.js) - only the right sphere, or
 * the right moment, gets you past for free.
 */
const LEGEND = ["solve", "break", "avoid", "collect", "tool"];

/** [tone, act, icon, title, text]. data-keys texts are renamed for a controller (key-names.js). */
const CARDS = {
  tools: [
    ["white", "tool", "glass", "Glass sphere // 1", "Standard throw. Breaks what it hits, and is gone in the burst; ricochets off walls and ceilings on the way."],
    ["cyan", "tool", "cryo", "Cryo sphere // 2", "Goes off like shock, in ice: shatters what's within 4.8 m, puts out fires - fire walls too - freezes falling debris and machinery, knocks people down. Frosts the floor where it lands on it."],
    ["violet", "tool", "shock", "Shock sphere // 3", "Shatters all glass within 5 m. One-hit reinforced glass. The only thing that opens a sealed door or overloads a laser grid's junction box."],
    ["indigo", "tool", "gravity", "Gravity sphere // 2", "Opens a black hole for a second where it bursts. It breaks nothing: it drags in every sphere cache, sack and serum within 7 m and they're yours - stranded supplies too. On the roof it lifts every patient and scientist in reach and throws them at the nearer open ledge, and drags a flying one out of the sky."],
    ["cyan", "collect", "sack", "Sphere caches and sacks", "Shoot cyan caches in the Foundry and the Skyline. In the Labs and on the Roof, shoot sacks or run through them to collect once, without spending ammunition."],
    ["cyan", "tool", "recharge", "Emergency recovery", "At zero spheres, 2.5 seconds of active play (1.6 on Easy, 3.5 on Hard) restores one sphere. It stops at one: use Glass (Q/E) to shoot a supply. Pause, cutscenes and death do not charge it. While empty, a yellow wireframe marks the nearest unobstructed supply.", true],
    ["amber", "collect", "prism", "Prism split", "Gold capsule. Every throw splits into three spheres. 10 s."],
    ["fire", "collect", "capsule", "Thermal Aegis", "Orange capsule. See through smoke and the dark, and fire can't burn you: walk through flames and fire vents, the fire behind you in the Labs barely gains, a canister's blast only shoves you. 12 s."],
    ["green", "collect", "shield", "Kinetic shield", "Green capsule. Absorbs the next two impacts. 25 s."],
    ["pink", "collect", "capsule", "Overdrive", "Pink capsule. Free throws, faster running, heavier hits. 8 s."],
    ["blue", "collect", "capsule", "Unlimited spheres", "Blue capsule, a figure of eight inside. Every throw is free - cryo and shock too. 10 s."],
    ["green", "collect", "capsule", "Restoration", "Green capsule, a ring of spheres inside. +20 spheres and your integrity back to full, at once."],
    ["amber", "collect", "file", "Records", "Gold holograms in light beams, in every sector: plant logs, patient records, case files, flight records. Run through one to read it."],
  ],
  foundry: [
    ["white", "solve", "piston", "Drop forge", "A hammer as wide as the corridor, slamming on a rhythm. Its glass valve opens only while the hammer is held up: break it then and the hammer jams up for good (+500). Too early or too late and the guard plates turn the sphere away. Or time your run underneath."],
    ["glass", "break", "cell", "Switch cells", "Glass cells on stems. Break one and the gate it holds opens - three stand between you and the lift."],
    ["cyan", "break", "cell", "Pressure cells", "Small glass cells everywhere: score, and three spheres back each."],
    ["cyan", "tool", "recharge", "Out of spheres?", "Keep avoiding machinery. Emergency recharge restores one sphere after 2.5 seconds empty; switch to Glass with Q/E and shoot a pressure cell for +3.", true],
    ["hazard", "avoid", "piston", "Pistons and presses", "Slam down on a rhythm. Read the timing or change lanes; cryo freezes them for a few seconds."],
    ["hazard", "avoid", "barrier", "Barriers", "Low ones you jump (Space or W), high ones you slide under (Shift or S).", true],
    ["hazard", "avoid", "cart", "Slag carts (Hard)", "A tub of molten metal rolling to and fro across all three lanes. Take the lane it is leaving, or jump it."],
    ["fire", "break", "charge", "Plant charges", "Near the end Vale's charges arm and the shutters start sealing: a clock to the lift. Break the extraction valve."],
  ],
  labs: [
    ["cyan", "solve", "fire", "Fire walls", "Flame across the whole corridor, too tall to jump. Nothing else touches it: one cryo sphere (Q/E) puts it out and the way is clear.", true],
    ["amber", "solve", "charge", "Jammed shutter", "A blast shutter stuck across the corridor, with a gold meter. Plain shots only dent it; hold the throw for a full charged shot and it blows out (+700). Dent it full and it gives too - eight spheres, no bonus. Run into it and you shoulder through, hurt.", true],
    ["fire", "avoid", "fire", "The fire front", "It's behind you the whole way. Slow down and it catches you."],
    ["cyan", "collect", "sack", "Sphere sacks", "Run through the floating cyan crystal to collect without shooting, or break it with projectiles. At zero, recharge restores one sphere after 2.5 seconds of play. Use Glass (Q/E); a yellow wireframe marks a nearby unobstructed sack ahead.", true],
    ["hazard", "avoid", "duct", "Fallen ducts", "Jump onto them and off the far side - running into one is a hit. At the fire crossings, the duct is the only bridge."],
    ["hazard", "break", "patient", "Patients", "Lurch out into your lane. In the dark they stalk you, following your lane until the last moment: shoot them (two hits) or sidestep late."],
    ["blue", "tool", "light", "The launcher's light", "When the power dies, your beam is the only light. Spheres glow - firing ahead is scouting."],
    ["glass", "break", "laser", "Glass and lasers", "Panes break; laser grids you jump or slide."],
    ["hazard", "avoid", "wave", "Fire waves (Hard)", "Three floor vents erupting one after another, so the fire rolls across the corridor. Be in the lane it has just left."],
  ],
  skyline: [
    ["violet", "solve", "shock", "Sealed security door", "Violet seal bars across the door. Glass and cryo bounce off: one shock sphere (Q/E) overloads the seal (+600). Out of shock, you can shoulder through it - for 34 integrity.", true],
    ["violet", "solve", "shock", "Security drones", "HALCYON's drones fly in ahead and sweep your lane with a red scan. When the beam holds still and brightens it has locked on: change lane before it fires. Glass, cryo and gravity glance off the armour - only a shock sphere (Q/E) brings one down (+450).", true],
    ["violet", "solve", "laser", "Laser grid and junction box", "A laser grid across all three lanes, fed by a violet junction box on a pylon just before it. Shock the box and the grid dies (+450) - or jump or slide it."],
    ["glass", "break", "pane", "Glass pane", "Cyan rim means breakable. Shoot it for score, or crash through it and lose 15 integrity."],
    ["glass", "break", "reinforced", "Reinforced glass and doors", "Thicker and greener. The first hit cracks it, the second breaks it. A shock sphere breaks it in one."],
    ["cyan", "collect", "sack", "Sphere cache", "Floating crystal. Shoot it for +3 spheres. At zero, emergency recharge restores one sphere after 2.5 seconds of play; use Glass (Q/E). The sealed gate keeps its seven-second aiming budget but holds that clock while you are empty. Overdrive throws are free even at zero.", true],
    ["hazard", "avoid", "hazard", "Solid hazards", "Dark steel with amber stripes: carts, cabinets, racks, fallen beams. They never break. Change lanes."],
    ["fire", "avoid", "fire", "Fire", "Burns integrity while you stand in it and thickens the smoke. Put it out with a sprinkler or a cryo sphere."],
    ["blue", "break", "sprinkler", "Sprinkler bulb", "The small red glass bulb on the ceiling. Shoot it to flood the area and put out the fires below it."],
    ["green", "break", "vent", "Air vent", "A round frosted cover in the wall with a glowing cyan ring and a SMOKE VENT sign. The ring pulses when the air is smoky. Throw a sphere at it to pull the smoke out; the ring turns green."],
    ["hazard", "avoid", "collapse", "Ceiling collapse", "A red ring on the floor means something is about to fall there. Beams block the lane. Falling glass can be shot mid-air."],
    ["glass", "break", "sculpture", "Rotating sculpture", "A steel pole blocks the centre lane; glass blades sweep the outer lanes. Shoot the blades or time your lane."],
    ["serum", "collect", "capsule", "Serum capsules", "Prism split, Thermal Aegis, kinetic shield, overdrive, unlimited spheres, restoration - see Spheres & serums."],
    ["amber", "collect", "file", "Case files", "Five gold holograms, each in a column of light: two in the ward, one on the skybridge, two in the atrium. Run through one or shoot it to read what happened here."],
    ["white", "break", "tank", "Specimen tanks", "Glass tanks along the walls. Optional score."],
    ["amber", "break", "lock", "Lift gate", "Break locks I, II, III in order. Wrong order is rejected. You have seven seconds once you reach the gate."],
    ["cyan", "tool", "sprint", "Sprint, brake, focus", "W sprints, S brakes (the bridge collapses behind you, so do not brake long). Hold right mouse to slow time.", true],
  ],
  roof: [
    ["indigo", "solve", "gravity", "Stranded supplies", "A crate on the window-cleaner's cradle off the west ledge, out of reach. Open a gravity well close to it and it's dragged in over the ledge, spheres and all (+500)."],
    ["indigo", "solve", "gravity", "Over the edge", "Gravity's black hole lifts every patient and scientist in reach and throws them at the nearer open ledge - over it from anywhere but the middle of the roof. A flying one low enough is dragged out of the sky.", true],
    ["hazard", "break", "patient", "Patients", "Climb out of the hatches, stalk, wind up and charge in a straight line. Sidestep one near an open ledge and it goes over."],
    ["hazard", "avoid", "hatch", "Open hatches", "The square holes the patients climb out of go straight down into the building. Step into one and you fall."],
    ["serum", "break", "scientist", "Scientists", "Fire slow orbs from their gadgets - dodge them (Space). Three hits each.", true],
    ["fire", "break", "canister", "Gas canisters", "Red, by the cover. Shoot one and everyone near it goes down - chains into the next. Not too close yourself."],
    ["cyan", "collect", "crate", "Supply drop", "A flare, a crate under a parachute: spheres and a serum. Walk into them or shoot them."],
    ["cyan", "tool", "recharge", "Emergency reserve", "At zero, 2.5 seconds of active play restores one sphere. Walk through a sack without spending it, or select Glass (Q/E) to shoot a supply. Overdrive throws remain free at zero.", true],
    ["hazard", "avoid", "brute", "The brute", "The last wave's big one: charges harder, and takes only a third of what a sphere does (on Hard, the second wave brings one too). Throw it off the roof with gravity, or use a canister."],
    ["amber", "collect", "heli", "The helicopter", "Clear the roof and it lands; still fighting when it comes and it hangs off the ledge - jump for the ladder."],
  ],
  multi: [
    ["amber", "rules", "crown", "The Arena: King of the Hill", "2-4 players on the roof, every one for themselves. Stand on the helipad alone and its clock is yours; two or more on it is contested. First to the target wins - or the most when the clock runs out. Knock rivals off the open ledges and into the hatches; shoot the gas canisters; grab the care packages."],
    ["blue", "rules", "flag", "The Arena: Capture the Flag", "Blue (P1, P3) against red (P2, P4) - one on one with two. Run onto the other team's core to take it and bring it to your plinth while yours is still on it. Carrying it you're slower and can't throw; any hit (a warp too) and you drop it. A dropped core waits 8 s: an enemy takes it on, a teammate sends it home. First to 3 captures."],
    ["cyan", "rules", "vent", "The Arena: weather", "Every match has its own night: clear, rain - a wet, glossy deck under the floods - or a storm, with lightning out over the city and thunder after it."],
    ["hazard", "rules", "shield", "The Arena: health", "100 each. At zero you're out for 3 s and lose 3 s of pad time; whoever hit you gets the KO. Spheres come back one every 2.6 s, 15 at most; duffel sacks give 5."],
    ["indigo", "rules", "gravity", "The Arena: spheres", "Their own rules here. Glass (1): a hard knock. Cryo (4): freezes everyone near it for 4 s. Shock (3): heavy damage, and blows everyone far back - you too, half as hard. Gravity (5): a rift that warps whoever it catches to a random spot on the roof, off the pad."],
    ["cyan", "rules", "flag", "The Race: head to head", "Two players, a screen each, through the Foundry, the Labs or the Skyline - a new layout every race, at one of five difficulties. First to the end wins; fall more than the difficulty's distance behind and you're out."],
    ["violet", "rules", "focus", "The Race: aiming", "Your own ring in your own half: aim it with the right stick (or the mouse) and throw through it. No aim assist. All four sphere types, their bounces and blasts, as in the story - and they catch your rival too."],
  ],
};

/**
 * The moves: [what it does, where (or null: everywhere), keyboard keys, controller codes / text].
 * Controller entries are input-glyphs codes (PadA, PadRT ...) or a plain label in quotes ("L stick").
 */
const MOVES = [
  ["Running", [
    ["Change lane", "Foundry, Labs, Skyline", ["A", "D"], ["'L stick ←→'"]],
    ["Jump", "Foundry, Labs, Skyline", ["Space"], ["PadA"]],
    ["Slide - in the air, slam down into it", "Foundry, Labs, Skyline", ["Shift"], ["PadB"]],
    ["Sprint and brake", "Skyline", ["W", "S"], ["'L stick ↑↓'"]],
    ["Push a fallen duct out of the way (tap fast)", "Labs", ["Space"], ["PadA"]],
  ]],
  ["Spheres", [
    ["Aim", null, ["Mouse"], ["'R stick'"]],
    ["Throw a sphere (by hand)", "Foundry, Skyline", ["Click"], ["PadRT"]],
    ["Fire the launcher - hold it; it overheats", "Labs, Roof", ["Hold click"], ["PadRT"]],
    ["Focus: slow time while you aim", null, ["RMB"], ["PadLT"]],
    ["Sphere type: back / round the wheel", null, ["Q", "E"], ["PadLB", "PadRB"]],
    ["Centre the aim", null, [], ["'R stick click'"]],
  ]],
  ["On the roof", [
    ["Move about", "Roof", ["W", "A", "S", "D"], ["'L stick'"]],
    ["Dodge; jump for the ladder when it comes down", "Roof", ["Space"], ["PadA"]],
  ]],
  ["Timed events", [
    ["Press the key shown", null, ["the key"], ["'a flick of a stick'"]],
    ["Tap as fast as you can", null, ["the key"], ["PadRT"]],
    ["Alternate", null, ["the keys"], ["PadLT", "PadRT"]],
  ]],
  ["Anywhere", [
    ["Change camera", null, ["C"], ["PadY"]],
    ["Photo mode", "Foundry, Skyline", ["P"], []],
    ["Choose what the HUD shows / hide it all", null, ["V", "H"], []],
    ["Pause; hold to skip a cutscene", null, ["Esc"], ["PadStart"]],
  ]],
];
const MULTI_MOVES = [
  ["The Arena", [
    ["Move", null, ["W", "A", "S", "D"], ["'L stick'"]],
    ["Aim", null, ["Mouse"], ["'R stick'"]],
    ["Throw", null, ["Click"], ["PadRT"]],
    ["Dodge", null, ["Space"], ["PadA"]],
    ["Sphere type", null, ["Q", "E"], ["PadLB", "PadRB"]],
    ["Pause", null, ["Esc"], ["PadStart"]],
  ]],
  ["The Race", [
    ["Change lane", null, ["A", "D"], ["'L stick ←→'"]],
    ["Jump", null, ["W", "Space"], ["PadA"]],
    ["Slide", null, ["S", "Shift"], ["PadB"]],
    ["Aim (your half of the screen)", null, ["Mouse"], ["'R stick'"]],
    ["Throw", null, ["Click", "F"], ["PadRT"]],
    ["Sphere type", null, ["Q", "E"], ["PadLB", "PadRB"]],
    ["Pause", null, ["Esc"], ["PadStart"]],
  ]],
];

const TABS = [
  ["moves", "Moves"],
  ["tools", "Spheres & serums"],
  ["foundry", "01 Foundry"],
  ["labs", "02 Labs"],
  ["skyline", "03 Skyline"],
  ["roof", "The Roof"],
  ["multi", "Multiplayer"],
];
const BLURBS = {
  moves: "Every move, on the keyboard and on a controller.",
  tools: "What you throw, and the serums that change the rules for a few seconds.",
  foundry: "Sector 01. The basement: machinery, gates and the clock to the lift.",
  labs: "Sector 02. A fire behind you the whole way, and the patients.",
  skyline: "Sector 03. Glass, smoke and a bridge that falls behind you.",
  roof: "The last stand: hold out until the helicopter comes.",
  multi: "2-4 players on one screen: the Arena and the Race.",
};

const kb = (keys) => keys.length ? keys.map((k) => `<kbd>${k}</kbd>`).join("") : `<span class="fm-none">-</span>`;
const pad = (codes) => codes.length
  ? codes.map((c) => (c.startsWith("'") ? `<kbd data-pad class="fm-wide">${c.slice(1, -1)}</kbd>` : `<kbd data-pad>${padLabel(c)}</kbd>`)).join("")
  : `<span class="fm-none">-</span>`;

export class FieldManual {
  constructor(root) {
    ensureTrophyStyles();
    this.root = root;
    this.tab = "moves";
    this.tabsEl = root.querySelector(".fm-tabs");
    this.page = root.querySelector(".fm-page");
    this.tabsEl.insertAdjacentHTML("beforeend", `<kbd class="tr-bumper" data-key="Q">Q</kbd>${TABS.map(([k, label]) => `<button type="button" role="tab" class="tab" data-fm-tab="${k}">${label}</button>`).join("")}<kbd class="tr-bumper" data-key="E">E</kbd>`);
    for (const b of this.tabsEl.querySelectorAll("[data-fm-tab]")) b.addEventListener("click", () => this.setTab(b.dataset.fmTab));
    addEventListener("keydown", (e) => {
      if (!root.classList.contains("active") || e.repeat) return;
      if (e.code === "KeyQ" || e.code === "KeyE") { e.preventDefault(); this.cycleTab(e.code === "KeyE" ? 1 : -1); }
    });
  }

  open(tab = this.tab) {
    this.setTab(tab, true);
  }

  cycleTab(step) {
    const keys = TABS.map(([k]) => k);
    this.setTab(keys[(keys.indexOf(this.tab) + step + keys.length) % keys.length]);
  }

  setTab(tab, force = false) {
    if (tab === this.tab && !force) return;
    this.tab = tab;
    for (const b of this.tabsEl.querySelectorAll("[data-fm-tab]")) {
      const on = b.dataset.fmTab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const intro = `<p class="fm-blurb">${BLURBS[tab]}</p>`;
    let body;
    if (tab === "moves") body = this._moves(MOVES);
    else if (tab === "multi") body = this._cards(CARDS.multi) + this._moves(MULTI_MOVES);
    else body = this._legend() + this._cards(CARDS[tab]);
    this.page.innerHTML = `<div class="tr-panel">${intro}${body}</div>`;
    this.root.querySelector(".tr-scroll")?.scrollTo({ top: 0 });
  }

  _legend() {
    return `<div class="fm-legend">${LEGEND.map((k) => [k, ACTS[k]]).map(([k, label]) => `<span class="fm-act" data-act="${k}">${label}</span>`).join("")}</div>`;
  }

  _cards(list) {
    return `<div class="tr-grid fm-grid">${list.map(([tone, act, icon, title, text, keys]) => `
      <article class="tr-card got fm-card" tabindex="0" style="--tc:${TONES[tone] ?? TONES.cyan}">
        <div class="fm-badge"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] ?? ICONS.glass}</svg></div>
        <div class="tr-body">
          <header><b>${title}</b><span class="fm-act" data-act="${act}">${ACTS[act]}</span></header>
          <p${keys ? " data-keys" : ""}>${text}</p>
        </div>
      </article>`).join("")}</div>`;
  }

  _moves(groups) {
    return groups.map(([title, rows]) => `
      <section class="tr-sec fm-moves" tabindex="0">
        <h3>${title}</h3>
        <div class="fm-head" aria-hidden="true"><span></span><span>Keyboard &amp; mouse</span><span>Controller</span></div>
        ${rows.map(([what, where, keys, codes]) => `
          <div class="fm-move">
            <span class="fm-what">${what}${where ? `<small>${where}</small>` : ""}</span>
            <span class="fm-keys" data-keep-keys>${kb(keys)}</span>
            <span class="fm-keys fm-pad" data-keep-keys>${pad(codes)}</span>
          </div>`).join("")}
      </section>`).join("");
  }
}
