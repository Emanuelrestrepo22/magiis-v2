// tests/helpers/report-oracle.ts
// Oraculos de los reportes financieros del carrier V2 (SOLO LECTURA): funciones PURAS que comparan lo
// que muestra/exporta un reporte contra la base (TRAVEL, TRAVELSSURRENDER, libros de CC) y devuelven
// una lista de discrepancias con evidencia fila a fila. El spec las reune y las reporta; ninguna lanza.
// Fuentes de forma (probadas contra TEST 1901 el 2026-10-21):
// - genericReport 024 (Trip List actuales): Col1 travelId, Col2 codigo, Col3 fecha, Col10 presupuestado,
//   Col11 real, Col12 estado (DONE/CANCELLED; ADMIN_DONE se deriva de FINALIZE_ADMIN), Col13 metodo.
// - genericReport 024T (totales): [{ Col1: metodo, Col2: monto }].
// - GET surrendersReports/paginated y /totals (DTO plano de la grilla Closed).
// - GET checking-accounts/carrier/{id}/(clients|drivers|owners)/paginated.
import { round2 } from '../utils/money.js';

export type Discrepancy = {
  report: string;
  /** Identidad de la fila (travelId, surrenderId, ownerId...). */
  key: string;
  field: string;
  expected: unknown;
  actual: unknown;
  note?: string;
};

export type GenericRow = Record<string, string | null | undefined>;

const TOLERANCE = 0.01;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const near = (a: number | null, b: number | null): boolean =>
  a !== null && b !== null && Math.abs(a - b) <= TOLERANCE + 1e-9;

function check(
  out: Discrepancy[],
  report: string,
  key: string,
  field: string,
  expected: number | null,
  actual: number | null,
  note?: string
): void {
  if (!near(expected, actual)) out.push({ report, key, field, expected, actual, note });
}

// ───────────────────────── Trip List ─────────────────────────

/** STATE numerico de TRAVEL -> texto del reporte. 6 = DONE, 7 = CANCELLED (medido en TEST). */
export const TRAVEL_STATE_TEXT: Record<number, string> = { 6: 'DONE', 7: 'CANCELLED', 8: 'DONE' };

export type DbTrip = {
  ID: number;
  STATE: number | string | null;
  PAYMENTMETHOD: string | null;
  FINALPRICE: number | null;
  FINALIZE_ADMIN: number | null;
  TRAVELSSURRENDER_ID?: number | null;
};

/** Estado como lo muestra el reporte: DONE + FINALIZE_ADMIN=1 se ve ADMIN_DONE (EDGE-013 del front). */
export function displayedState(trip: Pick<DbTrip, 'STATE' | 'FINALIZE_ADMIN'>): string {
  const text =
    typeof trip.STATE === 'number'
      ? (TRAVEL_STATE_TEXT[trip.STATE] ?? String(trip.STATE))
      : String(trip.STATE ?? '');
  return text === 'DONE' && trip.FINALIZE_ADMIN === 1 ? 'ADMIN_DONE' : text;
}

/** Importe real esperado en el reporte: el FINALPRICE si el viaje termino; 0 si se cancelo. */
export function expectedRealPrice(trip: DbTrip): number {
  const state = displayedState(trip);
  return state === 'DONE' || state === 'ADMIN_DONE' ? (trip.FINALPRICE ?? 0) : 0;
}

/**
 * Trip List vs DB, fila a fila: presencia (ambos sentidos, dentro del rango de ids de la grilla),
 * importe real, estado y metodo de pago.
 */
export function compareTripsList(
  grid: readonly GenericRow[],
  db: readonly DbTrip[]
): Discrepancy[] {
  const report = 'trips-list';
  const out: Discrepancy[] = [];
  const dbById = new Map(db.map((t) => [t.ID, t]));
  const gridIds = grid.map((r) => Number(r.Col1));
  const seen = new Set<number>();
  for (const row of grid) {
    const id = Number(row.Col1);
    const key = String(id);
    if (seen.has(id)) out.push({ report, key, field: 'fila duplicada', expected: 1, actual: 2 });
    seen.add(id);
    const trip = dbById.get(id);
    if (!trip) {
      out.push({ report, key, field: 'viaje en DB', expected: 'existe', actual: 'ausente' });
      continue;
    }
    check(
      out,
      report,
      key,
      'Actual (Col11) vs FINALPRICE',
      expectedRealPrice(trip),
      num(row.Col11)
    );
    if ((row.Col12 ?? '') === 'DONE' || (row.Col12 ?? '') === 'CANCELLED') {
      const expectedState = displayedState({ STATE: trip.STATE, FINALIZE_ADMIN: 0 });
      if (row.Col12 !== expectedState) {
        out.push({
          report,
          key,
          field: 'Status (Col12)',
          expected: expectedState,
          actual: row.Col12
        });
      }
    }
    if (row.Col13 !== trip.PAYMENTMETHOD) {
      out.push({
        report,
        key,
        field: 'Payment Method (Col13)',
        expected: trip.PAYMENTMETHOD,
        actual: row.Col13
      });
    }
  }
  if (gridIds.length > 0) {
    const min = Math.min(...gridIds);
    const max = Math.max(...gridIds);
    for (const trip of db) {
      if (trip.ID >= min && trip.ID <= max && !seen.has(trip.ID)) {
        out.push({
          report,
          key: String(trip.ID),
          field: 'viaje de DB ausente en la grilla',
          expected: 'presente',
          actual: 'ausente'
        });
      }
    }
  }
  return out;
}

/** Totales por metodo (024T) vs suma de la columna Actual de las filas de la grilla. */
export function compareTripsListTotals(
  totals: readonly GenericRow[],
  grid: readonly GenericRow[]
): Discrepancy[] {
  const report = 'trips-list';
  const out: Discrepancy[] = [];
  const byMethod = new Map<string, number>();
  for (const row of grid) {
    const method = row.Col13 ?? '';
    byMethod.set(method, round2((byMethod.get(method) ?? 0) + (num(row.Col11) ?? 0)));
  }
  const totalByMethod = new Map(totals.map((t) => [t.Col1 ?? '', num(t.Col2)]));
  for (const method of new Set([...byMethod.keys(), ...totalByMethod.keys()])) {
    const rows = byMethod.get(method) ?? 0;
    if ((rows === 0 && !totalByMethod.has(method)) || method === '') continue;
    check(
      out,
      report,
      method,
      'total del metodo (024T) vs suma de filas',
      rows,
      totalByMethod.get(method) ?? 0
    );
  }
  return out;
}

/** Suma de importes por metodo (para mostrar en el informe). */
export function sumByMethod(grid: readonly GenericRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of grid) {
    const method = row.Col13 ?? '';
    out[method] = round2((out[method] ?? 0) + (num(row.Col11) ?? 0));
  }
  return out;
}

// ───────────────────────── Closed surrenders ─────────────────────────

/** DTO de la grilla Closed (surrendersReports/paginated). Solo los campos usados. */
export type SurrenderGridRow = {
  id: number;
  totalTravelsQty?: number | null;
  totalBilling?: number | null;
  agencyCommission?: number | null;
  ownerCommission?: number | null;
  driverCommission?: number | null;
  totalCash?: number | null;
  totalCreditCard?: number | null;
  totalCheckingAccount?: number | null;
  totalCollected?: number | null;
  totalCharges?: number | null;
  [extra: string]: unknown;
};

export type SurrenderTotals = {
  sumTotalBilling?: number;
  sumAgencyCommission?: number;
  sumOwnerCommission?: number;
  sumDriverCommission?: number;
  sumTotalCash?: number;
  sumTotalCheckingAccount?: number;
  sumTotalCreditCard?: number;
  sumTotalTravelsQty?: number;
  [extra: string]: unknown;
};

/** Fila de TRAVELSSURRENDER (columnas verificadas en TEST). */
export type DbSurrender = {
  ID: number;
  DRIVER_ID: number | null;
  TOTALBILLING: number | null;
  TOTALBILLINGQTY: number | null;
  TOTALCASH: number | null;
  TOTALCHECKINGACCOUNT: number | null;
  TOTALCREDITCARD: number | null;
  AGENCY_TOTALCOMMISSION: number | null;
  OWNER_TOTALCOMMISSION: number | null;
  COMMISSIONSUM: number | null;
  TOTAL_COLLECTED: number | null;
  /**
   * Extras que el BE SUMA a la columna «Driver commission» de la grilla Closed
   * (TravelsSurrenderRepository.searchPaginated: commissionSum + creditCardTips + checkingAccountTips +
   * totalRoadToll + totalParking, leido en magiis-be develop 2026-10-21). Opcionales: si faltan = 0.
   */
  CHECKINGACCOUNTTIPS?: number | null;
  CREDITCARDTIPS?: number | null;
  TOTALROADTOLL?: number | null;
  TOTALPARKING?: number | null;
};

/** Propinas + peajes + estacionamiento que la grilla Closed incluye en «Driver commission». */
export function driverGridExtras(s: DbSurrender): number {
  return round2(
    (s.CHECKINGACCOUNTTIPS ?? 0) +
      (s.CREDITCARDTIPS ?? 0) +
      (s.TOTALROADTOLL ?? 0) +
      (s.TOTALPARKING ?? 0)
  );
}

export type CommissionSplit = { owner: number; driver: number; agency: number };
/** Comisiones sobre venta del vehiculo 3765 (datos-1901 lote B): propietario 40, chofer 40, agencia 20. */
export const FR_SPLIT: CommissionSplit = { owner: 0.4, driver: 0.4, agency: 0.2 };

/** Grilla Closed vs TRAVELSSURRENDER: presencia, importes, comisiones y 40/40/20 sobre la facturacion. */
export function compareSurrenders(
  grid: readonly SurrenderGridRow[],
  db: readonly DbSurrender[],
  split: CommissionSplit = FR_SPLIT
): Discrepancy[] {
  const report = 'surrenders-closed';
  const out: Discrepancy[] = [];
  const dbById = new Map(db.map((s) => [s.ID, s]));
  const gridIds = new Set(grid.map((r) => r.id));
  for (const row of grid) {
    const key = String(row.id);
    const s = dbById.get(row.id);
    if (!s) {
      out.push({ report, key, field: 'rendicion en DB', expected: 'existe', actual: 'ausente' });
      continue;
    }
    check(out, report, key, 'Billing vs TOTALBILLING', num(s.TOTALBILLING), num(row.totalBilling));
    check(
      out,
      report,
      key,
      'Trips vs TOTALBILLINGQTY',
      num(s.TOTALBILLINGQTY),
      num(row.totalTravelsQty)
    );
    check(out, report, key, 'Cash vs TOTALCASH', num(s.TOTALCASH), num(row.totalCash));
    check(
      out,
      report,
      key,
      'Credit account vs TOTALCHECKINGACCOUNT',
      num(s.TOTALCHECKINGACCOUNT),
      num(row.totalCheckingAccount)
    );
    check(
      out,
      report,
      key,
      'Company commission vs AGENCY_TOTALCOMMISSION',
      num(s.AGENCY_TOTALCOMMISSION),
      num(row.agencyCommission)
    );
    check(
      out,
      report,
      key,
      'Owner commission vs OWNER_TOTALCOMMISSION',
      num(s.OWNER_TOTALCOMMISSION),
      num(row.ownerCommission)
    );
    check(
      out,
      report,
      key,
      'Driver commission vs COMMISSIONSUM + propinas + peajes + estacionamiento',
      num(s.COMMISSIONSUM) === null
        ? null
        : round2((num(s.COMMISSIONSUM) as number) + driverGridExtras(s)),
      num(row.driverCommission)
    );
    check(
      out,
      report,
      key,
      'Collected vs TOTAL_COLLECTED',
      num(s.TOTAL_COLLECTED),
      num(row.totalCollected)
    );
    // El 40% de chofer se mide sobre la comision pura: se descuentan los extras que la grilla suma.
    const driverGrid = num(row.driverCommission);
    out.push(
      ...commissionSplitDiscrepancies(
        report,
        key,
        {
          ...row,
          driverCommission: driverGrid === null ? null : round2(driverGrid - driverGridExtras(s))
        },
        split
      )
    );
  }
  for (const s of db) {
    if (!gridIds.has(s.ID)) {
      out.push({
        report,
        key: String(s.ID),
        field: 'rendicion de DB ausente en la grilla Closed',
        expected: 'presente',
        actual: 'ausente',
        note:
          s.DRIVER_ID === null
            ? 'TRAVELSSURRENDER.DRIVER_ID es NULL (la grilla une por chofer)'
            : undefined
      });
    }
  }
  return out;
}

/** agencia/propietario/chofer = 20/40/40 % de la facturacion (+-0,01 por redondeo). */
export function commissionSplitDiscrepancies(
  report: string,
  key: string,
  row: Pick<
    SurrenderGridRow,
    'totalBilling' | 'agencyCommission' | 'ownerCommission' | 'driverCommission'
  >,
  split: CommissionSplit = FR_SPLIT
): Discrepancy[] {
  const out: Discrepancy[] = [];
  const billing = num(row.totalBilling);
  if (billing === null) return out;
  check(
    out,
    report,
    key,
    `agencia = ${split.agency * 100}% de billing`,
    round2(billing * split.agency),
    num(row.agencyCommission)
  );
  check(
    out,
    report,
    key,
    `propietario = ${split.owner * 100}% de billing`,
    round2(billing * split.owner),
    num(row.ownerCommission)
  );
  check(
    out,
    report,
    key,
    `chofer = ${split.driver * 100}% de billing`,
    round2(billing * split.driver),
    num(row.driverCommission)
  );
  return out;
}

/** Totales de la pantalla (/totals) vs suma de las filas de la grilla (todas las paginas del rango). */
export function compareSurrenderTotals(
  totals: SurrenderTotals,
  rows: readonly SurrenderGridRow[]
): Discrepancy[] {
  const report = 'surrenders-closed';
  const out: Discrepancy[] = [];
  const sum = (f: (r: SurrenderGridRow) => number | null | undefined): number =>
    round2(rows.reduce((acc, r) => acc + (f(r) ?? 0), 0));
  const pairs: Array<[string, number | null, number]> = [
    ['sumTotalBilling', num(totals.sumTotalBilling), sum((r) => r.totalBilling)],
    ['sumAgencyCommission', num(totals.sumAgencyCommission), sum((r) => r.agencyCommission)],
    ['sumOwnerCommission', num(totals.sumOwnerCommission), sum((r) => r.ownerCommission)],
    ['sumDriverCommission', num(totals.sumDriverCommission), sum((r) => r.driverCommission)],
    ['sumTotalCash', num(totals.sumTotalCash), sum((r) => r.totalCash)],
    [
      'sumTotalCheckingAccount',
      num(totals.sumTotalCheckingAccount),
      sum((r) => r.totalCheckingAccount)
    ],
    ['sumTotalCreditCard', num(totals.sumTotalCreditCard), sum((r) => r.totalCreditCard)],
    ['sumTotalTravelsQty', num(totals.sumTotalTravelsQty), sum((r) => r.totalTravelsQty)]
  ];
  for (const [field, expected, actual] of pairs) {
    check(out, report, 'totales', `${field} vs suma de filas`, actual, expected);
  }
  return out;
}

// ───────────────────────── Cuentas corrientes ─────────────────────────

/**
 * Saldo de CC de cliente: la API informa DEBITSUM - CREDITSUM (= limite - BALANCE de la DB, signo
 * opuesto al de la base; ver cc-delta.ts).
 */
export function clientCcApiBalanceFromDb(db: {
  CHECKINGACCOUNTLIMIT: number;
  BALANCE: number;
}): number {
  return round2(db.CHECKINGACCOUNTLIMIT - db.BALANCE);
}

export function compareBalance(
  report: string,
  key: string,
  field: string,
  expected: number | null,
  actual: number | null,
  note?: string
): Discrepancy[] {
  const out: Discrepancy[] = [];
  check(out, report, key, field, expected, actual, note);
  return out;
}

export type BookRow = {
  ID: number;
  /** Debito (aumenta el saldo) y credito (lo baja), ya normalizados por el llamador. */
  DEBIT: number | null;
  CREDIT: number | null;
  BALANCE: number | null;
  TRAVELSSURRENDER_ID?: number | null;
  /** CHECKINGACCOUNTCODE (TDDV, TDEA, TDES...) y COMMENTS, solo para dar contexto a la evidencia. */
  CODE?: string | null;
  COMMENTS?: string | null;
};

/**
 * Integridad de un libro (chofer/propietario): cada fila debe cumplir
 * BALANCE_n = BALANCE_(n-1) + DEBIT_n - CREDIT_n con las filas ordenadas por ID ascendente. Una
 * fila que no cumple (p. ej. un CREDIT de varios millones) se informa con su ID.
 */
export function bookIntegrity(report: string, rows: readonly BookRow[]): Discrepancy[] {
  const out: Discrepancy[] = [];
  const ordered = [...rows].sort((a, b) => a.ID - b.ID);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const row = ordered[i];
    if (prev.BALANCE === null || row.BALANCE === null) continue;
    const expected = round2(prev.BALANCE + (row.DEBIT ?? 0) - (row.CREDIT ?? 0));
    const alt = round2(prev.BALANCE - (row.DEBIT ?? 0) + (row.CREDIT ?? 0));
    if (!near(expected, row.BALANCE) && !near(alt, row.BALANCE)) {
      out.push({
        report,
        key: `libro#${row.ID}`,
        field: 'BALANCE continuo (saldo previo +/- movimiento)',
        expected,
        actual: row.BALANCE,
        note: `debit=${row.DEBIT} credit=${row.CREDIT} surrender=${row.TRAVELSSURRENDER_ID ?? 'n/a'}`
      });
    }
  }
  return out;
}

/**
 * Movimientos de libro de magnitud absurda: |DEBIT| o |CREDIT| mayor que `limit` (el llamador usa
 * 10x la mayor facturacion de rendicion del carrier). Detecta pares espurios que la continuidad del
 * saldo no ve (un debito enorme seguido de un credito igual deja el saldo final correcto).
 */
export function bookOutliers(
  report: string,
  rows: readonly BookRow[],
  limit: number
): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const row of rows) {
    for (const [side, value] of [
      ['DEBIT', row.DEBIT],
      ['CREDIT', row.CREDIT]
    ] as const) {
      if (typeof value === 'number' && Math.abs(value) > limit) {
        out.push({
          report,
          key: `libro#${row.ID}`,
          field: `${side} dentro de lo razonable (<= ${limit})`,
          expected: `<= ${limit}`,
          actual: value,
          note: `codigo=${row.CODE ?? 'n/d'} comentario=${row.COMMENTS ?? 'n/d'} rendicion=${row.TRAVELSSURRENDER_ID ?? 'n/a'} saldo=${row.BALANCE}`
        });
      }
    }
  }
  return out;
}

// ───────────────────────── Comisiones de agencia / formatos ─────────────────────────

/** Texto resumido de una discrepancia (una linea) para logs y el informe. */
export function formatDiscrepancy(d: Discrepancy): string {
  const note = d.note ? ` [${d.note}]` : '';
  return `${d.report} #${d.key} ${d.field}: esperado ${JSON.stringify(d.expected)} obtenido ${JSON.stringify(d.actual)}${note}`;
}

export function formatDiscrepancies(list: readonly Discrepancy[]): string {
  return list.map(formatDiscrepancy).join('\n');
}
