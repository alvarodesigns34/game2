import { MathUtils, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { MAP_SIZE } from '../data/balance';

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Camara isometrica de ciudad.
 *
 * Es ortografica a proposito: la proyeccion en perspectiva deforma las torres
 * de los bordes de la pantalla y rompe la lectura del skyline. Con ortografica
 * un rascacielos del borde se lee igual que uno del centro, que es lo que hace
 * que la ciudad se pueda "leer" de un vistazo.
 */
export class IsoCamera {
  readonly camera: OrthographicCamera;
  readonly target = new Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);

  /** Anchura visible del mundo, en casillas. Es el control de zoom. */
  private viewSize = 58;
  private viewSizeTarget = 58;
  private azimuth = Math.PI * 0.25;
  private azimuthTarget = Math.PI * 0.25;
  /**
   * Inclinacion sobre el horizonte. Regulable: a 38 grados se lee bien el
   * plano de la ciudad para construir, pero un skyline necesita bajar a 20 y
   * ver las torres recortadas contra la bruma. Son dos formas distintas de
   * mirar la misma ciudad y las dos hacen falta.
   */
  private elevation = MathUtils.degToRad(38);
  private elevationTarget = MathUtils.degToRad(38);

  static readonly MIN_TILT = MathUtils.degToRad(14);
  static readonly MAX_TILT = MathUtils.degToRad(82);

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private aspect = 1;

  static readonly MIN_VIEW = 16;
  static readonly MAX_VIEW = 190;

  constructor() {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.applyTransform();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.updateFrustum();
  }

  /** Zoom multiplicativo: cada paso de rueda escala igual a cualquier altura. */
  zoomBy(factor: number): void {
    this.viewSizeTarget = MathUtils.clamp(
      this.viewSizeTarget * factor,
      IsoCamera.MIN_VIEW,
      IsoCamera.MAX_VIEW,
    );
  }

  /** Gira la camara en pasos de 45 grados. */
  rotate(steps: number): void {
    this.azimuthTarget += (Math.PI / 4) * steps;
  }

  /** Inclina la camara. Positivo sube el punto de vista. */
  tiltBy(radians: number): void {
    this.elevationTarget = MathUtils.clamp(
      this.elevationTarget + radians,
      IsoCamera.MIN_TILT,
      IsoCamera.MAX_TILT,
    );
  }

  setTiltDegrees(deg: number): void {
    this.elevationTarget = MathUtils.clamp(
      MathUtils.degToRad(deg),
      IsoCamera.MIN_TILT,
      IsoCamera.MAX_TILT,
    );
  }

  /** Desplaza el objetivo en pixeles de pantalla, respetando la rotacion. */
  panByPixels(dx: number, dy: number, viewportHeight: number): void {
    const worldPerPixel = this.viewSize / viewportHeight;
    const forward = new Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const right = new Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    // El movimiento vertical del raton se proyecta sobre el suelo, por eso se
    // divide por el coseno de la elevacion: si no, arrastrar sensacion de
    // deslizamiento distinto en cada eje.
    this.target
      .addScaledVector(right, -dx * worldPerPixel)
      .addScaledVector(forward, (dy * worldPerPixel) / Math.cos(this.elevation));
    this.clampTarget();
  }

  /** Coloca la camara mirando a una casilla concreta. */
  lookAtTile(x: number, y: number): void {
    this.target.set(x, 0, y);
    this.clampTarget();
  }

  /** Suavizado exponencial hacia el zoom y la rotacion objetivo. */
  update(dt: number): void {
    const k = 1 - Math.exp(-12 * dt);
    this.viewSize += (this.viewSizeTarget - this.viewSize) * k;
    this.azimuth += (this.azimuthTarget - this.azimuth) * k;
    this.elevation += (this.elevationTarget - this.elevation) * k;
    this.updateFrustum();
    this.applyTransform();
  }

  /** Casilla del mapa bajo un punto de la pantalla, o null si esta fuera. */
  tileAtScreen(px: number, py: number, width: number, height: number): [number, number] | null {
    this.ndc.set((px / width) * 2 - 1, -(py / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(GROUND, hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return null;
    return [x, y];
  }

  /** Factor de detalle segun el zoom: 1 = cerca, 0 = vista de skyline. */
  get detail(): number {
    return MathUtils.clamp(1 - (this.viewSize - 40) / 90, 0, 1);
  }

  get currentViewSize(): number {
    return this.viewSize;
  }

  private updateFrustum(): void {
    const halfH = this.viewSize / 2;
    const halfW = halfH * this.aspect;
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.updateProjectionMatrix();
  }

  private applyTransform(): void {
    // Distancia fija y generosa: con proyeccion ortografica no afecta al
    // encuadre, solo tiene que cubrir el plano de recorte.
    const dist = 420;
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * cosE * dist,
      this.target.y + Math.sin(this.elevation) * dist,
      this.target.z + Math.cos(this.azimuth) * cosE * dist,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private clampTarget(): void {
    this.target.x = MathUtils.clamp(this.target.x, -20, MAP_SIZE + 20);
    this.target.z = MathUtils.clamp(this.target.z, -20, MAP_SIZE + 20);
  }
}
