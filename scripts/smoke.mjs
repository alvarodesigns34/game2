/**
 * Prueba de humo visual y funcional de CIUDAD NEON.
 *
 * Arranca el juego en Chromium, juega una partida guionizada a traves de la
 * API de depuracion, comprueba que la ciudad crece de verdad, mide el tiempo
 * de frame y guarda capturas.
 *
 * Es la pieza que cierra el bucle de trabajo: sin poder mirar el resultado no
 * hay forma de iterar la estetica de un juego de forma automatica.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'artifacts';
const PORT = 4317;
const URL = `http://127.0.0.1:${PORT}/`;

const failures = [];
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
  return ok;
}

async function waitForServer(url, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      // el servidor todavia no responde
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
  { stdio: 'ignore' },
);
const stop = () => { try { server.kill('SIGTERM'); } catch { /* ya terminado */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(1); });

if (!(await waitForServer(URL))) {
  console.error('El servidor de vista previa no arranco. Ejecuta antes `npm run build`.');
  stop();
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/**
 * El Chromium preinstalado del entorno no coincide con la build que espera
 * esta version de Playwright, asi que se apunta al binario directamente en vez
 * de descargar otro.
 */
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const browser = await chromium.launch({
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__CN), null, { timeout: 20000 });

async function shot(name, setup) {
  await page.evaluate(setup);
  // Dejar que la camara interpole y que el bloom se estabilice.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

// Primera impresion: lo que ve alguien que abre el juego por primera vez.
await shot('00-inicio', () => {
  const cn = window.__CN;
  const b = cn.bounds();
  cn.look((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  cn.zoom(46);
});

// El HUD tiene que reflejar el estado, no solo existir.
const hud = await page.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('[data-d] i'));
  const activeOverlay = document.querySelector('[data-overlay].is-active');
  return {
    demandBars: bars.map((b) => b.style.getPropertyValue('--v')),
    demandSigns: bars.map((b) => b.dataset.sign || ''),
    money: document.querySelector('[data-r="money"] b')?.textContent || '',
    goal: document.querySelector('[data-goal-text]')?.textContent || '',
    overlay: activeOverlay ? activeOverlay.textContent : null,
  };
});
check('las barras de demanda tienen altura', hud.demandBars.every((v) => v && v !== '0%'), hud.demandBars.join(' '));
check('las barras de demanda tienen signo', hud.demandSigns.every((v) => v === 'pos' || v === 'neg'));
check('el marcador de fondos muestra dinero', hud.money.includes('60.000'), hud.money);
check('el primer objetivo guia al jugador', hud.goal.length > 0, hud.goal);
check(
  'la partida arranca con una arteria preexistente',
  (await page.evaluate(() => window.__CN.stats().roads)) > 40,
);
check('la capa activa del HUD es Ciudad', hud.overlay === 'Ciudad', String(hud.overlay));

console.log('\n— construccion de la ciudad de prueba —');

/** Traza un distrito completo y lo deja creciendo solo. */
const layout = await page.evaluate(() => {
  const cn = window.__CN;
  const b = cn.bounds();
  const cx = Math.floor((b.minX + b.maxX) / 2);
  const cy = Math.floor((b.minY + b.maxY) / 2);
  cn.money(400000);

  const R = 24;
  // Retícula viaria: manzanas de 4x4 con calle cada 5 casillas.
  for (let k = -R; k <= R; k++) {
    for (let s = -R; s <= R; s++) {
      if (k % 4 === 0 || s % 4 === 0) cn.paint(cx + s, cy + k, 'road');
    }
  }

  // Centrales fuera del nucleo, colgadas de la retícula por un ramal. Hacen
  // falta varias: una metropoli madura consume mucho mas que un barrio.
  for (let n = 0; n < 5; n++) {
    const oy = (n - 2) * 6;
    cn.paint(cx + R + 1, cy + oy, 'road');
    cn.paint(cx + R + 2, cy + oy, 'power');
    cn.paint(cx - R - 1, cy + oy, 'road');
    cn.paint(cx - R - 2, cy + oy, 'power');
    for (let k = 0; k <= Math.abs(oy); k++) {
      cn.paint(cx + R + 1, cy + Math.sign(oy) * k, 'road');
      cn.paint(cx - R - 1, cy + Math.sign(oy) * k, 'road');
    }
  }

  // Zonificacion: comercio en el centro, vivienda alrededor, industria al
  // sureste y separada por una franja de parques.
  let painted = 0;
  for (let k = -R; k <= R; k++) {
    for (let s = -R; s <= R; s++) {
      const x = cx + s, y = cy + k;
      // No zonificar encima de la retícula viaria recien trazada.
      if (k % 4 === 0 || s % 4 === 0) continue;
      const d = Math.max(Math.abs(s), Math.abs(k));
      let tool;
      if (d <= 6) tool = 'com';
      else if (s > 11 && k > 11) tool = 'ind';
      else if (d === 9 && (s + k) % 3 === 0) tool = 'park';
      else tool = 'res';
      if (cn.paint(x, y, tool) === 0) painted++;
    }
  }
  return { cx, cy, painted, stats: cn.stats() };
});

check('se han zonificado casillas', layout.painted > 500, `${layout.painted} casillas`);

// Avanzar la simulacion hasta que la ciudad este madura.
const grown = await page.evaluate(() => {
  const cn = window.__CN;
  cn.money(400000);
  cn.step(6000);
  cn.money(400000);
  cn.step(2000);
  return cn.stats();
});

console.log('\n— estado tras 8000 ticks —');
console.log(
  `  poblacion ${grown.population} · empleos ${grown.jobs} · edificios ${grown.buildings} · ` +
  `brillo ${grown.glow.toFixed(0)} · tension ${(grown.tension * 100).toFixed(0)}% · ` +
  `congestion ${(grown.congestion * 100).toFixed(0)}%`,
);

check('la ciudad tiene poblacion', grown.population > 12000, `${grown.population} hab.`);
check('la ciudad tiene empleo', grown.jobs > 6000, `${grown.jobs} empleos`);
check('se han construido edificios', grown.buildings > 900, `${grown.buildings} edificios`);
check('la ciudad emite brillo', grown.glow > 180, grown.glow.toFixed(0));
check(
  'la ciudad se alimenta sola',
  grown.powerDemand < grown.powerSupply,
  `${grown.powerDemand.toFixed(0)}/${grown.powerSupply}`,
);
check('el nucleo levanta rascacielos', grown.glow / Math.max(1, grown.buildings) > 0.2);

// --- capturas -------------------------------------------------------------
console.log('\n— capturas —');

await shot('01-calle', ({ cx, cy } = window.__CN.__c || {}) => {
  const cn = window.__CN;
  const b = cn.bounds();
  cn.look((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  cn.zoom(26);
  cn.overlay(0);
});
await shot('02-distrito', () => window.__CN.zoom(62));
await shot('03-skyline', () => {
  const cn = window.__CN;
  cn.zoom(92);
  cn.tilt(21);
});
await shot('04-overlay-deseabilidad', () => {
  const cn = window.__CN;
  cn.tilt(38);
  cn.zoom(62);
  cn.overlay(1);
});
await shot('05-overlay-trafico', () => {
  window.__CN.overlay(3);
});
await shot('05b-overlay-tension', () => {
  window.__CN.overlay(2);
});

// --- animacion de crecimiento ---------------------------------------------
console.log('\n— animacion de crecimiento —');
const growth = await page.evaluate(() => {
  const cn = window.__CN;
  const g = cn.world.grid;
  const tick = cn.world.tick;
  let recent = 0;
  let stale = 0;
  for (let i = 0; i < g.size; i++) {
    if (g.level[i] === 0) continue;
    if (tick - g.changedAt[i] < 40) recent++;
    else stale++;
  }
  return { recent, stale, tick };
});
check(
  'los edificios registran cuando cambiaron',
  growth.stale > 100,
  `${growth.stale} consolidados, ${growth.recent} recientes`,
);

// --- expansion de distrito ------------------------------------------------
console.log('\n— expansion —');
const expansion = await page.evaluate(() => {
  const cn = window.__CN;
  const before = cn.stats().districtsUnlocked;
  const b = cn.bounds();
  cn.money(400000);
  // Un distrito contiguo por el norte del area actual.
  const ok = cn.expand(b.minX + 4, b.minY - 4);
  return { before, ok, after: cn.stats().districtsUnlocked, bounds: cn.bounds() };
});
check('se puede anexionar un distrito contiguo', expansion.ok === true);
check(
  'la ciudad crece al anexionar',
  expansion.after === expansion.before + 1,
  `${expansion.before} -> ${expansion.after}`,
);
check(
  'el area edificable se amplia',
  expansion.bounds.minY < 96,
  `minY ${expansion.bounds.minY}`,
);

// --- apagon ---------------------------------------------------------------
console.log('\n— prueba de apagon —');
const blackout = await page.evaluate(() => {
  const cn = window.__CN;
  cn.overlay(0);
  const g = cn.world.grid;
  // Derribar todas las centrales: la ciudad entera debe quedarse a oscuras.
  let removed = 0;
  for (let i = 0; i < g.size; i++) {
    if (g.zone[i] === 6) {
      cn.paint(i % g.w, Math.floor(i / g.w), 'bulldoze');
      removed++;
    }
  }
  cn.step(60);
  return { removed, stats: cn.stats() };
});
check('se retiraron las centrales', blackout.removed >= 2, `${blackout.removed}`);
check(
  'la ciudad se queda a oscuras',
  blackout.stats.blackoutRatio > 0.9,
  `${(blackout.stats.blackoutRatio * 100).toFixed(0)}% sin luz`,
);
check('un apagon corta los ingresos', blackout.stats.income < grown.income * 0.1);
await shot('06-apagon', () => window.__CN.zoom(62));

// --- rendimiento ----------------------------------------------------------
console.log('\n— rendimiento —');
const perf = await page.evaluate(async () => {
  const cn = window.__CN;
  cn.speed(1);
  cn.zoom(62);
  await new Promise((r) => setTimeout(r, 2500));
  return cn.perf();
});
console.log(
  `  ${perf.frameMs.toFixed(2)} ms/frame con ${perf.buildings} edificios y ${perf.vehicles} vehiculos`,
);
check('hay trafico circulando', perf.vehicles > 200, `${perf.vehicles} vehiculos`);
if (consoleErrors.length > 0) {
  console.log('\n— errores de consola —');
  for (const e of consoleErrors.slice(0, 4)) console.log(`  ${e.slice(0, 900)}`);
}
check('sin errores de consola', consoleErrors.length === 0, `${consoleErrors.length} error(es)`);

await browser.close();
stop();

console.log(
  failures.length === 0
    ? '\nTodas las comprobaciones han pasado.\n'
    : `\n${failures.length} comprobacion(es) fallidas: ${failures.join(', ')}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
