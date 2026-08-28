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
  powerPlant: 6_400,
  orderPost: 900,
  bulldoze: 3,
} as const;

/** Mantenimiento en ¥ por segundo y casilla. */
export const UPKEEP = {
  road: 0.012,
  park: 0.45,
  powerPlant: 17.0,
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

/**
 * Capacidad de una central.
 *
 * Deliberadamente alta. Con centrales pequenas una metropoli madura necesitaria
 * veinte, y colocarlas dejaria de ser una decision para convertirse en una
 * tarea. Pocas centrales, caras y con consecuencias: cada una es una decision
 * de donde meter el humo.
 */
export const POWER_PLANT_CAPACITY = 3_000;

/**
 * Deseabilidad minima para alcanzar cada nivel. Es la razon de que *donde*
 * construyes importe: sin un entorno bueno, una zona nunca pasa de nivel 2.
 */
export const LEVEL_DESIRE = [0, 0.03, 0.16, 0.28, 0.40, 0.52] as const;
/** Histeresis: se degrada por debajo de (umbral del nivel actual - esto). */
export const DESIRE_HYSTERESIS = 0.11;

/** Ticks minimos entre dos cambios de nivel de una misma casilla. */
export const LEVEL_COOLDOWN = 34;
/**
 * Demanda por debajo de la cual un edificio deja de mejorar. No es cero: un
 * barrio consolidado sigue densificandose aunque el mercado este equilibrado.
 * Solo cuando la demanda se hunde de verdad se detiene la renovacion.
 */
export const LEVEL_DEMAND_FLOOR = -0.35;
/** Ticks sin energia antes de empezar a degradarse. */
export const BLACKOUT_DECAY_TICKS = 120;

// ---------------------------------------------------------------- demanda RCI

/** Fraccion de la poblacion que busca empleo. */
export const WORKFORCE_RATIO = 0.52;
/**
 * Empleos que demanda cada habitante, por sector.
 *
 * La suma tiene que ser igual a WORKFORCE_RATIO. Si es menor, la ciudad nunca
 * genera empleo para toda su poblacion activa, la demanda residencial se queda
 * negativa para siempre y el crecimiento se detiene en seco. Es la clase de
 * desequilibrio que no se ve en ninguna pantalla pero congela la partida.
 */
export const COM_JOBS_PER_CAPITA = 0.30;
export const IND_JOBS_PER_CAPITA = 0.22;
/**
 * Escala de normalizacion de la demanda.
 *
 * Crece con la ciudad a proposito: un desfase de cien empleos es una crisis en
 * un barrio de quinientos habitantes y ruido estadistico en una metropoli de
 * cincuenta mil. Con una escala fija, la demanda de una ciudad grande se queda
 * clavada en +1 o -1 y deja de informar de nada.
 */
export function demandScale(population: number): number {
  return 90 + population * 0.08;
}
/** Suavizado exponencial de la demanda entre ticks. */
export const DEMAND_SMOOTHING = 0.06;
/** Demanda inicial para arrancar la partida sin bloqueos. */
export const DEMAND_SEED = [0.85, 0.35, 0.45] as const;
/** Demanda minima para que un solar vacio se desarrolle. */
export const DEMAND_BUILD_THRESHOLD = 0.03;

/**
 * Atraccion migratoria. Es el eje Brillo/Tension actuando sobre la demanda:
 * una ciudad espectacular atrae gente de fuera aunque su mercado laboral este
 * en equilibrio, y una ciudad tensa la expulsa.
 *
 * Sin esto la partida se congela: en cuanto empleo y poblacion se igualan la
 * demanda cae a cero y no vuelve a construirse nada nunca mas. Con esto, el
 * neon que el jugador levanta por gusto estetico es literalmente el motor de
 * crecimiento de su ciudad, y la tension que ese mismo neon genera es el freno.
 */
export const GLOW_ATTRACTION = 0.38;
export const TENSION_REPULSION = 0.62;
/** Brillo a partir del cual la atraccion empieza a saturarse. */
export const GLOW_ATTRACTION_SCALE = 60;

// ---------------------------------------------------------------- campos

/** Deseabilidad base de una casilla desbloqueada sin nada alrededor. */
export const DESIRE_BASE = 0.34;
/**
 * Ventaja de partida del suelo industrial. Un poligono no necesita ser bonito
 * para funcionar, y sin esta ventaja la industria se ahogaba en su propio humo:
 * se contaminaba a si misma hasta quedar congelada en nivel 3, la ciudad se
 * quedaba sin empleo y el crecimiento se detenia.
 */
export const INDUSTRY_DESIRE_BONUS = 0.22;

/** Pesos del campo de deseabilidad. */
export const DESIRE_W = {
  glow: 0.55,
  park: 0.85,
  /**
   * Aglomeracion: estar en medio de ciudad construida es en si mismo un
   * atractivo. Sin este termino el centro no tiene ninguna ventaja sobre el
   * extrarradio y no llega a formarse nunca un centro: la ciudad crece como
   * una alfombra plana de edificios de nivel dos.
   */
  urbanity: 0.42,
  pollution: -0.75,
  tension: -0.70,
  congestion: -0.55,
  order: 0.18,
} as const;

/** Presencia urbana que aporta una casilla construida, por nivel. */
export const URBANITY_BY_LEVEL = [0, 0.35, 0.50, 0.70, 0.95, 1.25] as const;

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
/**
 * Las centrales tambien ensucian su entorno. Es lo que impide la jugada
 * evidente de plantarlas en medio del centro financiero para tener la red
 * corta: la energia barata se paga en deseabilidad.
 */
export const POLLUTION_POWER_PLANT = 2.2;

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
/**
 * Capacidad de una calle normal, en viajes.
 *
 * El modelo acumula rio abajo, asi que las calles que dan al centro de empleo
 * soportan una fraccion grande de todos los viajes de la ciudad. La capacidad
 * tiene que estar calibrada contra ESE numero, no contra el trafico de una
 * calle cualquiera: con un valor bajo, una ciudad mediana bien trazada aparece
 * colapsada de punta a punta y el aviso de atasco deja de significar nada.
 */
export const ROAD_CAPACITY = 1_600;
/** Congestion a partir de la cual la casilla empieza a perder deseabilidad. */
export const CONGESTION_FLOOR = 0.55;
/** Distancia maxima a un empleo, en casillas de red, antes de considerarla inaccesible. */
export const MAX_JOB_DISTANCE = 90;

// ---------------------------------------------------------------- geometria

/**
 * Alturas de edificio en unidades de mundo (1 casilla = 1 unidad).
 * El comercio domina la silueta: es donde vive el neon.
 */
export const HEIGHT_RES = [0, 0.50, 0.85, 1.40, 2.40, 4.20] as const;
export const HEIGHT_COM = [0, 0.60, 1.30, 3.00, 6.50, 13.00] as const;
export const HEIGHT_IND = [0, 0.50, 0.80, 1.30, 2.00, 3.20] as const;

/** Huella del edificio dentro de su casilla (1 = ocupa la casilla entera). */
// Huellas generosas: con solares de 4x4 dentro de cada manzana, un edificio
// pequeno deja tanto suelo a la vista que la manzana no llega a leerse como
// manzana. Casi tocandose, el tejido urbano aparece solo.
export const FOOTPRINT_RES = 0.86;
export const FOOTPRINT_COM = 0.90;
export const FOOTPRINT_IND = 0.92;

/** Altura visual de los servicios colocados a mano. */
export const HEIGHT_POWER_PLANT = 1.6;
export const HEIGHT_ORDER_POST = 1.1;
