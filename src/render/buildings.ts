import {
  BoxGeometry,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  FOOTPRINT_COM,
  FOOTPRINT_IND,
  FOOTPRINT_RES,
  HEIGHT_COM,
  HEIGHT_IND,
  HEIGHT_ORDER_POST,
  HEIGHT_POWER_PLANT,
  HEIGHT_RES,
} from '../data/balance';
import type { Grid } from '../sim/grid';
import { Zone } from '../sim/types';
import { FOG_GLSL, createFogUniforms, type FogUniforms } from './atmosphere';
import { PALETTE, rgb } from './palette';
import { NOISE_GLSL } from './shaders/noise.glsl';

/** Siluetas disponibles. Tres variantes bastan para que el skyline no se repita. */
const enum Silhouette {
  Slab = 0,
  Tower = 1,
  Spire = 2,
}
const VARIANTS = 3;

/**
 * Construye una caja unitaria con la base en y=0 y altura 1, para que al
 * escalarla por la altura real el edificio siempre nazca del suelo.
 */
function unitBox(w: number, h: number, d: number, y: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return g;
}

function buildSilhouette(kind: Silhouette): BufferGeometry {
  switch (kind) {
    case Silhouette.Slab:
      return unitBox(1, 1, 1, 0);
    case Silhouette.Tower:
      // Cuerpo con retranqueo: el escalon es lo que da lectura de rascacielos.
      return mergeGeometries([unitBox(1, 0.70, 1, 0), unitBox(0.66, 0.30, 0.66, 0.70)])!;
    case Silhouette.Spire:
      return mergeGeometries([
        unitBox(1, 0.80, 1, 0),
        unitBox(0.58, 0.13, 0.58, 0.80),
        unitBox(0.10, 0.07, 0.10, 0.93),
      ])!;
  }
}

/**
 * Todos los edificios de la ciudad, en tres llamadas de dibujo.
 *
 * La clave del rendimiento y del aspecto es la misma: no hay geometria de
 * ventanas. Cada edificio es una caja escalada, y el fragment shader dibuja la
 * rejilla de ventanas sobre la fachada en coordenadas de mundo, corrigiendo por
 * la escala de la instancia para que cada planta mida siempre lo mismo. Asi un
 * rascacielos tiene cuarenta plantas y una casa dos, sin una sola cara extra.
 *
 * Y como el encendido de las ventanas es un atributo de instancia, un apagon se
 * aplica escribiendo un cero: no hay que reconstruir nada.
 */
export class Buildings {
  readonly meshes: InstancedMesh[] = [];
  readonly material: ShaderMaterial;

  private capacity = 0;
  private info: Float32Array[] = [];
  private size: Float32Array[] = [];
  private tint: Float32Array[] = [];
  private lastVisualVersion = -1;
  private lastPowerStamp = -1;

  private readonly dummy = new Object3D();
  private readonly scratchMatrix = new Matrix4();

  /** Numero de edificios dibujados en el ultimo reconstruido. */
  count = 0;

  readonly fogUniforms: FogUniforms;

  constructor(initialCapacity = 4096) {
    this.fogUniforms = createFogUniforms();
    this.material = createFacadeMaterial(this.fogUniforms);
    for (let v = 0; v < VARIANTS; v++) {
      const mesh = new InstancedMesh(buildSilhouette(v as Silhouette), this.material, 1);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
    }
    this.allocate(initialCapacity);
  }

  private allocate(capacity: number): void {
    this.capacity = capacity;
    this.info = [];
    this.size = [];
    this.tint = [];

    for (let v = 0; v < VARIANTS; v++) {
      const old = this.meshes[v];
      const mesh = new InstancedMesh(old.geometry, this.material, capacity);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);

      const info = new Float32Array(capacity * 4);
      const size = new Float32Array(capacity * 3);
      const tint = new Float32Array(capacity * 3);
      mesh.geometry.setAttribute('aInfo', new InstancedBufferAttribute(info, 4));
      mesh.geometry.setAttribute('aSize', new InstancedBufferAttribute(size, 3));
      mesh.geometry.setAttribute('aTint', new InstancedBufferAttribute(tint, 3));
      this.info.push(info);
      this.size.push(size);
      this.tint.push(tint);

      // Sustituir en el mismo indice para no invalidar referencias externas.
      if (old.parent) {
        old.parent.add(mesh);
        old.parent.remove(old);
      }
      old.dispose();
      this.meshes[v] = mesh;
    }
  }

  addTo(parent: Object3D): void {
    for (const m of this.meshes) parent.add(m);
  }

  /**
   * Reconstruye las instancias a partir del estado del mapa.
   * Devuelve true si hizo trabajo.
   */
  sync(g: Grid, powerStamp: number, force = false): boolean {
    if (!force && g.visualVersion === this.lastVisualVersion && powerStamp === this.lastPowerStamp) {
      return false;
    }
    this.lastVisualVersion = g.visualVersion;
    this.lastPowerStamp = powerStamp;

    const counts = [0, 0, 0];
    const { minX, minY, maxX, maxY, w } = g;

    // Primera pasada: contar para saber si hay que ampliar los buffers.
    let total = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        const z = g.zone[i] as Zone;
        if (z === Zone.PowerPlant || z === Zone.OrderPost) total++;
        else if (g.level[i] > 0 && z >= Zone.Residential && z <= Zone.Industrial) total++;
      }
    }
    if (total > this.capacity) {
      this.allocate(Math.max(total * 2, this.capacity * 2));
    }
    this.count = total;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * w + x;
        const z = g.zone[i] as Zone;
        const level = g.level[i];

        const isService = z === Zone.PowerPlant || z === Zone.OrderPost;
        if (!isService && (level === 0 || z < Zone.Residential || z > Zone.Industrial)) continue;

        const seedRaw = g.seed[i];
        const r1 = ((seedRaw & 0xffff) / 65535);
        const r2 = (((seedRaw >>> 16) & 0xffff) / 65535);

        let height: number;
        let foot: number;
        let variant: Silhouette;

        if (z === Zone.PowerPlant) {
          height = HEIGHT_POWER_PLANT;
          foot = 0.94;
          variant = Silhouette.Slab;
        } else if (z === Zone.OrderPost) {
          height = HEIGHT_ORDER_POST;
          foot = 0.72;
          variant = Silhouette.Slab;
        } else if (z === Zone.Residential) {
          height = HEIGHT_RES[level];
          foot = FOOTPRINT_RES;
          variant = level >= 4 && r1 > 0.55 ? Silhouette.Tower : Silhouette.Slab;
        } else if (z === Zone.Commercial) {
          height = HEIGHT_COM[level];
          foot = FOOTPRINT_COM;
          variant =
            level >= 5
              ? r1 > 0.45 ? Silhouette.Spire : Silhouette.Tower
              : level >= 3
                ? r1 > 0.5 ? Silhouette.Tower : Silhouette.Slab
                : Silhouette.Slab;
        } else {
          height = HEIGHT_IND[level];
          foot = FOOTPRINT_IND;
          variant = Silhouette.Slab;
        }

        // Variacion de altura por casilla: sin esto una manzana entera del
        // mismo nivel produce una linea de tejados plana y artificial.
        height *= 0.66 + r2 * 0.72;
        const width = foot * (0.9 + r1 * 0.12);
        const depth = foot * (0.9 + r2 * 0.12);

        const slot = counts[variant]++;
        if (slot >= this.capacity) continue;

        this.dummy.position.set(x + 0.5, 0, y + 0.5);
        this.dummy.scale.set(width, height, depth);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.meshes[variant].setMatrixAt(slot, this.dummy.matrix);

        const info = this.info[variant];
        info[slot * 4 + 0] = r1;
        info[slot * 4 + 1] = z;
        info[slot * 4 + 2] = level;
        info[slot * 4 + 3] = g.powered[i] === 1 ? 1 : 0;

        const sz = this.size[variant];
        sz[slot * 3 + 0] = width;
        sz[slot * 3 + 1] = height;
        sz[slot * 3 + 2] = depth;

        const t = this.tint[variant];
        const c = neonFor(z, r1);
        t[slot * 3 + 0] = c[0];
        t[slot * 3 + 1] = c[1];
        t[slot * 3 + 2] = c[2];
      }
    }

    for (let v = 0; v < VARIANTS; v++) {
      const mesh = this.meshes[v];
      mesh.count = counts[v];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      (mesh.geometry.getAttribute('aInfo') as InstancedBufferAttribute).needsUpdate = true;
      (mesh.geometry.getAttribute('aSize') as InstancedBufferAttribute).needsUpdate = true;
      (mesh.geometry.getAttribute('aTint') as InstancedBufferAttribute).needsUpdate = true;
    }
    return true;
  }

  update(time: number, detail: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uDetail.value = detail;
  }

  /** Solo para depuracion: posicion media de los edificios, para encuadrar. */
  centroid(): Vector3 {
    const out = new Vector3();
    let n = 0;
    for (const mesh of this.meshes) {
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, this.scratchMatrix);
        out.x += this.scratchMatrix.elements[12];
        out.z += this.scratchMatrix.elements[14];
        n++;
      }
    }
    if (n > 0) out.divideScalar(n);
    return out;
  }
}

/** Color de neon del edificio, elegido de forma estable por su semilla. */
function neonFor(zone: Zone, r: number): [number, number, number] {
  if (zone === Zone.Commercial) {
    const c = r < 0.38 ? PALETTE.neonCyan : r < 0.72 ? PALETTE.neonMagenta : PALETTE.neonViolet;
    return rgb(c);
  }
  if (zone === Zone.Industrial) return rgb(r < 0.7 ? PALETTE.neonAmber : PALETTE.neonRed);
  if (zone === Zone.PowerPlant) return rgb(PALETTE.neonCyan);
  if (zone === Zone.OrderPost) return rgb(PALETTE.neonRed);
  return rgb(r < 0.75 ? PALETTE.windowRes : PALETTE.neonAmber);
}

function createFacadeMaterial(fog: FogUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...fog,
      uTime: { value: 0 },
      uDetail: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aInfo;
      attribute vec3 aSize;
      attribute vec3 aTint;

      varying vec2 vFacade;
      varying float vFace;
      varying vec4 vInfo;
      varying vec3 vTint;
      varying vec3 vNormalL;
      varying float vHeight;
      varying vec3 vWorld;

      void main() {
        vec3 p = position;
        vec3 n = normal;

        // Coordenadas de fachada en unidades de mundo. Este es el truco que
        // sostiene toda la estetica: al multiplicar por el tamano real de la
        // instancia, la rejilla de ventanas deja de depender de la escala y
        // cada planta mide lo mismo en un chalet que en una torre de 40 pisos.
        if (abs(n.y) > 0.5) {
          vFace = 0.0;
          vFacade = vec2(p.x * aSize.x, p.z * aSize.z);
        } else if (abs(n.x) > 0.5) {
          vFace = 1.0;
          vFacade = vec2(p.z * aSize.z, p.y * aSize.y);
        } else {
          vFace = 1.0;
          vFacade = vec2(p.x * aSize.x, p.y * aSize.y);
        }

        vInfo = aInfo;
        vTint = aTint;
        vNormalL = n;
        vHeight = aSize.y;

        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vFacade;
      varying float vFace;
      varying vec4 vInfo;
      varying vec3 vTint;
      varying vec3 vNormalL;
      varying float vHeight;
      varying vec3 vWorld;

      uniform float uTime;
      uniform float uDetail;

      ${NOISE_GLSL}
      ${FOG_GLSL}

      const vec3 C_CONCRETE = vec3(${rgb(PALETTE.concrete).join(', ')});
      const vec3 C_DARK     = vec3(${rgb(PALETTE.concreteDark).join(', ')});
      const vec3 C_WIN_RES  = vec3(${rgb(PALETTE.windowRes).join(', ')});
      const vec3 C_WIN_COM  = vec3(${rgb(PALETTE.windowCom).join(', ')});
      const vec3 C_WIN_IND  = vec3(${rgb(PALETTE.windowInd).join(', ')});

      /** Ancho y alto de una ventana, en unidades de mundo. */
      const float WIN_W = 0.170;
      const float WIN_H = 0.255;

      void main() {
        float seed  = vInfo.x;
        float zone  = vInfo.y;
        float level = vInfo.z;
        float lit   = vInfo.w;

        bool isRes = zone < 2.5;
        bool isCom = zone > 2.5 && zone < 3.5;
        bool isInd = zone > 3.5 && zone < 4.5;
        bool isPlant = zone > 5.5 && zone < 6.5;
        bool isOrder = zone > 6.5;

        /**
         * Color de ventana. El comercio reparte entre tres blancos distintos
         * segun la semilla del edificio: con un unico cian, el centro se
         * convertia en un bloque monocromo del tamano de media pantalla, y un
         * skyline real nunca tiene una sola temperatura de color.
         */
        float wsel = hash21(vec2(seed * 53.0, 11.0));
        vec3 comWin = wsel < 0.40 ? C_WIN_COM
                    : wsel < 0.76 ? vec3(0.80, 0.87, 1.00)
                    :               vec3(1.00, 0.88, 0.74);
        vec3 winColor = isRes ? C_WIN_RES : isCom ? comWin : C_WIN_IND;
        vec3 col = mix(C_DARK, C_CONCRETE, 0.35 + seed * 0.5);
        vec3 emissive = vec3(0.0);

        if (vFace < 0.5) {
          // ------------------------------------------------------- cubierta
          // Vista cenital: la cubierta es la superficie que mas ocupa la
          // pantalla. Es donde vive la oscuridad de la escena, y sin ella no
          // hay contraste contra el que lea el neon.
          col *= 0.34;
          vec2 rid = floor(vFacade * 7.0);
          float h = hash21(rid + seed * 31.0);
          col = mix(col, col * 2.4, step(0.76, h));
          // Peto perimetral: un filo claro que separa un tejado del siguiente.
          vec2 edge = abs(vFacade) / max(vec2(0.0001), abs(vFacade) + 0.0001);
          float rim = smoothstep(0.34, 0.46, max(abs(vFacade.x), abs(vFacade.y)) / max(0.2, vHeight * 0.0 + 0.5));
          col += vec3(0.012, 0.015, 0.024) * rim;

          // Baliza roja de obstaculo en los edificios altos.
          if (vHeight > 3.0) {
            float blink = step(0.55, fract(uTime * 0.45 + seed));
            float dist = length(vFacade);
            emissive += vec3(1.0, 0.08, 0.1) * blink * smoothstep(0.10, 0.0, dist) * 2.2;
          }
        } else {
          // ------------------------------------------------------- fachada
          float y = vFacade.y;

          vec2 cell = vFacade / vec2(WIN_W, WIN_H);
          vec2 id = floor(cell);
          vec2 fr = fract(cell);

          // Marco de la ventana con bordes suaves, para que no aliasee al
          // alejar la camara.
          // Ventanas pequenas dentro de su modulo. Con marcos estrechos la
          // ventana ocupaba el 36% de la fachada y el edificio entero se leia
          // como un panel encendido en vez de como un edificio con luces.
          vec2 frame = smoothstep(vec2(0.0), vec2(0.30), fr) *
                       smoothstep(vec2(1.0), vec2(0.70), fr);
          float win = frame.x * frame.y;

          float r = hash21(id + seed * 137.0);

          // Cuanto mas alto el nivel, mas ocupacion y mas vida dentro.
          // Proporcion de ventanas encendidas. En una ciudad real de noche es
          // una minoria: si se enciende la mitad, el edificio deja de tener
          // ventanas y pasa a ser una farola.
          float occupancy = isRes ? 0.16 + level * 0.05
                          : isCom ? 0.36 + level * 0.055
                          : 0.13 + level * 0.03;
          float on = step(1.0 - occupancy, r);

          // Parpadeo lento y desincronizado: la ciudad nunca esta quieta.
          float flick = 0.72 + 0.28 * sin(uTime * (0.35 + r * 1.4) + r * 62.0);
          // Unas pocas ventanas parpadean de verdad, como un fluorescente roto.
          float broken = step(0.965, r) * step(0.5, fract(uTime * 3.1 + r * 20.0));

          float windowLight = win * on * lit * (flick - broken * 0.6);
          emissive += winColor * max(windowLight, 0.0) * (isCom ? 0.95 : isRes ? 0.30 : 0.45);

          // Cristal apagado: refleja un poco de cielo, no es negro.
          col = mix(col, col * 0.45 + vec3(0.03, 0.05, 0.09), win * 0.8);

          // Forjados: linea oscura entre plantas, da escala al volumen.
          float slab = smoothstep(0.06, 0.0, abs(fr.y - 0.02));
          col *= 1.0 - slab * 0.35;

          // ---------------------------------------------------- neon
          // Zocalo comercial: la luz de escaparate a pie de calle es lo que
          // hace que la acera se sienta habitada.
          float plinth = smoothstep(0.26, 0.04, y) * step(0.015, y);
          float plinthPower = isCom ? 1.30 : isRes ? 0.07 : 0.30;
          emissive += vTint * plinth * lit * plinthPower * (0.55 + 0.45 * step(1.5, level));

          // Corona iluminada bajo la cornisa. Solo en comercio: puesta en todo
          // lo que pasara de nivel 3 dibujaba un anillo brillante alrededor de
          // cada bloque de viviendas, y la ciudad entera se convertia en una
          // retícula acolchada de rectangulos luminosos.
          if (isCom && level > 2.5) {
            float crown = smoothstep(0.14, 0.03, abs(y - (vHeight - 0.10)));
            emissive += vTint * crown * lit * 1.6;
          } else if (isRes && level > 3.5) {
            float crown = smoothstep(0.08, 0.02, abs(y - (vHeight - 0.06)));
            emissive += vTint * crown * lit * 0.22;
          }

          // Cartel vertical: solo en una cara y solo en algunos edificios.
          if (isCom && level > 2.5) {
            float hasSign = step(0.45, hash21(vec2(seed * 91.0, 7.0)));
            float sx = (hash21(vec2(seed * 17.0, 3.0)) - 0.5) * 0.42;
            float band = smoothstep(0.055, 0.02, abs(vFacade.x - sx));
            float span = step(0.35, y) * step(y, vHeight * 0.82);
            float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + seed * 30.0);
            emissive += vTint * band * span * hasSign * lit * pulse * 2.1;
          }

          // Franjas horizontales de neon en industria y servicios.
          if (isInd || isPlant || isOrder) {
            float stripe = smoothstep(0.035, 0.008, abs(fract(y * 1.1) - 0.5));
            float speed = isOrder ? 2.6 : 0.8;
            float pulse = isOrder ? step(0.5, fract(uTime * speed + seed)) : 1.0;
            emissive += vTint * stripe * lit * pulse * (isPlant ? 1.3 : 0.55);
          }
        }

        // Oscurecimiento de las caras que miran al norte: sin luces reales,
        // esta variacion por orientacion es lo que evita que los volumenes se
        // lean como siluetas planas recortadas.
        float facing = 0.72 + 0.28 * clamp(dot(normalize(vNormalL), normalize(vec3(0.6, 0.5, 0.62))), 0.0, 1.0);
        col *= facing;

        // Un edificio a oscuras se apaga de verdad: solo queda su volumen.
        col *= mix(0.55, 1.0, lit);

        gl_FragColor = vec4(applyCityFog(col + emissive, vWorld), 1.0);
      }
    `,
  });
}
