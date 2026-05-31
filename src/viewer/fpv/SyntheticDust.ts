import { Vector3 } from 'three';
import { FpvRangeKm } from './types';

export interface SyntheticDustSample {
  direction: Vector3;
  distanceKm: number;
  brightness: number;
}

const DUST_SAMPLE_COUNT = 2400;
const MIN_DUST_DISTANCE_KM = 0.02;
const MAX_DUST_DISTANCE_KM = 500;
let cachedDustSamples: SyntheticDustSample[] | undefined;

export function getSyntheticDustSamples (): SyntheticDustSample[] {
  if (cachedDustSamples) {
    return cachedDustSamples;
  }

  let seed = 0x51f15e;
  const samples: SyntheticDustSample[] = [];
  const logRange = Math.log(MAX_DUST_DISTANCE_KM / MIN_DUST_DISTANCE_KM);

  for (let i = 0; i < DUST_SAMPLE_COUNT; i += 1) {
    const z = seededRandom() * 2 - 1;
    const theta = seededRandom() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const distanceKm = MIN_DUST_DISTANCE_KM * Math.exp(seededRandom() * logRange);
    samples.push({
      direction: new Vector3(
        Math.cos(theta) * radial,
        Math.sin(theta) * radial,
        z
      ),
      distanceKm,
      brightness: 0.35 + seededRandom() * 0.65,
    });
  }

  cachedDustSamples = samples;
  return samples;

  function seededRandom (): number {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
}

export function getDustViewDistanceKm (rangeKm: FpvRangeKm): number {
  return rangeKm === 'all' ? MAX_DUST_DISTANCE_KM : rangeKm;
}

export function countSyntheticDustWithinRange (rangeKm: FpvRangeKm): number {
  const viewDistanceKm = getDustViewDistanceKm(rangeKm);
  return getSyntheticDustSamples().filter((sample) => sample.distanceKm <= viewDistanceKm).length;
}
