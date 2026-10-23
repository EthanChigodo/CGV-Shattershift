/**
 * Rooms behind the windows - "interior mapping", the trick big open-world
 * games use so a flat facade looks into real rooms.
 *
 * No geometry: in the window's pixel, the ray from the eye is carried on
 * through the glass into a box (the room behind it), and whichever of the
 * box's faces it meets first - a side wall, the floor, the ceiling or the
 * back wall - is what that pixel shows. Move the camera and the rooms shift
 * in perspective, like rooms do.
 *
 * Everything is in a "face frame": x along the wall, y up, z out of it (the
 * wall's surface at p.z, the room from p.z - depth to p.z).
 *
 *   float shade = roomShade(p, eye, cellCorner, cellSize, depth, seed);
 *   // ~1.25 a lit ceiling .. 0.35 the floor, darker deeper in;
 *   // the back wall with a cabinet, and now and then someone standing there.
 */

export const ROOMS_GLSL = /* glsl */ `
  float roomShade(vec3 p, vec3 eye, vec2 lo, vec2 size, float depth, float seed) {
    vec3 rd = normalize(p - eye);
    vec3 lo3 = vec3(lo, p.z - depth);
    vec3 hi3 = vec3(lo + size, p.z);
    // Where the ray leaves the box along each axis; the nearest is the face it meets.
    vec3 tF = max((lo3 - p) / rd, (hi3 - p) / rd);
    float t = min(min(tF.x, tF.y), tF.z);
    vec3 q = p + rd * t;
    float into = clamp((p.z - q.z) / depth, 0.0, 1.0);
    float shade;
    if (t == tF.z) {
      // The back wall: a cabinet or desk against it, sometimes a person.
      vec2 b = (q.xy - lo) / size;
      shade = 0.8;
      shade *= 1.0 - 0.55 * step(b.y, 0.36) * step(0.12, b.x) * step(b.x, 0.62) * step(0.35, fract(seed * 7.31));
      float who = step(0.9, fract(seed * 13.71));
      float px = 0.25 + 0.5 * fract(seed * 3.13);
      float body = step(abs(b.x - px), 0.07) * step(b.y, 0.6) + step(length(vec2((b.x - px) * 1.7, b.y - 0.68)), 0.08);
      shade *= 1.0 - 0.85 * min(body, 1.0) * who;
    } else if (t == tF.y) {
      shade = rd.y > 0.0 ? 1.25 : 0.36;   // the ceiling's light; the floor
    } else {
      shade = 0.6;                          // side walls
    }
    return shade * mix(1.0, 0.55, into);
  }
`;
