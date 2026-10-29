// tests/helpers/fr-ac-eval-auto-settlement.ts
// Evaluadores PUROS (sin expect, sin Playwright) y lecturas DB de solo lectura para los ACs del circuito FR
// que validan los specs de rendicion automatica (S4 prepare/verify, S5) y liquidaciones (SET).
// Contrato: cada evaluador devuelve `{ ok, mismatches }`; el spec asevera DENTRO de `verifyAc` con
// `expect(v.ok, formatMismatches(...)).toBe(true)`. Los `describe*` devuelven texto para `observation()`.
import type { TravelDetail } from '../api/clients/travels.client.js';
import type { OracleDb } from '../db/OracleDb.js';
import { round2 } from '../utils/money.js';
import { PCT } from './fr-circuit.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

export { formatMismatches, type Mismatch, type OracleVerdict };

const MONEY_TOL = 0.011;
const near = (a: number, b: number, tol = MONEY_TOL): boolean => Math.abs(a - b) <= tol;
const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});

// ───────────────────────── AC-FR-01 / AC-FR-02 ─────────────────────────

/** AC-FR-01: cotizacion > 0 y, si el entorno la declara, igual a FR_EXPECTED_QUOTE. */
export function evaluateQuote(simulated: number, expectedQuote?: string | null): OracleVerdict {
  const m: Mismatch[] = [];
  if (!(simulated > 0))
    m.push({ field: 'cotizacion simulada', expected: '> 0', actual: simulated });
  const raw = expectedQuote?.trim();
  if (raw) {
    const want = Number(raw);
    if (!Number.isFinite(want)) {
      m.push({ field: 'FR_EXPECTED_QUOTE', expected: 'numero', actual: raw });
    } else if (!near(round2(simulated), round2(want), 0.005)) {
      m.push({
        field: 'cotizacion simulada vs FR_EXPECTED_QUOTE',
        expected: want,
        actual: simulated
      });
    }
  }
  return verdict(m);
}

export type CurrencyVerdict = OracleVerdict & { verified: boolean; currency: string | null };

/** AC-FR-02: moneda EUR del detalle. `verified=false` si el detalle no expone `currencyCode` (se observa, no se aprueba en vacio). */
export function evaluateCurrencyEur(detail: TravelDetail): CurrencyVerdict {
  const raw = (detail.simulationPrice as Record<string, unknown> | null | undefined)?.currencyCode;
  if (raw === undefined || raw === null) {
    return { ok: true, mismatches: [], verified: false, currency: null };
  }
  const currency = String(raw);
  const ok = /EUR|€/i.test(currency);
  return {
    ok,
    mismatches: ok ? [] : [{ field: 'moneda del viaje', expected: 'EUR', actual: currency }],
    verified: true,
    currency
  };
}

// ───────────────────────── AC-FR-03 ─────────────────────────

/** AC-FR-03: linea PCT = pct de la base, encabezado de otros costos = linea y total = base + otros + fijos + impuestos. */
export function evaluateCityTaxSummary(input: {
  base: number;
  cityTaxLineAmount: number | null;
  otherCostsHeader: number;
  fixedFees: number;
  taxes: number;
  simulatedTotal: number;
  pct: number;
}): OracleVerdict {
  const { base, cityTaxLineAmount, otherCostsHeader, fixedFees, taxes, simulatedTotal, pct } =
    input;
  const m: Mismatch[] = [];
  if (cityTaxLineAmount === null) {
    m.push({ field: 'linea del otro costo en el resumen', expected: 'presente', actual: null });
    return verdict(m);
  }
  const expectedTax = round2(pct * base);
  if (!near(cityTaxLineAmount, expectedTax)) {
    m.push({
      field: `otro costo (${pct * 100} % de ${base})`,
      expected: expectedTax,
      actual: cityTaxLineAmount
    });
  }
  if (!near(otherCostsHeader, cityTaxLineAmount)) {
    m.push({
      field: 'encabezado Otros Costos vs linea',
      expected: cityTaxLineAmount,
      actual: otherCostsHeader
    });
  }
  const expectedTotal = round2(base + otherCostsHeader + fixedFees + taxes);
  if (!near(simulatedTotal, expectedTotal)) {
    m.push({
      field: 'total = base + otros + fijos + impuestos',
      expected: expectedTotal,
      actual: simulatedTotal
    });
  }
  return verdict(m);
}

// ───────────────────────── AC-FR-04 ─────────────────────────

/** Chofer asignado: la DB (TRAVEL.DRIVER_ID) es el oraculo; el campo del detalle se coteja solo si es numerico. */
export function evaluateDriverAssignment(input: {
  expectedDriverId: number;
  dbDriverId: number | null;
  detailDriverId: unknown;
}): OracleVerdict & { apiChecked: boolean } {
  const { expectedDriverId, dbDriverId, detailDriverId } = input;
  const m: Mismatch[] = [];
  if (dbDriverId !== expectedDriverId) {
    m.push({ field: 'TRAVEL.DRIVER_ID', expected: expectedDriverId, actual: dbDriverId });
  }
  const api = typeof detailDriverId === 'number' ? detailDriverId : Number(detailDriverId);
  const apiChecked =
    detailDriverId !== undefined && detailDriverId !== null && Number.isFinite(api);
  if (apiChecked && api !== expectedDriverId) {
    m.push({ field: 'detalle: driverId', expected: expectedDriverId, actual: api });
  }
  return { ...verdict(m), apiChecked };
}

/** DRIVER_ID del viaje en DB (TRAVEL o TRAVEL_HISTORY); null si no existe o sin chofer. Solo lectura. */
export async function readTravelDriverId(db: OracleDb, travelId: number): Promise<number | null> {
  const rows = await db.query<{ DRIVER_ID: number | null }>(
    `SELECT DRIVER_ID FROM TRAVEL WHERE ID = :travelId
     UNION ALL SELECT DRIVER_ID FROM TRAVEL_HISTORY WHERE ID = :travelId`,
    { travelId }
  );
  const v = rows.find((r) => r.DRIVER_ID !== null)?.DRIVER_ID;
  return v === undefined || v === null ? null : Number(v);
}

// ───────────────────────── AC-FR-05 / AC-FR-20 / AC-FR-23 ─────────────────────────

/** AC-FR-05: un viaje abierto no figura en el lote pendiente (DB por vehiculo ni preview API). */
export function evaluateTripAbsentFromBatch(input: {
  travelId: number;
  dbPending: readonly number[];
  apiBatchIds: readonly (number | null | undefined)[];
}): OracleVerdict {
  const m: Mismatch[] = [];
  if (input.dbPending.includes(input.travelId)) {
    m.push({
      field: 'lote pendiente DB del vehiculo',
      expected: `sin ${input.travelId}`,
      actual: [...input.dbPending]
    });
  }
  if (input.apiBatchIds.includes(input.travelId)) {
    m.push({
      field: 'preview toSurrend (API)',
      expected: `sin ${input.travelId}`,
      actual: [...input.apiBatchIds]
    });
  }
  return verdict(m);
}

export type BatchPaymentRow = { travelId?: number | null; paymentMethod?: string | null };

/** AC-FR-23: efectivo => «Cash»; cuenta corriente => no Cash y no vacio. Una fila ausente es diferencia. */
export function evaluateBatchPaymentMethods(
  rows: readonly BatchPaymentRow[],
  expected: ReadonlyArray<{ travelId: number; kind: 'CASH' | 'CHECKING_ACCOUNT' }>
): OracleVerdict {
  const m: Mismatch[] = [];
  for (const e of expected) {
    const row = rows.find((r) => r.travelId === e.travelId);
    if (!row) {
      m.push({
        field: `lote: fila del viaje ${e.travelId}`,
        expected: 'presente',
        actual: 'ausente'
      });
      continue;
    }
    const pm = String(row.paymentMethod ?? '');
    const isCash = /^cash$/i.test(pm);
    if (e.kind === 'CASH' && !isCash) {
      m.push({
        field: `paymentMethod viaje ${e.travelId}`,
        expected: 'Cash',
        actual: row.paymentMethod ?? null
      });
    }
    if (e.kind === 'CHECKING_ACCOUNT' && (pm === '' || isCash)) {
      m.push({
        field: `paymentMethod viaje ${e.travelId}`,
        expected: 'distinto de Cash',
        actual: row.paymentMethod ?? null
      });
    }
  }
  return verdict(m);
}

/** KM medido del cierre (FINALPRICEI.KM) de un viaje; null si no hay fila. Solo lectura. */
export async function readFinalKm(db: OracleDb, travelId: number): Promise<number | null> {
  const rows = await db.query<{ KM: number | null }>(
    `SELECT f.KM FROM FINALPRICEI f
       JOIN (SELECT FINALPRICE_ID FROM TRAVEL WHERE ID = :travelId
             UNION ALL SELECT FINALPRICE_ID FROM TRAVEL_HISTORY WHERE ID = :travelId) t
         ON f.ID = t.FINALPRICE_ID`,
    { travelId }
  );
  const v = rows[0]?.KM;
  return v === undefined || v === null ? null : Number(v);
}

// ───────────────────────── AC-FR-37 / AC-FR-39 / observaciones S5 ─────────────────────────

export type OwnerBookRowLike = {
  CHECKINGACCOUNTCODE: string | null;
  DEBIT: number | null;
  CREDIT: number | null;
};

const amountOf = (r: OwnerBookRowLike): number =>
  round2(Math.max(Math.abs(Number(r.DEBIT ?? 0)), Math.abs(Number(r.CREDIT ?? 0))));
const sumCode = (rows: readonly OwnerBookRowLike[], code: string): number | null => {
  const hit = rows.filter((r) => r.CHECKINGACCOUNTCODE === code);
  return hit.length === 0 ? null : round2(hit.reduce((s, r) => s + amountOf(r), 0));
};

/**
 * AC-FR-37: libro del propietario de la rendicion automatica. TDCV (efectivo) = comision de agencia sobre
 * la base cash; TDDC (CC) = formula del backend (`tddcExpected`). Con efectivo y/o CC ausentes el codigo
 * correspondiente NO debe existir (un libro con codigos de mas tambien es diferencia).
 */
export function evaluateOwnerBookAuto(input: {
  rows: readonly OwnerBookRowLike[];
  expectedTdcv: number | null;
  hasCc: boolean;
  tddcExpected: number | null;
}): OracleVerdict & { byCode: Record<string, number> } {
  const { rows, expectedTdcv, hasCc, tddcExpected } = input;
  const m: Mismatch[] = [];
  const byCode: Record<string, number> = {};
  for (const r of rows) {
    const code = r.CHECKINGACCOUNTCODE ?? 'NULL';
    byCode[code] = round2((byCode[code] ?? 0) + amountOf(r));
  }
  const tdcv = sumCode(rows, 'TDCV');
  if (expectedTdcv !== null) {
    if (tdcv === null || !near(tdcv, expectedTdcv)) {
      m.push({
        field: 'libro propietario TDCV (comision agencia sobre efectivo)',
        expected: expectedTdcv,
        actual: tdcv
      });
    }
  } else if (tdcv !== null) {
    m.push({
      field: 'libro propietario TDCV sin viajes en efectivo',
      expected: 'ausente',
      actual: tdcv
    });
  }
  const tddc = sumCode(rows, 'TDDC');
  if (hasCc && tddcExpected !== null) {
    if (tddc === null || !near(tddc, tddcExpected)) {
      m.push({
        field: 'libro propietario TDDC (formula CC)',
        expected: tddcExpected,
        actual: tddc
      });
    }
  } else if (!hasCc && tddc !== null) {
    m.push({ field: 'libro propietario TDDC sin viajes CC', expected: 'ausente', actual: tddc });
  }
  return { ...verdict(m), byCode };
}

export type VehicleLinkRow = { DRIVER_ID: number | null; VEHICLE_ID: number | null };

/** AC-FR-39: el vinculo chofer-vehiculo y el propietario del vehiculo se conservan tras la rendicion. */
export function evaluateVehicleLink(input: {
  links: readonly VehicleLinkRow[];
  vehicleOwnerId: number | null;
  expected: { driverId: number; vehicleId: number; ownerId: number };
}): OracleVerdict {
  const { links, vehicleOwnerId, expected } = input;
  const m: Mismatch[] = [];
  const linked = links.some(
    (l) => Number(l.DRIVER_ID) === expected.driverId && Number(l.VEHICLE_ID) === expected.vehicleId
  );
  if (!linked) {
    m.push({
      field: `DRIVER_VEHICLES (${expected.driverId}, ${expected.vehicleId})`,
      expected: 'vinculo presente',
      actual: links.map((l) => `${l.DRIVER_ID}/${l.VEHICLE_ID}`)
    });
  }
  if (vehicleOwnerId !== expected.ownerId) {
    m.push({ field: 'VEHICLE.VEHICLEOWNERID', expected: expected.ownerId, actual: vehicleOwnerId });
  }
  return verdict(m);
}

/** Lee vinculo DRIVER_VEHICLES del vehiculo y su VEHICLEOWNERID. Solo lectura. */
export async function readVehicleLink(
  db: OracleDb,
  vehicleId: number
): Promise<{ links: VehicleLinkRow[]; vehicleOwnerId: number | null }> {
  const links = await db.query<VehicleLinkRow>(
    'SELECT DRIVER_ID, VEHICLE_ID FROM DRIVER_VEHICLES WHERE VEHICLE_ID = :vehicleId',
    { vehicleId }
  );
  const veh = await db.query<{ VEHICLEOWNERID: number | null }>(
    'SELECT VEHICLEOWNERID FROM VEHICLE WHERE ID = :vehicleId',
    { vehicleId }
  );
  const owner = veh[0]?.VEHICLEOWNERID;
  return { links, vehicleOwnerId: owner === undefined || owner === null ? null : Number(owner) };
}

/** AC-FR-29/H-AUTO: columnas que son preguntas abiertas al PO (se observan, no se aseveran). */
export type SurrenderObsColumns = {
  AGENCY_NETPAID: number | null;
  TOTAL_COLLECTED: number | null;
  SETTLEMENT_OWNER: number | null;
  SETTLEMENT_DRIVER: number | null;
};

export async function readSurrenderObsColumns(
  db: OracleDb,
  surrenderId: number
): Promise<SurrenderObsColumns | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT AGENCY_NETPAID, TOTAL_COLLECTED, SETTLEMENT_OWNER, SETTLEMENT_DRIVER
       FROM TRAVELSSURRENDER WHERE ID = :surrenderId`,
    { surrenderId }
  );
  const r = rows[0];
  if (!r) return null;
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    AGENCY_NETPAID: n(r.AGENCY_NETPAID),
    TOTAL_COLLECTED: n(r.TOTAL_COLLECTED),
    SETTLEMENT_OWNER: n(r.SETTLEMENT_OWNER),
    SETTLEMENT_DRIVER: n(r.SETTLEMENT_DRIVER)
  };
}

/** AC-FR-42 (H-AUTO-01): comision de chofer 40 % esperada vs lo realmente acreditado. Solo texto. */
export function describeDriverCommissionNotBooked(input: {
  expectedDriverCommission: number;
  driverBookRows: number;
  ownerBookByCode: Record<string, number>;
}): string {
  const { expectedDriverCommission, driverBookRows, ownerBookByCode } = input;
  return (
    `comision del chofer (${PCT.driver * 100} %) esperada ${expectedDriverCommission}; filas en libro del chofer ${driverBookRows}; ` +
    `libro propietario por codigo ${JSON.stringify(ownerBookByCode)}; TDDV ${ownerBookByCode.TDDV === undefined ? 'ausente' : ownerBookByCode.TDDV}. Pregunta abierta al PO (H-AUTO-01).`
  );
}

/** AC-FR-43 (H-AUTO-03). */
export function describeAgencyNetPaid(c: SurrenderObsColumns | null): string {
  if (c === null) return 'fila TRAVELSSURRENDER no legible.';
  return `AGENCY_NETPAID ${c.AGENCY_NETPAID ?? 'NULL'} vs TOTAL_COLLECTED ${c.TOTAL_COLLECTED ?? 'NULL'} (manuales: AGENCY_NETPAID = TOTAL_COLLECTED). Pregunta abierta al PO (H-AUTO-03).`;
}

/** AC-FR-44 (H-AUTO-05). */
export function describeSettlementOwner(
  surrenderId: number,
  c: SurrenderObsColumns | null
): string {
  if (c === null) return 'fila TRAVELSSURRENDER no legible.';
  return `rendicion automatica ${surrenderId}: SETTLEMENT_OWNER ${c.SETTLEMENT_OWNER ?? 'NULL'}, SETTLEMENT_DRIVER ${c.SETTLEMENT_DRIVER ?? 'NULL'} (referencias previas: 13861 = 1, 13900 = 0). Pregunta abierta al PO (H-AUTO-05).`;
}

// ───────────────────────── AC-FR-75 / AC-FR-76 (liquidaciones) ─────────────────────────

/** AC-FR-75: las rendiciones liquidadas ya no figuran como pendientes (DB y API). */
export function evaluateSettledLeftPending(input: {
  settledSurrenderIds: readonly number[];
  dbPendingIds: readonly number[];
  apiPendingIds: readonly number[];
}): OracleVerdict {
  const m: Mismatch[] = [];
  const dbStill = input.settledSurrenderIds.filter((id) => input.dbPendingIds.includes(id));
  const apiStill = input.settledSurrenderIds.filter((id) => input.apiPendingIds.includes(id));
  if (dbStill.length > 0)
    m.push({ field: 'pendientes DB tras liquidar', expected: [], actual: dbStill });
  if (apiStill.length > 0)
    m.push({ field: 'pendientes API tras liquidar', expected: [], actual: apiStill });
  return verdict(m);
}

/** Ids de rendiciones de la respuesta de pendientes del propietario (`surrenderIds` = lista separada por coma). */
export function ownerSurrenderIds(
  groups: ReadonlyArray<{ surrenderIds?: string | null }>
): number[] {
  return groups
    .flatMap((g) => String(g.surrenderIds ?? '').split(','))
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

/** TRAVEL.ISLIQUIDATED de los viajes de las rendiciones dadas (TRAVEL y TRAVEL_HISTORY). Solo lectura. */
export async function readIsLiquidated(
  db: OracleDb,
  surrenderIds: readonly number[]
): Promise<Array<{ travelId: number; isLiquidated: number | null }>> {
  const out: Array<{ travelId: number; isLiquidated: number | null }> = [];
  for (const surrenderId of surrenderIds) {
    const rows = await db.query<{ ID: number; ISLIQUIDATED: number | null }>(
      `SELECT ID, ISLIQUIDATED FROM TRAVEL WHERE TRAVELSSURRENDER_ID = :surrenderId
       UNION ALL SELECT ID, ISLIQUIDATED FROM TRAVEL_HISTORY WHERE TRAVELSSURRENDER_ID = :surrenderId`,
      { surrenderId }
    );
    for (const r of rows) {
      out.push({
        travelId: Number(r.ID),
        isLiquidated:
          r.ISLIQUIDATED === null || r.ISLIQUIDATED === undefined ? null : Number(r.ISLIQUIDATED)
      });
    }
  }
  return out;
}

/** AC-FR-76: texto de observacion (BE no recalcula el total; ISLIQUIDATED no cambia). */
export function describeLiquidationObservation(input: {
  kind: 'driver' | 'owner';
  liquidationId: number;
  dbTotal: number | null;
  postedTotal: number;
  isLiquidated: ReadonlyArray<{ travelId: number; isLiquidated: number | null }>;
}): string {
  const { kind, liquidationId, dbTotal, postedTotal, isLiquidated } = input;
  const flags = [...new Set(isLiquidated.map((r) => r.isLiquidated))];
  return (
    `liquidacion ${kind} ${liquidationId}: total en DB ${dbTotal ?? 'NULL'} = total enviado por el FE ${postedTotal} ` +
    `(${dbTotal !== null && near(dbTotal, postedTotal) ? 'coinciden' : 'DIFIEREN'}; el BE no lo recalcula); ` +
    `TRAVEL.ISLIQUIDATED de ${isLiquidated.length} viaje(s) = ${JSON.stringify(flags)} (esperado por el PO a confirmar: no cambia al liquidar).`
  );
}
