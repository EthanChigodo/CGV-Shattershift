/**
 * Route geometry for Level 2.
 *
 * The guide asks for "90-degree route turns" and for the camera to ease around
 * junctions rather than snap. That needs the level to be more than a straight
 * -Z corridor, so the foundry is laid out along a polyline of straights and
 * arcs. Every piece of environment is placed by distance along the route plus a
 * lateral offset, and the player controller can follow the same curve.
 *
 * Conventions (matching the existing prototype):
 *   - heading 0 means travelling down -Z
 *   - forward(h) = (-sin h, 0, -cos h)
 *   - right(h)   = ( cos h, 0, -sin h)   (positive lateral offset = player's right)
 *   - a positive arc angle turns left
 */

import * as THREE from "../../three.js";

export function forwardVector(heading, target = new THREE.Vector3()) {
  return target.set(-Math.sin(heading), 0, -Math.cos(heading));
}

export function rightVector(heading, target = new THREE.Vector3()) {
  return target.set(Math.cos(heading), 0, -Math.sin(heading));
}

/**
 * @param {Array<{type:'straight',length:number}|{type:'arc',radius:number,angle:number}>} segments
 * @param {{origin?:THREE.Vector3, heading?:number}} options
 */
export function createRoute(segments, { origin = new THREE.Vector3(), heading = 0 } = {}) {
  const nodes = [];
  let cursor = origin.clone();
  let currentHeading = heading;
  let travelled = 0;

  for (const segment of segments) {
    const length =
      segment.type === "arc" ? Math.abs(segment.angle) * segment.radius : segment.length;

    const node = {
      ...segment,
      length,
      startDistance: travelled,
      endDistance: travelled + length,
      startPosition: cursor.clone(),
      startHeading: currentHeading,
    };

    if (segment.type === "arc") {
      const sign = Math.sign(segment.angle) || 1;
      // Centre of the arc sits one radius to the player's left for a left turn.
      const lateral = rightVector(currentHeading).multiplyScalar(-sign * segment.radius);
      node.centre = cursor.clone().add(lateral);
      node.sign = sign;
      currentHeading += segment.angle;
      // End position: rotate the start offset about the centre by the full angle.
      const offset = cursor.clone().sub(node.centre);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), segment.angle);
      cursor = node.centre.clone().add(offset);
    } else {
      cursor.add(forwardVector(currentHeading).multiplyScalar(length));
    }

    travelled += length;
    nodes.push(node);
  }

  const totalLength = travelled;
  const up = new THREE.Vector3(0, 1, 0);

  function nodeAt(distance) {
    const clamped = THREE.MathUtils.clamp(distance, 0, totalLength);
    for (const node of nodes) {
      if (clamped <= node.endDistance) return { node, local: clamped - node.startDistance };
    }
    const last = nodes[nodes.length - 1];
    return { node: last, local: last.length };
  }

  /**
   * Position and heading at a distance along the route.
   * `lateral` offsets to the player's right, `height` straight up.
   */
  function sample(distance, lateral = 0, height = 0, target = new THREE.Vector3()) {
    if (!nodes.length) return { position: target.copy(origin), heading };
    const { node, local } = nodeAt(distance);
    let heading2;

    if (node.type === "arc") {
      const turned = node.sign * (local / node.radius);
      heading2 = node.startHeading + turned;
      const offset = node.startPosition.clone().sub(node.centre);
      offset.applyAxisAngle(up, turned);
      target.copy(node.centre).add(offset);
    } else {
      heading2 = node.startHeading;
      target.copy(node.startPosition).add(forwardVector(heading2).multiplyScalar(local));
    }

    if (lateral) target.add(rightVector(heading2).multiplyScalar(lateral));
    if (height) target.y += height;
    return { position: target, heading: heading2 };
  }

  /**
   * Place an Object3D on the route. The object's local -Z ends up pointing the
   * way the player is travelling, so kit pieces authored facing -Z just work.
   */
  function place(object, distance, lateral = 0, height = 0) {
    const { position, heading: h } = sample(distance, lateral, height);
    object.position.copy(position);
    object.rotation.y = h;
    return object;
  }

  /** Distance at which each junction (arc) starts, for camera and UI cues. */
  const junctions = nodes
    .filter((node) => node.type === "arc")
    .map((node) => ({
      startDistance: node.startDistance,
      endDistance: node.endDistance,
      direction: node.sign > 0 ? "left" : "right",
      angle: node.angle,
      radius: node.radius,
    }));

  return { nodes, junctions, totalLength, sample, place, nodeAt };
}

/**
 * The straight fallback, for dropping the foundry into a player controller that
 * does not follow the route yet (the current prototype moves along -Z only).
 */
export function straightSegments(length) {
  return [{ type: "straight", length }];
}
