// tests/specs/trips/fr-circuit-s4-auto-prepare.spec.ts
// FR S4, parte 1/2 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): viaje CC (Luis, CC 5614 EUR) con otro costo
// «QA City Taxes» (10 %, comisionable) -> asignacion al chofer 4965 / vehiculo 3765 -> handoff
// `evidence/test/fr-auto-handoff.json`. NO finaliza: el cierre lo hace la APP REAL del chofer (Appium,
// repo mpw-fr: tests/mobile/appium/scripts/fr-driver-s3-closure.ts, mismo flujo que S3; el harness lee el
// medio de pago del resumen). Despues: fr-circuit-s4-auto-verify (cierre) y fr-circuit-s5-auto (disparo/verify).
//
// Gate: FR_CIRCUIT_CREATE_TRIP=1 (viaje PERMANENTE; debito en la CC al cerrar). Requiere ORACLE_*_TEST.
// Aislamiento: el flag del propietario debe ser 0 y el vehiculo sin pendientes ajenos al lote. Sin retries.
// ACs (registro tests/helpers/acceptance.ts): 32, 20 (aislamiento), 01, 03, 02 (cotizacion), 46 (CC al crear),
// 04 (chofer, DB), 05 (viaje abierto fuera del lote, DB + API); 95 = known issue anotado.
// Las aserciones de negocio viven dentro de `verifyAc`; las guardas tecnicas (sesion, handoff duplicado,
// anti-vacuidad previa a crear) quedan fuera.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { assignTravelToDriver } from '../../api/clients/driverTravels.client.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { knownIssue, observation, verifyAc } from '../../helpers/acceptance.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import {
  AUTO_HANDOFF_PATH,
  autoModeFromEnv,
  readAutoHandoff,
  writeAutoHandoff,
  type AutoHandoff,
  type AutoTrip
} from '../../helpers/auto-surrender.js';
import {
  evaluateCityTaxSummary,
  evaluateCurrencyEur,
  evaluateDriverAssignment,
  evaluateQuote,
  evaluateTripAbsentFromBatch,
  formatMismatches,
  readTravelDriverId
} from '../../helpers/fr-ac-eval-auto-settlement.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  readBooks
} from '../../helpers/fr-circuit.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import {
  pendingTripIdsOfVehicle,
  readOwnerCashCollector
} from '../../steps/trips/autoSurrender.steps.js';
import { parseMoney } from '../../utils/money.js';

const PAYMENT_METHOD = process.env.FR_CC_PAYMENT_METHOD?.trim() || 'Credit Account';
const CITY_TAX_PCT = 0.1;

const frGate = frConfigOrNull('FR S4 auto prepare', ['FR_CIRCUIT_CREATE_TRIP']);

test.describe('Circuito Francia S4 auto prepare (CC + city taxes, alta y asignacion)', () => {
  test.skip(frGate.config === null, `FR S4 auto prepare saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('FR-S4-auto-prepare: validar-circuito-francia alta CC con city taxes y asignacion para cierre por app', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S4 auto prepare');
    const cfg = frGate.config as FrCircuitConfig;
    // Sin key de Xray a proposito: prepara datos; el veredicto lo da su `verify` (fr-1901-keys.ts).
    testInfo.annotations.push({ type: 'tc', description: 'FR-S4-auto-prepare' });
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });

    // ---- 1. Precondiciones: sesion, S4 no duplicado, aislamiento del vehiculo ----
    expect(
      carrierSession.carrierId,
      `la sesion guardada debe ser del carrier ${expectedCarrier} (regenerar storage state con USER_CARRIER_FR)`
    ).toBe(expectedCarrier);
    const existing = readAutoHandoff();
    expect(
      existing?.trips.S4,
      `ya hay un S4 en ${AUTO_HANDOFF_PATH} (viaje ${existing?.trips.S4?.travelId}); borrar el archivo para armar otro lote`
    ).toBeUndefined();
    const ownTripIds = existing
      ? Object.values(existing.trips).map((t) => (t as AutoTrip).travelId)
      : [];
    const iso = await readIsolation({
      surrender: new SurrenderClient(carrierApi, carrierSession),
      batch: { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId },
      db: oracle,
      ownerId,
      ownTripIds
    });
    await verifyAc(testInfo, 'AC-FR-32', () => {
      expect(
        iso.cashCollectorFlag,
        `VEHICLEOWNERS.CASHCOLLECTOR del propietario ${ownerId} debe ser 0 (es ${iso.cashCollectorFlag}). ` +
          'Con 1 el cron de ~13:10 UTC barre este vehiculo y la grilla manual lo oculta.'
      ).toBe(0);
      return { ownerId, flag: iso.cashCollectorFlag, foreign: iso.foreignTrips };
    });
    await verifyAc(testInfo, 'AC-FR-20', () => {
      expect(
        iso.foreignTrips,
        `viajes pendientes AJENOS al lote en el vehiculo ${cfg.vehicleId}: ${iso.foreignTrips.join(', ')}. Rendirlos (manual) o excluirlos antes de continuar.`
      ).toEqual([]);
      return { vehicleId: cfg.vehicleId, foreign: iso.foreignTrips, ownTripIds };
    });
    const base: AutoHandoff = existing ?? {
      createdAt: new Date().toISOString(),
      carrierId: expectedCarrier,
      ownerId,
      vehicleId: cfg.vehicleId,
      driverId: cfg.driverId,
      booksBefore: await readBooks(checkingAccountApi, cfg, ownerId),
      ownerCashCollectorBefore: await readOwnerCashCollector(oracle, ownerId),
      mode: autoModeFromEnv(),
      trips: {}
    };
    await attachJson('1-preconditions', {
      carrierId: carrierSession.carrierId,
      ccId: cfg.ccId,
      ...iso
    });

    // ---- 2. Alta por UI: Luis, pago CC, otro costo «QA City Taxes» ----
    const { travelId, simulatedAmount, summary } = await flow.createViaUi({
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
    });
    // Handoff parcial YA: si la asignacion falla queda el viaje documentado (assigned=false).
    const trip: AutoTrip = {
      scenario: 'S4',
      travelId,
      paymentMethod: 'CHECKING_ACCOUNT',
      simulated: simulatedAmount,
      closedBy: 'app',
      assigned: false
    };
    writeAutoHandoff({ ...base, trips: { ...base.trips, S4: trip } });

    const subtotal = parseMoney(summary.subtotal);
    const cityTaxLine = summary.lines.find((l) => l.label.startsWith(cfg.otherCostName));
    const cityTax = cityTaxLine === undefined ? 0 : parseMoney(cityTaxLine.amount);
    await verifyAc(testInfo, 'AC-FR-01', () => {
      const quote = evaluateQuote(simulatedAmount, process.env.FR_EXPECTED_QUOTE);
      expect(quote.ok, formatMismatches('cotizacion S4', quote.mismatches)).toBe(true);
      return { simulatedAmount, expectedQuote: process.env.FR_EXPECTED_QUOTE?.trim() ?? null };
    });
    await verifyAc(testInfo, 'AC-FR-03', () => {
      expect(
        cityTaxLine,
        `el resumen debe listar la linea del otro costo «${cfg.otherCostName}» (lineas: ${JSON.stringify(summary.lines.map((l) => l.label))})`
      ).toBeDefined();
      const v = evaluateCityTaxSummary({
        base: subtotal,
        cityTaxLineAmount: cityTaxLine === undefined ? null : cityTax,
        otherCostsHeader: parseMoney(summary.otherCosts),
        fixedFees: summary.fixedFees === null ? 0 : parseMoney(summary.fixedFees),
        taxes: summary.taxes === null ? 0 : parseMoney(summary.taxes),
        simulatedTotal: simulatedAmount,
        pct: CITY_TAX_PCT
      });
      expect(v.ok, formatMismatches('resumen city taxes S4', v.mismatches)).toBe(true);
      return { subtotal, cityTax, total: simulatedAmount };
    });
    await verifyAc(testInfo, 'AC-FR-02', async () => {
      const created = await flow.readDetail({ travelId });
      const cur = evaluateCurrencyEur(created);
      expect(cur.ok, formatMismatches('moneda S4', cur.mismatches)).toBe(true);
      if (!cur.verified) {
        observation(
          testInfo,
          'AC-FR-02',
          'el detalle no expone simulationPrice.currencyCode: EUR sin verificar por API (ver captura de la cotizacion).'
        );
      }
      return { currency: cur.currency, verifiedByApi: cur.verified };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s4-quote-${travelId}`,
      comment: `FR S4 viaje ${travelId}: alta CC con «${cfg.otherCostName}», base ${subtotal}, city taxes ${cityTax}, total ${simulatedAmount}.`
    });

    // ---- 3. Al crear la CC NO tiene movimientos del viaje (el debito es al cerrar) ----
    await verifyAc(testInfo, 'AC-FR-46', async () => {
      const ccRows = await checkingAccountApi.movementsByTravel({
        travelId,
        checkingAccountId: cfg.ccId
      });
      expect(
        ccRows,
        `la CC ${cfg.ccId} no debe tener movimientos del viaje ${travelId} al crear`
      ).toHaveLength(0);
      return { ccId: cfg.ccId, rows: ccRows.length };
    });

    // ---- 4. Asignacion al chofer 4965 (DRIVER.ID) por API del carrier ----
    await assignTravelToDriver({
      carrierApi,
      carrierSession,
      travelId,
      driverUserId: cfg.driverId
    });
    const assigned = await flow.readDetail({ travelId });
    await verifyAc(testInfo, 'AC-FR-04', async () => {
      expect(
        String(assigned.state ?? ''),
        `tras asignar, el viaje ${travelId} no debe estar cancelado ni finalizado`
      ).not.toMatch(/^(CANCELL?ED|7|DONE|6)$/i);
      const v = evaluateDriverAssignment({
        expectedDriverId: cfg.driverId,
        dbDriverId: await readTravelDriverId(oracle, travelId),
        detailDriverId: assigned.driverId
      });
      expect(v.ok, formatMismatches(`chofer del viaje ${travelId}`, v.mismatches)).toBe(true);
      // TODO(verificar en TEST): nombre del campo del chofer en el detalle; sin el, el oraculo es TRAVEL.DRIVER_ID.
      return { expectedDriverId: cfg.driverId, apiChecked: v.apiChecked };
    });
    await verifyAc(testInfo, 'AC-FR-05', async () => {
      const dbPending = await pendingTripIdsOfVehicle(oracle, cfg.vehicleId);
      const apiBatch = await new SurrenderClient(carrierApi, carrierSession).preview({
        driverUserId: cfg.driverId,
        vehicleId: cfg.vehicleId
      });
      const apiBatchIds = apiBatch.rows.map((r) => r.travelId);
      const v = evaluateTripAbsentFromBatch({ travelId, dbPending, apiBatchIds });
      expect(v.ok, formatMismatches(`lote con el viaje ${travelId} abierto`, v.mismatches)).toBe(
        true
      );
      return { dbPending, apiBatchIds };
    });
    knownIssue(
      testInfo,
      'AC-FR-95',
      'App Driver 2.6.17 conserva la oferta de un viaje cancelado asignado a mano (Firebase huerfano): este spec no cancela; si el viaje S4 se cancela tras asignar, el cierre por app puede tomar la oferta vieja.'
    );
    writeAutoHandoff({ ...base, trips: { ...base.trips, S4: { ...trip, assigned: true } } });
    await attachJson('4-assigned', {
      travelId,
      handoffFile: AUTO_HANDOFF_PATH,
      state: assigned.state ?? null,
      cityTax,
      simulatedAmount,
      next:
        'Cerrar en el emulador (repo mpw-fr): ENV_FILE=.env.emulator-test-fr EXPECTED_TRAVEL_ID=' +
        `${travelId} pnpm exec ts-node --esm tests/mobile/appium/scripts/fr-driver-s3-closure.ts ` +
        '(FR_RESUME_TO_START=1 si el viaje ya fue aceptado). Luego fr-circuit-s4-auto-verify.'
    });
    console.info(
      `FR_S4_PREPARED ${JSON.stringify({ travelId, simulatedAmount, cityTax, driverId: cfg.driverId })}`
    );
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s4-assigned-${travelId}`,
      comment: `FR S4 viaje ${travelId}: asignado al chofer ${cfg.driverId}, listo para cierre por app.`
    });
  });
});
