/**
 * Tipos base de la simulacion.
 *
 * Regla del proyecto: este directorio (`sim/`) no importa nada de Three.js.
 * Es logica pura sobre typed arrays, ejecutable y testeable sin navegador.
 */

/** Uso del suelo de una casilla. El orden importa: se serializa como Uint8. */
export const enum Zone {
  Empty = 0,
  Road = 1,
  Residential = 2,
  Commercial = 3,
  Industrial = 4,
  Park = 5,
  PowerPlant = 6,
  OrderPost = 7,
}

/** Zonas que desarrollan edificios por si solas (el jugador no las coloca). */
export const GROWABLE: readonly Zone[] = [Zone.Residential, Zone.Commercial, Zone.Industrial];

/** Zonas colocadas directamente por el jugador y que no evolucionan. */
export const SERVICE: readonly Zone[] = [Zone.Park, Zone.PowerPlant, Zone.OrderPost];

export function isGrowable(z: Zone): boolean {
  return z === Zone.Residential || z === Zone.Commercial || z === Zone.Industrial;
}

export function isService(z: Zone): boolean {
  return z === Zone.Park || z === Zone.PowerPlant || z === Zone.OrderPost;
}

/** Ocupa fisicamente la casilla con un volumen construido (afecta al render). */
export function isBuilt(z: Zone): boolean {
  return isGrowable(z) || isService(z);
}

/** Indices de la demanda RCI. */
export const enum DemandKind {
  Residential = 0,
  Commercial = 1,
  Industrial = 2,
}

/** Instantanea de lectura del estado global, para HUD y tests. */
export interface CityStats {
  tick: number;
  money: number;
  income: number;
  upkeep: number;
  population: number;
  jobs: number;
  /** Demanda RCI normalizada a [-1, 1]. */
  demand: [number, number, number];
  powerSupply: number;
  powerDemand: number;
  /** Fraccion de edificios sin energia en [0, 1]. */
  blackoutRatio: number;
  /** Congestion media de la red viaria en [0, 1]. */
  congestion: number;
  /** Brillo total acumulado de la ciudad. */
  glow: number;
  /** Tension media de las zonas habitadas en [0, 1]. */
  tension: number;
  buildings: number;
  roads: number;
  districtsUnlocked: number;
}
