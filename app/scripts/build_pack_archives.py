#!/usr/bin/env python3
"""Package app/pack-source/<city> into app/pack-server/packs/<city>.yanlu-pack.zip."""
import os, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'pack-source')
OUT = os.path.join(ROOT, 'pack-server', 'packs')
os.makedirs(OUT, exist_ok=True)
for city in ['chongqing', 'wuhan', 'guiyang']:
    src = os.path.join(SRC, city)
    if not os.path.isdir(src):
        print('missing source', city)
        continue
    out = os.path.join(OUT, f'{city}.yanlu-pack.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dp, _, files in os.walk(src):
            for name in sorted(files):
                path = os.path.join(dp, name)
                rel = os.path.relpath(path, src)
                z.write(path, rel)
    print(city, f'{os.path.getsize(out)/1e6:.1f} MB')
