// tests/steps/trips/dbOracles.steps.ts
// Oraculos de la pata DB (SOLO LECTURA) del circuito carrier no-Universal (PLAN-E2E-CARRIER-FRANCIA
// W1-6). Reglas de origen: REGLAS-BASELINE-CARRIER-NO-UNIVERSAL-2026-10-19.md (pares costo = venta,
// formula de comision, 1 MOVEMENT por viaje CC) y baseline-2001-2026-10-19.md §3.
//

// con unit tests). Ante una diferencia lanzan un Error que NOMBRA la columna y los dos valores.
// Tablas/columnas verificadas contra la DB de TEST con describe_table el 2026-10-19:
// TRAVEL / TRAVEL_HISTORY (ID, FINALPRICE_ID, TRAVELSSURRENDER_ID, CARRIERACCOUNT_ID), FINALPRICEI,
// PRICEADDITIONAL, TRAVEL_OTHERCOST, TRAVELSSURRENDER, MOVEMENT.
// Tras rendir, TRAVEL se vacia y el viaje pasa a TRAVEL_HISTORY (con retraso por el GMT nocturno):
// por eso se consultan ambas.
//
// Este modulo SOLO consulta y devuelve datos (filas crudas). La evaluacion de reglas de negocio vive
// en tests/helpers/db-oracle-eval.ts y la ejecuta el spec.
import type { OracleDb } from '../../db/OracleDb.js';
import {
  SURRENDER_COLUMNS,
  type MovementRow,
  type OtherCostItemRow,
  type SaleCostRow,
  type SurrenderColumn,
  type SurrenderRow
} from '../../helpers/db-oracle-eval.js';

export type {
  MovementRow,
  OtherCostItemRow,
  SaleCostRow,
  SurrenderColumn,
  SurrenderRow
} from '../../helpers/db-oracle-eval.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const SALE_COST_SQL = `
WITH tv AS (
  SELECT ID, FINALPRICE_ID, 'TRAVEL' AS SRC FROM TRAVEL WHERE ID = :travelId
  UNION ALL
  SELECT ID, FINALPRICE_ID, 'TRAVEL_HISTORY' AS SRC FROM TRAVEL_HISTORY WHERE ID = :travelId
)
SELECT tv.SRC, f.ADDITIONAL_ID, f.FINALPRICE, f.FINAL_COST_PRICE, f.TOTALCOSTPARTIAL,
       f.TOTALCOSTPARTIAL_COST, f.KM, a.WAITTIMEPRICE, a.WAIT_TOTAL_PRICE_COST, a.OTHERCOST,
       a.OTHER_COST_TOTAL_PRICE_COST, a.OTHER_COST_TOTAL_NOCOM, a.OTHER_COST_PRICE_COST_NOCOM,
       a.TOOLPRICE, a.PARKING, a.FIX_CONCEPT_COST, a.TAXES_COST
FROM tv
LEFT JOIN FINALPRICEI f ON f.ID = tv.FINALPRICE_ID
LEFT JOIN PRICEADDITIONAL a ON a.ID = f.ADDITIONAL_ID`;

const OTHER_COST_ITEMS_SQL = `
SELECT ID, NAME, PRICE, PRICE_COST, IS_COMMISIONABLE
FROM TRAVEL_OTHERCOST
WHERE OTHER_LIST_INFO = :additionalId
ORDER BY ID`;

/** Datos crudos del viaje para evaluar los pares costo/venta (`evaluateSaleCostPairs`). */
export type SaleCostData = { travelId: number; row: SaleCostRow; items: OtherCostItemRow[] };

/** Lee el viaje (TRAVEL o TRAVEL_HISTORY) y sus otros costos. Falla (tecnico) si no existe o no tiene FINALPRICEI. */
export async function readSaleCostData(db: OracleDb, travelId: number): Promise<SaleCostData> {
  const rows = await db.query<SaleCostRow>(SALE_COST_SQL, { travelId });
  const row = rows[0];
  if (!row)
    throw new Error(`[dbOracle] viaje ${travelId} no existe en TRAVEL ni en TRAVEL_HISTORY`);
  if (rows.length > 1) {
    throw new Error(`[dbOracle] viaje ${travelId} aparece en TRAVEL y en TRAVEL_HISTORY a la vez`);
  }
  if (row.ADDITIONAL_ID === null || row.FINALPRICE === null) {
    throw new Error(
      `[dbOracle] viaje ${travelId} (${row.SRC}) sin FINALPRICEI/PRICEADDITIONAL: ` +
        'no cerro con importes (cancelacion sin cargo o aun abierto)'
    );
  }
  const items = await db.query<OtherCostItemRow>(OTHER_COST_ITEMS_SQL, {
    additionalId: row.ADDITIONAL_ID
  });
  return { travelId, row, items };
}

// Los nombres vienen de una lista cerrada (nunca de input): no hay interpolacion de datos externos.
const SURRENDER_SQL = `SELECT ${SURRENDER_COLUMNS.join(', ')} FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;

/** Lee las columnas gate + controles de la rendicion (`evaluateSurrenderRow` las contrasta). */
export async function readSurrenderRow(db: OracleDb, surrenderId: number): Promise<SurrenderRow> {
  const rows = await db.query<Record<string, unknown>>(SURRENDER_SQL, { surrenderId });
  const raw = rows[0];
  if (!raw) throw new Error(`[dbOracle] TRAVELSSURRENDER ${surrenderId} no existe`);
  return Object.fromEntries(
    SURRENDER_COLUMNS.map((c: SurrenderColumn) => [c, asNum(raw[c])])
  ) as SurrenderRow;
}

const MOVEMENT_SQL = `
SELECT ID, TRAVEL_ID, MOVEMENT_CODE, MOVEMENT_TYPE, MOUNT, CURRENCY_ID, MOVEMENTSTATUS, CREATIONDATE
FROM MOVEMENT
WHERE CHECKINGACCOUNT_ID = :ccId AND CREATIONDATE >= :sinceTs
ORDER BY ID`;

/** Movimientos de una CC creados desde `sinceTs` (instante tomado antes de la accion del test). */
export async function movementOracle(
  db: OracleDb,
  ccId: number,
  sinceTs: Date
): Promise<MovementRow[]> {
  if (!Number.isInteger(ccId) || ccId <= 0) throw new Error(`[dbOracle] ccId invalido: ${ccId}`);
  return db.query<MovementRow>(MOVEMENT_SQL, { ccId, sinceTs });
}
