import {
  COST,
  DISTRICTS_PER_SIDE,
  DISTRICT_SIZE,
  FIELD_INTERVAL,
  GROWTH_PHASES,
  NETWORK_INTERVAL,
  START_MONEY,
  TICK_DT,
  districtCost,
  districtPopRequirement,
} from '../data/balance';
import { Rng } from '../core/rng';
import { Demand } from './demand';
import { Fields } from './fields';
import { Grid } from './grid';
import { census, type Census } from './economy';
import { updateGrowth } from './growth';
import { updatePower, type PowerResult } from './power';
import { updateTraffic, type TrafficResult } from './traffic';
import { Zone, isBuilt } from './types';
import type { CityStats } from './types';

/** Herramientas del jugador. Coinciden con las zonas salvo el derribo. */
export const enum Tool {
  Bulldoze = 0,
  Road = 1,
  Residential = 2,
  Commercial = 3,
  Industrial = 4,
  Park = 5,
  PowerPlant = 6,
  OrderPost = 7,
}

export const TOOL_COST: Record<Tool, number> = {
  [Tool.Bulldoze]: COST.bulldoze,
  [Tool.Road]: COST.road,
  [Tool.Residential]: COST.residential,
  [Tool.Commercial]: COST.commercial,
  [Tool.Industrial]: COST.industrial,
  [Tool.Park]: COST.park,
  [Tool.PowerPlant]: COST.powerPlant,
  [Tool.OrderPost]: COST.orderPost,
};

/** Resultado de intentar aplicar una herramienta en una casilla. */
export const enum PaintResult {
  Applied = 0,
  NoChange = 1,
  Locked = 2,
  TooExpensive = 3,
}

/**
 * Estado completo de la partida y orquestador del tick de simulacion.
 *
 * El orden de los sistemas dentro de `step()` no es arbitrario: la energia
 * decide quien esta encendido, el brillo solo lo emiten los edificios
 * encendidos, la deseabilidad depende del brillo y el crecimiento depende de la
 * deseabilidad. Cambiar el orden rompe la cadena causal del juego.
 */
export class World {
  readonly grid: Grid;
  readonly demand = new Demand();
  private readonly fields: Fields;
  private readonly rng: Rng;

  private readonly queue: Int32Array;
  private readonly jobDist: Uint16Array;

  money = START_MONEY;
  tick = 0;

  private lastCensus: Census = {
    population: 0, comJobs: 0, indJobs: 0, buildings: 0, roads: 0, income: 0, upkeep: 0,
  };
  private lastPower: PowerResult = { supply: 0, demand: 0, dark: 0, consumers: 0 };
  private lastTraffic: TrafficResult = { averageCongestion: 0, jammed: 0, totalTrips: 0 };

  constructor(seed = 1337) {
    this.grid = new Grid(seed);
    this.fields = new Fields(this.grid.size);
    this.rng = new Rng(seed ^ 0x5bf03635);
    this.queue = new Int32Array(this.grid.size);
    this.jobDist = new Uint16Array(this.grid.size);
    this.recomputeNetworks();
    this.fields.update(this.grid);
  }

  // ---------------------------------------------------------------- tick

  step(): void {
    const g = this.grid;
    this.tick++;

    if (g.networkDirty || this.tick % NETWORK_INTERVAL === 0) {
      this.recomputeNetworks();
    }
    if (this.tick % FIELD_INTERVAL === 0) {
      this.fields.update(g);
    }

    this.lastCensus = census(g);
    this.demand.update(
      this.lastCensus.population,
      this.lastCensus.comJobs,
      this.lastCensus.indJobs,
      this.fields.totalGlow,
      this.fields.averageTension,
    );

    updateGrowth(g, this.rng, this.demand.values, this.tick % GROWTH_PHASES);

    this.money += (this.lastCensus.income - this.lastCensus.upkeep) * TICK_DT;
  }

  private recomputeNetworks(): void {
    this.lastPower = updatePower(this.grid, this.queue);
    this.lastTraffic = updateTraffic(this.grid, this.queue, this.jobDist);
    this.grid.networkDirty = false;
  }

  // ---------------------------------------------------------------- herramientas

  /** Coste de aplicar la herramienta en esa casilla, 0 si no cambia nada. */
  costAt(x: number, y: number, tool: Tool): number {
    const g = this.grid;
    if (!g.isUnlocked(x, y)) return 0;
    const i = g.idx(x, y);
    const current = g.zone[i] as Zone;
    if (tool === Tool.Bulldoze) return current === Zone.Empty ? 0 : COST.bulldoze;
    if (current === (tool as unknown as Zone)) return 0;
    return TOOL_COST[tool];
  }

  paint(x: number, y: number, tool: Tool): PaintResult {
    const g = this.grid;
    if (!g.isUnlocked(x, y)) return PaintResult.Locked;

    const i = g.idx(x, y);
    const current = g.zone[i] as Zone;
    const target = tool === Tool.Bulldoze ? Zone.Empty : (tool as unknown as Zone);
    if (current === target) return PaintResult.NoChange;

    const cost = tool === Tool.Bulldoze ? COST.bulldoze : TOOL_COST[tool];
    if (this.money < cost) return PaintResult.TooExpensive;

    this.money -= cost;
    g.zone[i] = target;
    g.level[i] = 0;
    g.age[i] = 0;
    g.darkFor[i] = 0;
    g.powered[i] = 0;

    // Cualquier cambio que afecte a la red obliga a recalcular energia y
    // trafico antes del siguiente crecimiento.
    if (current === Zone.Road || target === Zone.Road || isBuilt(target) || isBuilt(current)) {
      g.networkDirty = true;
    }
    g.visualVersion++;
    return PaintResult.Applied;
  }

  // ---------------------------------------------------------------- distritos

  get nextDistrictCost(): number {
    return districtCost(this.grid.districtsUnlocked);
  }

  get nextDistrictPopRequirement(): number {
    return districtPopRequirement(this.grid.districtsUnlocked);
  }

  /** Motivo por el que no se puede comprar ese distrito, o null si se puede. */
  districtBlocker(x: number, y: number): string | null {
    const g = this.grid;
    const dx = (x / DISTRICT_SIZE) | 0;
    const dy = (y / DISTRICT_SIZE) | 0;
    if (dx < 0 || dy < 0 || dx >= DISTRICTS_PER_SIDE || dy >= DISTRICTS_PER_SIDE) {
      return 'Fuera del mapa';
    }
    if (g.isUnlocked(x, y)) return 'Ya es tuyo';
    if (!g.isDistrictAdjacentToUnlocked(dx, dy)) return 'No linda con la ciudad';
    if (this.lastCensus.population < this.nextDistrictPopRequirement) {
      return `Necesitas ${this.nextDistrictPopRequirement} habitantes`;
    }
    if (this.money < this.nextDistrictCost) return 'Fondos insuficientes';
    return null;
  }

  buyDistrict(x: number, y: number): boolean {
    if (this.districtBlocker(x, y) !== null) return false;
    const cost = this.nextDistrictCost;
    const dx = (x / DISTRICT_SIZE) | 0;
    const dy = (y / DISTRICT_SIZE) | 0;
    if (!this.grid.unlockDistrict(dx, dy)) return false;
    this.money -= cost;
    this.fields.update(this.grid);
    return true;
  }

  // ---------------------------------------------------------------- lectura

  get stats(): CityStats {
    const c = this.lastCensus;
    const p = this.lastPower;
    return {
      tick: this.tick,
      money: this.money,
      income: c.income,
      upkeep: c.upkeep,
      population: c.population,
      jobs: c.comJobs + c.indJobs,
      demand: [this.demand.values[0], this.demand.values[1], this.demand.values[2]],
      powerSupply: p.supply,
      powerDemand: p.demand,
      blackoutRatio: p.consumers + p.dark > 0 ? p.dark / (p.consumers + p.dark) : 0,
      congestion: this.lastTraffic.averageCongestion,
      glow: this.fields.totalGlow,
      tension: this.fields.averageTension,
      buildings: c.buildings,
      roads: c.roads,
      districtsUnlocked: this.grid.districtsUnlocked,
    };
  }

  /** Fuerza el recalculo completo. Solo para tests y para la API de depuracion. */
  forceRefresh(): void {
    this.recomputeNetworks();
    this.fields.update(this.grid);
    this.lastCensus = census(this.grid);
  }
}
