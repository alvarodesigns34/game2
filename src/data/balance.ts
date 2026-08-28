/**
 * Todo el balanceo del juego vive aqui. Ninguna constante numerica de diseno
 * debe aparecer dentro de `sim/` o `render/`: si hay que retocar la sensacion
 * del juego, se retoca este fichero y nada mas.
 */

// ---------------------------------------------------------------- mundo

export const MAP_SIZE = 256;
export const DISTRICT_SIZE = 32;
export const DISTRICTS_PER_SIDE = MAP_SIZE / DISTRICT_SIZE; // 8
/** Distritos desbloqueados al empezar, por lado (2 => 64x64 casillas). */
export const START_DISTRICTS = 2;

/** Pasos de simulacion por segundo. El render va desacoplado a rAF. */
export const TICK_HZ = 8;
export const TICK_DT = 1 / TICK_HZ;

/** Los campos difusos (deseabilidad, brillo, tension) se recalculan cada N ticks. */
export const FIELD_INTERVAL = 4;
/** La red de trafico y energia se recalcula cada N ticks o cuando cambia. */
export const NETWORK_INTERVAL = 8;
/** El crecimiento evalua 1/GROWTH_PHASES de las casillas por tick. */
export const GROWTH_PHASES = 8;

// ---------------------------------------------------------------- economia

export const START_MONEY = 60_000;

/** Coste de construccion, en ¥ por casilla. */
export const COST = {
  road: 14,
  residential: 9,
  commercial: 11,
  industrial: 11,
  park: 45,
  powerPlant: 3_200,
  orderPost: 900,
  bulldoze: 3,
} as const;

/** Mantenimiento en ¥ por segundo y casilla. */
export const UPKEEP = {
  road: 0.012,
  park: 0.45,
  powerPlant: 7.0,
  orderPost: 3.4,
} as const;

/** Recaudacion en ¥ por segundo y unidad (habitante o empleo). */
export const TAX = {
  perResident: 0.032,
  perCommercialJob: 0.055,
  perIndustrialJob: 0.042,
} as const;

/**
 * El brillo multiplica los ingresos comerciales: una ciudad espectacular
 * factura mas. Es el lado bueno del eje Brillo/Tension.
 */
export const GLOW_INCOME_BONUS = 0.55;
/** La tension se come ingresos: el desorden espanta al comercio. */
export const TENSION_INCOME_PENALTY = 0.40;

/** Coste del siguiente distrito: crece con los ya desbloqueados. */
export function districtCost(unlocked: number): number {
  return Math.round(6_000 * Math.pow(1.35, Math.max(0, unlocked - START_DISTRICTS * START_DISTRICTS)));
}
/** Poblacion minima exigida para poder comprar el siguiente distrito. */
export function districtPopRequirement(unlocked: number): number {
  return Math.round(150 * Math.pow(1.55, Math.max(0, unlocked - START_DISTRICTS * START_DISTRICTS)));
}

// ---------------------------------------------------------------- edificios

/** Nivel maximo de un edificio. El nivel 0 es solar zonificado sin construir. */
export const MAX_LEVEL = 5;

/** Habitantes por casilla residencial segun nivel. */
export const POP_BY_LEVEL = [0, 4, 12, 30, 70, 150] as const;
/** Empleos por casilla comercial segun nivel. */
export const COM_JOBS_BY_LEVEL = [0, 3, 9, 22, 50, 110] as const;
/** Empleos por casilla industrial segun nivel. */
export const IND_JOBS_BY_LEVEL = [0, 5, 14, 32, 66, 130] as const;

/** Consumo electrico por casilla y nivel. El comercio es el mas hambriento. */
export const POWER_RES = [0, 2, 5, 11, 24, 48] as const;
export const POWER_COM = [0, 3, 8, 18, 38, 78] as const;
export const POWER_IND = [0, 6, 15, 32, 62, 120] as const;
export const POWER_ORDER_POST = 18;

/** Capacidad de una central. */
export const POWER_PLANT_CAPACITY = 900;

/**
 * Deseabilidad minima para alcanzar cada nivel. Es la razon de que *donde*
 * construyes importe: sin un entorno bueno, una zona nunca pasa de nivel 2.
 */
export const LEVEL_DESIRE = [0, 0.04, 0.24, 0.44, 0.64, 0.82] as const;
/** Histeresis: se degrada por debajo de (umbral del nivel actual - esto). */
export const DESIRE_HYSTERESIS = 0.11;

/** Ticks minimos entre dos cambios de nivel de una misma casilla. */
export const LEVEL_COOLDOWN = 34;
/** Ticks sin energia antes de empezar a degradarse. */
export const BLACKOUT_DECAY_TICKS = 120;

// ---------------------------------------------------------------- demanda RCI

/** Fraccion de la poblacion que busca empleo. */
export const WORKFORCE_RATIO = 0.52;
/** Empleos comerciales que demanda cada habitante. */
export const COM_JOBS_PER_CAPITA = 0.20;
/** Empleos industriales que demanda cada habitante. */
export const IND_JOBS_PER_CAPITA = 0.17;
/** Escala de normalizacion de la demanda; mas bajo = demanda mas volatil. */
export const DEMAND_SCALE = 90;
/** Suavizado exponencial de la demanda entre ticks. */
export const DEMAND_SMOOTHING = 0.06;
/** Demanda inicial para arrancar la partida sin bloqueos. */
export const DEMAND_SEED = [0.85, 0.35, 0.45] as const;
/** Demanda minima para que un solar vacio se desarrolle. */
export const DEMAND_BUILD_THRESHOLD = 0.05;

// ---------------------------------------------------------------- campos

/** Deseabilidad base de una casilla desbloqueada sin nada alrededor. */
export const DESIRE_BASE = 0.30;

/** Pesos del campo de deseabilidad. */
export const DESIRE_W = {
  glow: 0.55,
  park: 0.85,
  pollution: -0.75,
  tension: -0.70,
  congestion: -0.55,
  order: 0.18,
} as const;

/** Radio del desenfoque separable que difunde cada campo. */
export const FIELD_BLUR_RADIUS = 3;
/** Pasadas del desenfoque (2 aproximan una gaussiana). */
export const FIELD_BLUR_PASSES = 2;

/** Emision de brillo por casilla y nivel. El comercio es quien ilumina la ciudad. */
export const GLOW_RES = [0, 0.02, 0.05, 0.12, 0.28, 0.50] as const;
export const GLOW_COM = [0, 0.15, 0.40, 0.90, 1.80, 3.20] as const;
export const GLOW_IND = [0, 0.01, 0.03, 0.06, 0.10, 0.16] as const;

/** Contaminacion emitida por casilla industrial y nivel. */
export const POLLUTION_IND = [0, 0.35, 0.6, 0.95, 1.35, 1.8] as const;

/** Cuanta tension genera el propio brillo. El nucleo del eje del juego. */
export const TENSION_FROM_GLOW = 0.42;
/** Cuanta tension genera la industria pegada a la gente. */
export const TENSION_FROM_POLLUTION = 0.30;
/**
 * Tension por contraste: un distrito brillante pegado a uno apagado genera
 * mas tension que cualquiera de los dos por separado.
 */
export const TENSION_FROM_CONTRAST = 0.55;
/** Cuanta tension absorbe un puesto de Orden en su radio. */
export const ORDER_TENSION_RELIEF = 1.25;
/** Radio de influencia de un puesto de Orden, en casillas. */
export const ORDER_RADIUS = 11;
/** El Orden apaga ligeramente el brillo de su radio: no hay solucion gratis. */
export const ORDER_GLOW_PENALTY = 0.16;
/** Suavizado temporal de la tension: sube y baja despacio. */
export const TENSION_INERTIA = 0.12;

/** Radio de influencia de un parque, en casillas. */
export const PARK_STRENGTH = 1.5;

// ---------------------------------------------------------------- trafico

/** Viajes generados por habitante y por empleo. */
export const TRIPS_PER_RESIDENT = 0.55;
export const TRIPS_PER_JOB = 0.40;
/** Capacidad de una calle normal, en viajes. */
export const ROAD_CAPACITY = 140;
/** Congestion a partir de la cual la casilla empieza a perder deseabilidad. */
export const CONGESTION_FLOOR = 0.55;
/** Distancia maxima a un empleo, en casillas de red, antes de considerarla inaccesible. */
export const MAX_JOB_DISTANCE = 90;

// ---------------------------------------------------------------- geometria

/**
 * Alturas de edificio en unidades de mundo (1 casilla = 1 unidad).
 * El comercio domina la silueta: es donde vive el neon.
 */
export const HEIGHT_RES = [0, 0.55, 0.95, 1.70, 3.00, 5.20] as const;
export const HEIGHT_COM = [0, 0.60, 1.20, 2.60, 5.50, 11.00] as const;
export const HEIGHT_IND = [0, 0.50, 0.80, 1.30, 2.00, 3.20] as const;

/** Huella del edificio dentro de su casilla (1 = ocupa la casilla entera). */
export const FOOTPRINT_RES = 0.80;
export const FOOTPRINT_COM = 0.84;
export const FOOTPRINT_IND = 0.90;

/** Altura visual de los servicios colocados a mano. */
export const HEIGHT_POWER_PLANT = 1.6;
export const HEIGHT_ORDER_POST = 1.1;
