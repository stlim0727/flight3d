"""Build the Fitz Roy (Patagonia) DEM and satellite texture from public sources.

Requires the same pinned Python environment as build-lukla.py:
    python -m pip install -r scripts/terrain/requirements.txt
"""
from pathlib import Path
from urllib.request import urlopen
import hashlib
import io
import json
import math

import numpy as np
from PIL import Image
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import reproject, Resampling, transform

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/terrain'
OUT = ROOT / 'public/terrain/patagonia'
LAT, LON = -49.271278, -73.043222
SIZE, GRID = 44000, 1025
TILES = [
    ('S50_00_W073_00', '1a2fc644fdc9ac7fd4a4e4c4e3d7899680839eb05d4e2cae1cb621aa7f418933'),
    ('S50_00_W074_00', 'aa8afaff8eec42b506319102b33c30bc27872c858645cb444c0a42a3132f8152'),
]
NOTICE = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence '
          'and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; '
          'all rights reserved')
LOCAL = CRS.from_string(f'+proj=aeqd +lat_0={LAT} +lon_0={LON} +datum=WGS84 +units=m')


def download(url, name, expected_sha=None):
    path = CACHE / name
    if not path.exists():
        with urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    if expected_sha and hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha:
        raise ValueError(f'Source checksum mismatch for {name}')
    return path


def dem_sample(source, lon, lat):
    """Independent bilinear source read, used as a provenance checkpoint."""
    col, row = ~source.transform * (lon, lat)
    x0, y0 = math.floor(col), math.floor(row)
    fx, fy = col - x0, row - y0
    values = source.read(1, window=((y0, y0 + 2), (x0, x0 + 2)))
    return float(values[0, 0] * (1 - fx) * (1 - fy) + values[0, 1] * fx * (1 - fy)
                 + values[1, 0] * (1 - fx) * fy + values[1, 1] * fx * fy)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    spacing = SIZE / (GRID - 1)
    target = from_origin(-SIZE / 2 - spacing / 2, SIZE / 2 + spacing / 2, spacing, spacing)
    elevations = np.full((GRID, GRID), np.nan, dtype='<f4')
    sources = []
    datasets = []
    for tile, sha in TILES:
        url = (f'https://copernicus-dem-30m.s3.amazonaws.com/'
               f'Copernicus_DSM_COG_10_{tile}_DEM/Copernicus_DSM_COG_10_{tile}_DEM.tif')
        path = download(url, f'copernicus-{tile.lower()}.tif', sha)
        sources.append({'url': url, 'sha256': sha})
        dem = rasterio.open(path)
        datasets.append(dem)
        patch = np.full((GRID, GRID), np.nan, dtype='<f4')
        reproject(rasterio.band(dem, 1), patch, src_transform=dem.transform, src_crs=dem.crs,
                  dst_transform=target, dst_crs=LOCAL, init_dest_nodata=False,
                  resampling=Resampling.bilinear)
        elevations = np.fmax(elevations, patch)
    if not np.isfinite(elevations).all():
        raise ValueError('Patagonia DEM has missing samples')

    mid = (GRID - 1) // 2
    checks = []
    for row, col in [(mid, mid), (mid - 100, mid), (mid + 100, mid - 50),
                     (mid, mid - 100), (mid - 70, mid + 80)]:
        x, z = (col - mid) * spacing, (row - mid) * spacing
        lon, lat = transform(LOCAL, 'EPSG:4326', [x], [-z])
        sample = next((dem_sample(dem, lon[0], lat[0]) for dem in datasets
                       if dem.bounds.left <= lon[0] <= dem.bounds.right
                       and dem.bounds.bottom <= lat[0] <= dem.bounds.top), None)
        checks.append({'x': x, 'z': z, 'lat': lat[0], 'lon': lon[0],
                       'sourceHeightM': sample, 'gridHeightM': float(elevations[row, col])})
    for dem in datasets:
        dem.close()

    binary = elevations.tobytes()
    (OUT / 'patagonia_dem.bin').write_bytes(binary)

    zoom = 12
    radius = 6378137
    extent = math.pi * radius
    span = 2 * extent / 2 ** zoom
    corners = [-SIZE / 2, SIZE / 2]
    xs, ys = transform(LOCAL, 'EPSG:3857',
                       [x for x in corners for y in corners],
                       [y for x in corners for y in corners])
    min_x, max_x = math.floor((min(xs) + extent) / span), math.floor((max(xs) + extent) / span)
    min_y, max_y = math.floor((extent - max(ys)) / span), math.floor((extent - min(ys)) / span)
    mosaic = Image.new('RGB', ((max_x - min_x + 1) * 256, (max_y - min_y + 1) * 256))
    tile_hashes = {}
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            url = (f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/'
                   f'MapServer/tile/{zoom}/{y}/{x}')
            tile = download(url, f'esri-{zoom}-{x}-{y}.jpg').read_bytes()
            tile_hashes[f'{zoom}/{y}/{x}'] = hashlib.sha256(tile).hexdigest()
            mosaic.paste(Image.open(io.BytesIO(tile)).convert('RGB'),
                         ((x - min_x) * 256, (y - min_y) * 256))
    source_pixels = np.array(mosaic)
    image_size = 2048
    image = np.zeros((image_size, image_size, 3), dtype=np.uint8)
    mosaic_transform = from_bounds(min_x * span - extent, extent - (max_y + 1) * span,
                                   (max_x + 1) * span - extent, extent - min_y * span,
                                   mosaic.width, mosaic.height)
    for band in range(3):
        reproject(source_pixels[:, :, band], image[:, :, band],
                  src_transform=mosaic_transform, src_crs='EPSG:3857',
                  dst_transform=from_bounds(-SIZE / 2, -SIZE / 2, SIZE / 2, SIZE / 2,
                                            image_size, image_size),
                  dst_crs=LOCAL, resampling=Resampling.bilinear)
    Image.fromarray(image).save(OUT / 'patagonia_satellite.jpg', quality=90)

    metadata = {
        'gridSize': GRID, 'worldSize': SIZE, 'sampleSpacingM': spacing,
        'origin': {'lat': LAT, 'lon': LON,
                   'reference': 'Mount Fitz Roy summit, Wikipedia/Wikidata coordinates'},
        'projection': LOCAL.to_string(),
        'axes': 'x east, z south; binary rows north to south, columns west to east',
        'dem': {'dataset': 'Copernicus DEM GLO-30 public (DSM)', 'sources': sources,
                'outputSha256': hashlib.sha256(binary).hexdigest(),
                'resampling': 'bilinear', 'verticalDatum': 'EGM2008 orthometric metres',
                'sourceSpacingArcSec': 1, 'attribution': NOTICE, 'checkpoints': checks},
        'imagery': {'service': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
                    'zoom': zoom, 'tileSha256': tile_hashes,
                    'resampling': 'bilinear to same local-metre extent'},
        'minElevation': float(elevations.min()), 'maxElevation': float(elevations.max()),
        'limitations': 'DSM includes vegetation and ice. Coordinates are not surveyed survey control. '
                       'No airport grading or invented terrain is applied.',
    }
    (OUT / 'patagonia_metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (ROOT / 'src/config/patagoniaTerrainGrid.json').write_text(
        json.dumps({'gridSize': GRID, 'worldSize': SIZE}, indent=2) + '\n')
    print(f'Wrote {GRID}x{GRID} Patagonia DEM and satellite imagery')


if __name__ == '__main__':
    main()
