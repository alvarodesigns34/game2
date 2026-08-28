import {
  DESIRE_BASE,
  DESIRE_W,
  GLOW_COM,
  GLOW_IND,
  GLOW_RES,
  ORDER_GLOW_PENALTY,
  ORDER_RADIUS,
  ORDER_TENSION_RELIEF,
  PARK_STRENGTH,
  POLLUTION_IND,
  CONGESTION_FLOOR,
  TENSION_FROM_CONTRAST,
  TENSION_FROM_GLOW,
  TENSION_FROM_POLLUTION,
  TENSION_INERTIA,
} from '../data/balance';
import { blurField } from './blur';
import type { Grid } from './grid';
import { Zone } from './types';

/**
 * Curva de saturacion para campos positivos sin cota superior.
 * Evita que un centro hipertrofiado desborde la deseabilidad: el primer
 * rascacielos de una zona aporta muchisimo, el vigesimo casi nada.
 */
function sat(x: number): number {
  return x <= 0 ? 0 : x / (1 + x);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Campos escalares difusos de la ciudad.
 *
 * Son el corazon del juego espacial: convierten "que hay en esta casilla" en
 * "como es vivir cerca de esta casilla". Todo lo que hace que la planificacion
 * importe sale de aqui.
 */
export class Fields {
  private readonly glowNear: Float32Array;
  private readonly glowFar: Float32Array;
  private readonly park: Float32Array;
  private readonly congestion: Float32Array;
  private readonly scratch: Float32Array;

  constructor(size: number) {
    this.glowNear = new Float32Array(size);
    this.glowFar = new Float32Array(size);
    this.park = new Float32Array(size);
    this.congestion = new Float32Array(size);
    this.scratch = new Float32Array(size);
  }

  /** Brillo total emitido por la ciudad, para el HUD. */
  totalGlow = 0;
  /** Tension media de las casillas habitadas, para el HUD. */
  averageTension = 0;

  update(g: Grid): void {
    const { zone, level, powered, glow, pollution, tension, orderCover, w } = g;
    const { minX, minY, maxX, maxY } = g;

    this.glowNear.fill(0);
    this.glowFar.fill(0);
    this.park.fill(0);
    this.congestion.fill(0);
    pollution.fill(0);
    orderCover.fill(0);

    // --- fuentes ---------------------------------------------------------
    let totalGlow = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        const z = zone[i] as Zone;
        const lv = level[i];

        if (lv > 0 && powered[i] === 1) {
          // Un edificio a oscuras no brilla. El apagon apaga tambien la
          // economia y el atractivo, no solo las luces.
          let e = 0;
          if (z === Zone.Residential) e = GLOW_RES[lv];
          else if (z === Zone.Commercial) e = GLOW_COM[lv];
          else if (z === Zone.Industrial) e = GLOW_IND[lv];
          if (e > 0) {
            this.glowNear[i] = e;
            this.glowFar[i] = e;
            totalGlow += e;
          }
        }
        if (z === Zone.Industrial && lv > 0) pollution[i] = POLLUTION_IND[lv];
        else if (z === Zone.Park) this.park[i] = PARK_STRENGTH;
        else if (z === Zone.Road) {
          const c = g.congestion[i];
          if (c > CONGESTION_FLOOR) this.congestion[i] = c - CONGESTION_FLOOR;
        }
      }
    }
    this.totalGlow = totalGlow;

    // --- cobertura de Orden ---------------------------------------------
    // Son pocos edificios, asi que se estampa un circulo directamente en vez
    // de difuminar un campo entero.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        if (zone[i] !== Zone.OrderPost || powered[i] !== 1) continue;
        stampRadial(orderCover, w, g.h, x, y, ORDER_RADIUS, 1);
      }
    }

    // --- difusion --------------------------------------------------------
    // Dos escalas de brillo: la cercana alimenta la deseabilidad, y la
    // diferencia entre ambas detecta las fronteras entre barrios brillantes y
    // barrios apagados, que es de donde sale la tension por contraste.
    blurField(this.glowNear, this.scratch, w, 2, 1, minX, minY, maxX, maxY);
    blurField(this.glowFar, this.scratch, w, 5, 2, minX, minY, maxX, maxY);
    blurField(pollution, this.scratch, w, 4, 2, minX, minY, maxX, maxY);
    blurField(this.park, this.scratch, w, 3, 2, minX, minY, maxX, maxY);
    blurField(this.congestion, this.scratch, w, 2, 1, minX, minY, maxX, maxY);

    // --- tension y deseabilidad -----------------------------------------
    let tensionSum = 0;
    let tensionCount = 0;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        const near = this.glowNear[i];
        const far = this.glowFar[i];
        const order = Math.min(1, orderCover[i]);

        // El Orden apaga un poco el barrio que protege: no hay solucion gratis.
        const glowValue = near * (1 - ORDER_GLOW_PENALTY * order);
        glow[i] = glowValue;

        const contrast = Math.abs(near - far);
        let target =
          TENSION_FROM_GLOW * sat(far) +
          TENSION_FROM_POLLUTION * sat(pollution[i]) +
          TENSION_FROM_CONTRAST * sat(contrast * 2) -
          ORDER_TENSION_RELIEF * order;
        target = clamp01(target);

        // La tension tiene inercia: un barrio no se degrada ni se recupera de
        // un tick para otro, y eso da tiempo al jugador a reaccionar.
        const t = tension[i] + (target - tension[i]) * TENSION_INERTIA;
        tension[i] = t;

        if (level[i] > 0) {
          tensionSum += t;
          tensionCount++;
        }

        const d =
          DESIRE_BASE +
          DESIRE_W.glow * sat(glowValue) +
          DESIRE_W.park * sat(this.park[i]) +
          DESIRE_W.pollution * sat(pollution[i]) +
          DESIRE_W.tension * t +
          DESIRE_W.congestion * Math.min(1, this.congestion[i]) +
          DESIRE_W.order * order;
        g.desire[i] = clamp01(d);
      }
    }

    this.averageTension = tensionCount > 0 ? tensionSum / tensionCount : 0;
  }
}

/** Estampa un circulo con caida suave en un campo. */
function stampRadial(
  field: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(w - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(h - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2 / r2);
      field[y * w + x] += strength * falloff * falloff;
    }
  }
}
