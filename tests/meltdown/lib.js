/**
 * Shared plumbing for the Level 3 checks: a static server for the repo, and
 * a browser page with the right GPU flags and (optionally) a local Three.js.
 *
 * The game imports Three.js from jsDelivr. Where that host is unreachable
 * (sandboxed CI, some lab networks), set MELTDOWN_THREE_DIR to an unpacked
 * `three@0.160.0` npm package and every CDN request is answered from it:
 *
 *   npm pack three@0.160.0 && tar xzf three-0.160.0.tgz
 *   MELTDOWN_THREE_DIR=$PWD/package node tests/meltdown/run.js
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export async function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
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

export async function launch(chromium) {
  const options = {
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  };
  if (process.env.MELTDOWN_CHROMIUM) options.executablePath = process.env.MELTDOWN_CHROMIUM;
  return chromium.launch(options);
}

/**
 * A fresh tab per check. Navigating one tab between checks aborted the
 * previous page's background model loads, and the loader reports those as
 * texture errors - noise that looked like real failures.
 */
export async function openPage(browser, { width = 1280, height = 720 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const threeDir = process.env.MELTDOWN_THREE_DIR;
  if (threeDir) {
    await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
      route.fulfill({ path: path.join(threeDir, rel), contentType: "text/javascript" });
    });
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) errors.push(message.text());
  });
  return { page, errors };
}
