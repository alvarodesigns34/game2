import { Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ACESFilmicToneMapping, SRGBColorSpace, Vector2 } from 'three';
import { PALETTE } from './palette';
import type { IsoCamera } from './camera';

/**
 * Escena y cadena de post-proceso.
 *
 * El neon no se consigue con luces reales: miles de puntos de luz serian
 * inviables. Se consigue con materiales emisivos y una pasada de bloom
 * selectiva. Todo lo que en el shader supera el valor 1.0 se desborda y se
 * convierte en halo, asi que el brillo de la ciudad es literalmente una
 * consecuencia de lo encendida que esta.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, camera: IsoCamera) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    // ACES comprime bastante los medios tonos. En una escena nocturna, donde
    // casi todo vive en la parte baja de la curva, hay que compensar o el
    // asfalto se vuelve negro plano y se pierde el volumen de la ciudad.
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(PALETTE.night, 1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, camera.camera));

    // Umbral alto a proposito. Con umbral bajo el centro de la ciudad se
    // convierte en una mancha blanca: cuando decenas de fuentes se suman por
    // encima del umbral, el color se satura y el cian y el magenta que
    // definen la paleta desaparecen. Que florezca solo el neon de verdad.
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.72, 0.95);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.85 },
        uTint: { value: 0.16 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uTint;

        void main() {
          vec4 c = texture2D(tDiffuse, vUv);

          // Dominante frio en las sombras y calida en las luces: separa los
          // planos y evita el gris plano de una escena nocturna sin gradar.
          float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          vec3 shadowTint = vec3(0.34, 0.46, 1.0);
          vec3 lightTint  = vec3(1.0, 0.78, 0.92);
          vec3 graded = c.rgb * mix(shadowTint, lightTint, smoothstep(0.05, 0.55, luma));
          c.rgb = mix(c.rgb, graded, uTint);

          // Vineteado suave que empuja la mirada al centro del encuadre.
          vec2 p = vUv - 0.5;
          float v = 1.0 - dot(p, p) * uVignette;
          c.rgb *= clamp(v, 0.0, 1.0);

          gl_FragColor = c;
        }
      `,
    });
    this.grade.material.name = 'ciudad:gradacion';
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  /** El bloom se atenua al alejarse para que el skyline no se lave del todo. */
  setBloomForZoom(detail: number): void {
    this.bloom.strength = 0.46 + 0.18 * detail;
    this.bloom.radius = 0.82 - 0.18 * detail;
  }

  render(): void {
    this.composer.render();
  }

  get size(): [number, number] {
    return [this.width, this.height];
  }
}
