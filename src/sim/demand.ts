import {
  COM_JOBS_PER_CAPITA,
  GLOW_ATTRACTION,
  GLOW_ATTRACTION_SCALE,
  TENSION_REPULSION,
  demandScale,
  DEMAND_SEED,
  DEMAND_SMOOTHING,
  IND_JOBS_PER_CAPITA,
  WORKFORCE_RATIO,
} from '../data/balance';

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Saturacion: el primer neon atrae muchisimo, el numero mil casi nada. */
function sat(x: number): number {
  return x <= 0 ? 0 : x / (1 + x);
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

  /** Ultimo valor de atraccion calculado, para mostrarlo en el HUD. */
  attraction = 0;

  update(
    population: number,
    comJobs: number,
    indJobs: number,
    totalGlow: number,
    averageTension: number,
  ): void {
    const workforce = population * WORKFORCE_RATIO;
    const totalJobs = comJobs + indJobs;

    /**
     * Impulso inicial que decae con el tamano de la ciudad. Sin el, una ciudad
     * vacia tiene cero poblacion y cero empleo, el sistema esta en equilibrio
     * y no arrancaria nunca.
     */
    const scale = demandScale(population);
    const bootstrap = Math.exp(-population / 260);

    /**
     * El eje Brillo/Tension empujando la demanda. Una ciudad que impresiona
     * atrae gente aunque su mercado laboral ya este equilibrado; una ciudad
     * tensa la pierde. Es lo que impide que la partida se estanque y lo que
     * hace que la decision estetica del jugador tenga consecuencia mecanica.
     */
    const glowPull = GLOW_ATTRACTION * sat(totalGlow / GLOW_ATTRACTION_SCALE);
    const tensionPush = TENSION_REPULSION * averageTension;
    const attraction = clamp(glowPull - tensionPush, -0.7, 0.7);
    this.attraction = attraction;

    const targets: [number, number, number] = [
      clamp((totalJobs - workforce) / scale + bootstrap + attraction, -1, 1),
      clamp(
        (population * COM_JOBS_PER_CAPITA - comJobs) / scale +
          bootstrap * 0.5 + attraction * 0.6,
        -1, 1,
      ),
      clamp(
        (population * IND_JOBS_PER_CAPITA - indJobs) / scale +
          bootstrap * 0.7 + attraction * 0.4,
        -1, 1,
      ),
    ];

    for (let k = 0; k < 3; k++) {
      this.values[k] += (targets[k] - this.values[k]) * DEMAND_SMOOTHING;
    }
  }
}
