import * as THREE from 'three';

export function initCameraState(cs) {
  cs.mode = cs.constructor.MODES.CHASE;
  cs.autoSwitch = false;
  cs.autoPaused = false;
  cs.touchAutoResumeTimer = null;
  cs.userModeSelected = false;
  cs.cockpitInteriorGate = null;
  cs.pendingCockpitEntry = false;
  cs.autoSwitchTimer = 0;
  cs.autoContext = null;
  cs.customViewUpdater = null;
  cs.combatStateProvider = null;
  cs.temporaryViewTimer = 0;
  cs.savedMode = null;
  cs.onTemporaryViewComplete = null;

  cs.photoCockpit = false;
  cs.supportsPhotoCockpit = true;
  cs.cockpitPortraitEyeX = -0.34;
  cs.cockpitPortraitEyeY = null;
  cs.cockpitHeadOffset = new THREE.Vector3(-0.31, 0.85, -12.35);
  cs.cockpitUserOffset = new THREE.Vector3(0, 0, 0);
  cs.headGForceOffset = new THREE.Vector3();
  cs.touchJoltOffset = 0;
  cs.lookYaw = 0;
  cs.lookPitch = -0.25;

  // Camera-driven head look (webcam face tracking). Kept separate from
  // lookYaw/lookPitch so manual drag and auto-reset stay independent.
  cs.headTrackingEnabled = false;
  cs.headLookActive = false;
  cs.headLookYaw = 0;
  cs.headLookPitch = 0;
  cs.targetHeadLookYaw = 0;
  cs.targetHeadLookPitch = 0;
  cs.headLookMaxYaw = Math.PI * 0.5;
  cs.headLookMaxPitch = Math.PI * 0.45;

  cs.gearCamOffset = new THREE.Vector3(2.2, -2.4, 6.2);
  cs.gearLookTarget = new THREE.Vector3(-0.5, -1.9, -2.5);
  cs.gearLookYaw = 0;
  cs.gearLookPitch = 0;

  cs.chaseDistance = 55.0;
  cs.chaseHeight = 10.5;
  cs.chaseYaw = 0;
  cs.chasePitch = 0;
  cs.chasePos = new THREE.Vector3();
  cs.chaseTarget = new THREE.Vector3();
  cs.chaseTargetInitialized = false;

  cs.speedFov = 0;
  cs.chaseSpeedLag = 0;
  cs.speedSensationTime = 0;
  cs.vibrationOffset = new THREE.Vector3();
  cs.chaseVibration = new THREE.Vector3();
  cs.motionFrozen = false;

  cs.wingLookYaw = 0;
  cs.wingLookPitch = 0;

  cs.droneOrbitAngle = 1.8;
  cs.droneOrbitSpeed = 0.28;
  cs.droneDistance = 38.0;
  cs.droneHeight = 11.5;
  cs.droneLookOffset = new THREE.Vector3(0, 1.8, 0);
  cs.dronePos = new THREE.Vector3();
  cs.droneInitialized = false;

  cs.cursorNormX = 0;
  cs.cursorNormY = 0;
  cs.targetCursorNormX = 0;
  cs.targetCursorNormY = 0;
  cs.enableCursorTrack = false;

  cs.towerPos = new THREE.Vector3(120, 78, 280);
  cs.exteriorZoomMin = 0.5;
  cs.exteriorZoomMax = 6.0;
  cs.opticalZoom = 1.0;
  cs.opticalZoomMin = 1.0;
  cs.opticalZoomMax = 4.0;
  cs.towerZoomMax = 8.0;
  cs.cockpitZoomLean = new THREE.Vector3(0, 0.02, -0.12);
  cs.cockpitZoomGazeLift = 0.08;

  cs.flybyPos = new THREE.Vector3();
  cs.flybySet = false;
  cs.flybyRegime = null;
  cs.getTerrainHeight = null;

  cs.gazeSensitivity = 0.0011;
  cs.touchGazeSensitivity = 0.0035;
  cs.isDragging = false;
  cs.pointerLocked = false;
  cs.prevMouse = { x: 0, y: 0 };

  cs.activeTouchId = null;
  cs.isPinching = false;
  cs.pinchDistance = 0;
  cs.lastTapTime = 0;
  cs.lastTapPos = { x: 0, y: 0 };
  cs.touchStartX = 0;
  cs.touchStartY = 0;
  cs.touchMoved = false;
  cs.onResetLook = null;

  cs.povReturnSpeed = 1.0;
  cs.hatGlanceSpeed = 14.0;
  cs.hatReturnSpeed = 8.0;
  cs.hatGlanceYaw = 1.35;
  cs.hatGlancePitchUp = 0.55;
  cs.hatGlancePitchDown = 0.45;
  cs.hatGlanceChaseYaw = Math.PI * 0.5;
  cs.hatGlanceChasePitch = 0.45;
  cs._lastPovModified = false;
  cs.povChangedByDrag = false;
  cs.povChangedByHat = false;
  cs.isHatLooking = false;
  cs.onPovChange = null;

  cs.userLookOverridden = false;
  cs.autoResetGaze = true;
  cs.banditGaze = false;
  cs.banditGazeTarget = new THREE.Vector3();
  cs.gazeTarget = null;
  cs.onGazeClick = null;
  cs.onGazeChange = null;
  cs._mouseDownClient = { x: 0, y: 0, button: -1 };
  cs._mouseMoved = false;

  cs.enableEdgePan = false;
  cs.edgePanMargin = 30;
  cs.edgePanSpeedX = 280;
  cs.edgePanSpeedY = 220;
}
