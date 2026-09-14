/**
 * Minimal static file server for the test run.
 *
 * The checks need the repository served over HTTP, because the game uses ES
 * modules and a file:// URL will not load them. Rather than ask whoever runs
 * the tests to start a server first and remember the port, the harness serves
 * the repo itself on an ephemeral port and shuts it down afterwards.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
};

export async function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      // The browser asks for this unprompted and the repo has none; without
      // this the 404 shows up as a console error and fails the run.
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }

      let filePath = path.join(root, decodeURIComponent(url.pathname));
      if (filePath.endsWith(path.sep)) filePath = path.join(filePath, "index.html");

      // Never serve outside the repository root.
      if (!path.resolve(filePath).startsWith(path.resolve(root))) {
        res.writeHead(403).end("forbidden");
        return;
      }

      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
