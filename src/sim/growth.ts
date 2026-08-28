import {
  BLACKOUT_DECAY_TICKS,
  DEMAND_BUILD_THRESHOLD,
  DESIRE_HYSTERESIS,
  GROWTH_PHASES,
  LEVEL_COOLDOWN,
  LEVEL_DEMAND_FLOOR,
  LEVEL_DESIRE,
  MAX_LEVEL,
} from '../data/balance';
import type { Rng } from '../core/rng';
import type { Grid } from './grid';
import { DemandKind, Zone } from './types';

export interface GrowthResult {
  built: number;
  upgraded: number;
  decayed: number;
}

function demandKind(z: Zone): DemandKind {
  if (z === Zone.Commercial) return DemandKind.Commercial;
  if (z === Zone.Industrial) return DemandKind.Industrial;
  return DemandKind.Residential;
}

/**
 * Evolucion de los edificios.
 *
 * El jugador no coloca ni un solo edificio: zonifica, y lo que se construye,
 * hasta que nivel llega y cuando se degrada lo deciden las condiciones de la
 * casilla. De ahi viene la satisfaccion de mirar la ciudad terminada: el
 * resultado es tuyo pero no lo has dibujado a mano.
 *
 * Por rendimiento solo se evalua 1/GROWTH_PHASES del mapa en cada tick, en
 * rotacion. A 8 ticks/s cada casilla se revisa una vez por segundo.
 */
export function updateGrowth(
  g: Grid,
  rng: Rng,
  demand: readonly [number, number, number],
  phase: number,
  tick: number,
): GrowthResult {
  const { zone, level, age, darkFor, powered, desire, industryDesire, changedAt, w } = g;
  const { minX, minY, maxX, maxY } = g;

  let built = 0;
  let upgraded = 0;
  let decayed = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if ((i & (GROWTH_PHASES - 1)) !== phase) continue;

      const z = zone[i] as Zone;
      if (z !== Zone.Residential && z !== Zone.Commercial && z !== Zone.Industrial) continue;

      const lv = level[i];
      const dem = demand[demandKind(z)];

      // Sin acceso rodado no hay nada que hacer: ni se construye ni se sostiene.
      if (!g.hasRoadAccess(x, y)) {
        if (lv > 0 && rng.next() < 0.25) {
          level[i] = lv - 1;
          age[i] = 0;
          changedAt[i] = tick;
          decayed++;
          g.visualVersion++;
        }
        continue;
      }

      const hasPower = lv === 0 ? g.touchesPoweredRoad(x, y) : powered[i] === 1;
      if (hasPower) darkFor[i] = 0;
      else if (darkFor[i] < 0xffff - GROWTH_PHASES) darkFor[i] += GROWTH_PHASES;

      if (age[i] < 0xffff - GROWTH_PHASES) age[i] += GROWTH_PHASES;

      const d = z === Zone.Industrial ? industryDesire[i] : desire[i];

      // --- degradacion ---------------------------------------------------
      if (lv > 0) {
        const starved = darkFor[i] > BLACKOUT_DECAY_TICKS;
        const unattractive = d < LEVEL_DESIRE[lv] - DESIRE_HYSTERESIS;
        const abandoned = dem < -0.55;
        if (starved || unattractive || abandoned) {
          const chance = starved ? 0.22 : unattractive ? 0.14 : 0.08;
          if (rng.next() < chance) {
            level[i] = lv - 1;
            age[i] = 0;
            changedAt[i] = tick;
            decayed++;
            g.visualVersion++;
          }
          continue;
        }
      }

      // --- construccion y ascenso ----------------------------------------
      if (!hasPower) continue;

      if (lv === 0) {
        if (dem > DEMAND_BUILD_THRESHOLD && rng.next() < 0.10 + 0.45 * dem) {
          level[i] = 1;
          age[i] = 0;
          changedAt[i] = tick;
          built++;
          g.visualVersion++;
        }
        continue;
      }

      if (lv >= MAX_LEVEL) continue;
      if (age[i] < LEVEL_COOLDOWN) continue;
      if (d < LEVEL_DESIRE[lv + 1]) continue;

      /**
       * La subida de nivel NO exige demanda positiva, solo que la demanda no
       * este hundida. La demanda decide si se ocupa un solar vacio; lo que
       * decide si un edificio se sustituye por otro mas alto es el valor del
       * suelo, igual que en una ciudad real.
       *
       * Atarla a la demanda producia un empate permanente: en cuanto empleo y
       * poblacion se igualaban, la ciudad dejaba de mejorar para siempre y la
       * partida se congelaba con la mitad de los solares vacios.
       */
      if (dem <= LEVEL_DEMAND_FLOOR) continue;

      // Cuanto mejor es el sitio y mayor la demanda, mas rapido sube.
      const margin = d - LEVEL_DESIRE[lv + 1];
      if (rng.next() < 0.05 + 0.30 * Math.max(0, dem) + 0.5 * margin) {
        level[i] = lv + 1;
        age[i] = 0;
        changedAt[i] = tick;
        upgraded++;
        g.visualVersion++;
      }
    }
  }

  return { built, upgraded, decayed };
}
