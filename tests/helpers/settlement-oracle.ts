// tests/helpers/settlement-oracle.ts
// Oraculo de liquidaciones (settlements) de CHOFER y PROPIETARIO del carrier. Separa la consulta
// (necesita `OracleDb`, SOLO LECTURA) de la evaluacion (funciones puras con unit test).
//
// Formulas: espejo de magiis-be (rama develop), leidas el 2026-10-21:
// - Chofer: CarrierDriverLiquidationRepository.getSurrenderSummaryForDriver + constructor de 25
//   parametros de TravelsSurrenderReportDTO. `comNeta` = COMMISSIONSUM - (CA_FC + TC_FC del chofer)
//   + propinas (CA+TC) + (peajes + estacionamiento). El FE suma `comNeta` de las rendiciones tildadas
//   y manda ese total en el POST: el BE NO lo recalcula.
// - Propietario: CarrierOwnerLiquidationRepository.getSurrenderSummaryForDriver + constructor de 24
//   parametros. `comNeta` = ownerCommission - (caFC + tcFC) + tips + expenses - agencyFixed - taxAndFeesCash
//   (ver `ownerNet`). La formula es lineal: sumar por rendicion == sumar por grupo fecha/vehiculo.
// - Columna «A liquidar» de la grilla: getToLiquidate (otra formula, mas corta). DIFIERE del total
//   del create cuando hay peajes/estacionamiento (chofer) o rendiciones sin chofer (propietario);
//   por eso se exponen las dos y el spec las compara por separado.
// Una rendicion esta «pendiente» para el chofer/propietario si NO figura en el detalle de una
// liquidacion con STATUS = 1 (PAID) de ese tipo. El flag SETTLEMENT_* es solo informativo.
import { round2 } from '../utils/money.js';
import type { OracleDb } from '../db/OracleDb.js';
import type { Mismatch } from './oracle-result.js';

export type { Mismatch };

/** Columnas de TRAVELSSURRENDER (+ COMMISSIONSETTINGS) que alimentan las formulas. */
export type SettlementSurrenderRow = {
  ID: number;
  IDFORCARRIER: number | null;
  DRIVER_ID: number | null;
  VEHICLEOWNERID: number | null;
  VEHICLE_ID: number | null;
  COMMISSIONSUM: number | null;
  OWNER_TOTALCOMMISSION: number | null;
  AGENCY_TOTALCOMMISSION: number | null;
  CHECKINGACCOUNTTIPS: number | null;
  CREDITCARDTIPS: number | null;
  DRIVER_CA_FINANCIAL_COST: number | null;
  DRIVER_TC_FINANCIAL_COST: number | null;
  OWNER_CA_FINANCIAL_COST: number | null;
  OWNER_TC_FINANCIAL_COST: number | null;
  TOTALROADTOLL: number | null;
  TOTALPARKING: number | null;
  FUELAMOUNT: number | null;
  MISCELLANYAMOUNT: number | null;
  AGENCY_FIXED_COMM: number | null;
  OWNER_FIXED_COMM: number | null;
  FIX_CONCEPT_COST_CASH: number | null;
  TAXES_COST_CASH: number | null;
  SETTLEMENT_DRIVER: number | null;
  SETTLEMENT_OWNER: number | null;
  /** COMMISSIONSETTINGS.FUELEXPENSEOWNER ('OWNER' = el gasto lo asume el propietario). */
  FUELEXPENSEOWNER: string | null;
  /** COMMISSIONSETTINGS.MISCELLANEOUSEXPENSEOWNER. */
  MISCELLANEOUSEXPENSEOWNER: string | null;
};

const n = (v: number | null | undefined): number => (typeof v === 'number' ? v : 0);
const hasDriver = (r: SettlementSurrenderRow): boolean => r.DRIVER_ID !== null;
const sum = (rows: readonly SettlementSurrenderRow[], f: (r: SettlementSurrenderRow) => number) =>
  round2(rows.reduce((acc, r) => acc + f(r), 0));

/** Desglose por rendicion de lo que el chofer cobra en la liquidacion. */
export type DriverNet = {
  surrenderId: number;
  commission: number;
  financialCost: number;
  tips: number;
  expenses: number;
  /** `comNeta` del BE: lo que suma el FE al tildar la rendicion. */
  net: number;
};

/** `comNeta` del chofer para UNA rendicion (constructor de 25 parametros del DTO). */
export function driverNet(r: SettlementSurrenderRow): DriverNet {
  const commission = n(r.COMMISSIONSUM);
  const financialCost = n(r.DRIVER_CA_FINANCIAL_COST) + n(r.DRIVER_TC_FINANCIAL_COST);
  // En el query de chofer la rendicion siempre tiene chofer (sur.driverUser = :driverAccount).
  const tips = hasDriver(r) ? n(r.CREDITCARDTIPS) + n(r.CHECKINGACCOUNTTIPS) : 0;
  const expenses = hasDriver(r) ? n(r.TOTALROADTOLL) + n(r.TOTALPARKING) : 0;
  return {
    surrenderId: r.ID,
    commission: round2(commission),
    financialCost: round2(financialCost),
    tips: round2(tips),
    expenses: round2(expenses),
    net: round2(commission - financialCost + tips + expenses)
  };
}

/** Total del create de chofer = suma de `comNeta` de las rendiciones elegidas. */
export function driverCreateTotal(rows: readonly SettlementSurrenderRow[]): number {
  return round2(rows.reduce((acc, r) => acc + driverNet(r).net, 0));
}

/**
 * Columna «A liquidar» de la grilla de choferes (CarrierDriverLiquidationRepository.getToLiquidate):
 * (COMMISSIONSUM + propinas si hay chofer) - (CA_FC + TC_FC). NO incluye peajes/estacionamiento.
 */
export function driverToLiquidateColumn(rows: readonly SettlementSurrenderRow[]): number {
  return sum(
    rows,
    (r) =>
      n(r.COMMISSIONSUM) +
      (hasDriver(r) ? n(r.CHECKINGACCOUNTTIPS) + n(r.CREDITCARDTIPS) : 0) -
      (n(r.DRIVER_CA_FINANCIAL_COST) + n(r.DRIVER_TC_FINANCIAL_COST))
  );
}

/** Desglose por rendicion de lo que el propietario cobra en la liquidacion. */
export type OwnerNet = {
  surrenderId: number;
  ownerCommission: number;
  caFinancialCost: number;
  tcFinancialCost: number;
  tips: number;
  expenses: number;
  agencyFixedCommission: number;
  taxAndFeesCash: number;
  net: number;
};

/**
 * `comNeta` del propietario para UNA rendicion (constructor de 24 parametros del DTO).
 * - ownerCommission: OWNER_TOTALCOMMISSION (+ COMMISSIONSUM si la rendicion NO tiene chofer: el
 *   propietario conduce y cobra tambien la comision de chofer).
 * - caFC: OWNER_CA_FC + gasto de combustible/varios si los asume el propietario + (sin chofer) DRIVER_CA_FC.
 * - tcFC: OWNER_TC_FC + (sin chofer) DRIVER_TC_FC.
 * - tips / expenses / taxAndFeesCash: solo cuentan si NO hay chofer.
 */
export function ownerNet(r: SettlementSurrenderRow): OwnerNet {
  const driverless = !hasDriver(r);
  const ownerCommission = n(r.OWNER_TOTALCOMMISSION) + (driverless ? n(r.COMMISSIONSUM) : 0);
  const caFinancialCost =
    n(r.OWNER_CA_FINANCIAL_COST) +
    (r.FUELEXPENSEOWNER === 'OWNER' ? n(r.FUELAMOUNT) : 0) +
    (r.MISCELLANEOUSEXPENSEOWNER === 'OWNER' ? n(r.MISCELLANYAMOUNT) : 0) +
    (driverless ? n(r.DRIVER_CA_FINANCIAL_COST) : 0);
  const tcFinancialCost =
    n(r.OWNER_TC_FINANCIAL_COST) + (driverless ? n(r.DRIVER_TC_FINANCIAL_COST) : 0);
  const tips = driverless ? n(r.CHECKINGACCOUNTTIPS) + n(r.CREDITCARDTIPS) : 0;
  const expenses = driverless ? n(r.TOTALROADTOLL) + n(r.TOTALPARKING) : 0;
  const agencyFixedCommission = n(r.AGENCY_FIXED_COMM);
  const taxAndFeesCash = driverless ? n(r.FIX_CONCEPT_COST_CASH) + n(r.TAXES_COST_CASH) : 0;
  return {
    surrenderId: r.ID,
    ownerCommission: round2(ownerCommission),
    caFinancialCost: round2(caFinancialCost),
    tcFinancialCost: round2(tcFinancialCost),
    tips: round2(tips),
    expenses: round2(expenses),
    agencyFixedCommission: round2(agencyFixedCommission),
    taxAndFeesCash: round2(taxAndFeesCash),
    net: round2(
      ownerCommission -
        (caFinancialCost + tcFinancialCost) +
        tips +
        expenses -
        agencyFixedCommission -
        taxAndFeesCash
    )
  };
}

/** Total del create de propietario = suma de `comNeta` (por grupo fecha/vehiculo == por rendicion). */
export function ownerCreateTotal(rows: readonly SettlementSurrenderRow[]): number {
  return round2(rows.reduce((acc, r) => acc + ownerNet(r).net, 0));
}

/**
 * Columna «A liquidar» de la grilla de propietarios (CarrierOwnerLiquidationRepository.getToLiquidate):
 * (OWNER_TOTALCOMMISSION + sin chofer: propinas) - (OWNER_CA_FC + OWNER_TC_FC).
 */
export function ownerToLiquidateColumn(rows: readonly SettlementSurrenderRow[]): number {
  return sum(
    rows,
    (r) =>
      n(r.OWNER_TOTALCOMMISSION) +
      (hasDriver(r) ? 0 : n(r.CHECKINGACCOUNTTIPS) + n(r.CREDITCARDTIPS)) -
      (n(r.OWNER_CA_FINANCIAL_COST) + n(r.OWNER_TC_FINANCIAL_COST))
  );
}

// ───────────────────────── evaluacion pura ─────────────────────────

/** Compara importes con tolerancia de 1 centavo; devuelve las diferencias (vacio = OK). */
export function compareAmounts(
  pairs: ReadonlyArray<{ what: string; expected: number; actual: number | null | undefined }>
): Mismatch[] {
  return pairs
    .filter((p) => typeof p.actual !== 'number' || Math.abs(p.actual - p.expected) > 0.005)
    .map((p) => ({ field: p.what, expected: p.expected, actual: p.actual ?? null }));
}

/** Estado de una liquidacion en DB (C_D_LIQUIDATION / C_O_LIQUIDATION). 0 impaga, 1 cerrada(PAID), 2 vencida/CANCELED en el enum Java, 4 anulada (comentario de columna). */
export type LiquidationDbRow = {
  ID: number;
  STATUS: number | null;
  TOTAL: number | null;
  CARRIER_ID: number | null;
};

export type LiquidationDetailRow = { LIQUIDATION_ID: number; TRAVELSSURRENDER_ID: number };

/**
 * Invariantes de una liquidacion recien creada (post-condicion del confirm):
 * 1. STATUS = 1 (PAID; el FE manda `status: 'PAID'`).
 * 2. TOTAL == oraculo (suma de `comNeta` de las rendiciones elegidas).
 * 3. El detalle contiene EXACTAMENTE las rendiciones elegidas.
 * 4. SETTLEMENT_* = 1 en cada rendicion elegida y 0/NULL en las no elegidas pendientes.
 */
export function evaluateCreatedLiquidation(input: {
  kind: 'driver' | 'owner';
  liquidation: LiquidationDbRow;
  details: readonly LiquidationDetailRow[];
  chosen: readonly SettlementSurrenderRow[];
  untouched: readonly SettlementSurrenderRow[];
  expectedTotal: number;
}): Mismatch[] {
  const { kind, liquidation, details, chosen, untouched, expectedTotal } = input;
  const flag = (r: SettlementSurrenderRow): number | null =>
    kind === 'driver' ? r.SETTLEMENT_DRIVER : r.SETTLEMENT_OWNER;
  const out: Mismatch[] = [];
  if (liquidation.STATUS !== 1)
    out.push({ field: 'STATUS de la liquidacion', expected: 1, actual: liquidation.STATUS });
  out.push(
    ...compareAmounts([
      { what: 'TOTAL de la liquidacion', expected: expectedTotal, actual: liquidation.TOTAL }
    ])
  );
  const inDetail = details.map((d) => d.TRAVELSSURRENDER_ID).sort((a, b) => a - b);
  const want = chosen.map((r) => r.ID).sort((a, b) => a - b);
  if (JSON.stringify(inDetail) !== JSON.stringify(want))
    out.push({ field: 'rendiciones del detalle', expected: want, actual: inDetail });
  for (const r of chosen)
    if (flag(r) !== 1)
      out.push({
        field: `SETTLEMENT_${kind.toUpperCase()} de la rendicion ${r.ID}`,
        expected: 1,
        actual: flag(r)
      });
  for (const r of untouched)
    if (flag(r) === 1)
      out.push({
        field: `SETTLEMENT_${kind.toUpperCase()} de la rendicion NO elegida ${r.ID}`,
        expected: '0/NULL',
        actual: 1
      });
  return out;
}

/**
 * La liquidacion NO debe tocar los libros (CHECKINGACCOUNTFORDRIVER / CHECKINGACCOUNTFOROWNER): el
 * BE no inserta movimientos ni cambia STATUS de esas filas (medido en TEST 2026-10-21: STATUS
 * es NULL en las 2.2k/2.7k filas del ambiente aun con liquidaciones PAID). Compara saldo y cantidad
 * de filas antes/despues.
 */
export function evaluateBooksUntouched(input: {
  label: string;
  before: { rows: number; balance: number | null };
  after: { rows: number; balance: number | null };
}): Mismatch[] {
  const { label, before, after } = input;
  const out: Mismatch[] = [];
  if (before.rows !== after.rows)
    out.push({ field: `filas del libro ${label}`, expected: before.rows, actual: after.rows });
  if (before.balance !== null && after.balance !== null)
    out.push(
      ...compareAmounts([
        { what: `saldo del libro ${label}`, expected: before.balance, actual: after.balance }
      ])
    );
  return out;
}

// ───────────────────────── consultas (solo lectura) ─────────────────────────

const SURRENDER_COLUMNS = [
  'ts.ID',
  'ts.IDFORCARRIER',
  'ts.DRIVER_ID',
  'ts.VEHICLEOWNERID',
  'ts.VEHICLE_ID',
  'ts.COMMISSIONSUM',
  'ts.OWNER_TOTALCOMMISSION',
  'ts.AGENCY_TOTALCOMMISSION',
  'ts.CHECKINGACCOUNTTIPS',
  'ts.CREDITCARDTIPS',
  'ts.DRIVER_CA_FINANCIAL_COST',
  'ts.DRIVER_TC_FINANCIAL_COST',
  'ts.OWNER_CA_FINANCIAL_COST',
  'ts.OWNER_TC_FINANCIAL_COST',
  'ts.TOTALROADTOLL',
  'ts.TOTALPARKING',
  'ts.FUELAMOUNT',
  'ts.MISCELLANYAMOUNT',
  'ts.AGENCY_FIXED_COMM',
  'ts.OWNER_FIXED_COMM',
  'ts.FIX_CONCEPT_COST_CASH',
  'ts.TAXES_COST_CASH',
  'ts.SETTLEMENT_DRIVER',
  'ts.SETTLEMENT_OWNER',
  'cs.FUELEXPENSEOWNER',
  'cs.MISCELLANEOUSEXPENSEOWNER'
].join(', ');

const FROM_SURRENDER =
  'FROM TRAVELSSURRENDER ts LEFT JOIN COMMISSIONSETTINGS cs ON cs.ID = ts.COMMISSION_SETTINGS_ID';

/** Dia UTC `yyyy-MM-dd`: la DB guarda CREATIONDATE en UTC; un Date local ART dejaria lo creado hoy a futuro. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Rendiciones PENDIENTES del chofer (DRIVER.ID) hasta el dia UTC de `toDate` (inclusive): no figuran en una liquidacion PAID. */
export async function driverOpenSurrenders(
  db: OracleDb,
  p: { carrierId: number; driverAccountId: number; toDate?: Date }
): Promise<SettlementSurrenderRow[]> {
  const to = p.toDate ?? new Date();
  return db.query<SettlementSurrenderRow>(
    `SELECT ${SURRENDER_COLUMNS} ${FROM_SURRENDER}
      WHERE ts.CARRIER_ID = :carrierId AND ts.DRIVER_ID = :driverId AND ts.CREATIONDATE < TO_DATE(:toDay, 'YYYY-MM-DD') + 1
        AND ts.ID NOT IN (SELECT d.TRAVELSSURRENDER_ID FROM C_D_LIQUIDATION_DETAIL d
                          JOIN C_D_LIQUIDATION l ON l.ID = d.LIQUIDATION_ID WHERE l.STATUS = 1)
      ORDER BY ts.ID`,
    { carrierId: p.carrierId, driverId: p.driverAccountId, toDay: utcDay(to) }
  );
}

/** Rendiciones PENDIENTES del propietario (VEHICLEOWNERS.ID) hasta `toDate`. */
export async function ownerOpenSurrenders(
  db: OracleDb,
  p: { carrierId: number; ownerId: number; toDate?: Date }
): Promise<SettlementSurrenderRow[]> {
  const to = p.toDate ?? new Date();
  return db.query<SettlementSurrenderRow>(
    `SELECT ${SURRENDER_COLUMNS} ${FROM_SURRENDER}
      WHERE ts.CARRIER_ID = :carrierId AND ts.VEHICLEOWNERID = :ownerId AND ts.CREATIONDATE < TO_DATE(:toDay, 'YYYY-MM-DD') + 1
        AND ts.ID NOT IN (SELECT d.TRAVELSSURRENDER_ID FROM C_O_LIQUIDATION_DETAIL d
                          JOIN C_O_LIQUIDATION l ON l.ID = d.LIQUIDATION_ID WHERE l.STATUS = 1)
      ORDER BY ts.ID`,
    { carrierId: p.carrierId, ownerId: p.ownerId, toDay: utcDay(to) }
  );
}

/** Rendiciones por id (para releer SETTLEMENT_* tras el confirm). */
export async function surrendersByIds(
  db: OracleDb,
  carrierId: number,
  ids: readonly number[]
): Promise<SettlementSurrenderRow[]> {
  if (ids.length === 0) return [];
  // Binds posicionales generados: la lista es de enteros validados, nunca texto libre.
  const binds: Record<string, number> = { carrierId };
  const names = ids.map((id, i) => {
    if (!Number.isInteger(id)) throw new Error(`[settlement-oracle] id invalido: ${id}`);
    binds[`id${i}`] = id;
    return `:id${i}`;
  });
  return db.query<SettlementSurrenderRow>(
    `SELECT ${SURRENDER_COLUMNS} ${FROM_SURRENDER}
      WHERE ts.CARRIER_ID = :carrierId AND ts.ID IN (${names.join(', ')}) ORDER BY ts.ID`,
    binds
  );
}

export type LiquidationKind = 'driver' | 'owner';

const LIQ_TABLES: Record<LiquidationKind, { head: string; detail: string }> = {
  driver: { head: 'C_D_LIQUIDATION', detail: 'C_D_LIQUIDATION_DETAIL' },
  owner: { head: 'C_O_LIQUIDATION', detail: 'C_O_LIQUIDATION_DETAIL' }
};

/** Cabecera + detalle de una liquidacion por id (nombres de tabla de una lista cerrada). */
export async function liquidationFromDb(
  db: OracleDb,
  kind: LiquidationKind,
  liquidationId: number
): Promise<{ liquidation: LiquidationDbRow | null; details: LiquidationDetailRow[] }> {
  const t = LIQ_TABLES[kind];
  const heads = await db.query<LiquidationDbRow>(
    `SELECT ID, STATUS, TOTAL, CARRIER_ID FROM ${t.head} WHERE ID = :id`,
    { id: liquidationId }
  );
  const details = await db.query<LiquidationDetailRow>(
    `SELECT LIQUIDATION_ID, TRAVELSSURRENDER_ID FROM ${t.detail} WHERE LIQUIDATION_ID = :id ORDER BY TRAVELSSURRENDER_ID`,
    { id: liquidationId }
  );
  return { liquidation: heads[0] ?? null, details };
}

/** Liquidaciones PAID (STATUS=1) de un carrier que contienen la rendicion; base del 409 TRAVEL_LIQUIDATED. */
export async function paidLiquidationsOfSurrender(
  db: OracleDb,
  kind: LiquidationKind,
  surrenderId: number
): Promise<number[]> {
  const t = LIQ_TABLES[kind];
  const rows = await db.query<{ LIQUIDATION_ID: number }>(
    `SELECT d.LIQUIDATION_ID FROM ${t.detail} d JOIN ${t.head} l ON l.ID = d.LIQUIDATION_ID
      WHERE d.TRAVELSSURRENDER_ID = :id AND l.STATUS = 1 ORDER BY d.LIQUIDATION_ID`,
    { id: surrenderId }
  );
  return rows.map((r) => r.LIQUIDATION_ID);
}

/** Cantidad de filas y STATUS distintos de un libro (el STATUS del libro no cambia con la liquidacion). */
export async function bookStatusCounts(
  db: OracleDb,
  kind: LiquidationKind,
  accountId: number
): Promise<Array<{ STATUS: number | null; N: number }>> {
  const sql =
    kind === 'driver'
      ? 'SELECT STATUS, COUNT(*) N FROM CHECKINGACCOUNTFORDRIVER WHERE DRIVERACCOUNT_ID = :id GROUP BY STATUS'
      : 'SELECT STATUS, COUNT(*) N FROM CHECKINGACCOUNTFOROWNER WHERE VEHICLEOWNER_ID = :id GROUP BY STATUS';
  return db.query<{ STATUS: number | null; N: number }>(sql, { id: accountId });
}
