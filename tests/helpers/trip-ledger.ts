// tests/helpers/trip-ledger.ts
// Registro persistente de viajes creados por la automatizacion (recupero de corridas interrumpidas).
// Modulo neutral: lo comparten los Steps de Otros Costos y los specs MG-682 sin depender uno del otro.
//
// No hay endpoint relevado para listar los viajes del carrier por marca de la automatizacion, asi
// que el barrido usa un registro local por ambiente y por `scope` (cada suite el suyo): cada alta
// capturada se anota y cada cancelacion la borra. Lo que quede anotado (corrida cortada, limpieza
// fallida) lo cancela el barrido de la corrida siguiente, y SOLO eso: nunca se cancela un viaje que
// no este anotado. Vive en evidence/<env>/ (gitignored). Pensado para --workers=1.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SessionRejectedError } from '../api/clients/carrierSession.js';
import type { TravelsClient } from '../api/clients/travels.client.js';
import type { AppEnv } from '../config/runtime.js';

export type TripLedgerEntry = { travelId: number; runId: string; recordedAt: string };

/** Scope historico (familia Otros Costos): conserva el nombre del archivo previo. */
export const OTHER_COSTS_LEDGER_SCOPE = 'other-costs';

/**
 * Scope del circuito admin (alta -> asignacion -> viaje DONE). Es un REGISTRO de viajes terminales
 * para excluirlos de las regresiones manuales, NO una cola de limpieza: ningun barrido los cancela.
 */
export const ADMIN_CIRCUIT_LEDGER_SCOPE = 'admin-circuit';

/** Estados terminales: el viaje ya no se puede (ni se debe) cancelar. */
const TERMINAL_STATES = new Set(['DONE', 'CANCELLED', 'LOST']);

function ledgerPath(env: AppEnv, scope: string): string {
  const suffix = scope === ADMIN_CIRCUIT_LEDGER_SCOPE ? 'done-trips' : 'open-trips';
  return `evidence/${env}/${scope}-${suffix}.json`;
}

function readLedger(env: AppEnv, scope: string): TripLedgerEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(env, scope), 'utf-8')) as unknown;
    return Array.isArray(parsed) ? (parsed as TripLedgerEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLedger(env: AppEnv, scope: string, entries: TripLedgerEntry[]): void {
  const path = ledgerPath(env, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf-8');
}

export function ledgerAdd(env: AppEnv, entry: TripLedgerEntry, scope: string): void {
  const entries = readLedger(env, scope);
  if (!entries.some((e) => e.travelId === entry.travelId)) {
    writeLedger(env, scope, [...entries, entry]);
  }
}

export function ledgerRemove(env: AppEnv, travelId: number, scope: string): void {
  const entries = readLedger(env, scope);
  if (entries.some((e) => e.travelId === travelId)) {
    writeLedger(
      env,
      scope,
      entries.filter((e) => e.travelId !== travelId)
    );
  }
}

export function ledgerList(env: AppEnv, scope: string): TripLedgerEntry[] {
  return readLedger(env, scope);
}

/** Anota un viaje (al crearlo, o si la limpieza no pudo cancelarlo) para el barrido de la proxima corrida. */
export function recordLeakedTrip(
  env: AppEnv,
  travelId: number,
  runId: string,
  scope: string = OTHER_COSTS_LEDGER_SCOPE
): void {
  ledgerAdd(env, { travelId, runId, recordedAt: new Date().toISOString() }, scope);
}

/** Anota un viaje del circuito admin (termina DONE a proposito) para excluirlo de regresiones manuales. */
export function recordAdminCircuitTrip(env: AppEnv, travelId: number, runId: string): void {
  recordLeakedTrip(env, travelId, runId, ADMIN_CIRCUIT_LEDGER_SCOPE);
}

/**
 * Barrido de viajes de corridas anteriores: cancela los que siguen anotados en el registro del
 * `scope`. Los viajes en estado terminal (DONE/CANCELLED/LOST) solo se borran del registro (con
 * warning para DONE/LOST), sin cancelar. El scope `admin-circuit` nunca se barre. Un fallo se informa y el viaje queda
 * anotado; una sesion rechazada (401/403) lanza (STOP).
 */
export async function recoverLeakedTrips(
  travelsApi: TravelsClient,
  env: AppEnv,
  scope: string = OTHER_COSTS_LEDGER_SCOPE
): Promise<{ cancelled: number[]; failed: string[] }> {
  const cancelled: number[] = [];
  const failed: string[] = [];
  if (scope === ADMIN_CIRCUIT_LEDGER_SCOPE) return { cancelled, failed };
  for (const entry of readLedger(env, scope)) {
    try {
      const detail = await travelsApi.getDetail(entry.travelId);
      const state = String(detail.state ?? '');
      if (!TERMINAL_STATES.has(state)) {
        await travelsApi.cancel(entry.travelId);
        cancelled.push(entry.travelId);
      } else if (state !== 'CANCELLED') {
        console.warn(
          `[trip-ledger] viaje ${entry.travelId} en estado terminal ${state}: se quita del registro sin cancelar`
        );
      }
      ledgerRemove(env, entry.travelId, scope);
    } catch (error) {
      if (error instanceof SessionRejectedError) throw error;
      failed.push(`viaje ${entry.travelId}: ${(error as Error).message}`);
    }
  }
  return { cancelled, failed };
}
