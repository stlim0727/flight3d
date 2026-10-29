import { solveTrim } from '../../physics/TrimSolver.js';
import { TRIM_WHEEL_AUTHORITY } from '../../physics/trimWheel.js';
import * as THREE from 'three';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { t } from '../../i18n/index.js';
import { flyBank } from '../PilotControlLaws.js';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';

const clamp=THREE.MathUtils.clamp;
const STAGES={COAST:80,STATION:81,BEACH:82,RETURN:83,COMPLETED:84};
export const SIHWA_TOUR_PROFILES=Object.freeze({
  C172:{ias:90,altitude:300,radius:950,maxBank:25},
  B738:{ias:205,altitude:550,radius:2500,maxBank:32},
  F16:{ias:260,altitude:650,radius:3400,maxBank:35,speedBrake:.8},
});

/** An offshore racetrack tangent to the source-positioned landmark corridor. */
export function sihwaTourRoute(features,aircraftId) {
  const profile=SIHWA_TOUR_PROFILES[aircraftId];
  if(!profile)throw new Error('Unsupported Sihwa tour aircraft');
  const center=kind=>features.find(f=>f.kind===kind).center;
  const plant=center('plant'),beach=center('beach'),tower=features.find(f=>f.id==='way/1038767380').center;
  const length=Math.hypot(beach[0]-plant[0],beach[1]-plant[1]);
  const d=[(beach[0]-plant[0])/length,(beach[1]-plant[1])/length],n=[-d[1],d[0]];
  const start=[plant[0]-d[0]*6500+n[0]*650,plant[1]-d[1]*6500+n[1]*650];
  const leg=6500+length+1400,r=profile.radius,total=2*leg+2*Math.PI*r;
  const point=s=>{
    s=clamp(s,0,total+1200);
    if(s>total)return {x:start[0]+d[0]*(s-total),z:start[1]+d[1]*(s-total)};
    let along,cross;
    if(s<=leg){along=s;cross=0;}
    else if(s<=leg+Math.PI*r){const a=(s-leg)/r;along=leg+r*Math.sin(a);cross=r*(1-Math.cos(a));}
    else if(s<=2*leg+Math.PI*r){along=2*leg+Math.PI*r-s;cross=2*r;}
    else {const a=(s-2*leg-Math.PI*r)/r;along=-r*Math.sin(a);cross=r*(1+Math.cos(a));}
    return {x:start[0]+d[0]*along+n[0]*cross,z:start[1]+d[1]*along+n[1]*cross};
  };
  return {profile,start,d,leg,total,finish:total+1200,point,landmarks:[
    {id:'seawall',point:[plant[0]-d[0]*3500,plant[1]-d[1]*3500]},
    {id:'plant',point:plant},{id:'tower',point:tower},{id:'beach',point:beach},
  ]};
}

/** Only the initial preset writes pose; the whole tour then uses pilot inputs. */
export class SihwaTourScenario extends CessnaDemoScenario {
  static STAGES=STAGES;

  enterStage(stage) {
    const sim=this.sim;
    if(stage===STAGES.COAST) {
      const features=sim.currentTerrain?.region?.features?.features;
      if(!features){this.result={status:'failed',reason:'Sihwa scenery unavailable'};this.director.stop();return;}
      this.route=sihwaTourRoute(features,sim.currentAircraftId);
      const {profile,start,d}=this.route;
      sim.setPreset('cruise',true);
      sim.position.set(start[0],profile.altitude,start[1]);
      const speed=profile.ias*.514444/Math.sqrt(Atmosphere.getConditions(profile.altitude).densityRatio);
      sim.linearVelocity.set(d[0]*speed,0,d[1]*speed);
      sim.angularVelocity.set(0,0,0);
      sim.quaternion.setFromEuler(new THREE.Euler(0,-Math.atan2(d[0],-d[1]),0,'YXZ'));
      sim.aero.setFlapPosition(0);sim.aero.currentFlapAngle=0;sim.aero.spoilers=profile.speedBrake??0;
      sim.gear.setGearTarget(sim.gear.isFixed);sim.gear.gearState=sim.gear.isFixed?1:0;
      sim.applyComputedTrim();sim.engines.settleSpool();
      sim.aircraft.group.position.copy(sim.position);sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position,sim.quaternion);
      this.progress=0;this.cutIndex=-1;this.initializing=true;this.trimTimer=0;this.speedIntegral=0;
      this.result={status:'running',aircraft:sim.currentAircraftId,landmarks:[],minClearanceM:Infinity,maxBankDeg:0,maxCrossTrackM:0};
    }
    if(stage===STAGES.COMPLETED) {
      this.result.status='completed';this.result.elapsedSeconds=this.director.totalTimer;
      this.result.handoffBankDeg=sim.telemetry.rollDeg;this.result.handoffVerticalSpeed=sim.linearVelocity.y;
      this.director.stop(()=>t('demo.sihwa.complete'),false,{preserveThrottle:true});return;
    }
    const name=({80:'coast',81:'station',82:'beach',83:'return'})[stage];
    this.director.updateBanner(()=>t(`demo.sihwa.stage.${name}`),()=>t(`demo.sihwa.desc.${name}`));
    if(!this.director.userCameraOverridden)sim.cameraSystem?.setMode(CameraSystem.MODES.CHASE);
    this.cutIndex=-1;
  }

  flyFighter(targetVz,dt) {
    const sim=this.sim,aero=sim.aero,tel=sim.telemetry,profile=this.route.profile;
    const speed=Math.max(40,sim.linearVelocity.length()),bank=tel.rollDeg*Math.PI/180;
    this.trimTimer-=dt;
    if(this.trimTimer<=0){
      this.trim=solveTrim(aero,sim.engines,{iasKnots:profile.ias,altitudeMeters:sim.position.y,
        massKg:aero.mass/Math.max(.6,Math.cos(bank)),flightPathAngleDeg:Math.atan2(targetVz,speed)*180/Math.PI,
        flapsIndex:0,gearState:0,spoilers:aero.spoilers});
      this.trimTimer=.5;
    }
    const trim=this.trim;
    if(!trim.feasible){this.result.status='failed';this.result.reason='Fighter trim unavailable';this.director.stop(null,false,{preserveThrottle:true});return;}
    const stiffness=Math.max(.4,1-Math.max(0,tel.iasKnots-140)/220*.55);
    const pitchTarget=(trim.alphaDeg*Math.PI/180)+Math.atan2(targetVz,speed);
    const turnRate=9.80665*Math.sin(bank)**2/(speed*Math.max(.6,Math.cos(bank)));
    const rate=clamp((pitchTarget-tel.pitchDeg*Math.PI/180)*1.2,-.12,.12)+turnRate;
    const acceleration=(rate-sim.angularVelocity.x)*3;
    const qSc=Math.max(1,aero.qDyn*aero.wingArea*aero.meanChord),qHat=sim.angularVelocity.x*aero.meanChord/(2*speed);
    const thrust=sim.engines.thrust.reduce((a,b)=>a+b,0);
    const increment=(aero.Iyy*acceleration/qSc-aero.Cma*(aero.alpha-trim.alphaDeg*Math.PI/180)
      -aero.Cmq*qHat-(thrust-trim.thrustN)*aero.thrustPitchArmM/qSc)/(-aero.Cm_de);
    const effective=(trim.handsOffTrimDegRaw-aero.pitchTrim)*Math.PI/180*TRIM_WHEEL_AUTHORITY+increment;
    sim.controls.setVirtualInput('elevator',clamp(effective/(Math.PI/9*stiffness),-1,1));
    sim.controls.setVirtualInput('aileron',clamp(sim.controls.virtualAileron/stiffness,-1,1));
    const error=profile.ias-tel.iasKnots;this.speedIntegral=clamp(this.speedIntegral+error*dt*.002,-.08,.08);
    sim.controls.setVirtualInput('throttle',clamp(trim.throttle+error*.02+this.speedIntegral,0,1));
  }

  update(dt) {
    const sim=this.sim,tel=sim.telemetry,{profile,point,total,finish,leg,landmarks}=this.route;
    if(this.initializing){this.initializing=false;return;}
    let best=this.progress,bestDistance=Infinity;
    const distance=s=>{const p=point(s);return Math.hypot(p.x-sim.position.x,p.z-sim.position.z);};
    for(let s=Math.max(0,this.progress-60);s<=Math.min(finish,this.progress+180);s+=20){const d=distance(s);if(d<bestDistance){best=s;bestDistance=d;}}
    const coarse=best;
    for(let s=Math.max(0,coarse-20);s<=Math.min(finish,coarse+20);s+=2){const d=distance(s);if(d<bestDistance){best=s;bestDistance=d;}}
    this.progress=Math.max(this.progress,best);
    const speed=Math.hypot(sim.linearVelocity.x,sim.linearVelocity.z),look=Math.max(180,speed*5);
    const target=point(Math.min(finish,this.progress+look));
    const desired=Math.atan2(target.x-sim.position.x,-(target.z-sim.position.z));
    const track=Math.atan2(sim.linearVelocity.x,-sim.linearVelocity.z);
    const bank=Math.atan2(2*speed*speed*Math.sin(desired-track)/look,9.80665)*180/Math.PI;
    flyBank(sim,clamp(bank,-profile.maxBank,profile.maxBank),tel);
    let ground=0;
    for(const seconds of [0,3,6,10])ground=Math.max(ground,sim.currentTerrain.getHeight(sim.position.x+sim.linearVelocity.x*seconds,sim.position.z+sim.linearVelocity.z*seconds));
    const targetVz=clamp((Math.max(profile.altitude,ground+180)-sim.position.y)*.18,-4,5);
    if(sim.currentAircraftId==='F16')this.flyFighter(targetVz,dt);else this.flyVertical(targetVz,profile.ias);
    if(!this.director.isActive)return;
    sim.controls.setVirtualInput('rudder',clamp(-sim.aero.beta*2,-.2,.2));
    sim.controls.setVirtualInput('brakes',0);
    this.result.minClearanceM=Math.min(this.result.minClearanceM,sim.position.y-sim.currentTerrain.getHeight(sim.position.x,sim.position.z));
    this.result.maxBankDeg=Math.max(this.result.maxBankDeg,Math.abs(tel.rollDeg));
    this.result.maxCrossTrackM=Math.max(this.result.maxCrossTrackM,bestDistance);
    for(const landmark of landmarks)if(!this.result.landmarks.includes(landmark.id)
      && Math.hypot(sim.position.x-landmark.point[0],sim.position.z-landmark.point[1])<1500)this.result.landmarks.push(landmark.id);
    const stage=this.progress>leg+300?STAGES.RETURN:this.result.landmarks.includes('beach')?STAGES.BEACH
      :this.result.landmarks.includes('plant')?STAGES.STATION:STAGES.COAST;
    if(this.director.currentStage!==stage)this.director.setStage(stage,{preserveCamera:true});
    const cut=Math.floor(this.director.stageTimer/18)%2;
    if(!this.director.userCameraOverridden && cut!==this.cutIndex){sim.cameraSystem?.setMode(cut?CameraSystem.MODES.FLYBY:CameraSystem.MODES.CHASE);this.cutIndex=cut;}
    if(this.progress>finish-100 && distance(finish)<180 && Math.abs(tel.rollDeg)<8 && Math.abs(sim.linearVelocity.y)<2.5 && this.result.landmarks.length===4){this.director.setStage(STAGES.COMPLETED);return;}
    if(this.director.totalTimer>1200 || bestDistance>1800 || this.result.minClearanceM<100) {
      this.result.status='failed';this.result.reason='Sihwa tour guidance envelope exceeded';
      this.director.stop(()=>t('demo.sihwa.failed'),false,{preserveThrottle:true});
    }
  }
}
