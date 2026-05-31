import { MathUtils, Vector3 } from 'three';
import { FpvSettings, ObserverState } from './types';
import { SatelliteObject } from '../interfaces/SatelliteObject';

const EARTH_RADIUS_KM = 6371;
const EARTH_MU_KM3_PER_SEC2 = 398600.4418;
const TWO_PI = Math.PI * 2;

export const DEFAULT_FPV_SETTINGS: FpvSettings = {
  enabled: false,
  mode: 'custom',
  altitudeKm: 420,
  inclinationDeg: 51.6,
  raanDeg: 0,
  timeScale: 1,
  rangeKm: 100,
};

export function scenePositionFromKm (positionKm: Vector3, kilometersPerSceneUnit: number): Vector3 {
  return new Vector3(
    positionKm.x / kilometersPerSceneUnit,
    positionKm.z / kilometersPerSceneUnit,
    positionKm.y / kilometersPerSceneUnit
  );
}

export function sceneVelocityFromKmSec (velocityKmSec: Vector3): Vector3 {
  return new Vector3(velocityKmSec.x, velocityKmSec.z, velocityKmSec.y);
}

export function computeCustomObserver (
  settings: FpvSettings,
  simulationTimeMs: number,
  kilometersPerSceneUnit: number
): ObserverState {
  const radiusKm = EARTH_RADIUS_KM + Math.max(settings.altitudeKm, 120);
  const meanMotionRadSec = Math.sqrt(EARTH_MU_KM3_PER_SEC2 / Math.pow(radiusKm, 3));
  const phase = ((simulationTimeMs / 1000) * meanMotionRadSec) % TWO_PI;
  const inclinationRad = MathUtils.degToRad(settings.inclinationDeg);
  const raanRad = MathUtils.degToRad(settings.raanDeg);
  const cosPhase = Math.cos(phase);
  const sinPhase = Math.sin(phase);
  const cosInclination = Math.cos(inclinationRad);
  const sinInclination = Math.sin(inclinationRad);
  const cosRaan = Math.cos(raanRad);
  const sinRaan = Math.sin(raanRad);
  const orbitalPositionX = radiusKm * cosPhase;
  const orbitalPositionY = radiusKm * sinPhase;
  const orbitalVelocityX = -radiusKm * meanMotionRadSec * sinPhase;
  const orbitalVelocityY = radiusKm * meanMotionRadSec * cosPhase;
  const positionKm = new Vector3(
    cosRaan * orbitalPositionX - sinRaan * cosInclination * orbitalPositionY,
    sinRaan * orbitalPositionX + cosRaan * cosInclination * orbitalPositionY,
    sinInclination * orbitalPositionY
  );
  const velocityKmSec = new Vector3(
    cosRaan * orbitalVelocityX - sinRaan * cosInclination * orbitalVelocityY,
    sinRaan * orbitalVelocityX + cosRaan * cosInclination * orbitalVelocityY,
    sinInclination * orbitalVelocityY
  );

  return createObserverState(
    'custom',
    'Custom LEO observer',
    scenePositionFromKm(positionKm, kilometersPerSceneUnit),
    sceneVelocityFromKmSec(velocityKmSec),
    undefined,
    undefined,
    kilometersPerSceneUnit
  );
}

export function findIssSatelliteIndex (satellites: SatelliteObject[]): number | undefined {
  const exactIndex = satellites.findIndex((satellite) => {
    const name = satellite.OBJECT_NAME.toUpperCase();
    return name === 'ISS (ZARYA)' || name === 'ISS';
  });

  if (exactIndex >= 0) {
    return exactIndex;
  }

  const fuzzyIndex = satellites.findIndex((satellite) => {
    const name = satellite.OBJECT_NAME.toUpperCase();
    return name.includes('ISS') || name.includes('ZARYA');
  });

  return fuzzyIndex >= 0 ? fuzzyIndex : undefined;
}

export function computeCatalogObserver (
  satellites: SatelliteObject[],
  positions: Float32Array,
  velocities: Float32Array,
  satelliteIndex: number,
  kilometersPerSceneUnit: number
): ObserverState | undefined {
  const offset = satelliteIndex * 3;
  const position = new Vector3(positions[offset], positions[offset + 1], positions[offset + 2]);
  const velocity = new Vector3(velocities[offset], velocities[offset + 1], velocities[offset + 2]);

  if (!Number.isFinite(position.x) || position.lengthSq() === 0) {
    return undefined;
  }

  return createObserverState(
    'iss',
    satellites[satelliteIndex]?.OBJECT_NAME || 'ISS ride-along',
    position,
    velocity,
    satelliteIndex,
    satellites[satelliteIndex],
    kilometersPerSceneUnit
  );
}

function createObserverState (
  mode: ObserverState['mode'],
  label: string,
  scenePosition: Vector3,
  sceneVelocityKmSec: Vector3,
  satelliteIndex: number | undefined,
  satellite: SatelliteObject | undefined,
  kilometersPerSceneUnit: number
): ObserverState {
  const radialUp = scenePosition.clone().normalize();
  const tangent = sceneVelocityKmSec.clone().sub(radialUp.clone().multiplyScalar(sceneVelocityKmSec.dot(radialUp)));

  if (tangent.lengthSq() < 0.000001) {
    tangent.copy(new Vector3(0, 1, 0).cross(radialUp));
  }

  if (tangent.lengthSq() < 0.000001) {
    tangent.copy(new Vector3(1, 0, 0).cross(radialUp));
  }

  tangent.normalize();

  const cameraForward = tangent.clone().multiplyScalar(0.985).add(radialUp.clone().multiplyScalar(0.17)).normalize();
  const cameraUp = radialUp.clone().sub(cameraForward.clone().multiplyScalar(radialUp.dot(cameraForward)));

  if (cameraUp.lengthSq() < 0.000001) {
    cameraUp.copy(radialUp);
  } else {
    cameraUp.normalize();
  }

  return {
    mode,
    label,
    satelliteIndex,
    satelliteObjectId: satellite?.OBJECT_ID,
    satelliteNoradCatId: satellite?.NORAD_CAT_ID,
    altitudeKm: Math.max(0, scenePosition.length() * kilometersPerSceneUnit - EARTH_RADIUS_KM),
    scenePosition,
    sceneVelocityKmSec,
    radialUp,
    cameraForward,
    cameraUp,
  };
}
