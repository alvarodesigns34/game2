import { Tool } from '../sim/world';
import type { Game } from '../game';

const TOOLS: Record<string, Tool> = {
  bulldoze: Tool.Bulldoze,
  road: Tool.Road,
  res: Tool.Residential,
  com: Tool.Commercial,
  ind: Tool.Industrial,
  park: Tool.Park,
  power: Tool.PowerPlant,
  order: Tool.OrderPost,
};

/**
 * API de depuracion expuesta en `window.__CN`.
 *
 * Es lo que permite que un script de Playwright juegue una partida entera sin
 * raton, mida el rendimiento y saque capturas. Sin esto no habria forma de
 * verificar automaticamente ni la simulacion ni el aspecto del juego.
 */
export function installDebugApi(game: Game): void {
  const api = {
    game,
    world: game.world,

    tool(name: keyof typeof TOOLS) {
      game.setTool(TOOLS[name]);
    },

    paint(x: number, y: number, name: keyof typeof TOOLS) {
      return game.world.paint(x, y, TOOLS[name]);
    },

    /** Pinta un rectangulo inclusivo. */
    rect(x0: number, y0: number, x1: number, y1: number, name: keyof typeof TOOLS) {
      const t = TOOLS[name];
      let n = 0;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          if (game.world.paint(x, y, t) === 0) n++;
        }
      }
      return n;
    },

    step(n = 1) {
      game.fastForward(n);
      return game.world.stats;
    },

    stats() {
      return game.world.stats;
    },

    money(amount: number) {
      game.world.money = amount;
    },

    speed(i: number) {
      game.setSpeedIndex(i);
    },

    overlay(mode: number) {
      game.cycleOverlay(mode);
    },

    look(x: number, y: number) {
      game.camera.lookAtTile(x, y);
    },

    zoom(view: number) {
      // Convertir una anchura de vista objetivo en pasos de zoom relativos.
      game.camera.zoomBy(view / game.camera.currentViewSize);
    },

    tilt(degrees: number) {
      game.camera.setTiltDegrees(degrees);
    },

    frame() {
      game.frameCity();
    },

    perf() {
      return { frameMs: game.averageFrameMs, buildings: game.buildingCount };
    },

    bounds() {
      const g = game.world.grid;
      return { minX: g.minX, minY: g.minY, maxX: g.maxX, maxY: g.maxY };
    },
  };

  (window as unknown as { __CN: typeof api }).__CN = api;
}
