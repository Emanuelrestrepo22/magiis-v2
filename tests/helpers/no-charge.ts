// tests/helpers/no-charge.ts
// Evaluacion PURA (sin expect) de la regla «cancelacion sin cargo» sobre el detalle del viaje.
// Evidencia 2026-10-13: 122/122 viajes cancelados del carrier 1521 desde el 70669 no tienen fila
// FINALPRICEI (FINALPRICE_ID null), por lo que getDetail devuelve `amount: null`. Las 4 columnas en 0
// (no NULL) de V-13 / MG-1537 viven en TRAVEL_HISTORY / PRICEADDITIONAL tras pasar a historico
// (proceso posterior): oraculo de DB de la fase 2. El spec ejecuta las aserciones con este resultado.

export type NoChargeCheck = {
  /** El detalle expone el campo `amount` (un campo ausente no prueba «sin cargo»). */
  hasAmountField: boolean;
  /** `amount` es null o 0 explicito. */
  isNoCharge: boolean;
  amount: number | null | undefined;
};

export function noChargeCheck(detail: { amount?: number | null }): NoChargeCheck {
  return {
    hasAmountField: 'amount' in detail,
    isNoCharge: detail.amount === null || detail.amount === 0,
    amount: detail.amount
  };
}
