// tests/steps/trips/commissionBase.steps.ts
// Pasos de PK-B (plan docs/plans/PK-B-circuito-admin-chofer-2026-10-21.md, T2): alta por UI con varios
// otros costos / nota / hora programada, lecturas DB de solo lectura (porcentajes, TRAVEL, tarifador,
// conceptos) y lectura de la fila del viaje en la vista previa de «Cierres de Caja».
//
// Reglas:
// - Cada funcion es un paso atomico; ninguna llama a otra funcion de este modulo.
// - Solo devuelven datos (o lanzan por configuracion/entorno): las reglas de negocio las asevera el spec.
// - NUNCA confirma una rendicion: el unico acceso a «Cierres de Caja» es de lectura (GET) y
//   `watchSurrenderPosts` cuenta cualquier escritura para que el spec la declare.
// - No modifica `adminCircuit.steps.ts` (linea FR de otra sesion): `createTripViaUi` replica su alta
//   (cliente -> autorizador -> pago -> origen -> destino -> cotizar -> otros costos) agregando nota,
//   hora programada y varios otros costos. Deuda: al mergear FR, plegarlo en `AdminCircuitFlow.createViaUi`.
// - Alta SIEMPRE con «Enviar Manual» (nunca «A» = despacho automatico).
import type { Page } from '@playwright/test';
import { getCurrentEnv } from '../../config/runtime.js';
import type { OracleDb } from '../../db/OracleDb.js';
import type { SurrenderClient, SurrenderPreviewRow } from '../../api/clients/surrender.client.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { quoteRouteFor } from '../../data/carrier-v2/trips/quote-route.js';
import { recordAdminCircuitTrip, recordLeakedTrip } from '../../helpers/trip-ledger.js';
import type {
  CommissionConfig,
  CommissionDbPrice,
  CommissionTravelPcts
} from '../../helpers/commission-base.js';
import { parseMoney } from '../../utils/money.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Registro de viajes abiertos propios de PK-B (los barre `recoverLeakedTrips` en la corrida siguiente). */
export const PKB_OPEN_LEDGER_SCOPE = 'pkb-open';

export type PkbTripCreated = {
  travelId: number;
  simulatedAmount: number;
  resolvedOrigin: string;
  resolvedDestination: string;
  summary: Awaited<ReturnType<NewTripPage['readPriceSummary']>>;
  /** Hora programada elegida en el combo (null = «Now»). */
  scheduledLabel: string | null;
};

/** `hh:mm AM/PM` (formato del combo de hora) de un instante, en la zona del navegador. */
export function timeOptionLabel(at: Date): string {
  return at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** `mm/dd/yyyy` (formato del datepicker en el harness en-US) de un instante, en la zona del navegador. */
export function dateInputValue(at: Date): string {
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${at.getFullYear()}`;
}

/** Proximo multiplo de 5 minutos a partir de `now + minutes` (el combo ofrece pasos de 5 minutos). */
export function scheduleSlot(now: Date, minutesAhead: number): Date {
  const target = new Date(now.getTime() + minutesAhead * 60_000);
  target.setSeconds(0, 0);
  const rem = target.getMinutes() % 5;
  if (rem !== 0) target.setMinutes(target.getMinutes() + (5 - rem));
  return target;
}

/**
 * Alta por UI con «Enviar Manual». `otherCosts` se agregan en orden tras cotizar (nombre exacto del
 * catalogo). `note` va como nota general. `scheduleAt` programa el viaje (fecha + hora del combo).
 * `ledger`: `admin-circuit` (viajes que terminan DONE, excluidos de la regresion manual R-01) o
 * `open` (viajes que el spec cancela; barrido de la corrida siguiente si queda colgado).
 * `assertBeforeSubmit` es la guarda anti-vacuidad del spec: si lanza, no se crea ningun viaje.
 */
export async function createTripViaUi(params: {
  page: Page;
  runId: string;
  client: string;
  authorizer?: string;
  paymentMethod: string | RegExp;
  otherCosts?: readonly string[];
  note?: string;
  scheduleAt?: Date;
  ledger: 'admin-circuit' | 'open';
  assertBeforeSubmit: (quote: {
    simulatedAmount: number;
    resolvedOrigin: string;
    resolvedDestination: string;
  }) => void | Promise<void>;
}): Promise<PkbTripCreated> {
  const {
    page,
    runId,
    client,
    authorizer,
    paymentMethod,
    otherCosts = [],
    note,
    scheduleAt
  } = params;
  const route = quoteRouteFor(undefined);
  const trip = new NewTripPage(page);
  await trip.goto();
  await trip.selectClient(client);
  if (authorizer !== undefined) await trip.selectAuthorizer(authorizer);
  await trip.selectPaymentMethod(paymentMethod);
  await trip.fillOrigin(route.origin);
  await trip.fillFirstDestination(route.destination);
  const resolvedOrigin = ((await trip.resolvedOriginValue.textContent()) ?? '').trim();
  const resolvedDestination = ((await trip.resolvedDestinationValue.textContent()) ?? '').trim();

  let scheduledLabel: string | null = null;
  if (scheduleAt !== undefined) {
    scheduledLabel = timeOptionLabel(scheduleAt);
    const dateValue = dateInputValue(scheduleAt);
    if ((await trip.tripDateInput.inputValue()) !== dateValue) {
      await trip.tripDateInput.fill(dateValue);
      await trip.tripDateInput.blur();
    }
    await trip.tripTimeSelect.click();
    await trip.dropdownOptions.filter({ hasText: scheduledLabel }).first().click();
    // Sanidad del combo: el valor mostrado es el elegido (no una regla de negocio).
    await trip.tripTimeValue.waitFor({ state: 'visible' });
    const shown = ((await trip.tripTimeValue.innerText()) ?? '').trim();
    if (shown !== scheduledLabel) {
      throw new Error(
        `[commissionBase] el combo de hora muestra «${shown}» y se eligio «${scheduledLabel}»`
      );
    }
  }
  if (note !== undefined) await trip.addNotes({ general: note });

  await trip.quoteTrip();
  for (const name of otherCosts) await trip.addOtherCost({ name });
  const summary = await trip.readPriceSummary();
  const simulatedAmount = parseMoney(summary.total);
  await params.assertBeforeSubmit({ simulatedAmount, resolvedOrigin, resolvedDestination });

  const created = await trip.sendManualAndCaptureCreate();
  const travelId = Number(created.travelId);
  const env = getCurrentEnv();
  if (params.ledger === 'admin-circuit') recordAdminCircuitTrip(env, travelId, runId);
  else recordLeakedTrip(env, travelId, runId, PKB_OPEN_LEDGER_SCOPE);
  return {
    travelId,
    simulatedAmount,
    resolvedOrigin,
    resolvedDestination,
    summary,
    scheduledLabel
  };
}

// ───────────────────────── lecturas DB (solo SELECT) ─────────────────────────

/** Datos del viaje de TRAVEL: pcts de comision, rendicion y el dueno/flag para la guarda del cron. */
export type CommissionTravelDb = CommissionTravelPcts & {
  STATE: number | null;
  DRIVER_ID: number | null;
  VEHICLE_ID: number | null;
  TRAVELSSURRENDER_ID: number | null;
  SURRENDERED: number | null;
  FINALPRICE_ID: number | null;
  OWNER_ID: number | null;
  CASHCOLLECTOR: number | null;
};

export async function readCommissionTravelDb(
  db: OracleDb,
  travelId: number
): Promise<CommissionTravelDb> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT t.STATE, t.DRIVER_ID, t.VEHICLE_ID, t.DRIVER_COMMISSION_PCT, t.OWNER_COMMISSION_PCT,
            t.AGENCY_COMMISSION_PCT, t.TRAVELSSURRENDER_ID, t.SURRENDERED, t.FINALPRICE_ID,
            v.VEHICLEOWNERID AS OWNER_ID, vo.CASHCOLLECTOR
     FROM TRAVEL t
     LEFT JOIN VEHICLE v ON v.ID = t.VEHICLE_ID
     LEFT JOIN VEHICLEOWNERS vo ON vo.ID = v.VEHICLEOWNERID
     WHERE t.ID = :travelId`,
    { travelId }
  );
  const r = rows[0];
  if (!r) throw new Error(`[commissionBase] viaje ${travelId} no existe en TRAVEL`);
  return {
    STATE: asNum(r.STATE),
    DRIVER_ID: asNum(r.DRIVER_ID),
    VEHICLE_ID: asNum(r.VEHICLE_ID),
    DRIVER_COMMISSION_PCT: asNum(r.DRIVER_COMMISSION_PCT),
    OWNER_COMMISSION_PCT: asNum(r.OWNER_COMMISSION_PCT),
    AGENCY_COMMISSION_PCT: asNum(r.AGENCY_COMMISSION_PCT),
    TRAVELSSURRENDER_ID: asNum(r.TRAVELSSURRENDER_ID),
    SURRENDERED: asNum(r.SURRENDERED),
    FINALPRICE_ID: asNum(r.FINALPRICE_ID),
    OWNER_ID: asNum(r.OWNER_ID),
    CASHCOLLECTOR: asNum(r.CASHCOLLECTOR)
  };
}

/** Componentes de costo del viaje (FINALPRICEI / PRICEADDITIONAL) con las columnas que usa el oraculo. */
export async function readCommissionDbPrice(
  db: OracleDb,
  travelId: number
): Promise<CommissionDbPrice> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT f.FINAL_COST_PRICE, f.TOTALCOSTPARTIAL_COST, a.WAIT_TOTAL_PRICE_COST,
            a.OTHER_COST_TOTAL_PRICE_COST, a.OTHER_COST_TOTAL_NOCOM, a.OTHER_COST_PRICE_COST_NOCOM
     FROM TRAVEL t
     JOIN FINALPRICEI f ON f.ID = t.FINALPRICE_ID
     JOIN PRICEADDITIONAL a ON a.ID = f.ADDITIONAL_ID
     WHERE t.ID = :travelId`,
    { travelId }
  );
  const r = rows[0];
  if (!r) {
    throw new Error(`[commissionBase] viaje ${travelId} sin FINALPRICEI/PRICEADDITIONAL en TRAVEL`);
  }
  return {
    FINAL_COST_PRICE: asNum(r.FINAL_COST_PRICE),
    TOTALCOSTPARTIAL_COST: asNum(r.TOTALCOSTPARTIAL_COST),
    WAIT_TOTAL_PRICE_COST: asNum(r.WAIT_TOTAL_PRICE_COST),
    OTHER_COST_TOTAL_PRICE_COST: asNum(r.OTHER_COST_TOTAL_PRICE_COST),
    OTHER_COST_TOTAL_NOCOM: asNum(r.OTHER_COST_TOTAL_NOCOM),
    OTHER_COST_PRICE_COST_NOCOM: asNum(r.OTHER_COST_PRICE_COST_NOCOM)
  };
}

/** Configuracion de comisiones del chofer y del vehiculo (porcentajes tal como se guardan, 0-100). */
export async function readCommissionConfig(
  db: OracleDb,
  driverId: number,
  vehicleId: number
): Promise<CommissionConfig> {
  const driver = await db.query<Record<string, unknown>>(
    `SELECT s.TRAVELPERCENTAGE, s.COST_PERCENTAGE
     FROM DRIVER d JOIN DRIVERSETTLPARAM s ON s.ID = d.DRIVERSETTPARAM_ID
     WHERE d.ID = :driverId`,
    { driverId }
  );
  const vehicle = await db.query<Record<string, unknown>>(
    `SELECT c.PERCENTAGECOMMISSION, c.PERCENTAGECOMMISSION_FOR_COST, c.PERCENTAGECOMMISSIONPAYEE
     FROM VEHICLE v JOIN COMMISSIONSETTINGS c ON c.ID = v.CURRENTCOMMISSION_ID
     WHERE v.ID = :vehicleId`,
    { vehicleId }
  );
  if (!driver[0]) throw new Error(`[commissionBase] chofer ${driverId} sin DRIVERSETTLPARAM`);
  if (!vehicle[0]) throw new Error(`[commissionBase] vehiculo ${vehicleId} sin comision vigente`);
  return {
    driverSalePct: asNum(driver[0].TRAVELPERCENTAGE),
    driverCostPct: asNum(driver[0].COST_PERCENTAGE),
    vehicleSalePct: asNum(vehicle[0].PERCENTAGECOMMISSION),
    vehicleCostPct: asNum(vehicle[0].PERCENTAGECOMMISSION_FOR_COST),
    payee:
      vehicle[0].PERCENTAGECOMMISSIONPAYEE === null
        ? null
        : String(vehicle[0].PERCENTAGECOMMISSIONPAYEE)
  };
}

/** CARRIERRATE.RATE_BY_COST (1 = tarifador por costo; 0 = solo venta). null si no existe. */
export async function readRateByCost(db: OracleDb, rateId: number): Promise<number | null> {
  const rows = await db.query<{ RATE_BY_COST: number | null }>(
    'SELECT RATE_BY_COST FROM CARRIERRATE WHERE ID = :rateId',
    { rateId }
  );
  return rows.length === 0 ? null : asNum(rows[0].RATE_BY_COST);
}

/** Concepto de otros costos tal como esta configurado (CARRIER_OTHER_COSTS). */
export type OtherCostConceptRow = {
  ID: number;
  CONCEPT: string;
  CONCEPT_VALUE: number | null;
  CONCEPT_VALUE_COST: number | null;
  IS_COMMISIONABLE: number | null;
  DELETED: number | null;
};

export async function readOtherCostConcept(
  db: OracleDb,
  conceptId: number
): Promise<OtherCostConceptRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ID, CONCEPT, CONCEPT_VALUE, CONCEPT_VALUE_COST, IS_COMMISIONABLE, DELETED
     FROM CARRIER_OTHER_COSTS WHERE ID = :conceptId`,
    { conceptId }
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ID: Number(r.ID),
    CONCEPT: String(r.CONCEPT),
    CONCEPT_VALUE: asNum(r.CONCEPT_VALUE),
    CONCEPT_VALUE_COST: asNum(r.CONCEPT_VALUE_COST),
    IS_COMMISIONABLE: asNum(r.IS_COMMISIONABLE),
    DELETED: asNum(r.DELETED)
  };
}

// ───────────────────────── vista previa de «Cierres de Caja» ─────────────────────────

/**
 * Filas del viaje en el lote pendiente (GET toSurrend, todas las paginas, solo lectura). Devuelve
 * todas las coincidencias: el spec asevera que sea exactamente una.
 */
export async function readPreviewRows(
  surrender: SurrenderClient,
  batch: { driverUserId: number; vehicleId: number },
  travelId: number,
  to: string
): Promise<{ matches: SurrenderPreviewRow[]; batchSize: number }> {
  const preview = await surrender.preview({ ...batch, to });
  return {
    matches: preview.rows.filter((r) => r.travelId === travelId),
    batchSize: preview.rows.length
  };
}

/**
 * Cuenta escrituras (no-GET) hacia `toTravelsSurrender` mientras el test mira la vista previa. El spec
 * exige 0: el POST es la confirmacion irreversible de la rendicion.
 */
export function watchSurrenderPosts(page: Page): { count: () => number } {
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/travels\/toTravelsSurrender/.test(request.url()))
      posts += 1;
  });
  return { count: () => posts };
}

// ───────────────────────── precondiciones de aislamiento (solo SELECT) ─────────────────────────

/** Viajes del chofer que NO estan en estado terminal (6 DONE, 7 CANCELLED). Vacio = chofer libre. */
export async function readOpenTripsOfDriver(db: OracleDb, driverId: number): Promise<number[]> {
  const rows = await db.query<{ ID: number }>(
    'SELECT ID FROM TRAVEL WHERE DRIVER_ID = :driverId AND STATE NOT IN (6, 7) ORDER BY ID',
    { driverId }
  );
  return rows.map((r) => Number(r.ID));
}

/** Dueno del vehiculo y su CASHCOLLECTOR (insumo de la guarda de la ventana del cron de rendicion). */
export async function readVehicleOwnerFlag(
  db: OracleDb,
  vehicleId: number
): Promise<{ ownerId: number | null; cashCollector: number | null }> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT v.VEHICLEOWNERID AS OWNER_ID, vo.CASHCOLLECTOR
     FROM VEHICLE v LEFT JOIN VEHICLEOWNERS vo ON vo.ID = v.VEHICLEOWNERID
     WHERE v.ID = :vehicleId`,
    { vehicleId }
  );
  const r = rows[0];
  if (!r) throw new Error(`[commissionBase] vehiculo ${vehicleId} no existe`);
  return { ownerId: asNum(r.OWNER_ID), cashCollector: asNum(r.CASHCOLLECTOR) };
}
