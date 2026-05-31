import { Vector3 } from 'three';
import { SatelliteObject } from '../interfaces/SatelliteObject';
import { ObserverState, ProximityMetrics } from './types';

interface AnalyzeProximityOptions {
    satellites: SatelliteObject[];
    positions: Float32Array;
    velocities: Float32Array;
    observer: ObserverState;
    kilometersPerSceneUnit: number;
    simulationTimeMs: number;
    excludedSatelliteIndex?: number;
    excludedSatelliteObjectId?: string;
    excludedSatelliteNoradCatId?: string;
}

const ONE_KM_PASS_THRESHOLD = 1;
const PASS_LOOKAHEAD_SECONDS = 24 * 60 * 60;

export function createEmptyProximityMetrics (simulationTimeMs = Date.now()): ProximityMetrics {
  return {
    nearestObjectName: 'None',
    nearestObjectId: null,
    nearestDistanceKm: null,
    nearestRelativeVelocityKmSec: null,
    countWithin100m: 0,
    countWithin1Km: 0,
    countWithin10Km: 0,
    countWithin100Km: 0,
    nextPassObjectName: 'None predicted',
    nextPassObjectId: null,
    nextPassSeconds: null,
    updatedAtSimulationMs: simulationTimeMs,
  };
}

export function analyzeProximity (options: AnalyzeProximityOptions): ProximityMetrics {
  const metrics = createEmptyProximityMetrics(options.simulationTimeMs);
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nextPassSeconds = Number.POSITIVE_INFINITY;
  const relativePositionKm = new Vector3();
  const relativeVelocityKmSec = new Vector3();

  for (let i = 0; i < options.satellites.length; i += 1) {
    if (isExcludedSatellite(options, i)) {
      continue;
    }

    const offset = i * 3;
    const satellitePosition = new Vector3(
      options.positions[offset],
      options.positions[offset + 1],
      options.positions[offset + 2]
    );

    if (!Number.isFinite(satellitePosition.x) || satellitePosition.lengthSq() === 0) {
      continue;
    }

    function isExcludedSatellite (options: AnalyzeProximityOptions, satelliteIndex: number): boolean {
      if (satelliteIndex === options.excludedSatelliteIndex) {
        return true;
      }

      const satellite = options.satellites[satelliteIndex];

      if (!satellite) {
        return false;
      }

      if (options.excludedSatelliteObjectId && satellite.OBJECT_ID === options.excludedSatelliteObjectId) {
        return true;
      }

      return Boolean(options.excludedSatelliteNoradCatId && satellite.NORAD_CAT_ID === options.excludedSatelliteNoradCatId);
    }

    relativePositionKm.copy(satellitePosition).sub(options.observer.scenePosition).multiplyScalar(options.kilometersPerSceneUnit);
    const distanceKm = relativePositionKm.length();

    if (distanceKm <= 0.1) {
      metrics.countWithin100m += 1;
    }

    if (distanceKm <= 1) {
      metrics.countWithin1Km += 1;
    }

    if (distanceKm <= 10) {
      metrics.countWithin10Km += 1;
    }

    if (distanceKm <= 100) {
      metrics.countWithin100Km += 1;
    }

    relativeVelocityKmSec.set(
      options.velocities[offset] - options.observer.sceneVelocityKmSec.x,
      options.velocities[offset + 1] - options.observer.sceneVelocityKmSec.y,
      options.velocities[offset + 2] - options.observer.sceneVelocityKmSec.z
    );

    if (distanceKm < nearestDistance) {
      nearestDistance = distanceKm;
      metrics.nearestObjectName = options.satellites[i]?.OBJECT_NAME || `Object ${i}`;
      metrics.nearestObjectId = options.satellites[i]?.OBJECT_ID || null;
      metrics.nearestDistanceKm = distanceKm;
      metrics.nearestRelativeVelocityKmSec = relativeVelocityKmSec.length();
    }

    const passSeconds = solveLinearThresholdCrossingSeconds(
      relativePositionKm,
      relativeVelocityKmSec,
      ONE_KM_PASS_THRESHOLD
    );

    if (passSeconds !== null && passSeconds < nextPassSeconds && passSeconds <= PASS_LOOKAHEAD_SECONDS) {
      nextPassSeconds = passSeconds;
      metrics.nextPassObjectName = options.satellites[i]?.OBJECT_NAME || `Object ${i}`;
      metrics.nextPassObjectId = options.satellites[i]?.OBJECT_ID || null;
      metrics.nextPassSeconds = passSeconds;
    }
  }

  return metrics;
}

function solveLinearThresholdCrossingSeconds (
  relativePositionKm: Vector3,
  relativeVelocityKmSec: Vector3,
  thresholdKm: number
): number | null {
  const c = relativePositionKm.lengthSq() - thresholdKm * thresholdKm;

  if (c <= 0) {
    return 0;
  }

  const a = relativeVelocityKmSec.lengthSq();

  if (a < 0.0000001) {
    return null;
  }

  const b = 2 * relativePositionKm.dot(relativeVelocityKmSec);
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    return null;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const firstRoot = (-b - sqrtDiscriminant) / (2 * a);
  const secondRoot = (-b + sqrtDiscriminant) / (2 * a);
  const roots = [firstRoot, secondRoot].filter((root) => root >= 0);

  return roots.length > 0 ? Math.min(...roots) : null;
}
