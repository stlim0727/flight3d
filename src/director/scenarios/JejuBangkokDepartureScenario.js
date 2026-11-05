import * as THREE from 'three';
import { IncheonDepartureScenario } from './IncheonDepartureScenario.js';
import { INCHEON_AIRFIELD } from '../../geospatial/IncheonFlightSurface.js';
import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_GATE, DEPARTURE_RUNWAY, DEPARTURE_PUSHBACK, departurePushbackPose } from '../../config/incheonDeparture.js';
import { updateDepartureTug } from '../../environment/DepartureTug.js';
import { flyVerticalPath } from '../PilotControlLaws.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { t } from '../../i18n/index.js';
import { DepartureAtc } from '../DepartureAtc.js';
import { BANGKOK_DEPARTURE_ATC, BANGKOK_CLEARANCE } from '../../config/bangkokDepartureAtc.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = IncheonDepartureScenario.STAGES;
const names = ['gate', 'pushback', 'disconnect', 'taxi', 'hold', 'lineup', 'clearance', 'takeoff'];
const pushbackEnd = departurePushbackPose(1);

export class JejuBangkokDepartureScenario extends IncheonDepartureScenario {
  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.GATE) {
      super.enterStage(stage);
      // Replace default atc with Bangkok departure atc
      this.atc = new DepartureAtc('gate', voice => sim.audio?.playDepartureRadio(voice), BANGKOK_DEPARTURE_ATC, {});
      const caption = () => this.atc?.caption(speaker => t(`departure.speaker.${speaker}`)) || t('departure.climbInstruction');
      this.result.radio = [this.atc.blocks.flatMap(block => block.lines).map(([speaker, text]) => `${speaker}: ${text}`).join(' ')];
      this.director.updateBanner(() => t('departure.stage.gate'), caption);
      return;
    }
    if (stage === STAGES.TAXI) { this.index = 0; }
    if (stage === STAGES.LINEUP) { this.index = 0; this.lineupBraking = false; }
    const name = stage === STAGES.DEPARTURE ? 'departure' : names[stage - STAGES.GATE];
    if (name) {
      this.result.stages.push(name);
      // For Bangkok, takeoff stage has explicit tower handoff exchanges
      this.atc = new DepartureAtc(name, voice => sim.audio?.playDepartureRadio(voice), BANGKOK_DEPARTURE_ATC, {});
      const caption = () => this.atc?.caption(speaker => t(`departure.speaker.${speaker}`)) || t('departure.climbInstruction');
      this.result.radio.push(this.atc.blocks.flatMap(block => block.lines).map(([speaker, text]) => `${speaker}: ${text}`).join(' '));
      this.director.updateBanner(() => t(`departure.stage.${name}`), caption);
      if (stage === STAGES.GATE && !this.director.userCameraOverridden) sim.cameraSystem?.resetDroneOrbit?.(-1.3, 60, 17);
      if (!this.director.userCameraOverridden) sim.cameraSystem?.setMode(stage === STAGES.GATE || stage === STAGES.PUSHBACK
        ? CameraSystem.MODES.DRONE : CameraSystem.MODES.CHASE);
    }
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('departure.bangkok.complete'), false, { preserveThrottle: true });
    }
  }

  update(dt) {
    const sim = this.sim, d = this.director, stage = d.currentStage;
    sim.controls.setVirtualInput('throttle', 0);
    sim.controls.setVirtualInput('brakes', 1);
    sim.controls.setVirtualInput('elevator', 0);
    sim.controls.setVirtualInput('aileron', 0);
    sim.controls.setVirtualInput('rudder', 0);
    const exchange = this.atc?.index;
    this.atc?.update(dt, sim.audio?.departureRadio.busy ?? false, this.tug?.userData.animation.clear ?? false);
    if (exchange !== this.atc?.index) {
      const name = stage === STAGES.DEPARTURE ? 'departure' : names[stage - STAGES.GATE];
      this.director.updateBanner(() => t(`departure.stage.${name}`),
        () => this.atc?.caption(speaker => t(`departure.speaker.${speaker}`)) || t('departure.climbInstruction'));
    }
    const radioBusy = this.atc?.busy ?? false;
    if (stage === STAGES.GATE) sim.currentAirport?.departureBridge?.setExtension(clamp(1 - (d.stageTimer - 2) / 4, 0, 1));
    if (this.tug) updateDepartureTug(this.tug, sim, dt, stage === STAGES.DISCONNECT, d.stageTimer);
    if (stage === STAGES.GATE && d.stageTimer > 6 && !radioBusy) d.setStage(STAGES.PUSHBACK);
    else if (stage === STAGES.PUSHBACK) {
      sim.controls.setVirtualInput('brakes', 0);
      const { reference, progress } = this.pushbackGuidance();
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.quaternion);
      const heading = Math.atan2(forward.x, -forward.z);
      const error = Math.atan2(Math.sin(reference.heading - heading), Math.cos(reference.heading - heading));
      const ratio = Math.max(.15, 1 - Math.min(1, sim.linearVelocity.length() / 35) * .82);
      const feedForward = Math.atan(14.3 / DEPARTURE_PUSHBACK.radius) / (55 * Math.PI / 180 * ratio);
      sim.controls.setVirtualInput('rudder', clamp(-feedForward * clamp((1 - progress) * 15, 0, 1) - error * 1.5 - sim.angularVelocity.y * 2, -.8, .8));
      const aligned = Math.abs(Math.atan2(Math.sin(pushbackEnd.heading - heading), Math.cos(pushbackEnd.heading - heading))) < 5 * Math.PI / 180;
      const stopped = Math.hypot(sim.position.x - pushbackEnd.x, sim.position.z - pushbackEnd.z) < .7 && sim.linearVelocity.length() < .3 && aligned;
      this.settleTime = stopped ? this.settleTime + dt : 0;
      if (this.settleTime > 1 && !radioBusy) d.setStage(STAGES.DISCONNECT);
    } else if (stage === STAGES.DISCONNECT && this.tug?.userData.animation.clear && !radioBusy) {
      if (sim.voiceChallengeOverlay && !this.voiceChallengeInitiated) {
        this.voiceChallengeInitiated = true;
        const options = [
          {
            id: 'a',
            tag: 'A',
            primary: t('departure.bangkok.voice.optA.primary'),
            secondary: t('departure.bangkok.voice.optA.secondary'),
            phrases: [
              'Jeju Air 2503, taking manual control',
              'taking manual control',
              'Jeju Air 2503',
              'Jeju Air Two Five Zero Three',
              '제주항공 2503, 직접 조종 인계',
              '제주항공 이오공삼 직접 조종 인계',
              '제주항공 2503',
              '직접 조종 인계'
            ]
          },
          {
            id: 'b',
            tag: 'B',
            primary: t('departure.bangkok.voice.optB.primary'),
            secondary: t('departure.bangkok.voice.optB.secondary'),
            phrases: [
              'Request taxi, Jeju Air 2503',
              'request taxi',
              'Incheon Ground, Jeju Air 2503, request taxi',
              'Taxi to holding point runway 34R',
              '지상 이동 요청, 제주항공 2503',
              '지상 이동 요청 제주항공 2503',
              '지상 이동 요청',
              '택시 요청'
            ]
          }
        ];

        sim.voiceChallengeOverlay.show({
          options,
          onPass: (matchedOption) => {
            if (matchedOption?.id === 'b') {
              d.setStage(STAGES.TAXI);
            } else {
              d.stop(() => t('departure.manual.taxi.engaged'), false, { preserveThrottle: false });
              sim.controls?.setParkingBrake?.(false);
              sim.controls?.setVirtualInput?.('brakes', 0);
              sim.controls?.setVirtualInput?.('throttle', 0);
            }
          }
        });
      } else if (!sim.voiceChallengeOverlay) {
        d.setStage(STAGES.TAXI);
      }
    } else if (stage === STAGES.TAXI) {
      if (!radioBusy && this.taxi(DEPARTURE_TAXI_ROUTE, true)) d.setStage(STAGES.HOLD);
      this.result.taxiPoints = this.index;
    } else if (stage === STAGES.HOLD && d.stageTimer > 8 && !radioBusy) d.setStage(STAGES.LINEUP);
    else if (stage === STAGES.LINEUP) {
      const runway = DEPARTURE_RUNWAY;
      const angle = runway.headingDeg * Math.PI / 180;
      const dx = sim.position.x - runway.threshold.x, dz = sim.position.z - runway.threshold.z;
      const along = dx * Math.sin(angle) - dz * Math.cos(angle);
      const cross = dx * Math.cos(angle) + dz * Math.sin(angle);
      const error = ((runway.headingDeg - sim.telemetry.headingDeg + 540) % 360) - 180;
      const aligned = along > 100 && along < 800 && Math.abs(cross) < 4 && Math.abs(error) < 5;
      if (aligned && Math.abs(sim.angularVelocity.y) < .03) this.lineupBraking = true;
      if (this.lineupBraking) {
        sim.controls.setVirtualInput('rudder', clamp(error * .04, -.2, .2));
        if (!radioBusy && sim.linearVelocity.length() < .4) {
          if (aligned) d.setStage(STAGES.CLEARANCE);
          else this.lineupBraking = false;
        }
      } else if (!radioBusy) this.taxi(DEPARTURE_LINEUP_ROUTE, false);
    } else if (stage === STAGES.CLEARANCE && d.stageTimer > 6 && !radioBusy) d.setStage(STAGES.TAKEOFF);
    else if ((stage === STAGES.TAKEOFF || stage === STAGES.DEPARTURE)) {
      const runwayHeading = DEPARTURE_RUNWAY.headingDeg;
      const heightFt = (sim.position.y - INCHEON_AIRFIELD.elevationM) / .3048;
      const targetHeading = (stage === STAGES.DEPARTURE && heightFt >= BANGKOK_CLEARANCE.turnAltitudeFt)
        ? BANGKOK_CLEARANCE.targetHeadingDeg
        : runwayHeading;
      const maxBank = targetHeading === BANGKOK_CLEARANCE.targetHeadingDeg ? 20 : 5;
      const error = ((runwayHeading - sim.telemetry.headingDeg + 540) % 360) - 180;
      sim.controls.setVirtualInput('brakes', 0);
      sim.controls.setVirtualInput('throttle', 1);
      if (sim.gear.onGround) sim.controls.setVirtualInput('rudder', clamp(error * .04, -.4, .4));
      else this.holdHeading(targetHeading, maxBank);
      if (sim.telemetry.iasKnots >= 140) {
        flyVerticalPath(sim, 8, 170, sim.telemetry, 0, sim.gear.onGround ? 8 : null);
      }
      if (!sim.gear.onGround && sim.position.y > INCHEON_AIRFIELD.elevationM + 15) sim.gear.setGearTarget(false);
      sim.controls.setVirtualInput('throttle', 1);
      const height = sim.position.y - INCHEON_AIRFIELD.elevationM;
      if (!sim.gear.onGround && height > 15) this.result.airborne = true;
      if (stage === STAGES.TAKEOFF && this.result.airborne && heightFt >= BANGKOK_CLEARANCE.contactHeightFt && !radioBusy) {
        d.setStage(STAGES.DEPARTURE);
      }
      if (stage === STAGES.DEPARTURE && !radioBusy && heightFt >= BANGKOK_CLEARANCE.handoffHeightFt) {
        const headingDiff = Math.abs(((BANGKOK_CLEARANCE.targetHeadingDeg - sim.telemetry.headingDeg + 540) % 360) - 180);
        if (headingDiff < 25) {
          d.setStage(STAGES.COMPLETED);
        }
      }
    }
    if (d.stageTimer > 1500 || d.totalTimer > 1800) {
      this.result.status = 'failed'; this.result.reason = 'Guidance timeout';
      d.stop(() => t('departure.failed'));
    }
  }
}
