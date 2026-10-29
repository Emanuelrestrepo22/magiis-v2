// tests/specs/trips/driver-list-reassigned.spec.ts
// TM-1427 · TM-1299 TC7 · PK-B (plan docs/plans/PK-B-circuito-admin-chofer-2026-10-21.md §3.3):
// «Validar que la lista de viajes del chofer muestre un viaje reasignado tras cancelar en camino con
// comision cero». Criterio «Para QA» de MG-1004.
//
// Flujo del test principal: alta programada por UI («Enviar Manual», nunca «A») -> asignacion al chofer
// (API del carrier) -> el chofer confirma (STATE 2, crea FINALPRICE_ID) -> el chofer cancela «No puedo
// cubrir» (STATE 0, VEHICLE_ID NULL) -> el operador reasigna al mismo chofer (STATE 1) -> el chofer abre su
// lista de programados (`GET paginated-driver`).
//
// Estado conocido: hoy `paginated-driver` responde 500 en ese estado (preexistente, MG-1581, causa:
// `Travel.getDriverCommission()` llama `getVehicle().getVehicleOwner()` sin guarda con VEHICLE_ID NULL). El
// spec asevera el comportamiento CORRECTO (200 + el viaje en la lista + comision 0): el 500 NUNCA se escribe
// como esperado y NO se usa `test.fail()` (acreditaria PASSED con el defecto vivo).
//
// GATE `PKB_TM1427_ENABLED=1`: sin el, el spec se salta (no entra en corridas normales ni en la regresion).
// Se abre solo para la corrida red-first (previa al fix) y se quita cuando MG-1581 este desplegado en TEST
// (PK-B T11). Esa corrida NO se importa a Xray.
//
// Control (sin key de Xray): mismo alta + asignacion SIN confirmar ni cancelar por el chofer; la lista debe
// responder 200 hoy y despues del fix. Demuestra que el rojo del principal se debe a «confirmar + cancelar».
//
// Efectos en TEST: 1 viaje programado por test (+1 el control), que se CANCELAN por el carrier en `finally`
// (terminan CANCELLED, reversible); si la cancelacion falla queda anotado en el ledger `pkb-open` y lo barre
// la corrida siguiente. Chofer = `AUTO_CLOSE_DRIVER_ID` (DRIVER.ID; el de las credenciales DRIVER_EMAIL:
// TEST 3727, 0 % de comision). Sin retries: un reintento crearia otro viaje.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { assignTravelToDriver } from '../../api/clients/driverTravels.client.js';
import type { DriverTravelList } from '../../api/clients/driverTravels.client.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { ledgerRemove, recoverLeakedTrips } from '../../helpers/trip-ledger.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import {
  PKB_OPEN_LEDGER_SCOPE,
  createTripViaUi,
  readCommissionTravelDb,
  readOpenTripsOfDriver,
  scheduleSlot
} from '../../steps/trips/commissionBase.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TM_DRIVER_LIST = 'TM-1427';

// Tarifador 6204 «QA F2 Venta» (cliente Alpine, autorizador Krief, Cash): mismo cliente que TM-1402/TM-1406.
const CLIENT = process.env.ADMIN_CIRCUIT_SALE_ONLY_CLIENT?.trim() || 'Alpine';
const AUTHORIZER = process.env.ADMIN_CIRCUIT_SALE_ONLY_AUTHORIZER?.trim() || 'Krief';
const PAYMENT_METHOD = 'Cash';
/** El viaje se programa 45 minutos adelante: un viaje «Ahora» da 200 con lista vacia y no sirve (intento 71399). */
const SCHEDULE_MINUTES_AHEAD = 45;
const TERMINAL = /^(DONE|CANCELL?ED|LOST)$/i;

const stateOf = (detail: TravelDetail): string => String(detail.state ?? '');

function requirePositiveEnv(name: string): number {
  const value = Number(process.env[name]?.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[driver-list-reassigned] ${name} no esta definido o no es un entero positivo`);
  }
  return value;
}

/** Fila del viaje en la lista: el id puede venir como `travelId` o `id` (no se asume cual). */
function findItem(list: DriverTravelList, travelId: number): Record<string, unknown> | undefined {
  return (list.items ?? []).find((i) => Number(i.travelId ?? i.id) === travelId);
}

test.describe('TM-1427 lista del chofer con viaje reasignado tras cancelar (red-first, gateado)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- gate intencional: falla hasta el fix de MG-1581 y no debe correr en regresion
  test.skip(
    process.env.PKB_TM1427_ENABLED !== '1',
    'TM-1427 falla hasta el fix de MG-1581 (500 en paginated-driver): requiere PKB_TM1427_ENABLED=1'
  );
  test.describe.configure({ timeout: 240_000, mode: 'default' });

  // Viaje creado por el test en curso; se cancela por el carrier en afterEach (siempre).
  let pendingTripId: number | null = null;

  test.afterEach(async ({ travelsApi }) => {
    const id = pendingTripId;
    pendingTripId = null;
    if (id === null) return;
    try {
      const state = stateOf(await travelsApi.getDetail(id));
      if (!TERMINAL.test(state)) await travelsApi.cancel(id);
      ledgerRemove(getCurrentEnv(), id, PKB_OPEN_LEDGER_SCOPE);
      console.info(
        `[driver-list-reassigned] limpieza: viaje ${id} (${state}) cancelado por el carrier`
      );
    } catch (e) {
      console.info(
        `[driver-list-reassigned] limpieza: no se pudo cancelar el viaje ${id} (queda en el ledger ${PKB_OPEN_LEDGER_SCOPE}): ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`
      );
    }
  });

  test(`${TM_DRIVER_LIST}: validar-lista-chofer viaje reasignado tras cancelar en camino con comision cero`, async ({
    page,
    carrierApi,
    carrierSession,
    travelsApi,
    checkingAccountApi,
    driverTravelsApi,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'TM-1427');
    makeAnnotate(TM_DRIVER_LIST, ROUTE)('PKB-1427', 'NEG');
    const driverId = requirePositiveEnv('AUTO_CLOSE_DRIVER_ID');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const attachJson = async (name: string, data: unknown): Promise<void> => {
      await testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });
    };

    await recoverLeakedTrips(travelsApi, getCurrentEnv(), PKB_OPEN_LEDGER_SCOPE);
    const openTrips = await readOpenTripsOfDriver(oracle, driverId);
    expect(
      openTrips,
      `precondicion: el chofer ${driverId} no debe tener viajes abiertos (ids: ${openTrips.join(', ') || '-'})`
    ).toEqual([]);

    const scheduleAt = scheduleSlot(new Date(), SCHEDULE_MINUTES_AHEAD);

    const created = await test.step('1. alta programada por UI (Enviar Manual)', () =>
      createTripViaUi({
        page,
        runId: flow.runId,
        client: CLIENT,
        authorizer: AUTHORIZER,
        paymentMethod: PAYMENT_METHOD,
        note: `QA PK-B TM-1427 ${flow.runId}`,
        scheduleAt,
        ledger: 'open',
        assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
          expect(
            resolvedOrigin !== resolvedDestination,
            `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
          ).toBe(true);
          expect(
            simulatedAmount,
            `precondicion: la cotizacion debe ser > 0 (cliente «${CLIENT}»)`
          ).toBeGreaterThan(0);
        }
      }));

    const { travelId } = created;
    pendingTripId = travelId;

    // Asignacion -> el chofer confirma -> el chofer cancela «No puedo cubrir» -> reasignacion.
    await assignTravelToDriver({ carrierApi, carrierSession, travelId, driverUserId: driverId });
    await driverTravelsApi.confirm(travelId, driverId);
    const afterConfirm = await readCommissionTravelDb(oracle, travelId);
    await driverTravelsApi.cancelByDriver(travelId);
    const afterDriverCancel = await readCommissionTravelDb(oracle, travelId);
    await assignTravelToDriver({ carrierApi, carrierSession, travelId, driverUserId: driverId });
    const afterReassign = await readCommissionTravelDb(oracle, travelId);

    // Lista del chofer (la que abre la app) y estado final en DB: se miden ANTES de asertar.
    const list = await driverTravelsApi.listProgrammed({ driverId });
    const item = findItem(list, travelId);
    await attachJson(`medicion-${travelId}`, {
      travelId,
      scheduledLabel: created.scheduledLabel,
      driverId,
      db: {
        afterConfirm: {
          state: afterConfirm.STATE,
          vehicleId: afterConfirm.VEHICLE_ID,
          finalPriceId: afterConfirm.FINALPRICE_ID
        },
        afterDriverCancel: {
          state: afterDriverCancel.STATE,
          vehicleId: afterDriverCancel.VEHICLE_ID
        },
        afterReassign: {
          state: afterReassign.STATE,
          driverId: afterReassign.DRIVER_ID,
          vehicleId: afterReassign.VEHICLE_ID,
          finalPriceId: afterReassign.FINALPRICE_ID,
          driverCommissionPct: afterReassign.DRIVER_COMMISSION_PCT
        }
      },
      list: {
        status: list.status,
        itemCount: list.items?.length ?? null,
        found: item !== undefined
      },
      bodyExcerpt: list.status === 200 ? null : list.bodyExcerpt,
      measuredAt: new Date().toISOString()
    });
    testInfo.annotations.push({
      type: 'xray_comment',
      description:
        `Viaje ${travelId} programado (${created.scheduledLabel}), chofer ${driverId}: confirmar -> cancelar «No puedo cubrir» ` +
        `(STATE ${afterDriverCancel.STATE}, VEHICLE_ID ${afterDriverCancel.VEHICLE_ID}) -> reasignar (STATE ${afterReassign.STATE}, ` +
        `FINALPRICE_ID ${afterReassign.FINALPRICE_ID}, DRIVER_COMMISSION_PCT ${afterReassign.DRIVER_COMMISSION_PCT}, VEHICLE_ID ${afterReassign.VEHICLE_ID}). ` +
        `GET paginated-driver -> ${list.status}${list.status === 200 ? `, ${list.items?.length ?? 0} item(s), viaje ${item ? 'presente' : 'ausente'}` : ''}.`
    });
    await attachXrayEvidence(testInfo, page, {
      name: `driver-list-reassigned-${travelId}`,
      comment: `TM-1427 viaje ${travelId}: GET paginated-driver ${list.status}; estado final del viaje STATE ${afterReassign.STATE}.`
    });

    // Aserciones (el comportamiento correcto; el 500 nunca es lo esperado).
    expect(
      list.status,
      `GET paginated-driver del chofer ${driverId} debe responder 200 (respondio ${list.status}: ${list.bodyExcerpt.slice(0, 200)})`
    ).toBe(200);
    expect(item, `la lista del chofer debe incluir el viaje reasignado ${travelId}`).toBeDefined();
    expect(
      item,
      'la fila del viaje debe exponer driverCommission (TODO verificar el nombre del campo tras el fix)'
    ).toHaveProperty('driverCommission');
    expect(Number(item?.driverCommission), 'la comision del chofer en la lista debe ser 0').toBe(0);
    expect(
      {
        state: afterReassign.STATE,
        driverId: afterReassign.DRIVER_ID,
        hasFinalPrice: afterReassign.FINALPRICE_ID !== null,
        driverCommissionPct: afterReassign.DRIVER_COMMISSION_PCT
      },
      'viaje reasignado: STATE 1, mismo chofer, FINALPRICE_ID con valor y DRIVER_COMMISSION_PCT NULL'
    ).toEqual({ state: 1, driverId, hasFinalPrice: true, driverCommissionPct: null });
  });

  test('control TM-1427 (sin key): el mismo alta y asignacion sin confirmar ni cancelar da 200 en la lista', async ({
    page,
    carrierApi,
    carrierSession,
    travelsApi,
    checkingAccountApi,
    driverTravelsApi,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'TM-1427 control');
    const driverId = requirePositiveEnv('AUTO_CLOSE_DRIVER_ID');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

    await recoverLeakedTrips(travelsApi, getCurrentEnv(), PKB_OPEN_LEDGER_SCOPE);
    const openTrips = await readOpenTripsOfDriver(oracle, driverId);
    expect(
      openTrips,
      `precondicion: el chofer ${driverId} no debe tener viajes abiertos (ids: ${openTrips.join(', ') || '-'})`
    ).toEqual([]);

    const created = await createTripViaUi({
      page,
      runId: flow.runId,
      client: CLIENT,
      authorizer: AUTHORIZER,
      paymentMethod: PAYMENT_METHOD,
      note: `QA PK-B TM-1427 control ${flow.runId}`,
      scheduleAt: scheduleSlot(new Date(), SCHEDULE_MINUTES_AHEAD),
      ledger: 'open',
      assertBeforeSubmit: ({ simulatedAmount }) => {
        expect(simulatedAmount, 'precondicion: la cotizacion debe ser > 0').toBeGreaterThan(0);
      }
    });
    const { travelId } = created;
    pendingTripId = travelId;

    await assignTravelToDriver({ carrierApi, carrierSession, travelId, driverUserId: driverId });
    const list = await driverTravelsApi.listProgrammed({ driverId });
    const item = findItem(list, travelId);
    await testInfo.attach(`medicion-control-${travelId}`, {
      body: JSON.stringify(
        {
          travelId,
          driverId,
          list: {
            status: list.status,
            itemCount: list.items?.length ?? null,
            found: item !== undefined
          },
          measuredAt: new Date().toISOString()
        },
        null,
        2
      ),
      contentType: 'application/json'
    });

    expect(
      list.status,
      `control: GET paginated-driver debe responder 200 (respondio ${list.status})`
    ).toBe(200);
  });
});
