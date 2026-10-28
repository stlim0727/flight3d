"""Offline regional extension. Frozen OSM topology + Copernicus DSM; no runtime GIS.

Inputs in public/scenery/incheon/sihwa/sources; DEM path via --dem.
Uses 100m inland cells, exact mapped coast vertices, 25m core seam vertices.
Architectural dimensions absent from OSM are explicitly modeled, not surveyed.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import json
import shutil
import numpy as np
from shapely import constrained_delaunay_triangles, contains_xy, prepare
from shapely.geometry import Polygon, LineString, box, mapping, shape
from shapely.ops import polygonize_full, unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/scenery/incheon/sihwa'
spec = importlib.util.spec_from_file_location('terrain', Path(__file__).with_name('build-incheon.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)

def dump(name, value):
    (OUT/name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n')

def polygons(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [p for part in g.geoms for p in polygons(part)] if hasattr(g, 'geoms') else []

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dem', required=True)
    parser.add_argument('--import-cache', type=Path)
    args = parser.parse_args()
    sources = OUT/'sources'
    sources.mkdir(parents=True, exist_ok=True)
    if args.import_cache:
        for prefix in ['', 'plant-', 'roads-']:
            for suffix in ['source.osm.json.gz', 'source-metadata.json']:
                shutil.copyfile(args.import_cache/(prefix+suffix), sources/(prefix+suffix))
    elements = {}
    provenance = []
    for prefix in ['', 'plant-', 'roads-']:
        filename = prefix+'source.osm.json.gz'
        raw = gzip.decompress((sources/filename).read_bytes())
        meta = json.loads((sources/(prefix+'source-metadata.json')).read_text())
        if hashlib.sha256(raw).hexdigest() != meta['sha256']: raise ValueError('OSM checksum mismatch')
        provenance.append(dict(file='sources/'+filename, **meta))
        for e in json.loads(raw)['elements']:
            key = (e['type'], e['id'])
            old = elements.get(key)
            if old and old.get('version') == e.get('version'):
                # Some API responses omit metadata; coordinates/refs must agree.
                for field in ['lon','lat','nodes','members']:
                    if field in old and field in e and old[field] != e[field]: raise ValueError(f'Conflicting OSM {key}')
            if not old or old.get('version',0) <= e.get('version',0): elements[key] = e
    nodes = {i:e for (kind,i),e in elements.items() if kind=='node'}
    ways = {i:e for (kind,i),e in elements.items() if kind=='way'}
    def coords(way):
        if any(n not in nodes for n in way['nodes']): raise ValueError(f"Missing refs {way['id']}")
        return [t.local(nodes[n]['lon'],nodes[n]['lat']) for n in way['nodes']]
    def polygon(i):
        way = ways[i]
        if way['nodes'][0] != way['nodes'][-1]: raise ValueError(f'Open polygon {i}')
        p = Polygon(coords(way))
        if not p.is_valid: raise ValueError(f'Invalid polygon {i}')
        return p
    region = box(-25000,-25000,25000,25000)
    lines, segments, coast_ids = [], [], []
    for way in ways.values():
        if way.get('tags',{}).get('natural') != 'coastline': continue
        clipped = LineString(coords(way)).intersection(region)
        if clipped.is_empty: continue
        coast_ids.append(way['id'])
        for line in clipped.geoms if clipped.geom_type=='MultiLineString' else [clipped]:
            if line.geom_type != 'LineString': continue
            lines.append(line)
            segments.extend(zip(line.coords,list(line.coords)[1:]))
    faces,cuts,dangles,invalid = polygonize_full(unary_union([region.boundary,*lines]))
    if cuts.length>.01 or dangles.length>.01 or not invalid.is_empty: raise ValueError(f'Incomplete coast {cuts.length} {dangles.length}')
    starts=np.array([a for a,b in segments]); delta=np.array([b for a,b in segments])-starts
    lengths=(delta*delta).sum(axis=1)
    selected=[]
    for face in faces.geoms:
        point=np.array(face.representative_point().coords[0])
        u=np.clip(((point-starts)*delta).sum(axis=1)/lengths,0,1)
        i=np.argmin(((starts+u[:,None]*delta-point)**2).sum(axis=1))
        offset=point-starts[i]
        if delta[i,0]*offset[1]-delta[i,1]*offset[0]<0: selected.append(face)
    land=unary_union(selected)
    # Assemble relation rings by connected endpoint IDs; never invent closure.
    lake_rel=elements[('relation',4860085)]
    lake_rings={}
    for role in ['outer','inner']:
        pending=[ways[m['ref']]['nodes'][:] for m in lake_rel['members'] if m['type']=='way' and m.get('role')==role]
        rings=[]
        while pending:
            ring=pending.pop()
            while ring[0]!=ring[-1]:
                match=next((i for i,w in enumerate(pending) if ring[-1] in [w[0],w[-1]]),None)
                if match is None: raise ValueError('Open lake relation')
                part=pending.pop(match)
                if part[0]!=ring[-1]: part.reverse()
                ring.extend(part[1:])
            rings.append(Polygon([t.local(nodes[n]['lon'],nodes[n]['lat']) for n in ring]))
        lake_rings[role]=unary_union(rings)
    lake=lake_rings['outer'].difference(lake_rings['inner'])
    land=land.difference(lake)
    if not land.is_valid or land.is_empty: raise ValueError('Invalid regional land')
    print('coast',len(coast_ids),'faces',len(faces.geoms),'land km2',land.area/1e6,flush=True)
    # Keep the old core polygons exactly; only remove their artificial clipping edge.
    old_core=shape(json.loads((OUT.parent/'coastline.json').read_text())['land'])
    inner=box(-5999,-5999,5999,5999)
    difference=old_core.symmetric_difference(land).intersection(inner).area
    print('core source difference m2',difference,flush=True)
    if difference>1: raise ValueError('Regional source changes existing core coastline')
    core=old_core.union(land.difference(box(-5999.99,-5999.99,5999.99,5999.99))).intersection(box(-6001,-6001,6001,6001))
    dump('core-coastline.json',dict(land=mapping(core)))
    sample=t.sampler(args.dem)
    if hashlib.sha256(Path(args.dem).read_bytes()).hexdigest()!=t.SHA: raise ValueError('DEM checksum')
    plant=polygon(409163571); park=polygon(1038767377)
    plaza=polygon(1038767385); beach=polygon(196292129)
    building_ids=[1038767376,1038767378,1038767379,1038767380,1038767381]
    buildings=unary_union([polygon(i) for i in building_ids])
    pads=[]
    for name,p in [('plant',plant),('plaza',plaza),('park',park)]:
        minx,minz,maxx,maxz=p.buffer(60).bounds
        xx,zz=np.meshgrid(np.arange(minx,maxx,10),np.arange(minz,maxz,10))
        ring=p.buffer(60).difference(p.union(buildings.buffer(8))).intersection(land)
        valid=contains_xy(ring,xx,zz)
        if not valid.any(): raise ValueError('No ground samples for pad')
        base=max(2.,float(np.percentile(sample(xx[valid],zz[valid]),20)))
        pads.append((name,p,base))
    print('pads',[(name,round(base,2)) for name,p,base in pads],flush=True)
    # Full 100m cells, clipped to the source coast and lake; a land-only mesh.
    outer=land.difference(box(-6000,-6000,6000,6000))
    prepare(outer)
    vertices=[]; indices=[]; lookup={}
    def vertex(p):
        key=(round(p[0],5),round(p[1],5))
        if key not in lookup: lookup[key]=len(vertices);vertices.append(key)
        return lookup[key]
    def densify(ring):
        out=[]
        for a,b in zip(ring,list(ring)[1:]):
            out.append(a)
            # The original contact/render grid has 25m border nodes.
            axis=1 if abs(abs(a[0])-6000)<1e-7 and abs(a[0]-b[0])<1e-7 else 0 if abs(abs(a[1])-6000)<1e-7 and abs(a[1]-b[1])<1e-7 else None
            if axis is None: continue
            lo,hi=sorted([a[axis],b[axis]])
            values=list(np.arange(np.floor(lo/25)*25+25,hi-1e-7,25))
            if b[axis]<a[axis]: values.reverse()
            for v in values:
                p=list(a);p[axis]=float(v);out.append(tuple(p))
        out.append(ring[-1]);return out
    for z in range(-25000,25000,100):
        if z%5000==0: print('mesh row',z,flush=True)
        for x in range(-25000,25000,100):
            cell=box(x,z,x+100,z+100)
            if not outer.intersects(cell): continue
            for p in polygons(cell if outer.contains(cell) else outer.intersection(cell)):
                if p.area<.001: continue
                p=Polygon(densify(list(p.exterior.coords)),[densify(list(r.coords)) for r in p.interiors])
                for tri in constrained_delaunay_triangles(p).geoms:
                    points=list(tri.exterior.coords)[:3]
                    a,b,c=points
                    # +Y normals in X/Y/Z: reverse positive planar X/Z winding.
                    if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0: points.reverse()
                    indices.extend(vertex(p) for p in points)
    xy=np.array(vertices); yy=np.maximum(0,sample(xy[:,0],xy[:,1]))
    for name,p,base in pads:
        # Flatten roof-contaminated DSM only on the mapped facility footprint.
        from shapely import distance, points
        weight=1-t.smooth(distance(points(xy[:,0],xy[:,1]),p)/30)
        yy=yy*(1-weight)+base*weight
    # Match both triangles and contacts at the core's existing 25m border.
    grid=np.fromfile(OUT.parent/'regional-natural.bin',dtype='<f4').reshape(401,401)
    def core_node(x,z):
        if not core.contains(__import__('shapely').geometry.Point(x,z)): return 0.
        col=(x+6000)/30;row=(z+6000)/30
        ix=min(int(col),399);iz=min(int(row),399);u=col-ix;v=row-iz
        return float(grid[iz,ix]*(1-u)*(1-v)+grid[iz,ix+1]*u*(1-v)+grid[iz+1,ix]*(1-u)*v+grid[iz+1,ix+1]*u*v)
    for i,(x,z) in enumerate(vertices):
        if abs(abs(x)-6000)<1e-5 and abs(z)<=6000:
            a=np.floor((z+6000)/25)*25-6000;b=min(6000,a+25);u=(z-a)/25
            yy[i]=core_node(x,a)*(1-u)+core_node(x,b)*u
        elif abs(abs(z)-6000)<1e-5 and abs(x)<=6000:
            a=np.floor((x+6000)/25)*25-6000;b=min(6000,a+25);u=(x-a)/25
            yy[i]=core_node(a,z)*(1-u)+core_node(b,z)*u
    positions=np.column_stack([xy[:,0],yy,xy[:,1]]).astype('<f4')
    faces_array=np.array(indices,dtype='<u4')
    descriptors={}
    for name,array in [('positions',positions),('indices',faces_array)]:
        raw=array.tobytes();filename=name+'.bin';(OUT/filename).write_bytes(raw)
        descriptors[name]=dict(file=filename,count=int(array.size),sha256=hashlib.sha256(raw).hexdigest())
    features=[]
    for name,i in [('plant',409163571),('park',1038767377),('plaza',1038767385),('beach',196292129)]+[('building',i) for i in building_ids]:
        p=polygon(i);way=ways[i]
        features.append(dict(id=f'way/{i}',kind=name,tags=way.get('tags',{}),points=list(p.exterior.coords),center=list(p.centroid.coords)[0]))
    roads=[]
    for way in ways.values():
        tags=way.get('tags',{})
        if tags.get('name')!='대부황금로' or not tags.get('highway'): continue
        path=LineString(coords(way)).intersection(box(*landmark_bounds()))
        if path.is_empty: continue
        for line in path.geoms if path.geom_type=='MultiLineString' else [path]:
            if line.geom_type=='LineString': roads.append(dict(id=f"way/{way['id']}",points=list(line.coords),bridge=tags.get('bridge')=='yes',widthM=8.5))
    # Clip sand and road overlays against the actual terrain triangles. Their
    # vertices use the parent plane, preventing drape gaps and coplanar flicker.
    from shapely import STRtree
    triangles=[Polygon(xy[faces_array[i:i+3]]) for i in range(0,len(faces_array),3)]
    tree=STRtree(triangles)
    overlays={}
    for name,footprint,offset in [('sand',beach,.025),('roads',unary_union([LineString(r['points']).buffer(r['widthM']/2,cap_style=2,join_style=2) for r in roads]),.06)]:
        output=[]
        for j in tree.query(footprint,predicate='intersects'):
            ids=faces_array[j*3:j*3+3];abc=positions[ids].astype(float)
            matrix=np.column_stack([abc[:,0],abc[:,2],np.ones(3)])
            if abs(np.linalg.det(matrix))<1e-5: continue
            plane=np.linalg.solve(matrix,abc[:,1])
            for part in polygons(triangles[j].intersection(footprint)):
                for tri in constrained_delaunay_triangles(part).geoms:
                    pp=list(tri.exterior.coords)[:3];a,b,c=pp
                    if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0: pp.reverse()
                    for x,z in pp: output.extend([x,float(plane[0]*x+plane[1]*z+plane[2]+offset),z])
        raw=np.array(output,dtype='<f4').tobytes();filename=name+'.bin';(OUT/filename).write_bytes(raw)
        overlays[name]=dict(file=filename,count=len(output),sha256=hashlib.sha256(raw).hexdigest())
    descriptors['overlays']=overlays
    dump('features.json',dict(features=features,roads=roads))
    dump('metadata.json',dict(schemaVersion=1,origin=dict(latitude=t.LAT,longitude=t.LON),bounds=[-25000,-25000,25000,25000],coreHalfSizeM=6000,cellSizeM=100,geometry=descriptors,triangleCount=len(indices)//3,coastWayIds=coast_ids,lakeRelationId=4860085,coreCoastDifferenceM2=difference,sources=provenance,dem=dict(url=t.URL,sha256=t.SHA,attribution=t.NOTICE),pads=[dict(name=n,baseM=b,method='surrounding DSM lower quintile; modeled flat pad with 30m feather') for n,p,b in pads],architecture=dict(towerHeightM=75,towerHeightReference='https://tong.visitkorea.or.kr/ktobiz/upload/accessible_tour_20.pdf',generatorUnits=10,capacityMW=254,plantReference='https://www.kwater.or.kr/news/busiCardList.do?brdId=KO74&pageNo=9&seq=132328',note='Procedural architecture, road widths and bridge deck elevations are illustrative; mapped footprints are OSM, not survey data. Sea and lake use Y=0; no tide simulation.')))
    print('done vertices',len(vertices),'triangles',len(indices)//3,flush=True)

def landmark_bounds():
    # Bounding extent of the seawall corridor, not a land polygon.
    a=t.local(126.56,37.36);b=t.local(126.71,37.275)
    return [a[0],a[1],b[0],b[1]]

if __name__=='__main__': main()
