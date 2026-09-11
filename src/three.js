/**
 * Single place where Three.js is imported from.
 *
 * Every module in src/ imports Three through this file rather than naming the
 * CDN URL directly. When the team switches to a local copy of Three.js for
 * offline marking (see the deployment note in README.md), only this one line
 * has to change.
 */
export * from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
