/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 *
 * Toda la aleatoriedad del juego pasa por aqui: una misma semilla produce
 * exactamente la misma partida, lo que hace que los tests sean deterministas
 * y que una ciudad se pueda reproducir a partir de su fichero de guardado.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Flotante en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Flotante en [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Entero de 32 bits sin signo, para semillas visuales por casilla. */
  uint32(): number {
    return (this.next() * 4294967296) >>> 0;
  }
}

/** Hash determinista de dos enteros a [0, 1). Util para ruido por casilla. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
