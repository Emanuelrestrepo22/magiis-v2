// tests/helpers/fr-ac-eval-circuit.ts
// Evaluadores PUROS (sin Playwright, sin expect) de los ACs del circuito FR que cierran los
// gaps de S1/S2/S3/S6 (docs/qa/automation-stock/fr-1901/criterios-aceptacion-circuito-fr-2026-10-21.md).
// Devuelven `ok` + `mismatches`; el spec asevera con `expect(v.ok, formatMismatches(...)).toBe(true)`
// dentro de `verifyAc`. Las dos lecturas (`readTravelCoreDb`, `readBatchState`) solo CONSULTAN y
// devuelven datos crudos. Signos de saldo de libros: la convencion DB no esta confirmada para chofer ni
// propietario, por eso la comparacion de saldos es sobre el valor absoluto y el signo se devuelve como
// evidencia (no se juzga).
import type { OracleDb } from '../db/OracleDb.js';
import type { SurrenderBatch, SurrenderClient } from '../api/clients/surrender.client.js';
import type { SurrenderHeader } from '../steps/trips/autoSurrender.steps.js';
import type { CcMovement } from './cc-delta.js';
import {
  expectedCommissions,
  SURRENDER_COLUMNS,
  type SaleCostResult,
  type SurrenderColumn,
  type SurrenderExpected,
  type SurrenderRow
} from './db-oracle-eval.js';
import { expectedEditEffects, type EditDiffs } from './edit-matrix.js';
import { PCT } from './fr-circuit.js';
import { pollUntil, type PollResult } from './poll.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

export { formatMismatches, type Mismatch, type OracleVerdict };

const TOL = 0.011;
const cents = (n: number): number => Math.round(n * 100) / 100;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;
const asNum = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});

// ───────────────────────── Lecturas DB (solo consulta) ─────────────────────────

/** Estado del viaje en DB. STATE/SURRENDERED/DRIVER_ID/FINALIZE_ADMIN solo existen si hay fila en TRAVEL. */
export type TravelCoreDb = {
  hasTravelRow: boolean;
  hasHistoryRow: boolean;
  STATE: number | null;
  SURRENDERED: number | null;
  DRIVER_ID: number | null;
  FINALIZE_ADMIN: number | null;
  TRAVELSSURRENDER_ID: number | null;
  FINALPRICE_ID: number | null;
  FINALPRICE: number | null;
};

const TRAVEL_CORE_SQL = `
SELECT 'TRAVEL' AS SRC, t.STATE, t.SURRENDERED, t.DRIVER_ID, t.FINALIZE_ADMIN,
       t.TRAVELSSURRENDER_ID, t.FINALPRICE_ID, f.FINALPRICE
FROM TRAVEL t LEFT JOIN FINALPRICEI f ON f.ID = t.FINALPRICE_ID
WHERE t.ID = :travelId
UNION ALL
SELECT 'TRAVEL_HISTORY', NULL, NULL, NULL, NULL, h.TRAVELSSURRENDER_ID, h.FINALPRICE_ID, f.FINALPRICE
FROM TRAVEL_HISTORY h LEFT JOIN FINALPRICEI f ON f.ID = h.FINALPRICE_ID
WHERE h.ID = :travelId`;

/** Lee TRAVEL y TRAVEL_HISTORY (el viaje pasa a historico con retraso). Falla (tecnico) si no esta en ninguna. */
export async function readTravelCoreDb(db: OracleDb, travelId: number): Promise<TravelCoreDb> {
  const rows = await db.query<Record<string, unknown>>(TRAVEL_CORE_SQL, { travelId });
  const travel = rows.find((r) => r.SRC === 'TRAVEL');
  const history = rows.find((r) => r.SRC === 'TRAVEL_HISTORY');
  if (!travel && !history) {
    throw new Error(`[fr-ac] viaje ${travelId} no existe en TRAVEL ni en TRAVEL_HISTORY`);
  }
  const pick = (col: string): number | null =>
    asNum(travel?.[col]) ?? (history ? asNum(history[col]) : null);
  return {
    hasTravelRow: travel !== undefined,
    hasHistoryRow: history !== undefined,
    STATE: asNum(travel?.STATE),
    SURRENDERED: asNum(travel?.SURRENDERED),
    DRIVER_ID: asNum(travel?.DRIVER_ID),
    FINALIZE_ADMIN: asNum(travel?.FINALIZE_ADMIN),
    TRAVELSSURRENDER_ID: pick('TRAVELSSURRENDER_ID'),
    FINALPRICE_ID: pick('FINALPRICE_ID'),
    FINALPRICE: pick('FINALPRICE')
  };
}

/** Lote de rendicion del chofer/vehiculo: ids de la vista previa y filas del resumen de pendientes. */
export async function readBatchState(
  client: SurrenderClient,
  batch: SurrenderBatch,
  travelId: number
): Promise<{ stillPending: boolean; previewIds: Array<number | null>; summary: number }> {
  const preview = await client.preview(batch);
  const summary = (await client.pendingSummary()).filter(
    (r) => r.driverId === batch.driverUserId && r.vehicleId === batch.vehicleId
  );
  return {
    stillPending: preview.rows.some((r) => r.travelId === travelId),
    previewIds: preview.rows.map((r) => r.travelId ?? null),
    summary: summary.length
  };
}

export type BatchState = Awaited<ReturnType<typeof readBatchState>>;

/**
 * Tras confirmar la rendicion (cualquier status) el viaje deja de estar pendiente y el resumen queda
 * vacio. Espera por estado observable (la persistencia puede llegar tras el 500 del PDF) y DEVUELVE
 * el resultado: el spec asevera `settled` (AC-FR-26) con su mensaje de negocio.
 */
export async function readBatchStateUntilEmpty(
  client: SurrenderClient,
  batch: SurrenderBatch,
  travelId: number,
  timeoutMs = 30_000
): Promise<PollResult<BatchState>> {
  return pollUntil(
    () => readBatchState(client, batch, travelId),
    (s) => !s.stillPending && s.summary === 0,
    { timeoutMs, intervalMs: 1_000 }
  );
}

// ───────────────────────── Alta y cierre ─────────────────────────

/** AC-FR-04: chofer 4965 en DB (obligatorio) y en el detalle (si lo expone). */
export function evaluateDriverAssigned(input: {
  expectedDriverId: number;
  detailDriverId: number | null;
  core: TravelCoreDb;
}): OracleVerdict & { notes: string[] } {
  const m: Mismatch[] = [];
  const notes: string[] = [];
  if (!input.core.hasTravelRow) {
    m.push({
      field: 'TRAVEL.DRIVER_ID',
      expected: input.expectedDriverId,
      actual: 'sin fila en TRAVEL (solo historico): no verificable'
    });
  } else if (input.core.DRIVER_ID !== input.expectedDriverId) {
    m.push({
      field: 'TRAVEL.DRIVER_ID',
      expected: input.expectedDriverId,
      actual: input.core.DRIVER_ID
    });
  }
  if (input.detailDriverId === null) {
    notes.push('el detalle no expone el chofer: solo verificado por DB');
  } else if (input.detailDriverId !== input.expectedDriverId) {
    m.push({
      field: 'detalle.driver (DRIVER.ID)',
      expected: input.expectedDriverId,
      actual: input.detailDriverId
    });
  }
  return { ...verdict(m), notes };
}

/** AC-FR-05: el viaje abierto no esta en la vista previa ni el resumen de pendientes tiene filas. */
export function evaluateNotInBatch(
  state: { previewIds: ReadonlyArray<number | null>; summary: number },
  travelId: number
): OracleVerdict {
  const m: Mismatch[] = [];
  if (state.previewIds.includes(travelId)) {
    m.push({
      field: `viaje ${travelId} en la vista previa (aun no cerrado)`,
      expected: 'ausente',
      actual: 'presente'
    });
  }
  if (state.previewIds.length !== 0) {
    m.push({
      field: 'filas de la vista previa del lote',
      expected: 0,
      actual: state.previewIds
    });
  }
  if (state.summary !== 0) {
    m.push({ field: 'filas del resumen de pendientes', expected: 0, actual: state.summary });
  }
  return verdict(m);
}

/** AC-FR-14 (DB): tras cancelar, STATE = 7 (si hay fila TRAVEL; si solo hay historico no es verificable y no se juzga). */
export function evaluateDbCancelled(core: TravelCoreDb): OracleVerdict {
  return verdict(
    core.hasTravelRow && core.STATE !== 7
      ? [{ field: 'TRAVEL.STATE', expected: 7, actual: core.STATE }]
      : []
  );
}

/** AC-FR-15 (DB): cancelacion sin cargo = sin FINALPRICEI o con FINALPRICE en 0. */
export function evaluateDbNoCharge(core: TravelCoreDb): OracleVerdict {
  return verdict(
    core.FINALPRICE_ID !== null && core.FINALPRICE !== null && core.FINALPRICE !== 0
      ? [
          {
            field: 'FINALPRICEI.FINALPRICE (cancelacion sin cargo: sin FINALPRICEI o en 0)',
            expected: 'NULL o 0',
            actual: core.FINALPRICE
          }
        ]
      : []
  );
}

/** AC-FR-06 (DB): cierre admin = STATE 6 y FINALIZE_ADMIN 1 (requiere la fila de TRAVEL). */
export function evaluateDbClosedByAdmin(core: TravelCoreDb): OracleVerdict {
  const m: Mismatch[] = [];
  if (!core.hasTravelRow) {
    m.push({
      field: 'TRAVEL (fila)',
      expected: 'presente',
      actual: 'solo TRAVEL_HISTORY: STATE/FINALIZE_ADMIN no verificables'
    });
    return verdict(m);
  }
  if (core.STATE !== 6) m.push({ field: 'TRAVEL.STATE', expected: 6, actual: core.STATE });
  if (core.FINALIZE_ADMIN !== 1) {
    m.push({ field: 'TRAVEL.FINALIZE_ADMIN', expected: 1, actual: core.FINALIZE_ADMIN });
  }
  return verdict(m);
}

/** AC-FR-19 (DB): el cancelado no tiene rendicion asociada y SURRENDERED = 0 (si hay fila TRAVEL). */
export function evaluateDbNotSurrendered(core: TravelCoreDb): OracleVerdict {
  const m: Mismatch[] = [];
  if (core.TRAVELSSURRENDER_ID !== null) {
    m.push({
      field: 'TRAVEL.TRAVELSSURRENDER_ID',
      expected: null,
      actual: core.TRAVELSSURRENDER_ID
    });
  }
  if (core.hasTravelRow && core.SURRENDERED !== 0) {
    m.push({ field: 'TRAVEL.SURRENDERED', expected: 0, actual: core.SURRENDERED });
  }
  return verdict(m);
}

/** Separa el veredicto de `evaluateSaleCostPairs`: AC-08 (pares) y AC-12 (total = suma de partes de costo). */
export function splitSaleCostMismatches(result: SaleCostResult): {
  pairs: OracleVerdict;
  total: OracleVerdict;
} {
  const isTotal = (x: Mismatch): boolean => x.field.startsWith('FINALPRICEI.FINAL');
  return {
    pairs: verdict(result.mismatches.filter((x) => !isTotal(x))),
    total: verdict(result.mismatches.filter(isTotal))
  };
}

/**
 * AC-FR-10: el cierre por app recalcula con km/tiempo medidos. NO exige igualdad con la cotizacion;
 * exige coherencia API = DB del precio final, final > 0 y KM medido informado (>= 0). Devuelve si el
 * final difiere de la cotizacion (valido: se registra).
 */
export function evaluateAppRecalc(input: {
  quote: number;
  apiFinal: number;
  dbFinal: number | null;
  dbKm: number | null;
}): OracleVerdict & { differsFromQuote: boolean; delta: number } {
  const m: Mismatch[] = [];
  if (!(input.apiFinal > 0))
    m.push({ field: 'precio final (API)', expected: '> 0', actual: input.apiFinal });
  if (input.dbFinal === null || !near(input.dbFinal, input.apiFinal)) {
    m.push({
      field: 'FINALPRICEI.FINALPRICE vs detalle.amount',
      expected: input.apiFinal,
      actual: input.dbFinal
    });
  }
  if (input.dbKm === null || !(input.dbKm >= 0)) {
    m.push({ field: 'FINALPRICEI.KM (medido por la app)', expected: '>= 0', actual: input.dbKm });
  }
  const delta = cents(input.apiFinal - input.quote);
  return { ...verdict(m), differsFromQuote: !near(input.apiFinal, input.quote), delta };
}

// ───────────────────────── Vista previa del lote ─────────────────────────

/** AC-FR-23: columna de pago del lote (efectivo = Cash; CC informado y distinto de Cash). */
export function evaluatePaymentColumn(
  paymentMethod: string | null | undefined,
  kind: 'cash' | 'cc'
): OracleVerdict {
  const label = paymentMethod === null || paymentMethod === undefined ? '' : String(paymentMethod);
  const isCash = /^cash$/i.test(label.trim());
  if (kind === 'cash' && !isCash) {
    return verdict([{ field: 'paymentMethod del lote', expected: 'Cash', actual: label || null }]);
  }
  if (kind === 'cc' && (label.trim() === '' || isCash)) {
    return verdict([
      {
        field: 'paymentMethod del lote',
        expected: 'informado y distinto de Cash',
        actual: label || null
      }
    ]);
  }
  return verdict([]);
}

export type PreviewCommissionRow = {
  ownerCommissionAmount?: number | null;
  driverCommissionAmount?: number | null;
  agencyCommissionAmount?: number | null;
};

/**
 * AC-FR-24: comisiones 40/40/20 de la vista previa sobre `base` (city tax incluido). Solo se juzgan
 * los campos que la API expone (number). `altMatches` lista los campos que coinciden con la base
 * ALTERNATIVA (sin city tax) y no con la oficial: el spec los registra como `observation`, nunca los acepta.
 */
export function evaluateCommissionPreview(
  row: PreviewCommissionRow,
  base: number,
  altBase: number | null = null
): OracleVerdict & { exposed: string[]; notExposed: string[]; altMatches: string[] } {
  const m: Mismatch[] = [];
  const exposed: string[] = [];
  const notExposed: string[] = [];
  const altMatches: string[] = [];
  const fields: Array<[keyof PreviewCommissionRow, number]> = [
    ['ownerCommissionAmount', PCT.owner],
    ['driverCommissionAmount', PCT.driver],
    ['agencyCommissionAmount', PCT.agency]
  ];
  for (const [field, pct] of fields) {
    const value = row[field];
    if (typeof value !== 'number') {
      notExposed.push(field);
      continue;
    }
    exposed.push(field);
    const want = cents(pct * base);
    if (!near(cents(value), want)) {
      m.push({ field: `vista previa ${field} (base ${base})`, expected: want, actual: value });
      if (altBase !== null && near(cents(value), cents(pct * altBase))) altMatches.push(field);
    }
  }
  return { ...verdict(m), exposed, notExposed, altMatches };
}

// ───────────────────────── Libros y rendicion (post-confirmacion) ─────────────────────────

/**
 * AC-FR-29: codigos de libro de una rendicion manual de UN viaje. Chofer: efectivo = CASH_COMMISSION +
 * CASH_PAYMENT_COMM; CC = CHECKING_ACCOUNT_COMM (CASH_PAYMENT_COMM tambien aparece en CC en el libro
 * 4965 observado: no se prohibe). Propietario: TDDV.
 */
export function evaluateBookCodes(
  kind: 'cash' | 'cc',
  driverCodes: ReadonlyArray<string | null | undefined>,
  ownerCodes: ReadonlyArray<string | null | undefined>
): OracleVerdict {
  const m: Mismatch[] = [];
  const d = new Set(driverCodes.map((c) => c ?? 'NULL'));
  const o = new Set(ownerCodes.map((c) => c ?? 'NULL'));
  const needDriver =
    kind === 'cash' ? ['CASH_COMMISSION', 'CASH_PAYMENT_COMM'] : ['CHECKING_ACCOUNT_COMM'];
  for (const code of needDriver) {
    if (!d.has(code)) {
      m.push({ field: `libro del chofer: codigo ${code}`, expected: 'presente', actual: [...d] });
    }
  }
  if (kind === 'cash' && d.has('CHECKING_ACCOUNT_COMM')) {
    m.push({
      field: 'libro del chofer (efectivo): CHECKING_ACCOUNT_COMM',
      expected: 'ausente',
      actual: [...d]
    });
  }
  if (!o.has('TDDV')) {
    m.push({ field: 'libro del propietario: codigo TDDV', expected: 'presente', actual: [...o] });
  }
  return verdict(m);
}

/**
 * AC-FR-31: el delta de saldo del libro = Σ(debito − credito) de las filas nuevas, en valor absoluto
 * (la convencion de signo de chofer/propietario no esta confirmada). `sign` se devuelve como evidencia.
 */
export function evaluateBalanceDelta(
  added: ReadonlyArray<Pick<CcMovement, 'debit' | 'credit'>>,
  balanceDelta: number | null
): OracleVerdict & { net: number; sign: 'same-as-net' | 'opposite-to-net' | 'zero' } {
  const net = cents(added.reduce((s, r) => s + r.debit - r.credit, 0));
  const m: Mismatch[] = [];
  if (balanceDelta === null) {
    m.push({ field: 'balanceDelta', expected: Math.abs(net), actual: null });
  } else if (!near(Math.abs(balanceDelta), Math.abs(net))) {
    m.push({
      field: '|balanceDelta| vs |Σ(debito − credito)| de las filas nuevas',
      expected: Math.abs(net),
      actual: balanceDelta
    });
  }
  const sign =
    balanceDelta === null || near(balanceDelta, 0)
      ? 'zero'
      : balanceDelta * net > 0
        ? 'same-as-net'
        : 'opposite-to-net';
  return { ...verdict(m), net, sign };
}

export type ClientCcBalanceInput = {
  travelId: number;
  debit: number;
  /** Filas nuevas de la CC (deltaMovements.added): propias y ajenas. */
  added: readonly CcMovement[];
  balanceDeltaDb: number | null;
};
export type ClientCcBalanceVerdict = OracleVerdict & {
  own: CcMovement[];
  foreign: CcMovement[];
  sign: 'minus-debit' | 'plus-debit' | 'zero';
};

/**
 * AC-FR-49 (por viaje, inmune a movimientos ajenos en la CC compartida): (1) exactamente UN movimiento
 * nuevo del viaje, por |debito| = `debit`; (2) |balanceDeltaDb| = |Σ(debito − credito)| de TODAS las
 * filas nuevas (propias + ajenas). `foreign.length > 0` NO es diferencia: el spec lo registra con `observation`.
 */
export function evaluateClientCcBalance(input: ClientCcBalanceInput): ClientCcBalanceVerdict {
  const d = input.balanceDeltaDb;
  const sign = d === null || near(d, 0) ? 'zero' : d < 0 ? 'minus-debit' : 'plus-debit';
  const m: Mismatch[] = [];
  const own = input.added.filter((r) => r.travelId === input.travelId);
  const foreign = input.added.filter((r) => r.travelId !== input.travelId);
  if (own.length !== 1) {
    m.push({
      field: `movimientos nuevos de la CC del viaje ${input.travelId}`,
      expected: 1,
      actual: own.map((r) => ({ key: r.key, debit: r.debit, credit: r.credit }))
    });
  } else if (!near(Math.abs(own[0].debit - own[0].credit), input.debit)) {
    m.push({
      field: `|debito| del movimiento del viaje ${input.travelId}`,
      expected: input.debit,
      actual: own[0].debit - own[0].credit
    });
  }
  const net = cents(input.added.reduce((s, r) => s + r.debit - r.credit, 0));
  if (d === null || !near(Math.abs(d), Math.abs(net))) {
    m.push({
      field: '|balanceDelta CC| vs |Σ(debito − credito)| de los movimientos nuevos',
      expected: Math.abs(net),
      actual: d
    });
  }
  return { ...verdict(m), sign, own, foreign };
}

/** AC-FR-30 (cabecera): DRIVER_ID, VEHICLE_ID, VEHICLEOWNERID y CARRIER_ID del baseline manual + IDFORCARRIER = origin del libro. */
export function evaluateSurrenderHeader(
  header: SurrenderHeader,
  expected: { driverId: number; vehicleId: number; ownerId: number; carrierId: number },
  bookOrigin: number | null
): OracleVerdict {
  const m: Mismatch[] = [];
  const checks: Array<[string, number | null, number]> = [
    ['TRAVELSSURRENDER.DRIVER_ID', header.DRIVER_ID, expected.driverId],
    ['TRAVELSSURRENDER.VEHICLE_ID', header.VEHICLE_ID, expected.vehicleId],
    ['TRAVELSSURRENDER.VEHICLEOWNERID', header.VEHICLEOWNERID, expected.ownerId],
    ['TRAVELSSURRENDER.CARRIER_ID', header.CARRIER_ID, expected.carrierId]
  ];
  for (const [field, actual, want] of checks) {
    if (actual !== want) m.push({ field, expected: want, actual });
  }
  if (bookOrigin === null || header.IDFORCARRIER !== bookOrigin) {
    m.push({
      field: 'TRAVELSSURRENDER.IDFORCARRIER vs origin de las filas nuevas del libro',
      expected: bookOrigin,
      actual: header.IDFORCARRIER
    });
  }
  return verdict(m);
}

/**
 * AC-FR-30 (columnas): lo esperado de TRAVELSSURRENDER para una rendicion manual de UN viaje con
 * base comisionable `base` (final − peajes − estacionamiento, city tax incluido): comisiones 40/20
 * (formula verificada 56/56 en el baseline 2001) y total por medio de pago = base.
 */
export function expectedManualSurrender(kind: 'cash' | 'cc', base: number): SurrenderExpected {
  const commissions = expectedCommissions({
    cashBase: kind === 'cash' ? base : 0,
    checkingAccountBase: kind === 'cc' ? base : 0,
    creditCardBase: 0,
    pctOwner: PCT.owner,
    pctAgency: PCT.agency
  });
  return {
    ...commissions,
    TOTALCASH: kind === 'cash' ? base : 0,
    TOTALCASHQTY: kind === 'cash' ? 1 : 0,
    TOTALCHECKINGACCOUNT: kind === 'cc' ? base : 0,
    TOTALCHECKACCQTY: kind === 'cc' ? 1 : 0,
    TOTALCREDITCARD: 0,
    TOTALCREDCARDQTY: 0
  };
}

/** Las columnas esperadas en 0 que la DB deja NULL cuentan como 0 (no se usa ese medio de pago). */
export function nullAsZeroWhereExpectedZero(
  row: SurrenderRow,
  expected: SurrenderExpected
): SurrenderRow {
  const out = { ...row };
  for (const [col, want] of Object.entries(expected) as Array<[SurrenderColumn, number | null]>) {
    if (want === 0 && out[col] === null) out[col] = 0;
  }
  return out;
}

/** AC-FR-30: la comision de agencia (20 %) no tiene fila propia en los libros nuevos de chofer/propietario. */
export function evaluateNoAgencyBookRow(
  newRows: ReadonlyArray<{ amount?: number | null; paid?: number | null; code?: string | null }>,
  agencyAmount: number,
  otherCommissionAmounts: readonly number[]
): OracleVerdict {
  if (otherCommissionAmounts.some((a) => near(a, agencyAmount))) {
    return verdict([]); // montos coincidentes: la ausencia no se puede distinguir (no se juzga)
  }
  const hit = newRows.filter(
    (r) =>
      near(Math.abs(Number(r.amount ?? 0)), agencyAmount) ||
      near(Math.abs(Number(r.paid ?? 0)), agencyAmount)
  );
  return verdict(
    hit.length === 0
      ? []
      : [
          {
            field: `filas de libro por la comision de agencia (${agencyAmount})`,
            expected: 'ninguna',
            actual: hit.map((r) => r.code ?? null)
          }
        ]
  );
}

// ───────────────────────── Edicion post-rendicion (S2) ─────────────────────────

type BookRowKey = {
  checkingAccountCode?: string | null;
  amount?: number | null;
  paid?: number | null;
  origin?: number | null;
};
const keyOf = (r: BookRowKey): string =>
  [r.checkingAccountCode, r.amount, r.paid, r.origin].join('|');

/**
 * AC-FR-60: tras editar, ninguna fila de la rendicion `surrenderId` que ya existia se repite. Un
 * `surrenderId` desconocido es una diferencia (no se puede probar la ausencia de duplicados a ciegas).
 */
export function evaluateNoDuplicatedRows(
  before: readonly BookRowKey[],
  after: readonly BookRowKey[],
  surrenderId: number | null
): OracleVerdict & { duplicated: string[] } {
  if (surrenderId === null) {
    return {
      ...verdict([{ field: 'surrenderId (origin unico)', expected: 'conocido', actual: null }]),
      duplicated: []
    };
  }
  const count = (rows: readonly BookRowKey[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const r of rows.filter((x) => x.origin === surrenderId))
      out.set(keyOf(r), (out.get(keyOf(r)) ?? 0) + 1);
    return out;
  };
  const b = count(before);
  const duplicated: string[] = [];
  for (const [key, n] of count(after)) {
    if (b.has(key) && n > (b.get(key) as number)) duplicated.push(key);
  }
  return {
    ...verdict(
      duplicated.map((k) => ({
        field: 'fila de rendicion duplicada tras editar',
        expected: 'sin repetir',
        actual: k
      }))
    ),
    duplicated
  };
}

/** Diferencias (despues - antes) de las partes de venta del detalle, para `expectedEditEffects`. */
export function editDiffs(
  before: Record<string, number>,
  after: Record<string, number>
): EditDiffs {
  const d = (k: string): number => cents((after[k] ?? 0) - (before[k] ?? 0));
  return {
    fare: d('fare'),
    wait: d('wait'),
    otherCom: d('otherCom'),
    otherNoCom: d('otherNoCom'),
    toll: d('toll'),
    parking: d('parking'),
    total: d('total')
  };
}

/**
 * AC-FR-56: delta de las columnas de TRAVELSSURRENDER de un viaje CC (o efectivo) tras editar = el de
 * `expectedEditEffects` aplicado a lo que el BE cambio realmente en el detalle. Solo se juzgan las
 * columnas que `readSurrenderRow` lee.
 */
export function evaluateSurrenderEditDeltas(
  kind: 'cash' | 'cc',
  before: SurrenderRow,
  after: SurrenderRow,
  diffs: EditDiffs
): OracleVerdict & { observed: Record<string, number>; expected: Record<string, number> } {
  const expectedAll = expectedEditEffects(kind, diffs).surrender;
  const readable = new Set<string>(SURRENDER_COLUMNS);
  const expected = Object.fromEntries(
    Object.entries(expectedAll).filter(([col]) => readable.has(col))
  );
  const observed: Record<string, number> = {};
  const m: Mismatch[] = [];
  for (const [col, want] of Object.entries(expected)) {
    const zeroed = col === 'TOTALOTHERCOST_NOCOM'; // Q3: NULL equivale a 0
    const b = before[col as SurrenderColumn] ?? (zeroed ? 0 : null);
    const a = after[col as SurrenderColumn] ?? (zeroed ? 0 : null);
    if (b === null || a === null) {
      m.push({ field: `TRAVELSSURRENDER.${col} (delta)`, expected: want, actual: 'NULL' });
      continue;
    }
    observed[col] = cents(a - b);
    if (!near(observed[col] as number, want)) {
      m.push({ field: `TRAVELSSURRENDER.${col} (delta)`, expected: want, actual: observed[col] });
    }
  }
  return { ...verdict(m), observed, expected };
}
