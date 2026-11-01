import * as THREE from 'three';

/**
 * Pure helper to compute whether a world-space target is visible horizontally
 * on the screen, and if not, which horizontal direction ('left' or 'right')
 * an off-screen edge arrow should indicate.
 *
 * @param {THREE.Vector3} targetWorld - World coordinate of target waypoint.
 * @param {THREE.Camera} camera - Active Three.js perspective camera.
 * @param {number} [margin=0.88] - NDC horizontal boundary threshold (0 to 1).
 * @returns {{ visible: boolean, direction: 'left'|'right'|null, isBehind: boolean, ndc: THREE.Vector3|null, local: THREE.Vector3|null }}
 */
export function calculateEdgeArrowState(targetWorld, camera, margin = 0.88) {
  if (!targetWorld || !camera) return { visible: false, direction: null, isBehind: false, ndc: null, local: null };

  const local = targetWorld.clone().applyMatrix4(camera.matrixWorldInverse);
  const isBehind = local.z >= -0.001;

  if (isBehind) {
    return {
      visible: true,
      direction: local.x < 0 ? 'left' : 'right',
      isBehind: true,
      ndc: null,
      local,
    };
  }

  const ndc = targetWorld.clone().project(camera);
  if (ndc.x < -margin) {
    return { visible: true, direction: 'left', isBehind: false, ndc, local };
  }
  if (ndc.x > margin) {
    return { visible: true, direction: 'right', isBehind: false, ndc, local };
  }

  return { visible: false, direction: null, isBehind: false, ndc, local };
}

/**
 * Render a high-resolution 2D canvas texture for the floating sky signboard.
 */
export function createSignboardCanvas(index, isFinish) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const primary = isFinish ? '#ffd700' : '#00f0ff';
    const glow = isFinish ? 'rgba(255, 215, 0, 0.6)' : 'rgba(0, 240, 255, 0.6)';

    // Card background
    ctx.fillStyle = 'rgba(7, 22, 35, 0.92)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(10, 10, 492, 180, 24);
    } else {
      ctx.rect(10, 10, 492, 180);
    }
    ctx.fill();

    // Glowing border outline
    ctx.strokeStyle = primary;
    ctx.lineWidth = 6;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.stroke();

    // Reset shadow for text clarity
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Header badge
    ctx.fillStyle = primary;
    ctx.font = 'bold 36px monospace';
    ctx.fillText(isFinish ? '[ FINISH GATE ]' : `[ WAYPOINT ${index} ]`, 256, 52);

    // Gate title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(isFinish ? '최종 도착선' : `${index}번 경유지`, 256, 105);

    // Target altitude & descent guide
    ctx.fillStyle = '#9fe8ff';
    ctx.font = '24px monospace';
    ctx.fillText(isFinish ? '도착선 · ▼ PASS' : '기준 20m · 550-600 KT · ▼ PASS', 256, 155);

    return canvas;
  } catch {
    return null;
  }
}

/**
 * Visualizer for valley slalom course:
 * 1. Large 3D luminous pillars extending 800m from ground into the sky.
 * 2. Floating virtual billboard signboards at the top of the pillars in the sky.
 * 3. Screen-edge directional arrows indicating the turn direction when the next waypoint
 *    is not visible horizontally.
 */
export class ValleyWaypointsVisualizer {
  constructor(sim, course) {
    this.sim = sim;
    this.course = course;
    this.nextGateIndex = 1;
    this.evaluator = null;
    this.active = true;
    this.waypoints = [];
    this.group = new THREE.Group();
    this.group.name = 'valley-waypoints';

    if (!sim?.scene || typeof document === 'undefined') {
      this.headless = true;
      return;
    }

    this.initWaypoints();
    this.initEdgeArrow();
    this.sim.scene.add(this.group);
  }

  setEvaluator(evaluator) {
    this.evaluator = evaluator;
  }

  setNextGateIndex(index) {
    if (Number.isInteger(index) && index >= 1) {
      this.nextGateIndex = index;
    }
  }

  initWaypoints() {
    const points = this.course?.points || [];
    const pillarHeight = 800;
    const outerRadius = 35;
    const innerRadius = 8;
    const ringRadius = 110;

    // Create shared geometries
    this.outerGeo = new THREE.CylinderGeometry(outerRadius, outerRadius, pillarHeight, 24, 1, true);
    this.innerGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, pillarHeight, 16, 1, true);
    this.ringGeo = new THREE.TorusGeometry(ringRadius, 3, 8, 36);
    this.signGeo = new THREE.PlaneGeometry(160, 60);

    // We generate pillars for gates 1 through N (excluding 0 which is spawn)
    for (let index = 1; index < points.length; index++) {
      const pt = points[index];
      const isFinish = index === points.length - 1;

      // Query physical terrain elevation at waypoint location
      const groundY = Number.isFinite(this.sim.currentTerrain?.getHeight?.(pt.x, pt.z))
        ? this.sim.currentTerrain.getHeight(pt.x, pt.z)
        : 2100;

      const wpGroup = new THREE.Group();
      wpGroup.name = `waypoint-gate-${index}`;

      // Outer luminous cylinder
      const outerMat = new THREE.MeshBasicMaterial({
        color: isFinish ? 0xffd700 : 0x00f0ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      const outerMesh = new THREE.Mesh(this.outerGeo, outerMat);
      outerMesh.position.set(pt.x, groundY + pillarHeight / 2, pt.z);
      wpGroup.add(outerMesh);

      // Inner concentrated laser core
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      const innerMesh = new THREE.Mesh(this.innerGeo, innerMat);
      innerMesh.position.set(pt.x, groundY + pillarHeight / 2, pt.z);
      wpGroup.add(innerMesh);

      // Gate ring at target passage altitude (20m AGL)
      const targetAgl = this.course?.targetAglM ?? 20;
      const ringMat = new THREE.MeshBasicMaterial({
        color: isFinish ? 0xffd700 : 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      const ringMesh = new THREE.Mesh(this.ringGeo, ringMat);
      ringMesh.position.set(pt.x, groundY + targetAgl, pt.z);
      ringMesh.rotation.x = Math.PI / 2;
      wpGroup.add(ringMesh);

      // Floating sky signboard at the top of the pillar
      const canvas = createSignboardCanvas(index, isFinish);
      let signMat;
      if (canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        signMat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        });
      } else {
        signMat = new THREE.MeshBasicMaterial({
          color: isFinish ? 0xffd700 : 0x00f0ff,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        });
      }
      const signMesh = new THREE.Mesh(this.signGeo, signMat);
      signMesh.position.set(pt.x, groundY + pillarHeight, pt.z);
      wpGroup.add(signMesh);

      this.group.add(wpGroup);

      this.waypoints[index] = {
        index,
        isFinish,
        pt,
        groundY,
        group: wpGroup,
        outerMat,
        innerMat,
        ringMat,
        signMesh,
        targetWorld: new THREE.Vector3(pt.x, groundY + targetAgl, pt.z),
      };
    }
  }

  initEdgeArrow() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('valley-waypoint-arrow');
    if (!el) {
      el = document.createElement('div');
      el.id = 'valley-waypoint-arrow';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-label', '다음 경유지 방향 화살표');
      el.hidden = true;
      document.body.append(el);
    }
    this.edgeArrow = el;
  }

  /**
   * Per-frame animation update called before scene rendering.
   */
  update() {
    if (this.headless || !this.active) return;
    const camera = this.sim?.camera;
    if (!camera) return;

    const nextGateIndex = this.evaluator?.nextGateIndex ?? this.nextGateIndex;
    const missionActive = !this.sim?.isCrashed && (!this.evaluator || this.evaluator.status === 'running');

    // Update 3D waypoints: highlight next, dim upcoming, hide passed
    for (let index = 1; index < this.waypoints.length; index++) {
      const wp = this.waypoints[index];
      if (!wp) continue;

      if (index < nextGateIndex || !missionActive) {
        // Passed waypoint or mission ended: hide
        wp.group.visible = false;
      } else if (index === nextGateIndex) {
        // Immediate next waypoint: prominent active glow
        wp.group.visible = true;
        wp.outerMat.opacity = wp.isFinish ? 0.6 : 0.55;
        wp.innerMat.opacity = 0.85;
        wp.ringMat.opacity = 0.85;
        // Keep signboard facing the camera
        wp.signMesh.quaternion.copy(camera.quaternion);
      } else {
        // Subsequent upcoming waypoints: softer visibility
        wp.group.visible = true;
        wp.outerMat.opacity = 0.2;
        wp.innerMat.opacity = 0.4;
        wp.ringMat.opacity = 0.35;
        wp.signMesh.quaternion.copy(camera.quaternion);
      }
    }

    // Update 2D off-screen edge arrow
    if (!this.edgeArrow) return;

    const currentWp = this.waypoints[nextGateIndex];
    if (!currentWp || !missionActive) {
      this.edgeArrow.hidden = true;
      return;
    }

    const arrowState = calculateEdgeArrowState(currentWp.targetWorld, camera);
    if (!arrowState.visible || !arrowState.direction) {
      this.edgeArrow.hidden = true;
      return;
    }

    // Format distance & label
    const distM = this.sim.position ? this.sim.position.distanceTo(currentWp.targetWorld) : 0;
    const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
    const label = currentWp.isFinish ? '도착선' : `WP ${nextGateIndex}`;

    this.edgeArrow.hidden = false;
    this.edgeArrow.className = arrowState.direction === 'left' ? 'is-left' : 'is-right';
    if (arrowState.direction === 'left') {
      this.edgeArrow.innerHTML = `<span class="valley-arrow-chevron">◀◀</span><span class="valley-arrow-text">${label} · ${distStr}</span>`;
    } else {
      this.edgeArrow.innerHTML = `<span class="valley-arrow-text">${label} · ${distStr}</span><span class="valley-arrow-chevron">▶▶</span>`;
    }
  }

  dispose() {
    this.active = false;
    if (this.edgeArrow) {
      this.edgeArrow.hidden = true;
      this.edgeArrow.remove();
      this.edgeArrow = null;
    }
    if (this.sim?.scene && this.group) {
      this.sim.scene.remove(this.group);
    }
    this.group?.traverse?.(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => { m.map?.dispose?.(); m.dispose(); });
        else { obj.material.map?.dispose?.(); obj.material.dispose(); }
      }
    });
    this.outerGeo?.dispose();
    this.innerGeo?.dispose();
    this.ringGeo?.dispose();
    this.signGeo?.dispose();
  }
}
