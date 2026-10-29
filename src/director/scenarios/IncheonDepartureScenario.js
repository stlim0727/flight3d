import * as THREE from 'three';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';
import { INCHEON_AIRFIELD } from '../../geospatial/IncheonFlightSurface.js';
import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_GATE, DEPARTURE_RUNWAY, DEPARTURE_PUSHBACK, departurePushbackPose } from '../../config/incheonDeparture.js';
import { createDepartureTug, disposeDepartureTug, updateDepartureTug } from '../../environment/DepartureTug.js';
import { flyVerticalPath } from '../PilotControlLaws.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { t } from '../../i18n/index.js';
import { departureRadioCaption } from '../../config/departureRadio.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { GATE: 50, PUSHBACK: 51, DISCONNECT: 52, TAXI: 53, HOLD: 54, LINEUP: 55, CLEARANCE: 56, TAKEOFF: 57, COMPLETED: 58 };
const names = ['gate', 'pushback', 'disconnect', 'taxi', 'hold', 'lineup', 'clearance', 'takeoff'];
const pushbackEnd = departurePushbackPose(1);
export { DEPARTURE_GATE };

/** One gate reset; towing forces, wheel steering and flight controls thereafter. */
export class IncheonDepartureScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.GATE) {
      this.stop();
      sim.setPreset('runway', true);
      sim.position.set(DEPARTURE_GATE.x, INCHEON_AIRFIELD.elevationM + sim.gear.cgGroundHeightM, DEPARTURE_GATE.z);
      sim.linearVelocity.set(0, 0, 0);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -DEPARTURE_GATE.heading, 0, 'YXZ'));
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);
      sim.aero.setFlapPosition(3); // 737 takeoff flaps 15.
      sim.aero.currentFlapAngle = 15;
      sim.controls.setParkingBrake(false);
      this.result = { status: 'running', airborne: false, stages: [], radio: [], taxiPoints: 0 };
      this.index = 0;
      this.settleTime = 0;
      this.force = new THREE.Vector3(); this.moment = new THREE.Vector3();
      this.tug = createDepartureTug(); sim.scene.add(this.tug);
      updateDepartureTug(this.tug, sim, 0, false, 0);
      this.director.setTimeOfDay(9);
      sim.currentAirport?.departureBridge?.setExtension(1);
      sim.audio?.departureRadio.preload();
    }
    if (stage === STAGES.TAXI) { this.index = 0; }
    if (stage === STAGES.LINEUP) { this.index = 0; this.lineupBraking = false; }
    const name = names[stage - STAGES.GATE];
    if (name) {
      this.result.stages.push(name);
      const caption = () => departureRadioCaption(name, speaker => t(`departure.speaker.${speaker}`));
      this.result.radio.push(caption());
      this.director.updateBanner(() => t(`departure.stage.${name}`), caption);
      sim.audio?.playDepartureRadio(name);
      if (stage === STAGES.GATE && !this.director.userCameraOverridden) sim.cameraSystem?.resetDroneOrbit?.(-1.3,60,17);
      if (!this.director.userCameraOverridden) sim.cameraSystem?.setMode(stage === STAGES.GATE || stage === STAGES.PUSHBACK
        ? CameraSystem.MODES.DRONE : CameraSystem.MODES.CHASE);
    }
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed'; this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('departure.complete'), false, { preserveThrottle: true });
    }
  }

  removeTug() { if (this.tug) disposeDepartureTug(this.tug); this.tug = null; }
  stop() {
    this.removeTug();
    this.sim.audio?.departureRadio.stop();
    this.sim.currentAirport?.departureBridge?.setExtension(0);
    if (this.result.status === 'running') this.result.status = 'cancelled';
  }

  pushbackGuidance() {
    const pos=this.sim.position, path=DEPARTURE_PUSHBACK;
    const angle=Math.atan2(pos.z-path.center.z,pos.x-path.center.x);
    const swept=Math.atan2(Math.sin(angle-DEPARTURE_GATE.heading),Math.cos(angle-DEPARTURE_GATE.heading));
    const progress=clamp(swept/path.turn,0,1);
    return {progress,reference:departurePushbackPose(progress),target:departurePushbackPose(progress+3/(path.radius*path.turn))};
  }

  towingForces() {
    if (this.director.currentStage !== STAGES.PUSHBACK || !this.sim.gear.onGround) return null;
    const sim=this.sim,{target,reference,progress}=this.pushbackGuidance();
    const dx=target.x-sim.position.x,dz=target.z-sim.position.z,distance=Math.hypot(dx,dz);
    const speed=Math.min(1.2,distance*.5),scale=distance>.01?speed/distance:0;
    this.force.set((dx*scale-sim.linearVelocity.x)*sim.aero.mass*2,0,
      (dz*scale-sim.linearVelocity.z)*sim.aero.mass*2).clampLength(0,sim.aero.mass*1.5);
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(sim.quaternion);
    const heading=Math.atan2(forward.x,-forward.z);
    const error=Math.atan2(Math.sin(reference.heading-heading),Math.cos(reference.heading-heading));
    const rate=-speed/DEPARTURE_PUSHBACK.radius*clamp((1-progress)*15,0,1);
    const torque=(-error*.8+(rate-sim.angularVelocity.y)*1.5)/sim.aero.invIzz;
    this.moment.set(0,clamp(torque,-sim.aero.mass*4,sim.aero.mass*4),0);
    return {force:this.force,moment:this.moment};
  }

  /** Track a continuous path ahead of the 737 instead of circling missed points. */
  taxi(route, stopping) {
    const sim = this.sim, pos = sim.position;
    const leadIn = route === DEPARTURE_LINEUP_ROUTE ? DEPARTURE_TAXI_ROUTE.at(-1) : pushbackEnd;
    let start, end, length, along;
    while (true) {
      start = this.index > 0 ? route[this.index - 1] : leadIn;
      end = route[this.index];
      length = Math.hypot(end.x - start.x, end.z - start.z);
      along = length > .01 ? ((pos.x-start.x)*(end.x-start.x)+(pos.z-start.z)*(end.z-start.z))/length : length;
      if (this.index < route.length - 1 && (length < .01 || along >= length)) this.index++;
      else break;
    }
    const speed = Math.hypot(sim.linearVelocity.x,sim.linearVelocity.z);
    let look = 14 + Math.min(speed,4)*1.5;
    let from = {x:start.x+(end.x-start.x)*clamp(along/Math.max(.01,length),0,1),
      z:start.z+(end.z-start.z)*clamp(along/Math.max(.01,length),0,1)};
    let target = end;
    for(let i=this.index;i<route.length;i++) {
      const point=route[i], distance=Math.hypot(point.x-from.x,point.z-from.z);
      if(distance>=look) {
        target={x:from.x+(point.x-from.x)*look/distance,z:from.z+(point.z-from.z)*look/distance};break;
      }
      look-=distance;from=point;target=point;
    }
    const distance = Math.hypot(target.x-pos.x,target.z-pos.z);
    const bearing = Math.atan2(target.x-pos.x,-(target.z-pos.z));
    const error = ((bearing*180/Math.PI-sim.telemetry.headingDeg+540)%360)-180;
    const curvature = 2*Math.sin(clamp(error*Math.PI/180,-Math.PI/2,Math.PI/2))/Math.max(14,distance);
    const steeringRatio = Math.max(.15,1-Math.min(1,speed/35)*.82);
    const steering = Math.atan(14.3*curvature)/(55*Math.PI/180*steeringRatio);
    const finalDistance = Math.hypot(route.at(-1).x-pos.x,route.at(-1).z-pos.z);
    const final = this.index === route.length-1;
    const desired = final && stopping ? Math.min(2.5,finalDistance*.3) : Math.min(4, Math.sqrt(.6/Math.max(.01,Math.abs(curvature))));
    sim.controls.setVirtualInput('rudder',clamp(steering+sim.angularVelocity.y*2,-.7,.7));
    sim.controls.setVirtualInput('throttle',clamp(.22+(desired-speed)*.18,0,.75));
    sim.controls.setVirtualInput('brakes',speed>desired+.3?clamp((speed-desired)*.4,0,1):0);
    if(final && stopping && finalDistance<3) {
      sim.controls.setVirtualInput('throttle',0);sim.controls.setVirtualInput('brakes',1);
      return speed<.4;
    }
    return false;
  }

  update(dt) {
    const sim = this.sim, d = this.director, stage = d.currentStage;
    sim.controls.setVirtualInput('throttle', 0);
    sim.controls.setVirtualInput('brakes', 1);
    sim.controls.setVirtualInput('elevator', 0);
    sim.controls.setVirtualInput('aileron', 0);
    sim.controls.setVirtualInput('rudder', 0);
    const radioBusy = sim.audio?.departureRadio.busy ?? false;
    if (stage === STAGES.GATE) sim.currentAirport?.departureBridge?.setExtension(clamp(1-(d.stageTimer-2)/4,0,1));
    if (this.tug) updateDepartureTug(this.tug, sim, dt, stage === STAGES.DISCONNECT, d.stageTimer);
    if (stage === STAGES.GATE && d.stageTimer > 6 && !radioBusy) d.setStage(STAGES.PUSHBACK);
    else if (stage === STAGES.PUSHBACK) {
      sim.controls.setVirtualInput('brakes', 0);
      const {reference,progress}=this.pushbackGuidance();
      const forward=new THREE.Vector3(0,0,-1).applyQuaternion(sim.quaternion);
      const heading=Math.atan2(forward.x,-forward.z);
      const error=Math.atan2(Math.sin(reference.heading-heading),Math.cos(reference.heading-heading));
      const ratio=Math.max(.15,1-Math.min(1,sim.linearVelocity.length()/35)*.82);
      const feedForward=Math.atan(14.3/DEPARTURE_PUSHBACK.radius)/(55*Math.PI/180*ratio);
      sim.controls.setVirtualInput('rudder',clamp(-feedForward*clamp((1-progress)*15,0,1)-error*1.5-sim.angularVelocity.y*2,-.8,.8));
      const aligned=Math.abs(Math.atan2(Math.sin(pushbackEnd.heading-heading),Math.cos(pushbackEnd.heading-heading)))<5*Math.PI/180;
      const stopped = Math.hypot(sim.position.x-pushbackEnd.x,sim.position.z-pushbackEnd.z)<.7 && sim.linearVelocity.length()<.3 && aligned;
      this.settleTime = stopped ? this.settleTime + dt : 0;
      if (this.settleTime > 1 && !radioBusy) d.setStage(STAGES.DISCONNECT);
    } else if (stage === STAGES.DISCONNECT && this.tug?.userData.animation.clear && !radioBusy) d.setStage(STAGES.TAXI);
    else if (stage === STAGES.TAXI) {
      if (this.taxi(DEPARTURE_TAXI_ROUTE, true)) d.setStage(STAGES.HOLD);
      this.result.taxiPoints = this.index;
    } else if (stage === STAGES.HOLD && d.stageTimer > 8 && !radioBusy) d.setStage(STAGES.LINEUP);
    else if (stage === STAGES.LINEUP) {
      const runway = DEPARTURE_RUNWAY;
      const angle = runway.headingDeg * Math.PI/180;
      const dx = sim.position.x-runway.threshold.x, dz = sim.position.z-runway.threshold.z;
      const along = dx*Math.sin(angle)-dz*Math.cos(angle);
      const cross = dx*Math.cos(angle)+dz*Math.sin(angle);
      const error = ((runway.headingDeg-sim.telemetry.headingDeg+540)%360)-180;
      const aligned = along>100 && along<800 && Math.abs(cross)<4 && Math.abs(error)<5;
      if (aligned && Math.abs(sim.angularVelocity.y)<.03) this.lineupBraking = true;
      if (this.lineupBraking) {
        sim.controls.setVirtualInput('rudder',clamp(error*.04,-.2,.2));
        if (sim.linearVelocity.length()<.4) {
          if (aligned) d.setStage(STAGES.CLEARANCE);
          else this.lineupBraking = false;
        }
      } else this.taxi(DEPARTURE_LINEUP_ROUTE,false);
    } else if (stage === STAGES.CLEARANCE && d.stageTimer > 6 && !radioBusy) d.setStage(STAGES.TAKEOFF);
    else if (stage === STAGES.TAKEOFF) {
      const runwayHeading = DEPARTURE_RUNWAY.headingDeg;
      const error = ((runwayHeading - sim.telemetry.headingDeg + 540) % 360) - 180;
      sim.controls.setVirtualInput('brakes', 0);
      sim.controls.setVirtualInput('throttle', 1);
      if (sim.gear.onGround) sim.controls.setVirtualInput('rudder', clamp(error * .04, -.4, .4));
      else this.holdHeading(runwayHeading, 5);
      if (sim.telemetry.iasKnots >= 140) {
        flyVerticalPath(sim, 8, 170, sim.telemetry, 0, sim.gear.onGround ? 8 : null);
      }
      if (!sim.gear.onGround && sim.position.y > INCHEON_AIRFIELD.elevationM + 15) sim.gear.setGearTarget(false);
      sim.controls.setVirtualInput('throttle', 1);
      const height = sim.position.y - INCHEON_AIRFIELD.elevationM;
      if (!sim.gear.onGround && height > 15) this.result.airborne = true;
      if (this.result.airborne && height > 80) d.setStage(STAGES.COMPLETED);
    }
    if (d.stageTimer > 1500 || d.totalTimer > 1800) {
      this.result.status = 'failed'; this.result.reason = 'Guidance timeout';
      d.stop(() => t('departure.failed'));
    }
  }
}
