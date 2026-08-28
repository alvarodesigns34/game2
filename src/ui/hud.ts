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

/**
 * Objetivos.
 *
 * No son misiones ni dan recompensa: son la respuesta a "y ahora que hago".
 * Un constructor de ciudades arranca con un mapa vacio y ninguna instruccion,
 * y sin una primera direccion el jugador no llega a descubrir que la ciudad
 * crece sola. Se completan y desaparecen; nunca vuelven a aparecer.
 */
interface Goal {
  text: string;
  hint: string;
  done: (s: CityStats) => boolean;
}

const GOALS: Goal[] = [
  { text: 'Ramifica la autopista', hint: 'Arrastra con el boton izquierdo para trazar calles', done: (s) => s.roads >= 100 },
  { text: 'Levanta una central electrica', hint: 'Tiene que tocar una calle: la energia viaja por ellas', done: (s) => s.powerSupply > 0 },
  { text: 'Zonifica viviendas junto a la calle', hint: 'No coloques edificios: la ciudad los construye sola', done: (s) => s.population > 0 },
  { text: 'Dale trabajo a tu gente', hint: 'Sin empleo, la poblacion deja de crecer', done: (s) => s.jobs >= 30 },
  { text: 'Alcanza 500 habitantes', hint: 'Zonifica mas y vigila la energia', done: (s) => s.population >= 500 },
  { text: 'Levanta tu primer rascacielos', hint: 'Un edificio solo sube de nivel si su entorno lo merece', done: (s) => s.topLevel >= 4 },
  { text: 'Anexiona un distrito nuevo', hint: 'Pulsa EXPANDIR y elige un distrito contiguo', done: (s) => s.districtsUnlocked > 4 },
  { text: 'Alcanza 5.000 habitantes', hint: 'El brillo atrae poblacion; la tension la expulsa', done: (s) => s.population >= 5000 },
];

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

    <aside class="side">
      <section class="demand-panel">
        <h2>Demanda</h2>
        <div class="bars">
          <div class="bar" data-d="0"><i></i><span>R</span></div>
          <div class="bar" data-d="1"><i></i><span>C</span></div>
          <div class="bar" data-d="2"><i></i><span>I</span></div>
        </div>
      </section>
      <section class="goals" data-goals hidden>
        <h2>Siguiente paso</h2>
        <p class="goal-text" data-goal-text></p>
        <p class="goal-hint" data-goal-hint></p>
        <div class="goal-progress"><i data-goal-bar></i></div>
      </section>
    </aside>

    <div class="alerts" data-alerts></div>
    <div class="toast" data-toast></div>

    <nav class="toolbar">
      ${TOOLS.map(
        (t) => `<button data-tool="${t.tool}" style="--accent:${t.accent}">
          <kbd>${t.key}</kbd>
          <b>${t.label}</b>
          <span>${t.hint}</span>
          <em>¥${fmt.format(TOOL_COST[t.tool])}</em>
        </button>`,
      ).join('')}
      <button class="expand" data-expand>
        <kbd>G</kbd>
        <b>Expandir</b>
        <span data-expand-hint>Anexionar distrito</span>
        <em data-expand-cost>—</em>
      </button>
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

  const expandButton = root.querySelector<HTMLButtonElement>('[data-expand]')!;
  const expandCost = root.querySelector<HTMLElement>('[data-expand-cost]')!;
  const expandHint = root.querySelector<HTMLElement>('[data-expand-hint]')!;
  expandButton.addEventListener('click', () => game.setExpanding(!game.isExpanding));

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
  const toast = root.querySelector<HTMLElement>('[data-toast]')!;
  const goals = root.querySelector<HTMLElement>('[data-goals]')!;
  const goalText = root.querySelector<HTMLElement>('[data-goal-text]')!;
  const goalHint = root.querySelector<HTMLElement>('[data-goal-hint]')!;
  const goalBar = root.querySelector<HTMLElement>('[data-goal-bar]')!;

  const syncTool = (tool: Tool | -1) => {
    toolButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tool) === tool));
  };
  const syncExpand = (on: boolean) => expandButton.classList.toggle('is-active', on);
  const syncSpeed = (i: number) => {
    speedButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.speed) === i));
  };
  const syncOverlay = (i: number) => {
    overlayButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.overlay) === i));
  };

  game.events.on('tool', syncTool);
  game.events.on('expand', syncExpand);
  game.events.on('speed', syncSpeed);
  game.events.on('overlay', syncOverlay);
  syncTool(game.currentTool);
  syncSpeed(game.currentSpeedIndex);
  syncOverlay(game.currentOverlay);

  let toastTimer = 0;
  game.events.on('notice', (text: string) => {
    toast.textContent = text;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  });

  let goalIndex = 0;
  let lastRender = 0;

  game.events.on('stats', (s: CityStats) => {
    // El HUD se refresca a 10 Hz: mas seria trabajo de DOM tirado a la basura.
    const now = performance.now();
    if (now - lastRender < 100) return;
    lastRender = now;

    const net = s.income - s.upkeep;
    readouts.get('money')!.textContent = `¥${fmt.format(s.money)}`;
    // Umbral, no signo: un goteo de menos de un yen por segundo no es una
    // crisis, y marcarlo en rojo en el primer fotograma solo genera ruido.
    readouts.get('money')!.parentElement!.dataset.trend = net > -1 ? 'up' : 'down';
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

    // Coste y requisito del siguiente distrito.
    const cost = game.world.nextDistrictCost;
    const need = game.world.nextDistrictPopRequirement;
    expandCost.textContent = `¥${fmt.format(cost)}`;
    const short = s.population < need;
    expandHint.textContent = short ? `Necesitas ${fmt.format(need)} hab.` : 'Anexionar distrito';
    expandButton.classList.toggle('is-blocked', short || s.money < cost);

    // Objetivos: avanzar al primero sin completar.
    while (goalIndex < GOALS.length && GOALS[goalIndex].done(s)) goalIndex++;
    if (goalIndex >= GOALS.length) {
      goals.hidden = true;
    } else {
      goals.hidden = false;
      const g = GOALS[goalIndex];
      if (goalText.textContent !== g.text) {
        goalText.textContent = g.text;
        goalHint.textContent = g.hint;
      }
      goalBar.style.setProperty('--v', `${(goalIndex / GOALS.length) * 100}%`);
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
