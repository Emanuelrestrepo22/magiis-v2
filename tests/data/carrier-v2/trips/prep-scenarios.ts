// tests/data/carrier-v2/trips/prep-scenarios.ts
// Catalogo PURO de escenarios de preparacion de datos del circuito administrativo (alta por UI -> cancelar ->
// «Administrative finalization» con el chofer del par QA). Cada escenario es una receta ya probada en UAT el
// 10/11 (plan docs/qa/f5-admin-circuit-multicarrier-plan.md §4.1). Sin I/O: los conceptos se resuelven por
// slot desde el perfil del carrier (`prep.otherCosts`), por nombre exacto del catalogo.
import {
  requirePrep,
  type CarrierProfile,
  type PrepCost,
  type PrepCostSlot
} from '../../../config/carrier-profiles.js';
import { round2 } from '../../../utils/money.js';

export const PREP_SCENARIO_IDS = [
  'EF-NC-COM',
  'CC',
  'EF-PLAIN',
  'EF-NC-ONLY',
  'EF-FARE0',
  'PAIR-EMPTY'
] as const;
export type PrepScenarioId = (typeof PREP_SCENARIO_IDS)[number];

export type PrepScenario = {
  id: PrepScenarioId;
  /** `cash` / `account` (cuenta corriente); null = el escenario no crea nada (verificacion). */
  payment: 'cash' | 'account' | null;
  /** Slots de otros costos del perfil; `optional` = se omite si el carrier no lo ofrece (p. ej. AR en CC). */
  slots: ReadonlyArray<{ slot: PrepCostSlot; optional?: boolean }>;
  /** Tras cerrar, edita la tarifa final a 0 (gate adicional `FR_EDIT_AFTER_SURRENDER`). */
  editFinalFareToZero: boolean;
  /** Regla del lote que prepara (decision-table.md). */
  batchRule: string;
};

export const PREP_SCENARIOS: Readonly<Record<PrepScenarioId, PrepScenario>> = {
  'EF-NC-COM': {
    id: 'EF-NC-COM',
    payment: 'cash',
    slots: [{ slot: 'cashNc' }, { slot: 'cashCom' }],
    editFinalFareToZero: false,
    batchRule: 'R01/R02 efectivo con NC: linea NC visible, base de comision sin NC'
  },
  CC: {
    id: 'CC',
    payment: 'account',
    slots: [{ slot: 'accountNc', optional: true }],
    editFinalFareToZero: false,
    batchRule: 'R02/R15 viaje CC: NC de CC fuera del efectivo, profitDiff'
  },
  'EF-PLAIN': {
    id: 'EF-PLAIN',
    payment: 'cash',
    slots: [],
    editFinalFareToZero: false,
    batchRule: 'R03 efectivo sin otros costos: linea NC oculta, entrega parcial'
  },
  'EF-NC-ONLY': {
    id: 'EF-NC-ONLY',
    payment: 'cash',
    slots: [{ slot: 'cashNc' }],
    editFinalFareToZero: false,
    batchRule: 'R04 efectivo solo NC: NC + «Other Expenses»'
  },
  'EF-FARE0': {
    id: 'EF-FARE0',
    payment: 'cash',
    slots: [{ slot: 'cashNc' }],
    editFinalFareToZero: true,
    batchRule: 'R05 tarifa final 0 sin NaN'
  },
  'PAIR-EMPTY': {
    id: 'PAIR-EMPTY',
    payment: null,
    slots: [],
    editFinalFareToZero: false,
    batchRule: 'R21 par sin pendientes (verificacion, no crea nada)'
  }
};

/**
 * `F5_PREP_SCENARIOS=EF-NC-COM,CC` -> ids validos (sin duplicados, en orden). Vacio -> []. Un id desconocido
 * lanza listando los validos (nunca se ignora en silencio).
 */
export function parseScenarioList(raw: string | undefined): PrepScenarioId[] {
  const text = raw?.trim();
  if (!text) return [];
  const out: PrepScenarioId[] = [];
  for (const part of text.split(',')) {
    const id = part.trim();
    if (!id) continue;
    if (!(PREP_SCENARIO_IDS as readonly string[]).includes(id)) {
      throw new Error(
        `F5_PREP_SCENARIOS: escenario "${id}" desconocido; validos: ${PREP_SCENARIO_IDS.join(', ')}`
      );
    }
    if (!out.includes(id as PrepScenarioId)) out.push(id as PrepScenarioId);
  }
  return out;
}

/** Conceptos del escenario resueltos desde el perfil. Un slot obligatorio ausente lanza (no se inventa). */
export function scenarioCosts(profile: CarrierProfile, scenario: PrepScenario): PrepCost[] {
  const { otherCosts } = requirePrep(profile);
  const out: PrepCost[] = [];
  for (const { slot, optional } of scenario.slots) {
    const cost = otherCosts[slot];
    if (cost) out.push(cost);
    else if (!optional) {
      throw new Error(
        `Perfil "${profile.id}": el escenario ${scenario.id} necesita el concepto «${slot}» y el carrier no lo declara`
      );
    }
  }
  return out;
}

/** Importe de un concepto sobre la tarifa base: FIX = fijo; PCT = % de la base (2 decimales). */
export function costAmount(cost: PrepCost, baseFare: number): number {
  if (cost.fixed !== undefined) return cost.fixed;
  if (cost.percent !== undefined) return round2((baseFare * cost.percent) / 100);
  throw new Error(`Concepto «${cost.name}» sin importe fijo ni porcentaje`);
}

export type ExpectedQuote = {
  costs: PrepCost[];
  /** Suma de los otros costos esperados. */
  costsTotal: number;
  /** Subtotal de los NC / comisionables (anti-vacuidad del resumen y del detalle). */
  nonCommissionable: number;
  commissionable: number;
  /** Total esperado del alta = tarifa base + otros costos. */
  total: number;
};

/**
 * Total esperado de la cotizacion: `baseFare` (total leido tras «Select Vehicle», ANTES de agregar conceptos)
 * + los otros costos del escenario. AR 1000+1000 · US 10+10 · FR 15 + 10 % de la base.
 */
export function expectedQuote(
  profile: CarrierProfile,
  scenario: PrepScenario,
  baseFare: number
): ExpectedQuote {
  const costs = scenarioCosts(profile, scenario);
  let nonCommissionable = 0;
  let commissionable = 0;
  for (const cost of costs) {
    const amount = costAmount(cost, baseFare);
    if (cost.commissionable) commissionable = round2(commissionable + amount);
    else nonCommissionable = round2(nonCommissionable + amount);
  }
  const costsTotal = round2(nonCommissionable + commissionable);
  return {
    costs,
    costsTotal,
    nonCommissionable,
    commissionable,
    total: round2(baseFare + costsTotal)
  };
}

/** Nota del alta: trazabilidad por escenario y corrida (`QA F5 UAT <escenario> <runId>`). */
export function prepNote(scenario: PrepScenarioId, runId: string, envLabel = 'UAT'): string {
  return `QA F5 ${envLabel} ${scenario} ${runId}`;
}
