import {
  COM_JOBS_PER_CAPITA,
  DEMAND_SCALE,
  DEMAND_SEED,
  DEMAND_SMOOTHING,
  IND_JOBS_PER_CAPITA,
  WORKFORCE_RATIO,
} from '../data/balance';

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Demanda residencial, comercial e industrial.
 *
 * Es el termostato del juego: la ciudad no crece porque el jugador lo ordene,
 * sino porque hay desequilibrio entre gente y empleo. El jugador solo prepara
 * el terreno para que ese desequilibrio se resuelva donde a el le interesa.
 */
export class Demand {
  readonly values: [number, number, number] = [DEMAND_SEED[0], DEMAND_SEED[1], DEMAND_SEED[2]];

  update(population: number, comJobs: number, indJobs: number): void {
    const workforce = population * WORKFORCE_RATIO;
    const totalJobs = comJobs + indJobs;

    /**
     * Impulso inicial que decae con el tamano de la ciudad. Sin el, una ciudad
     * vacia tiene cero poblacion y cero empleo, el sistema esta en equilibrio
     * y no arrancaria nunca.
     */
    const bootstrap = Math.exp(-population / 260);

    const targets: [number, number, number] = [
      clamp((totalJobs - workforce) / DEMAND_SCALE + bootstrap, -1, 1),
      clamp((population * COM_JOBS_PER_CAPITA - comJobs) / DEMAND_SCALE + bootstrap * 0.5, -1, 1),
      clamp((population * IND_JOBS_PER_CAPITA - indJobs) / DEMAND_SCALE + bootstrap * 0.7, -1, 1),
    ];

    for (let k = 0; k < 3; k++) {
      this.values[k] += (targets[k] - this.values[k]) * DEMAND_SMOOTHING;
    }
  }
}
