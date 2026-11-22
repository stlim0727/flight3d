import { PMTiles } from 'pmtiles';

export const overtureBase = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/base.pmtiles',
);

export function isWaterPolygon(feature) {
  return feature.type === 3 && !feature.properties.is_intermittent
    && feature.properties.class !== 'swimming_pool';
}
