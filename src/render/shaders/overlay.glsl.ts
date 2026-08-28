/**
 * Rampa de color de las capas de datos, compartida por el suelo y por los
 * edificios.
 *
 * Que las dos superficies usen exactamente la misma funcion no es solo por no
 * repetir codigo: en una vista isometrica los edificios tapan casi todo el
 * suelo, asi que una capa de datos que solo pinte el pavimento apenas se ve.
 * Tinendo tambien los volumenes, el dato cubre la ciudad entera y se lee de un
 * golpe de vista.
 */
export const OVERLAY_GLSL = /* glsl */ `
/** Valor normalizado a [0,1] de la magnitud que corresponda al modo. */
float overlayValue(float mode, vec4 fld, float cong) {
  if (mode < 1.5) return smoothstep(0.18, 0.68, fld.b);   // deseabilidad
  if (mode < 2.5) return smoothstep(0.02, 0.55, fld.g);   // tension
  if (mode < 3.5) return smoothstep(0.05, 1.05, cong);    // trafico
  return smoothstep(0.03, 1.60, fld.r * 4.0);             // brillo
}

/** La capa de trafico solo tiene sentido sobre la calzada. */
float overlayIsRoadOnly(float mode) {
  return (mode > 2.5 && mode < 3.5) ? 1.0 : 0.0;
}

vec3 overlayRamp(float mode, float v) {
  vec3 lo, mid, hi;
  if (mode < 1.5) {
    lo  = vec3(0.090, 0.008, 0.026);
    mid = vec3(0.135, 0.098, 0.006);
    hi  = vec3(0.024, 0.380, 0.185);
  } else if (mode < 2.5) {
    lo  = vec3(0.004, 0.013, 0.024);
    mid = vec3(0.185, 0.092, 0.006);
    hi  = vec3(0.440, 0.022, 0.056);
  } else if (mode < 3.5) {
    lo  = vec3(0.006, 0.055, 0.037);
    mid = vec3(0.200, 0.135, 0.006);
    hi  = vec3(0.500, 0.038, 0.019);
  } else {
    lo  = vec3(0.005, 0.008, 0.022);
    mid = vec3(0.038, 0.100, 0.250);
    hi  = vec3(0.155, 0.430, 0.590);
  }
  vec3 c = v < 0.5 ? mix(lo, mid, v * 2.0) : mix(mid, hi, (v - 0.5) * 2.0);

  // Curvas de nivel. Una rampa continua sobre superficie oscura es dificil de
  // leer de un vistazo; los escalones convierten el degradado en un mapa.
  float f6 = fract(v * 6.0);
  return c + vec3(0.055) * smoothstep(0.44, 0.5, f6) * smoothstep(0.56, 0.5, f6);
}

/** Fondo neutro de las capas: casi negro, para que el color solo sea dato. */
const vec3 OVERLAY_BASE = vec3(0.005, 0.007, 0.014);
`;
