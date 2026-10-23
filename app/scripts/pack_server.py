#!/usr/bin/env python3
"""Serve real .yanlu-pack.zip archives with CORS for local/WebView testing."""
import argparse, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Range')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8090)
    args = ap.parse_args()
    os.chdir(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pack-server'))
    ThreadingHTTPServer(('0.0.0.0', args.port), Handler).serve_forever()
