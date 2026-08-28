import { Tool } from '../sim/world';
import type { Game } from '../game';

/** Herramienta asignada a cada tecla numerica. */
const TOOL_KEYS: Record<string, Tool> = {
  '1': Tool.Road,
  '2': Tool.Residential,
  '3': Tool.Commercial,
  '4': Tool.Industrial,
  '5': Tool.Park,
  '6': Tool.PowerPlant,
  '7': Tool.OrderPost,
  '0': Tool.Bulldoze,
};

/**
 * Raton y teclado.
 *
 * El boton izquierdo siempre construye y el derecho siempre desplaza: son los
 * dos gestos que el jugador repite miles de veces, y mezclarlos con
 * modificadores convertiria trazar una avenida en un ejercicio de precision.
 */
export function installInput(canvas: HTMLCanvasElement, game: Game): void {
  let painting = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  let lastTile: [number, number] | null = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 0) {
      painting = true;
      lastTile = null;
      paintAt(e.clientX, e.clientY);
    } else {
      panning = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (panning) {
      game.camera.panByPixels(dx, dy, canvas.clientHeight);
      return;
    }
    game.hoverTile(e.clientX, e.clientY);
    if (painting) paintAt(e.clientX, e.clientY);
  });

  const endPointer = (e: PointerEvent) => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    painting = false;
    panning = false;
    lastTile = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      game.camera.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.repeat && !'zx'.includes(e.key.toLowerCase())) return;
    const tool = TOOL_KEYS[e.key];
    if (tool !== undefined) {
      game.setTool(tool);
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'q': game.camera.rotate(-1); break;
      case 'e': game.camera.rotate(1); break;
      case 'z': game.camera.tiltBy(-0.09); break;
      case 'x': game.camera.tiltBy(0.09); break;
      case ' ': e.preventDefault(); game.setSpeedIndex(game.currentSpeedIndex === 0 ? 1 : 0); break;
      case 'f': game.frameCity(); break;
      case 'g': game.setExpanding(!game.isExpanding); break;
      case 'tab': e.preventDefault(); game.cycleOverlay(); break;
      case 'escape': game.cycleOverlay(0); break;
      case '+': case '=': game.camera.zoomBy(1 / 1.25); break;
      case '-': game.camera.zoomBy(1.25); break;
      default: break;
    }
  });

  /**
   * Interpola entre la casilla anterior y la actual: sin esto, arrastrar
   * rapido para trazar una avenida larga deja huecos alli donde el navegador
   * no emitio evento.
   */
  function paintAt(px: number, py: number): void {
    const tile = game.hoverTile(px, py);
    if (!tile) return;
    if (lastTile) {
      const [x0, y0] = lastTile;
      const [x1, y1] = tile;
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        game.applyTool(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
      }
    } else {
      game.applyTool(tile[0], tile[1]);
    }
    lastTile = tile;
  }
}

