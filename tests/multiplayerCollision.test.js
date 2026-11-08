import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

test('Multiplayer aircraft mid-air & ground collision detection', async (t) => {
  const detector = new CollisionDetector(null, null, null, null, null);
  detector.loadAircraftConfig({ id: 'C172' });

  await t.test('safe separation between aircraft does not trigger collision', () => {
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(100, 500, 200),
      quaternion: new THREE.Quaternion(),
      aircraft: 'C172',
      name: 'Maverick',
      velocity: new THREE.Vector3(0, 0, -50),
      crashed: false
    }]);

    const localPos = new THREE.Vector3(0, 500, 0);
    const localQuat = new THREE.Quaternion();
    const localVel = new THREE.Vector3(0, 0, -50);

    const result = detector.checkCollision(localPos, localQuat, localVel, 0, 0, 0);
    assert.equal(result, null, 'Safe separation (223m) must not trigger collision');
  });

  await t.test('cruise spawn slot separation (63m) does not trigger collision', () => {
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(60, 1000, 20),
      quaternion: new THREE.Quaternion(),
      aircraft: 'C172',
      name: 'Wingman',
      velocity: new THREE.Vector3(0, 0, -50),
      crashed: false
    }]);

    const localPos = new THREE.Vector3(0, 1000, 0);
    const localQuat = new THREE.Quaternion();
    const localVel = new THREE.Vector3(0, 0, -50);

    const result = detector.checkCollision(localPos, localQuat, localVel, 0, 0, 0);
    assert.equal(result, null, 'Spawn slot separation must not trigger collision');
  });

  await t.test('head-on mid-air collision detects impact and computes relative velocity', () => {
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(0, 1000, 2),
      quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
      aircraft: 'C172',
      name: 'Goose',
      velocity: new THREE.Vector3(0, 0, 50), // Flying towards +Z
      crashed: false
    }]);

    const localPos = new THREE.Vector3(0, 1000, 0);
    const localQuat = new THREE.Quaternion();
    const localVel = new THREE.Vector3(0, 0, -50); // Flying towards -Z (head-on at 100 m/s relative)

    const result = detector.checkCollision(localPos, localQuat, localVel, 0, 0, 0);
    assert.ok(result !== null, 'Head-on collision must be detected');
    assert.equal(result.type, 'AIRCRAFT');
    assert.ok(result.name.includes('MIDAIR') || result.name.includes('공중'));
    assert.ok(result.description.includes('Goose'));
    // Relative speed 100 m/s * 1.94384 ~ 194.38 knots
    assert.ok(result.speedKnots >= 190, `Relative speed should reflect combined approach: ${result.speedKnots}`);
  });

  await t.test('ground collision with gear on ground reports aircraft ground collision', () => {
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(0, 12, 1),
      quaternion: new THREE.Quaternion(),
      aircraft: 'C172',
      name: 'Rival',
      velocity: new THREE.Vector3(0, 0, 10),
      crashed: false
    }]);

    const localPos = new THREE.Vector3(0, 12, 0);
    const localQuat = new THREE.Quaternion();
    const localVel = new THREE.Vector3(0, 0, 15);
    const groundContact = { onGround: true };

    const result = detector.checkCollision(localPos, localQuat, localVel, 1, 0, 0, groundContact);
    assert.ok(result !== null, 'Runway ground collision must be detected');
    assert.equal(result.type, 'AIRCRAFT');
    assert.ok(result.name.includes('AIRCRAFT') || result.name.includes('항공기'));
  });

  await t.test('wingtip strike during close formation flight is detected', () => {
    detector.loadAircraftConfig({ id: 'B738' }); // Wingspan ~35.8m (wingtips at ±17.2m)
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(34, 1500, 0), // 34m to right: right wingtip at +17.2, remote left wingtip at 34 - 17.2 = 16.8 (overlap)
      quaternion: new THREE.Quaternion(),
      aircraft: 'B738',
      name: 'FormationLead',
      velocity: new THREE.Vector3(0, 0, -120),
      crashed: false
    }]);

    const localPos = new THREE.Vector3(0, 1500, 0);
    const localQuat = new THREE.Quaternion();
    const localVel = new THREE.Vector3(0, 0, -120);

    const result = detector.checkCollision(localPos, localQuat, localVel, 0, 0, 0);
    assert.ok(result !== null, 'Overlapping wingtips in formation flight must collide');
    assert.equal(result.type, 'AIRCRAFT');
    assert.ok(result.description.toLowerCase().includes('wing') || result.description.includes('주익') || result.description.includes('익단'));
  });

  await t.test('crashed or inactive remote aircraft are ignored (no ghost collision)', () => {
    detector.loadAircraftConfig({ id: 'C172' });
    detector.setRemoteAircraftProvider(() => [{
      position: new THREE.Vector3(0, 500, 0), // Exact same position
      quaternion: new THREE.Quaternion(),
      aircraft: 'C172',
      name: 'Ghost',
      crashed: true // Already crashed
    }]);

    const result = detector.checkCollision(new THREE.Vector3(0, 500, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, -50), 0, 0, 0);
    assert.equal(result, null, 'Crashed aircraft must not trigger collision');
  });

  await t.test('accepts raw array coordinates from network snapshots', () => {
    detector.setRemoteAircraftProvider(() => [{
      position: [0, 800, 1],
      quaternion: [0, 0, 0, 1],
      aircraft: 'C172',
      name: 'ArrayPeer',
      velocity: [0, 0, -40],
      crashed: false
    }]);

    const result = detector.checkCollision(new THREE.Vector3(0, 800, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, -40), 0, 0, 0);
    assert.ok(result !== null, 'Array coordinates must be accepted');
    assert.equal(result.type, 'AIRCRAFT');
  });

  await t.test('MultiplayerController getCollisionTargets filtering and remote explosion trigger', () => {
    let explosionSpawned = null;
    let explosionAudioPlayed = false;

    const mockSim = {
      position: new THREE.Vector3(0, 500, 0),
      camera: {},
      cameraSystem: { mode: 'chase' },
      gameFlow: { state: 'flight' },
      explosionSystem: {
        spawnExplosion(crashResult, vel) {
          explosionSpawned = { crashResult, vel };
        }
      },
      audio: {
        playExplosion(isWater) {
          explosionAudioPlayed = true;
        }
      }
    };

    const mockController = {
      sim: mockSim,
      active: true,
      modalOpen: false,
      remoteCrashed: false,
      room: {
        session: {
          state: 'flying',
          remoteName: 'AcePilot',
          config: { aircraft: 'F16' },
          track: {
            sample: () => null
          }
        }
      },
      remote: {
        aircraft: 'F16',
        disposed: false,
        group: {
          visible: true,
          position: new THREE.Vector3(10, 500, 20),
          quaternion: new THREE.Quaternion(),
          userData: {
            remote: {
              p: [10, 500, 20],
              q: [0, 0, 0, 1],
              v: [0, 0, -100],
              crashed: false,
              held: false,
              stale: false
            }
          }
        },
        update() {}
      }
    };

    // Attach getCollisionTargets and update from prototype or definition
    mockController.getCollisionTargets = function () {
      if (!this.active || this.room?.session?.state !== 'flying') return [];
      if (!this.remote || this.remote.disposed) return [];
      const sample = this.remote.group.userData.remote;
      if (!sample || sample.crashed || sample.held || sample.stale) return [];
      if (!this.remote.group.visible) return [];
      return [{
        position: this.remote.group.position,
        quaternion: this.remote.group.quaternion,
        aircraft: this.remote.aircraft || this.room?.session?.config?.aircraft || 'C172',
        name: this.room?.session?.remoteName || 'Pilot',
        velocity: Array.isArray(sample.v)
          ? { x: sample.v[0], y: sample.v[1], z: sample.v[2], length() { return Math.hypot(this.x, this.y, this.z); } }
          : null,
        crashed: sample.crashed === true,
      }];
    };

    const targets = mockController.getCollisionTargets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].name, 'AcePilot');
    assert.equal(targets[0].aircraft, 'F16');
    assert.equal(targets[0].crashed, false);

    // When sample is marked crashed, getCollisionTargets returns empty
    mockController.remote.group.userData.remote.crashed = true;
    assert.equal(mockController.getCollisionTargets().length, 0);

    // Test remote crash trigger in update
    mockController.remote.group.userData.remote.crashed = true;
    const crashSample = {
      p: [10, 500, 20],
      q: [0, 0, 0, 1],
      v: [0, -50, -100],
      crashed: true
    };
    mockController.room.session.track.sample = () => crashSample;

    mockController.update = function () {
      if (!this.remote || !this.active) return;
      const s = this.room.session;
      const sample = s.track.sample(performance.now());
      this.remote.update(sample, s.remoteName, this.sim.camera);
      if (sample) {
        if (sample.crashed) {
          if (!this.remoteCrashed) {
            this.remoteCrashed = true;
            const remoteVel = Array.isArray(sample.v)
              ? { x: sample.v[0], y: sample.v[1], z: sample.v[2], length() { return Math.hypot(this.x, this.y, this.z); } }
              : { x: 0, y: 0, z: 0, length() { return 0; } };
            const speedKnots = remoteVel.length() * 1.94384;
            this.sim.explosionSystem?.spawnExplosion({
              point: this.remote.group.position,
              type: 'AIRCRAFT',
              speedKnots,
            }, remoteVel);
            this.sim.audio?.playExplosion(false);
          }
        } else {
          this.remoteCrashed = false;
        }
      }
    };

    mockController.update();
    assert.ok(explosionSpawned !== null, 'Explosion should spawn when remote plane crashes');
    assert.equal(explosionSpawned.crashResult.type, 'AIRCRAFT');
    assert.equal(explosionAudioPlayed, true, 'Explosion sound should play when remote plane crashes');

    // Second update should not duplicate explosion
    explosionSpawned = null;
    mockController.update();
    assert.equal(explosionSpawned, null, 'Should not re-spawn explosion on subsequent frames while crashed');
  });
});
