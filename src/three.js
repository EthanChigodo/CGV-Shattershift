/**
 * Single place where Three.js is imported from.
 *
 * Every module in src/ imports Three through this file. Three.js r160 is kept
 * in the repository (lib/three/) rather than loaded from a CDN, so the game
 * runs on networks that block jsDelivr (the lab machines do) and offline for
 * marking. The import maps in index.html and preview/meltdown.html must point
 * "three" at this same file, or the add-ons would load a second copy.
 */
export * from "../lib/three/build/three.module.js";
