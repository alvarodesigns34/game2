import {
  MAP_SIZE,
  POWER_COM,
  POWER_IND,
  POWER_ORDER_POST,
  POWER_PLANT_CAPACITY,
  POWER_RES,
} from '../data/balance';
import type { Grid } from './grid';
import { Zone } from './types';

const UNREACHED = 0xffff;
/** Las distancias por encima de esto comparten cubeta al repartir apagones. */
const MAX_BUCKET = 2047;

export interface PowerResult {
  supply: number;
  demand: number;
  /** Casillas construidas que se han quedado a oscuras. */
  dark: number;
  /** Casillas construidas que consumen energia. */
  consumers: number;
}

/** Consumo electrico de una casilla segun su uso y nivel. */
export function powerNeed(zone: Zone, level: number): number {
  switch (zone) {
    case Zone.Residential:
      return POWER_RES[level] ?? 0;
    case Zone.Commercial:
      return POWER_COM[level] ?? 0;
    case Zone.Industrial:
      return POWER_IND[level] ?? 0;
    case Zone.OrderPost:
      return POWER_ORDER_POST;
    default:
      return 0;
  }
}

/**
 * Reparte la energia por la ciudad.
 *
 * Decision de diseno: la electricidad viaja por las calles. No hay herramienta
 * de tendido electrico, asi que el trazado viario es a la vez red de transporte
 * y red de energia, y se convierte en la decision estructural de la partida.
 *
 * Si la demanda supera a la oferta hay apagones deterministas: se apaga primero
 * lo mas lejano a una central. El fallo del sistema es visible desde el aire.
 */
export function updatePower(g: Grid, scratchQueue: Int32Array): PowerResult {
  const { zone, gridDist, powered, w } = g;
  gridDist.fill(UNREACHED);

  // 1. Propagacion por la red viaria desde cada central.
  // Solo se recorre la region desbloqueada: en una partida temprana eso es un
  // 6% del mapa, y el coste crece con la ciudad en vez de ser constante.
  const { minX, minY, maxX, maxY } = g;
  let head = 0;
  let tail = 0;
  let supply = 0;
  for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    const i = y * w + x;
    if (zone[i] !== Zone.PowerPlant) continue;
    supply += POWER_PLANT_CAPACITY;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (!g.inBounds(nx, ny)) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && gridDist[ni] === UNREACHED) {
        gridDist[ni] = 1;
        scratchQueue[tail++] = ni;
      }
    }
  }
  }

  while (head < tail) {
    const i = scratchQueue[head++];
    const d = gridDist[i] + 1;
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= g.h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && gridDist[ni] === UNREACHED) {
        gridDist[ni] = d;
        scratchQueue[tail++] = ni;
      }
    }
  }

  // 2. Demanda por cubetas de distancia, para poder cortar por lo mas lejano.
  const buckets = bucketScratch;
  buckets.fill(0);
  let demand = 0;
  let consumers = 0;
  powered.fill(0);
  const tileDist = distScratch;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      const need = powerNeed(zone[i] as Zone, g.level[i]);
      if (need <= 0) continue;
      const d = nearestGridDist(g, x, y);
      tileDist[i] = d;
      if (d === UNREACHED) continue; // desconectado: nunca recibe energia
      demand += need;
      consumers++;
      buckets[Math.min(d, MAX_BUCKET)] += need;
    }
  }

  // 3. Distancia de corte: hasta donde alcanza la capacidad instalada.
  let cumulative = 0;
  let cutoff = MAX_BUCKET + 1;
  for (let d = 0; d <= MAX_BUCKET; d++) {
    if (buckets[d] === 0) continue;
    if (cumulative + buckets[d] > supply) {
      cutoff = d;
      break;
    }
    cumulative += buckets[d];
  }
  const budgetAtCutoff = supply - cumulative;

  // 4. Aplicar. En la cubeta de corte el reparto se decide por la semilla de la
  //    casilla, para que sea determinista y no parpadee entre ticks.
  let dark = 0;
  let spentAtCutoff = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      const need = powerNeed(zone[i] as Zone, g.level[i]);
      if (need <= 0) continue;
      const d = tileDist[i];
      if (d === UNREACHED) {
        dark++;
        continue;
      }
      const bd = Math.min(d, MAX_BUCKET);
      if (bd < cutoff) {
        powered[i] = 1;
      } else if (bd === cutoff && spentAtCutoff + need <= budgetAtCutoff) {
        powered[i] = 1;
        spentAtCutoff += need;
      } else {
        dark++;
      }
    }
  }

  return { supply, demand, dark, consumers };
}

/** Menor distancia de red entre las calles que tocan la casilla. */
function nearestGridDist(g: Grid, x: number, y: number): number {
  const { zone, gridDist, w } = g;
  let best = UNREACHED;
  for (let k = 0; k < 4; k++) {
    const nx = x + NX[k];
    const ny = y + NY[k];
    if (nx < 0 || ny < 0 || nx >= w || ny >= g.h) continue;
    const ni = ny * w + nx;
    if (zone[ni] !== Zone.Road) continue;
    const d = gridDist[ni];
    if (d < best) best = d;
  }
  return best;
}

const NX = [1, -1, 0, 0] as const;
const NY = [0, 0, 1, -1] as const;
const bucketScratch = new Float64Array(MAX_BUCKET + 1);
/** Distancia de red cacheada por casilla, para no recalcularla dos veces. */
const distScratch = new Uint16Array(MAP_SIZE * MAP_SIZE);
