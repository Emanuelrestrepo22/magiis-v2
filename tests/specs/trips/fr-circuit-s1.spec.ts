// tests/specs/trips/fr-circuit-s1.spec.ts
// Circuito e2e carrier Francia, escenario S1 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): viaje CASH
// creado por UI -> cierre administrativo (cancel + finalizeAdmin, unico camino a DONE sin app del
// chofer) -> rendicion manual por UI -> deltas de los libros de chofer y propietario.
// Carrier TEST 1901 «Cannes Ride Test», chofer 4965 (user 15815), vehiculo 3765, propietario 2927.
//
// Gates (todos exactamente `1`; sin ellos el spec se salta ANTES de crear nada):
// - FR_CIRCUIT_CREATE_TRIP=1: el alta crea un viaje PERMANENTE (queda DONE, anotado en el ledger
//   `admin-circuit`, excluido de regresiones manuales).
// - FR_CONFIRM_SURRENDER=1: habilita `SurrenderPage.confirm()`, el POST toTravelsSurrender
//   IRREVERSIBLE (genera la rendicion y los movimientos de los libros).
// Ademas: ENV=test, FR_* completos (getFrCircuitConfig), storage state del carrier 1901 (ver
// FR_CARRIER_ID abajo) y ADMIN_FINALIZE_DRIVER_ID NO se usa: el chofer sale de FR_DRIVER_ID.
//
// Variables opcionales de este spec: FR_OWNER_ID (vehicleOwner.id del libro del propietario; default
// 2927 = propietario del vehiculo 3765 segun datos-1901-2026-10-19.md), FR_CARRIER_ID (default 1901;
// el spec aborta si la sesion guardada es de otro carrier), FR_EXPECTED_QUOTE (cotizacion esperada
// exacta; sin ella solo se exige > 0).
// ACs (registro tipado tests/helpers/acceptance.ts): 01 02 04 05 06 07 08 12 14 15 20 21 22 23 24 25 26 27 28 29 30 31 51;
// toda asercion de negocio vive dentro de verifyAc; DB de solo lectura obligatoria (fixture `db`).
// Sin retries: un reintento crearia otro viaje permanente y mezclaria el lote de rendicion.
// Horario: NO correr entre 10:00 y 10:20 ART, es decir 13:00-13:20 UTC (cron de rendicion automatica con CASHCOLLECTOR=1 contamina el lote).
import { evaluateBatchExactly } from '../../helpers/surrender-oracle.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import { requireNumberField } from '../../helpers/fr-circuit.js';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { DriverBookRow, OwnerBookRow } from '../../api/clients/checkingAccount.client.js';
import {
  getCurrentEnv,
  getFrCircuitConfig,
  isFrGateOpen,
  type FrCircuitConfig
} from '../../config/runtime.js';
import { verifyAc, knownIssue } from '../../helpers/acceptance.js';
import { deltaMovements, snapshotBook, type CcSnapshot } from '../../helpers/cc-delta.js';
import { COST_SALE_SCOPE_NOTE, evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import { evaluateSaleCostPairs, evaluateSurrenderRow } from '../../helpers/db-oracle-eval.js';
import {
  evaluateBalanceDelta,
  evaluateBookCodes,
  evaluateCommissionPreview,
  evaluateDbCancelled,
  evaluateDbClosedByAdmin,
  evaluateDbNoCharge,
  evaluateDriverAssigned,
  evaluateNoAgencyBookRow,
  evaluateNotInBatch,
  evaluatePaymentColumn,
  evaluateSurrenderHeader,
  expectedManualSurrender,
  formatMismatches,
  nullAsZeroWhereExpectedZero,
  readBatchState,
  readBatchStateUntilEmpty,
  readTravelCoreDb,
  splitSaleCostMismatches
} from '../../helpers/fr-ac-eval-circuit.js';
import { noChargeCheck } from '../../helpers/no-charge.js';
import {
  movementsOfTravel,
  readSurrenderHeader,
  surrenderIdsOfTrips
} from '../../steps/trips/autoSurrender.steps.js';
import { readSaleCostData, readSurrenderRow } from '../../steps/trips/dbOracles.steps.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { SurrenderFlow } from '../../steps/trips/surrender.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_S1_TARGETS, FR_1901_SCOPE_NOTES } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_S1_TARGETS;
const PAYMENT_METHOD = 'Cash';
const STATE_DONE = /^DONE$/i;
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;
const KNOWN_ISSUE_NOTE =
  'TEST FR THOUSANDS_SEPARATOR SPACE -> surrender PDF 500 (rendicion persistida)';
const DEFAULT_OWNER_ID = 2927;
const DEFAULT_CARRIER_ID = 1901;
// Comisiones sobre venta del vehiculo 3765 (datos-1901 §«lote B»): propietario 40, chofer 40, agencia 20.
const PCT = { owner: 0.4, driver: 0.4, agency: 0.2 } as const;

function frConfigOrNull(): { config: FrCircuitConfig | null; reason: string } {
  if (getCurrentEnv() !== 'test') return { config: null, reason: 'FR S1 corre solo con ENV=test' };
  if (!isFrGateOpen('FR_CIRCUIT_CREATE_TRIP')) {
    return { config: null, reason: 'requiere FR_CIRCUIT_CREATE_TRIP=1 (crea un viaje permanente)' };
  }
  if (!isFrGateOpen('FR_CONFIRM_SURRENDER')) {
    return {
      config: null,
      reason: 'requiere FR_CONFIRM_SURRENDER=1 (rendicion irreversible); sin ella no se crea nada'
    };
  }
  try {
    return { config: getFrCircuitConfig(), reason: '' };
  } catch (e) {
    return { config: null, reason: (e as Error).message };
  }
}

const frGate = frConfigOrNull();

const optionalInt = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} no es un entero positivo`);
  return n;
};

const bookKey = (row: DriverBookRow | OwnerBookRow): string => String(row.origin ?? 'null');

test.describe('Circuito Francia S1 (cash · cierre admin · rendicion manual)', () => {
  test.skip(frGate.config === null, `FR S1 saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('FR-S1: validar-circuito-francia cash cierre admin y rendicion manual', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S1');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(TS_KEY, ROUTE)('FR-S1', 'HP');
    testInfo.annotations.push({ type: 'xray_comment', description: FR_1901_SCOPE_NOTES.S1 });
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    // MAGIIS "driverUserId" path/query params are DRIVER.ID (DriverResponseDTO.driverUserId = DRIVER.ID), not USER_ID.
    const batch = { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId };
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const surrender = new SurrenderFlow(page, surrenderClient);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });

    // ---- 1. Precondiciones tecnicas: sesion del carrier FR y oraculo DB (antes de crear nada) ----
    if (carrierSession.carrierId !== expectedCarrier) {
      throw new Error(
        `la sesion guardada debe ser del carrier ${expectedCarrier} (recibido ${String(carrierSession.carrierId)}); regenerar storage state con USER_CARRIER_FR`
      );
    }

    const driverBefore = await checkingAccountApi.driverMovements({
      driverUserId: cfg.driverId
    });
    const ownerBefore = await checkingAccountApi.ownerMovements({ ownerId });
    const snapDriverBefore: CcSnapshot = snapshotBook(driverBefore.rows, driverBefore.balance);
    const snapOwnerBefore: CcSnapshot = snapshotBook(ownerBefore.rows, ownerBefore.balance);
    const isolation = await readIsolation({
      surrender: surrenderClient,
      batch,
      db: oracle,
      ownerId
    });
    await attachJson('1-preconditions', {
      carrierId: carrierSession.carrierId,
      driverBook: { rows: driverBefore.rows.length, balance: driverBefore.balance },
      ownerBook: { ownerId, rows: ownerBefore.rows.length, balance: ownerBefore.balance },
      pendingBatchRows: isolation.batchRows,
      pendingSummaryRows: isolation.summaryRows,
      foreignPendingTrips: isolation.foreignTrips,
      ownerCashCollector: isolation.cashCollectorFlag,
      cronWindow: isolation.cronWindow
    });
    await verifyAc(testInfo, 'AC-FR-20', async () => {
      // Precondicion de ejecucion: la ventana del cron diario solo bloquea con CASHCOLLECTOR=1 (lanza).
      assertOutsideCronWindow({ cashCollectorFlag: isolation.cashCollectorFlag });
      expect(
        isolation.batchRows.length === 0 && isolation.summaryRows === 0,
        `lote de rendicion NO vacio antes de empezar (chofer user ${batch.driverUserId} / vehiculo ${batch.vehicleId}): ` +
          `viajes ${isolation.batchRows.join(', ') || '-'}, filas de resumen ${isolation.summaryRows}. ` +
          'Hay viajes ajenos pendientes: rendirlos o excluirlos antes de correr S1.'
      ).toBe(true);
      return { pendingRows: isolation.batchRows.length, pendingSummaryRows: isolation.summaryRows };
    });

    // ---- 2. Alta por UI ----
    // assertBeforeSubmit es guarda de creacion (falla ANTES de crear el viaje permanente); la
    // asercion de negocio de la cotizacion vive en AC-FR-01 tras el alta.
    const { travelId, simulatedAmount } =
      await test.step('2. Create CASH trip via UI (Luis, FR route)', async () =>
        flow.createViaUi({
          page,
          client: cfg.clientQuery,
          paymentMethod: PAYMENT_METHOD,
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

    const created = await flow.readDetail({ travelId });
    await attachJson('2-created', {
      travelId,
      simulatedAmount,
      state: created.state ?? null,
      paymentMethod: created.paymentMethod ?? null
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s1-quote-${travelId}`,
      comment: `FR S1 viaje ${travelId}: alta CASH, cotizacion simulada ${simulatedAmount}.`
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
    await verifyAc(testInfo, 'AC-FR-02', async () => {
      // TODO(verificar en TEST): si el detalle no trae simulationPrice.currencyCode la moneda EUR
      // queda sin asercion por API (revisar la captura de la cotizacion).
      const currency = (created.simulationPrice as Record<string, unknown> | null | undefined)
        ?.currencyCode;
      if (currency !== undefined && currency !== null) {
        expect(String(currency), 'moneda de la cotizacion debe ser EUR').toMatch(/EUR|€/i);
      }
      return {
        currencyCode: currency ?? null,
        verifiedByApi: currency !== undefined && currency !== null
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

    // ---- 3. Cierre administrativo: cancel + finalizeAdmin (sin cambio de precio) ----
    await test.step('3a. Admin close: cancel', async () => flow.cancel({ travelId }));

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
      const noCharge = noChargeCheck(cancelled);
      expect(
        noCharge.hasAmountField,
        'el detalle debe exponer el campo amount (un campo ausente no prueba «sin cargo»)'
      ).toBe(true);
      expect(
        noCharge.isNoCharge,
        `la cancelacion sin cargo debe dejar amount null o 0 explicito (recibido: ${String(noCharge.amount)})`
      ).toBe(true);
      const v = evaluateDbNoCharge(cancelledDb);
      expect(v.ok, formatMismatches('FINALPRICEI del cancelado', v.mismatches)).toBe(true);
      return { amount: noCharge.amount ?? null, finalPriceId: cancelledDb.FINALPRICE_ID };
    });

    await test.step('3b. Admin close: finalizeAdmin with DRIVER.ID', async () =>
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

    // ---- 4. Costo = venta (carrier no Universal): detalle API + DB ----
    const costSale = evaluateCostEqualsSale({
      detail: done,
      label: `FR S1 trip ${travelId}`,
      expectOtherCost: false
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
      return { apiPairs: costSale.pairs, dbSource: saleCost.source };
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
    await attachJson('3-4-closed', {
      travelId,
      state: done.state,
      amount: done.amount,
      driverIdInDetail: driverMeasured,
      costSalePairs: costSale.pairs
    });

    // ---- 5. Vista previa de la rendicion: lote = [travelId] exacto ----
    const tolls = requireNumberField(done, FR_FACTS.detailFields.toll.value);
    const parking = requireNumberField(done, FR_FACTS.detailFields.parking.value);
    const base = round2(finalPrice - tolls - parking);
    const expectedCommission = {
      base,
      owner: round2(PCT.owner * base),
      driver: round2(PCT.driver * base),
      agency: round2(PCT.agency * base)
    };
    const ui = await surrender.readUiPreview(batch);
    const apiIds = await surrender.readApiBatchIds(batch);
    const apiPreview = await surrenderClient.preview(batch);
    const totals = await surrenderClient.totals(batch);
    await attachJson('5-surrender-preview', {
      uiTravelIds: ui.travelIds,
      apiTravelIds: apiIds,
      uiTravelsCount: ui.uiTravelsCount,
      rows: apiPreview.rows.map((r) => ({
        travelId: r.travelId,
        paymentMethod: r.paymentMethod,
        travelAmount: r.travelAmount,
        driverCommissionAmount: r.driverCommissionAmount ?? null,
        ownerCommissionAmount: r.ownerCommissionAmount ?? null,
        agencyCommissionAmount: r.agencyCommissionAmount ?? null
      })),
      totalCashAmount: apiPreview.totalCashAmount,
      totalsKeys: Object.keys(totals),
      totalsRaw: totals,
      uiTotalsCaptured: ui.totals !== null,
      expectedCommission
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
    const row = apiPreview.rows[0];
    await verifyAc(testInfo, 'AC-FR-22', async () => {
      expect(row?.travelAmount, 'travelAmount del lote debe existir').toBeDefined();
      expect(round2(Number(row.travelAmount)), 'travelAmount del lote = precio final').toBe(
        finalPrice
      );
      return { travelAmount: row.travelAmount, finalPrice };
    });
    await verifyAc(testInfo, 'AC-FR-23', async () => {
      const v = evaluatePaymentColumn(row?.paymentMethod, 'cash');
      expect(v.ok, formatMismatches('columna de pago del lote (efectivo)', v.mismatches)).toBe(
        true
      );
      return { paymentMethod: row.paymentMethod };
    });
    await verifyAc(testInfo, 'AC-FR-24', async () => {
      // TODO(verificar en TEST): si toSurrend no expone la comision por viaje queda sin juzgar aqui y
      // se verifica contra los libros (AC-FR-28) y TRAVELSSURRENDER (AC-FR-30); no se adivina.
      const v = evaluateCommissionPreview(row, base);
      expect(
        v.ok,
        formatMismatches(`comisiones de la vista previa sobre la base ${base}`, v.mismatches)
      ).toBe(true);
      return { exposed: v.exposed, notExposed: v.notExposed, expectedCommission };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s1-preview-${travelId}`,
      comment:
        `FR S1 viaje ${travelId}: vista previa de rendicion con lote exacto [${travelId}], ` +
        `base ${base}, comisiones esperadas propietario ${expectedCommission.owner} / chofer ${expectedCommission.driver} / agencia ${expectedCommission.agency}.`
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
      name: `fr-s1-confirmed-${travelId}`,
      comment:
        `FR S1 viaje ${travelId}: rendicion confirmada, POST status ${confirmStatus}.` +
        (confirmStatus >= 500 ? ` Rendicion persistida (lote vacio). ${KNOWN_ISSUE_NOTE}.` : '')
    });

    // ---- 7. Delta de libros de chofer y propietario ----
    const driverAfter = await checkingAccountApi.driverMovements({
      driverUserId: cfg.driverId
    });
    const ownerAfter = await checkingAccountApi.ownerMovements({ ownerId });
    const driverDelta = deltaMovements(
      snapDriverBefore,
      snapshotBook(driverAfter.rows, driverAfter.balance)
    );
    const ownerDelta = deltaMovements(
      snapOwnerBefore,
      snapshotBook(ownerAfter.rows, ownerAfter.balance)
    );
    const newDriverIds = new Set(driverDelta.added.map((m) => m.key));
    const newOwnerIds = new Set(ownerDelta.added.map((m) => m.key));
    const driverNew = driverAfter.rows.filter((r) => newDriverIds.has(['b', r.id].join('|')));
    const ownerNew = ownerAfter.rows.filter((r) => newOwnerIds.has(['b', r.id].join('|')));
    const origins = new Set([...driverNew, ...ownerNew].map(bookKey));
    const surrenderId = origins.size === 1 ? Number([...origins][0]) : null;

    const amountsOf = (rows: Array<DriverBookRow | OwnerBookRow>): number[] =>
      rows
        .flatMap((r) => [Math.abs(Number(r.amount ?? 0)), Math.abs(Number(r.paid ?? 0))])
        .map(round2);
    const has = (rows: Array<DriverBookRow | OwnerBookRow>, v: number): boolean =>
      amountsOf(rows).some((a) => Math.abs(a - v) < 0.011);

    const summary = {
      tripId: travelId,
      surrenderId,
      surrenderIdSource: 'origin (IDFORCARRIER) de los movimientos nuevos de los libros',
      simulatedAmount,
      finalPrice,
      base,
      expectedCommission,
      confirmStatus,
      driverBook: {
        added: driverNew.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid: r.paid,
          code: r.checkingAccountCode,
          origin: r.origin
        })),
        balanceBefore: snapDriverBefore.balance,
        balanceAfter: driverAfter.balance,
        balanceDelta: driverDelta.balanceDelta
      },
      ownerBook: {
        ownerId,
        added: ownerNew.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid: r.paid,
          code: r.checkingAccountCode,
          origin: r.origin
        })),
        balanceBefore: snapOwnerBefore.balance,
        balanceAfter: ownerAfter.balance,
        balanceDelta: ownerDelta.balanceDelta
      }
    };
    await attachJson('7-books-delta', summary);
    // Resumen para los oraculos DB del orquestador.
    console.info(`FR_S1_SUMMARY ${JSON.stringify(summary)}`);

    await verifyAc(testInfo, 'AC-FR-27', async () => {
      expect(
        driverNew.length + ownerNew.length,
        'la rendicion debe generar movimientos nuevos en los libros de chofer y/o propietario'
      ).toBeGreaterThan(0);
      expect(
        origins.size,
        `todos los movimientos nuevos deben pertenecer a UNA rendicion (origins: ${[...origins].join(', ')}); ` +
          'varios origenes indican otra rendicion (cron o foraneo) en la ventana'
      ).toBe(1);
      return { origins: [...origins], surrenderId };
    });
    await verifyAc(testInfo, 'AC-FR-28', async () => {
      // TODO(verificar en TEST): semantica de amount/paid por tipo de movimiento. El oraculo es
      // agnostico del signo (valor absoluto en amount o paid); el codigo se juzga en AC-FR-29.
      expect(
        has(ownerNew, expectedCommission.owner),
        `libro del propietario ${ownerId}: no aparece un movimiento = ${expectedCommission.owner} (40 % de ${base}); recibido ${JSON.stringify(amountsOf(ownerNew))}`
      ).toBe(true);
      expect(
        has(driverNew, expectedCommission.driver),
        `libro del chofer ${cfg.driverId}: no aparece un movimiento = ${expectedCommission.driver} (40 % de ${base}); recibido ${JSON.stringify(amountsOf(driverNew))}`
      ).toBe(true);
      return { ownerAmounts: amountsOf(ownerNew), driverAmounts: amountsOf(driverNew) };
    });
    await verifyAc(testInfo, 'AC-FR-29', async () => {
      const v = evaluateBookCodes(
        'cash',
        driverNew.map((r) => r.checkingAccountCode),
        ownerNew.map((r) => r.checkingAccountCode)
      );
      expect(v.ok, formatMismatches('codigos de libro (efectivo)', v.mismatches)).toBe(true);
      return {
        driverCodes: driverNew.map((r) => r.checkingAccountCode ?? null),
        ownerCodes: ownerNew.map((r) => r.checkingAccountCode ?? null)
      };
    });
    await verifyAc(testInfo, 'AC-FR-30', async () => {
      const holder: { id: number | null } = { id: null };
      await expect
        .poll(
          async () => {
            holder.id = (await surrenderIdsOfTrips(oracle, [travelId])).get(travelId) ?? null;
            return holder.id;
          },
          {
            timeout: 30_000,
            message: `el viaje ${travelId} no obtuvo TRAVELSSURRENDER_ID tras confirmar la rendicion`
          }
        )
        .not.toBeNull();
      const dbSurrenderId = holder.id as number;
      const header = await readSurrenderHeader(oracle, dbSurrenderId);
      const headerVerdict = evaluateSurrenderHeader(
        header,
        {
          driverId: cfg.driverId,
          vehicleId: cfg.vehicleId,
          ownerId,
          carrierId: expectedCarrier
        },
        surrenderId
      );
      expect(
        headerVerdict.ok,
        formatMismatches(`cabecera TRAVELSSURRENDER ${dbSurrenderId}`, headerVerdict.mismatches)
      ).toBe(true);
      const rowDb = await readSurrenderRow(oracle, dbSurrenderId);
      const expectedRow = expectedManualSurrender('cash', base);
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
    await verifyAc(testInfo, 'AC-FR-51', async () => {
      const apiRows = await checkingAccountApi.movementsByTravel({
        travelId,
        checkingAccountId: cfg.ccId
      });
      expect(
        apiRows,
        `CC del cliente ${cfg.ccId}: un viaje en efectivo no debe generar movimientos del viaje ${travelId}`
      ).toHaveLength(0);
      const dbRows = await movementsOfTravel(oracle, cfg.ccId, travelId);
      expect(
        dbRows,
        `MOVEMENT de la CC ${cfg.ccId}: un viaje en efectivo no debe tener movimientos del viaje ${travelId}`
      ).toHaveLength(0);
      return { apiRows: apiRows.length, dbRows: dbRows.length };
    });
  });
});
