import SatelliteGroup from '@satellite-viewer/SatelliteGroup';
import {
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  TextureLoader,
  Color,
  ShaderMaterial,
  Object3D,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  CustomBlending,
} from 'three';
import SceneComponent from './interfaces/SceneComponent';
import SatelliteStore from './SatelliteStore';
import SatCruncherWorker from './workers/SatCruncherWorker?worker';
import logger from '../utils/logger';
import SatelliteOrbitScene from './SatelliteOrbitScene';
import ColorScheme from './color-schemes/ColorScheme';
import DefaultColorScheme from './color-schemes/DefaultColorScheme';
import SelectableSatellite from './interfaces/SelectableSatellite';
import ShaderStore from './ShaderStore';
import GroupColorScheme from './color-schemes/GroupColorScheme';
import { SatelliteObject } from './interfaces/SatelliteObject';
import { ViewerContext } from './interfaces/ViewerContext';
import { FpvRenderOptions } from './fpv/types';

class Satellites implements SceneComponent, SelectableSatellite {
  baseUrl = '';
  worker?: Worker;
  currentColorScheme?: ColorScheme = new DefaultColorScheme();
  numSats: number = 1;
  maxSize = 0;
  satPos: Float32Array = new Float32Array();
  satVel: Float32Array = new Float32Array();
  satAlt: Float32Array = new Float32Array();
  satelliteColors: number[] = [];
  cruncherReady = false;
  scene?: SatelliteOrbitScene;
  particles?: Points;
  geometry?: BufferGeometry;
  satelliteStore?: SatelliteStore;
  shaderStore?: ShaderStore;
  selectedSatelliteIndexes: number[] = [];
  satelliteGroup?: SatelliteGroup;
  hoverSatelliteIdx = -1;
  fpvRenderOptions: FpvRenderOptions = {
    enabled: false,
    rangeKm: 'all'
  };

  setColorScheme (colorScheme: ColorScheme) {
    this.currentColorScheme = colorScheme;
  }

  debugRaycastSelection () {
    if (!this.satelliteStore) {
      return;
    }

    if (this.satelliteColors.length === 0 && this.satelliteStore.satData.length > 0) {
      this.satelliteColors = new Array(this.satelliteStore.satData.length * 4);
      this.satelliteColors.fill(1, 0, this.satelliteColors.length);
      if (this.geometry) {
        this.geometry.setAttribute('color', new Float32BufferAttribute(this.satelliteColors as any, 4 ) );
      }
    }

    if (this.selectedSatelliteIndexes.length  > 0 && this.geometry) {
      for (let i = 0; i < this.selectedSatelliteIndexes.length; i++) {
        const idx = this.selectedSatelliteIndexes[i] * 4;
        this.satelliteColors[idx] = 0;
        this.satelliteColors[idx + 1] = 1;
        this.satelliteColors[idx + 2] = 0;
        this.satelliteColors[idx + 3] = 1;
      }

      this.geometry.setAttribute('color', new Float32BufferAttribute(this.satelliteColors as any, 4 ) );
    }
  }

  updateSatellites () {
    if (!this.satelliteStore) {
      return;
    }

    if (this.satPos && this.satPos.length > 0) {
      if (this.geometry?.attributes) {

        const satellites = this.satelliteStore.satData;
        const satCount = satellites.length;

        this.updateSatellitesGeometry();
        this.updateSatellitesMaterial(satCount, satellites);
      }
    }

    this.debugRaycastSelection();
  }

  /**
   * update point colours
   */
  private updateSatellitesMaterial (satCount: number, satellites: SatelliteObject[]) {
    if (this.geometry?.attributes.color && this.currentColorScheme && this.satelliteStore) {
      // Adjust if the satellite count adjusts
      if (this.satelliteColors.length === 0 || (satCount * 4 !== this.satelliteColors.length)) {
        this.satelliteColors = new Array(this.satelliteStore.satData.length * 4);
        this.satelliteColors.fill(1, 0, this.satelliteColors.length);
      }

      for (let i = 0; i < satellites.length; i++) {
        let color = this.currentColorScheme?.getSatelliteColor(satellites[i], this.satelliteGroup)?.color; // || [0, 0, 0];
        if (!color) {
          color = [0, 0, 0];
        }

        if (this.fpvRenderOptions.enabled) {
          color = this.getFpvSatelliteColor(i);
        }

        const idx = i * 4;
        this.satelliteColors[idx] = color[0];
        this.satelliteColors[idx + 1] = color[1];
        this.satelliteColors[idx + 2] = color[2];
        this.satelliteColors[idx + 3] = color[3];
      }
      this.geometry.setAttribute('color', new Float32BufferAttribute(this.satelliteColors, 4));
    }
  }

  private getFpvSatelliteColor (satIdx: number): number[] {
    if (!this.scene || !this.fpvRenderOptions.observerPosition || this.isExcludedFpvSatellite(satIdx)) {
      return [0, 0, 0, 0];
    }

    const offset = satIdx * 3;
    const satelliteX = this.satPos[offset];
    const satelliteY = this.satPos[offset + 1];
    const satelliteZ = this.satPos[offset + 2];

    if (!Number.isFinite(satelliteX)) {
      return [0, 0, 0, 0];
    }

    const dx = satelliteX - this.fpvRenderOptions.observerPosition.x;
    const dy = satelliteY - this.fpvRenderOptions.observerPosition.y;
    const dz = satelliteZ - this.fpvRenderOptions.observerPosition.z;
    const distanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.scene.getPixels2Radius();

    if (this.fpvRenderOptions.rangeKm !== 'all' && distanceKm > this.fpvRenderOptions.rangeKm) {
      return [0, 0, 0, 0];
    }

    const normalizedDistance = this.fpvRenderOptions.rangeKm === 'all'
      ? Math.min(1, Math.log10(distanceKm + 1) / Math.log10(50000))
      : Math.min(1, distanceKm / Math.max(this.fpvRenderOptions.rangeKm, 0.1));
    const brightness = Math.max(0.3, 1 - Math.sqrt(normalizedDistance) * 0.7);
    const alpha = Math.max(this.fpvRenderOptions.rangeKm === 'all' ? 0.14 : 0.08, 1 - normalizedDistance * 0.86);

    return [brightness, brightness, brightness, alpha];
  }

  private isExcludedFpvSatellite (satIdx: number): boolean {
    if (satIdx === this.fpvRenderOptions.excludedSatelliteIndex) {
      return true;
    }

    const satellite = this.satelliteStore?.getSatellite(satIdx);

    if (!satellite) {
      return false;
    }

    if (this.fpvRenderOptions.excludedSatelliteObjectId && satellite.OBJECT_ID === this.fpvRenderOptions.excludedSatelliteObjectId) {
      return true;
    }

    return Boolean(
      this.fpvRenderOptions.excludedSatelliteNoradCatId
      && satellite.NORAD_CAT_ID === this.fpvRenderOptions.excludedSatelliteNoradCatId
    );
  }

  /**
   * Updates the satellites positions in the geometry.
   */
  private updateSatellitesGeometry () {
    if (this.geometry?.attributes.position && this.satelliteStore) {
      const vertices: Float32Array = new Float32Array();
      vertices.fill(0, 0, this.satelliteStore.satData.length * 3);
      this.geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

      // deal with NaN
      for (let i = 0; i < this.satPos.length; i++) {
        if (isNaN(this.satPos[i])) {
          this.satPos[i] = 0;
        }
      }

      this.geometry.setAttribute('position', new Float32BufferAttribute(this.satPos, 3));

      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    }
  }

  onMessage (message: any) {
    if (!this.satelliteStore) {
      return;
    }

    const satData = this.satelliteStore.getSatData();
    if (!satData) {
      return;
    }

    const satCount = satData.length;
    let satExtraData: Record<string, any>[];

    try {
      if (!this.satelliteStore.gotExtraData) { // store extra data that comes from crunching
        const start = performance.now();

        if (message.data.extraData) {
          satExtraData = JSON.parse(message.data.extraData);

          if (!satExtraData) {
            return;
          }

          for (let i = 0; i < satCount; i++) {
            satData[i].inclination = satExtraData[i].inclination;
            satData[i].eccentricity = satExtraData[i].eccentricity;
            satData[i].raan = satExtraData[i].raan;
            satData[i].argPe = satExtraData[i].argPe;
            satData[i].meanMotion = satExtraData[i].meanMotion;

            satData[i].semiMajorAxis = satExtraData[i].semiMajorAxis;
            satData[i].semiMinorAxis = satExtraData[i].semiMinorAxis;
            satData[i].apogee = satExtraData[i].apogee;
            satData[i].perigee = satExtraData[i].perigee;
            satData[i].period = satExtraData[i].period;
          }

          logger.debug(`sat.js copied extra data in ${performance.now() - start} ms`);
          this.satelliteStore.setSatelliteData(satData, true);
          return;
        }
      }

      this.satPos = new Float32Array(message.data.satPos);
      this.satVel = new Float32Array(message.data.satVel);
      this.satAlt = new Float32Array(message.data.satAlt);

      this.satelliteStore.setPositionalData(
        this.satVel, this.satPos, this.satAlt, message.data.simulationTimeMs
      );

      if (!this.cruncherReady) {
        document.querySelector('#load-cover')?.classList.add('hidden');
        this.cruncherReady = true;
      }
      this.updateSatellites();
    } catch (error) {
      logger.debug('Error in worker response', error);
      logger.debug('worker message', message);
    }
  }

  onSatDataLoaded () {
    if (!this.satelliteStore) {
      return;
    }

    if (this.worker) {
      const satDataString = JSON.stringify(this.satelliteStore.satData);

      logger.debug('Sending data to sat cruncher worker, to perform work');
      this.worker.postMessage(satDataString);
    } else {
      logger.error('worker is not available');
    }
  }

  setSatelliteGroup (satelliteGroup?: SatelliteGroup) {
    this.satelliteGroup = satelliteGroup;
    if (this.satelliteGroup) {
      this.currentColorScheme = new GroupColorScheme();
    } else {
      this.currentColorScheme = new DefaultColorScheme();
    }
  }

  setTimeScale (timeScale: number) {
    this.worker?.postMessage(JSON.stringify({
      state: {
        timeScale
      }
    }));
  }

  setFpvRenderOptions (options: FpvRenderOptions) {
    this.fpvRenderOptions = options;
    this.updateSatellitesMaterial(this.satelliteStore?.size() || 0, this.satelliteStore?.getSatData() || []);
  }

  getSatellitegroup (): SatelliteGroup | undefined {
    return this.satelliteGroup;
  }

  setSelectedSatellites (satelliteIndexes: number[]) {
    logger.debug('Updated selected satellites', satelliteIndexes);
    this.selectedSatelliteIndexes = satelliteIndexes;
    this.updateSatellites();
  }

  setSelectedSatellite (satelliteIdx: number) {
    this.setSelectedSatellites([satelliteIdx]);
  }

  setHoverSatellite (satelliteIdx: number) {
    this.hoverSatelliteIdx = satelliteIdx;
    this.updateSatellites();
  }

  private initGeometry () {
    if (!this.satelliteStore) {
      throw new Error('satelliteStore is not available');
    }

    if (!this.shaderStore) {
      throw new Error('sahderStore is not available');
    }

    const satDataLen = (this.satelliteStore.satData || []).length;
    const geometry = new BufferGeometry();
    const vertices: Float32Array = new Float32Array();
    const sizes: Float32Array = new Float32Array();
    const colors: number[] = new Array(satDataLen * 4);

    vertices.fill(0, 0, satDataLen * 3);
    colors.fill(0, 0, satDataLen * 3);
    sizes.fill(10, 0, satDataLen);

    geometry.setAttribute('position', new Float32BufferAttribute( vertices, 3 ) );
    geometry.setAttribute('color', new Float32BufferAttribute( colors, 4 ) );
    geometry.setAttribute('size', new Float32BufferAttribute( sizes, 2 ) );

    const texture = new TextureLoader().load(`${this.baseUrl}/images/circle.png`);
    const shader = this.shaderStore.getShader('dot2');

    // const material = new PointsMaterial ({
    //   color: 'grey',
    //   size: 4,
    //   sizeAttenuation: false,
    //   vertexColors: true,
    //   blending: AdditiveBlending,
    //   transparent: false,
    //   depthTest: true
    // });

    const material = new ShaderMaterial({
      uniforms: {
        color: { value: new Color( 0xffffff ) },
        pointTexture: { value: texture }
      },
      clipping: false,
      vertexShader: shader.vertex,
      fragmentShader: shader.fragment,
      blending: CustomBlending,
      blendSrcAlpha: SrcAlphaFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      transparent: true,
      alphaTest: 0.02,
      depthTest: true,
      depthWrite: false,
    });

    geometry.center();

    this.geometry = geometry;
    this.particles = new Points( geometry, material );

    if (this.scene) {
      this.scene.add( this.particles );
    }

    // reduce CPU load by stopping the runner if the tab/window
    // is not visisble
    window.addEventListener('visibilitychange', () => {
      this.worker?.postMessage(JSON.stringify({
        state: {
          running: document.visibilityState === 'visible'
        }
      }));
    });
  }

  getObject3D (): Object3D | undefined {
    return this.particles;
  }

  initSatWorker (config: Record<string, any> = {}) {
    logger.info('Kicking off sat-cruncher-worker');
    this.worker = new SatCruncherWorker();
    this.worker.onmessage = this.onMessage.bind(this);
    this.worker.postMessage(JSON.stringify({
      config
    }));
  }

  async init (scene: SatelliteOrbitScene, context: ViewerContext) {
    this.satelliteStore = context.satelliteStore;
    this.shaderStore = context.shaderStore;
    this.scene = scene;

    const config = context.config || {};
    let satWorkerConfig: Record<string, any> = {};
    if (config.satWorker) {
      satWorkerConfig = { ...config.satWorker, logLevel: config.logLevel };
    }

    this.initSatWorker(satWorkerConfig);

    if (context?.config) {
      this.baseUrl = context.config.baseUrl;
    }

    if (!this.satelliteStore) {
      return;
    }

    this.satelliteStore.addEventListener('satdataloaded', this.onSatDataLoaded.bind(this));
    await this.satelliteStore.loadSatelliteData();

    this.initGeometry();

    if (this.satelliteStore.gotExtraData) {
      this.updateSatellites();
    }
  }

  update (): void {
    // do nothing for now
  }
}

export default Satellites;