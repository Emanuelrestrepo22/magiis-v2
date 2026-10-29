// tests/data/carrier-v2/trips/other-costs.rules.f1.ts
// Reglas de negocio de la FASE 1 (MG-995/MG-996) para el importe de un Otro Costo en el alta de
// viaje. Plan MG-990-fase1 §5.1 («Reglas por fase»): la fase 2 (MG-1000, cálculo del costo) edita
// ESTE archivo, no los tests.
//
// F1: el importe de la línea sale SIEMPRE del valor de VENTA del concepto; el costo configurado
// (Costo encendido) no altera el viaje. Fuente del cálculo en el front (release v2.0.17):
// `saveOtherCost` — total = cantidad × precio para QTY/FIX/VAR; PCT = (precio / 100) × base, con
// base = precio del vehículo cuando no hay costo fijo (new-trip.component.ts:7892-7912,
// relevamiento new-trip-other-costs-2026-09-29.md §3).
// El backend persiste el PCT redondeado a 2 decimales (medido en UAT el 2026-09-29, plan §5.6);
// el request del alta viaja sin redondear y solo se registra.
import { round2 } from '../../../utils/money.js';

export type LineAmountInput =
  | { type: 'FIX' | 'QTY'; sale: number; quantity?: number }
  | { type: 'PCT'; percent: number; base: number }
  | { type: 'VAR'; amount: number };

/** Importe esperado de la línea (y del `price` persistido en `simulationPrice.otherCosts[]`). */
export function expectedLineAmount(input: LineAmountInput): number {
  switch (input.type) {
    case 'FIX':
    case 'QTY':
      return round2(input.sale * (input.quantity ?? 1));
    case 'PCT':
      return round2((input.base * input.percent) / 100);
    case 'VAR':
      return round2(input.amount);
  }
}
