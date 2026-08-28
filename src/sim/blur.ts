/**
 * Desenfoque de caja separable sobre un campo escalar del mapa.
 *
 * Se usa para difundir brillo, contaminacion, tension y deseabilidad: cada
 * fuente puntual se convierte en una mancha suave de influencia, que es lo que
 * hace que la cercania importe sin necesidad de calcular distancias reales.
 * Dos pasadas de caja aproximan bien una gaussiana y cuestan O(n) por pasada.
 */
export function blurField(
  field: Float32Array,
  scratch: Float32Array,
  w: number,
  radius: number,
  passes: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (radius < 1 || passes < 1) return;
  const inv = 1 / (radius * 2 + 1);

  for (let p = 0; p < passes; p++) {
    // Horizontal: field -> scratch
    for (let y = minY; y <= maxY; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += field[row + clamp(minX + k, minX, maxX)];
      }
      for (let x = minX; x <= maxX; x++) {
        scratch[row + x] = sum * inv;
        const out = row + clamp(x - radius, minX, maxX);
        const inn = row + clamp(x + radius + 1, minX, maxX);
        sum += field[inn] - field[out];
      }
    }
    // Vertical: scratch -> field
    for (let x = minX; x <= maxX; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += scratch[clamp(minY + k, minY, maxY) * w + x];
      }
      for (let y = minY; y <= maxY; y++) {
        field[y * w + x] = sum * inv;
        const out = clamp(y - radius, minY, maxY) * w + x;
        const inn = clamp(y + radius + 1, minY, maxY) * w + x;
        sum += scratch[inn] - scratch[out];
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
