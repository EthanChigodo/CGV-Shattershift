/**
 * Trophy art: a hexagonal badge in its tier's metal - bronze, silver, gold,
 * or platinum's pale prism - with the trophy's own mark drawn on a dark plate
 * in the middle. The same art in the Trophies screen and the toast.
 *
 *   trophyBadge(trophy)    an <svg> string
 *   cupIcon()              the little trophy cup (labels, the menu button)
 */

/** Each trophy's mark, on a 24 x 24 grid, drawn in strokes (fills where a shape needs one). */
const MARKS = {
  // A six-pointed star of light: all of them.
  platinum: `<path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" fill="currentColor"/><circle cx="12" cy="12" r="2.4" fill="#0d1318"/>`,
  // A cog: the Foundry.
  gear: `<circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.6"/>`,
  // A flame: the Labs.
  flame: `<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.4 3.6-9 2.4 1.6 3.4 3.6 3.4 5.6 1-.8 1.6-2 1.7-3.4 2.4 1.8 4.3 4.3 4.3 6.8 0 3.4-2.5 6-6.5 6z"/><path d="M12 21c-1.8 0-3-1.2-3-2.8 0-1.8 1.6-2.6 2-4.4 1.6 1.2 4 2.6 4 4.4 0 1.6-1.2 2.8-3 2.8z"/>`,
  // A bridge over a drop: the Skyline.
  bridge: `<path d="M2 15h20M4 15v6M20 15v6M2 15c4-6 16-6 20 0"/><path d="M8 15v-3.2M12 15v-4.2M16 15v-3.2"/>`,
  // A helicopter: off the roof.
  heli: `<path d="M3 5h18M12 5v3"/><path d="M6 12.5c0-2.5 2.2-4.5 5.5-4.5h2c2.8 0 4.5 1.8 4.5 4.3V15H8.5C7 15 6 14 6 12.5z"/><path d="M18 11.5h4M8 18.5h9M10 15v3.5M15 15v3.5"/>`,
  // A tower with a star over it: Hard.
  tower: `<path d="M8 22V9l4-3 4 3v13M8 22h8M10.5 12h3M10.5 16h3"/><path d="M12 1.5l.9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3z" fill="currentColor" stroke-width="1"/>`,
  // A shield with a tick: not a scratch.
  shield: `<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/><path d="M8.3 12.2l2.6 2.6 4.8-5"/>`,
  // A sphere's path off a wall, into a target.
  ricochet: `<path d="M20 3v18" stroke-width="2.4"/><path d="M3 6l14 6-13 7" stroke-dasharray="2.4 2.2"/><circle cx="4" cy="19" r="2.2" fill="currentColor"/>`,
  // A snowflake.
  snow: `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5M3.5 10.5l3.3-.8-.8-3.2M20.5 13.5l-3.3.8.8 3.2M3.5 13.5l3.3.8-.8 3.2M20.5 10.5l-3.3-.8.8-3.2"/>`,
  // Glass in shards.
  shards: `<path d="M12 3l3 6-4 3 1 9-6-7 2-5z"/><path d="M15 9l6-2-2 6 2 6-5-3M4 6l3 2"/>`,
  // A case file.
  file: `<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M8 12h8M8 15.5h8M8 19h5"/>`,
  // A ticked list.
  check: `<path d="M4 6.5l1.6 1.6L8.5 5M4 12.5l1.6 1.6 2.9-3.1M4 18.5l1.6 1.6 2.9-3.1M11 7h9M11 13h9M11 19h9"/>`,
  // A skull: down again.
  skull: `<path d="M12 3c-4.6 0-8 3.2-8 7.6 0 2.6 1.2 4.4 3 5.4V20h10v-4c1.8-1 3-2.8 3-5.4C20 6.2 16.6 3 12 3z"/><circle cx="8.8" cy="11" r="1.8" fill="currentColor"/><circle cx="15.2" cy="11" r="1.8" fill="currentColor"/><path d="M10 20v-2.5M14 20v-2.5M11 15h2"/>`,
  // Infinity: Endless.
  infinity: `<path d="M12 12c-2-2.8-3.6-4.2-5.4-4.2C4.3 7.8 3 9.8 3 12s1.3 4.2 3.6 4.2c1.8 0 3.4-1.4 5.4-4.2 2 2.8 3.6 4.2 5.4 4.2 2.3 0 3.6-2 3.6-4.2s-1.3-4.2-3.6-4.2c-1.8 0-3.4 1.4-5.4 4.2z"/>`,
  // A controller.
  pad: `<path d="M7 7h10c3 0 4.5 2.2 5 5l.6 3.6c.4 2.4-1.8 3.8-3.6 2.4L16 16H8l-3 2c-1.8 1.4-4-.1-3.6-2.4L2 12c.5-2.8 2-5 5-5z"/><path d="M7 10v4M5 12h4"/><circle cx="16" cy="10.5" r="1" fill="currentColor"/><circle cx="18" cy="12.8" r="1" fill="currentColor"/>`,
  // The crown.
  crown: `<path d="M3 8l4.5 4L12 4.5 16.5 12 21 8l-2 11H5z"/><path d="M5 19h14"/><circle cx="12" cy="4" r="1.2" fill="currentColor"/>`,
  // A ledge, and someone going over it.
  ledge: `<path d="M2 9h11v13"/><path d="M17 4.5a2 2 0 1 0 0 .1M17 7.5l-1.5 5 3 3M15.5 12.5L13 14M17 8l3 2"/><path d="M19 19.5l1.5 2.5M21.5 17l1 2.5" stroke-dasharray="1.6 1.6"/>`,
  // A crown over a shield: never went down.
  reign: `<path d="M5 9.5l3 2.6L12 7l4 5.1 3-2.6-1.3 6.5H6.3z"/><path d="M12 22c-4-1.3-6.5-3.7-6.8-6.4h13.6C18.5 18.3 16 20.7 12 22z"/>`,
  // A chequered flag.
  flag: `<path d="M5 22V3"/><path d="M5 4h14v9H5"/><path d="M5 4h3.5v3H5zM12 4h3.5v3H12zM8.5 7H12v3H8.5zM15.5 7H19v3h-3.5zM5 10h3.5v3H5zM12 10h3.5v3H12z" fill="currentColor" stroke="none"/>`,
  // An open hand.
  hand: `<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15c0 4-3 7-7 7-3 0-4.6-1.3-6.2-3.6L3.6 14c-.8-1.2 1-2.6 2.1-1.6L8 14.5"/>`,
  // A bolt with a V: Insane.
  bolt: `<path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z" fill="currentColor" fill-opacity=".25"/>`,
};

const METALS = {
  bronze: ["#f6b07c", "#c06a35", "#7b3d18"],
  silver: ["#ffffff", "#b9c5d0", "#6e7b87"],
  gold: ["#fff2a8", "#f2b52c", "#a46a0a"],
  platinum: ["#ffffff", "#bdeeff", "#8a9cff"],
};

const hex = (cx, cy, r) => [0, 1, 2, 3, 4, 5].map((i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2;
  return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
}).join(" ");

/** The badge for a trophy (an <svg> string). `mark: false` hides the mark (a hidden trophy). */
export function trophyBadge(trophy, { mark = true } = {}) {
  const tier = trophy.tier;
  const [a, b, c] = METALS[tier];
  const id = `tm-${tier}`;
  const art = mark ? MARKS[trophy.icon] ?? MARKS.platinum : `<text x="12" y="17" text-anchor="middle" font-size="15" font-weight="900" fill="currentColor" stroke="none">?</text>`;
  return `<svg class="trophy-badge tier-${tier}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
    <polygon points="${hex(32, 32, 30)}" fill="url(#${id})"/>
    <polygon points="${hex(32, 32, 30)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>
    <polygon points="${hex(32, 32, 23.5)}" fill="#0d1318"/>
    <polygon points="${hex(32, 32, 23.5)}" fill="none" stroke="url(#${id})" stroke-width="1.4"/>
    <g transform="translate(17 17) scale(1.25)" fill="none" stroke="${b}" color="${b}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${art}</g>
  </svg>`;
}

/**
 * A kit's token (src/figure/kits.js): a hexagon in the kit's colour with a
 * jacket on its hanger - or, locked, a padlock.
 */
export function kitToken(kit, { locked = false } = {}) {
  const c = kit.colour;
  const id = `kt-${kit.key}`;
  const mark = locked
    ? `<rect x="7" y="11" width="10" height="8" rx="1.6" fill="currentColor"/><path d="M9 11V8.5a3 3 0 0 1 6 0V11" fill="none" stroke="currentColor" stroke-width="1.8"/>`
    : `<path d="M12 4.5a1.6 1.6 0 1 1 1.6 1.6c-.9 0-1.6.6-1.6 1.4M12 7.5l-7.5 4.2h15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 12.5l1 8h9l1-8-3.4-1.2c-.4 1.3-1.6 2.2-3.1 2.2s-2.7-.9-3.1-2.2z" fill="currentColor" opacity=".9"/>`;
  return `<svg class="trophy-badge kit-token${locked ? " locked" : ""}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="#1b1f26"/></linearGradient></defs>
    <polygon points="${hex(32, 32, 30)}" fill="url(#${id})"/>
    <polygon points="${hex(32, 32, 23.5)}" fill="#0d1318"/>
    <polygon points="${hex(32, 32, 23.5)}" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="${locked ? "3 3" : "0"}"/>
    <g transform="translate(17 17) scale(1.25)" color="${locked ? "#8796a0" : c}">${mark}</g>
  </svg>`;
}

/** The trophy cup. */
export function cupIcon() {
  return `<svg class="cup-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 5H3.5c0 3 1.5 4.5 3.8 4.8M17 5h3.5c0 3-1.5 4.5-3.8 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13v4M8 21h8l-1-4H9z" fill="currentColor"/></svg>`;
}
