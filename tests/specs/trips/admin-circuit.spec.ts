// tests/specs/trips/admin-circuit.spec.ts
// Circuito admin del viaje (plan PLAN-E2E-ALTA-CIRCUITO-ADMIN-2026-10-13, §3.2 F-A / F-C / F-D):
// alta por UI (pax CASH) -> cancel / finalizeAdmin por API -> detalle por API -> fila del listado.
//
// - F-A: cancel sin cargo -> finalizeAdmin (viaje cancelado pasa a DONE) -> reintento idempotente.
// - F-C: alta con otro costo («MEET AND GREET», 10, venta) -> cancel sin cargo -> finalizeAdmin.
//   Cubre la fila TC3 «finalizacion administrativa con otro costo por venta» via cancel. La fila
//   «viaje asignado» queda fuera de alcance: el backend solo permite DONE desde GOING_TO_CLIENT,
//   GOING_TO_DESTINATION, CLOSING_TRAVEL, CANCELLED, NO_AUTH y NO_PAY (desde SEARCHING_DRIVER
//   responde 400 ACTION_NOT_ALLOWED, viaje 71119) y llegar a GOING_TO_CLIENT exige la app del chofer.
// - F-D: cancel sin cargo, sin finalizar (oraculo de cancelacion).
//
// Gate ADMIN_CIRCUIT_CREATE_TRIP=1: cada test crea un viaje PERMANENTE (termina DONE o CANCELLED y
// queda registrado en el ledger `admin-circuit`, excluido de la regresion manual R-01). Sin el gate
// el spec se salta. Requiere ADMIN_FINALIZE_DRIVER_ID (DRIVER.ID). Sin retries: un reintento
// crearia otro viaje permanente y ocultaria la falla del primero.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  COST_SALE_SCOPE_NOTE,
  evaluateCostEqualsSale,
  tariffEvidence,
  type CostSalePair,
  type CostSaleVerdict
} from '../../helpers/cost-sale.js';
import { AdminCircuitFlow, DB_ORACLE_PENDING_NOTE } from '../../steps/trips/adminCircuit.steps.js';
import { noChargeCheck } from '../../helpers/no-charge.js';
import { travelDetailView } from '../../steps/trips/newTripWithOtherCosts.steps.js';
import { round2 } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

// Keys Xray como constantes sueltas (el reporter acredita UNA key por titulo). TM-1402 = TM-1298 TC3
// (finalizeAdmin de un viaje cancelado y de uno asignado con otro costo: dos filas, misma key),
// TM-1403 = TC4 (el reintento no duplica), TM-1404 = TC5 (cancelacion de carrier sin cargo).
const TM_FINALIZE = 'TM-1402';
const TM_RETRY = 'TM-1403';
const TM_CANCEL = 'TM-1404';

// Cliente que cotiza > 0 con la ruta por defecto (47.22 en TEST). El query 'test' cotizo 0 y dejo
// pasar TM-1403 en vacio (run 2026-10-13); createViaUi exige simulado > 0.
const CLIENT_QUERY = process.env.ADMIN_CIRCUIT_CASH_CLIENT ?? 'Stripe, Cliente';
const PAYMENT_METHOD = 'Cash';
const OTHER_COST_NAME = process.env.ADMIN_CIRCUIT_OTHER_COST_NAME ?? 'MEET AND GREET';
// Concepto FIJO (precio precargado, no editable): no se teclea importe; se asevera 10 en el detalle.
// Sondeado en TEST 2026-10-13 con «Stripe, Cliente»: el combo lo ofrece, precio 10 precargado y no editable.
// Si otro tarifador/cliente no lo ofreciera, el alta falla con el mensaje del combo.
const OTHER_COST_PRICE = 10;

// Etiqueta del listado para un viaje cerrado administrativamente (confirmada en TEST 2026-10-13).
const FINALIZED_LABEL = /^Adm\. Closed$/i;
// Observada en TEST (2026-10-13) en la pestaña Cancelled.
const CANCELLED_LABEL = /^Canceled$/i;

// El detalle puede traer el estado como nombre o como codigo numerico: se acepta ambos.
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;
const STATE_DONE = /^DONE$/i;

// Sale-only tariff 6204 «QA F2 Venta»: customer Alpine F1 Team (contractor 1522, main user Krief).
const SALE_ONLY_CLIENT_QUERY = process.env.ADMIN_CIRCUIT_SALE_ONLY_CLIENT ?? 'Alpine';
const SALE_ONLY_AUTHORIZER = process.env.ADMIN_CIRCUIT_SALE_ONLY_AUTHORIZER ?? 'Krief';
const SALE_ONLY_PAYMENT_METHOD = process.env.ADMIN_CIRCUIT_SALE_ONLY_PAYMENT ?? PAYMENT_METHOD;

/**
 * Runs the pair oracle without asserting, so the caller attaches the measurement (evidence of the
 * failing run) before asserting `ok`. Nothing is softened.
 */
function checkPairs(
  detail: Parameters<typeof evaluateCostEqualsSale>[0]['detail'],
  label: string,
  expectOtherCost: boolean
): CostSaleVerdict {
  return evaluateCostEqualsSale({ detail, label, expectOtherCost });
}

const pairsText = (pairs: CostSalePair[] | null): string =>
  pairs ? pairs.map((p) => `${p.pair} ${p.sale}/${p.cost}`).join(', ') : 'oracle failed';

const stateOf = (detail: { state?: string }): string => String(detail.state ?? '');

test.describe('Circuito admin del viaje (cancel / finalizeAdmin)', () => {
  test.skip(
    process.env.ADMIN_CIRCUIT_CREATE_TRIP !== '1',
    'Crea viajes permanentes (DONE/CANCELLED): requiere ADMIN_CIRCUIT_CREATE_TRIP=1'
  );
  test.describe.configure({ timeout: 180_000 });

  test(`${TM_FINALIZE}: validar-circuito-admin finalizeAdmin de un viaje cancelado (CASH)`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_FINALIZE, ROUTE)('F-A', 'HP');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

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
    const cancelledGrid = await flow.readGridStatus({ page, travelId, tab: 'cancelled' });
    expect(cancelledGrid.statusText).toMatch(CANCELLED_LABEL);

    await flow.finalizeAdmin({ travelId });
    const done = await flow.readDetail({ travelId });
    expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);
    expect(round2(Number(done.amount)), 'el importe debe igualar el simulado').toBe(
      round2(simulatedAmount)
    );

    const pairCheck = checkPairs(done, `TM-1402 F-A tariff 2261 trip ${travelId}`, false);
    testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });

    const finalizedGrid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
    expect(finalizedGrid.statusText).toMatch(FINALIZED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: PAYMENT_METHOD,
        simulatedAmount,
        states: [stateOf(created), stateOf(cancelled), stateOf(done)],
        finalizeAdminStatus: 'ok',
        rawCancelledAmount: cancelled.amount ?? null,
        dbOracle: DB_ORACLE_PENDING_NOTE,
        costSalePairs: pairCheck.pairs,
        tariff: tariffEvidence(done, 2261),
        detailAfter: {
          ...travelDetailView(done),
          gridCancelledText: cancelledGrid.statusText,
          gridStatusText: finalizedGrid.statusText
        },
        ...flow.measuredDriver(done)
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-fa-${travelId}`,
      locator: finalizedGrid.row,
      comment:
        `F-A viaje ${travelId} (${finalizedGrid.tripCode}): alta CASH simulado ${simulatedAmount}; ` +
        `cancel -> ${stateOf(cancelled)} importe ${cancelled.amount}, grilla Cancelled «${cancelledGrid.statusText}»; ` +
        `finalizeAdmin -> ${stateOf(done)} importe ${done.amount}, grilla Finalized «${finalizedGrid.statusText}». Pares venta/costo: ${pairsText(pairCheck.pairs)}. ${DB_ORACLE_PENDING_NOTE}`
    });
    expect(pairCheck.ok, pairCheck.message).toBe(true);
  });

  test(`${TM_RETRY}: validar-circuito-admin el segundo finalizeAdmin no duplica ni cambia el viaje (CASH)`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_RETRY, ROUTE)('F-A-retry', 'NEG');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

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
    await flow.cancel({ travelId });
    const cancelled = await flow.readDetail({ travelId });
    expect(stateOf(cancelled), 'tras cancelar el estado debe ser CANCELLED').toMatch(
      STATE_CANCELLED
    );
    await flow.finalizeAdmin({ travelId });
    const done = await flow.readDetail({ travelId });
    expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);

    // Reintento: 2xx o 400 ACTION_NOT_ALLOWED (cualquier otro status falla) y sin cambios en el detalle.
    const retryStatus = await flow.finalizeAdminRetry({ travelId });
    const afterRetry = await flow.readDetail({ travelId });
    expect(travelDetailView(afterRetry), 'el reintento no debe cambiar el detalle').toEqual(
      travelDetailView(done)
    );
    expect(stateOf(afterRetry)).toMatch(STATE_DONE);
    expect(round2(Number(afterRetry.amount)), 'el importe no debe cambiar').toBe(
      round2(Number(done.amount))
    );

    const grid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
    expect(grid.statusText).toMatch(FINALIZED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: PAYMENT_METHOD,
        simulatedAmount,
        states: [null, stateOf(cancelled), stateOf(afterRetry)],
        finalizeAdminStatus: retryStatus,
        detailAfter: { ...travelDetailView(afterRetry), gridStatusText: grid.statusText },
        ...flow.measuredDriver(afterRetry)
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-retry-${travelId}`,
      locator: grid.row,
      comment:
        `Reintento viaje ${travelId} (${grid.tripCode}): cancel -> finalizeAdmin -> ${stateOf(done)} importe ${done.amount}; ` +
        `segundo finalizeAdmin: ${retryStatus}; detalle (estado, importe, otherCostList) sin cambios; grilla «${grid.statusText}».`
    });
  });

  test(`${TM_FINALIZE}: validar-circuito-admin finalizeAdmin de un viaje cancelado con otro costo por venta (CASH)`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_FINALIZE, ROUTE)('F-C', 'HP');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

    const { travelId, simulatedAmount } = await flow.createViaUi({
      page,
      client: CLIENT_QUERY,
      paymentMethod: PAYMENT_METHOD,
      otherCostName: OTHER_COST_NAME,
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

    await flow.finalizeAdmin({ travelId });
    const done = await flow.readDetail({ travelId });
    expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);
    const line = (done.otherCostList ?? []).find((l) => l.name === OTHER_COST_NAME);
    expect(line, `otherCostList debe contener «${OTHER_COST_NAME}»`).toBeDefined();
    expect(line?.price, 'el otro costo debe conservar su precio').toBe(OTHER_COST_PRICE);
    expect(
      round2(Number(done.amount)),
      'el importe debe igualar el simulado (incluye el otro costo)'
    ).toBe(round2(simulatedAmount));

    const pairCheck = checkPairs(done, `TM-1402 F-C tariff 2261 trip ${travelId}`, true);
    testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });

    const grid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
    expect(grid.statusText).toMatch(FINALIZED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: PAYMENT_METHOD,
        simulatedAmount,
        states: [stateOf(created), stateOf(cancelled), stateOf(done)],
        finalizeAdminStatus: 'ok',
        rawCancelledAmount: cancelled.amount ?? null,
        dbOracle: DB_ORACLE_PENDING_NOTE,
        costSalePairs: pairCheck.pairs,
        tariff: tariffEvidence(done, 2261),
        detailAfter: { ...travelDetailView(done), gridStatusText: grid.statusText },
        ...flow.measuredDriver(done)
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-fc-${travelId}`,
      locator: grid.row,
      comment:
        `F-C viaje ${travelId} (${grid.tripCode}): alta CASH con «${OTHER_COST_NAME}» ${OTHER_COST_PRICE}, ` +
        `simulado ${simulatedAmount}; cancel -> ${stateOf(cancelled)} amount ${cancelled.amount}; finalizeAdmin -> ${stateOf(done)} importe ${done.amount}, ` +
        `otherCostList price ${line?.price}, grilla Finalized «${grid.statusText}». Pares venta/costo: ${pairsText(pairCheck.pairs)}. ${DB_ORACLE_PENDING_NOTE}`
    });
    expect(pairCheck.ok, pairCheck.message).toBe(true);
  });

  test(`${TM_FINALIZE}: validar-circuito-admin finalizeAdmin de un viaje cancelado con tarifador de solo venta 6204 (costo = venta)`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_FINALIZE, ROUTE)('F-A-6204', 'HP');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

    const { travelId, simulatedAmount } = await flow.createViaUi({
      page,
      client: SALE_ONLY_CLIENT_QUERY,
      authorizer: SALE_ONLY_AUTHORIZER,
      paymentMethod: SALE_ONLY_PAYMENT_METHOD,
      assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
        expect(
          resolvedOrigin !== resolvedDestination,
          `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
        ).toBe(true);
        expect(
          simulatedAmount,
          `precondicion: la cotizacion del cliente «${SALE_ONLY_CLIENT_QUERY}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
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

    await flow.finalizeAdmin({ travelId });
    const done = await flow.readDetail({ travelId });
    expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);
    const pairCheck = checkPairs(done, `TM-1402 F-A tariff 6204 trip ${travelId}`, false);
    testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });

    const grid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
    expect(grid.statusText).toMatch(FINALIZED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: SALE_ONLY_PAYMENT_METHOD,
        simulatedAmount,
        states: [stateOf(created), stateOf(cancelled), stateOf(done)],
        finalizeAdminStatus: 'ok',
        rawCancelledAmount: cancelled.amount ?? null,
        dbOracle: DB_ORACLE_PENDING_NOTE,
        costSalePairs: pairCheck.pairs,
        tariff: tariffEvidence(done, 6204),
        detailAfter: { ...travelDetailView(done), gridStatusText: grid.statusText },
        ...flow.measuredDriver(done)
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-fa-6204-${travelId}`,
      locator: grid.row,
      comment:
        `F-A 6204 viaje ${travelId} (${grid.tripCode}): alta ${SALE_ONLY_PAYMENT_METHOD} simulado ${simulatedAmount}; cancel -> ${stateOf(cancelled)}; ` +
        `finalizeAdmin -> ${stateOf(done)} importe ${done.amount}, grilla Finalized «${grid.statusText}». Pares venta/costo: ${pairsText(pairCheck.pairs)}. ${DB_ORACLE_PENDING_NOTE}`
    });
    expect(pairCheck.ok, pairCheck.message).toBe(true);
  });

  test(`${TM_CANCEL}: validar-circuito-admin cancelacion sin cargo deja el viaje CANCELLED con importe 0`, async ({
    page,
    travelsApi,
    checkingAccountApi
  }, testInfo) => {
    makeAnnotate(TM_CANCEL, ROUTE)('F-D', 'HP');
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);

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

    const grid = await flow.readGridStatus({ page, travelId, tab: 'cancelled' });
    expect(grid.statusText).toMatch(CANCELLED_LABEL);

    await flow.attachMeasurement({
      testInfo,
      measurement: {
        travelId,
        paymentMethod: PAYMENT_METHOD,
        simulatedAmount,
        states: [stateOf(created), stateOf(cancelled), null],
        finalizeAdminStatus: null,
        rawCancelledAmount: cancelled.amount ?? null,
        dbOracle: DB_ORACLE_PENDING_NOTE,
        detailAfter: { ...travelDetailView(cancelled), gridStatusText: grid.statusText },
        driverId: null,
        driverIdSource: 'none'
      }
    });
    await attachXrayEvidence(testInfo, page, {
      name: `admin-circuit-fd-${travelId}`,
      locator: grid.row,
      comment:
        `F-D viaje ${travelId} (${grid.tripCode}): alta CASH simulado ${simulatedAmount}; cancel sin cargo -> ` +
        `${stateOf(cancelled)} importe ${cancelled.amount}, grilla Cancelled «${grid.statusText}». Sin finalizar. ${DB_ORACLE_PENDING_NOTE}`
    });
  });
});
