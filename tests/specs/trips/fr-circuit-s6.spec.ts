// tests/specs/trips/fr-circuit-s6.spec.ts
// Circuito e2e carrier Francia, escenario S6 (control de cancelacion; PLAN-E2E-CARRIER-FRANCIA-UAT-
// 2026-10-19): viaje CASH creado por UI -> cancelacion de carrier sin cargo (API) -> el viaje queda
// cancelado, sin cargo, fuera del lote de rendicion y sin tocar los libros (chofer, propietario, CC
// del cliente). Carrier TEST 1901, chofer 4965 (DRIVER.ID), vehiculo 3765, propietario 2927.
//
// Gate: FR_CIRCUIT_CREATE_TRIP=1 (crea un viaje PERMANENTE, queda CANCELLED y anotado en el ledger
// `admin-circuit`). No confirma ninguna rendicion. Sin retries (un reintento crearia otro viaje).
// Opcionales: FR_OWNER_ID (default 2927), FR_CARRIER_ID (default 1901).
// CC del cliente: FR_CC_ID (el plan nombra la CC 5614 de Luis; el spec usa lo configurado y lo
// adjunta en la evidencia).
// ACs (tests/helpers/acceptance.ts): 01 14 15 16 17 18 19 20; toda asercion de negocio vive dentro de
// verifyAc; DB de solo lectura obligatoria (fixture `db`).
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { verifyAc } from '../../helpers/acceptance.js';
import { deltaMovements } from '../../helpers/cc-delta.js';
import {
  evaluateDbCancelled,
  evaluateDbNoCharge,
  evaluateDbNotSurrendered,
  formatMismatches,
  readTravelCoreDb
} from '../../helpers/fr-ac-eval-circuit.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  readBooks
} from '../../helpers/fr-circuit.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import { noChargeCheck } from '../../helpers/no-charge.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_KEYS, FR_1901_SCOPE_NOTES } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_KEYS.S6;
const PAYMENT_METHOD = 'Cash';
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;

const frGate = frConfigOrNull('FR S6', ['FR_CIRCUIT_CREATE_TRIP']);

test.describe('Circuito Francia S6 (cancelacion sin cargo)', () => {
  test.skip(frGate.config === null, `FR S6 saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('FR-S6: validar-circuito-francia cancelacion sin cargo no toca lote ni libros', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S6');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(TS_KEY, ROUTE)('FR-S6', 'NEG');
    testInfo.annotations.push({ type: 'xray_comment', description: FR_1901_SCOPE_NOTES.S6 });
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    const batch = { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId }; // DRIVER.ID
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });

    // ---- 1. Precondiciones: sesion, oraculo DB, libros y lote vacio ----
    if (carrierSession.carrierId !== expectedCarrier) {
      throw new Error(
        `la sesion guardada debe ser del carrier ${expectedCarrier} (recibido ${String(carrierSession.carrierId)}); regenerar storage state con USER_CARRIER_FR`
      );
    }
    const booksBefore = await readBooks(checkingAccountApi, cfg, ownerId);
    const isolation = await readIsolation({
      surrender: surrenderClient,
      batch,
      db: oracle,
      ownerId
    });
    const emptyBatch = await verifyAc(testInfo, 'AC-FR-20', async () => {
      assertOutsideCronWindow({ cashCollectorFlag: isolation.cashCollectorFlag });
      expect(
        isolation.batchRows.length === 0 && isolation.summaryRows === 0,
        `lote de rendicion NO vacio antes de empezar (chofer ${batch.driverUserId} / vehiculo ${batch.vehicleId}): ` +
          `viajes ${isolation.batchRows.join(', ') || '-'}, filas de resumen ${isolation.summaryRows}. Rendirlos o excluirlos antes de correr.`
      ).toBe(true);
      return { pendingRows: isolation.batchRows, pendingSummaryRows: isolation.summaryRows };
    });
    await attachJson('1-preconditions', {
      carrierId: carrierSession.carrierId,
      ccId: cfg.ccId,
      driverBook: { rows: booksBefore.driverRows, balance: booksBefore.driver.balance },
      ownerBook: { ownerId, rows: booksBefore.ownerRows, balance: booksBefore.owner.balance },
      clientCc: { rows: booksBefore.client.rows.length, balance: booksBefore.client.balance },
      emptyBatch: emptyBatch ?? null
    });

    // ---- 2. Alta por UI ----
    // assertBeforeSubmit es guarda de creacion (falla ANTES de crear el viaje permanente); la
    // asercion de negocio de la cotizacion vive en AC-FR-01 tras el alta.
    const { travelId, simulatedAmount } = await flow.createViaUi({
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
    });
    const created = await flow.readDetail({ travelId });
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

    // ---- 3. Cancelacion sin cargo ----
    await test.step('3. Cancel trip without charge (API)', async () => flow.cancel({ travelId }));

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
    // amount null o 0 explicito; un campo ausente no prueba «sin cargo». FINALPRICEI por DB: sin fila
    // o con FINALPRICE en 0 (los importes en 0 viven en TRAVEL_HISTORY tras pasar a historico).
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
      return {
        amount: noCharge.amount ?? null,
        finalPriceId: cancelledDb.FINALPRICE_ID,
        finalPrice: cancelledDb.FINALPRICE
      };
    });
    await verifyAc(testInfo, 'AC-FR-19', async () => {
      const v = evaluateDbNotSurrendered(cancelledDb);
      expect(v.ok, formatMismatches('TRAVEL del cancelado sin rendicion', v.mismatches)).toBe(true);
      return {
        travelsSurrenderId: cancelledDb.TRAVELSSURRENDER_ID,
        surrendered: cancelledDb.SURRENDERED,
        hasTravelRow: cancelledDb.hasTravelRow
      };
    });

    // ---- 4. Fuera del lote de rendicion ----
    const previewAfter = await surrenderClient.preview(batch);
    const summaryAfter = (await surrenderClient.pendingSummary()).filter(
      (r) => r.driverId === batch.driverUserId && r.vehicleId === batch.vehicleId
    );
    const previewIds = previewAfter.rows.map((r) => r.travelId);
    await verifyAc(testInfo, 'AC-FR-16', async () => {
      expect(
        previewIds,
        `el viaje cancelado ${travelId} no debe estar en la vista previa`
      ).not.toContain(travelId);
      expect(
        previewIds.length === 0 && summaryAfter.length === 0,
        `el lote del chofer ${batch.driverUserId}/vehiculo ${batch.vehicleId} debe seguir vacio (viajes: ${previewIds.join(', ') || '-'}, resumen: ${summaryAfter.length})`
      ).toBe(true);
      return { previewTravelIds: previewIds, summaryRows: summaryAfter.length };
    });

    // ---- 5. Libros sin cambios ----
    const booksAfter = await readBooks(checkingAccountApi, cfg, ownerId);
    const driverDelta = deltaMovements(booksBefore.driver, booksAfter.driver);
    const ownerDelta = deltaMovements(booksBefore.owner, booksAfter.owner);
    const clientDelta = deltaMovements(booksBefore.client, booksAfter.client);

    const measurement = {
      travelId,
      simulatedAmount,
      stateCreated: created.state ?? null,
      stateCancelled: cancelled.state ?? null,
      rawCancelledAmount: cancelled.amount ?? null,
      previewTravelIds: previewIds,
      driverBook: { added: driverDelta.added.length, balanceDelta: driverDelta.balanceDelta },
      ownerBook: { ownerId, added: ownerDelta.added.length, balanceDelta: ownerDelta.balanceDelta },
      clientCc: {
        ccId: cfg.ccId,
        added: clientDelta.added,
        balanceDelta: clientDelta.balanceDelta
      }
    };
    await attachJson('5-books-unchanged', measurement);
    console.info(`FR_S6_SUMMARY ${JSON.stringify(measurement)}`);
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s6-cancelled-${travelId}`,
      comment:
        `FR S6 viaje ${travelId}: alta CASH cotizacion ${simulatedAmount}; cancel -> ${String(cancelled.state)} amount ${String(cancelled.amount)}; ` +
        `lote de rendicion vacio; libros sin movimientos nuevos (CC cliente ${cfg.ccId}).`
    });

    await verifyAc(testInfo, 'AC-FR-17', async () => {
      expect(driverDelta.added, 'libro del chofer sin movimientos nuevos').toEqual([]);
      expect(ownerDelta.added, 'libro del propietario sin movimientos nuevos').toEqual([]);
      expect(driverDelta.balanceDelta ?? 0, 'saldo del libro del chofer sin cambios').toBe(0);
      expect(ownerDelta.balanceDelta ?? 0, 'saldo del libro del propietario sin cambios').toBe(0);
      return {
        driver: { added: driverDelta.added.length, balanceDelta: driverDelta.balanceDelta },
        owner: { added: ownerDelta.added.length, balanceDelta: ownerDelta.balanceDelta }
      };
    });
    // S6 crea el viaje en efectivo: la rama CC del cliente no se ejercita (el AC se valida igual).
    await verifyAc(testInfo, 'AC-FR-18', async () => {
      expect(
        clientDelta.added.filter((m) => m.travelId === travelId),
        `CC del cliente ${cfg.ccId}: la cancelacion sin cargo no debe generar movimientos del viaje ${travelId}`
      ).toEqual([]);
      expect(clientDelta.balanceDelta ?? 0, `saldo de la CC ${cfg.ccId} sin cambios`).toBe(0);
      return {
        ccId: cfg.ccId,
        added: clientDelta.added.length,
        balanceDelta: clientDelta.balanceDelta
      };
    });
  });
});
