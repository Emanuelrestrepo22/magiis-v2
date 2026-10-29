// tests/specs/trips/fr-circuit-s2.spec.ts
// Circuito e2e carrier Francia, escenario S2 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): viaje cargado
// a la cuenta corriente (CC 5614, EUR) del pasajero Luis Orellano CON otro costo «QA City Taxes»
// (id 190, PCT 10 %, venta, comisionable) -> cierre admin (cancel + finalizeAdmin) -> rendicion manual
// -> EDICION POST-RENDICION (+10 EUR sobre la venta) -> impacto en CC y libros.
// Carrier TEST 1901, chofer DRIVER.ID 4965, vehiculo 3765, propietario 2927.
//
// Gates (todos exactamente `1`; sin ellos el spec se salta ANTES de crear nada):
// - FR_CIRCUIT_CREATE_TRIP=1 (alta de viaje PERMANENTE + debito en la CC)
// - FR_CONFIRM_SURRENDER=1   (POST toTravelsSurrender IRREVERSIBLE)
// - FR_EDIT_AFTER_SURRENDER=1 (edita un viaje cerrado y rendido, IRREVERSIBLE)
// Ademas: ENV=test, FR_* completos (FR_OTHER_COST_NAME = «QA City Taxes», FR_CC_ID = 5614,
// FR_CLIENT_QUERY = Luis) y storage state del carrier 1901.
// Opcionales: FR_OWNER_ID (default 2927), FR_CARRIER_ID (default 1901), FR_CC_PAYMENT_METHOD
// (etiqueta del selector de pago de la CC; default «Credit Account», la de TM-1111 en 1521).
//
// Edicion post-rendicion: modelo A (PB-1, regla cerrada): editar un viaje rendido recalcula el cierre
// confirmado. Se asevera estricto: (a) AC-FR-52: PUT updateFinalPrices 2xx + process 200 (un bloqueo es
// FAIL, no un camino alterno); (b) AC-FR-58: exactamente UN movimiento TIVR del viaje (estructural) y su
// debito = precio final como CONSISTENCIA EVENTUAL (pollUntil 90 s; la latencia observada queda como
// evidencia, el job WA_CHECKINGACCOUNT puede reescribirlo de forma asincrona); (c) AC-FR-59/60: lote
// pendiente vacio y sin filas duplicadas en los libros.
// ACs (registro tipado tests/helpers/acceptance.ts): 01 02 03 04 05 06 07 08 12 14 15 20 21 22 23 24 25 26 27 28 29 30 31
// 46 47 48 49 52 53 54 56 58 59 60 63 (64 = observation); toda asercion de negocio vive dentro de
// verifyAc; DB de solo lectura obligatoria (fixture `db`). Base de comision = CON city taxes (regla
// confirmada): la base alternativa SIN city taxes solo se registra como observation, nunca se acepta.
// Sin retries: un reintento crearia otro viaje permanente y mezclaria el lote de rendicion.
// Horario: NO correr entre 10:00 y 10:20 ART, es decir 13:00-13:20 UTC (cron de rendicion automatica con CASHCOLLECTOR=1 contamina el lote).
import { evaluateBatchExactly } from '../../helpers/surrender-oracle.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import { pollUntil } from '../../helpers/poll.js';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type {
  CheckingAccountRow,
  DriverBookRow,
  OwnerBookRow
} from '../../api/clients/checkingAccount.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { verifyAc, knownIssue, observation } from '../../helpers/acceptance.js';
import { deltaMovements, snapshotClientCc } from '../../helpers/cc-delta.js';
import { COST_SALE_SCOPE_NOTE, evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import { evaluateSaleCostPairs, evaluateSurrenderRow } from '../../helpers/db-oracle-eval.js';
import {
  editDiffs,
  evaluateBalanceDelta,
  evaluateBookCodes,
  evaluateClientCcBalance,
  evaluateCommissionPreview,
  evaluateDbCancelled,
  evaluateDbClosedByAdmin,
  evaluateDbNoCharge,
  evaluateDriverAssigned,
  evaluateNoAgencyBookRow,
  evaluateNoDuplicatedRows,
  evaluateNotInBatch,
  evaluatePaymentColumn,
  evaluateSurrenderEditDeltas,
  evaluateSurrenderHeader,
  expectedManualSurrender,
  formatMismatches,
  nullAsZeroWhereExpectedZero,
  readBatchState,
  readBatchStateUntilEmpty,
  readTravelCoreDb,
  splitSaleCostMismatches
} from '../../helpers/fr-ac-eval-circuit.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  PCT,
  readBooks,
  requireNumberField
} from '../../helpers/fr-circuit.js';
import { TripEditPage } from '../../pages/carrier-v2/trips/TripEditPage.js';
import {
  movementsOfTravel,
  readSurrenderHeader,
  surrenderIdsOfTrips
} from '../../steps/trips/autoSurrender.steps.js';
import { readSaleCostData, readSurrenderRow } from '../../steps/trips/dbOracles.steps.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { EditAfterSurrenderFlow } from '../../steps/trips/editAfterSurrender.steps.js';
import { SurrenderFlow } from '../../steps/trips/surrender.steps.js';
import { parseMoney, round2 } from '../../utils/money.js';
import { FR_1901_KEYS } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';
import type { Page } from '@playwright/test';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_KEYS.S2;
const PAYMENT_METHOD = process.env.FR_CC_PAYMENT_METHOD?.trim() || 'Credit Account';
const STATE_DONE = /^DONE$/i;
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;
const TRIP_CONCEPT = /TIVR$/;
// Detalle: partes de venta por campo (nombres y estado en FR_FACTS.detailFields).
const PART_FIELDS = {
  fare: FR_FACTS.detailFields.fare.value,
  wait: FR_FACTS.detailFields.wait.value,
  otherCom: FR_FACTS.detailFields.otherTotal.value,
  otherNoCom: FR_FACTS.detailFields.otherNoCom.value,
  toll: FR_FACTS.detailFields.toll.value,
  parking: FR_FACTS.detailFields.parking.value,
  total: FR_FACTS.detailFields.total.value
} as const;
const CITY_TAX_PCT = 0.1;
const EDIT_DELTA = 10;
const MONEY_TOL = 0.011;
const KNOWN_ISSUE_NOTE =
  'TEST FR THOUSANDS_SEPARATOR SPACE -> surrender PDF 500 (rendicion persistida)';
// Contenedores donde la app muestra alertas/avisos/dialogos (toast, swal, modal, alert bootstrap).
const MESSAGE_SELECTOR =
  '.swal2-popup, [role="alert"], [role="alertdialog"], [role="dialog"], ngb-modal-window, .modal.show, .toast, .toast-message, .alert, .ngx-toastr';

const frGate = frConfigOrNull('FR S2', [
  'FR_CIRCUIT_CREATE_TRIP',
  'FR_CONFIRM_SURRENDER',
  'FR_EDIT_AFTER_SURRENDER'
]);

type BookRows = Array<DriverBookRow | OwnerBookRow>;

const bookKey = (row: DriverBookRow | OwnerBookRow): string => String(row.origin ?? 'null');
const amountsOf = (rows: BookRows): number[] =>
  rows.flatMap((r) => [Math.abs(Number(r.amount ?? 0)), Math.abs(Number(r.paid ?? 0))]).map(round2);
const hasAmount = (rows: BookRows, v: number): boolean =>
  amountsOf(rows).some((a) => Math.abs(a - v) < MONEY_TOL);
const mapRows = (rows: BookRows) =>
  rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    paid: r.paid,
    code: r.checkingAccountCode,
    origin: r.origin
  }));
/** Neto (debito - credito) de las filas de la CC de un viaje, en convencion de la API de la CC. */
const netOf = (rows: readonly CheckingAccountRow[]): number =>
  round2(rows.reduce((sum, r) => sum + Number(r.debit ?? 0) - Number(r.credit ?? 0), 0));

/**
 * Muestrea los textos de alertas/dialogos visibles mientras `until` no termina (y un barrido final).
 * Es instrumentacion de observacion, no una espera de sincronizacion: el POM sigue dueno del flujo.
 */
async function collectUiMessages(page: Page, until: Promise<unknown>): Promise<string[]> {
  const seen = new Set<string>();
  let settled = false;
  void until.then(
    () => (settled = true),
    () => (settled = true)
  );
  const sweep = async (): Promise<void> => {
    try {
      for (const text of await page.locator(MESSAGE_SELECTOR).allInnerTexts()) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) seen.add(clean);
      }
    } catch {
      // la pagina puede estar navegando: se reintenta en el proximo barrido
    }
  };
  while (!settled) {
    await sweep();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await sweep();
  return [...seen];
}

test.describe('Circuito Francia S2 (CC + otro costo · cierre admin · rendicion · edicion)', () => {
  test.skip(frGate.config === null, `FR S2 saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  test('FR-S2: validar-circuito-francia CC con otro costo, cierre admin, rendicion y edicion post-rendicion', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S2');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(TS_KEY, ROUTE)('FR-S2', 'HP');
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    // MAGIIS "driverUserId" de los endpoints de rendicion = DRIVER.ID (no USER_ID).
    const batch = { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId };
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const surrender = new SurrenderFlow(page, surrenderClient);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const editFlow = new EditAfterSurrenderFlow(travelsApi);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });
    const nativeDialogs: string[] = [];
    page.on('dialog', (dialog) => {
      nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss().catch(() => undefined);
    });
    const partsOf = (detail: TravelDetail): Record<string, number> =>
      Object.fromEntries(
        Object.entries(PART_FIELDS).map(([part, field]) => [
          part,
          requireNumberField(detail, field)
        ])
      );

    // ---- 1. Precondiciones: sesion FR, oraculo DB, lote vacio y foto de los tres libros ----
    if (carrierSession.carrierId !== expectedCarrier) {
      throw new Error(
        `la sesion guardada debe ser del carrier ${expectedCarrier} (recibido ${String(carrierSession.carrierId)}); regenerar storage state con USER_CARRIER_FR`
      );
    }
    const isolation = await readIsolation({
      surrender: surrenderClient,
      batch,
      db: oracle,
      ownerId
    });
    const emptyBatch = await verifyAc(testInfo, 'AC-FR-20', async () => {
      // Precondicion de ejecucion: la ventana del cron diario solo bloquea con CASHCOLLECTOR=1 (lanza).
      assertOutsideCronWindow({ cashCollectorFlag: isolation.cashCollectorFlag });
      expect(
        isolation.batchRows.length === 0 && isolation.summaryRows === 0,
        `lote de rendicion NO vacio antes de empezar (chofer ${batch.driverUserId} / vehiculo ${batch.vehicleId}): ` +
          `viajes ${isolation.batchRows.join(', ') || '-'}, filas de resumen ${isolation.summaryRows}. Rendirlos o excluirlos antes de correr.`
      ).toBe(true);
      return {
        pendingRows: isolation.batchRows,
        pendingSummaryRows: isolation.summaryRows,
        foreignPendingTrips: isolation.foreignTrips,
        ownerCashCollector: isolation.cashCollectorFlag,
        cronWindow: isolation.cronWindow
      };
    });
    const booksBefore = await readBooks(checkingAccountApi, cfg, ownerId);
    await attachJson('1-preconditions', {
      carrierId: carrierSession.carrierId,
      ccId: cfg.ccId,
      pendingBatchRows: emptyBatch?.pendingRows ?? null,
      pendingSummaryRows: emptyBatch?.pendingSummaryRows ?? null,
      driverBook: { rows: booksBefore.driverRows, balance: booksBefore.driver.balance },
      ownerBook: { ownerId, rows: booksBefore.ownerRows, balance: booksBefore.owner.balance },
      clientCc: {
        rows: booksBefore.client.rows.length,
        balanceDbConvention: booksBefore.client.balance
      }
    });

    // ---- 2. Alta por UI: Luis, pago CC, otro costo «QA City Taxes» ----
    // assertBeforeSubmit es guarda de creacion (falla ANTES de crear el viaje permanente); las
    // aserciones de negocio de la cotizacion viven en AC-FR-01/03 tras el alta.
    const { travelId, simulatedAmount, summary } =
      await test.step('2. Create CC trip with other cost via UI (Luis, Cannes -> Nice)', async () =>
        flow.createViaUi({
          page,
          client: cfg.clientQuery,
          paymentMethod: PAYMENT_METHOD,
          otherCostName: cfg.otherCostName,
          region: 'FR',
          assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
            expect(
              resolvedOrigin !== resolvedDestination,
              `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
            ).toBe(true);
            expect(
              simulatedAmount,
              `precondicion: la cotizacion del cliente «${cfg.clientQuery}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
            ).toBeGreaterThan(0);
          }
        }));

    const base = parseMoney(summary.subtotal);
    const cityTaxLine = summary.lines.find((l) => l.label.startsWith(cfg.otherCostName));
    const cityTax = cityTaxLine === undefined ? 0 : parseMoney(cityTaxLine.amount);
    const expectedCityTax = round2(CITY_TAX_PCT * base);
    const otherCostsHeader = parseMoney(summary.otherCosts);
    const fixedFees = summary.fixedFees === null ? 0 : parseMoney(summary.fixedFees);
    const taxes = summary.taxes === null ? 0 : parseMoney(summary.taxes);
    const expectedTotal = round2(base + otherCostsHeader + fixedFees + taxes);
    await attachJson('2-quote-summary', {
      travelId,
      simulatedAmount,
      subtotalBase: base,
      cityTaxLine: { label: cityTaxLine?.label, amount: cityTax },
      expectedCityTax,
      otherCostsHeader,
      fixedFees,
      taxes,
      expectedTotal,
      rawSummary: summary
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s2-quote-${travelId}`,
      comment: `FR S2 viaje ${travelId}: alta CC con «${cfg.otherCostName}», base ${base}, city taxes ${cityTax} (esperado 10 % = ${expectedCityTax}), total ${simulatedAmount}.`
    });
    await verifyAc(testInfo, 'AC-FR-01', async () => {
      expect(
        simulatedAmount,
        'la cotizacion simulada debe ser > 0 (un total 0 haria pasar los oraculos en vacio)'
      ).toBeGreaterThan(0);
      const expectedQuote = process.env.FR_EXPECTED_QUOTE?.trim();
      if (expectedQuote) {
        expect(round2(simulatedAmount), 'cotizacion simulada = FR_EXPECTED_QUOTE').toBe(
          round2(Number(expectedQuote))
        );
      }
      return { simulatedAmount, expectedQuote: expectedQuote ?? null };
    });
    await verifyAc(testInfo, 'AC-FR-03', async () => {
      expect(
        cityTaxLine,
        `el resumen debe listar la linea del otro costo «${cfg.otherCostName}» (lineas: ${JSON.stringify(summary.lines.map((l) => l.label))})`
      ).toBeDefined();
      expect(
        Math.abs(cityTax - expectedCityTax),
        `otro costo «${cfg.otherCostName}» debe ser 10 % de la base ${base} = ${expectedCityTax} (recibido ${cityTax})`
      ).toBeLessThanOrEqual(MONEY_TOL);
      expect(
        Math.abs(otherCostsHeader - cityTax),
        `el encabezado de Otros Costos (${otherCostsHeader}) debe igualar la unica linea agregada (${cityTax})`
      ).toBeLessThanOrEqual(MONEY_TOL);
      expect(
        Math.abs(simulatedAmount - expectedTotal),
        `total simulado ${simulatedAmount} debe ser base ${base} + city taxes ${otherCostsHeader}` +
          ` (+ cargos fijos ${fixedFees} + impuestos ${taxes}) = ${expectedTotal}`
      ).toBeLessThanOrEqual(MONEY_TOL);
      return { base, cityTax, expectedCityTax, otherCostsHeader, fixedFees, taxes, expectedTotal };
    });
    const created = await flow.readDetail({ travelId });
    await verifyAc(testInfo, 'AC-FR-02', async () => {
      // TODO(verificar en TEST): si el detalle no trae simulationPrice.currencyCode, la moneda EUR queda
      // sin asercion por API (revisar la captura de la cotizacion).
      const createdCurrency = (
        created.simulationPrice as Record<string, unknown> | null | undefined
      )?.currencyCode;
      if (createdCurrency !== undefined && createdCurrency !== null) {
        expect(String(createdCurrency), 'moneda de la cotizacion debe ser EUR').toMatch(/EUR|€/i);
      }
      return {
        currencyCode: createdCurrency ?? null,
        verifiedByApi: createdCurrency !== undefined && createdCurrency !== null
      };
    });
    await verifyAc(testInfo, 'AC-FR-05', async () => {
      const state = await readBatchState(surrenderClient, batch, travelId);
      const v = evaluateNotInBatch(state, travelId);
      expect(v.ok, formatMismatches(`viaje ${travelId} abierto fuera del lote`, v.mismatches)).toBe(
        true
      );
      return { previewIds: state.previewIds, summaryRows: state.summary };
    });

    // ---- 3. Debito en la CC al crear (comportamiento preexistente observado en 1521) ----
    const readTravelCc = (): Promise<CheckingAccountRow[]> =>
      checkingAccountApi.movementsByTravel({ travelId, checkingAccountId: cfg.ccId });
    const ccRowsCreate = await readTravelCc();
    const booksCreate = await readBooks(checkingAccountApi, cfg, ownerId);
    const clientDeltaCreate = deltaMovements(booksBefore.client, booksCreate.client);
    await attachJson('3-cc-at-creation', {
      travelRows: ccRowsCreate.map((r) => ({
        concept: r.concept,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
        currencyCode: r.currencyCode
      })),
      clientCcAdded: clientDeltaCreate.added,
      balanceDeltaDbConvention: clientDeltaCreate.balanceDelta
    });
    // Baseline (TEST 1521, 6 CC trips 2026-10-16): the AUTOMATIC CC debit is generated at close,
    // not at creation. At creation the CC must have NO movement for this travel.
    await verifyAc(testInfo, 'AC-FR-46', async () => {
      expect(
        ccRowsCreate,
        `la CC ${cfg.ccId} no debe tener movimientos del viaje ${travelId} al crear (el debito se genera al cerrar)`
      ).toHaveLength(0);
      return { travelRows: ccRowsCreate.length };
    });

    // ---- 4. Cierre administrativo: cancel + finalizeAdmin ----
    await test.step('4a. Admin close: cancel', async () => flow.cancel({ travelId }));

    const cancelled = await flow.readDetail({ travelId });
    const cancelledDb = await readTravelCoreDb(oracle, travelId);
    await verifyAc(testInfo, 'AC-FR-14', async () => {
      expect(String(cancelled.state ?? ''), 'tras cancelar el estado debe ser CANCELLED').toMatch(
        STATE_CANCELLED
      );
      const v = evaluateDbCancelled(cancelledDb);
      expect(v.ok, formatMismatches('TRAVEL tras cancelar', v.mismatches)).toBe(true);
      return { state: cancelled.state ?? null, dbState: cancelledDb.STATE };
    });
    await verifyAc(testInfo, 'AC-FR-15', async () => {
      const amount = cancelled.amount;
      expect(
        'amount' in cancelled && (amount === null || amount === 0),
        `la cancelacion sin cargo debe dejar amount null o 0 explicito (recibido: ${String(amount)})`
      ).toBe(true);
      const v = evaluateDbNoCharge(cancelledDb);
      expect(v.ok, formatMismatches('FINALPRICEI del cancelado', v.mismatches)).toBe(true);
      return { amount: amount ?? null, finalPriceId: cancelledDb.FINALPRICE_ID };
    });

    await test.step('4b. Admin close: finalizeAdmin with DRIVER.ID', async () =>
      travelsApi.finalizeAdmin({ travelId, driverId: cfg.driverId }));

    const done = await flow.readDetail({ travelId });
    const doneDb = await readTravelCoreDb(oracle, travelId);
    const finalPrice = round2(Number(done.amount));
    await verifyAc(testInfo, 'AC-FR-06', async () => {
      expect(String(done.state ?? ''), 'finalizeAdmin debe dejar el viaje DONE').toMatch(
        STATE_DONE
      );
      const v = evaluateDbClosedByAdmin(doneDb);
      expect(v.ok, formatMismatches('TRAVEL tras finalizeAdmin', v.mismatches)).toBe(true);
      return {
        state: done.state ?? null,
        dbState: doneDb.STATE,
        finalizeAdmin: doneDb.FINALIZE_ADMIN
      };
    });
    await verifyAc(testInfo, 'AC-FR-07', async () => {
      expect(finalPrice, 'cierre admin sin cambios: precio final = simulado').toBe(
        round2(simulatedAmount)
      );
      return { finalPrice, simulatedAmount };
    });
    const nestedDriver = done.driver;
    const driverCandidate =
      done.driverId ??
      (typeof nestedDriver === 'object' && nestedDriver !== null
        ? (nestedDriver as { id?: unknown }).id
        : undefined);
    const driverMeasured =
      driverCandidate === undefined || driverCandidate === null ? null : Number(driverCandidate);
    await verifyAc(testInfo, 'AC-FR-04', async () => {
      const v = evaluateDriverAssigned({
        expectedDriverId: cfg.driverId,
        detailDriverId: driverMeasured,
        core: doneDb
      });
      expect(v.ok, formatMismatches('chofer 4965 (DRIVER.ID)', v.mismatches)).toBe(true);
      return { detailDriverId: driverMeasured, dbDriverId: doneDb.DRIVER_ID, notes: v.notes };
    });
    const costSale = evaluateCostEqualsSale({
      detail: done,
      label: `FR S2 trip ${travelId}`,
      expectOtherCost: true
    });
    const saleCostData = await readSaleCostData(oracle, travelId);
    const saleCost = evaluateSaleCostPairs(travelId, saleCostData.row, saleCostData.items);
    const saleCostSplit = splitSaleCostMismatches(saleCost);
    await verifyAc(testInfo, 'AC-FR-08', async () => {
      expect(costSale.ok, costSale.message).toBe(true);
      expect(
        saleCostSplit.pairs.ok,
        formatMismatches(
          `pares costo = venta del viaje ${travelId} (DB)`,
          saleCostSplit.pairs.mismatches
        )
      ).toBe(true);
      return {
        apiPairs: costSale.pairs,
        dbSource: saleCost.source,
        otherCostItems: saleCostData.items.length
      };
    });
    await verifyAc(testInfo, 'AC-FR-12', async () => {
      expect(
        saleCostSplit.total.ok,
        formatMismatches(
          `total costo = suma de partes del viaje ${travelId} (DB)`,
          saleCostSplit.total.mismatches
        )
      ).toBe(true);
      return {
        finalCostPrice: saleCostData.row.FINAL_COST_PRICE,
        finalPrice: saleCostData.row.FINALPRICE,
        notes: [
          ...saleCost.notes,
          'viaje FR sin peaje/estacionamiento: la rama pass-through (venta arrastra) no se ejercita'
        ]
      };
    });
    testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });
    const ccRowsDone = await readTravelCc();
    const booksDone = await readBooks(checkingAccountApi, cfg, ownerId);
    const clientDeltaDone = deltaMovements(booksBefore.client, booksDone.client);
    const ccDbRows = (await movementsOfTravel(oracle, cfg.ccId, travelId)).filter(
      (r) => r.MOVEMENT_CODE === 'TIVR'
    );
    await attachJson('4-closed', {
      travelId,
      state: done.state,
      amount: done.amount,
      otherCost: done.otherCost ?? null,
      otherCostCom: done.otherCostCom ?? null,
      otherCostNoCom: done.otherCostNoCom ?? null,
      costSalePairs: costSale.pairs,
      ccTravelRows: ccRowsDone.length,
      ccTravelNet: netOf(ccRowsDone),
      ccDbTivrRows: ccDbRows.map((r) => ({ id: r.ID, mount: r.MOUNT, type: r.MOVEMENT_TYPE })),
      clientCcBalanceDeltaDbConvention: clientDeltaDone.balanceDelta
    });
    await verifyAc(testInfo, 'AC-FR-47', async () => {
      expect(
        ccRowsDone,
        'al cerrar la CC debe tener exactamente UN cobro del viaje (sin duplicados)'
      ).toHaveLength(1);
      expect(ccRowsDone[0].concept, 'el movimiento debe ser el cobro del viaje (TIVR)').toMatch(
        TRIP_CONCEPT
      );
      expect(
        ccDbRows,
        `MOVEMENT de la CC ${cfg.ccId}: debe haber exactamente UN TIVR del viaje ${travelId}`
      ).toHaveLength(1);
      return { apiRows: ccRowsDone.length, dbTivrRows: ccDbRows.length };
    });
    await verifyAc(testInfo, 'AC-FR-48', async () => {
      expect(
        round2(Number(ccRowsDone[0].debit)),
        'el debito al cerrar debe igualar el precio final'
      ).toBe(finalPrice);
      expect(Number(ccRowsDone[0].credit ?? 0), 'el cobro no debe acreditar nada').toBe(0);
      expect(
        round2(Number(ccDbRows[0]?.MOUNT)),
        'MOVEMENT.MOUNT del cobro debe igualar el precio final'
      ).toBe(finalPrice);
      return {
        debit: ccRowsDone[0].debit,
        credit: ccRowsDone[0].credit ?? 0,
        dbMount: ccDbRows[0]?.MOUNT
      };
    });
    await verifyAc(testInfo, 'AC-FR-49', async () => {
      const v = evaluateClientCcBalance({
        travelId,
        debit: finalPrice,
        added: clientDeltaDone.added,
        balanceDeltaDb: clientDeltaDone.balanceDelta
      });
      if (v.foreign.length > 0) {
        observation(
          testInfo,
          'AC-FR-49',
          `movimientos ajenos en la CC ${cfg.ccId} durante el run (no son diferencia): ${v.foreign
            .map((r) => `${r.key} (${r.debit - r.credit})`)
            .join(', ')}`
        );
      }
      expect(
        v.ok,
        formatMismatches('saldo de la CC del cliente tras el cierre', v.mismatches)
      ).toBe(true);
      return {
        balanceDeltaDb: clientDeltaDone.balanceDelta,
        sign: v.sign,
        debit: finalPrice,
        own: v.own.length,
        foreign: v.foreign.map((r) => ({ key: r.key, debit: r.debit, credit: r.credit }))
      };
    });

    // ---- 5. Vista previa de la rendicion: lote = [travelId] exacto, columna de pago CC ----
    const tolls = requireNumberField(done, FR_FACTS.detailFields.toll.value);
    const parking = requireNumberField(done, FR_FACTS.detailFields.parking.value);
    const commissionBase = round2(finalPrice - tolls - parking); // city taxes comisionable: incluido
    const commissionBaseNoCityTax = round2(
      commissionBase - requireNumberField(done, FR_FACTS.detailFields.otherTotal.value)
    );
    const calc = (b: number) => ({
      base: b,
      owner: round2(PCT.owner * b),
      driver: round2(PCT.driver * b),
      agency: round2(PCT.agency * b)
    });
    const expectedCommission = calc(commissionBase);
    const altCommission = calc(commissionBaseNoCityTax);
    const ui = await surrender.readUiPreview(batch);
    const apiIds = await surrender.readApiBatchIds(batch);
    const apiPreview = await surrenderClient.preview(batch);
    const row = apiPreview.rows[0];
    await attachJson('5-surrender-preview', {
      uiTravelIds: ui.travelIds,
      apiTravelIds: apiIds,
      row: {
        paymentMethod: row?.paymentMethod,
        travelAmount: row?.travelAmount,
        driverCommissionAmount: row?.driverCommissionAmount ?? null,
        ownerCommissionAmount: row?.ownerCommissionAmount ?? null,
        agencyCommissionAmount: row?.agencyCommissionAmount ?? null
      },
      totalCashAmount: apiPreview.totalCashAmount,
      expectedCommissionWithCityTax: expectedCommission,
      observedAlternativeWithoutCityTax: altCommission
    });
    await verifyAc(testInfo, 'AC-FR-21', async () => {
      const uiBatch = evaluateBatchExactly(
        ui.travelIds.map((id) => ({ travelId: id })),
        [travelId]
      );
      expect(uiBatch.ok, uiBatch.message).toBe(true);
      const apiBatch = evaluateBatchExactly(
        apiIds.map((id) => ({ travelId: id })),
        [travelId]
      );
      expect(apiBatch.ok, apiBatch.message).toBe(true);
      expect(ui.uiTravelsCount, 'la tarjeta de viajes debe igualar el total del lote').toBe(1);
      expect(ui.totalElements, 'totalElements de toSurrend debe igualar el lote esperado').toBe(1);
      return { uiTravelIds: ui.travelIds, apiTravelIds: apiIds };
    });
    await verifyAc(testInfo, 'AC-FR-23', async () => {
      // TODO(verificar en TEST): etiqueta exacta de la columna de pago para CC (se adjunta la medida).
      const v = evaluatePaymentColumn(row?.paymentMethod, 'cc');
      expect(v.ok, formatMismatches('columna de pago del lote (CC)', v.mismatches)).toBe(true);
      return { paymentMethod: row.paymentMethod };
    });
    await verifyAc(testInfo, 'AC-FR-22', async () => {
      expect(round2(Number(row?.travelAmount)), 'travelAmount del lote = precio final').toBe(
        finalPrice
      );
      return { travelAmount: row.travelAmount, finalPrice };
    });
    await verifyAc(testInfo, 'AC-FR-24', async () => {
      // TODO(verificar en TEST): si toSurrend no expone la comision por viaje (null) se verifica en los
      // libros (AC-FR-28) y TRAVELSSURRENDER (AC-FR-30).
      const v = evaluateCommissionPreview(row, commissionBase, commissionBaseNoCityTax);
      if (v.altMatches.length > 0) {
        observation(
          testInfo,
          'AC-FR-24',
          `vista previa ${v.altMatches.join(', ')} coincide con la base SIN city taxes (${commissionBaseNoCityTax}), no con la base oficial ${commissionBase}`
        );
      }
      expect(
        v.ok,
        formatMismatches(
          `comisiones de la vista previa (base con city taxes ${commissionBase})`,
          v.mismatches
        )
      ).toBe(true);
      return { exposed: v.exposed, notExposed: v.notExposed, expectedCommission };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s2-preview-${travelId}`,
      comment:
        `FR S2 viaje ${travelId}: lote exacto [${travelId}], pago «${row?.paymentMethod}», base ${commissionBase}, ` +
        `comisiones esperadas propietario ${expectedCommission.owner} / chofer ${expectedCommission.driver} / agencia ${expectedCommission.agency}.`
    });

    // ---- 6. Confirmacion IRREVERSIBLE (gate FR_CONFIRM_SURRENDER=1 dentro del POM) ----
    const confirmStatus = await test.step('6. Confirm surrender (irreversible)', async () =>
      surrender.confirm());

    await verifyAc(testInfo, 'AC-FR-25', async () => {
      if (confirmStatus >= 500) {
        // El 500 llega tras el commit (PDF): se verifica la persistencia por API; falla si no se persistio.
        const persisted = await readBatchStateUntilEmpty(surrenderClient, batch, travelId);
        expect(
          persisted.settled,
          `POST toTravelsSurrender respondio ${confirmStatus} y el viaje ${travelId} sigue pendiente tras ${persisted.elapsedMs} ms: la rendicion NO se persistio (fallo real, no el known-issue del PDF)`
        ).toBe(true);
        knownIssue(testInfo, 'AC-FR-90', `POST ${confirmStatus}: ${KNOWN_ISSUE_NOTE}`);
      } else {
        expect(confirmStatus, 'POST toTravelsSurrender debe responder 2xx').toBeGreaterThanOrEqual(
          200
        );
        expect(confirmStatus, 'POST toTravelsSurrender debe responder 2xx').toBeLessThan(300);
      }
      return { confirmStatus, persistedDespitePdf500: confirmStatus >= 500 };
    });
    await verifyAc(testInfo, 'AC-FR-26', async () => {
      const r = await readBatchStateUntilEmpty(surrenderClient, batch, travelId);
      expect(
        r.settled,
        `POST toTravelsSurrender respondio ${confirmStatus} y el viaje ${travelId} sigue pendiente tras ${r.elapsedMs} ms: la rendicion NO se persistio (fallo real, no el known-issue del PDF)`
      ).toBe(true);
      return { stillPending: r.value.stillPending, elapsedMs: r.elapsedMs };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s2-confirmed-${travelId}`,
      comment:
        `FR S2 viaje ${travelId}: rendicion confirmada, POST status ${confirmStatus}.` +
        (confirmStatus >= 500 ? ` Rendicion persistida (lote vacio). ${KNOWN_ISSUE_NOTE}.` : '')
    });

    const driverAfterConfirm = await checkingAccountApi.driverMovements({
      driverUserId: cfg.driverId
    });
    const ownerAfterConfirm = await checkingAccountApi.ownerMovements({ ownerId });
    const booksConfirm = await readBooks(checkingAccountApi, cfg, ownerId);
    const driverDelta = deltaMovements(booksBefore.driver, booksConfirm.driver);
    const ownerDelta = deltaMovements(booksBefore.owner, booksConfirm.owner);
    const newDriverKeys = new Set(driverDelta.added.map((m) => m.key));
    const newOwnerKeys = new Set(ownerDelta.added.map((m) => m.key));
    const driverNew = driverAfterConfirm.rows.filter((r) =>
      newDriverKeys.has(['b', r.id].join('|'))
    );
    const ownerNew = ownerAfterConfirm.rows.filter((r) => newOwnerKeys.has(['b', r.id].join('|')));
    const origins = new Set([...driverNew, ...ownerNew].map(bookKey));
    const surrenderId = origins.size === 1 ? Number([...origins][0]) : null;
    const clientDeltaConfirm = deltaMovements(booksBefore.client, booksConfirm.client);
    await attachJson('6-books-after-surrender', {
      confirmStatus,
      knownIssue: confirmStatus >= 500 ? KNOWN_ISSUE_NOTE : null,
      surrenderId,
      driverBook: {
        added: mapRows(driverNew),
        balanceBefore: booksBefore.driver.balance,
        balanceAfter: booksConfirm.driver.balance,
        balanceDelta: driverDelta.balanceDelta
      },
      ownerBook: {
        ownerId,
        added: mapRows(ownerNew),
        balanceBefore: booksBefore.owner.balance,
        balanceAfter: booksConfirm.owner.balance,
        balanceDelta: ownerDelta.balanceDelta
      },
      clientCc: {
        balanceDeltaDbConvention: clientDeltaConfirm.balanceDelta,
        added: clientDeltaConfirm.added
      }
    });
    await verifyAc(testInfo, 'AC-FR-27', async () => {
      expect(
        driverNew.length + ownerNew.length,
        'la rendicion debe generar movimientos nuevos en los libros de chofer y/o propietario'
      ).toBeGreaterThan(0);
      expect(
        origins.size,
        `todos los movimientos nuevos deben pertenecer a UNA rendicion (origins: ${[...origins].join(', ')}); varios origenes indican otra rendicion (cron o foraneo) en la ventana`
      ).toBe(1);
      return { origins: [...origins], surrenderId };
    });
    await verifyAc(testInfo, 'AC-FR-28', async () => {
      // TODO(verificar en TEST): semantica de amount/paid por tipo de movimiento; oraculo agnostico del
      // signo. Base oficial = CON city taxes; la alternativa sin city taxes solo se registra.
      const ownerOk = hasAmount(ownerNew, expectedCommission.owner);
      const driverOk = hasAmount(driverNew, expectedCommission.driver);
      const altOwner = !ownerOk && hasAmount(ownerNew, altCommission.owner);
      const altDriver = !driverOk && hasAmount(driverNew, altCommission.driver);
      if (altOwner || altDriver) {
        observation(
          testInfo,
          'AC-FR-24',
          `libros reflejan la base SIN city taxes (${commissionBaseNoCityTax}) en ${[altOwner ? 'propietario' : '', altDriver ? 'chofer' : ''].filter(Boolean).join(' y ')}, no la base oficial ${commissionBase}`
        );
      }
      expect(
        ownerOk,
        `libro del propietario ${ownerId}: no aparece 40 % de ${commissionBase} (${expectedCommission.owner}); recibido ${JSON.stringify(amountsOf(ownerNew))}`
      ).toBe(true);
      expect(
        driverOk,
        `libro del chofer ${cfg.driverId}: no aparece 40 % de ${commissionBase} (${expectedCommission.driver}); recibido ${JSON.stringify(amountsOf(driverNew))}`
      ).toBe(true);
      return { ownerAmounts: amountsOf(ownerNew), driverAmounts: amountsOf(driverNew) };
    });
    await verifyAc(testInfo, 'AC-FR-29', async () => {
      const v = evaluateBookCodes(
        'cc',
        driverNew.map((r) => r.checkingAccountCode),
        ownerNew.map((r) => r.checkingAccountCode)
      );
      expect(v.ok, formatMismatches('codigos de libro (CC)', v.mismatches)).toBe(true);
      return {
        driverCodes: driverNew.map((r) => r.checkingAccountCode ?? null),
        ownerCodes: ownerNew.map((r) => r.checkingAccountCode ?? null)
      };
    });
    const surrenderDb: { id: number | null } = { id: null };
    await verifyAc(testInfo, 'AC-FR-30', async () => {
      await expect
        .poll(
          async () => {
            surrenderDb.id = (await surrenderIdsOfTrips(oracle, [travelId])).get(travelId) ?? null;
            return surrenderDb.id;
          },
          {
            timeout: 30_000,
            message: `el viaje ${travelId} no obtuvo TRAVELSSURRENDER_ID tras confirmar la rendicion`
          }
        )
        .not.toBeNull();
      const dbSurrenderId = surrenderDb.id as number;
      const header = await readSurrenderHeader(oracle, dbSurrenderId);
      const headerVerdict = evaluateSurrenderHeader(
        header,
        { driverId: cfg.driverId, vehicleId: cfg.vehicleId, ownerId, carrierId: expectedCarrier },
        surrenderId
      );
      expect(
        headerVerdict.ok,
        formatMismatches(`cabecera TRAVELSSURRENDER ${dbSurrenderId}`, headerVerdict.mismatches)
      ).toBe(true);
      const rowDb = await readSurrenderRow(oracle, dbSurrenderId);
      const expectedRow = expectedManualSurrender('cc', commissionBase);
      const rowVerdict = evaluateSurrenderRow(
        nullAsZeroWhereExpectedZero(rowDb, expectedRow),
        expectedRow
      );
      expect(
        rowVerdict.ok,
        formatMismatches(`columnas TRAVELSSURRENDER ${dbSurrenderId}`, rowVerdict.mismatches)
      ).toBe(true);
      const agency = evaluateNoAgencyBookRow(
        [
          ...driverNew.map((r) => ({
            amount: r.amount,
            paid: r.paid,
            code: r.checkingAccountCode
          })),
          ...ownerNew.map((r) => ({ amount: r.amount, paid: r.paid, code: r.checkingAccountCode }))
        ],
        expectedCommission.agency,
        [expectedCommission.owner, expectedCommission.driver]
      );
      expect(
        agency.ok,
        formatMismatches('comision de agencia sin fila de libro', agency.mismatches)
      ).toBe(true);
      return { surrenderId: dbSurrenderId, header, row: rowDb, expectedRow };
    });
    await verifyAc(testInfo, 'AC-FR-31', async () => {
      const driverBalance = evaluateBalanceDelta(driverDelta.added, driverDelta.balanceDelta);
      expect(
        driverBalance.ok,
        formatMismatches('saldo del libro del chofer', driverBalance.mismatches)
      ).toBe(true);
      const ownerBalance = evaluateBalanceDelta(ownerDelta.added, ownerDelta.balanceDelta);
      expect(
        ownerBalance.ok,
        formatMismatches('saldo del libro del propietario', ownerBalance.mismatches)
      ).toBe(true);
      return {
        driver: {
          net: driverBalance.net,
          delta: driverDelta.balanceDelta,
          sign: driverBalance.sign
        },
        owner: { net: ownerBalance.net, delta: ownerDelta.balanceDelta, sign: ownerBalance.sign }
      };
    });

    // ---- 7. Edicion post-rendicion (+10 EUR sobre la venta), IRREVERSIBLE ----
    const tourBefore = requireNumberField(done, FR_FACTS.detailFields.fare.value);
    if (!(tourBefore > 0)) {
      throw new Error('tourPrice del viaje cerrado debe ser > 0 para editar la venta');
    }
    // UI del detalle de un viaje DONE (solo lectura, antes de editar).
    await verifyAc(testInfo, 'AC-FR-63', async () => {
      await new TripEditPage(page).goto(travelId);
      // TODO(verificar en TEST): selector del badge «Read only» (no hay POM); se busca por texto.
      const readOnlyBadge = page.getByText(/read\s*only/i).first();
      await expect(readOnlyBadge, 'el detalle DONE debe mostrar el badge «Read only»').toBeVisible({
        timeout: 15_000
      });
      await expect(
        new TripEditPage(page).editButton,
        'el boton «Editar precios» debe estar visible con permiso TMG.1 en un viaje DONE'
      ).toBeVisible({ timeout: 15_000 });
      return { readOnlyBadge: true, editButton: true };
    });
    const ccRowsBeforeEdit = await readTravelCc();
    const bookRowsBefore = {
      driver: (await checkingAccountApi.driverMovements({ driverUserId: cfg.driverId })).rows,
      owner: (await checkingAccountApi.ownerMovements({ ownerId })).rows
    };
    const surrenderRowBeforeEdit =
      surrenderDb.id === null ? null : await readSurrenderRow(oracle, surrenderDb.id);
    const partsBefore = partsOf(done);
    const newTourPrice = round2(tourBefore + EDIT_DELTA);
    const editReason = `QA FR S2 edicion post-rendicion +${EDIT_DELTA} (viaje ${travelId})`;
    const editPromise = editFlow
      .editFinalPrice({ page, travelId, newAmount: newTourPrice, reason: editReason })
      .then(
        (result) => ({ result, error: null as string | null }),
        (error: unknown) => ({ result: null, error: (error as Error).message })
      );

    const [edit, uiMessages] =
      await test.step('7. Edit sale +10 after surrender (UI, irreversible)', async () =>
        Promise.all([editPromise, collectUiMessages(page, editPromise)]));

    const messages = [...uiMessages, ...nativeDialogs];
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s2-edit-${travelId}`,
      comment:
        `FR S2 viaje ${travelId}: edicion post-rendicion tourPrice ${tourBefore} -> ${newTourPrice}; ` +
        `PUT ${edit.result?.putStatus ?? 'sin PUT'}, POST proceso ${edit.result?.processStatus ?? 'sin POST'}; ` +
        `mensajes UI: ${messages.length > 0 ? messages.join(' | ') : 'ninguno'}.`
    });
    await attachJson('7-edit-ui-messages', {
      messages,
      uiError: edit.error,
      putStatus: edit.result?.putStatus ?? null,
      processStatus: edit.result?.processStatus ?? null,
      putPayload: edit.result?.putPayload ?? null,
      note: 'Q6 (PO): comportamiento esperado de editar un viaje rendido; se observa, no se juzga.'
    });

    const putStatus = edit.result?.putStatus ?? null;
    const accepted = putStatus !== null && putStatus >= 200 && putStatus < 300;
    await verifyAc(testInfo, 'AC-FR-53', async () => {
      if (!accepted) {
        expect(
          messages.length,
          `la edicion no se acepto (PUT ${putStatus ?? 'ausente'}, error del POM: ${edit.error ?? '-'}) y la UI NO mostro ningun mensaje: bloqueo silencioso`
        ).toBeGreaterThan(0);
        const unchanged = await flow.readDetail({ travelId });
        expect(
          round2(Number(unchanged.amount)),
          'edicion bloqueada: el precio final no debe haber cambiado'
        ).toBe(finalPrice);
      }
      return { accepted, messages };
    });
    await verifyAc(testInfo, 'AC-FR-52', async () => {
      expect(
        edit.error,
        `la edicion de un viaje rendido NO liquidado debe aceptarse (mensajes UI: ${messages.join(' | ') || '-'})`
      ).toBeNull();
      expect(putStatus, 'PUT updateFinalPrices debe responder 2xx').toBeGreaterThanOrEqual(200);
      expect(putStatus, 'PUT updateFinalPrices debe responder 2xx').toBeLessThan(300);
      expect(edit.result?.processStatus, 'POST updateFinalPricesProcess').toBe(200);
      // El proceso posterior es fire-and-forget: se espera por estado observable (detalle).
      await expect
        .poll(
          async () => {
            const d = await flow.readDetail({ travelId });
            const inProcess =
              (d.pricesUpdating as { pricesUpdatingInProcess?: boolean } | null | undefined)
                ?.pricesUpdatingInProcess === true;
            return (
              requireNumberField(d, FR_FACTS.detailFields.fare.value) === newTourPrice && !inProcess
            );
          },
          {
            timeout: 60_000,
            message: `edicion aceptada (PUT y POST 200) pero tourPrice del viaje ${travelId} no llego a ${newTourPrice} o el proceso sigue en curso`
          }
        )
        .toBe(true);
      return { putStatus, processStatus: edit.result?.processStatus ?? null };
    });

    // Lecturas posteriores a la edicion.
    const doneAfterEdit = await flow.readDetail({ travelId });
    const partsAfter = partsOf(doneAfterEdit);
    const finalAfter = round2(Number(doneAfterEdit.amount));
    const tourAfter = requireNumberField(doneAfterEdit, FR_FACTS.detailFields.fare.value);
    await verifyAc(testInfo, 'AC-FR-54', async () => {
      expect(
        round2(tourAfter - tourBefore),
        'la venta de la tarifa debe subir exactamente +10'
      ).toBe(EDIT_DELTA);
      expect(
        finalAfter - finalPrice,
        'el precio final debe subir al menos +10 (si sube mas, es el 10 % PCT de city taxes recalculado: se registra en AC-FR-64)'
      ).toBeGreaterThanOrEqual(EDIT_DELTA - MONEY_TOL);
      return { tourBefore, tourAfter, finalPrice, finalAfter };
    });
    const otherCostBefore = requireNumberField(done, FR_FACTS.detailFields.otherTotal.value);
    const otherCostAfter = requireNumberField(
      doneAfterEdit,
      FR_FACTS.detailFields.otherTotal.value
    );
    observation(
      testInfo,
      'AC-FR-64',
      `editar la tarifa +${EDIT_DELTA}: otherCost (PCT «${cfg.otherCostName}») ${otherCostBefore} -> ${otherCostAfter} (` +
        `${Math.abs(otherCostAfter - otherCostBefore) < MONEY_TOL ? 'NO se recalcula' : 'SE recalcula'}); final ${finalPrice} -> ${finalAfter}.`
    );
    // AC-FR-58b: consistencia eventual (el job WA_CHECKINGACCOUNT puede reescribir el TIVR de forma asincrona).
    const ccPoll = await pollUntil(
      readTravelCc,
      (rows) => rows.length === 1 && round2(Number(rows[0].debit)) === finalAfter,
      { timeoutMs: 90_000, intervalMs: 5_000 }
    );
    const ccRowsAfterEdit = ccPoll.value;
    const booksAfterEdit = await readBooks(checkingAccountApi, cfg, ownerId);
    const travelCcDelta = deltaMovements(
      snapshotClientCc(ccRowsBeforeEdit, null),
      snapshotClientCc(ccRowsAfterEdit, null)
    );
    const rowDelta = ccRowsAfterEdit.length - ccRowsBeforeEdit.length;
    const netDelta = round2(netOf(ccRowsAfterEdit) - netOf(ccRowsBeforeEdit));
    const ccOutcome =
      rowDelta === 1 ? 'adjusting-row' : netDelta !== 0 ? 'rewritten-in-place' : 'none';
    const pendingAfterEdit = await surrenderClient.preview(batch);
    const pendingSummaryAfterEdit = (await surrenderClient.pendingSummary()).filter(
      (r) => r.driverId === batch.driverUserId && r.vehicleId === batch.vehicleId
    );
    const driverRowsAfter = (
      await checkingAccountApi.driverMovements({ driverUserId: cfg.driverId })
    ).rows;
    const ownerRowsAfter = (await checkingAccountApi.ownerMovements({ ownerId })).rows;
    const idsOf = (rows: BookRows): Set<number> => new Set(rows.map((r) => r.id));
    const newDriverAfterEdit = driverRowsAfter.filter(
      (r) => !idsOf(bookRowsBefore.driver).has(r.id)
    );
    const newOwnerAfterEdit = ownerRowsAfter.filter((r) => !idsOf(bookRowsBefore.owner).has(r.id));
    const driverBalanceDeltaEdit =
      booksAfterEdit.driver.balance === null || booksConfirm.driver.balance === null
        ? null
        : round2(booksAfterEdit.driver.balance - booksConfirm.driver.balance);
    const ownerBalanceDeltaEdit =
      booksAfterEdit.owner.balance === null || booksConfirm.owner.balance === null
        ? null
        : round2(booksAfterEdit.owner.balance - booksConfirm.owner.balance);
    const clientBalanceDeltaEdit =
      booksAfterEdit.client.balance === null || booksConfirm.client.balance === null
        ? null
        : round2(booksAfterEdit.client.balance - booksConfirm.client.balance);
    const surrenderRowAfterEdit =
      surrenderDb.id === null ? null : await readSurrenderRow(oracle, surrenderDb.id);

    const editObservation = {
      accepted,
      ccOutcome,
      ccRewriteLatencyMs: {
        settled: ccPoll.settled,
        elapsedMs: ccPoll.elapsedMs,
        attempts: ccPoll.attempts
      },
      tourPrice: { before: tourBefore, requested: newTourPrice, after: tourAfter },
      finalPrice: { before: finalPrice, after: finalAfter, delta: round2(finalAfter - finalPrice) },
      otherCost: { before: done.otherCost ?? null, after: doneAfterEdit.otherCost ?? null },
      ccTravel: {
        rowsBefore: ccRowsBeforeEdit.length,
        rowsAfter: ccRowsAfterEdit.length,
        rowDelta,
        netBefore: netOf(ccRowsBeforeEdit),
        netAfter: netOf(ccRowsAfterEdit),
        netDelta,
        addedRows: travelCcDelta.added,
        rowsAfterDetail: ccRowsAfterEdit.map((r) => ({
          concept: r.concept,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance
        }))
      },
      clientCcBalanceDeltaDbConvention: clientBalanceDeltaEdit,
      driverBook: { newRows: mapRows(newDriverAfterEdit), balanceDelta: driverBalanceDeltaEdit },
      ownerBook: { newRows: mapRows(newOwnerAfterEdit), balanceDelta: ownerBalanceDeltaEdit },
      pendingBatchRowsAfterEdit: pendingAfterEdit.rows.map((r) => r.travelId ?? null),
      pendingSummaryRowsAfterEdit: pendingSummaryAfterEdit.length,
      note: 'Q6 (PO) abierta: modelo A (PB-1) recalcula el cierre confirmado; saldo de CC invertido tras edicion = bug preexistente + job WA_CHECKINGACCOUNT. Lo no listado como AC es observacion.'
    };
    await attachJson('7-edit-observation', editObservation);

    await verifyAc(testInfo, 'AC-FR-56', async () => {
      expect(
        surrenderRowBeforeEdit !== null && surrenderRowAfterEdit !== null,
        'TRAVELSSURRENDER del viaje no disponible antes/despues de editar (AC-FR-30 no obtuvo su id)'
      ).toBe(true);
      const v = evaluateSurrenderEditDeltas(
        'cc',
        surrenderRowBeforeEdit as NonNullable<typeof surrenderRowBeforeEdit>,
        surrenderRowAfterEdit as NonNullable<typeof surrenderRowAfterEdit>,
        editDiffs(partsBefore, partsAfter)
      );
      expect(
        v.ok,
        formatMismatches(`TRAVELSSURRENDER ${surrenderDb.id}: delta por la edicion`, v.mismatches)
      ).toBe(true);
      return {
        expected: v.expected,
        observed: v.observed,
        diffs: editDiffs(partsBefore, partsAfter)
      };
    });
    await verifyAc(testInfo, 'AC-FR-58', async () => {
      expect(
        ccRowsAfterEdit,
        `CC ${cfg.ccId}: debe haber exactamente UN movimiento TIVR del viaje ${travelId}, sin duplicados (resultado ${ccOutcome})`
      ).toHaveLength(1);
      expect(
        ccPoll.settled,
        `CC ${cfg.ccId}: el debito del cobro debe quedar en el precio final tras editar (${finalAfter}); ultimo valor leido ${String(ccRowsAfterEdit[0]?.debit)} tras ${ccPoll.elapsedMs} ms / ${ccPoll.attempts} lecturas (ventana 90 s)`
      ).toBe(true);
      return {
        ccOutcome,
        debitBefore: ccRowsBeforeEdit[0]?.debit ?? null,
        debitAfter: ccRowsAfterEdit[0]?.debit ?? null,
        latencyMs: ccPoll.elapsedMs,
        attempts: ccPoll.attempts
      };
    });
    await verifyAc(testInfo, 'AC-FR-59', async () => {
      expect(
        pendingAfterEdit.rows.length === 0 && pendingSummaryAfterEdit.length === 0,
        `tras editar, el lote pendiente del chofer ${cfg.driverId} / vehiculo ${cfg.vehicleId} debe seguir vacio (viaje reencolado: ${pendingAfterEdit.rows.map((r) => r.travelId).join(', ') || '-'}; resumen ${pendingSummaryAfterEdit.length})`
      ).toBe(true);
      return {
        previewRows: pendingAfterEdit.rows.length,
        summaryRows: pendingSummaryAfterEdit.length
      };
    });
    await verifyAc(testInfo, 'AC-FR-60', async () => {
      const driverDup = evaluateNoDuplicatedRows(
        bookRowsBefore.driver,
        driverRowsAfter,
        surrenderId
      );
      const ownerDup = evaluateNoDuplicatedRows(bookRowsBefore.owner, ownerRowsAfter, surrenderId);
      expect(
        driverDup.ok,
        formatMismatches('libro del chofer: filas duplicadas por la edicion', driverDup.mismatches)
      ).toBe(true);
      expect(
        ownerDup.ok,
        formatMismatches(
          'libro del propietario: filas duplicadas por la edicion',
          ownerDup.mismatches
        )
      ).toBe(true);
      return {
        surrenderId,
        driverDuplicated: driverDup.duplicated,
        ownerDuplicated: ownerDup.duplicated
      };
    });

    // ---- 8. Resumen para los oraculos DB del orquestador ----
    const finalSummary = {
      travelId,
      surrenderId,
      simulatedAmount,
      cityTax,
      finalPrice,
      commissionBase,
      commissionBasis: 'con city taxes (regla confirmada)',
      confirmStatus,
      knownIssue: confirmStatus >= 500 ? KNOWN_ISSUE_NOTE : null,
      ccDeltas: {
        create: { rows: ccRowsCreate.length, balanceDeltaDb: clientDeltaCreate.balanceDelta },
        finalize: { rows: ccRowsDone.length, balanceDeltaDb: clientDeltaDone.balanceDelta },
        surrender: { balanceDeltaDb: clientDeltaConfirm.balanceDelta },
        edit: {
          rowDelta,
          netDelta,
          balanceDeltaDb: clientBalanceDeltaEdit,
          outcome: ccOutcome
        }
      },
      books: {
        driver: { surrenderDelta: driverDelta.balanceDelta, editDelta: driverBalanceDeltaEdit },
        owner: { surrenderDelta: ownerDelta.balanceDelta, editDelta: ownerBalanceDeltaEdit }
      },
      edit: {
        accepted,
        putStatus,
        processStatus: edit.result?.processStatus ?? null,
        finalPriceAfter: finalAfter,
        uiMessages: messages
      }
    };
    await attachJson('8-summary', finalSummary);
    console.info(`FR_S2_SUMMARY ${JSON.stringify(finalSummary)}`);
  });
});
