import {
  DISTRICTS_PER_SIDE,
  DISTRICT_SIZE,
  MAP_SIZE,
  START_DISTRICTS,
} from '../data/balance';
import { Rng } from '../core/rng';
import { Zone, isBuilt } from './types';

/**
 * Estado del mundo en Structure-of-Arrays: un typed array por propiedad en vez
 * de un objeto por casilla. Con 65.536 casillas eso evita crear 65.536 objetos,
 * elimina la presion sobre el recolector de basura y permite serializar la
 * partida entera copiando buffers.
 */
export class Grid {
  readonly w = MAP_SIZE;
  readonly h = MAP_SIZE;
  readonly size = MAP_SIZE * MAP_SIZE;

  // --- estado persistente (se guarda) -------------------------------------
  readonly zone: Uint8Array;
  readonly level: Uint8Array;
  /** Ticks desde el ultimo cambio de nivel; controla el enfriamiento. */
  readonly age: Uint16Array;
  /** Ticks acumulados sin energia; a partir de cierto punto degrada. */
  readonly darkFor: Uint16Array;
  /** Semilla visual por casilla: fija variacion de fachada, rotacion y color. */
  readonly seed: Uint32Array;
  readonly unlockedDistricts: Uint8Array;

  // --- estado derivado (se recalcula) -------------------------------------
  readonly powered: Uint8Array;
  /** Distancia por la red viaria hasta la central mas cercana (0xffff = aislado). */
  readonly gridDist: Uint16Array;
  readonly desire: Float32Array;
  readonly glow: Float32Array;
  readonly tension: Float32Array;
  readonly pollution: Float32Array;
  readonly orderCover: Float32Array;
  /** Viajes que soporta la casilla de calle. */
  readonly roadLoad: Float32Array;
  /** roadLoad / capacidad, saturado a [0, 2]. */
  readonly congestion: Float32Array;

  /** Region rectangular desbloqueada, para no iterar el mapa entero. */
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  /** Marca que la red viaria cambio y hay que recalcular energia y trafico. */
  networkDirty = true;

  /**
   * Se incrementa con cada cambio de zona o de nivel. El render lo compara con
   * su propia copia para saber si tiene que reconstruir las instancias, en vez
   * de recorrer 65.536 casillas en cada frame.
   */
  visualVersion = 0;

  constructor(seed = 1337) {
    const n = this.size;
    this.zone = new Uint8Array(n);
    this.level = new Uint8Array(n);
    this.age = new Uint16Array(n);
    this.darkFor = new Uint16Array(n);
    this.seed = new Uint32Array(n);
    this.powered = new Uint8Array(n);
    this.gridDist = new Uint16Array(n);
    this.desire = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.tension = new Float32Array(n);
    this.pollution = new Float32Array(n);
    this.orderCover = new Float32Array(n);
    this.roadLoad = new Float32Array(n);
    this.congestion = new Float32Array(n);
    this.unlockedDistricts = new Uint8Array(DISTRICTS_PER_SIDE * DISTRICTS_PER_SIDE);

    const rng = new Rng(seed);
    for (let i = 0; i < n; i++) this.seed[i] = rng.uint32();

    this.unlockStartingDistricts();
  }

  // ---------------------------------------------------------------- indices

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  xOf(i: number): number {
    return i % this.w;
  }

  yOf(i: number): number {
    return (i / this.w) | 0;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  // ---------------------------------------------------------------- distritos

  districtIndex(x: number, y: number): number {
    return ((y / DISTRICT_SIZE) | 0) * DISTRICTS_PER_SIDE + ((x / DISTRICT_SIZE) | 0);
  }

  isUnlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return this.unlockedDistricts[this.districtIndex(x, y)] === 1;
  }

  get districtsUnlocked(): number {
    let c = 0;
    for (let i = 0; i < this.unlockedDistricts.length; i++) c += this.unlockedDistricts[i];
    return c;
  }

  /** Desbloquea el bloque central de distritos con el que arranca la partida. */
  private unlockStartingDistricts(): void {
    const first = (DISTRICTS_PER_SIDE - START_DISTRICTS) >> 1;
    for (let dy = 0; dy < START_DISTRICTS; dy++) {
      for (let dx = 0; dx < START_DISTRICTS; dx++) {
        this.unlockedDistricts[(first + dy) * DISTRICTS_PER_SIDE + (first + dx)] = 1;
      }
    }
    this.recomputeBounds();
  }

  unlockDistrict(dx: number, dy: number): boolean {
    if (dx < 0 || dy < 0 || dx >= DISTRICTS_PER_SIDE || dy >= DISTRICTS_PER_SIDE) return false;
    const di = dy * DISTRICTS_PER_SIDE + dx;
    if (this.unlockedDistricts[di] === 1) return false;
    this.unlockedDistricts[di] = 1;
    this.recomputeBounds();
    this.networkDirty = true;
    return true;
  }

  /** Un distrito solo se puede comprar si toca uno ya desbloqueado. */
  isDistrictAdjacentToUnlocked(dx: number, dy: number): boolean {
    const n = DISTRICTS_PER_SIDE;
    const at = (a: number, b: number) =>
      a >= 0 && b >= 0 && a < n && b < n && this.unlockedDistricts[b * n + a] === 1;
    return at(dx - 1, dy) || at(dx + 1, dy) || at(dx, dy - 1) || at(dx, dy + 1);
  }

  /** Rectangulo que envuelve todos los distritos desbloqueados, con un margen. */
  private recomputeBounds(): void {
    let minD = DISTRICTS_PER_SIDE;
    let minDY = DISTRICTS_PER_SIDE;
    let maxD = -1;
    let maxDY = -1;
    for (let dy = 0; dy < DISTRICTS_PER_SIDE; dy++) {
      for (let dx = 0; dx < DISTRICTS_PER_SIDE; dx++) {
        if (this.unlockedDistricts[dy * DISTRICTS_PER_SIDE + dx] !== 1) continue;
        if (dx < minD) minD = dx;
        if (dx > maxD) maxD = dx;
        if (dy < minDY) minDY = dy;
        if (dy > maxDY) maxDY = dy;
      }
    }
    this.minX = minD * DISTRICT_SIZE;
    this.minY = minDY * DISTRICT_SIZE;
    this.maxX = (maxD + 1) * DISTRICT_SIZE - 1;
    this.maxY = (maxDY + 1) * DISTRICT_SIZE - 1;
  }

  // ---------------------------------------------------------------- consultas

  /** Cierto si alguna de las 4 casillas vecinas es calle. */
  hasRoadAccess(x: number, y: number): boolean {
    const z = this.zone;
    if (x > 0 && z[this.idx(x - 1, y)] === Zone.Road) return true;
    if (x < this.w - 1 && z[this.idx(x + 1, y)] === Zone.Road) return true;
    if (y > 0 && z[this.idx(x, y - 1)] === Zone.Road) return true;
    if (y < this.h - 1 && z[this.idx(x, y + 1)] === Zone.Road) return true;
    return false;
  }

  /** Cierto si alguna calle vecina esta conectada a la red electrica. */
  touchesPoweredRoad(x: number, y: number): boolean {
    const z = this.zone;
    const d = this.gridDist;
    const check = (xx: number, yy: number) => {
      if (!this.inBounds(xx, yy)) return false;
      const i = this.idx(xx, yy);
      return z[i] === Zone.Road && d[i] !== 0xffff;
    };
    return check(x - 1, y) || check(x + 1, y) || check(x, y - 1) || check(x, y + 1);
  }

  /** Numero de casillas edificadas, para estadisticas y para el render. */
  countBuilt(): number {
    let c = 0;
    for (let i = 0; i < this.size; i++) if (isBuilt(this.zone[i] as Zone)) c++;
    return c;
  }
}
