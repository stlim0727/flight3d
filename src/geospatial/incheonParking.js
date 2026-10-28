import { pointInRing, segmentDistance } from './incheonDressing.js';
import { DEPARTURE_GATE, DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, departurePushbackPose } from '../config/incheonDeparture.js';

// A conservative circle enclosing a 37.9 x 35.8 m 737-800 footprint.
export const PARKED_RADIUS = 27;
export const PARKED_SPACING = 58;
export const PARKED_AIRLINES = ['korean', 'jeju', 'jin', 'flydubai'];
const bounds=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
const near=(b,x,z,margin)=>x>=b[0]-margin&&x<=b[2]+margin&&z>=b[1]-margin&&z<=b[3]+margin;
const distance=(points,x,z)=>Math.min(...points.slice(1).map((p,i)=>segmentDistance(x,z,points[i],p)));

/** Source apron containment and taxi/runway/terminal separation, without new pavement. */
export function parkingSiteIsSafe(x,z,field,patch) {
  const aprons=field.surfaces.filter(s=>s.kind==='apron'&&s.area);
  if(!aprons.some(s=>pointInRing(x,z,s.points)&&distance(s.points,x,z)>=PARKED_RADIUS
    && !(s.holes??[]).some(hole=>pointInRing(x,z,hole)||distance(hole,x,z)<PARKED_RADIUS)))return false;
  for(const surface of field.surfaces) {
    if(surface.kind==='apron')continue;
    const margin=PARKED_RADIUS+(surface.kind==='runway'?surface.width/2+60:Math.max(18,surface.width/2)+6);
    if(near(surface.bounds??bounds(surface.points),x,z,margin)&&distance(surface.points,x,z)<margin)return false;
  }
  for(const feature of patch.features)if(feature.kind==='building')for(const polygon of feature.parts) {
    if(near(bounds(polygon),x,z,PARKED_RADIUS+5)&&(pointInRing(x,z,polygon)||distance(polygon,x,z)<PARKED_RADIUS+5))return false;
  }
  const protectedPath=[DEPARTURE_GATE,...Array.from({length:21},(_,i)=>departurePushbackPose(i/20)),...DEPARTURE_TAXI_ROUTE,...DEPARTURE_LINEUP_ROUTE];
  if(protectedPath.some(p=>Math.hypot(x-p.x,z-p.z)<62))return false;
  for(const route of [DEPARTURE_TAXI_ROUTE,DEPARTURE_LINEUP_ROUTE])for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i];
    if(segmentDistance(x,z,[a.x,a.z],[b.x,b.z])<62)return false;
  }
  return true;
}

/** Authored occupancy on mapped aprons, not live traffic or published stand positions. */
export function planParkedAirliners(field,patch,limit=48) {
  const prepared={...field,surfaces:field.surfaces.map(s=>({...s,bounds:bounds(s.points)}))};
  const terminal=patch.features.find(f=>f.id==='relation/3917466');
  const candidates=[];
  if(terminal)for(const polygon of terminal.parts)for(let i=1;i<polygon.length;i++) {
    const a=polygon[i-1],b=polygon[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<1)continue;
    const count=Math.max(1,Math.floor(length/58));
    for(let j=0;j<count;j++)for(const side of [-1,1]) {
      const t=(j+.5)/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      const nx=-(b[1]-a[1])/length*side,nz=(b[0]-a[0])/length*side;
      candidates.push({x:x+nx*43,z:z+nz*43,yaw:Math.atan2(nx,nz),area:'terminal'});
    }
  }
  // Remote stands fill apron interiors, with fronts facing the terminal side.
  for(const apron of prepared.surfaces.filter(s=>s.kind==='apron'&&s.area)) {
    const b=apron.bounds;
    for(let x=Math.ceil(b[0]/60)*60;x<b[2];x+=60)for(let z=Math.ceil(b[1]/64)*64;z<b[3];z+=64) {
      const yaw=z< -700?Math.PI-.24:.24;
      candidates.push({x,z,yaw,area:'remote'});
    }
  }
  candidates.sort((a,b)=>(a.area==='terminal'?0:1)-(b.area==='terminal'?0:1)||Math.hypot(a.x-DEPARTURE_GATE.x,a.z-DEPARTURE_GATE.z)-Math.hypot(b.x-DEPARTURE_GATE.x,b.z-DEPARTURE_GATE.z));
  const stands=[];
  for(const candidate of candidates) {
    if(stands.length>=limit)break;
    if(stands.some(s=>Math.hypot(s.x-candidate.x,s.z-candidate.z)<PARKED_SPACING))continue;
    if(!parkingSiteIsSafe(candidate.x,candidate.z,prepared,patch))continue;
    stands.push({...candidate,id:`P${String(stands.length+1).padStart(2,'0')}`,airline:PARKED_AIRLINES[stands.length%PARKED_AIRLINES.length]});
  }
  return stands;
}
