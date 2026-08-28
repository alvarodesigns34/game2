import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { Zone } from '../src/sim/types';
import { updatePower } from '../src/sim/power';
import { updateTraffic } from '../src/sim/traffic';
import { Fields } from '../src/sim/fields';
import { census } from '../src/sim/economy';
import { Demand } from '../src/sim/demand';
import { PaintResult, Tool, World } from '../src/sim/world';
import { POWER_COM, POWER_PLANT_CAPACITY, ROAD_CAPACITY, START_MONEY } from '../src/data/balance';

/** Centro del area desbloqueada al inicio de la partida. */
function centre(g: Grid): [number, number] {
  return [((g.minX + g.maxX) / 2) | 0, ((g.minY + g.maxY) / 2) | 0];
}

function makeGrid(): Grid {
  return new Grid(42);
}

/** Traza una calle horizontal y devuelve sus extremos. */
function road(g: Grid, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) g.zone[g.idx(x, y)] = Zone.Road;
}

describe('Grid', () => {
  it('arranca con 4 distritos desbloqueados formando un bloque 64x64', () => {
    const g = makeGrid();
    expect(g.districtsUnlocked).toBe(4);
    expect(g.maxX - g.minX + 1).toBe(64);
    expect(g.maxY - g.minY + 1).toBe(64);
  });

  it('solo permite comprar distritos que lindan con la ciudad', () => {
    const g = makeGrid();
    expect(g.isDistrictAdjacentToUnlocked(3, 2)).toBe(true);
    expect(g.isDistrictAdjacentToUnlocked(0, 0)).toBe(false);
  });
});

describe('energia por las calles', () => {
  it('alimenta lo que toca una calle conectada a la central', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    road(g, cx, cx + 10, cy);
    g.zone[g.idx(cx - 1, cy)] = Zone.PowerPlant;

    const connected = g.idx(cx + 5, cy + 1);
    g.zone[connected] = Zone.Residential;
    g.level[connected] = 2;

    const r = updatePower(g, new Int32Array(g.size));
    expect(r.supply).toBe(POWER_PLANT_CAPACITY);
    expect(g.powered[connected]).toBe(1);
    expect(r.dark).toBe(0);
  });

  it('deja a oscuras lo que no toca ninguna calle de la red', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    road(g, cx, cx + 10, cy);
    g.zone[g.idx(cx - 1, cy)] = Zone.PowerPlant;

    // Calle aislada, sin union con la de la central.
    road(g, cx, cx + 4, cy + 6);
    const isolated = g.idx(cx + 2, cy + 7);
    g.zone[isolated] = Zone.Residential;
    g.level[isolated] = 2;

    const r = updatePower(g, new Int32Array(g.size));
    expect(g.powered[isolated]).toBe(0);
    expect(r.dark).toBe(1);
  });

  it('con deficit apaga primero lo mas lejano a la central', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    // Torres suficientes para desbordar una central, sea cual sea su
    // capacidad: el numero se deriva del balance en vez de fijarlo a mano.
    const towers = Math.ceil(POWER_PLANT_CAPACITY / POWER_COM[5]) + 6;
    const span = Math.ceil(towers / 2);
    road(g, cx, cx + span + 1, cy);
    g.zone[g.idx(cx - 1, cy)] = Zone.PowerPlant;

    // A ambos lados de la misma calle, para no salirse del area desbloqueada.
    const tiles: number[] = [];
    for (let k = 0; k < towers; k++) {
      const i = g.idx(cx + (k >> 1), cy + (k % 2 === 0 ? 1 : -1));
      g.zone[i] = Zone.Commercial;
      g.level[i] = 5;
      tiles.push(i);
    }

    const r = updatePower(g, new Int32Array(g.size));
    expect(r.demand).toBeGreaterThan(r.supply);
    expect(r.dark).toBeGreaterThan(0);
    // La primera torre esta pegada a la central y la ultima al final de la
    // calle: el apagon tiene que empezar por el final.
    expect(g.powered[tiles[0]]).toBe(1);
    expect(g.powered[tiles[tiles.length - 1]]).toBe(0);
  });

  it('es determinista entre ejecuciones identicas', () => {
    const build = () => {
      const g = makeGrid();
      const [cx, cy] = centre(g);
      road(g, cx, cx + 30, cy);
      g.zone[g.idx(cx - 1, cy)] = Zone.PowerPlant;
      for (let k = 0; k < 18; k++) {
        const i = g.idx(cx + k, cy + 1);
        g.zone[i] = Zone.Commercial;
        g.level[i] = 5;
      }
      updatePower(g, new Int32Array(g.size));
      return Array.from(g.powered);
    };
    expect(build()).toEqual(build());
  });
});

describe('trafico', () => {
  it('acumula la carga en la arteria que lleva al empleo', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    // Una sola calle: 20 casillas de vivienda a la izquierda, oficinas al final.
    road(g, cx, cx + 22, cy);
    for (let k = 0; k < 20; k++) {
      const i = g.idx(cx + k, cy + 1);
      g.zone[i] = Zone.Residential;
      g.level[i] = 3;
    }
    const job = g.idx(cx + 22, cy + 1);
    g.zone[job] = Zone.Commercial;
    g.level[job] = 4;

    const r = updateTraffic(g, new Int32Array(g.size), new Uint16Array(g.size));
    expect(r.totalTrips).toBeGreaterThan(0);

    const nearJobs = g.roadLoad[g.idx(cx + 21, cy)];
    const farFromJobs = g.roadLoad[g.idx(cx + 1, cy)];
    // El cuello de botella esta junto al destino, no en el extremo del barrio.
    expect(nearJobs).toBeGreaterThan(farFromJobs * 3);
  });

  it('satura la calle cuando toda la ciudad cuelga de una sola via', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    road(g, cx, cx + 30, cy);
    for (let k = 0; k < 28; k++) {
      const i = g.idx(cx + k, cy + 1);
      g.zone[i] = Zone.Residential;
      g.level[i] = 5;
    }
    const job = g.idx(cx + 30, cy + 1);
    g.zone[job] = Zone.Commercial;
    g.level[job] = 5;

    const r = updateTraffic(g, new Int32Array(g.size), new Uint16Array(g.size));
    expect(r.jammed).toBeGreaterThan(0);
    expect(g.roadLoad[g.idx(cx + 29, cy)]).toBeGreaterThan(ROAD_CAPACITY);
  });
});

describe('campos de deseabilidad', () => {
  it('la industria hunde la deseabilidad de lo que tiene al lado', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    for (let k = 0; k < 6; k++) {
      const i = g.idx(cx + k, cy);
      g.zone[i] = Zone.Industrial;
      g.level[i] = 4;
    }
    const fields = new Fields(g.size);
    fields.update(g);

    const nextToFactory = g.desire[g.idx(cx + 2, cy + 2)];
    const farAway = g.desire[g.idx(cx + 2, cy + 25)];
    expect(nextToFactory).toBeLessThan(farAway);
  });

  it('un parque sube la deseabilidad de su entorno', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    for (let k = 0; k < 4; k++) g.zone[g.idx(cx + k, cy)] = Zone.Park;
    const fields = new Fields(g.size);
    fields.update(g);

    expect(g.desire[g.idx(cx + 1, cy + 2)]).toBeGreaterThan(g.desire[g.idx(cx + 1, cy + 25)]);
  });

  it('un edificio a oscuras no emite brillo', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    const i = g.idx(cx, cy);
    g.zone[i] = Zone.Commercial;
    g.level[i] = 5;

    const fields = new Fields(g.size);
    fields.update(g);
    expect(g.glow[i]).toBe(0);

    g.powered[i] = 1;
    fields.update(g);
    expect(g.glow[i]).toBeGreaterThan(0);
  });

  it('el brillo genera tension y el Orden la absorbe', () => {
    const buildGlowingBlock = (withOrder: boolean) => {
      const g = makeGrid();
      const [cx, cy] = centre(g);
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const i = g.idx(cx + dx, cy + dy);
          g.zone[i] = Zone.Commercial;
          g.level[i] = 5;
          g.powered[i] = 1;
        }
      }
      if (withOrder) {
        const oi = g.idx(cx + 4, cy + 4);
        g.zone[oi] = Zone.OrderPost;
        g.powered[oi] = 1;
      }
      const fields = new Fields(g.size);
      // La tension tiene inercia, hay que dejarla asentarse.
      for (let k = 0; k < 80; k++) fields.update(g);
      return g.tension[g.idx(cx + 3, cy + 3)];
    };

    const wild = buildGlowingBlock(false);
    const policed = buildGlowingBlock(true);
    expect(wild).toBeGreaterThan(0.1);
    expect(policed).toBeLessThan(wild);
  });
});

describe('economia', () => {
  it('no recauda de un edificio sin energia', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    const i = g.idx(cx, cy);
    g.zone[i] = Zone.Residential;
    g.level[i] = 3;

    expect(census(g).income).toBe(0);
    expect(census(g).population).toBe(0);

    g.powered[i] = 1;
    const c = census(g);
    expect(c.population).toBeGreaterThan(0);
    expect(c.income).toBeGreaterThan(0);
  });

  it('las calles cuestan mantenimiento aunque no haya nadie', () => {
    const g = makeGrid();
    const [cx, cy] = centre(g);
    road(g, cx, cx + 20, cy);
    const c = census(g);
    expect(c.roads).toBe(21);
    expect(c.upkeep).toBeGreaterThan(0);
    expect(c.income).toBe(0);
  });
});

describe('demanda RCI', () => {
  it('arranca con demanda residencial en una ciudad vacia', () => {
    const d = new Demand();
    for (let k = 0; k < 200; k++) d.update(0, 0, 0, 0, 0);
    expect(d.values[0]).toBeGreaterThan(0.5);
  });

  it('una ciudad brillante atrae poblacion aunque el empleo este equilibrado', () => {
    const balanced = new Demand();
    const glowing = new Demand();
    for (let k = 0; k < 400; k++) {
      // Mismo equilibrio entre empleo y poblacion activa en ambos casos.
      balanced.update(2000, 600, 440, 0, 0);
      glowing.update(2000, 600, 440, 300, 0);
    }
    expect(glowing.values[0]).toBeGreaterThan(balanced.values[0] + 0.2);
    expect(glowing.attraction).toBeGreaterThan(0.2);
  });

  it('la tension expulsa poblacion', () => {
    const calm = new Demand();
    const tense = new Demand();
    for (let k = 0; k < 400; k++) {
      calm.update(2000, 600, 440, 300, 0.05);
      tense.update(2000, 600, 440, 300, 0.85);
    }
    expect(tense.values[0]).toBeLessThan(calm.values[0] - 0.3);
  });

  it('la demanda residencial se agota si hay gente y no hay empleo', () => {
    const d = new Demand();
    for (let k = 0; k < 400; k++) d.update(3000, 0, 0, 0, 0);
    expect(d.values[0]).toBeLessThan(0);
    // Y en cambio pide comercio, que es lo que falta.
    expect(d.values[1]).toBeGreaterThan(0.5);
  });
});

describe('World: integracion', () => {
  it('arranca con una arteria que cruza el distrito inicial', () => {
    const w = new World(7);
    const g = w.grid;
    expect(w.stats.roads).toBeGreaterThan(40);
    // Y no cuesta dinero: es infraestructura heredada, no construida.
    expect(w.money).toBe(START_MONEY);
    const y = (g.minY + g.maxY) >> 1;
    expect(g.zone[g.idx(g.minX, y)]).toBe(Zone.Road);
    expect(g.zone[g.idx(g.maxX, y)]).toBe(Zone.Road);
  });

  it('cobra al construir y respeta los distritos bloqueados', () => {
    const w = new World(7);
    const [cx, cy] = centre(w.grid);
    const before = w.money;

    // Fuera de la arteria con la que arranca la partida.
    expect(w.paint(cx, cy + 3, Tool.Road)).toBe(PaintResult.Applied);
    expect(w.money).toBeLessThan(before);
    expect(w.paint(cx, cy + 3, Tool.Road)).toBe(PaintResult.NoChange);
    // Esquina del mapa: distrito no comprado todavia.
    expect(w.paint(2, 2, Tool.Road)).toBe(PaintResult.Locked);
  });

  it('una manzana bien planteada crece sola hasta ser una ciudad', () => {
    const w = new World(7);
    const g = w.grid;
    const [cx, cy] = centre(g);

    // Retícula de calles de 24x24 con manzanas de 4.
    for (let k = -12; k <= 12; k++) {
      for (let s = -12; s <= 12; s++) {
        if (k % 4 === 0) w.paint(cx + s, cy + k, Tool.Road);
        if (s % 4 === 0) w.paint(cx + s, cy + k, Tool.Road);
      }
    }
    w.paint(cx + 13, cy, Tool.Road);
    w.paint(cx + 14, cy, Tool.PowerPlant);

    // Zonificar las manzanas: vivienda al oeste, comercio en el centro,
    // industria al este y bien lejos de las casas.
    for (let k = -12; k <= 12; k++) {
      for (let s = -12; s <= 12; s++) {
        const x = cx + s;
        const y = cy + k;
        if (g.zone[g.idx(x, y)] !== 0) continue;
        const tool = s < -3 ? Tool.Residential : s > 7 ? Tool.Industrial : Tool.Commercial;
        w.paint(x, y, tool);
      }
    }

    for (let t = 0; t < 2500; t++) w.step();

    const s = w.stats;
    expect(s.population).toBeGreaterThan(400);
    expect(s.jobs).toBeGreaterThan(100);
    expect(s.buildings).toBeGreaterThan(150);
    // La ciudad se sostiene sola: no ha entrado en quiebra.
    expect(s.money).toBeGreaterThan(0);
  });

  it('sin central electrica no se construye nada', () => {
    const w = new World(7);
    const g = w.grid;
    const [cx, cy] = centre(g);
    for (let k = -8; k <= 8; k++) w.paint(cx + k, cy, Tool.Road);
    for (let k = -8; k <= 8; k++) w.paint(cx + k, cy + 1, Tool.Residential);

    for (let t = 0; t < 800; t++) w.step();
    expect(w.stats.population).toBe(0);
    expect(w.stats.buildings).toBe(0);
  });
});
