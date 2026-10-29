// tests/data/carrier-v2/trips/commission-base.ts
// Datos de TM-1432 (MG-1537 AC3, PK-B): comision de chofer y dueno sin la parte no comisionable.
// Medidos en TEST el 2026-10-21 con SELECT (plan docs/plans/PK-B-circuito-admin-chofer-2026-10-21.md §2.2):
// - Tarifador 6203 «QA F2 Costo y Venta» (RATE_BY_COST = 1): contratista McLaren Racing Limited (1521),
//   usuario principal Zak Brown. El combo de pago de ese cliente SOLO ofrece «Credit Account»
//   (medido en UI el 2026-10-21; el plan suponia Cash).
// - Tarifador 6204 «QA F2 Venta» (RATE_BY_COST = 0): contratista Alpine (1522), autorizador Krief; ofrece Cash.
// - Conceptos del carrier 1521: 143 «QA F2 Fijo Comisionable» (venta 10 / costo 6) y
//   147 «QA F2 Fijo No Comisionable» (venta 8 / costo 4), tipo FIX, por costo.
// Los textos de cliente/autorizador se pueden sobreescribir con PKB_COST_CLIENT / PKB_COST_AUTHORIZER.

export type OtherCostConcept = {
  /** CARRIER_OTHER_COSTS.ID (se contrasta contra DB antes de crear nada). */
  id: number;
  /** Nombre exacto del catalogo (lo que se elige en el modal). */
  name: string;
  sale: number;
  cost: number;
  commissionable: boolean;
};

export const COMMISSIONABLE_CONCEPT: OtherCostConcept = {
  id: 143,
  name: 'QA F2 Fijo Comisionable',
  sale: 10,
  cost: 6,
  commissionable: true
};

export const NON_COMMISSIONABLE_CONCEPT: OtherCostConcept = {
  id: 147,
  name: 'QA F2 Fijo No Comisionable',
  sale: 8,
  cost: 4,
  commissionable: false
};

export type CommissionBaseRow = {
  /** Etiqueta corta para titulo, mensajes y ledger. */
  label: string;
  tariff: number;
  /** Tarifador por costo (6203) o solo venta (6204): decide el par de porcentajes de la configuracion. */
  byCost: boolean;
  client: string;
  authorizer: string;
  paymentMethod: string | RegExp;
  concepts: readonly OtherCostConcept[];
};

export const COMMISSION_BASE_ROWS: readonly CommissionBaseRow[] = [
  {
    label: 'a tarifador 6203 por costo con comisionable y no comisionable',
    tariff: 6203,
    byCost: true,
    client: process.env.PKB_COST_CLIENT?.trim() || 'McLaren',
    authorizer: process.env.PKB_COST_AUTHORIZER?.trim() || 'Brown',
    paymentMethod: /credit account|cuenta corriente/i,
    concepts: [COMMISSIONABLE_CONCEPT, NON_COMMISSIONABLE_CONCEPT]
  },
  {
    label: 'b control tarifador 6204 solo venta sin otros costos',
    tariff: 6204,
    byCost: false,
    client: process.env.ADMIN_CIRCUIT_SALE_ONLY_CLIENT?.trim() || 'Alpine',
    authorizer: process.env.ADMIN_CIRCUIT_SALE_ONLY_AUTHORIZER?.trim() || 'Krief',
    paymentMethod: 'Cash',
    concepts: []
  }
];
