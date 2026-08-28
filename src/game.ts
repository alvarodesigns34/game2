import { Clock } from 'three';
import { MAP_SIZE, TICK_DT } from './data/balance';
import { PaintResult, Tool, World } from './sim/world';
import { Buildings } from './render/buildings';
import { CityData } from './render/citydata';
import { Ground } from './render/ground';
import { IsoCamera } from './render/camera';
import { Renderer } from './render/scene';
import { updateFog } from './render/atmosphere';
import { Emitter } from './core/events';
import type { CityStats } from './sim/types';

export interface GameEvents {
  stats: CityStats;
  tool: Tool;
  speed: number;
  overlay: number;
  notice: string;
}

/** Multiplicadores de velocidad. El 0 es pausa. */
export const SPEEDS = [0, 1, 3, 10] as const;

/**
 * Union entre simulacion, render y entrada del jugador.
 *
 * La simulacion avanza a paso fijo con acumulador y el render va libre a rAF:
 * una ciudad grande que baje a 30 fps sigue simulando exactamente al mismo
 * ritmo que una pequena a 144 fps.
 */
export class Game {
  readonly world = new World(1337);
  readonly camera = new IsoCamera();
  readonly renderer: Renderer;
  readonly events = new Emitter<GameEvents>();

  private readonly data = new CityData();
  private readonly ground: Ground;
  private readonly buildings = new Buildings();
  private readonly clock = new Clock();

  private accumulator = 0;
  private elapsed = 0;
  private speedIndex = 1;
  private tool: Tool = Tool.Road;
  private overlay = 0;
  private running = false;

  /** Marca de tiempo de la ultima actualizacion de campos, para refrescar la GPU. */
  private fieldStamp = 0;
  private powerStamp = 0;

  private frameTimes: number[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.camera);
    this.ground = new Ground(this.data);
    this.renderer.scene.add(this.ground.mesh);
    this.buildings.addTo(this.renderer.scene);

    this.data.syncData(this.world.grid, true);
    this.data.syncFields(this.world.grid);
    this.buildings.sync(this.world.grid, 0, true);

    const g = this.world.grid;
    this.camera.lookAtTile((g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2);
    this.resize();
  }

  // ---------------------------------------------------------------- bucle

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const frame = () => {
      if (!this.running) return;
      this.tickFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
  }

  private tickFrame(): void {
    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;

    const speed = SPEEDS[this.speedIndex];
    if (speed > 0) {
      this.accumulator += dt * speed;
      // Tope de pasos por frame: si el navegador se atasca, la simulacion no
      // intenta recuperar cien ticks de golpe y congelar la pestana.
      let steps = 0;
      while (this.accumulator >= TICK_DT && steps < 40) {
        this.world.step();
        this.accumulator -= TICK_DT;
        steps++;
      }
      if (steps >= 40) this.accumulator = 0;
    }

    this.camera.update(dt);
    this.syncVisuals();

    this.ground.update(this.elapsed, this.camera.detail);
    this.buildings.update(this.elapsed, this.camera.detail);
    updateFog(this.ground.fogUniforms, this.camera.target, this.camera.currentViewSize);
    updateFog(this.buildings.fogUniforms, this.camera.target, this.camera.currentViewSize);
    this.renderer.setBloomForZoom(this.camera.detail);
    this.renderer.render();

    const frameMs = performance.now() - t0;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 120) this.frameTimes.shift();

    this.events.emit('stats', this.world.stats);
  }

  /** Sube a la GPU solo lo que cambio desde el frame anterior. */
  private syncVisuals(): void {
    const g = this.world.grid;
    const tick = this.world.tick;

    // La energia cambia sin alterar la geometria, pero si el encendido de las
    // fachadas: se le da su propia marca para no reconstruir de mas.
    if (tick - this.powerStamp >= 8) {
      this.powerStamp = tick;
      this.data.syncCongestion(g);
    }
    if (tick - this.fieldStamp >= 4) {
      this.fieldStamp = tick;
      this.data.syncFields(g);
    }
    this.data.syncData(g);
    this.buildings.sync(g, this.powerStamp);
  }

  // ---------------------------------------------------------------- entrada

  setTool(tool: Tool): void {
    this.tool = tool;
    this.events.emit('tool', tool);
  }

  get currentTool(): Tool {
    return this.tool;
  }

  setSpeedIndex(i: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.events.emit('speed', this.speedIndex);
  }

  get currentSpeedIndex(): number {
    return this.speedIndex;
  }

  cycleOverlay(mode?: number): void {
    this.overlay = mode ?? (this.overlay + 1) % 5;
    this.ground.setOverlay(this.overlay);
    this.events.emit('overlay', this.overlay);
  }

  get currentOverlay(): number {
    return this.overlay;
  }

  /** Aplica la herramienta activa. Devuelve true si cambio algo. */
  applyTool(x: number, y: number): boolean {
    const r = this.world.paint(x, y, this.tool);
    if (r === PaintResult.TooExpensive) this.events.emit('notice', 'Fondos insuficientes');
    else if (r === PaintResult.Locked) this.events.emit('notice', 'Ese distrito no es tuyo todavia');
    return r === PaintResult.Applied;
  }

  hoverTile(px: number, py: number): [number, number] | null {
    const [w, h] = this.renderer.size;
    const tile = this.camera.tileAtScreen(px, py, w, h);
    if (!tile) {
      this.ground.clearCursor();
      return null;
    }
    this.ground.setCursor(tile[0], tile[1], this.world.grid.isUnlocked(tile[0], tile[1]));
    return tile;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.camera.resize(w, h);
  }

  // ---------------------------------------------------------------- utilidades

  /** Milisegundos medios de frame de las ultimas muestras. */
  get averageFrameMs(): number {
    if (this.frameTimes.length === 0) return 0;
    let s = 0;
    for (const t of this.frameTimes) s += t;
    return s / this.frameTimes.length;
  }

  get buildingCount(): number {
    return this.buildings.count;
  }

  /** Encuadra la camara sobre el centro de masas de lo construido. */
  frameCity(): void {
    const c = this.buildings.centroid();
    if (c.x > 0 || c.z > 0) this.camera.lookAtTile(c.x, c.z);
    else {
      const g = this.world.grid;
      this.camera.lookAtTile((g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2);
    }
  }

  /** Avanza la simulacion sin render. Solo para tests y depuracion. */
  fastForward(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.world.step();
    updateFog(this.ground.fogUniforms, this.camera.target, this.camera.currentViewSize);
    updateFog(this.buildings.fogUniforms, this.camera.target, this.camera.currentViewSize);
    this.world.forceRefresh();
    this.data.syncData(this.world.grid, true);
    this.data.syncFields(this.world.grid);
    this.buildings.sync(this.world.grid, this.world.tick, true);
  }

  get mapSize(): number {
    return MAP_SIZE;
  }
}
