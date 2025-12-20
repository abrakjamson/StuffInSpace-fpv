import axios from 'axios';
import EventManager from '../utils/event-manager';
import logger from '../utils/logger';
import { SatelliteObject } from './interfaces/SatelliteObject';
import { ensureJsDate } from '@/utils/dateUtils';
import { DateTime } from 'luxon';

type TLE = Partial<SatelliteObject>;

type AttributedTLE = {
  source: {
    name: string;
    url: string;
  }
  date: string | Date;
  data: TLE[];
};

type CacheData = {
  data: AttributedTLE,
  storageTime: Date
};

type SatelliteStoreConfig = {
  useCache: boolean;
  cacheTTL: number;
  baseUrl: string;
}

const config: SatelliteStoreConfig = {
  useCache: true,
  cacheTTL: 24 * 60 * 60,
  baseUrl: import.meta.env.BASE_URL
};

class SatelliteStore {
  databaseName = 'stuff-in-space';
  storageKey = 'satellite.data';
  databaseVersion = 2;
  tleUrl = `${config.baseUrl}/data/-TLE.json`;
  eventManager: EventManager;
  satData: SatelliteObject[] = [];
  attribution?: {
    name: string;
    url: string;
  };
  updateDate?: Date;
  satelliteVelocities: Float32Array = new Float32Array();
  satellitePositions: Float32Array = new Float32Array();
  satelliteAltitudes: Float32Array = new Float32Array();
  gotExtraData = false;
  gotPositionalData = false;
  loaded = false;

  constructor (options: Record<string, any> = {}) {
    this.eventManager = new EventManager();
    if (options.tleUrl) {
      this.tleUrl = options.tleUrl;
    }
  }

  async setupDatabase () {
    if (!window.indexedDB) {
      return;
    }

    const storeNames = ['configs', 'tles'];

    const dbRequest = window.indexedDB.open(this.databaseName, this.databaseVersion);

    return new Promise<IDBDatabase | undefined>((resolve, reject) => {
      dbRequest.addEventListener('upgradeneeded', () => {
        const database = dbRequest.result;
        storeNames.forEach(storeName => {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName);
          }
        });
      });
      dbRequest.addEventListener('success', () => {
        const database = dbRequest.result;
        resolve(database);
      });

      dbRequest.addEventListener('error', (error) => {
        reject(error);
      });
    });
  }

  async getObjectStore (storeName: string) {
    if (!window.indexedDB) {
      return;
    }

    const database = await this.setupDatabase();

    if (database) {
      try {
        const transaction = database.transaction(storeName, 'readwrite');
        return transaction.objectStore(storeName);
      } catch (error) {
        console.error(`Error while fetching ${storeName}`, error);
      }
    }
  }

  async loadFromStorage () {
    if (!window.indexedDB) {
      return;
    }

    let attributedTle: AttributedTLE | undefined;
    let tleList: TLE[] | undefined;
    let tleAge: Record<string, unknown> | undefined;

    const configStore = await this.getObjectStore('configs');
    const dbRequest = configStore?.get('attributedTle');
    if (dbRequest) {
      attributedTle = await new Promise<AttributedTLE | undefined>((resolve, reject) => {
        dbRequest.onerror = reject;
        dbRequest.onsuccess = () => {
          resolve(dbRequest.result);
        };
      });
    }

    const dbRequest2 = configStore?.get('tleAge');
    if (dbRequest2) {
      tleAge = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        dbRequest2.onerror = reject;
        dbRequest2.onsuccess = () => {
          resolve(dbRequest2.result);
        };
      });
    }

    const tleStore = await this.getObjectStore('tles');
    const tleDBRequest = tleStore?.getAll();
    if (tleDBRequest) {
      tleList = await new Promise<Record<string, unknown>[] | undefined>((resolve, reject) => {
        tleDBRequest.onerror = reject;
        tleDBRequest.onsuccess = () => {
          resolve(tleDBRequest.result);
        };
      });
    }

    if (attributedTle) {
      return {
        storageTime: tleAge?.loadedTime as Date,
        data: {
          ...attributedTle,
          data: tleList
        }
      } as CacheData;
    }

    return undefined;
  }

  async saveToStorage (attributedTle: AttributedTLE) {
    if (!window.indexedDB) {
      return;
    }

    const configStore = await this.getObjectStore('configs');
    if (configStore) {
      let dbRequest = configStore.put({
        source: attributedTle.source,
        date: attributedTle.date,
        data: []
      } as AttributedTLE, 'attributedTle');

      if (dbRequest) {
        await new Promise((resolve, reject) => {
          dbRequest.onerror = reject;
          dbRequest.onsuccess = () => {
            resolve(dbRequest.result);
          };
        });
      }

      dbRequest = configStore.put({
        loadedTime: new Date()
      } , 'tleAge');

      if (dbRequest) {
        await new Promise((resolve, reject) => {
          dbRequest.onerror = reject;
          dbRequest.onsuccess = () => {
            resolve(dbRequest.result);
          };
        });
      }
    }

    const tleStore = await this.getObjectStore('tles');
    if (tleStore) {
      const tleData = attributedTle.data as TLE[];
      tleData.forEach(entry => {
        tleStore?.put(entry, entry.OBJECT_ID as string);
      });
    }
  }

  async loadSatelliteData () {
    try {

      let cacheData: CacheData | undefined;
      let attributedData: AttributedTLE | undefined ;
      let cachExpired = false;

      if (config.useCache) {
        cacheData = (await this.loadFromStorage()) as CacheData;
      }

      if (cacheData?.data) {
        attributedData = cacheData.data;
      }

      if (cacheData?.storageTime) {
        const storageTime = DateTime.fromJSDate(cacheData.storageTime);
        const expiryTime = storageTime.plus({ seconds: config.cacheTTL });
        cachExpired = DateTime.now() > expiryTime;
      }

      if (!cacheData || cachExpired) {
        const tleUrl = new URL(this.tleUrl, window.location.href);

        let response = await axios.get(tleUrl.toString(), {
          params: {
            t: Date.now()
          }
        });

        if (response.data) {
          attributedData = response.data;
        }

        // support data being in separate location
        if (typeof attributedData?.data === 'string') {
          const url = new URL(attributedData.data, tleUrl);
          response = await axios.get(url.toString(), {
            params: {
              t: Date.now()
            }
          });

          if (response.data) {
            attributedData.data = response.data;
          }
        }

        if (config.useCache && attributedData) {
          await this.saveToStorage(attributedData);
        }
      }

      if (attributedData) {
        this.satData = attributedData.data as SatelliteObject[];
        this.attribution = attributedData.source;
        this.updateDate = ensureJsDate(attributedData.date);

        for (let i = 0; i < this.satData.length; i++) {
          if (this.satData[i].INTLDES) {
            const yearVal = Number(this.satData[i].INTLDES.substring(0, 2)); // convert year to number
            const prefix = (yearVal > 50) ? '19' : '20';
            const yearStr = prefix + yearVal.toString();
            const rest = this.satData[i].INTLDES.substring(2);
            this.satData[i].intlDes = `${yearStr}-${rest}`;
          } else {
            this.satData[i].intlDes = 'unknown';
          }
          this.satData[i].id = i;
        }
      }

      this.eventManager.fireEvent('satdataloaded', this.satData);
      this.loaded = true;
    } catch (error) {
      logger.error('error loading TLE data', error);
    }
  }

  getAttribution (): {
    name: string;
    url: string;
  } | undefined {
    return this.attribution;
  }

  getUpdatedDate (): Date | undefined {
    return this.updateDate;
  }

  setSatelliteData (satData: SatelliteObject[], includesExtraData = false) {
    this.satData = satData;
    this.gotExtraData = includesExtraData;

    if (includesExtraData) {
      this.eventManager.fireEvent('satextradataloaded', this.satData);
    }
  }

  setPositionalData (satelliteVelocities: Float32Array, satellitePositions: Float32Array, satelliteAltitudes: Float32Array) {
    this.satelliteVelocities = satelliteVelocities;
    this.satellitePositions = satellitePositions;
    this.satelliteAltitudes = satelliteAltitudes;
    this.gotPositionalData = true;
  }

  getSatellitePosition (satId: number): number[] | undefined {
    const offset = satId * 3;
    if (this.satellitePositions && offset < this.satellitePositions.length) {
      return [
        this.satellitePositions[offset],
        this.satellitePositions[offset + 1],
        this.satellitePositions[offset + 3]
      ];
    }
    return undefined;
  }

  getSatData (): SatelliteObject[] {
    return this.satData || [];
  }

  getPositions () {
    return this.satellitePositions;
  }

  getAltitudes () {
    return this.satelliteAltitudes;
  }

  getVelocitities () {
    return this.satelliteVelocities;
  }

  size (): number {
    return this.satData.length;
  }

  searchNameRegex (regex: RegExp) {
    const res = [];
    for (let i = 0; i < this.satData.length; i++) {
      if (regex.test(this.satData[i].OBJECT_NAME)) {
        res.push(i);
      }
    }
    return res;
  }

  search (query: Partial<SatelliteObject>): SatelliteObject[] {
    const keys = Object.keys(query) as (keyof SatelliteObject)[];
    let data = Object.assign([] as SatelliteObject[], this.satData);
    for (const key of keys) {
      data = data.filter((sat: SatelliteObject) => sat[key] === query[key]);
    }
    return data;
  }

  searchName (name: string) {
    const res = [];
    for (let i = 0; i < this.satData.length; i++) {
      if (this.satData[i].OBJECT_NAME === name) {
        res.push(i);
      }
    }
    return res;
  }

  getIdFromIntlDes (intlDes: any) {
    for (let i = 0; i < this.satData.length; i++) {
      if (this.satData[i].INTLDES === intlDes || this.satData[i].intlDes === intlDes) {
        return i;
      }
    }
    return null;
  }

  getSatellite (satelliteId: number): SatelliteObject | undefined {
    if (satelliteId === -1 || satelliteId === undefined || !this.satData) {
      return undefined;
    }

    const satellite = new Proxy(this.satData[satelliteId], {});

    if (!satellite) {
      return undefined;
    }

    if (this.gotPositionalData) {
      satellite.altitude = this.satelliteAltitudes[satelliteId];
      satellite.velocity = Math.sqrt(
        this.satelliteVelocities[satelliteId * 3] * this.satelliteVelocities[satelliteId * 3]
        + this.satelliteVelocities[satelliteId * 3 + 1] * this.satelliteVelocities[satelliteId * 3 + 1]
        + this.satelliteVelocities[satelliteId * 3 + 2] * this.satelliteVelocities[satelliteId * 3 + 2]
      );
      satellite.position = {
        x: this.satellitePositions[satelliteId * 3],
        y: this.satellitePositions[satelliteId * 3 + 1],
        z: this.satellitePositions[satelliteId * 3 + 2]
      };
    }

    return satellite;
  }

  addEventListener (eventName: string, listener: any) {
    this.eventManager.addEventListener(eventName, listener);
  }
}

export default SatelliteStore;
