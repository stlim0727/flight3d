import { Vector3 } from 'three';
import {
  LANDMARK_LABEL_OFFSET_M,
  landmarkName,
  landmarksForMap,
  nearestLandmarks,
  resolveLandmarkHeight,
} from '../config/landmarks.js';
import { dedupeLandmarks } from '../geospatial/overtureLandmarks.js';
import { landmarkPinIcon } from './landmarkPinIcons.js';
import { getLanguage } from '../i18n/index.js';

const minRange = 200;
const maxPins = 5;

/** Screen-space pin markers for discovered and cataloged named places, ranked by prominence. */
export class LandmarkPins {
  constructor(container, places, kinds) {
    this.container = container;
    this.places = places;
    this.kinds = kinds;
    this.pins = Array.from({ length: maxPins }, () => {
      const element = document.createElement('span');
      element.className = 'landmark-pin';
      element.hidden = true;
      const label = document.createElement('span');
      label.className = 'landmark-pin__label';
      const marker = document.createElement('span');
      marker.className = 'landmark-pin__marker';
      const icon = document.createElement('span');
      icon.className = 'landmark-pin__icon';
      marker.append(icon);
      element.append(label, marker);
      container.append(element);
      return { element, label, icon, lastLabel: '', lastIcon: '' };
    });
    this.position = new Vector3();
    this.clip = new Vector3();
  }

  update(sim, visible) {
    this.container.hidden = !visible;
    if (!visible) return;
    const streamLayer = this.places === undefined ? sim.geographicLandmarkLayer : null;
    const streamVersion = streamLayer?.version ?? 0;
    if (!this.loaded || sim.activeAirport !== this.map || sim.currentTerrain !== this.terrain
      || sim.currentAirport !== this.airport || this.places !== this.loadedPlaces
      || streamLayer !== this.streamLayer || streamVersion !== this.streamVersion) {
      this.map = sim.activeAirport;
      this.terrain = sim.currentTerrain;
      this.airport = sim.currentAirport;
      this.loadedPlaces = this.places;
      this.streamLayer = streamLayer;
      this.streamVersion = streamVersion;
      const baseRecords = landmarksForMap(this.map, this.terrain, this.airport, this.places);
      const streamedRecords = streamLayer?.records;
      this.records = streamedRecords?.length
        ? dedupeLandmarks([...baseRecords, ...streamedRecords])
        : baseRecords;
      this.loaded = true;
    }
    const { camera } = sim;
    camera.updateMatrixWorld();
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const locale = getLanguage();
    const candidates = nearestLandmarks(this.records, camera.position, {
      limit: Infinity,
      kinds: this.kinds,
      terrain: this.terrain,
    });
    const projected = [];
    for (const { record, distance } of candidates) {
      if (distance < minRange) continue;
      this.position.set(record.x, resolveLandmarkHeight(record, this.terrain) + LANDMARK_LABEL_OFFSET_M, record.z);
      this.clip.copy(this.position).project(camera);
      if (this.clip.z < -1 || this.clip.z > 1 || Math.abs(this.clip.x) > 0.8 || Math.abs(this.clip.y) > 0.68) continue;
      projected.push({ distance, name: landmarkName(record, locale), icon: landmarkPinIcon(record),
        x: (this.clip.x + 1) * width / 2, y: (1 - this.clip.y) * height / 2 });
    }
    const placed = [];
    for (const candidate of projected) {
      if (placed.length >= (width < 650 ? 3 : maxPins)) break;
      if (placed.some(other => Math.abs(other.x - candidate.x) < 146 && Math.abs(other.y - candidate.y) < 42)) continue;
      placed.push(candidate);
    }
    for (const [i, pin] of this.pins.entries()) {
      const next = placed[i];
      pin.element.hidden = !next;
      if (!next) continue;
      pin.element.style.left = `${next.x}px`;
      pin.element.style.top = `${next.y}px`;
      const nextLabel = `${next.name} · ${(next.distance / 1000).toFixed(1)} km`;
      if (pin.lastLabel !== nextLabel) {
        pin.label.textContent = nextLabel;
        pin.lastLabel = nextLabel;
      }
      if (pin.lastIcon !== next.icon) {
        pin.icon.innerHTML = next.icon;
        pin.lastIcon = next.icon;
      }
    }
  }
}
