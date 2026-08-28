import {
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { DISTRICT_SIZE, MAP_SIZE } from '../data/balance';
import { FOG_GLSL, createFogUniforms, type FogUniforms } from './atmosphere';
import { PALETTE, rgb } from './palette';
import { NOISE_GLSL } from './shaders/noise.glsl';
import { OVERLAY_GLSL } from './shaders/overlay.glsl';
import type { CityData } from './citydata';

/**
 * El suelo de la ciudad: asfalto, aceras, marcas viales, solares zonificados,
 * frontera de los distritos y la luz que el neon derrama sobre el pavimento
 * mojado. Todo ello en un unico plano y una unica llamada de dibujo, resuelto
 * por completo en el fragment shader a partir de las texturas de estado.
 */
export class Ground {
  readonly mesh: Mesh;
  readonly fogUniforms: FogUniforms;
  private readonly material: ShaderMaterial;

  constructor(data: CityData) {
    // El plano desborda el mapa por los cuatro costados: su borde recto seria
    // lo primero que delata que esto es una maqueta, y a poco que se aleje la
    // camara entraria en cuadro.
    const geometry = new PlaneGeometry(MAP_SIZE * 3, MAP_SIZE * 3, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(MAP_SIZE / 2, 0, MAP_SIZE / 2);

    this.fogUniforms = createFogUniforms();
    this.material = new ShaderMaterial({
      side: DoubleSide,
      uniforms: {
        ...this.fogUniforms,
        uData: { value: data.dataTexture },
        uField: { value: data.fieldTexture },
        uMapSize: { value: MAP_SIZE },
        uDistrict: { value: DISTRICT_SIZE },
        uTime: { value: 0 },
        uDetail: { value: 1 },
        uCursor: { value: new Vector2(-1, -1) },
        uCursorSize: { value: 1 },
        uCursorColor: { value: new Vector3(0.2, 0.9, 1.0) },
        uCursorValid: { value: 1 },
        uWet: { value: 1 },
        uOverlay: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorld;

        uniform sampler2D uData;
        uniform sampler2D uField;
        uniform float uMapSize;
        uniform float uDistrict;
        uniform float uTime;
        uniform float uDetail;
        uniform vec2 uCursor;
        uniform float uCursorSize;
        uniform vec3 uCursorColor;
        uniform float uCursorValid;
        uniform float uWet;
        uniform float uOverlay;

        ${NOISE_GLSL}
        ${FOG_GLSL}
        ${OVERLAY_GLSL}

        const vec3 C_ASPHALT  = vec3(${rgb(PALETTE.asphalt).join(', ')});
        const vec3 C_SIDEWALK = vec3(${rgb(PALETTE.sidewalk).join(', ')});
        const vec3 C_LANE     = vec3(${rgb(PALETTE.laneMark).join(', ')});
        const vec3 C_LOCKED   = vec3(0.0045, 0.0058, 0.0100);
        const vec3 C_GROUND   = vec3(0.0098, 0.0125, 0.0200);
        const vec3 C_PLOT     = vec3(0.020, 0.024, 0.036);
        const vec3 C_RES      = vec3(${rgb(PALETTE.zoneRes).join(', ')});
        const vec3 C_COM      = vec3(${rgb(PALETTE.zoneCom).join(', ')});
        const vec3 C_IND      = vec3(${rgb(PALETTE.zoneInd).join(', ')});
        const vec3 C_PARK     = vec3(${rgb(PALETTE.zonePark).join(', ')});
        const vec3 C_NEON_A   = vec3(${rgb(PALETTE.neonCyan).join(', ')});
        const vec3 C_NEON_B   = vec3(${rgb(PALETTE.neonMagenta).join(', ')});
        const vec3 C_NEON_W   = vec3(${rgb(PALETTE.neonAmber).join(', ')});

        vec4 dataAt(vec2 tile) {
          vec2 uv = (floor(tile) + 0.5) / uMapSize;
          return texture2D(uData, clamp(uv, 0.0, 1.0));
        }
        float zoneAt(vec2 tile) { return floor(dataAt(tile).r * 255.0 + 0.5); }
        float isRoadAt(vec2 tile) { return 1.0 - step(0.5, abs(zoneAt(tile) - 1.0)); }
        float isOpenAt(vec2 tile) { return step(0.25, dataAt(tile).a); }

        void main() {
          vec2 tile = vWorld.xz;
          if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= uMapSize || tile.y >= uMapSize) {
            gl_FragColor = vec4(uFogColor, 1.0);
            return;
          }

          vec4 d = dataAt(tile);
          float zone  = floor(d.r * 255.0 + 0.5);
          float level = floor(d.g * 255.0 + 0.5);
          float cong  = d.b * 2.0;
          float open  = step(0.25, d.a);
          vec2 f = fract(tile);

          // ---------------------------------------------------- suelo base
          /**
           * Textura del solar. Con un color plano, el mapa vacio del comienzo
           * de la partida es literalmente un rectangulo negro: la primera
           * pantalla del juego no daba nada que mirar. Con manchas de
           * pavimento y marcas de replanteo se lee como un solar urbano de
           * noche, esperando a que lo construyan.
           */
          float grain = fbm(tile * 3.1) * 0.16 + 0.92;
          // Ojo: 'patch' es palabra reservada en GLSL ES y no compila.
          float slab = 0.78 + 0.44 * fbm(tile * 0.18 + 31.0);
          grain *= slab;
          // Marcas de replanteo cada ocho casillas.
          vec2 survey = abs(fract(tile / 8.0 + 0.5) - 0.5) * 8.0;
          float surveyLine = smoothstep(0.06, 0.0, min(survey.x, survey.y));
          /**
           * El suelo sin comprar tiene el mismo valor que el comprado y se
           * distingue por una trama, no por ser mas claro. Con diferencia de
           * luminosidad, el area edificable se leia como una bandeja
           * rectangular flotando en el vacio y la ciudad parecia una maqueta.
           * Una trama fina, ademas, desaparece sola al alejar la camara, que
           * es justo cuando esa informacion ya no hace falta.
           */
          vec3 col = C_GROUND * grain;
          col += vec3(0.030, 0.040, 0.058) * surveyLine * open * uDetail * uDetail;
          float hatch = step(0.5, fract((tile.x + tile.y) * 0.5));
          col *= mix(1.0, mix(0.62, 1.18, hatch), (1.0 - open) * uDetail * 0.85);

          // Reticula tenue solo donde se puede construir, y con menos peso al
          // alejarse: de lejos la cuadricula seria ruido puro.
          float gridLine = max(
            smoothstep(0.985, 1.0, max(f.x, f.y)),
            smoothstep(0.015, 0.0, min(f.x, f.y))
          );
          col += vec3(0.03, 0.045, 0.075) * gridLine * open * uDetail * 0.32;

          // Frontera de la ciudad: linea de contencion iluminada.
          float border = 0.0;
          border = max(border, (1.0 - isOpenAt(tile + vec2(-1.0, 0.0))) * smoothstep(0.18, 0.0, f.x));
          border = max(border, (1.0 - isOpenAt(tile + vec2( 1.0, 0.0))) * smoothstep(0.18, 0.0, 1.0 - f.x));
          border = max(border, (1.0 - isOpenAt(tile + vec2(0.0, -1.0))) * smoothstep(0.18, 0.0, f.y));
          border = max(border, (1.0 - isOpenAt(tile + vec2(0.0,  1.0))) * smoothstep(0.18, 0.0, 1.0 - f.y));
          col += vec3(0.10, 0.55, 0.95) * border * open * 0.085 * uDetail;

          // ---------------------------------------------------- solares
          bool zoned = zone >= 2.0 && zone <= 5.0;
          if (zoned) {
            vec3 tint = zone < 2.5 ? C_RES : zone < 3.5 ? C_COM : zone < 4.5 ? C_IND : C_PARK;
            if (level < 0.5) {
              // Solar zonificado sin construir. Marca de esquina, no relleno:
              // es informacion de planeamiento, no parte de la ciudad, y si
              // compite con las luces convierte el mapa en un tablero.
              vec2 e = min(f, 1.0 - f);
              float corner = step(max(e.x, e.y), 0.16) * step(min(e.x, e.y), 0.05);
              col += tint * corner * 0.30 * uDetail;
              col += tint * 0.012;
            } else {
              col = mix(col, C_PLOT, 0.85);
            }
            if (zone > 4.5) {
              // Parque: cesped oscuro con manchas de vegetacion.
              float veg = fbm(tile * 5.0);
              col = mix(vec3(0.012, 0.030, 0.020), vec3(0.020, 0.055, 0.030), veg);
              // Farolas del parque: unos pocos puntos calidos, no una mancha.
              vec2 lid = floor(tile * 2.0);
              float lamp = step(0.86, hash21(lid + 4.0));
              float ld = length(fract(tile * 2.0) - 0.5);
              col += vec3(0.5, 0.75, 0.45) * lamp * smoothstep(0.16, 0.0, ld) * 0.5;
            }
          } else if (zone >= 6.0) {
            col = mix(col, C_PLOT, 0.9);
          }

          // ---------------------------------------------------- calzada
          float road = 1.0 - step(0.5, abs(zone - 1.0));
          if (road > 0.5) {
            float rL = isRoadAt(tile + vec2(-1.0, 0.0));
            float rR = isRoadAt(tile + vec2( 1.0, 0.0));
            float rU = isRoadAt(tile + vec2(0.0, -1.0));
            float rD = isRoadAt(tile + vec2(0.0,  1.0));

            vec3 tar = C_ASPHALT * (0.85 + fbm(tile * 6.0) * 0.3);

            // Acera en los lados que no continuan en calle.
            float kerb = 0.0;
            kerb = max(kerb, (1.0 - rL) * smoothstep(0.16, 0.05, f.x));
            kerb = max(kerb, (1.0 - rR) * smoothstep(0.16, 0.05, 1.0 - f.x));
            kerb = max(kerb, (1.0 - rU) * smoothstep(0.16, 0.05, f.y));
            kerb = max(kerb, (1.0 - rD) * smoothstep(0.16, 0.05, 1.0 - f.y));
            tar = mix(tar, C_SIDEWALK, kerb * 0.9);

            // Eje central discontinuo, que se apaga en los cruces.
            float horiz = max(rL, rR);
            float vert = max(rU, rD);
            float crossing = horiz * vert;
            float lineH = horiz * smoothstep(0.045, 0.012, abs(f.y - 0.5)) * step(0.45, fract(tile.x * 1.7));
            float lineV = vert  * smoothstep(0.045, 0.012, abs(f.x - 0.5)) * step(0.45, fract(tile.y * 1.7));
            float lane = max(lineH, lineV) * (1.0 - crossing) * (1.0 - kerb);
            tar = mix(tar, C_LANE, lane * 0.85 * uDetail);

            /**
             * Alumbrado publico.
             *
             * No es decoracion: sin el, el asfalto oscuro hace desaparecer la
             * red viaria y el jugador pierde de vista lo unico que ha trazado
             * a mano. Ademas es lo que dibuja el plano de la ciudad al alejar
             * la camara, cuando los edificios ya no se distinguen.
             */
            float lampSeed = hash21(floor(tile) + 21.0);
            float lampOn = step(0.42, lampSeed);
            float side = step(0.5, hash21(floor(tile) + 7.0));
            vec2 lampPos = horiz > vert
              ? vec2(0.5, mix(0.16, 0.84, side))
              : vec2(mix(0.16, 0.84, side), 0.5);
            float ld = length(f - lampPos);
            vec3 lampCol = vec3(1.0, 0.76, 0.42);
            tar += lampCol * lampOn * (smoothstep(0.44, 0.0, ld) * 0.115 +
                                       smoothstep(0.075, 0.0, ld) * 2.10);

            col = tar;
          }

          // ---------------------------------------------------- luz derramada
          // El brillo de los edificios cercanos se refleja en el pavimento.
          // Es lo que convierte una cuadricula de cajas en una ciudad mojada.
          vec2 fuv = clamp(tile / uMapSize, 0.0, 1.0);
          vec4 fld = texture2D(uField, fuv);
          float glow = fld.r * 4.0;
          float pollution = fld.a * 2.0;

          /**
           * Contaminacion luminica. Cuatro muestras muy separadas del mismo
           * campo aproximan un desenfoque enorme por casi nada, y producen la
           * cupula de luz que toda ciudad grande proyecta sobre su entorno.
           *
           * Su verdadera funcion es de composicion: sin ella la ciudad termina
           * en un canto duro contra el vacio y se lee como una maqueta sobre
           * una bandeja, en vez de como una ciudad que sigue mas alla del
           * encuadre.
           */
          float o = 9.0 / uMapSize;
          float halo = (
            texture2D(uField, clamp(fuv + vec2( o,  0.0), 0.0, 1.0)).r +
            texture2D(uField, clamp(fuv + vec2(-o,  0.0), 0.0, 1.0)).r +
            texture2D(uField, clamp(fuv + vec2(0.0,  o), 0.0, 1.0)).r +
            texture2D(uField, clamp(fuv + vec2(0.0, -o), 0.0, 1.0)).r
          ) * 0.25 * 4.0;

          float hue = fbm(tile * 0.055 + vec2(uTime * 0.012, 0.0));
          vec3 tint = mix(C_NEON_A, C_NEON_B, smoothstep(0.35, 0.72, hue));
          tint = mix(tint, C_NEON_W, clamp(pollution * 0.55, 0.0, 1.0));

          // Charcos: manchas que concentran el reflejo y lo estiran.
          float puddle = smoothstep(0.42, 0.78, fbm(tile * 0.55 + 13.0));
          float streak = 0.55 + 0.45 * vnoise(vec2(tile.x * 2.2, tile.y * 0.25) + uTime * 0.05);
          float wetness = uWet * puddle * streak;

          float spill = glow * (0.11 + 0.58 * wetness) * (road > 0.5 ? 1.4 : 0.6);
          col += tint * spill;
          col += tint * halo * 0.055;

          // Congestion. Muy contenida en la vista normal: es un sintoma que se
          // insinua en la calle, y para leerlo de verdad esta la capa TRAFICO.
          // Tenido con fuerza, convierte la ciudad entera en una mancha roja y
          // tapa justo lo que el jugador ha construido.
          if (road > 0.5 && cong > 0.7) {
            vec3 jam = mix(vec3(0.9, 0.5, 0.12), vec3(1.0, 0.14, 0.18), smoothstep(0.85, 1.3, cong));
            col += jam * smoothstep(0.7, 1.3, cong) * 0.07;
          }

          // ---------------------------------------------------- superposiciones
          if (uOverlay > 0.5) {
            float v = overlayValue(uOverlay, fld, cong);
            float paint = mix(1.0, road, overlayIsRoadOnly(uOverlay));
            col = mix(OVERLAY_BASE, mix(OVERLAY_BASE, overlayRamp(uOverlay, v), paint), open);
          }

          // ---------------------------------------------------- cursor
          // Rectangular y de tamano variable: la misma primitiva sirve para
          // una casilla al construir y para un distrito entero al expandir.
          vec2 rel = tile - uCursor;
          float inCursor =
            step(0.0, rel.x) * step(0.0, rel.y) *
            step(rel.x, uCursorSize) * step(rel.y, uCursorSize);
          float edgeDist = min(min(rel.x, uCursorSize - rel.x),
                               min(rel.y, uCursorSize - rel.y));
          float cursorEdge = inCursor * smoothstep(0.34, 0.0, edgeDist);
          vec3 cursorCol = mix(vec3(1.0, 0.2, 0.28), uCursorColor, uCursorValid);
          col += cursorCol * (inCursor * 0.045 + cursorEdge * 0.75);

          gl_FragColor = vec4(applyCityFog(col, vWorld), 1.0);
        }
      `,
    });

    this.material.name = 'ciudad:suelo';
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(time: number, detail: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uDetail.value = detail;
  }

  setCursor(x: number, y: number, valid: boolean, size = 1): void {
    (this.material.uniforms.uCursor.value as Vector2).set(x, y);
    this.material.uniforms.uCursorValid.value = valid ? 1 : 0;
    this.material.uniforms.uCursorSize.value = size;
  }

  clearCursor(): void {
    (this.material.uniforms.uCursor.value as Vector2).set(-100, -100);
  }

  setOverlay(mode: number): void {
    this.material.uniforms.uOverlay.value = mode;
  }
}
