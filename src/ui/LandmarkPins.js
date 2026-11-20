import { Vector3 } from 'three';
import { landmarksForMap } from '../config/landmarks.js';
import { getLanguage } from '../i18n/index.js';

const maxRange = 45000;
const minRange = 200;
const maxPins = 5;

export class LandmarkPins {
  constructor(container) {
    this.container = container;
    this.pins = Array.from({ length: maxPins }, () => {
      const element = document.createElement('span');
      element.className = 'landmark-pin';
      element.hidden = true;
      container.append(element);
      return element;
    });
    this.position = new Vector3();
    this.clip = new Vector3();
  }

  update(sim, visible) {
    this.container.hidden = !visible;
    if (!visible) return;
    if (sim.activeAirport !== this.map || sim.currentTerrain !== this.terrain || sim.currentAirport !== this.airport) {
      this.map = sim.activeAirport;
      this.terrain = sim.currentTerrain;
      this.airport = sim.currentAirport;
      this.records = landmarksForMap(this.map, this.terrain, this.airport);
    }
    const { camera } = sim;
    camera.updateMatrixWorld();
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const locale = getLanguage();
    const candidates = [];
    for (const record of this.records) {
      this.position.set(record.x, record.height + 12, record.z);
      const distance = camera.position.distanceTo(this.position);
      if (distance < minRange || distance > maxRange) continue;
      this.clip.copy(this.position).project(camera);
      if (this.clip.z < -1 || this.clip.z > 1 || Math.abs(this.clip.x) > 0.8 || Math.abs(this.clip.y) > 0.68) continue;
      candidates.push({ distance, name: record[locale] ?? record.en,
        x: (this.clip.x + 1) * width / 2, y: (1 - this.clip.y) * height / 2 });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const placed = [];
    for (const candidate of candidates) {
      if (placed.length >= (width < 650 ? 3 : maxPins)) break;
      if (placed.some(other => Math.abs(other.x - candidate.x) < 146 && Math.abs(other.y - candidate.y) < 42)) continue;
      placed.push(candidate);
    }
    for (const [i, pin] of this.pins.entries()) {
      const next = placed[i];
      pin.hidden = !next;
      if (!next) continue;
      pin.style.left = `${next.x}px`;
      pin.style.top = `${next.y}px`;
      pin.textContent = `${next.name} · ${(next.distance / 1000).toFixed(1)} km`;
    }
  }
}
