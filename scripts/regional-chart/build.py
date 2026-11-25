"""Build the north-up regional chart archive. See docs/design/pilotage-map.ko.md."""
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from urllib.request import urlretrieve

import mapbox_vector_tile as mvt
import numpy as np
import shapefile
import shapely
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import Point, box, shape

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".tmp" / "chart-sources"
ZOOM = 7
COUNT = 2 ** ZOOM
NEPAL_URL = ("https://www.geoboundaries.org/data/snapshots/"
             "1c423398df24ddf6e730b116567d2181c9782778d0459c3f3b76ca2f9f12b6bc/"
             "gbOpen/NPL/ADM1/geoBoundaries-NPL-ADM1_simplified.geojson")
HASHES = {
    "admin_0_boundary_lines_land": "16ead035f539c8b6c23650c5845d86ad3556553e7456bdf9b4730210f26aacbe",
    "admin_1_states_provinces": "efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05",
    "admin_1_states_provinces_lines": "86acd56ce6c0e47f5fa79725591533b5766f26d6ed1437b086f2b8d4028fe456",
    "populated_places": "cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b",
    "nepal": "85cb56907eeda7acc62694b721c77201bbc0cec6ebd69df03fcf3df6339cb667",
}
PROVINCES = {
    "Biratnagar": ("Koshi", "코시주"), "Janakpur": ("Madhesh", "마데시주"),
    "Bagmati": ("Bagmati", "바그마티주"), "Gandaki": ("Gandaki", "간다키주"),
    "Lumbini": ("Lumbini", "룸비니주"), "Karnali": ("Karnali", "카르날리주"),
    "Sudurpaschim": ("Sudurpashchim", "수두르파시침주"),
}
KOREAN_STATES = {
    "KR-42": ("Gangwon State", "강원특별자치도"),
    "KR-45": ("Jeonbuk State", "전북특별자치도"),
}


def source(name):
    path = CACHE / (name + (".json" if name == "nepal" else ".zip"))
    if not path.exists():
        url = NEPAL_URL if name == "nepal" else f"https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_{name}.zip"
        urlretrieve(url, path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != HASHES[name]:
        raise ValueError(f"Source changed: {path}")
    return path


def features():
    for layer, name in [("regions", "admin_1_states_provinces"), ("cities", "populated_places"),
                        ("borders", "admin_1_states_provinces_lines"), ("borders", "admin_0_boundary_lines_land")]:
        with shapefile.Reader(str(source(name))) as reader:
            for row in reader.iterShapeRecords():
                if row.shape.shapeType == shapefile.NULL:
                    continue
                d = {k.lower(): v for k, v in row.record.as_dict().items()}
                if layer != "cities" and "NPL" in (d.get("adm0_a3"), d.get("adm0_a3_l"), d.get("adm0_a3_r")):
                    continue
                props = {}
                if layer != "borders":
                    props = {"en": d["name_en"] or d["name"], "ko": d["name_ko"] or ""}
                    if layer == "cities":
                        props["rank"] = d["scalerank"]
                    else:
                        props["id"] = d["adm1_code"]
                        if d["iso_3166_2"] in KOREAN_STATES:
                            props["en"], props["ko"] = KOREAN_STATES[d["iso_3166_2"]]
                yield layer, shape(row.shape.__geo_interface__), props

    provinces = json.loads(source("nepal").read_text(encoding="utf-8"))["features"]
    for province in provinces:
        en, ko = PROVINCES[province["properties"]["shapeName"]]
        polygon = shape(province["geometry"])
        yield "regions", polygon, {"id": f"NP-{en}", "en": en, "ko": ko}
        yield "borders", polygon.boundary, {}

    # Wikidata P625, Q389190, Q3901248 and Q376123 respectively (CC0).
    for en, ko, lon, lat in [("Lukla", "루클라", 86.73139, 27.68778),
                             ("Phakding", "팍딩", 86.71278, 27.74028),
                             ("Namche Bazaar", "남체 바자르", 86.71000, 27.80444)]:
        yield "cities", Point(lon, lat), {"en": en, "ko": ko, "rank": 9}


def mercator(coords):
    lon, lat = coords.T
    phi = np.radians(np.clip(lat, -85.05112878, 85.05112878))
    return np.column_stack(((lon + 180) / 360 * COUNT, (1 - np.arcsinh(np.tan(phi)) / np.pi) * COUNT / 2))


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for item in geometry.geoms:
            yield from parts(item, kind)


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    tiles = defaultdict(lambda: defaultdict(list))
    for layer, geometry, props in features():
        kind = {"cities": "Point", "regions": "Polygon", "borders": "LineString"}[layer]
        for part in parts(geometry, kind):
            geom = shapely.transform(part, mercator).simplify(0.0008)
            if not geom.is_valid:
                geom = shapely.make_valid(geom)
            left, top, right, bottom = map(math.floor, geom.bounds)
            for x in range(max(0, left), min(COUNT - 1, right) + 1):
                for y in range(max(0, top), min(COUNT - 1, bottom) + 1):
                    clipped = geom.intersection(box(x, y, x + 1, y + 1))
                    for fragment in parts(clipped, kind):
                        tiles[x, y][layer].append({"geometry": fragment, "properties": props})

    path = ROOT / "public/data/regional-chart/atlas.pmtiles"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("wb") as out:
        writer = Writer(out)
        for x, y in sorted(tiles, key=lambda xy: zxy_to_tileid(ZOOM, *xy)):
            layers = [{"name": name, "features": rows} for name, rows in tiles[x, y].items()]
            data = mvt.encode(layers, default_options={"quantize_bounds": (x, y, x + 1, y + 1),
                                                       "y_coord_down": True})
            writer.write_tile(zxy_to_tileid(ZOOM, x, y), gzip.compress(data, mtime=0))
        writer.finalize({"tile_type": TileType.MVT, "tile_compression": Compression.GZIP},
                        {"name": "Flight3d regional chart", "attribution": "Natural Earth; Survey Department of Nepal via geoBoundaries; Wikidata"})
    temporary.replace(path)
    print(f"{len(tiles)} tiles, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    build()
