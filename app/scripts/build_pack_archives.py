#!/usr/bin/env python3
"""Package app/pack-source/<city> into app/pack-server/packs/<city>.yanlu-pack.zip."""
import os, shutil, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'pack-source')
OUT = os.path.join(ROOT, 'pack-server', 'packs')
os.makedirs(OUT, exist_ok=True)
for city in ['chongqing', 'wuhan', 'guiyang']:
    for suffix in ['', '-fine']:
        src = os.path.join(SRC, city + suffix)
        if not os.path.isdir(src):
            if suffix == '':
                print('missing source', city)
            continue
        out = os.path.join(OUT, f'{city}{suffix}.yanlu-pack.zip')
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for dp, _, files in os.walk(src):
                for name in sorted(files):
                    path = os.path.join(dp, name)
                    rel = os.path.relpath(path, src)
                    z.write(path, rel)
        print(city + suffix, f'{os.path.getsize(out)/1e6:.1f} MB')
        if suffix == '':
            pois = os.path.join(src, 'pois.json')
            if os.path.exists(pois):
                shutil.copyfile(pois, os.path.join(OUT, f'{city}-pois.json'))
                print(city + '-pois', f'{os.path.getsize(pois)/1e6:.1f} MB')
