const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const key=p=>`${p[0]},${p[1]}`;

/** Follow mapped, non-bridge road segments away from an abutment. */
function approachPath(roads,start,inside,length=60) {
  const graph=new Map();
  for(const r of roads.filter(r=>!r.bridge))for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i];
    for(const [p,q] of [[a,b],[b,a]]){if(!graph.has(key(p)))graph.set(key(p),[]);graph.get(key(p)).push(q);}
  }
  const path=[start],visited=new Set([key(start)]);let previous=inside,remaining=length;
  while(remaining>1e-6) {
    const current=path.at(-1),incoming=[current[0]-previous[0],current[1]-previous[1]];
    const candidates=(graph.get(key(current))??[]).filter(p=>!visited.has(key(p)) && distance(current,p)>0);
    candidates.sort((a,b)=>{
      const score=p=>((p[0]-current[0])*incoming[0]+(p[1]-current[1])*incoming[1])/distance(current,p);
      return score(b)-score(a);
    });
    const next=candidates[0];
    if(!next)throw new Error('Missing mapped bridge approach');
    const d=distance(current,next);
    if(d>=remaining){path.push(current.map((v,i)=>v+(next[i]-v)*remaining/d));remaining=0;}
    else {path.push(next);remaining-=d;visited.add(key(next));previous=current;}
  }
  // 2m longitudinal samples, with all source bends preserved.
  const sampled=[path[0]];
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],n=Math.ceil(distance(a,b)/2);
    for(let j=1;j<=n;j++)sampled.push(a.map((v,k)=>v+(b[k]-v)*j/n));
  }
  return sampled;
}

/** Shared visible/contact triangles: decks and 60m source-aligned bank ramps. */
export function buildSihwaBridges(region) {
  const positions=[],approaches=[];
  for(const road of region.features.roads.filter(r=>r.bridge)) {
    const points=road.points;
    const start=approachPath(region.features.roads,points[0],points[1]);
    const end=approachPath(region.features.roads,points.at(-1),points.at(-2));
    const heights=[points[0],points.at(-1)].map(p=>Math.max(4.5,region.groundHeight(...p)+.15));
    const lengths=points.slice(1).map((p,i)=>distance(points[i],p)),total=lengths.reduce((a,b)=>a+b,0);
    let along=0;
    const deck=points.map((p,i)=>{if(i)along+=lengths[i-1];return {p,deckY:heights[0]+(heights[1]-heights[0])*along/total,weight:1};});
    const ramp=(path,y)=>{let d=0;return path.map((p,i)=>{if(i)d+=distance(path[i-1],p);const u=Math.min(1,d/60);return {p,deckY:y,weight:1-u*u*(3-2*u)};});};
    const stations=[...ramp(start,heights[0]).slice(1).reverse(),...deck,...ramp(end,heights[1]).slice(1)];
    const rows=stations.map((s,i)=>{
      const prev=stations[Math.max(0,i-1)].p,next=stations[Math.min(stations.length-1,i+1)].p;
      const dx=next[0]-prev[0],dz=next[1]-prev[1],d=Math.hypot(dx,dz);
      return Array.from({length:11},(_,j)=>{
        const offset=(j/10-.5)*road.widthM,x=s.p[0]-dz/d*offset,z=s.p[1]+dx/d*offset;
        const ground=region.groundHeight(x,z);
        return [x,Math.max(ground,ground+(s.deckY-ground)*s.weight),z];
      });
    });
    for(let i=1;i<rows.length;i++)for(let j=1;j<rows[i].length;j++) {
      const a=rows[i-1][j],b=rows[i][j],c=rows[i-1][j-1],d=rows[i][j-1];
      positions.push(...a,...b,...c,...c,...b,...d);
    }
    approaches.push({id:road.id,start:start[0],end:end[0],banks:[start.at(-1),end.at(-1)],paths:[start,end],heights});
  }
  return {positions:new Float32Array(positions),approaches};
}
