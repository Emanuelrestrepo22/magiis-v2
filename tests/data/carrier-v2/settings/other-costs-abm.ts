// tests/data/carrier-v2/settings/other-costs-abm.ts
// Montos por ambiente del smoke automatizado del ABM de Otros Costos (MG-995/MG-996, ATR TM-1281).
// Plan: MG-990-fase1/plan-automatizacion-smoke-abm.md §A.3 fila 6.
//
// - `carrierId` y `currencyCode` NO se duplican: salen de `otherCostsDataFor` (Nuevo Viaje).
// - Conceptos: GENERATE en cada test (por API para TM-1007/1008/1017; por la UI para TM-985/1014,
//   cuyo objeto es el alta). Acá solo los importes, para que un cambio de contrato (fase 2) edite
//   este archivo y no los tests.
// - Solo UAT en la fase 1: TEST y PROD valen null y el spec se salta con motivo estructural.
import type { AppEnv } from '../../../config/runtime.js';

export type OtherCostsAbmAmounts = {
  /** Alta Cantidad comisionable con costo unitario propio (costo ≠ venta). */
  tm985: { sale: number; cost: number };
  /** Variable con tope de venta en cero; `controlCap` = tope del par de control (habilita Guardar). */
  tm1002: { cap: number; controlCap: number };
  /** Edición aislada del valor de venta: `sale` → `newSale`, costo intacto. */
  tm1007: { sale: number; cost: number; newSale: number };
  /** Activación del costo en un concepto sin costo: `newCost` distinto del espejo de la venta. */
  tm1008: { sale: number; newCost: number };
  /** Baja de un concepto sin uso (Fijo, Chofer). */
  tm1014: { sale: number };
  /** Fila conocida con costo para el contrato del search. */
  tm1017: { sale: number; cost: number };
};

const UAT: OtherCostsAbmAmounts = {
  tm985: { sale: 10, cost: 6 },
  tm1002: { cap: 0, controlCap: 50 },
  tm1007: { sale: 20, cost: 8, newSale: 25 },
  tm1008: { sale: 15, newCost: 5 },
  tm1014: { sale: 100 },
  tm1017: { sale: 10, cost: 6 }
};

const AMOUNTS_BY_ENV: Record<AppEnv, OtherCostsAbmAmounts | null> = {
  test: null,
  uat: UAT,
  prod: null
};

/** Montos del ambiente, o null si el smoke del ABM no corre ahí. */
export function otherCostsAbmAmountsFor(env: AppEnv): OtherCostsAbmAmounts | null {
  return AMOUNTS_BY_ENV[env];
}
