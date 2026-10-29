// tests/steps/trips/autoSurrender.steps.ts
// Oraculos DB (SOLO LECTURA) y verificacion de la RENDICION AUTOMATICA FR (S4/S5). Tablas/columnas
// verificadas con SELECT/ALL_TAB_COLUMNS en TEST el 2026-10-21: TRAVELSSURRENDER (DRIVER_ID NULL = automatica),
// TRAVEL / TRAVEL_HISTORY (TRAVELSSURRENDER_ID), FINALPRICEI (VEHICLE_ID, FINALPRICE, PAYMENTMETHOD),
// VEHICLEOWNERS.CASHCOLLECTOR, CHECKINGACCOUNTFOROWNER (CHECKINGACCOUNTCODE, DEBIT, CREDIT,
// TRAVELSSURRENDER_ID), CHECKINGACCOUNTFORDRIVER (TRAVELSSURRENDER_ID), MOVEMENT (TRAVEL_ID).
// Ninguna consulta usa fechas (evita el desfase de zona al bindear Date): todo se liga por id de viaje.
import type { OracleDb } from '../../db/OracleDb.js';
import {
  expectedAutoSurrender,
  type AutoHandoff,
  type AutoTrip,
  type ExpectedAutoSurrender,
  type OwnerBookDbRow
} from '../../helpers/auto-surrender.js';
import { readSurrenderRow, type MovementRow, type SurrenderRow } from './dbOracles.steps.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function assertIds(label: string, ids: readonly number[]): void {
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`[autoSurrender] ${label}: ids invalidos (${ids.join(', ') || 'vacio'})`);
  }
}

/** CASHCOLLECTOR del propietario (0/1); null si el propietario no existe. */
export async function readOwnerCashCollector(
  db: OracleDb,
  ownerId: number
): Promise<number | null> {
  assertIds('ownerId', [ownerId]);
  const rows = await db.query<{ CASHCOLLECTOR: number | null }>(
    'SELECT CASHCOLLECTOR FROM VEHICLEOWNERS WHERE ID = :ownerId',
    { ownerId }
  );
  return rows.length === 0 ? null : asNum(rows[0].CASHCOLLECTOR);
}

/** Ids de viajes DONE/CANCELLED sin rendir con FINALPRICE > 0 del vehiculo (lo que barre el cron). */
export async function pendingTripIdsOfVehicle(db: OracleDb, vehicleId: number): Promise<number[]> {
  assertIds('vehicleId', [vehicleId]);
  const rows = await db.query<{ ID: number }>(
    `SELECT t.ID FROM TRAVEL t JOIN FINALPRICEI fp ON fp.ID = t.FINALPRICE_ID
     WHERE fp.VEHICLE_ID = :vehicleId AND t.STATE IN (6, 7) AND t.SURRENDERED = 0
       AND fp.FINALPRICE > 0 AND fp.PAYMENTMETHOD IS NOT NULL
     ORDER BY t.ID`,
    { vehicleId }
  );
  return rows.map((r) => Number(r.ID));
}

function inList(ids: readonly number[]): { clause: string; binds: Record<string, number> } {
  const binds: Record<string, number> = {};
  const names = ids.map((id, i) => {
    binds[`t${i}`] = id;
    return `:t${i}`;
  });
  return { clause: names.join(', '), binds };
}

/** TRAVELSSURRENDER_ID de cada viaje (TRAVEL o TRAVEL_HISTORY, que se llena con retraso por el GMT). */
export async function surrenderIdsOfTrips(
  db: OracleDb,
  travelIds: readonly number[]
): Promise<Map<number, number | null>> {
  assertIds('travelIds', travelIds);
  const { clause, binds } = inList(travelIds);
  const rows = await db.query<{ ID: number; TRAVELSSURRENDER_ID: number | null }>(
    `SELECT ID, TRAVELSSURRENDER_ID FROM TRAVEL WHERE ID IN (${clause})
     UNION ALL
     SELECT ID, TRAVELSSURRENDER_ID FROM TRAVEL_HISTORY WHERE ID IN (${clause})`,
    binds
  );
  const out = new Map<number, number | null>();
  for (const r of rows) {
    const current = out.get(Number(r.ID));
    const value = asNum(r.TRAVELSSURRENDER_ID);
    // El viaje puede estar en TRAVEL y en TRAVEL_HISTORY a la vez: gana el valor no nulo.
    out.set(Number(r.ID), current ?? value);
  }
  return out;
}

/** Ids de viaje de una rendicion (TRAVEL + TRAVEL_HISTORY, sin duplicados). */
export async function tripIdsOfSurrender(db: OracleDb, surrenderId: number): Promise<number[]> {
  assertIds('surrenderId', [surrenderId]);
  const rows = await db.query<{ ID: number }>(
    `SELECT ID FROM TRAVEL WHERE TRAVELSSURRENDER_ID = :surrenderId
     UNION
     SELECT ID FROM TRAVEL_HISTORY WHERE TRAVELSSURRENDER_ID = :surrenderId`,
    { surrenderId }
  );
  return rows.map((r) => Number(r.ID)).sort((a, b) => a - b);
}

export type SurrenderHeader = {
  ID: number;
  DRIVER_ID: number | null;
  VEHICLE_ID: number | null;
  VEHICLEOWNERID: number | null;
  CARRIER_ID: number | null;
  IDFORCARRIER: number | null;
  OWNER_CHECK_ACC_COMM: number | null;
  CHECKINGACCOUNTCOMMISSION: number | null;
  OWNER_CA_FINANCIAL_COST: number | null;
  DRIVER_CA_FINANCIAL_COST: number | null;
};

export async function readSurrenderHeader(
  db: OracleDb,
  surrenderId: number
): Promise<SurrenderHeader> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ID, DRIVER_ID, VEHICLE_ID, VEHICLEOWNERID, CARRIER_ID, IDFORCARRIER,
            OWNER_CHECK_ACC_COMM, CHECKINGACCOUNTCOMMISSION, OWNER_CA_FINANCIAL_COST, DRIVER_CA_FINANCIAL_COST
     FROM TRAVELSSURRENDER WHERE ID = :surrenderId`,
    { surrenderId }
  );
  const r = rows[0];
  if (!r) throw new Error(`[autoSurrender] TRAVELSSURRENDER ${surrenderId} no existe`);
  return {
    ID: Number(r.ID),
    DRIVER_ID: asNum(r.DRIVER_ID),
    VEHICLE_ID: asNum(r.VEHICLE_ID),
    VEHICLEOWNERID: asNum(r.VEHICLEOWNERID),
    CARRIER_ID: asNum(r.CARRIER_ID),
    IDFORCARRIER: asNum(r.IDFORCARRIER),
    OWNER_CHECK_ACC_COMM: asNum(r.OWNER_CHECK_ACC_COMM),
    CHECKINGACCOUNTCOMMISSION: asNum(r.CHECKINGACCOUNTCOMMISSION),
    OWNER_CA_FINANCIAL_COST: asNum(r.OWNER_CA_FINANCIAL_COST),
    DRIVER_CA_FINANCIAL_COST: asNum(r.DRIVER_CA_FINANCIAL_COST)
  };
}

export async function readOwnerBookOfSurrender(
  db: OracleDb,
  surrenderId: number
): Promise<OwnerBookDbRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT CHECKINGACCOUNTCODE, DEBIT, CREDIT FROM CHECKINGACCOUNTFOROWNER
     WHERE TRAVELSSURRENDER_ID = :surrenderId ORDER BY ID`,
    { surrenderId }
  );
  return rows.map((r) => ({
    CHECKINGACCOUNTCODE: r.CHECKINGACCOUNTCODE === null ? null : String(r.CHECKINGACCOUNTCODE),
    DEBIT: asNum(r.DEBIT),
    CREDIT: asNum(r.CREDIT)
  }));
}

export async function countDriverBookOfSurrender(
  db: OracleDb,
  surrenderId: number
): Promise<number> {
  const rows = await db.query<{ N: number }>(
    'SELECT COUNT(*) AS N FROM CHECKINGACCOUNTFORDRIVER WHERE TRAVELSSURRENDER_ID = :surrenderId',
    { surrenderId }
  );
  return Number(rows[0]?.N ?? 0);
}

/** Movimientos de la CC ligados a un viaje (sin filtro de fecha). */
export async function movementsOfTravel(
  db: OracleDb,
  ccId: number,
  travelId: number
): Promise<MovementRow[]> {
  assertIds('ccId/travelId', [ccId, travelId]);
  return db.query<MovementRow>(
    `SELECT ID, TRAVEL_ID, MOVEMENT_CODE, MOVEMENT_TYPE, MOUNT, CURRENCY_ID, MOVEMENTSTATUS, CREATIONDATE
     FROM MOVEMENT WHERE CHECKINGACCOUNT_ID = :ccId AND TRAVEL_ID = :travelId ORDER BY ID`,
    { ccId, travelId }
  );
}

/** Detalle de la rendicion cuando todos los viajes apuntan a una sola (lectura pura). */
export type AutoSurrenderDetail = {
  surrenderId: number;
  header: SurrenderHeader;
  tripIds: number[];
  row: SurrenderRow;
  ownerBookRows: OwnerBookDbRow[];
  driverBookRows: number;
  pendingAfter: number[];
};

export type AutoSurrenderData = {
  expected: ExpectedAutoSurrender;
  /** TRAVELSSURRENDER_ID por viaje (ausente = no esta en TRAVEL ni TRAVEL_HISTORY; null = sin rendir). */
  bySurrender: Map<number, number | null>;
  /** Valores distintos de TRAVELSSURRENDER_ID del lote (incluye null). */
  distinctSurrenderIds: Array<number | null>;
  /** null si el lote no apunta a UNA rendicion no nula: el spec ya habra fallado antes de usarlo. */
  detail: AutoSurrenderDetail | null;
};

/**
 * Lee por DB (SOLO LECTURA) todo lo necesario para verificar la rendicion automatica del lote cerrado
 * del handoff. No juzga: devuelve los datos y el spec ejecuta las aserciones (ver `fr-circuit-s5-auto`).
 */
export async function readAutoSurrender(params: {
  db: OracleDb;
  handoff: AutoHandoff;
  trips: readonly AutoTrip[];
}): Promise<AutoSurrenderData> {
  const { db, handoff, trips } = params;
  const expected = expectedAutoSurrender(trips);
  const bySurrender = await surrenderIdsOfTrips(db, expected.travelIds);
  const distinctSurrenderIds = [...new Set([...bySurrender.values()])];
  const only = distinctSurrenderIds.length === 1 ? distinctSurrenderIds[0] : null;
  const allPresent = expected.travelIds.every((id) => bySurrender.has(id));
  if (only === null || !allPresent) {
    return { expected, bySurrender, distinctSurrenderIds, detail: null };
  }
  const header = await readSurrenderHeader(db, only);
  const detail: AutoSurrenderDetail = {
    surrenderId: only,
    header,
    tripIds: await tripIdsOfSurrender(db, only),
    row: await readSurrenderRow(db, only),
    ownerBookRows: await readOwnerBookOfSurrender(db, only),
    driverBookRows: await countDriverBookOfSurrender(db, only),
    pendingAfter: await pendingTripIdsOfVehicle(db, handoff.vehicleId)
  };
  return { expected, bySurrender, distinctSurrenderIds, detail };
}
