// tests/specs/trips/admin-circuit-checking-account.spec.ts
// Circuito admin con cuenta corriente (plan PLAN-E2E-ALTA-CIRCUITO-ADMIN-2026-10-13, §3.2 F-B):
// alta por UI (pago «Credit Account») -> cancel -> finalizeAdmin por API -> UN solo debito en la CC
// igual al precio simulado; un segundo finalizeAdmin no genera otro movimiento.
//
// Datos (explorados solo-lectura en TEST el 2026-10-13, carrier 1521):
// - Cliente del typeahead «Stripe, Cliente»: ofrece Cash / Credit Account / Credit Card (x2).
// - CC 5245 (tipo APP, INDIVIDUAL, USD, limite 999999999999) segun checking-accounts/clients/paginated.
// Ambos se pueden cambiar con ADMIN_CIRCUIT_CC_CLIENT / ADMIN_CIRCUIT_CC_ID (otro ambiente o pax).
//
// Gates (crea un viaje PERMANENTE que termina DONE y un debito en la CC; queda en el ledger
// `admin-circuit`, excluido de R-01): ADMIN_CIRCUIT_CREATE_TRIP=1 y ADMIN_CIRCUIT_CC=1. Requiere
// ADMIN_FINALIZE_DRIVER_ID (DRIVER.ID). Sin retries: reintentar crearia otro viaje y otro debito.
//
// Esperado vigente (MG-1581, riesgo abierto): el debito es el precio simulado, sin validacion de
// limite de la CC. Si MG-1581 se corrige, este oraculo debe revisarse.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { AdminCircuitFlow, DB_ORACLE_PENDING_NOTE } from '../../steps/trips/adminCircuit.steps.js';
import { noChargeCheck } from '../../helpers/no-charge.js';
import { travelDetailView } from '../../steps/trips/newTripWithOtherCosts.steps.js';
import { round2 } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TM_KEY = 'TM-1111';

const CLIENT_QUERY = process.env.ADMIN_CIRCUIT_CC_CLIENT ?? 'Stripe, Cliente';
const PAYMENT_METHOD = 'Credit Account';
const CHECKING_ACCOUNT_ID = Number(process.env.ADMIN_CIRCUIT_CC_ID ?? 5245);

// Etiqueta del listado para un viaje cerrado administrativamente (confirmada en TEST 2026-10-13).
const FINALIZED_LABEL = /^Adm\. Closed$/i;
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;
const STATE_DONE = /^DONE$/i;
// Concepto de la fila de un viaje en la CC (CheckingAccountClient: `...concept_codes.TIVR`).
const TRIP_CONCEPT = /TIVR$/;

// Convencion de signo del saldo de la API `.../checking-account/{ccId}/paginated`: un debito lo SUBE.
// Evidencia run 2026-10-13 (viaje 71121): 1 MOVEMENT AUTOMATIC MOUNT 47.22; la API movio el saldo
// +47.22 mientras CHECKINGACCOUNT.BALANCE en DB baja con los debitos (signo opuesto).
const API_BALANCE_DELTA_PER_DEBIT = 1;

const stateOf = (detail: { state?: string }): string => String(detail.state ?? '');

test.describe('Circuito admin del viaje con cuenta corriente (cancel / finalizeAdmin)', () => {
  test.skip(
    process.env.ADMIN_CIRCUIT_CREATE_TRIP !== '1' || process.env.ADMIN_CIRCUIT_CC !== '1',
    'Crea un viaje permanente y un debito en la CC: requiere ADMIN_CIRCUIT_CREATE_TRIP=1 y ADMIN_CIRCUIT_CC=1'
  );
  test.describe.configure({ timeout: 180_000 });

  test(`${TM_KEY}: validar-circuito-admin finalizeAdmin de un viaje cancelado con cuenta corriente genera un unico debito igual al simulado`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_KEY, ROUTE)('F-B', 'HP');
    expect(
      Number.isInteger(CHECKING_ACCOUNT_ID) && CHECKING_ACCOUNT_ID > 0,
      'ADMIN_CIRCUIT_CC_ID debe ser un checkingAccountId entero positivo'
    ).toBe(true);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

    // Saldo API previo (no es el BALANCE de DB): se comparan deltas, nunca absolutos.
    const balanceBefore = await checkingAccountApi.balance({
      checkingAccountId: CHECKING_ACCOUNT_ID
    });
    expect(balanceBefore, 'la CC debe tener movimientos previos para leer su saldo').not.toBeNull();

    const { travelId, simulatedAmount } = await flow.createViaUi({
      page,
      client: CLIENT_QUERY,
      paymentMethod: PAYMENT_METHOD,
      assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
        expect(
          resolvedOrigin !== resolvedDestination,
          `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
        ).toBe(true);
        expect(
          simulatedAmount,
          `precondicion: la cotizacion del cliente «${CLIENT_QUERY}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
        ).toBeGreaterThan(0);
      }
    });
    const created = await flow.readDetail({ travelId });

    await flow.cancel({ travelId });
    const cancelled = await flow.readDetail({ travelId });
    expect(stateOf(cancelled), 'tras cancelar el estado debe ser CANCELLED').toMatch(
      STATE_CANCELLED
    );
    {
      const noCharge = noChargeCheck(cancelled);
      expect(
        noCharge.hasAmountField,
        'el detalle debe exponer el campo amount (un campo ausente no prueba «sin cargo»)'
      ).toBe(true);
      expect(
        noCharge.isNoCharge,
        `la cancelacion sin cargo debe dejar amount null o 0 explicito (recibido: ${String(noCharge.amount)})`
      ).toBe(true);
    }
    const afterCancel = await flow.readMovement({
      travelId,
      checkingAccountId: CHECKING_ACCOUNT_ID
    });
    expect(
      afterCancel.rows.filter((r) => Number(r.debit ?? 0) !== 0),
      'la cancelacion sin cargo no debe debitar la CC'
    ).toHaveLength(0);

    await flow.finalizeAdmin({ travelId });
    const done = await flow.readDetail({ travelId });
    expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);
    expect(round2(Number(done.amount)), 'el importe debe igualar el simulado').toBe(
      round2(simulatedAmount)
    );

    const afterFinalize = await flow.readMovement({
      travelId,
      checkingAccountId: CHECKING_ACCOUNT_ID
    });
    expect(
      afterFinalize.rows,
      'debe existir exactamente un movimiento del viaje en la CC'
    ).toHaveLength(1);
    const movement = afterFinalize.rows[0];
    expect(movement.concept, 'el movimiento debe ser el cobro del viaje (TIVR)').toMatch(
      TRIP_CONCEPT
    );
    // MG-1581 (riesgo abierto): comportamiento vigente = debito == precio simulado, sin limite.
    expect(round2(Number(movement.debit)), 'el debito debe igualar el precio simulado').toBe(
      round2(simulatedAmount)
    );
    expect(Number(movement.credit ?? 0), 'el movimiento no debe acreditar nada').toBe(0);
    expect(afterFinalize.balance, 'la CC debe informar saldo tras el debito').not.toBeNull();
    expect(
      round2(Number(afterFinalize.balance) - Number(balanceBefore)),
      'el saldo API debe moverse exactamente +debito (convencion de signo de la API)'
    ).toBe(round2(API_BALANCE_DELTA_PER_DEBIT * simulatedAmount));

    // Segundo finalizeAdmin: sin 5xx y sin un segundo movimiento ni cambio de saldo.
    const retryStatus = await flow.finalizeAdminRetry({ travelId });
    const afterRetry = await flow.readMovement({
      travelId,
      checkingAccountId: CHECKING_ACCOUNT_ID
    });
    expect(afterRetry.rows, 'el reintento no debe crear otro movimiento').toHaveLength(1);
    expect(round2(Number(afterRetry.rows[0].debit)), 'el debito no debe cambiar').toBe(
      round2(simulatedAmount)
    );
    expect(afterRetry.balance, 'el reintento no debe cambiar el saldo').toBe(afterFinalize.balance);
    const doneAfterRetry = await flow.readDetail({ travelId });
    expect(stateOf(doneAfterRetry)).toMatch(STATE_DONE);

    const grid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
    expect(grid.statusText).toMatch(FINALIZED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: PAYMENT_METHOD,
        simulatedAmount,
        states: [stateOf(created), stateOf(cancelled), stateOf(done)],
        finalizeAdminStatus: retryStatus,
        rawCancelledAmount: cancelled.amount ?? null,
        dbOracle: DB_ORACLE_PENDING_NOTE,
        detailAfter: { ...travelDetailView(doneAfterRetry), gridStatusText: grid.statusText },
        movement: {
          id: null,
          type: movement.concept ?? null,
          mount: Number(movement.debit),
          balanceBefore: Number(balanceBefore),
          balanceAfter: Number(afterFinalize.balance)
        },
        ...flow.measuredDriver(doneAfterRetry),
        comment:
          `F-B viaje ${travelId} (${grid.tripCode}) CC ${CHECKING_ACCOUNT_ID}: alta «${PAYMENT_METHOD}» simulado ${simulatedAmount}; ` +
          `cancel -> ${stateOf(cancelled)} importe ${cancelled.amount}, sin debito; finalizeAdmin -> ${stateOf(done)} importe ${done.amount}; ` +
          `1 movimiento (${movement.concept}) debito ${movement.debit}, saldo API ${balanceBefore} -> ${afterFinalize.balance}; ` +
          `2do finalizeAdmin: ${retryStatus}, sigue 1 movimiento, saldo sin cambio; grilla Finalized «${grid.statusText}». ` +
          'Esperado vigente (MG-1581 riesgo abierto): MOUNT = precio simulado, sin validación de límite. ' +
          DB_ORACLE_PENDING_NOTE
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-fb-${travelId}`,
      locator: grid.row,
      comment: `F-B viaje ${travelId}: un debito ${movement.debit} == simulado ${simulatedAmount} en CC ${CHECKING_ACCOUNT_ID}.`
    });
  });
});
