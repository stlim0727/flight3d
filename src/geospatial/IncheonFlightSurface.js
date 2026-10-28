import * as THREE from 'three';
import airfield from '../config/incheonAirfield.json' with { type: 'json' };
import { pointInRing, segmentDistance } from './incheonDressing.js';

export { airfield as INCHEON_AIRFIELD };

/** Airport elevation is a modeled constant, not a surveyed pavement profile. */
export class IncheonFlightSurface {
  constructor(source, region=null) {
    this.source = source;
    this.region = region;
    this.isLand = (x,z)=>region ? region.isCoreLand(x,z) : source.isLand(x,z);
    this.isLoaded = true;
    this.surfaces = airfield.surfaces.map(s => ({ ...s, bounds: [
      Math.min(...s.points.map(p=>p[0])), Math.min(...s.points.map(p=>p[1])),
      Math.max(...s.points.map(p=>p[0])), Math.max(...s.points.map(p=>p[1])),
    ] }));
    // One 25m triangle grid drives both rendered terrain and contact queries.
    this.gridSize = 481;
    this.elevations = new Float32Array(this.gridSize ** 2);
    this.landNodes = new Uint8Array(this.gridSize ** 2);
    this.coastCells = new Uint8Array(480 ** 2);
    const land = (region?.coreCoastline ?? source.coastline).land;
    const polygons = land.type === 'Polygon' ? [land.coordinates] : land.coordinates;
    // Conservatively mark every cell in each coast segment's bounds. Interior
    // cells then have constant land/water membership; tiny islands/holes still
    // trigger the exact polygon query in every touched cell.
    for (const rings of polygons) for (const ring of rings) for (let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length];
      const minX=Math.max(0,Math.floor((Math.min(a[0],b[0])+6000)/25)-1);
      const maxX=Math.min(479,Math.floor((Math.max(a[0],b[0])+6000)/25));
      const minZ=Math.max(0,Math.floor((Math.min(a[1],b[1])+6000)/25)-1);
      const maxZ=Math.min(479,Math.floor((Math.max(a[1],b[1])+6000)/25));
      for(let row=minZ;row<=maxZ;row++)for(let col=minX;col<=maxX;col++)this.coastCells[row*480+col]=1;
    }
    for (let row=0;row<this.gridSize;row++) for (let col=0;col<this.gridSize;col++) {
      const x=col*25-6000,z=row*25-6000,land=this.isLand(x,z);
      this.landNodes[row*this.gridSize+col]=Number(land);
      this.elevations[row*this.gridSize+col] = this.gradedHeight(x,z,land);
    }
  }

  distance(surface, x, z) {
    if (surface.area && pointInRing(x,z,surface.points)) {
      const hole = surface.holes?.find(ring=>pointInRing(x,z,ring));
      if (!hole) return 0;
      return Math.min(...hole.slice(1).map((point,i)=>segmentDistance(x,z,hole[i],point)));
    }
    let distance = Infinity;
    for (let i=1;i<surface.points.length;i++) distance=Math.min(distance,segmentDistance(x,z,surface.points[i-1],surface.points[i]));
    return Math.max(0,distance-(surface.area?0:surface.width/2));
  }

  nearby(surface,x,z,margin) {
    const b=surface.bounds, m=margin+(surface.area?0:surface.width/2);
    return x>=b[0]-m && x<=b[2]+m && z>=b[1]-m && z<=b[3]+m;
  }

  isOnRunway(x,z) {
    return this.surfaces.some(s=>this.nearby(s,x,z,0) && this.distance(s,x,z)<.001);
  }

  isRunwaySafetyArea(x,z) {
    return this.surfaces.some(s=>s.kind==='runway' && this.nearby(s,x,z,60) && this.distance(s,x,z)<=60);
  }

  gradedHeight(x,z,land=this.isLand(x,z)) {
    // The optional source-backed regional extension owns ground outside the core.
    if (Math.max(Math.abs(x),Math.abs(z))>6000) return this.region?.getHeight(x,z) ?? 0;
    if (!land) return 0;
    let weight=0;
    for (const s of this.surfaces) {
      if (!this.nearby(s,x,z,120)) continue;
      const d=this.distance(s,x,z);
      const u=Math.max(0,Math.min(1,(d-40)/80));
      weight=Math.max(weight,1-u*u*(3-2*u));
      if (weight===1) return airfield.elevationM;
    }
    return this.source.getHeight(x,z)*(1-weight)+airfield.elevationM*weight;
  }

  getHeight(x,z) {
    if (![x,z].every(Number.isFinite)) throw new Error('Invalid flight terrain coordinate');
    if (Math.max(Math.abs(x),Math.abs(z))>6000) return this.region?.getHeight(x,z) ?? 0;
    const col=(x+6000)/25,row=(z+6000)/25;
    const ix=Math.min(Math.floor(col),480-1),iz=Math.min(Math.floor(row),480-1);
    const u=col-ix,v=row-iz,i=iz*this.gridSize+ix,g=this.elevations;
    const isLand=this.coastCells[iz*480+ix] ? this.isLand(x,z) : this.landNodes[i];
    if (!isLand) return 0;
    // PlaneGeometry's NW/SW/NE and SW/SE/NE triangles, not bilinear sampling.
    return u+v<=1 ? g[i]*(1-u-v)+g[i+1]*u+g[i+this.gridSize]*v
      : g[i+this.gridSize+1]*(u+v-1)+g[i+1]*(1-v)+g[i+this.gridSize]*(1-u);
  }

  getNormal(x,z) {
    const d=.5;
    return new THREE.Vector3(this.getHeight(x-d,z)-this.getHeight(x+d,z),2*d,
      this.getHeight(x,z-d)-this.getHeight(x,z+d)).normalize();
  }
}

export function incheonSpawn(type, groundClearance, aircraftId='B738') {
  const a=airfield.approach, angle=a.headingDeg*Math.PI/180;
  const direction={x:Math.sin(angle),z:-Math.cos(angle)};
  const distance=type==='approach'?-1500:type==='cruise'?500:100;
  const speed=type==='runway'?0:aircraftId==='C172'?(type==='approach'?33:48):(type==='approach'?74.5:108);
  const y=type==='runway'?airfield.elevationM+groundClearance:type==='approach'
    ?airfield.elevationM+groundClearance+1500*Math.tan(3*Math.PI/180):750;
  return { x:a.threshold.x+direction.x*distance, z:a.threshold.z+direction.z*distance,
    y, yaw:-angle, vx:direction.x*speed, vz:direction.z*speed,
    vy:type==='approach'?-speed*Math.tan(3*Math.PI/180):0 };
}
