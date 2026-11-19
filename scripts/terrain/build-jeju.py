"""Build the Jeju Island & RKPC Airport terrain and scenery assets.

Uses WGS84 east/south tangent plane centered on Jeju International Airport (RKPC):
Origin: 33.5113° N, 126.4930° E
Elevation: 36.0 m
Covers 40 km x 40 km including Jeju Airport, Jeju City, and Mount Hallasan (1,950m).
See docs/development/jeju-scenery.md for specifications.
"""
from pathlib import Path
from urllib.request import urlopen
import hashlib
import json
import math

try:
    import numpy as np
except ImportError:
    np = None

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/scenery/jeju'
CACHE = ROOT / '.cache/terrain'
TILE = 'Copernicus_DSM_COG_10_N33_00_E126_00_DEM'
URL = f'https://copernicus-dem-30m.s3.amazonaws.com/{TILE}/{TILE}.tif'
LAT, LON = 33.5113, 126.4930
SIZE, GRID = 40000, 801 # 40 km x 40 km grid, 50 m spacing
NOTICE = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence '
          'and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved')


def build_jeju_metadata(sha256='', max_elevation=1950.0):
    spacing = SIZE / (GRID - 1)
    return {
        'schemaVersion': 1,
        'origin': {'latitude': LAT, 'longitude': LON, 'reference': 'Jeju International Airport ARP (RKPC)'},
        'elevationM': 36.0,
        'worldSize': SIZE,
        'sampleSpacingM': spacing,
        'gridSize': GRID,
        'hallasan': {'latitude': 33.3617, 'longitude': 126.5332, 'elevationM': 1947.0},
        'dem': {
            'product': 'Copernicus WorldDEM-30 GLO-30 DSM',
            'tile': TILE,
            'sourceUrl': URL,
            'notice': NOTICE,
            'maxElevationM': max_elevation,
            'sha256': sha256
        },
        'runways': [
            {
                'id': '07/25',
                'lengthM': 3180,
                'widthM': 45,
                'headingDeg': 67,
                'elevationM': 36.0,
                'threshold07': {'x': -1463.6, 'z': 621.3},
                'threshold25': {'x': 1463.6, 'z': -621.3}
            },
            {
                'id': '13/31',
                'lengthM': 1900,
                'widthM': 45,
                'headingDeg': 132,
                'elevationM': 36.0,
                'threshold13': {'x': -706.0, 'z': -635.6},
                'threshold31': {'x': 706.0, 'z': 635.6}
            }
        ]
    }


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    metadata = build_jeju_metadata()
    (OUT / 'terrain-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Wrote Jeju scenery metadata to {OUT / "terrain-metadata.json"}')


if __name__ == '__main__':
    main()
