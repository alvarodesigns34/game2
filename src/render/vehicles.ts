import {
  BoxGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type Object3D,
  ShaderMaterial,
} from 'three';
import { ROAD_CAPACITY } from '../data/balance';
import { Rng } from '../core/rng';
import type { Grid } from '../sim/grid';
import { Zone } from '../sim/types';
import { FOG_GLSL, createFogUniforms, type FogUniforms } from './atmosphere';

/** Direcciones cardinales. El indice se guarda en un Uint8 por vehiculo. */
const DIR_X = [1, -1, 0, 0] as const;
const DIR_Z = [0, 0, 1, -1] as const;
/** Angulo de guinada de cada direccion, precalculado como coseno y seno. */
const DIR_COS = [0, 0, 1, -1] as const;
const DIR_SIN = [1, -1, 0, 0] as const;
/** Direccion opuesta, para prohibir el cambio de sentido. */
const DIR_OPPOSITE = [1, 0, 3, 2] as const;
/** Pesos temporales del sorteo de giro. Modular para no reservar por vehiculo. */
const WEIGHTS = new Float64Array(4);

/**
 * Los vehiculos van deliberadamente sobredimensionados respecto a la escala
 * real. A la distancia a la que se juega, un coche a escala ocupa tres pixeles
 * y el trafico deja de verse; lo que importa no es su tamano correcto sino que
 * el rio de luz se lea.
 */
const CAR_W = 0.21;
const CAR_H = 0.16;
const CAR_L = 0.44;
/** Separacion del eje de la calzada: los vehiculos circulan por su carril. */
const LANE_OFFSET = 0.19;

/**
 * Trafico visible.
 *
 * Los vehiculos son decorativos pero honestos: no llevan pasajeros ni buscan
 * destino, pero su velocidad la dicta la congestion real que calcula la
 * simulacion en esa misma calle. Si ves un atasco, hay un atasco de verdad, y
 * despejarlo con una calle nueva se ve al instante.
 *
 * Circulan por el grafo viario eligiendo giro al azar con preferencia por
 * seguir recto, que a esta escala es indistinguible de un trafico con destino
 * y cuesta una millonesima parte.
 */
export class Vehicles {
  readonly mesh: InstancedMesh;
  readonly fogUniforms: FogUniforms;

  private capacity: number;
  private active = 0;

  private readonly tileX: Int16Array;
  private readonly tileY: Int16Array;
  private readonly dir: Uint8Array;
  private readonly progress: Float32Array;
  private readonly speed: Float32Array;
  private readonly lane: Int8Array;
  private readonly tint: Float32Array;

  /** Indices de las casillas de calle, para nacer y renacer sobre ellas. */
  private roadTiles = new Int32Array(0);
  private roadCount = 0;
  private lastRoadVersion = -1;

  private readonly rng = new Rng(0x51ed270b);

  constructor(capacity = 4200) {
    this.capacity = capacity;
    this.tileX = new Int16Array(capacity);
    this.tileY = new Int16Array(capacity);
    this.dir = new Uint8Array(capacity);
    this.progress = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.lane = new Int8Array(capacity);
    this.tint = new Float32Array(capacity * 3);

    const geometry = new BoxGeometry(CAR_W, CAR_H, CAR_L);
    geometry.translate(0, CAR_H / 2, 0);

    this.fogUniforms = createFogUniforms();
    const material = createVehicleMaterial(this.fogUniforms);
    material.name = 'ciudad:vehiculos';
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aTint', new InstancedBufferAttribute(this.tint, 3));
  }

  addTo(parent: Object3D): void {
    parent.add(this.mesh);
  }

  /** Recoge las casillas de calle cuando la red cambia. */
  private refreshRoads(g: Grid): void {
    if (g.visualVersion === this.lastRoadVersion) return;
    this.lastRoadVersion = g.visualVersion;

    let n = 0;
    const { minX, minY, maxX, maxY, w } = g;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (g.zone[y * w + x] === Zone.Road) n++;
      }
    }
    if (this.roadTiles.length < n) this.roadTiles = new Int32Array(Math.max(n * 2, 1024));
    let k = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        if (g.zone[i] === Zone.Road) this.roadTiles[k++] = i;
      }
    }
    this.roadCount = k;
  }

  /**
   * Coloca un vehiculo en una calle. Se sortean varias candidatas y se escoge
   * la de mas carga: nacen ya donde hay trafico, en vez de tener que migrar.
   */
  private respawn(g: Grid, k: number): void {
    if (this.roadCount === 0) return;
    let i = this.roadTiles[this.rng.int(this.roadCount)];
    let best = g.roadLoad[i];
    for (let t = 0; t < 2; t++) {
      const c = this.roadTiles[this.rng.int(this.roadCount)];
      const load = g.roadLoad[c];
      if (load > best) {
        best = load;
        i = c;
      }
    }
    const x = i % g.w;
    const y = (i / g.w) | 0;
    this.tileX[k] = x;
    this.tileY[k] = y;
    this.dir[k] = this.rng.int(4);
    this.progress[k] = this.rng.next();
    this.speed[k] = 0.9 + this.rng.next() * 0.5;
    this.lane[k] = 1;

    // Casi todos son vehiculos anonimos y oscuros; unos pocos llevan rotulo.
    const r = this.rng.next();
    const o = k * 3;
    if (r > 0.93) {
      this.tint[o] = 1.0; this.tint[o + 1] = 0.18; this.tint[o + 2] = 0.42;
    } else if (r > 0.86) {
      this.tint[o] = 0.15; this.tint[o + 1] = 0.85; this.tint[o + 2] = 1.0;
    } else {
      const g0 = 0.05 + this.rng.next() * 0.06;
      this.tint[o] = g0; this.tint[o + 1] = g0 * 1.05; this.tint[o + 2] = g0 * 1.3;
    }
  }

  private isRoad(g: Grid, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    return g.zone[y * g.w + x] === Zone.Road;
  }

  /**
   * Avanza el trafico. `budget` limita cuantos vehiculos se dibujan segun el
   * zoom: de lejos no se distingue un coche de otro y sobran las tres cuartas
   * partes.
   */
  update(g: Grid, dt: number, budget: number): void {
    this.refreshRoads(g);

    const want = Math.min(this.capacity, budget, Math.floor(this.roadCount * 2.4));

    // Alta y baja graduales: que aparezcan de golpe cien coches se nota.
    if (this.active < want) {
      const add = Math.min(want - this.active, 90);
      for (let k = this.active; k < this.active + add; k++) this.respawn(g, k);
      this.active += add;
    } else if (this.active > want) {
      this.active = Math.max(want, this.active - 90);
    }
    this.mesh.count = this.active;
    if (this.active === 0) return;

    const m = this.mesh.instanceMatrix.array as Float32Array;
    const step = Math.min(dt, 0.05);

    for (let k = 0; k < this.active; k++) {
      let x = this.tileX[k];
      let y = this.tileY[k];

      if (!this.isRoad(g, x, y)) {
        this.respawn(g, k);
        x = this.tileX[k];
        y = this.tileY[k];
      }

      const i = y * g.w + x;
      // La congestion real de la calle frena al vehiculo. Es lo unico que ata
      // esta capa visual a la simulacion, y es suficiente para que un atasco
      // se vea antes de leer ningun numero.
      const jam = Math.min(1.6, g.roadLoad[i] / ROAD_CAPACITY);
      const factor = 1 / (1 + jam * 2.2);
      let p = this.progress[k] + this.speed[k] * step * factor;

      let d = this.dir[k];
      while (p >= 1) {
        p -= 1;
        const nx = x + DIR_X[d];
        const ny = y + DIR_Z[d];
        if (this.isRoad(g, nx, ny)) {
          x = nx;
          y = ny;
        }
        d = this.chooseDirection(g, x, y, d);
      }

      this.tileX[k] = x;
      this.tileY[k] = y;
      this.dir[k] = d;
      this.progress[k] = p;

      // Posicion: centro de la casilla, desplazado por el avance a lo largo de
      // la direccion y por el carril en perpendicular.
      const dx = DIR_X[d];
      const dz = DIR_Z[d];
      const along = p - 0.5;
      const side = this.lane[k] * LANE_OFFSET;
      const px = x + 0.5 + dx * along - dz * side;
      const pz = y + 0.5 + dz * along + dx * side;

      // Matriz escrita a mano: solo hay escala y giro sobre el eje vertical en
      // cuatro angulos, asi que componerla con objetos seria tirar el tiempo.
      const c = DIR_COS[d];
      const s = DIR_SIN[d];
      const o = k * 16;
      m[o] = c; m[o + 1] = 0; m[o + 2] = -s; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = s; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
      m[o + 12] = px; m[o + 13] = 0.02; m[o + 14] = pz; m[o + 15] = 1;
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute('aTint') as InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * Elige giro en el cruce.
   *
   * La probabilidad de cada salida se pondera por la carga real de esa calle,
   * asi que los vehiculos se van concentrando solos en las arterias y dejan
   * vacias las calles de reparto. Repartidos por igual entre todas las calles
   * el trafico se leia como puntos sueltos; siguiendo la carga se convierte en
   * rios de luz, que es la imagen que da vida a la ciudad. Y ademas es
   * informacion util: las calles llenas son las calles llenas de verdad.
   */
  private chooseDirection(g: Grid, x: number, y: number, current: number): number {
    const back = DIR_OPPOSITE[current];
    let total = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_X[d];
      const ny = y + DIR_Z[d];
      if (d === back || !this.isRoad(g, nx, ny)) {
        WEIGHTS[d] = 0;
        continue;
      }
      const load = g.roadLoad[ny * g.w + nx] / ROAD_CAPACITY;
      // Seguir recto pesa el triple: girar en cada cruce daria un trafico
      // browniano que no se parece en nada a como circula la gente.
      const w = (0.55 + Math.min(1.5, load) * 0.85) * (d === current ? 3.0 : 1.0);
      WEIGHTS[d] = w;
      total += w;
    }
    if (total <= 0) {
      return this.isRoad(g, x + DIR_X[back], y + DIR_Z[back]) ? back : current;
    }
    let r = this.rng.next() * total;
    for (let d = 0; d < 4; d++) {
      r -= WEIGHTS[d];
      if (r <= 0 && WEIGHTS[d] > 0) return d;
    }
    return current;
  }

  get count(): number {
    return this.active;
  }
}

function createVehicleMaterial(fog: FogUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...fog, uDetail: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aTint;
      varying vec3 vTint;
      varying vec3 vLocal;
      varying vec3 vNormalL;
      varying vec3 vWorld;

      void main() {
        vTint = aTint;
        vLocal = position;
        vNormalL = normal;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vTint;
      varying vec3 vLocal;
      varying vec3 vNormalL;
      varying vec3 vWorld;
      uniform float uDetail;

      ${FOG_GLSL}

      void main() {
        vec3 col = vTint * 0.5;
        vec3 emissive = vec3(0.0);

        // Faros delante, pilotos detras. Es lo que convierte una fila de cajas
        // en dos rios de luz en sentidos opuestos, que es la imagen que hace
        // que una ciudad nocturna parezca estar funcionando.
        if (vNormalL.z > 0.5) {
          float lamp = smoothstep(0.055, 0.012, abs(abs(vLocal.x) - 0.062));
          emissive += vec3(1.0, 0.94, 0.82) * lamp * 3.3;
        } else if (vNormalL.z < -0.5) {
          float lamp = smoothstep(0.058, 0.016, abs(abs(vLocal.x) - 0.068));
          emissive += vec3(1.0, 0.12, 0.10) * lamp * 2.3;
        } else {
          // Franja lateral: un poco de color propio para que el trafico no sea
          // una masa gris, y un reflejo tenue en el techo.
          emissive += vTint * 0.55 * step(0.5, vNormalL.y);
        }

        gl_FragColor = vec4(applyCityFog(col + emissive, vWorld), 1.0);
      }
    `,
  });
}
