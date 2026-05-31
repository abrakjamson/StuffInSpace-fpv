import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SatelliteOrbitScene } from '../SatelliteOrbitScene';
import { SatelliteStore } from '../SatelliteStore';
import { Satellites } from '../Satellites';
import {
  computeCatalogObserver,
  computeCustomObserver,
  DEFAULT_FPV_SETTINGS,
  findIssSatelliteIndex,
} from './ObserverMath';
import { analyzeProximity, createEmptyProximityMetrics } from './ProximityAnalyzer';
import {
  FpvRangeKm,
  FpvRenderOptions,
  FpvSettings,
  FpvStateSnapshot,
  FpvTimeScale,
  ObserverState,
  ProximityMetrics,
} from './types';

declare global {
    interface Window {
        __stuffInSpaceFpv?: FpvStateSnapshot;
    }
}

interface FpvControllerContext {
    camera: PerspectiveCamera;
    controls: OrbitControls;
    scene: SatelliteOrbitScene;
    satelliteStore: SatelliteStore;
    satellites: Satellites;
    onTimeScaleChange: (timeScale: FpvTimeScale) => void;
    onStateChange: (state: FpvStateSnapshot) => void;
}

const ALLOWED_TIME_SCALES: FpvTimeScale[] = [1, 10, 100, 1000];
const ALLOWED_RANGES: FpvRangeKm[] = [0.1, 1, 10, 100];
const METRICS_INTERVAL_MS = 250;

export class FpvController {
  private settings: FpvSettings = { ...DEFAULT_FPV_SETTINGS };
  private context?: FpvControllerContext;
  private observer: ObserverState | null = null;
  private metrics: ProximityMetrics = createEmptyProximityMetrics();
  private lastMetricsWallTime = 0;
  private originalCameraFov?: number;
  private originalCameraNear?: number;
  private originalControlsEnabled?: boolean;
  private originalControlsAutoRotate?: boolean;
  private issSatelliteIndex?: number;
  private renderEnabled = false;

  init (context: FpvControllerContext): void {
    this.context = context;
    context.onTimeScaleChange(this.settings.timeScale);
    this.notifyStateChange();
  }

  update (): void {
    if (!this.context) {
      return;
    }

    if (!this.settings.enabled) {
      if (this.renderEnabled) {
        this.setRenderOptions({ enabled: false, rangeKm: this.settings.rangeKm });
        this.renderEnabled = false;
      }

      return;
    }

    const observer = this.resolveObserver();

    if (!observer) {
      this.observer = null;
      this.metrics = createEmptyProximityMetrics(this.context.satelliteStore.getSimulationTimeMs());
      this.notifyStateChange();
      return;
    }

    this.observer = observer;
    this.updateCamera(observer);
    this.setRenderOptions({
      enabled: true,
      rangeKm: this.settings.rangeKm,
      observerPosition: observer.scenePosition,
      excludedSatelliteIndex: observer.satelliteIndex,
      excludedSatelliteObjectId: observer.satelliteObjectId,
      excludedSatelliteNoradCatId: observer.satelliteNoradCatId,
    });
    this.renderEnabled = true;

    const now = performance.now();

    if (now - this.lastMetricsWallTime >= METRICS_INTERVAL_MS) {
      this.lastMetricsWallTime = now;
      this.metrics = analyzeProximity({
        satellites: this.context.satelliteStore.getSatData(),
        positions: this.context.satelliteStore.getSatPos(),
        velocities: this.context.satelliteStore.getSatVel(),
        observer,
        kilometersPerSceneUnit: this.context.scene.getPixels2Radius(),
        simulationTimeMs: this.context.satelliteStore.getSimulationTimeMs(),
        excludedSatelliteIndex: observer.satelliteIndex,
        excludedSatelliteObjectId: observer.satelliteObjectId,
        excludedSatelliteNoradCatId: observer.satelliteNoradCatId,
      });
      this.notifyStateChange();
    }
  }

  setEnabled (enabled: boolean): void {
    if (this.settings.enabled === enabled) {
      return;
    }

    this.settings.enabled = enabled;
    this.applyCameraMode();
    this.notifyStateChange();
  }

  setObserverMode (mode: string): void {
    if (mode !== 'custom' && mode !== 'iss') {
      return;
    }

    if (this.settings.mode === mode) {
      return;
    }

    this.settings.mode = mode;
    this.observer = null;
    this.notifyStateChange();
  }

  setCustomOrbit (updates: Partial<Pick<FpvSettings, 'altitudeKm' | 'inclinationDeg' | 'raanDeg'>>): void {
    this.settings.altitudeKm = clampFinite(updates.altitudeKm, this.settings.altitudeKm, 120, 2000);
    this.settings.inclinationDeg = clampFinite(updates.inclinationDeg, this.settings.inclinationDeg, 0, 180);
    this.settings.raanDeg = normalizeDegrees(clampFinite(updates.raanDeg, this.settings.raanDeg, -360, 360));
    this.notifyStateChange();
  }

  setTimeScale (timeScale: number): void {
    const nextTimeScale = ALLOWED_TIME_SCALES.includes(timeScale as FpvTimeScale) ? timeScale as FpvTimeScale : 1;

    if (this.settings.timeScale === nextTimeScale) {
      return;
    }

    this.settings.timeScale = nextTimeScale;
    this.context?.onTimeScaleChange(nextTimeScale);
    this.notifyStateChange();
  }

  setRangeKm (rangeKm: number): void {
    const nextRangeKm = ALLOWED_RANGES.includes(rangeKm as FpvRangeKm) ? rangeKm as FpvRangeKm : 100;

    if (this.settings.rangeKm === nextRangeKm) {
      return;
    }

    this.settings.rangeKm = nextRangeKm;
    this.notifyStateChange();
  }

  getSettings (): FpvSettings {
    return { ...this.settings };
  }

  getSnapshot (): FpvStateSnapshot {
    return {
      settings: this.getSettings(),
      observer: this.observer
        ? {
          label: this.observer.label,
          altitudeKm: this.observer.altitudeKm,
          mode: this.observer.mode,
          satelliteObjectId: this.observer.satelliteObjectId,
          satelliteNoradCatId: this.observer.satelliteNoradCatId,
        }
        : null,
      metrics: { ...this.metrics },
    };
  }

  private applyCameraMode (): void {
    if (!this.context) {
      return;
    }

    if (this.settings.enabled) {
      this.originalCameraFov = this.context.camera.fov;
      this.originalCameraNear = this.context.camera.near;
      this.originalControlsEnabled = this.context.controls.enabled;
      this.originalControlsAutoRotate = this.context.controls.autoRotate;
      this.context.controls.enabled = false;
      this.context.controls.autoRotate = false;
      this.context.camera.fov = 70;
      this.context.camera.near = 0.0001;
      this.context.camera.updateProjectionMatrix();
      return;
    }

    if (this.originalCameraFov !== undefined) {
      this.context.camera.fov = this.originalCameraFov;
    }

    if (this.originalCameraNear !== undefined) {
      this.context.camera.near = this.originalCameraNear;
    }

    if (this.originalControlsEnabled !== undefined) {
      this.context.controls.enabled = this.originalControlsEnabled;
    }

    if (this.originalControlsAutoRotate !== undefined) {
      this.context.controls.autoRotate = this.originalControlsAutoRotate;
    }

    this.context.camera.updateProjectionMatrix();
    this.setRenderOptions({ enabled: false, rangeKm: this.settings.rangeKm });
    this.renderEnabled = false;
  }

  private resolveObserver (): ObserverState | undefined {
    if (!this.context) {
      return undefined;
    }

    const kilometersPerSceneUnit = this.context.scene.getPixels2Radius();

    if (this.settings.mode === 'custom') {
      return computeCustomObserver(
        this.settings,
        this.context.satelliteStore.getSimulationTimeMs(),
        kilometersPerSceneUnit
      );
    }

    if (this.issSatelliteIndex === undefined) {
      this.issSatelliteIndex = findIssSatelliteIndex(this.context.satelliteStore.getSatData());
    }

    if (this.issSatelliteIndex === undefined) {
      return undefined;
    }

    return computeCatalogObserver(
      this.context.satelliteStore.getSatData(),
      this.context.satelliteStore.getSatPos(),
      this.context.satelliteStore.getSatVel(),
      this.issSatelliteIndex,
      kilometersPerSceneUnit
    );
  }

  private updateCamera (observer: ObserverState): void {
    if (!this.context) {
      return;
    }

    const target = new Vector3().copy(observer.scenePosition).add(observer.cameraForward);
    this.context.camera.position.copy(observer.scenePosition);
    this.context.camera.up.copy(observer.cameraUp);
    this.context.camera.lookAt(target);
  }

  private setRenderOptions (options: FpvRenderOptions): void {
    this.context?.satellites.setFpvRenderOptions(options);
  }

  private notifyStateChange (): void {
    const snapshot = this.getSnapshot();
    window.__stuffInSpaceFpv = snapshot;
    this.context?.onStateChange(snapshot);
  }
}

function clampFinite (value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees (value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
