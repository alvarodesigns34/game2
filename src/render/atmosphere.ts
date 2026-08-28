import { Vector3 } from 'three';
import { PALETTE } from './palette';

/**
 * Niebla atmosferica propia.
 *
 * La niebla estandar de Three mide la profundidad respecto a la camara, y con
 * una camara ortografica toda la escena esta a la misma distancia: o no se ve
 * niebla, o se ve la escena entera ahogada en ella. Aqui la densidad se calcula
 * por distancia horizontal al punto que mira el jugador, que ademas es lo que
 * queremos artisticamente: la ciudad se difumina hacia el horizonte y el foco
 * queda limpio.
 *
 * La segunda mitad del truco es que la niebla se debilita con la altura, para
 * que las torres altas asomen por encima de la bruma. Es lo que da la sensacion
 * de escala de una megaciudad vista desde arriba.
 */
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFocus;
uniform vec2 uFogRange;
uniform float uFogHeight;

vec3 applyCityFog(vec3 color, vec3 worldPos) {
  float d = length(worldPos.xz - uFocus.xz);
  float amount = smoothstep(uFogRange.x, uFogRange.y, d);
  // Las alturas escapan de la bruma: la niebla se posa sobre la calle.
  amount *= exp(-worldPos.y / uFogHeight);
  return mix(color, uFogColor, clamp(amount, 0.0, 1.0));
}
`;

/** Uniforms compartidos por todos los materiales de la ciudad. */
export function createFogUniforms() {
  return {
    uFogColor: { value: PALETTE.fogNear.clone() },
    uFocus: { value: new Vector3() },
    uFogRange: { value: [40, 160] as [number, number] },
    uFogHeight: { value: 7.0 },
  };
}

export type FogUniforms = ReturnType<typeof createFogUniforms>;

/**
 * Ajusta la niebla al encuadre actual. Al alejarse hay que empujarla mas lejos,
 * o la vista de skyline se convertiria en una mancha uniforme.
 */
export function updateFog(u: FogUniforms, focus: Vector3, viewSize: number): void {
  (u.uFocus.value as Vector3).copy(focus);
  const range = u.uFogRange.value as [number, number];
  // Rango ajustado para que la bruma alcance al borde de lo construido antes
  // de que ese borde entre en cuadro.
  range[0] = viewSize * 0.38;
  range[1] = viewSize * 1.25;
  // De cerca la bruma se queda a ras de suelo; de lejos sube y envuelve la
  // ciudad entera, que es lo que hace que un skyline lejano tenga profundidad.
  u.uFogHeight.value = 3.5 + viewSize * 0.10;
}
