import { ClampToEdgeWrapping, DataTexture, LinearFilter, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import { MAP_SIZE } from '../data/balance';
import type { Grid } from '../sim/grid';
import { Zone } from '../sim/types';

/**
 * Puente entre la simulacion y la GPU.
 *
 * En vez de generar geometria para calles, aceras y solares, el estado del
 * mapa se sube como dos texturas y el suelo entero se dibuja en el shader.
 * Eso convierte 65.536 casillas en una sola llamada de dibujo, y hace que
 * pintar una avenida no cueste absolutamente nada en tiempo de render.
 */
export class CityData {
  /** R=zona, G=nivel, B=congestion, A=estado (bloqueado/libre/con energia). */
  readonly dataTexture: DataTexture;
  /** R=brillo, G=tension, B=deseabilidad, A=contaminacion. Interpolada. */
  readonly fieldTexture: DataTexture;

  private readonly dataBuf: Uint8Array;
  private readonly fieldBuf: Uint8Array;
  private lastVisualVersion = -1;

  constructor() {
    const n = MAP_SIZE * MAP_SIZE * 4;
    this.dataBuf = new Uint8Array(n);
    this.fieldBuf = new Uint8Array(n);

    this.dataTexture = new DataTexture(this.dataBuf, MAP_SIZE, MAP_SIZE, RGBAFormat, UnsignedByteType);
    this.dataTexture.magFilter = NearestFilter;
    this.dataTexture.minFilter = NearestFilter;
    this.dataTexture.wrapS = ClampToEdgeWrapping;
    this.dataTexture.wrapT = ClampToEdgeWrapping;
    this.dataTexture.needsUpdate = true;

    // El campo si se interpola: la luz derramada sobre el asfalto tiene que
    // ser continua, no cuadricularse casilla a casilla.
    this.fieldTexture = new DataTexture(this.fieldBuf, MAP_SIZE, MAP_SIZE, RGBAFormat, UnsignedByteType);
    this.fieldTexture.magFilter = LinearFilter;
    this.fieldTexture.minFilter = LinearFilter;
    this.fieldTexture.wrapS = ClampToEdgeWrapping;
    this.fieldTexture.wrapT = ClampToEdgeWrapping;
    this.fieldTexture.needsUpdate = true;
  }

  /** Sube el estado discreto. Solo hace trabajo si algo cambio de verdad. */
  syncData(g: Grid, force = false): boolean {
    if (!force && g.visualVersion === this.lastVisualVersion) return false;
    this.lastVisualVersion = g.visualVersion;

    const buf = this.dataBuf;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const i = y * MAP_SIZE + x;
        const o = i * 4;
        buf[o] = g.zone[i];
        buf[o + 1] = g.level[i];
        buf[o + 2] = Math.min(255, (g.congestion[i] * 127) | 0);
        buf[o + 3] = !g.isUnlocked(x, y) ? 0 : g.powered[i] === 1 ? 255 : 128;
      }
    }
    this.dataTexture.needsUpdate = true;
    return true;
  }

  /** Sube los campos continuos. Se llama a menor frecuencia que el render. */
  syncFields(g: Grid): void {
    const buf = this.fieldBuf;
    const { minX, minY, maxX, maxY } = g;
    // Fuera de la region desbloqueada los campos son cero y no hace falta
    // recorrerlos, pero si limpiarlos si la ciudad acaba de crecer.
    buf.fill(0);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * MAP_SIZE + x;
        const o = i * 4;
        buf[o] = Math.min(255, (g.glow[i] * 64) | 0);
        buf[o + 1] = Math.min(255, (g.tension[i] * 255) | 0);
        buf[o + 2] = Math.min(255, (g.desire[i] * 255) | 0);
        buf[o + 3] = Math.min(255, (g.pollution[i] * 128) | 0);
      }
    }
    this.fieldTexture.needsUpdate = true;
  }

  /** Actualiza solo la congestion, que cambia sin alterar la geometria. */
  syncCongestion(g: Grid): void {
    const buf = this.dataBuf;
    const { minX, minY, maxX, maxY } = g;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * MAP_SIZE + x;
        if (g.zone[i] !== Zone.Road) continue;
        buf[i * 4 + 2] = Math.min(255, (g.congestion[i] * 127) | 0);
      }
    }
    this.dataTexture.needsUpdate = true;
  }
}
