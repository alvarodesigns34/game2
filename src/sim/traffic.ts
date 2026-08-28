import {
  COM_JOBS_BY_LEVEL,
  IND_JOBS_BY_LEVEL,
  POP_BY_LEVEL,
  ROAD_CAPACITY,
  TRIPS_PER_JOB,
  TRIPS_PER_RESIDENT,
} from '../data/balance';
import type { Grid } from './grid';
import { Zone } from './types';

const UNREACHED = 0xffff;

export interface TrafficResult {
  /** Congestion media de las calles con trafico, en [0, ~2]. */
  averageCongestion: number;
  /** Calles por encima de su capacidad. */
  jammed: number;
  totalTrips: number;
}

/**
 * Modelo de trafico sin pathfinding.
 *
 * Calcular rutas para miles de vehiculos es inviable y ademas innecesario. En
 * su lugar se usa el mismo algoritmo con el que se calculan las cuencas
 * fluviales: se mide la distancia de cada calle al empleo mas cercano, los
 * viajes se generan en las zonas residenciales y bajan por el gradiente hacia
 * el trabajo, acumulandose en el camino.
 *
 * El resultado emerge solo: las calles que sirven a mucho territorio se
 * convierten en arterias saturadas y las de reparto quedan vacias. Si toda la
 * ciudad cuelga de una sola avenida, esa avenida colapsa. Eso es exactamente la
 * decision de planificacion que queremos que el jugador sienta.
 */
export function updateTraffic(
  g: Grid,
  queue: Int32Array,
  jobDist: Uint16Array,
): TrafficResult {
  const { zone, level, roadLoad, congestion, w, h } = g;
  const { minX, minY, maxX, maxY } = g;
  jobDist.fill(UNREACHED);
  roadLoad.fill(0);

  // 1. Sembrar la busqueda en las calles que tocan un empleo.
  let head = 0;
  let tail = 0;
  for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    const i = y * w + x;
    const z = zone[i] as Zone;
    if (z !== Zone.Commercial && z !== Zone.Industrial) continue;
    if (level[i] === 0) continue;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && jobDist[ni] === UNREACHED) {
        jobDist[ni] = 0;
        queue[tail++] = ni;
      }
    }
  }
  }

  // 2. Distancia al empleo por la red viaria. La cola queda ordenada por
  //    distancia creciente, lo que nos ahorra ordenar despues.
  while (head < tail) {
    const i = queue[head++];
    const d = jobDist[i] + 1;
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && jobDist[ni] === UNREACHED) {
        jobDist[ni] = d;
        queue[tail++] = ni;
      }
    }
  }
  const reached = tail;

  // 3. Generacion de viajes: cada casilla habitada los reparte entre las
  //    calles que la tocan.
  let totalTrips = 0;
  for (let gy = minY; gy <= maxY; gy++) {
  for (let gx = minX; gx <= maxX; gx++) {
    const i = gy * w + gx;
    const z = zone[i] as Zone;
    const lv = level[i];
    if (lv === 0) continue;
    let trips = 0;
    if (z === Zone.Residential) trips = POP_BY_LEVEL[lv] * TRIPS_PER_RESIDENT;
    else if (z === Zone.Commercial) trips = COM_JOBS_BY_LEVEL[lv] * TRIPS_PER_JOB;
    else if (z === Zone.Industrial) trips = IND_JOBS_BY_LEVEL[lv] * TRIPS_PER_JOB;
    if (trips <= 0) continue;

    const x = gx;
    const y = gy;
    let roads = 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (zone[ny * w + nx] === Zone.Road) roads++;
    }
    if (roads === 0) continue;
    totalTrips += trips;
    const share = trips / roads;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road) roadLoad[ni] += share;
    }
  }
  }

  // 4. Los viajes bajan por el gradiente hacia el empleo. Recorrer la cola al
  //    reves equivale a ir de la periferia al centro, que es justo el orden en
  //    que hay que acumular.
  for (let q = reached - 1; q >= 0; q--) {
    const i = queue[q];
    const load = roadLoad[i];
    if (load <= 0) continue;
    const d = jobDist[i];
    if (d === 0) continue; // ya esta en el destino
    const x = i % w;
    const y = (i / w) | 0;

    let downhill = 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && jobDist[ni] === d - 1) downhill++;
    }
    if (downhill === 0) continue;
    // Repartir entre todas las salidas cuesta abajo: el trafico se distribuye
    // en vez de concentrarse artificialmente en una sola linea.
    const share = load / downhill;
    for (let k = 0; k < 4; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (zone[ni] === Zone.Road && jobDist[ni] === d - 1) roadLoad[ni] += share;
    }
  }

  // 5. Congestion normalizada.
  let sum = 0;
  let count = 0;
  let jammed = 0;
  congestion.fill(0);
  for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    const i = y * w + x;
    if (zone[i] !== Zone.Road) continue;
    const c = Math.min(2, roadLoad[i] / ROAD_CAPACITY);
    congestion[i] = c;
    if (c > 0) {
      sum += c;
      count++;
      if (c >= 1) jammed++;
    }
  }
  }

  return { averageCongestion: count > 0 ? sum / count : 0, jammed, totalTrips };
}

const NX = [1, -1, 0, 0] as const;
const NY = [0, 0, 1, -1] as const;
