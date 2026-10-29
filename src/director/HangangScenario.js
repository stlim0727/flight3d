import { HangangScene } from '../environment/HangangScene.js';
import { HangangRun } from './HangangRun.js';
import { t } from '../i18n/index.js';

export class HangangScenario {
  constructor(sim) {
    this.sim = sim; this.scene = new HangangScene(); this.run = new HangangRun();
    sim.scene.add(this.scene.group);
  }
  get active() { return Boolean(this.saved); }
  start() {
    const s = this.sim;
    const objects = [s.terrain.mesh, s.airport.group, s.water.mesh, s.ships.group, s.foliage.group,
      s.luklaTerrain?.mesh, s.luklaAirport?.group, s.neonCity.group, s.incheonAirport?.group, s.incheonAirport?.terrain.mesh].filter(Boolean);
    const detector = s.collisionDetector;
    this.saved = { visibility: objects.map(o => [o, o.visible]), terrain: s.currentTerrain, airport: s.currentAirport,
      environment: [detector.terrain, detector.airport, detector.foliage, detector.ships, detector.water],
      time: s.sky.timeOfDay, wind: s.aero.windWorld.clone(), tower: s.cameraSystem.towerPos.clone() };
    objects.forEach(o => { o.visible = false; });
    this.scene.group.visible = true;
    s.currentTerrain = this.scene.terrain; s.currentAirport = this.scene.airport;
    detector.setEnvironment(s.currentTerrain, s.currentAirport);
    this.syncTerrain();
    s.cameraSystem.trauma = 0;
    s.cameraSystem.towerPos.set(80, 70, 80);
    s.setTimeOfDay(18.25); s.aero.windWorld.set(0, 0, 0);
    this.run.reset();
  }
  stop() {
    if (!this.saved) return;
    const s = this.sim, saved = this.saved; this.saved = null;
    for (const [object, visible] of saved.visibility) object.visible = visible;
    s.currentTerrain = saved.terrain; s.currentAirport = saved.airport;
    s.collisionDetector.setEnvironment(...saved.environment);
    s.aero.windWorld.copy(saved.wind); s.setTimeOfDay(saved.time);
    s.cameraSystem.towerPos.copy(saved.tower);
    this.scene.group.visible = false;

    // Reconcile active airport terrain and visibility so stale saved state never hides active scenery
    const active = s.activeAirport;
    if (active === 'incheon' && s.incheonAirport) {
      s.incheonAirport.group.visible = s.incheonAirport.terrain.mesh.visible = true;
      s.currentTerrain = s.incheonAirport.terrain;
      s.currentAirport = s.incheonAirport;
      s.collisionDetector.setEnvironment(s.currentTerrain, s.currentAirport);
    } else if (active === 'lukla' && s.luklaTerrain) {
      s.luklaTerrain.mesh.visible = s.luklaAirport.group.visible = true;
      s.currentTerrain = s.luklaTerrain;
      s.currentAirport = s.luklaAirport;
      s.collisionDetector.setEnvironment(s.luklaTerrain, s.luklaAirport, null, null, null);
    } else if (active === 'neon' && s.neonCity) {
      s.neonCity.group.visible = true;
      s.currentTerrain = s.neonCity.terrain;
      s.currentAirport = s.neonCity.airport;
      s.collisionDetector.setEnvironment(s.currentTerrain, s.currentAirport, s.neonCity);
    } else if (active === 'coastal') {
      s.terrain.mesh.visible = s.airport.group.visible = s.ships.group.visible = s.foliage.group.visible = true;
      s.currentTerrain = s.terrain;
      s.currentAirport = s.airport;
      s.collisionDetector.setEnvironment(s.terrain, s.currentAirport, s.foliage, s.ships, s.water);
    }
    this.syncTerrain();
  }
  syncTerrain() {
    const s = this.sim;
    s.cameraSystem?.setTerrain?.(s.currentTerrain);
    if (s.explosionSystem) s.explosionSystem.terrain = s.currentTerrain;
    if (s.tireSmokeSystem) s.tireSmokeSystem.terrain = s.currentTerrain;
  }
  update(dt) {
    if (!this.active) return;
    const s = this.sim;
    this.scene.update?.(dt);
    if (s.isCrashed) this.run.fail('contact');
    this.run.update(s.position, s.quaternion, s.linearVelocity, dt, { stalled: s.aero.isStalled });
    if (this.run.contact && !s.isCrashed) {
      s.triggerCrash({ collided: true, type: this.run.contact.structure === 'water' ? 'WATER' : 'BUILDING',
        name: t('hangang.contact'), description: t('hangang.contact'), point: s.position.clone(), speedKnots: s.linearVelocity.length() * 1.94384 });
    }
  }
}
