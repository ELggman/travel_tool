#!/usr/bin/env python3
"""Tiny static server with HTTP Range + CORS, for validating pack downloads."""
import argparse, os, re, shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Range')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d+)-(\d*)', rng)
        if not m:
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416); return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._range = (f, end - start + 1)
        return f

    def copyfile(self, source, outputfile):
        if hasattr(self, '_range'):
            f, n = self._range
            shutil.copyfileobj(f, outputfile, n)
            f.close()
            del self._range
        else:
            super().copyfile(source, outputfile)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='spikes/map')
    ap.add_argument('--port', type=int, default=8093)
    a = ap.parse_args()
    os.chdir(a.dir)
    ThreadingHTTPServer(('127.0.0.1', a.port), Handler).serve_forever()
