// tests/helpers/auto-surrender.ts
// Piezas puras y de handoff de la rendicion AUTOMATICA FR (S4 CC + city taxes por app real, S5 cash por
// cierre admin). Diseno y evidencia: docs/qa/automation-stock/fr-1901/rendicion-automatica-diseno-2026-10-21.md.
//
// Mecanica verificada contra magiis-be (develop) y TEST:
// - Cron `AutomaticSurrendersCron` -> `TravelService.generateAutomaticTravelsSurrender`: para cada carrier de
//   ADMIN_PARAMETERS.AUTOMATIC_SURRENDER_CARRIER_LIST (TEST = ALL) toma los PROPIETARIOS con
//   VEHICLEOWNERS.CASHCOLLECTOR = 1 y rinde TODOS los viajes DONE/CANCELLED sin rendir con FINALPRICE > 0 de
//   TODOS sus vehiculos, en UNA fila TRAVELSSURRENDER por vehiculo con DRIVER_ID NULL.
// - Disparador por UI: V2 Owners > Edit > papelera del vehiculo > modal -> PUT vehicles/{v}/carrier/{c}/travelsSurrender
//   (mismo `automaticSurrenderProcess`, sin chequear el flag del propietario).
// - La rendicion automatica NO genera movimientos en el libro del CHOFER; en el del propietario genera
//   solo los de comision de agencia / CC (p. ej. TDCV credito = comision de agencia sobre efectivo).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { round2 } from '../utils/money.js';
import type { FrBooksSnapshot } from './fr-circuit.js';
import { PCT } from './fr-circuit.js';
import {
  evaluateOneMovementPerTravel,
  type MovementRow,
  type OracleVerdict
} from './db-oracle-eval.js';

export const AUTO_HANDOFF_PATH = 'evidence/test/fr-auto-handoff.json';

export type AutoPhase = 'prepare' | 'arm' | 'fire' | 'verify' | 'disarm';
export type AutoMode = 'desvincular' | 'cron';

const PHASES: readonly AutoPhase[] = ['prepare', 'arm', 'fire', 'verify', 'disarm'];

/** Fase pedida por FR_AUTO_PHASE; null si falta o es invalida (el spec se salta con el motivo). */
export function autoPhaseFromEnv(source: NodeJS.ProcessEnv = process.env): AutoPhase | null {
  const raw = source.FR_AUTO_PHASE?.trim().toLowerCase();
  return PHASES.find((p) => p === raw) ?? null;
}

/** Disparador pedido por FR_AUTO_MODE (default `desvincular`); lanza ante un valor desconocido. */
export function autoModeFromEnv(source: NodeJS.ProcessEnv = process.env): AutoMode {
  const raw = source.FR_AUTO_MODE?.trim().toLowerCase();
  if (!raw) return 'desvincular';
  if (raw === 'desvincular' || raw === 'cron') return raw;
  throw new Error(`FR_AUTO_MODE invalido: «${raw}» (usar desvincular | cron)`);
}

export type AutoPaymentMethod = 'CASH' | 'CHECKING_ACCOUNT';

/** Un viaje del lote automatico (S4 = CC + city taxes por app, S5 = cash por cierre admin). */
export type AutoTrip = {
  scenario: 'S4' | 'S5';
  travelId: number;
  paymentMethod: AutoPaymentMethod;
  simulated: number;
  closedBy: 'app' | 'admin';
  /** true solo tras asignar al chofer (S4); el cierre por app lo hace el harness de mpw-fr. */
  assigned: boolean;
  /** Se completa cuando el viaje queda DONE (S5 en prepare; S4 en s4-auto-verify). */
  closed?: {
    finalPrice: number;
    /** Importe del otro costo «city taxes» (S4); 0 si no hay. */
    cityTax: number;
    tolls: number;
    parking: number;
    closedAt: string;
  };
};

export type AutoHandoff = {
  createdAt: string;
  carrierId: number;
  ownerId: number;
  vehicleId: number;
  /** DRIVER.ID (el mismo de los specs manuales). */
  driverId: number;
  /** Foto de libros tomada ANTES del primer alta del lote. */
  booksBefore: FrBooksSnapshot;
  /** CASHCOLLECTOR del propietario al preparar (0/1); null si no hubo DB. */
  ownerCashCollectorBefore: number | null;
  mode: AutoMode;
  trips: Partial<Record<'S4' | 'S5', AutoTrip>>;
  /** Instante (ISO) previo a la accion que dispara la rendicion; lo fija la fase `fire`/`arm`. */
  armedAt?: string;
  /** Id de la fila TRAVELSSURRENDER detectada por verify (informativo). */
  surrenderId?: number;
};

export function readAutoHandoff(path: string = AUTO_HANDOFF_PATH): AutoHandoff | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as AutoHandoff;
}

export function requireAutoHandoff(path: string = AUTO_HANDOFF_PATH): AutoHandoff {
  const data = readAutoHandoff(path);
  if (!data || !data.trips || Object.keys(data.trips).length === 0) {
    throw new Error(
      `[fr-auto] no existe ${path} (o no tiene viajes): correr antes fr-circuit-s5-auto (FR_AUTO_PHASE=prepare) y/o fr-circuit-s4-auto-prepare`
    );
  }
  return data;
}

export function writeAutoHandoff(data: AutoHandoff, path: string = AUTO_HANDOFF_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

/** Lee, aplica `change` y reescribe el handoff (crea uno nuevo con `seed` si no existe). */
export function updateAutoHandoff(
  change: (current: AutoHandoff) => AutoHandoff,
  seed: () => AutoHandoff,
  path: string = AUTO_HANDOFF_PATH
): AutoHandoff {
  const next = change(readAutoHandoff(path) ?? seed());
  writeAutoHandoff(next, path);
  return next;
}

/** Viajes ya cerrados del handoff (los que forman el lote esperado). */
export function closedTrips(handoff: AutoHandoff): AutoTrip[] {
  return (Object.values(handoff.trips) as AutoTrip[]).filter(
    (t) => t !== undefined && t.closed !== undefined
  );
}

/** Viajes del handoff que todavia no cerraron (bloquean verify). */
export function openTrips(handoff: AutoHandoff): AutoTrip[] {
  return (Object.values(handoff.trips) as AutoTrip[]).filter(
    (t) => t !== undefined && t.closed === undefined
  );
}

export type ExpectedAutoSurrender = {
  travelIds: number[];
  /** Columnas de TRAVELSSURRENDER; solo las que la formula verificada predice. */
  row: {
    TOTALBILLING: number;
    TOTALCASH: number;
    TOTALCASHQTY: number;
    TOTALCHECKINGACCOUNT: number;
    TOTALCHECKACCQTY: number;
    CASHCOMMISSION: number;
    CHECKINGACCOUNTCOMMISSION: number;
    COMMISSIONSUM: number;
    OWNER_TOTALCOMMISSION: number;
    AGENCY_TOTALCOMMISSION: number;
    TOTALOTHERCOST: number;
    TOTALOTHERCOST_NOCOM: number;
  };
  /** Bases de comision por medio de pago (venta - peaje - estacionamiento; el city tax es comisionable). */
  bases: { cash: number; checkingAccount: number };
  /** Comisiones por reparto (PCT 40/40/20) sobre cada base. */
  commissions: {
    cash: { owner: number; driver: number; agency: number };
    checkingAccount: { owner: number; driver: number; agency: number };
  };
  /** Movimiento esperado del libro del propietario (valor absoluto del monto, solo lo verificado). */
  ownerBook: { TDCV: number | null };
};

const split = (base: number) => ({
  owner: round2(PCT.owner * base),
  driver: round2(PCT.driver * base),
  agency: round2(PCT.agency * base)
});

/**
 * Esperado de la fila automatica a partir de los viajes cerrados. Formula medida en TEST 1901
 * (rendiciones 13843 manual / 13861 automatica y 13859/13860 CC): base = venta - peaje - estacionamiento
 * (incluye city taxes), propietario 40 % y agencia 20 % por medio de pago; TOTALOTHERCOST = otros costos
 * de viajes CC; TDCV = comision de agencia sobre la base en efectivo.
 */
export function expectedAutoSurrender(trips: readonly AutoTrip[]): ExpectedAutoSurrender {
  if (trips.length === 0) throw new Error('[fr-auto] expectedAutoSurrender sin viajes');
  let cashBase = 0;
  let ccBase = 0;
  let cashTotal = 0;
  let ccTotal = 0;
  let cashQty = 0;
  let ccQty = 0;
  let ccOtherCost = 0;
  for (const trip of trips) {
    const closed = trip.closed;
    if (!closed) throw new Error(`[fr-auto] viaje ${trip.travelId} (${trip.scenario}) sin cerrar`);
    const base = round2(closed.finalPrice - closed.tolls - closed.parking);
    if (trip.paymentMethod === 'CASH') {
      cashBase += base;
      cashTotal += closed.finalPrice;
      cashQty += 1;
    } else {
      ccBase += base;
      ccTotal += closed.finalPrice;
      ccQty += 1;
      ccOtherCost += closed.cityTax;
    }
  }
  cashBase = round2(cashBase);
  ccBase = round2(ccBase);
  const cash = split(cashBase);
  const cc = split(ccBase);
  const ownerTotal = round2(cash.owner + cc.owner);
  return {
    travelIds: trips.map((t) => t.travelId),
    row: {
      TOTALBILLING: round2(cashTotal + ccTotal),
      TOTALCASH: round2(cashTotal),
      TOTALCASHQTY: cashQty,
      TOTALCHECKINGACCOUNT: round2(ccTotal),
      TOTALCHECKACCQTY: ccQty,
      CASHCOMMISSION: cash.owner,
      CHECKINGACCOUNTCOMMISSION: cc.owner,
      COMMISSIONSUM: ownerTotal,
      OWNER_TOTALCOMMISSION: ownerTotal,
      AGENCY_TOTALCOMMISSION: round2(cash.agency + cc.agency),
      TOTALOTHERCOST: round2(ccOtherCost),
      TOTALOTHERCOST_NOCOM: 0
    },
    bases: { cash: cashBase, checkingAccount: ccBase },
    commissions: { cash, checkingAccount: cc },
    ownerBook: { TDCV: cashQty > 0 ? cash.agency : null }
  };
}

/** Lote exacto: mismos ids, sin ajenos ni faltantes ni duplicados. Mensaje nombra primero los ajenos. */
export function compareBatchIds(
  actual: readonly number[],
  expected: readonly number[]
): string | null {
  const want = new Set(expected);
  const seen = new Set<number>();
  const duplicated = new Set<number>();
  for (const id of actual) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }
  const foreign = [...seen].filter((id) => !want.has(id));
  const missing = [...want].filter((id) => !seen.has(id));
  if (foreign.length === 0 && missing.length === 0 && duplicated.size === 0) return null;
  const parts: string[] = [];
  if (foreign.length > 0) parts.push(`viajes AJENOS en la rendicion: ${foreign.join(', ')}`);
  if (missing.length > 0) parts.push(`viajes esperados ausentes: ${missing.join(', ')}`);
  if (duplicated.size > 0) parts.push(`viajes duplicados: ${[...duplicated].join(', ')}`);
  return parts.join('; ');
}

export type OwnerBookDbRow = {
  CHECKINGACCOUNTCODE: string | null;
  DEBIT: number | null;
  CREDIT: number | null;
};

/** Monto absoluto de un movimiento del libro del propietario (debito o credito, sin asumir signo). */
export function movementAmount(row: OwnerBookDbRow): number {
  return round2(Math.max(Math.abs(Number(row.DEBIT ?? 0)), Math.abs(Number(row.CREDIT ?? 0))));
}

/** Suma de montos absolutos por codigo de movimiento del libro del propietario. */
export function sumByCode(rows: readonly OwnerBookDbRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const code = row.CHECKINGACCOUNTCODE ?? 'NULL';
    out[code] = round2((out[code] ?? 0) + movementAmount(row));
  }
  return out;
}

/**
 * Consistencia interna de TDDC (movimiento de CC del propietario) segun la formula del backend
 * (TravelsSurrenderService.generateCheckingAccountMovementsForOwnerAutomaticSurrender):
 * OWNER_CHECK_ACC_COMM + CHECKINGACCOUNTCOMMISSION - OWNER_CA_FINANCIAL_COST - DRIVER_CA_FINANCIAL_COST.
 * `doubleCountSuspect` marca cuando ambas comisiones son iguales (el monto duplicaria la comision del
 * propietario): se registra como observacion, NO como fallo (regla de negocio sin confirmar).
 */
export function tddcFormula(row: {
  OWNER_CHECK_ACC_COMM: number | null;
  CHECKINGACCOUNTCOMMISSION: number | null;
  OWNER_CA_FINANCIAL_COST: number | null;
  DRIVER_CA_FINANCIAL_COST: number | null;
}): { expected: number; doubleCountSuspect: boolean } {
  const owner = Number(row.OWNER_CHECK_ACC_COMM ?? 0);
  const checking = Number(row.CHECKINGACCOUNTCOMMISSION ?? 0);
  const expected = round2(
    owner +
      checking -
      Number(row.OWNER_CA_FINANCIAL_COST ?? 0) -
      Number(row.DRIVER_CA_FINANCIAL_COST ?? 0)
  );
  return { expected, doubleCountSuspect: owner !== 0 && Math.abs(owner - checking) < 0.011 };
}

/**
 * Ventana horaria del cron: corre a las ~13:10 UTC (10:10 ART). Devuelve los minutos hasta la proxima
 * ejecucion desde `now` (UTC); sirve para decidir si conviene esperar o dejar el verify para despues.
 */
export function minutesToNextCron(now: Date): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 10, 0)
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return Math.ceil((next.getTime() - now.getTime()) / 60_000);
}

/**
 * El cron toma viajes con CREATIONDATE <= la hora en punto de la ejecucion (13:00 UTC). Un viaje creado
 * despues de esa hora espera al dia siguiente. true si `createdAt` entra en la corrida de `runDay` (UTC).
 */
export function includedInCronRun(createdAt: Date, runDay: Date): boolean {
  const cutoff = Date.UTC(
    runDay.getUTCFullYear(),
    runDay.getUTCMonth(),
    runDay.getUTCDate(),
    13,
    0,
    0
  );
  return createdAt.getTime() <= cutoff;
}

/** Resultado del cobro CC del cierre S4: `movement` es el TIVR AUTOMATIC encontrado (null si no hay UNO). */
export type CcChargeVerdict = OracleVerdict & { movement: MovementRow | null };

/**
 * Evalua (pura; no lanza ni asevera) el cobro del cierre S4 por app: 1 movimiento TIVR AUTOMATIC con
 * MOUNT = precio final, sin duplicados. El spec lee las filas con `movementsOfTravel`, llama a esta
 * funcion y asevera `ok` con `formatMismatches`.
 */
export function evaluateCcChargeOfTrip(
  rows: readonly MovementRow[],
  trip: AutoTrip
): CcChargeVerdict {
  if (!trip.closed) {
    return {
      ok: false,
      movement: null,
      mismatches: [
        { field: `viaje ${trip.travelId}: cierre registrado`, expected: 'cerrado', actual: null }
      ]
    };
  }
  const verdict = evaluateOneMovementPerTravel(rows, [
    { travelId: trip.travelId, amount: trip.closed.finalPrice }
  ]);
  return {
    ok: verdict.ok,
    mismatches: verdict.mismatches,
    movement: verdict.found.get(trip.travelId) ?? null
  };
}
