import {
  COM_JOBS_BY_LEVEL,
  GLOW_INCOME_BONUS,
  IND_JOBS_BY_LEVEL,
  POP_BY_LEVEL,
  TAX,
  TENSION_INCOME_PENALTY,
  UPKEEP,
} from '../data/balance';
import type { Grid } from './grid';
import { Zone } from './types';

export interface Census {
  population: number;
  comJobs: number;
  indJobs: number;
  buildings: number;
  topLevel: number;
  roads: number;
  /** Ingresos en ¥/segundo. */
  income: number;
  /** Mantenimiento en ¥/segundo. */
  upkeep: number;
}

function sat(x: number): number {
  return x <= 0 ? 0 : x / (1 + x);
}

/**
 * Censo y balance economico en una sola pasada.
 *
 * Los ingresos se calculan casilla a casilla porque el brillo y la tension son
 * locales: un local comercial en una avenida iluminada factura mucho mas que el
 * mismo local en un poligono a oscuras. Un unico numero global se perderia
 * justamente el matiz que hace interesante decidir donde poner las cosas.
 */
export function census(g: Grid): Census {
  const { zone, level, powered, glow, tension, w } = g;
  const { minX, minY, maxX, maxY } = g;

  let population = 0;
  let comJobs = 0;
  let indJobs = 0;
  let buildings = 0;
  let topLevel = 0;
  let roads = 0;
  let income = 0;
  let upkeep = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      const z = zone[i] as Zone;
      const lv = level[i];

      switch (z) {
        case Zone.Road:
          roads++;
          upkeep += UPKEEP.road;
          continue;
        case Zone.Park:
          upkeep += UPKEEP.park;
          continue;
        case Zone.PowerPlant:
          upkeep += UPKEEP.powerPlant;
          continue;
        case Zone.OrderPost:
          upkeep += UPKEEP.orderPost;
          continue;
        default:
          break;
      }

      if (lv === 0) continue;
      buildings++;
      if (lv > topLevel) topLevel = lv;
      // Un edificio a oscuras no produce: ni habitantes que tributen ni
      // comercio que facture.
      if (powered[i] !== 1) continue;

      const localBonus = 1 + GLOW_INCOME_BONUS * sat(glow[i]) - TENSION_INCOME_PENALTY * tension[i];
      const mult = localBonus < 0.15 ? 0.15 : localBonus;

      if (z === Zone.Residential) {
        const p = POP_BY_LEVEL[lv];
        population += p;
        income += p * TAX.perResident * mult;
      } else if (z === Zone.Commercial) {
        const j = COM_JOBS_BY_LEVEL[lv];
        comJobs += j;
        income += j * TAX.perCommercialJob * mult;
      } else if (z === Zone.Industrial) {
        const j = IND_JOBS_BY_LEVEL[lv];
        indJobs += j;
        income += j * TAX.perIndustrialJob * mult;
      }
    }
  }

  return { population, comJobs, indJobs, buildings, topLevel, roads, income, upkeep };
}
