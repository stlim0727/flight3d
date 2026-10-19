import * as THREE from 'three';
import { CameraSystem } from '../../cameras/CameraSystem.js';

/**
 * Autonomous Pacific Coastal International Airport (Runway 09L) Scenic Demo Scenario
 */
export class CoastalDemoScenario {
  static STAGES = {
    IDLE: -1,
    PREFLIGHT_ORBIT: 0,
    TAKEOFF_ROLL: 1,
    ROTATION_CLIMB: 2,
    COASTAL_BANK: 3,
    OCEAN_CRUISE: 4,
    FINAL_APPROACH: 5,
    TOUCHDOWN_ROLLOUT: 6,
    POSTFLIGHT_ORBIT: 7,
    COMPLETED: 8
  };

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
  }

  enterStage(stage) {
    switch (stage) {
      case CoastalDemoScenario.STAGES.PREFLIGHT_ORBIT:
        this.director.updateBanner(
          '🎬 [1/8] 비행 전 드론 서클 점검 (Pre-Flight Drone Inspection)',
          '보잉 737 기체 외관 360° 드론 조망 • 플랩 5 전개 • 황금빛 일출 해안 전경 [Esc: 직접 조종]'
        );
        if (this.sim.setPreset) {
          this.sim.setPreset('runway', true);
        }
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(-Math.PI * 0.45, 36.0, 9.5);
        this.sim.sky.setTimeOfDay(6.5);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(2); // Flaps 5
        }
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case CoastalDemoScenario.STAGES.TAKEOFF_ROLL:
        this.director.updateBanner(
          '🛫 [2/8] 활주로 이륙 활주 (Runway 09L Takeoff Roll)',
          'TOGA 100% 추력 가속 • 보잉 글래스 콕핏(MCP, PFD, ND, ISFD) 계기 감상'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.sky.setTimeOfDay(7.2);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        this.sim.controls.setVirtualInput('brakes', 0.0);
        if (this.sim.gear) this.sim.gear.setBrakes(0.0);
        this.sim.controls.setVirtualInput('throttle', 1.0);
        if (this.sim.engines) this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);
        break;

      case CoastalDemoScenario.STAGES.ROTATION_CLIMB:
        this.director.updateBanner(
          '✈️ [3/8] V_r 로테이션 & 이륙 상승 (Rotation & Initial Climb)',
          '133 KT 부드러운 기수 인상(2.2°/s) • 앞/뒷바퀴 이륙 & 랜딩 기어 접기 • 기체 외형 및 도심 전경'
        );
        this.sim.controls.setVirtualInput('elevator', 0.65);
        break;

      case CoastalDemoScenario.STAGES.COASTAL_BANK:
        this.director.updateBanner(
          '⛰️ [4/8] 해안가 선회 비행 (Scenic Coastal Banking Turn)',
          '우측 20° 선회 • 굴곡 산맥 지형, 3,500+ 그루 식생 및 500+ 채 도심 빌딩 조망'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(0);
        }
        break;

      case CoastalDemoScenario.STAGES.OCEAN_CRUISE:
        this.director.updateBanner(
          '🚢 [5/8] 해상 선박 & 거스트너 파도 수면 순항 (Ocean Waves & Fleet Cruise)',
          '햇빛 반사 수면 • 컨테이너 화물선, 대형 유람선 및 쾌속 모터보트 웨이크 감상'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        break;

      case CoastalDemoScenario.STAGES.FINAL_APPROACH:
        this.director.updateBanner(
          '🛬 [6/8] 3NM 최종 착륙 접근 (Runway 09L Final Approach)',
          'PAPI 4등식 3.0° 활공각 유도(2 White 2 Red) • ALS 진입 스트로브 • 플랩 30 전개'
        );
        this.sim.setPreset('approach', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.sky.setTimeOfDay(17.6);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT:
        this.director.updateBanner(
          '🛑 [7/8] 활주로 접지 & 역추진 제동 (Touchdown & Reverser Rollout)',
          '랜딩 기어 뷰: 뒷바퀴/앞바퀴 순차 완충 접지 • 타이어 연기 • 스포일러 & 역추진 제동'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        break;

      case CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT:
        this.director.updateBanner(
          '🚁 [8/8] 안전 착륙 완료 & 드론 서클 쇼케이스 (Touchdown Complete • Drone Orbit View)',
          '활주로 정지 완료 • 스포일러/역추진 격납 • 보잉 737 기체 전경 드론 조망 [Esc: 직접 조종]'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(this.sim.cameraSystem.droneOrbitAngle, 38.0, 11.5);
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        break;

      case CoastalDemoScenario.STAGES.COMPLETED:
        this.director.updateBanner(
          '🎉 데모 시연 완료! 조종사 수동 조종 인계',
          '이제 원하는 프리셋과 카메라 뷰를 선택하여 직접 비행을 즐겨보세요! [Esc]'
        );
        this.director.stop('데모 비행 시연이 완료되었습니다. 비행을 즐겨보세요!');
        break;
    }
  }

  update(dt) {
    const tel = this.sim.telemetry;

    switch (this.director.currentStage) {
      case CoastalDemoScenario.STAGES.PREFLIGHT_ORBIT: {
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.director.stageTimer >= 6.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.TAKEOFF_ROLL);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.TAKEOFF_ROLL: {
        if (tel.iasKnots >= 132 || this.director.stageTimer > 23.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.ROTATION_CLIMB);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.ROTATION_CLIMB: {
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = 0.0 - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.2, Math.min(0.2, aileronCmd)));

        if (!tel.onGround && tel.radioAltFt > 10.0) {
          if (tel.gearState > 0.1 && !tel.isTransit && this.sim.gear) {
            this.sim.gear.setGearTarget(false);
          }
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const pitchErr = 12.0 - tel.pitchDeg;
          const elevatorCmd = 0.18 + pitchErr * 0.035 - pitchRateDeg * 0.02;
          this.sim.controls.setVirtualInput('elevator', Math.max(0.08, Math.min(0.35, elevatorCmd)));
        }

        if (this.director.stageTimer > 6.0 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (tel.altitudeFt > 650 || this.director.stageTimer > 12.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.COASTAL_BANK);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.COASTAL_BANK: {
        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-20.0, Math.min(20.0, hdgDiff * 0.65));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const targetPitch = 10.0;
        const pitchErr = targetPitch - tel.pitchDeg;
        const elevatorCmd = 0.12 + pitchErr * 0.035 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.25, elevatorCmd)));
        this.sim.controls.setVirtualInput('rudder', Math.max(-0.10, Math.min(0.10, targetBankDeg * 0.005)));

        const sunTime = 7.2 + Math.min(10.0, this.director.stageTimer * 0.8);
        this.sim.sky.setTimeOfDay(sunTime);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }

        if (this.director.stageTimer > 11.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.OCEAN_CRUISE);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.OCEAN_CRUISE: {
        const targetAlt = 1200;
        const altErr = targetAlt - tel.altitudeFt;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = altErr * 0.002 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.20, elevatorCmd)));

        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-12.0, Math.min(12.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('throttle', 0.65);

        if (this.director.stageTimer > 5.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (this.director.stageTimer > 10.5) {
          this.director.setStage(CoastalDemoScenario.STAGES.FINAL_APPROACH);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.FINAL_APPROACH: {
        const targetTouchdownX = -1250;
        const distToThreshold = targetTouchdownX - this.sim.position.x;
        const idealAltFt = Math.max(47, (distToThreshold * Math.tan(THREE.MathUtils.degToRad(3.0))) * 3.28084 + 47);

        const targetRoll = Math.max(-10.0, Math.min(10.0, -this.sim.position.z * 0.15));
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.20, Math.min(0.20, aileronCmd)));

        const isOverRunway = this.sim.position.x >= -1600;
        if (!this.director.approachFlarInitiated && isOverRunway && tel.radioAltFt <= 30.0 && tel.radioAltFt > 0) {
          this.director.approachFlarInitiated = true;
        }

        if (this.director.approachFlarInitiated) {
          this.sim.controls.setVirtualInput('throttle', 0.0);
          if (this.sim.engines) this.sim.engines.setThrottle(0.0);
          this.sim.controls.setVirtualInput('elevator', 0.14);
        } else {
          const altDiff = idealAltFt - tel.altitudeFt;
          const targetPitchDeg = Math.max(-1.0, Math.min(6.5, 2.8 + altDiff * 0.035));
          const pitchDiff = targetPitchDeg - tel.pitchDeg;
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const elevatorCmd = pitchDiff * 0.08 - pitchRateDeg * 0.03;
          this.sim.controls.setVirtualInput('elevator', Math.max(-0.35, Math.min(0.45, elevatorCmd)));

          const speedErr = 142 - tel.iasKnots;
          const energyComp = altDiff > 25 ? 0.12 : (altDiff < -25 ? -0.08 : 0.0);
          this.sim.controls.setVirtualInput('throttle', Math.max(0.35, Math.min(0.75, 0.48 + speedErr * 0.025 + energyComp)));
        }

        if (isOverRunway && (tel.onGround || (this.director.approachFlarInitiated && tel.radioAltFt <= 8.5))) {
          this.director.setStage(CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT: {
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', -this.sim.position.z * 0.02);
        if (this.sim.aero) this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);

        if (this.director.stageTimer > 4.5 && this.sim.cameraSystem.mode === CameraSystem.MODES.GEAR) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (tel.iasKnots < 5.0 || this.director.stageTimer > 12.0) {
          if (this.sim.engines) this.sim.engines.setReverser(false, true);
          if (this.sim.aero) this.sim.aero.spoilers = 0.0;
          this.director.setStage(CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT: {
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.director.stageTimer >= 7.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.COMPLETED);
        }
        break;
      }
    }
  }
}
