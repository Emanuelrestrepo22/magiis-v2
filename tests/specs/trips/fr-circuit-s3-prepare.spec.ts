// tests/specs/trips/fr-circuit-s3-prepare.spec.ts
// FR S3, parte 1/2 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): prepara el viaje que cerrara la APP
// REAL del chofer (Appium, otro repo). Precondiciones -> alta CASH por UI (Luis, ruta FR) ->
// asignacion al chofer 4965 / vehiculo 3765 por API del carrier -> handoff
// `evidence/test/fr-s3-handoff.json`. NO finaliza: el cierre lo hace la app; luego se corre
// fr-circuit-s3-verify.spec.ts.
//
// Gate: FR_CIRCUIT_CREATE_TRIP=1 (viaje PERMANENTE, anotado en el ledger `admin-circuit`).
// Opcionales: FR_OWNER_ID (default 2927), FR_CARRIER_ID (default 1901). Sin retries.
// ACs (tests/helpers/acceptance.ts): 01 04 05 20; AC-95 (App Driver 2.6.17 conserva la oferta de un viaje
// cancelado asignado a mano) es known-issue: se anota, solo la app real lo puede ejercitar.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { assignTravelToDriver } from '../../api/clients/driverTravels.client.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { knownIssue, verifyAc } from '../../helpers/acceptance.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import {
  evaluateDriverAssigned,
  evaluateNotInBatch,
  formatMismatches,
  readBatchState,
  readTravelCoreDb
} from '../../helpers/fr-ac-eval-circuit.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  HANDOFF_PATH,
  optionalInt,
  readBooks,
  writeHandoff,
  type FrS3Handoff
} from '../../helpers/fr-circuit.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { round2 } from '../../utils/money.js';

const PAYMENT_METHOD = 'Cash';

const frGate = frConfigOrNull('FR S3 prepare', ['FR_CIRCUIT_CREATE_TRIP']);

test.describe('Circuito Francia S3 prepare (alta + asignacion, cierre por app)', () => {
  test.skip(frGate.config === null, `FR S3 prepare saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('FR-S3-prepare: validar-circuito-francia alta y asignacion para cierre por app', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S3 prepare');
    const cfg = frGate.config as FrCircuitConfig;
    // Sin key de Xray a proposito: prepara datos; el veredicto lo da su `verify` (fr-1901-keys.ts).
    testInfo.annotations.push({ type: 'tc', description: 'FR-S3-prepare' });
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
    // Precondicion de configuracion (no regla de negocio): con CASHCOLLECTOR=1 el cron contamina el lote.
    assertOutsideCronWindow({ cashCollectorFlag: isolation.cashCollectorFlag });
    const emptyBatch = await verifyAc(testInfo, 'AC-FR-20', async () => {
      expect(
        isolation.batchRows.length === 0 && isolation.summaryRows === 0,
        `lote de rendicion NO vacio antes de empezar (chofer ${batch.driverUserId} / vehiculo ${batch.vehicleId}): ` +
          `viajes ${isolation.batchRows.join(', ') || '-'}, filas de resumen ${isolation.summaryRows}. Rendirlos o excluirlos antes de correr.`
      ).toBe(true);
      return {
        pendingRows: isolation.batchRows,
        pendingSummaryRows: isolation.summaryRows,
        foreignTrips: isolation.foreignTrips,
        cashCollectorFlag: isolation.cashCollectorFlag
      };
    });
    await attachJson('1-preconditions', {
      carrierId: carrierSession.carrierId,
      driverBook: { rows: booksBefore.driverRows, balance: booksBefore.driver.balance },
      ownerBook: { ownerId, rows: booksBefore.ownerRows, balance: booksBefore.owner.balance },
      clientCc: { ccId: cfg.ccId, balance: booksBefore.client.balance },
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
    // Handoff parcial YA: si la asignacion falla, queda el viaje documentado (assigned=false).
    const handoff: FrS3Handoff = {
      travelId,
      simulated: simulatedAmount,
      booksBefore,
      createdAt: new Date().toISOString(),
      assigned: false,
      driverId: cfg.driverId,
      vehicleId: cfg.vehicleId,
      ownerId
    };
    writeHandoff(handoff);
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
    const created = await flow.readDetail({ travelId });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s3-quote-${travelId}`,
      comment: `FR S3 viaje ${travelId}: alta CASH, cotizacion simulada ${simulatedAmount}.`
    });

    // ---- 3. Asignacion al chofer 4965 (DRIVER.ID) por API del carrier ----
    await assignTravelToDriver({
      carrierApi,
      carrierSession,
      travelId,
      driverUserId: cfg.driverId
    });
    const assigned = await flow.readDetail({ travelId });
    const assignedDb = await readTravelCoreDb(oracle, travelId);
    const nested = assigned.driver;
    const driverInDetail =
      assigned.driverId ??
      (typeof nested === 'object' && nested !== null ? (nested as { id?: unknown }).id : undefined);
    await verifyAc(testInfo, 'AC-FR-04', async () => {
      expect(
        String(assigned.state ?? ''),
        `tras asignar, el viaje ${travelId} no debe estar cancelado ni finalizado`
      ).not.toMatch(/^(CANCELL?ED|7|DONE|6)$/i);
      const v = evaluateDriverAssigned({
        expectedDriverId: cfg.driverId,
        detailDriverId:
          driverInDetail === undefined || driverInDetail === null ? null : Number(driverInDetail),
        core: assignedDb
      });
      expect(v.ok, formatMismatches('chofer 4965 (DRIVER.ID)', v.mismatches)).toBe(true);
      return {
        detailDriverId: driverInDetail ?? null,
        dbDriverId: assignedDb.DRIVER_ID,
        notes: v.notes
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
    knownIssue(
      testInfo,
      'AC-FR-95',
      `viaje ${travelId} asignado a mano: si se cancela antes de cerrarlo, App Driver 2.6.17 conserva la oferta (Firebase huerfano); el cierre por app de este flujo no lo ejercita`
    );
    writeHandoff({ ...handoff, assigned: true });

    await attachJson('3-assigned', {
      travelId,
      handoffFile: HANDOFF_PATH,
      simulatedAmount,
      stateCreated: created.state ?? null,
      stateAssigned: assigned.state ?? null,
      driverIdInDetail: driverInDetail ?? null,
      note: 'Cierre pendiente: lo hace la app del chofer (Appium). Luego correr fr-circuit-s3-verify.'
    });
    console.info(
      `FR_S3_PREPARED ${JSON.stringify({ travelId, simulatedAmount, driverId: cfg.driverId, vehicleId: cfg.vehicleId })}`
    );
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s3-assigned-${travelId}`,
      comment: `FR S3 viaje ${travelId}: asignado al chofer ${cfg.driverId} (estado ${String(assigned.state)}), listo para cierre por app.`
    });
  });
});
