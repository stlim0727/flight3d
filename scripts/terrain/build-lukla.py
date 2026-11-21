"""Rebuild georeferenced Lukla assets; requires rasterio==1.5.2, numpy==2.5.4, Pillow==13.0.0."""
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
OUT = ROOT / 'public/terrain'
LAT, LON = 27.6868342, 86.7294519
SIZE, GRID = 44000, 1025
TILE = 'Copernicus_DSM_COG_10_N27_00_E086_00_DEM'
URL = f'https://copernicus-dem-30m.s3.amazonaws.com/{TILE}/{TILE}.tif'
SHA = '4dfc87a0dec44a8a037164ddade45dd24bb53187176b5a14175c265bd6d20e76'
NOTICE = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH '
          '2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved')
LOCAL = CRS.from_string(f'+proj=aeqd +lat_0={LAT} +lon_0={LON} +datum=WGS84 +units=m')


def download(url, name):
    path = CACHE / name
    if not path.exists():
        with urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    return path


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    source = download(URL, 'copernicus-n27-e086.tif')
    if hashlib.sha256(source.read_bytes()).hexdigest() != SHA:
        raise ValueError('Source DEM checksum mismatch')
    # Grid samples lie at world endpoints, not half a sample inside the bounds.
    spacing = SIZE / (GRID - 1)
    target = from_origin(-SIZE / 2 - spacing / 2, SIZE / 2 + spacing / 2, spacing, spacing)
    elevations = np.full((GRID, GRID), np.nan, dtype='<f4')
    with rasterio.open(source) as dem:
        reproject(rasterio.band(dem, 1), elevations, src_transform=dem.transform,
                  src_crs=dem.crs, dst_transform=target, dst_crs=LOCAL,
                  dst_nodata=np.nan, resampling=Resampling.bilinear)
        checks = []
        mid = (GRID - 1) // 2
        for row, col in [(mid, mid), (mid - 100, mid), (mid + 100, mid - 50), (mid, mid - 100), (mid - 70, mid + 80)]:
            x, z = (col - mid) * spacing, (row - mid) * spacing
            lon, lat = transform(LOCAL, 'EPSG:4326', [x], [-z])
            px, py = (~dem.transform) * (lon[0], lat[0])
            px, py = px - 0.5, py - 0.5
            ix, iy = math.floor(px), math.floor(py)
            fx, fy = px - ix, py - iy
            block = dem.read(1, window=((iy, iy+2), (ix, ix+2)))
            height = float(block[0, 0]*(1-fx)*(1-fy) + block[0, 1]*fx*(1-fy) +
                           block[1, 0]*(1-fx)*fy + block[1, 1]*fx*fy)
            checks.append({'x': x, 'z': z, 'lat': lat[0], 'lon': lon[0], 'sourceHeightM': height})
    if not np.isfinite(elevations).all():
        raise ValueError('DEM has missing samples')
    binary = elevations.tobytes()
    (OUT / 'lukla_dem.bin').write_bytes(binary)

    # Fetch the imagery tiles covering the same local-meter square. Reproject
    # their Web Mercator mosaic instead of stretching a tile square over it.
    zoom, radius = 13, 6378137
    extent = math.pi * radius
    span = 2 * extent / 2 ** zoom
    corners = [-SIZE / 2, SIZE / 2]
    xs, ys = transform(LOCAL, 'EPSG:3857', [x for x in corners for y in corners],
                       [y for x in corners for y in corners])
    min_x, max_x = math.floor((min(xs) + extent) / span), math.floor((max(xs) + extent) / span)
    min_y, max_y = math.floor((extent - max(ys)) / span), math.floor((extent - min(ys)) / span)
    mosaic = Image.new('RGB', ((max_x - min_x + 1) * 256, (max_y - min_y + 1) * 256))
    tile_hashes = {}
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}'
            tile = download(url, f'esri-{zoom}-{x}-{y}.jpg').read_bytes()
            tile_hashes[f'{zoom}/{y}/{x}'] = hashlib.sha256(tile).hexdigest()
            mosaic.paste(Image.open(io.BytesIO(tile)).convert('RGB'), ((x - min_x) * 256, (y - min_y) * 256))
    source_pixels = np.array(mosaic)
    image_size = 2048
    image = np.zeros((image_size, image_size, 3), dtype=np.uint8)
    mosaic_transform = from_bounds(min_x * span - extent, extent - (max_y + 1) * span,
                                   (max_x + 1) * span - extent, extent - min_y * span,
                                   mosaic.width, mosaic.height)
    for band in range(3):
        reproject(source_pixels[:, :, band], image[:, :, band], src_transform=mosaic_transform,
                  src_crs='EPSG:3857', dst_transform=from_bounds(-SIZE/2, -SIZE/2, SIZE/2, SIZE/2, image_size, image_size),
                  dst_crs=LOCAL, resampling=Resampling.bilinear)
    Image.fromarray(image).save(OUT / 'lukla_satellite.jpg', quality=90)
    metadata = {
        'gridSize': GRID, 'worldSize': SIZE, 'sampleSpacingM': spacing,
        'origin': {'lat': LAT, 'lon': LON, 'reference': 'Midpoint of OSM runway way 1257098603 endpoints, retrieved 2026-10-19'},
        'projection': LOCAL.to_string(), 'axes': 'x east, z south; binary rows north to south, columns west to east',
        'dem': {'dataset': 'Copernicus DEM GLO-30 public (DSM)', 'url': URL, 'sourceSha256': SHA,
                'outputSha256': hashlib.sha256(binary).hexdigest(), 'resampling': 'bilinear',
                'verticalDatum': 'EGM2008 orthometric metres', 'sourceSpacingArcSec': 1,
                'attribution': NOTICE, 'checkpoints': checks},
        'imagery': {'service': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
                    'zoom': zoom, 'tileSha256': tile_hashes, 'resampling': 'bilinear to same local-meter extent'},
        'minElevation': float(elevations.min()), 'maxElevation': float(elevations.max()),
        'limitations': 'DSM includes vegetation/buildings. OSM alignment is not surveyed. Airport runway/apron grading is a simulator approximation; surrounding terrain is unmodified DEM.'
    }
    (OUT / 'lukla_metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (ROOT / 'src/config/luklaTerrainGrid.json').write_text(
        json.dumps({'gridSize': GRID, 'worldSize': SIZE,
                    'origin': {'latitude': LAT, 'longitude': LON}}, indent=2) + '\n')
    print(f'Wrote {GRID}x{GRID} DEM ({spacing:.2f} m spacing) and georeferenced imagery')


if __name__ == '__main__':
    main()
