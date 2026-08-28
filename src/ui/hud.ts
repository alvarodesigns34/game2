import { SPEEDS, type Game } from '../game';
import { TOOL_COST, Tool } from '../sim/world';
import type { CityStats } from '../sim/types';

interface ToolDef {
  tool: Tool;
  key: string;
  label: string;
  hint: string;
  accent: string;
}

const TOOLS: ToolDef[] = [
  { tool: Tool.Road, key: '1', label: 'Calle', hint: 'Transporte + red', accent: '#8ba3c7' },
  { tool: Tool.Residential, key: '2', label: 'Residencial', hint: 'Habitantes', accent: '#2fe08a' },
  { tool: Tool.Commercial, key: '3', label: 'Comercial', hint: 'Empleo y brillo', accent: '#3ac8ff' },
  { tool: Tool.Industrial, key: '4', label: 'Industrial', hint: 'Empleo y humo', accent: '#ffab3d' },
  { tool: Tool.Park, key: '5', label: 'Parque', hint: 'Sube el atractivo', accent: '#4fe07a' },
  { tool: Tool.PowerPlant, key: '6', label: 'Central', hint: 'Alimenta la red', accent: '#00e5ff' },
  { tool: Tool.OrderPost, key: '7', label: 'Orden', hint: 'Absorbe tension', accent: '#ff3355' },
  { tool: Tool.Bulldoze, key: '0', label: 'Derribo', hint: 'Despejar', accent: '#ff2d95' },
];

const OVERLAYS = ['Ciudad', 'Deseabilidad', 'Tension', 'Trafico', 'Brillo'];

const fmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** Construye el HUD y lo suscribe a los eventos del juego. */
export function mountHud(root: HTMLElement, game: Game): void {
  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark"></span>CIUDAD NEÓN</div>
      <div class="readouts">
        <div class="readout" data-r="money"><b>—</b><span>fondos</span></div>
        <div class="readout" data-r="pop"><b>—</b><span>habitantes</span></div>
        <div class="readout" data-r="jobs"><b>—</b><span>empleos</span></div>
        <div class="readout" data-r="power"><b>—</b><span>energía</span></div>
        <div class="readout" data-r="glow"><b>—</b><span>brillo</span></div>
        <div class="readout" data-r="tension"><b>—</b><span>tensión</span></div>
      </div>
      <div class="speed" role="group" aria-label="Velocidad">
        ${SPEEDS.map((s, i) => `<button data-speed="${i}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}
      </div>
    </header>

    <aside class="demand-panel">
      <h2>Demanda</h2>
      <div class="bars">
        <div class="bar" data-d="0"><i></i><span>R</span></div>
        <div class="bar" data-d="1"><i></i><span>C</span></div>
        <div class="bar" data-d="2"><i></i><span>I</span></div>
      </div>
    </aside>

    <div class="alerts" data-alerts></div>

    <nav class="toolbar">
      ${TOOLS.map(
        (t) => `<button data-tool="${t.tool}" style="--accent:${t.accent}">
          <kbd>${t.key}</kbd>
          <b>${t.label}</b>
          <span>${t.hint}</span>
          <em>¥${fmt.format(TOOL_COST[t.tool])}</em>
        </button>`,
      ).join('')}
    </nav>

    <div class="overlay-switch">
      ${OVERLAYS.map((o, i) => `<button data-overlay="${i}">${o}</button>`).join('')}
    </div>
  `;

  const readouts = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-r]').forEach((el) => {
    readouts.set(el.dataset.r!, el.querySelector('b')!);
  });

  const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tool]'));
  toolButtons.forEach((b) =>
    b.addEventListener('click', () => game.setTool(Number(b.dataset.tool) as Tool)),
  );

  const speedButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-speed]'));
  speedButtons.forEach((b) =>
    b.addEventListener('click', () => game.setSpeedIndex(Number(b.dataset.speed))),
  );

  const overlayButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-overlay]'));
  overlayButtons.forEach((b) =>
    b.addEventListener('click', () => game.cycleOverlay(Number(b.dataset.overlay))),
  );

  const bars = Array.from(root.querySelectorAll<HTMLElement>('[data-d] i'));
  const alerts = root.querySelector<HTMLElement>('[data-alerts]')!;

  const syncTool = (tool: Tool) => {
    toolButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tool) === tool));
  };
  const syncSpeed = (i: number) => {
    speedButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.speed) === i));
  };
  const syncOverlay = (i: number) => {
    overlayButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.overlay) === i));
  };

  game.events.on('tool', syncTool);
  game.events.on('speed', syncSpeed);
  game.events.on('overlay', syncOverlay);
  syncTool(game.currentTool);
  syncSpeed(game.currentSpeedIndex);
  syncOverlay(game.currentOverlay);

  let lastRender = 0;
  game.events.on('stats', (s: CityStats) => {
    // El HUD se refresca a 10 Hz: mas seria trabajo de DOM tirado a la basura.
    const now = performance.now();
    if (now - lastRender < 100) return;
    lastRender = now;

    const net = s.income - s.upkeep;
    readouts.get('money')!.textContent = `¥${fmt.format(s.money)}`;
    readouts.get('money')!.parentElement!.dataset.trend = net >= 0 ? 'up' : 'down';
    readouts.get('pop')!.textContent = fmt.format(s.population);
    readouts.get('jobs')!.textContent = fmt.format(s.jobs);
    readouts.get('power')!.textContent =
      s.powerSupply === 0 ? '—' : `${fmt.format(s.powerDemand)}/${fmt.format(s.powerSupply)}`;
    readouts.get('power')!.parentElement!.dataset.trend =
      s.powerDemand > s.powerSupply ? 'down' : 'up';
    readouts.get('glow')!.textContent = fmt.format(s.glow);
    readouts.get('tension')!.textContent = `${fmt1.format(s.tension * 100)}%`;
    readouts.get('tension')!.parentElement!.dataset.trend = s.tension > 0.45 ? 'down' : 'up';

    for (let k = 0; k < 3; k++) {
      const v = s.demand[k];
      bars[k].style.setProperty('--v', `${Math.abs(v) * 100}%`);
      bars[k].dataset.sign = v >= 0 ? 'pos' : 'neg';
    }

    renderAlerts(alerts, s);
  });
}

/**
 * Avisos de estado. Solo aparecen cuando hay un problema real y desaparecen
 * solos: un HUD que grita siempre acaba siendo invisible.
 */
function renderAlerts(root: HTMLElement, s: CityStats): void {
  const list: Array<[string, string]> = [];
  if (s.powerDemand > s.powerSupply) {
    list.push(['critical', `Apagón: faltan ${fmt.format(s.powerDemand - s.powerSupply)} de potencia`]);
  } else if (s.powerSupply > 0 && s.powerDemand > s.powerSupply * 0.88) {
    list.push(['warn', 'La red eléctrica está al límite']);
  }
  if (s.blackoutRatio > 0.05) {
    list.push(['critical', `${fmt.format(s.blackoutRatio * 100)}% de la ciudad sin luz`]);
  }
  if (s.congestion > 0.55) list.push(['warn', 'Atascos graves en las arterias']);
  if (s.tension > 0.5) list.push(['warn', 'La tensión se descontrola: hacen falta puestos de Orden']);
  if (s.money < 0) list.push(['critical', 'Ciudad en números rojos']);
  if (s.money < 2000 && s.income < s.upkeep) list.push(['warn', 'El mantenimiento supera los ingresos']);

  const html = list
    .map(([kind, text]) => `<div class="alert is-${kind}">${text}</div>`)
    .join('');
  if (root.dataset.cache !== html) {
    root.dataset.cache = html;
    root.innerHTML = html;
  }
}
