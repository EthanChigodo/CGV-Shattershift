/**
 * Trailer capture plumbing: a static server for the repository that also
 * takes the frames, and a browser on the real GPU.
 *
 * The game is stepped frame by frame (`__dbg.step`), so a capture is exact
 * and smooth however slow the machine is. Each frame is read back raw from
 * WebGL (readPixels) and POSTed here, straight into an ffmpeg encoding that
 * shot. (Encoding in the browser - a canvas's toBlob - gave back, every few
 * frames, an image with blocks of it black.)
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/**
 * Serve `root`. A capture:
 *   POST /__clip/<shot>/start?w=&h=&fps=   start encoding <out>/clips/<shot>.mp4
 *   POST /__clip/<shot>/frame              one frame, raw RGBA, bottom row first
 *   POST /__clip/<shot>/end                finish; answers once the file is written
 */
export async function serve(root, out, { bin = process.env.FFMPEG || "ffmpeg" } = {}) {
  const encoders = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST" && url.pathname.startsWith("/__clip/")) {
        const [, , shot, action] = url.pathname.split("/");
        if (!/^[\w-]+$/.test(shot)) return res.writeHead(400).end();
        if (action === "start") {
          const w = Number(url.searchParams.get("w"));
          const h = Number(url.searchParams.get("h"));
          const fps = Number(url.searchParams.get("fps")) || 30;
          const file = path.join(out, "clips", `${shot}.mp4`);
          const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-framerate", String(fps), "-i", "-",
            "-vf", "vflip", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", file], { stdio: ["pipe", "inherit", "inherit"] });
          encoders.set(shot, { child, frames: 0, done: new Promise((resolve) => child.on("exit", resolve)) });
          return res.writeHead(204).end();
        }
        const enc = encoders.get(shot);
        if (!enc) return res.writeHead(409).end();
        if (action === "frame") {
          for await (const chunk of req) {
            if (!enc.child.stdin.write(chunk)) await new Promise((resolve) => enc.child.stdin.once("drain", resolve));
          }
          enc.frames += 1;
          return res.writeHead(204).end();
        }
        if (action === "end") {
          enc.child.stdin.end();
          const code = await enc.done;
          encoders.delete(shot);
          res.writeHead(code === 0 ? 200 : 500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ frames: enc.frames, code }));
        }
        return res.writeHead(400).end();
      }
      if (url.pathname === "/favicon.ico") return res.writeHead(204).end();
      let filePath = path.join(root, decodeURIComponent(url.pathname));
      if (filePath.endsWith(path.sep)) filePath = path.join(filePath, "index.html");
      if (!path.resolve(filePath).startsWith(path.resolve(root))) return res.writeHead(403).end("forbidden");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * Chromium on the machine's GPU, not the software renderer the tests use.
 * Through ANGLE's OpenGL backend: its Direct3D 11 one, headless, gave back
 * (on an Intel UHD 620) a frame in seven or so on the roof with blocks of it
 * black. TRAILER_ANGLE=d3d11 (or vulkan...) to try another.
 */
export function launch(chromium) {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", `--use-angle=${process.env.TRAILER_ANGLE || "gl"}`, "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--autoplay-policy=no-user-gesture-required"],
  });
}

/** Run ffmpeg with these arguments; resolves when it exits cleanly. */
export function ffmpeg(args, { bin = process.env.FFMPEG || "ffmpeg", quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-y", ...(quiet ? ["-loglevel", "error"] : []), ...args], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

/**
 * Find single-frame glitches in a clip and paint over them with the frame
 * before. Very occasionally the GPU hands back a frame with a block of it
 * black; such a frame looks nothing like either neighbour, while the two
 * neighbours look like each other. Returns the frame numbers it replaced.
 */
export async function deglitch(file, { bin = process.env.FFMPEG || "ffmpeg", w = 64, h = 36, fix = true } = {}) {
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"]);
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const size = w * h;
  const n = Math.floor(raw.length / size);
  // Compared region by region (a grid of 8x6 cells): the black block can be small.
  const CW = w / 8;
  const CH = h / 6;
  const cellDiff = (a, b, cx, cy) => {
    let sum = 0;
    for (let y = cy * CH; y < (cy + 1) * CH; y += 1) {
      for (let x = cx * CW; x < (cx + 1) * CW; x += 1) sum += Math.abs(raw[a * size + y * w + x] - raw[b * size + y * w + x]);
    }
    return sum / (CW * CH);
  };
  const cellMean = (a, cx, cy) => {
    let sum = 0;
    for (let y = cy * CH; y < (cy + 1) * CH; y += 1) for (let x = cx * CW; x < (cx + 1) * CW; x += 1) sum += raw[a * size + y * w + x];
    return sum / (CW * CH);
  };
  // Only the glitch's own signature: a region gone near-black for one frame
  // where both neighbours are lit and agree (flashes and sparks don't count).
  const bad = [];
  for (let i = 1; i < n - 1; i += 1) {
    let glitch = false;
    for (let cy = 0; cy < 6 && !glitch; cy += 1) {
      for (let cx = 0; cx < 8 && !glitch; cx += 1) {
        if (cellMean(i, cx, cy) > 18) continue;
        if (cellMean(i - 1, cx, cy) < 40 || cellMean(i + 1, cx, cy) < 40) continue;
        if (cellDiff(i - 1, i + 1, cx, cy) < 12) glitch = true;
      }
    }
    if (glitch) bad.push(i);
  }
  if (!bad.length || !fix) return bad;
  const fixed = file.replace(/\.mp4$/, ".fixed.mp4");
  // freezeframes takes its replacement from a second input: the clip itself, split.
  const filter = bad.map((i, k) => `[${k ? `v${k}` : "0:v"}]split[a${k}][b${k}];[a${k}][b${k}]freezeframes=first=${i}:last=${i}:replace=${i - 1}[v${k + 1}]`).join(";");
  await ffmpeg(["-i", file, "-filter_complex", filter, "-map", `[v${bad.length}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", fixed], { bin });
  const { rename } = await import("node:fs/promises");
  await rename(fixed, file);
  return bad;
}
