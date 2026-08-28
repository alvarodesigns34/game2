import { Color } from 'three';

/**
 * Paleta de CIUDAD NEON.
 *
 * Direccion de arte: noche permanente, materiales casi planos y todo el
 * presupuesto visual gastado en luz. Los materiales base son azules muy
 * oscuros y desaturados; el color solo aparece donde hay una fuente de luz.
 * Ese contraste es lo que hace que el neon lea como neon y no como pintura.
 */
export const PALETTE = {
  /** Fondo y niebla: azul de medianoche, nunca negro puro. */
  night: new Color('#070a14'),
  fogNear: new Color('#070a14'),
  horizon: new Color('#141c38'),

  /** Suelo. */
  asphalt: new Color('#0a0d16'),
  asphaltWet: new Color('#0e1424'),
  sidewalk: new Color('#171b28'),
  laneMark: new Color('#2a3348'),
  lockedGround: new Color('#02040a'),

  /** Volumenes construidos, antes de la iluminacion. */
  concrete: new Color('#141826'),
  concreteDark: new Color('#0d1119'),

  /** Luz de ventana por uso. */
  windowRes: new Color('#ffc98a'),
  windowCom: new Color('#8ff4ff'),
  windowInd: new Color('#ff9a3c'),

  /** Neon: los tres colores que definen la ciudad. */
  neonCyan: new Color('#00e5ff'),
  neonMagenta: new Color('#ff2d95'),
  neonViolet: new Color('#a45cff'),
  neonAmber: new Color('#ff8a1e'),
  neonRed: new Color('#ff3355'),

  /** Tintes de zonificacion sobre solares vacios. */
  zoneRes: new Color('#2fe08a'),
  zoneCom: new Color('#3ac8ff'),
  zoneInd: new Color('#ffab3d'),
  zonePark: new Color('#4fe07a'),
} as const;

/** Devuelve el vector [r,g,b] de un color, para pasarlo a un uniform. */
export function rgb(c: Color): [number, number, number] {
  return [c.r, c.g, c.b];
}
