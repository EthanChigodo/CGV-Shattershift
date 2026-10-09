"""Serve the game locally, never from the browser's cache.

    python tools/serve.py          # http://localhost:4173
    python tools/serve.py 8000     # another port

`python -m http.server` lets the browser cache files, so after an update
you can get the new index.html with an old main.js or styles.css - the
menus lose their styling and buttons stop working until a hard refresh.
This server tells the browser not to cache anything, and serves .js and
.mjs as JavaScript even when Windows' registry says otherwise (module
scripts served as text/plain do not run at all).
"""

import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".glb": "model/gltf-binary",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    server = http.server.ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Fracture Run: http://localhost:{port}  (serving {ROOT}; Ctrl+C to stop)")
    server.serve_forever()
