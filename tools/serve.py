"""Serve the game locally, never from the browser's cache.

    python tools/serve.py              # the source:  http://localhost:4173
    python tools/serve.py 8000         # another port
    python tools/serve.py 4173 dist    # the upload build (tools/build-deploy.py):
                                       #   http://localhost:4173/fracture-run/

`python -m http.server` lets the browser cache files, so after an update
you can get the new index.html with an old main.js or styles.css - the
menus lose their styling and buttons stop working until a hard refresh.
This server tells the browser not to cache anything, and serves .js and
.mjs as JavaScript even when Windows' registry says otherwise (module
scripts served as text/plain do not run at all).

Serving `dist` behaves like the department's Linux server: the game is in a
subfolder (not at the root), and filenames are case-sensitive - a request
whose case does not match the file on disk is a 404, as it would be there.
"""

import http.server
import os
import socket
import sys
import urllib.parse

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
    root = ROOT
    strict_case = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.root, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def send_head(self):
        if self.strict_case and not self._exact_case():
            self.send_error(404, "Not found (filename case differs - Linux would 404 this)")
            return None
        return super().send_head()

    def _exact_case(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        here = self.root
        for part in [p for p in path.split("/") if p]:
            try:
                if part not in os.listdir(here):
                    return False
            except NotADirectoryError:
                return False
            here = os.path.join(here, part)
        return True


class SingleServer(http.server.ThreadingHTTPServer):
    # One server per port: on Windows, address reuse lets a second server
    # bind the same port silently, and requests land on either at random.
    allow_reuse_address = False
    daemon_threads = True
    # The page asks for ~100 modules at once. Python's default queue of 5
    # waiting connections overflows, and Windows refuses the rest outright
    # (ERR_CONNECTION_REFUSED on random files). Room for all of them.
    request_queue_size = 512

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class DualStackServer(SingleServer):
    # Both IPv4 and IPv6: Windows often resolves "localhost" to ::1 first,
    # and a browser that doesn't fall back to 127.0.0.1 gets "connection
    # refused" from an IPv4-only server.
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    if len(sys.argv) > 2:
        NoCacheHandler.root = os.path.abspath(os.path.join(ROOT, sys.argv[2]))
        NoCacheHandler.strict_case = True
    try:
        server = DualStackServer(("::", port), NoCacheHandler)
    except OSError:
        # (No IPv6 on this machine: IPv4 only.)
        try:
            server = SingleServer(("", port), NoCacheHandler)
        except OSError:
            print(f"Port {port} is already in use - is the game already being served? Close that one, or use another port: python tools/serve.py {port + 1}", flush=True)
            sys.exit(1)
    where = "the build, case-sensitive" if NoCacheHandler.strict_case else "the source"
    print(f"Fracture Run: http://localhost:{port}  (serving {NoCacheHandler.root} - {where}; Ctrl+C to stop)", flush=True)
    server.serve_forever()
