#!/usr/bin/env python3
"""Assemble dist/ for HACS (Dashboard/plugin) and manual installs.

HACS downloads every file directly inside dist/ (not subfolders) when dist/<repo>.js exists,
so the package is flat: the entry ha-korea-map.js, its sibling modules and the boundary.
Generated key configs are never copied (they live outside the package folder).
"""
import hashlib
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
WWW = ROOT / 'config' / 'www'
DIST = ROOT / 'dist'
FILES = [
    'ha-korea-map.js',
    'ha-map-extension.mjs',
    'ha-map-router.mjs',
    'ha-map-sdk.mjs',
    'ha-map-cluster.mjs',
    'ha-map-auto.mjs',
    'ha-map-korea-boundary.geojson',
]


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    for name in FILES:
        shutil.copyfile(WWW / name, DIST / name)
    shutil.copyfile(ROOT / 'data' / 'README.md', DIST / 'ATTRIBUTION.md')
    lines = [
        f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}'
        for p in sorted(DIST.iterdir())
        if p.name != 'SHA256SUMS'
    ]
    (DIST / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
