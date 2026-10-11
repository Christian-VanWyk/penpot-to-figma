#!/usr/bin/env python3
"""Serves this folder at http://localhost:4400 so Penpot can load the plugin.

Usage:  python3 serve.py [port]
Leave it running while you use the plugin; press Ctrl+C to stop.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4400
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


print("Penpot plugin is being served.")
print(f"In Penpot, open Plugins (Ctrl+Alt+P) and install: http://localhost:{PORT}/manifest.json")
print("Keep this running while you use it. Press Ctrl+C to stop.")
try:
    http.server.ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
except KeyboardInterrupt:
    pass
