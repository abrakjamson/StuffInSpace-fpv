import { Vector3 } from 'three';

export type FpvObserverMode = 'custom' | 'iss';

export type FpvTimeScale = 1 | 10 | 100 | 1000;

export type FpvRangeKm = 'all' | 0.1 | 100;

export interface FpvSettings {
    enabled: boolean;
    mode: FpvObserverMode;
    altitudeKm: number;
    inclinationDeg: number;
    raanDeg: number;
    timeScale: FpvTimeScale;
    rangeKm: FpvRangeKm;
}

export interface ObserverState {
    mode: FpvObserverMode;
    label: string;
    satelliteIndex?: number;
    satelliteObjectId?: string;
    satelliteNoradCatId?: string;
    altitudeKm: number;
    scenePosition: Vector3;
    sceneVelocityKmSec: Vector3;
    radialUp: Vector3;
    cameraForward: Vector3;
    cameraUp: Vector3;
}

export interface ProximityMetrics {
    nearestObjectName: string;
    nearestObjectId: string | null;
    nearestDistanceKm: number | null;
    nearestRelativeVelocityKmSec: number | null;
    countWithin100m: number;
    countWithin1Km: number;
    countWithin10Km: number;
    countWithin100Km: number;
    nextPassObjectName: string;
    nextPassObjectId: string | null;
    nextPassSeconds: number | null;
    updatedAtSimulationMs: number;
}

export interface FpvRenderOptions {
    enabled: boolean;
    rangeKm: FpvRangeKm;
    observerPosition?: Vector3;
    excludedSatelliteIndex?: number;
    excludedSatelliteObjectId?: string;
    excludedSatelliteNoradCatId?: string;
}

export interface FpvStateSnapshot {
    settings: FpvSettings;
    observer: {
        label: string;
        altitudeKm: number;
        mode: FpvObserverMode;
        satelliteObjectId?: string;
        satelliteNoradCatId?: string;
    } | null;
    metrics: ProximityMetrics;
    look: {
        yawDeg: number;
        pitchDeg: number;
    };
}
