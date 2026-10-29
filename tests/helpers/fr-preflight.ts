// tests/helpers/fr-preflight.ts
// Preflight unificado de aislamiento (SOLO LECTURA). Devuelve lo medido; el spec asevera dentro de
// verifyAc('AC-FR-20', ...). Sustituye a los
// expectAutoIsolation locales de S4/S5.
import type { SurrenderClient } from '../api/clients/surrender.client.js';
import type { OracleDb } from '../db/OracleDb.js';
import {
  pendingTripIdsOfVehicle,
  readOwnerCashCollector
} from '../steps/trips/autoSurrender.steps.js';
import { cronWindowStatus, type CronWindowStatus } from './run-window.js';

export type IsolationInput = {
  surrender: SurrenderClient;
  batch: { driverUserId: number; vehicleId: number };
  /** Opcionales: sin db no se leen flag ni viajes ajenos (quedan null / []). */
  db?: OracleDb | null;
  ownerId?: number;
  /** Viajes del propio lote que pueden estar pendientes (no cuentan como ajenos). */
  ownTripIds?: readonly number[];
  now?: Date;
};

export type IsolationReading = {
  /** Viajes del preview de rendicion manual del chofer/vehiculo. */
  batchRows: Array<number | null>;
  /** Filas del resumen de pendientes del chofer/vehiculo. */
  summaryRows: number;
  /** Viajes DONE sin rendir del vehiculo ajenos al lote (requiere db). */
  foreignTrips: number[];
  /** VEHICLEOWNERS.CASHCOLLECTOR (null si no hay db/ownerId o no existe). */
  cashCollectorFlag: number | null;
  cronWindow: CronWindowStatus;
};

export async function readIsolation(input: IsolationInput): Promise<IsolationReading> {
  const { surrender, batch, db, ownerId, now } = input;
  const own = input.ownTripIds ?? [];
  const preview = await surrender.preview(batch);
  const summary = (await surrender.pendingSummary()).filter(
    (r) => r.driverId === batch.driverUserId && r.vehicleId === batch.vehicleId
  );
  let foreignTrips: number[] = [];
  let cashCollectorFlag: number | null = null;
  if (db) {
    foreignTrips = (await pendingTripIdsOfVehicle(db, batch.vehicleId)).filter(
      (id) => !own.includes(id)
    );
    if (ownerId !== undefined) cashCollectorFlag = await readOwnerCashCollector(db, ownerId);
  }
  return {
    batchRows: preview.rows.map((r) => r.travelId ?? null),
    summaryRows: summary.length,
    foreignTrips,
    cashCollectorFlag,
    cronWindow: cronWindowStatus(now)
  };
}
