// tests/specs/trips/fr-circuit-s5-auto.spec.ts
// FR S5 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): viaje CASH creado por UI -> cierre ADMIN (cancel +
// finalizeAdmin) -> RENDICION AUTOMATICA (lote B, vehiculo 3765 / propietario 2927 / carrier 1901).
// Este spec tambien es el verificador AUTORITATIVO del lote automatico: S4 (CC + city taxes, cierre por app
// real) comparte la misma fila TRAVELSSURRENDER, asi que `verify` valida los viajes de TODO el handoff.
// Diseno, mecanica y calendario: docs/qa/automation-stock/fr-1901/rendicion-automatica-diseno-2026-10-21.md.
//
// Una corrida = una FASE (FR_AUTO_PHASE) sobre el handoff `evidence/test/fr-auto-handoff.json`:
//   prepare : alta CASH por UI + cierre admin + foto de libros            (gate FR_CIRCUIT_CREATE_TRIP=1)
//   arm     : Carrier V2 Owners > Edit: «Collects Cash» = Vehicle Owner + Update (persiste) (FR_TOGGLE_AUTO_SURRENDER=1)
//   fire    : modo desvincular: V2 Owners > Edit > papelera del vehiculo > modal > PUT travelsSurrender (rinde YA);
//             modo cron: espera el job
//   verify  : lectura DB/API del lote automatico: fila DRIVER_ID NULL, lote exacto, 40/40/20, libros, flag
//   disarm  : «Collects Cash» = Company + Update (persiste; no requiere handoff)  (FR_TOGGLE_AUTO_SURRENDER=1)
// Modo (FR_AUTO_MODE): `desvincular` (default; disparo inmediato por UI) | `cron` (job ~13:10 UTC = 10:10 ART).
// Ambos modos pasan por arm/disarm: el flag del propietario queda en 1 entre ambos.
//
// Requiere ORACLE_*_TEST (los oraculos son DB), ENV=test, FR_* completos y storage state del carrier 1901.
// Sin retries. NO correr `prepare` con el flag del propietario en 1 (el cron barreria el lote a medio armar).
//
// ACs (registro tests/helpers/acceptance.ts), todos aseverados DENTRO de `verifyAc`:
//   prepare : 32, 20 (aislamiento) · 01, 02 (cotizacion) · 14, 15 (cancelacion sin cargo) · 06, 07, 08 (cierre admin)
//   arm     : 41 (lote cerrado + guarda de cron) · 32 (flag/lote previos y flag 1 persistido)
//   fire    : 41 · 32 · 33 (PUT 200 true, firewall vacio) · observacion 45 (modal vs accion real)
//   verify  : 34, 35, 36, 37, 38, 39, 50 · observaciones 42, 43, 44 · known issue 94 (Closed omite DRIVER_ID NULL)
//   disarm  : 40
// Guardas tecnicas fuera de verifyAc: sesion del carrier, handoff duplicado, anti-vacuidad previa a crear,
// esperas (cron / rendicion) y lecturas.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import type { TestInfo } from '@playwright/test';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { knownIssue, observation, verifyAc } from '../../helpers/acceptance.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation, type IsolationReading } from '../../helpers/fr-preflight.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import { COST_SALE_SCOPE_NOTE, evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import {
  describeAgencyNetPaid,
  describeDriverCommissionNotBooked,
  describeSettlementOwner,
  evaluateCurrencyEur,
  evaluateOwnerBookAuto,
  evaluateQuote,
  evaluateVehicleLink,
  readSurrenderObsColumns,
  readVehicleLink
} from '../../helpers/fr-ac-eval-auto-settlement.js';
import {
  autoModeFromEnv,
  autoPhaseFromEnv,
  closedTrips,
  minutesToNextCron,
  openTrips,
  requireAutoHandoff,
  updateAutoHandoff,
  writeAutoHandoff,
  AUTO_HANDOFF_PATH,
  type AutoHandoff,
  type AutoMode,
  type AutoPhase,
  type AutoTrip,
  compareBatchIds,
  evaluateCcChargeOfTrip,
  tddcFormula
} from '../../helpers/auto-surrender.js';
import {
  evaluateSaleCostPairs,
  evaluateSurrenderRow,
  formatMismatches
} from '../../helpers/db-oracle-eval.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  readBooks,
  requireNumberField,
  type FrGateName
} from '../../helpers/fr-circuit.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import { OwnerEditPage } from '../../pages/carrier-v2/owners/OwnerEditPage.js';
import { noChargeCheck } from '../../helpers/no-charge.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { readSaleCostData } from '../../steps/trips/dbOracles.steps.js';
import {
  movementsOfTravel,
  pendingTripIdsOfVehicle,
  readAutoSurrender,
  readOwnerCashCollector,
  surrenderIdsOfTrips,
  type AutoSurrenderDetail
} from '../../steps/trips/autoSurrender.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_KEYS, FR_1901_SCOPE_NOTES } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_KEYS.S5_AUTO_VERIFY;
const PAYMENT_METHOD = 'Cash';
// Patente de la fila del vehiculo en Owners > Edit (QA lead 2026-10-21: Code 1, DNS207 = vehiculo 3765).
const VEHICLE_DOMAIN = (process.env.FR_VEHICLE_DOMAIN?.trim() || 'DNS207').toUpperCase();
const STATE_DONE = /^DONE$/i;
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;

const phase: AutoPhase | null = autoPhaseFromEnv();
let mode: AutoMode = 'desvincular';
let modeError = '';
try {
  mode = autoModeFromEnv();
} catch (e) {
  modeError = (e as Error).message;
}

const GATES: Record<AutoPhase, readonly FrGateName[]> = {
  prepare: ['FR_CIRCUIT_CREATE_TRIP'],
  arm: ['FR_TOGGLE_AUTO_SURRENDER'],
  fire: ['FR_TOGGLE_AUTO_SURRENDER'],
  verify: [],
  disarm: ['FR_TOGGLE_AUTO_SURRENDER']
};

const frGate =
  phase === null
    ? { config: null, reason: 'requiere FR_AUTO_PHASE=prepare|arm|fire|verify|disarm' }
    : modeError
      ? { config: null, reason: modeError }
      : frConfigOrNull(`FR S5 auto (${phase})`, GATES[phase]);

/** Espera maxima de la rendicion (FR_AUTO_WAIT_MS); minimo 2 s (timeout 0 de expect.poll = sin limite). */
const waitMs = (): number => {
  const raw = Number(process.env.FR_AUTO_WAIT_MS?.trim());
  return Number.isFinite(raw) && raw > 2_000 ? raw : 2_000;
};

/**
 * Aislamiento del lote automatico: flag del propietario en el valor esperado y sin viajes ajenos pendientes.
 * `split` (prepare): flag -> AC-32 y viajes ajenos -> AC-20. Sin `split` ambos van a AC-32.
 */
async function verifyAutoIsolation(
  testInfo: TestInfo,
  iso: IsolationReading,
  params: { ownerId: number; vehicleId: number; expectedFlag: 0 | 1; split?: boolean }
): Promise<void> {
  const { ownerId, vehicleId, expectedFlag, split = false } = params;
  const flagCheck = (): void => {
    expect(
      iso.cashCollectorFlag,
      `VEHICLEOWNERS.CASHCOLLECTOR del propietario ${ownerId} debe ser ${expectedFlag} (es ${iso.cashCollectorFlag}). ` +
        'Con 1 el cron de ~13:10 UTC barre este vehiculo y la grilla manual lo oculta.'
    ).toBe(expectedFlag);
  };
  const foreignCheck = (): void => {
    expect(
      iso.foreignTrips,
      `viajes pendientes AJENOS al lote en el vehiculo ${vehicleId}: ${iso.foreignTrips.join(', ')}. Rendirlos (manual) o excluirlos antes de continuar.`
    ).toEqual([]);
  };
  const evidence = {
    ownerId,
    vehicleId,
    expectedFlag,
    flag: iso.cashCollectorFlag,
    foreign: iso.foreignTrips,
    batchRows: iso.batchRows,
    summaryRows: iso.summaryRows
  };
  if (split) {
    await verifyAc(testInfo, 'AC-FR-32', () => {
      flagCheck();
      return evidence;
    });
    await verifyAc(testInfo, 'AC-FR-20', () => {
      foreignCheck();
      return evidence;
    });
    return;
  }
  await verifyAc(testInfo, 'AC-FR-32', () => {
    flagCheck();
    foreignCheck();
    return evidence;
  });
}

test.describe('Circuito Francia S5 auto (cash · cierre admin · rendicion automatica)', () => {
  test.skip(frGate.config === null, `FR S5 auto saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 900_000 });

  test('FR-S5-auto: validar-circuito-francia cash cierre admin y rendicion automatica', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S5 auto');
    const cfg = frConfigOrNull('FR S5 auto', GATES[phase as AutoPhase]).config as FrCircuitConfig;
    // Solo la fase `verify` acredita el Test de Xray; prepare/arm/fire/disarm no llevan key (fr-1901-keys.ts).
    if (phase === 'verify') {
      makeAnnotate(TS_KEY, ROUTE)('FR-S5-auto-verify', 'HP');
      testInfo.annotations.push({
        type: 'xray_comment',
        description: FR_1901_SCOPE_NOTES.S5_AUTO_VERIFY
      });
    } else {
      testInfo.annotations.push({ type: 'tc', description: `FR-S5-auto-${phase}` });
    }
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const isolationOf = (ownTripIds: readonly number[]): Promise<IsolationReading> =>
      readIsolation({
        surrender: surrenderClient,
        batch: { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId },
        db: oracle,
        ownerId,
        ownTripIds
      });
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });
    expect(
      carrierSession.carrierId,
      `la sesion guardada debe ser del carrier ${expectedCarrier} (regenerar storage state con USER_CARRIER_FR)`
    ).toBe(expectedCarrier);

    const seed = async (): Promise<AutoHandoff> => ({
      createdAt: new Date().toISOString(),
      carrierId: expectedCarrier,
      ownerId,
      vehicleId: cfg.vehicleId,
      driverId: cfg.driverId,
      booksBefore: await readBooks(checkingAccountApi, cfg, ownerId),
      ownerCashCollectorBefore: await readOwnerCashCollector(oracle, ownerId),
      mode,
      trips: {}
    });
    // El `page` del fixture ya trae la sesion V2 del carrier 1901 (storage state).
    const ownerEdit = async () => {
      const editPage = new OwnerEditPage(page);
      await editPage.goto(ownerId);
      return editPage;
    };

    // ============================ prepare ============================
    if (phase === 'prepare') {
      const existing = (() => {
        try {
          return requireAutoHandoff();
        } catch {
          return null;
        }
      })();
      expect(
        existing?.trips.S5,
        `ya hay un S5 en ${AUTO_HANDOFF_PATH} (viaje ${existing?.trips.S5?.travelId}); borrar el archivo para armar otro lote`
      ).toBeUndefined();
      const ownTripIds = existing
        ? Object.values(existing.trips).map((t) => (t as AutoTrip).travelId)
        : [];
      const iso = await isolationOf(ownTripIds);
      await verifyAutoIsolation(testInfo, iso, {
        ownerId,
        vehicleId: cfg.vehicleId,
        expectedFlag: 0,
        split: true
      });
      // Precondicion de configuracion: prepare exige flag 0 (verificado en AC-FR-32), asi que no bloquea;
      // si el flag fuera 1 en la ventana del cron el lote se barreria a medio armar.
      assertOutsideCronWindow({ cashCollectorFlag: iso.cashCollectorFlag });
      await attachJson('1-preconditions', { carrierId: carrierSession.carrierId, mode, ...iso });
      const base = existing ?? (await seed());

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
      writeAutoHandoff({
        ...base,
        trips: {
          ...base.trips,
          S5: {
            scenario: 'S5',
            travelId,
            paymentMethod: 'CASH',
            simulated: simulatedAmount,
            closedBy: 'admin',
            assigned: false
          }
        }
      });
      await verifyAc(testInfo, 'AC-FR-01', () => {
        const quote = evaluateQuote(simulatedAmount, process.env.FR_EXPECTED_QUOTE);
        expect(quote.ok, formatMismatches('cotizacion S5', quote.mismatches)).toBe(true);
        return { simulatedAmount, expectedQuote: process.env.FR_EXPECTED_QUOTE?.trim() ?? null };
      });
      await verifyAc(testInfo, 'AC-FR-02', async () => {
        const cur = evaluateCurrencyEur(await flow.readDetail({ travelId }));
        expect(cur.ok, formatMismatches('moneda S5', cur.mismatches)).toBe(true);
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
        name: `fr-s5-quote-${travelId}`,
        comment: `FR S5 viaje ${travelId}: alta CASH, cotizacion ${simulatedAmount}.`
      });

      await flow.cancel({ travelId });
      const cancelled = await flow.readDetail({ travelId });
      await verifyAc(testInfo, 'AC-FR-14', () => {
        expect(String(cancelled.state ?? ''), 'tras cancelar el estado debe ser CANCELLED').toMatch(
          STATE_CANCELLED
        );
        return { state: cancelled.state ?? null };
      });
      await verifyAc(testInfo, 'AC-FR-15', () => {
        const noCharge = noChargeCheck(cancelled);
        expect(
          noCharge.hasAmountField,
          'el detalle debe exponer el campo amount (un campo ausente no prueba «sin cargo»)'
        ).toBe(true);
        expect(
          noCharge.isNoCharge,
          `la cancelacion sin cargo debe dejar amount null o 0 explicito (recibido: ${String(noCharge.amount)})`
        ).toBe(true);
        return { amount: noCharge.amount ?? null };
      });
      await travelsApi.finalizeAdmin({ travelId, driverId: cfg.driverId });
      const done = await flow.readDetail({ travelId });
      const finalPrice = round2(Number(done.amount));
      await verifyAc(testInfo, 'AC-FR-06', () => {
        expect(String(done.state ?? ''), 'finalizeAdmin debe dejar el viaje DONE').toMatch(
          STATE_DONE
        );
        return { state: done.state ?? null };
      });
      await verifyAc(testInfo, 'AC-FR-07', () => {
        expect(finalPrice, 'cierre admin sin cambios: precio final = simulado').toBe(
          round2(simulatedAmount)
        );
        return { simulatedAmount, finalPrice };
      });
      const costSale = evaluateCostEqualsSale({
        detail: done,
        label: `FR S5 trip ${travelId}`,
        expectOtherCost: false
      });
      await verifyAc(testInfo, 'AC-FR-08', async () => {
        expect(costSale.ok, costSale.message).toBe(true);
        const dbData = await readSaleCostData(oracle, travelId);
        const dbPairs = evaluateSaleCostPairs(travelId, dbData.row, dbData.items);
        expect(
          dbPairs.ok,
          formatMismatches(`pares costo/venta DB viaje ${travelId}`, dbPairs.mismatches)
        ).toBe(true);
        return { apiPairs: costSale.pairs, dbSource: dbPairs.source, dbNotes: dbPairs.notes };
      });
      testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });
      updateAutoHandoff(
        (h) => ({
          ...h,
          trips: {
            ...h.trips,
            S5: {
              ...(h.trips.S5 as AutoTrip),
              assigned: true,
              closed: {
                finalPrice,
                cityTax: 0,
                tolls: requireNumberField(done, FR_FACTS.detailFields.toll.value),
                parking: requireNumberField(done, FR_FACTS.detailFields.parking.value),
                closedAt: new Date().toISOString()
              }
            }
          }
        }),
        () => base
      );
      await attachJson('2-closed', {
        travelId,
        state: done.state,
        finalPrice,
        costSalePairs: costSale.pairs
      });
      console.info(
        `FR_S5_PREPARED ${JSON.stringify({ travelId, finalPrice, handoff: AUTO_HANDOFF_PATH })}`
      );
      return;
    }

    // ============================= disarm ============================
    // No necesita handoff (sirve tambien para revertir un flag armado a mano).
    if (phase === 'disarm') {
      const editPage = await ownerEdit();
      const { saveStatus, alreadyAtTarget } = await editPage.setCollectsCash('company', {
        persist: true,
        ownerId
      });
      await attachXrayEvidence(testInfo, page, {
        name: `fr-auto-disarmed-owner-${ownerId}`,
        comment: `FR auto: propietario ${ownerId} con «Collects Cash» = Company (revertido).`
      });
      await verifyAc(testInfo, 'AC-FR-40', async () => {
        if (alreadyAtTarget) {
          expect(saveStatus, 'sin cambio de formulario no hay PUT').toBeNull();
        } else {
          expect(
            saveStatus,
            'PUT del propietario debe responder 2xx (400 = hay viajes pendientes de rendir)'
          ).toBeLessThan(300);
        }
        const flag = await readOwnerCashCollector(oracle, ownerId);
        expect(flag, 'CASHCOLLECTOR en DB tras revertir').toBe(0);
        return { ownerId, saveStatus, alreadyAtTarget, flag };
      });
      return;
    }

    // Las demas fases parten del handoff.
    const handoff = requireAutoHandoff();
    const closed = closedTrips(handoff);
    const open = openTrips(handoff);
    const tripIds = closed.map((t) => t.travelId);

    // ============================== arm ==============================
    if (phase === 'arm') {
      await verifyAc(testInfo, 'AC-FR-41', () => {
        expect(
          open,
          `viajes del lote sin cerrar (el cron los dejaria para otro dia): ${open.map((t) => `${t.scenario}:${t.travelId}`).join(', ')}`
        ).toEqual([]);
        const minutes = minutesToNextCron(new Date());
        if (mode === 'desvincular') {
          // Con el flag en 1 y viajes pendientes, el job de las 13:10 UTC barreria el lote: no armar cerca.
          expect(
            minutes,
            'el cron (13:10 UTC) corre en menos de 20 min: armar y disparar despues'
          ).toBeGreaterThan(20);
        }
        return { mode, minutesToNextCron: minutes, closedTrips: tripIds };
      });
      await verifyAutoIsolation(testInfo, await isolationOf(tripIds), {
        ownerId,
        vehicleId: cfg.vehicleId,
        expectedFlag: 0
      });
      const editPage = await ownerEdit();
      const { saveStatus, alreadyAtTarget } = await editPage.setCollectsCash('owner', {
        persist: true,
        ownerId
      });
      await attachXrayEvidence(testInfo, page, {
        name: `fr-auto-armed-owner-${ownerId}`,
        comment: `FR auto: propietario ${ownerId} con «Collects Cash» = Vehicle Owner (modo ${mode}). Proximo cron en ${minutesToNextCron(new Date())} min (13:10 UTC).`
      });
      await verifyAc(testInfo, 'AC-FR-32', async () => {
        if (alreadyAtTarget) {
          expect(saveStatus, 'sin cambio de formulario no hay PUT').toBeNull();
        } else {
          expect(saveStatus, 'PUT del propietario debe responder 2xx').toBeLessThan(300);
        }
        const flag = await readOwnerCashCollector(oracle, ownerId);
        expect(flag, 'CASHCOLLECTOR en DB tras guardar (armado)').toBe(1);
        return { ownerId, saveStatus, alreadyAtTarget, flagAfterArm: flag };
      });
      writeAutoHandoff({ ...handoff, armedAt: new Date().toISOString() });
      return;
    }

    // ============================== fire =============================
    if (phase === 'fire') {
      await verifyAc(testInfo, 'AC-FR-41', () => {
        expect(
          open,
          `viajes del lote sin cerrar: ${open.map((t) => `${t.scenario}:${t.travelId}`).join(', ')}`
        ).toEqual([]);
        return { closedTrips: tripIds };
      });
      const iso = await isolationOf(tripIds);
      await verifyAutoIsolation(testInfo, iso, {
        ownerId,
        vehicleId: cfg.vehicleId,
        expectedFlag: 1
      });
      if (mode === 'cron') {
        await expect
          .poll(
            async () =>
              [...(await surrenderIdsOfTrips(oracle, tripIds)).values()].every((v) => v !== null),
            {
              timeout: waitMs(),
              intervals: [30_000],
              message: `la rendicion automatica no corrio todavia; el job corre ~13:10 UTC (en ${minutesToNextCron(new Date())} min). Reintentar con FR_AUTO_WAIT_MS o correr verify mas tarde.`
            }
          )
          .toBe(true);
        return;
      }
      const pending = await pendingTripIdsOfVehicle(oracle, cfg.vehicleId);
      await verifyAc(testInfo, 'AC-FR-32', () => {
        expect(
          [...pending].sort(),
          `el lote pendiente del vehiculo debe ser exactamente el del handoff (${tripIds.join(', ')})`
        ).toEqual([...tripIds].sort());
        return { pending, handoffBatch: tripIds };
      });
      const firedAt = new Date().toISOString();
      const editPage = await ownerEdit();
      expect(
        await editPage.readCollectsCash(),
        'el editor debe cargar «Collects Cash» = Vehicle Owner (armar primero con FR_AUTO_PHASE=arm)'
      ).toBe('owner');
      const result = await editPage.triggerVehicleSurrender({
        vehicleId: cfg.vehicleId,
        carrierId: expectedCarrier,
        domain: VEHICLE_DOMAIN
      });
      await attachJson('fire-result', result);
      await attachXrayEvidence(testInfo, page, {
        name: `fr-auto-surrender-vehicle-${cfg.vehicleId}`,
        comment: `FR auto: papelera del vehiculo ${VEHICLE_DOMAIN} (${cfg.vehicleId}) en Owners > Edit, modal ${result.modalVariant}, PUT travelsSurrender ${result.putStatus}.`
      });
      await verifyAc(testInfo, 'AC-FR-33', () => {
        expect(result.blocked, 'el firewall no debe haber abortado ningun request').toEqual([]);
        expect(result.putStatus, 'PUT travelsSurrender debe responder 200').toBe(200);
        expect(result.putBody, 'el PUT devuelve `true`').toBe(true);
        return { putStatus: result.putStatus, putBody: result.putBody, blocked: result.blocked };
      });
      const linkAfterFire = await readVehicleLink(oracle, cfg.vehicleId);
      observation(
        testInfo,
        'AC-FR-45',
        `modal ${result.modalVariant}: «${result.modalText}»; accion real: PUT travelsSurrender ${result.putStatus} (rinde sin desvincular); ` +
          `vinculos DRIVER_VEHICLES del vehiculo ${cfg.vehicleId} tras el PUT: ${JSON.stringify(linkAfterFire.links)}. Pregunta abierta al PO (texto del modal vs accion).`
      );
      await editPage.leaveWithoutSaving();
      writeAutoHandoff({ ...handoff, mode: 'desvincular', armedAt: firedAt });
      return;
    }

    // ============================= verify ============================
    await expect
      .poll(
        async () =>
          [...(await surrenderIdsOfTrips(oracle, tripIds)).values()].every((v) => v !== null),
        {
          timeout: waitMs(),
          intervals: [30_000],
          message: `la rendicion automatica de ${tripIds.join(', ')} aun no existe (modo ${mode}); fire/cron pendiente.`
        }
      )
      .toBe(true);
    const data = await readAutoSurrender({ db: oracle, handoff, trips: closed });
    const { expected, bySurrender, distinctSurrenderIds } = data;

    // AC-34: una sola rendicion con exactamente los viajes cerrados del lote.
    await verifyAc(testInfo, 'AC-FR-34', () => {
      expect(
        open,
        `viajes del lote sin cerrar: ${open.map((t) => `${t.scenario}:${t.travelId}`).join(', ')}. Cerrar S4 (app) y correr fr-circuit-s4-auto-verify antes.`
      ).toEqual([]);
      const missingTrips = expected.travelIds.filter((id) => !bySurrender.has(id));
      expect(
        missingTrips,
        `viajes ausentes de TRAVEL/TRAVEL_HISTORY: ${missingTrips.join(', ')}`
      ).toEqual([]);
      expect(
        distinctSurrenderIds,
        `los viajes ${expected.travelIds.join(', ')} deben pertenecer a UNA rendicion (TRAVELSSURRENDER_ID por viaje: ${JSON.stringify([...bySurrender])}); null = todavia sin rendir`
      ).toHaveLength(1);
      expect(
        distinctSurrenderIds[0],
        'TRAVELSSURRENDER_ID nulo: la rendicion automatica aun no corrio'
      ).not.toBeNull();
      const found = data.detail as AutoSurrenderDetail;
      const mismatch = compareBatchIds(found.tripIds, expected.travelIds);
      expect(
        mismatch,
        `lote de la rendicion ${found.surrenderId} distinto del esperado: ${mismatch}`
      ).toBeNull();
      return { surrenderId: found.surrenderId, batch: found.tripIds, expected: expected.travelIds };
    });
    const detail = data.detail as AutoSurrenderDetail;
    const { surrenderId, header, ownerBookRows } = detail;

    // AC-35: cabecera de la rendicion automatica.
    await verifyAc(testInfo, 'AC-FR-35', () => {
      expect(
        header.DRIVER_ID,
        `la rendicion ${surrenderId} debe ser AUTOMATICA (DRIVER_ID NULL); recibido ${header.DRIVER_ID}`
      ).toBeNull();
      expect(header.VEHICLE_ID, 'vehiculo de la rendicion').toBe(handoff.vehicleId);
      expect(header.VEHICLEOWNERID, 'propietario de la rendicion').toBe(handoff.ownerId);
      expect(header.CARRIER_ID, 'carrier de la rendicion').toBe(handoff.carrierId);
      return { ...header };
    });

    // AC-36: columnas de comision 40/40/20 de la fila.
    await verifyAc(testInfo, 'AC-FR-36', () => {
      const rowVerdict = evaluateSurrenderRow(detail.row, expected.row);
      expect(
        rowVerdict.ok,
        formatMismatches(`rendicion ${surrenderId}`, rowVerdict.mismatches)
      ).toBe(true);
      return { expected: expected.row, actual: detail.row };
    });

    // AC-37: libro del propietario (TDCV efectivo, TDDC CC) y vista API por origin.
    const hasCc = expected.row.TOTALCHECKACCQTY > 0;
    const tddc = hasCc ? tddcFormula(header) : null;
    const booksAfter = await readBooks(checkingAccountApi, cfg, ownerId);
    const ownerRowsApi = (await checkingAccountApi.ownerMovements({ ownerId })).rows.filter(
      (r) => header.IDFORCARRIER !== null && String(r.origin) === String(header.IDFORCARRIER)
    );
    let ownerBookByCode: Record<string, number> = {};
    await verifyAc(testInfo, 'AC-FR-37', () => {
      const v = evaluateOwnerBookAuto({
        rows: ownerBookRows,
        expectedTdcv: expected.ownerBook.TDCV,
        hasCc,
        tddcExpected: tddc?.expected ?? null
      });
      ownerBookByCode = v.byCode;
      expect(
        v.ok,
        formatMismatches(`libro propietario rendicion ${surrenderId}`, v.mismatches)
      ).toBe(true);
      // TODO(verificar en TEST): `origin` del libro API = IDFORCARRIER de la rendicion (asi lo usan S1/S2/S3).
      expect
        .soft(
          ownerRowsApi,
          'filas del libro del propietario (API, por origin) = filas DB por TRAVELSSURRENDER_ID'
        )
        .toHaveLength(ownerBookRows.length);
      return {
        byCode: v.byCode,
        tddc: tddc === null ? null : { ...tddc, actual: v.byCode.TDDC ?? null },
        dbRows: ownerBookRows.length,
        apiRows: ownerRowsApi.length
      };
    });
    if (tddc?.doubleCountSuspect) {
      observation(
        testInfo,
        'AC-FR-42',
        'OWNER_CHECK_ACC_COMM = CHECKINGACCOUNTCOMMISSION: el TDDC duplicaria la comision del propietario (regla sin confirmar).'
      );
    }

    // AC-38: el libro del chofer no recibe filas de la rendicion automatica.
    await verifyAc(testInfo, 'AC-FR-38', () => {
      expect(
        detail.driverBookRows,
        `la rendicion automatica no debe generar movimientos en el libro del chofer (CHECKINGACCOUNTFORDRIVER por TRAVELSSURRENDER_ID ${surrenderId})`
      ).toBe(0);
      return { driverBookRows: detail.driverBookRows };
    });

    // AC-39: el vehiculo sigue vinculado y queda sin pendientes.
    await verifyAc(testInfo, 'AC-FR-39', async () => {
      expect(
        detail.pendingAfter,
        `el vehiculo ${handoff.vehicleId} debe quedar sin viajes pendientes`
      ).toEqual([]);
      const link = await readVehicleLink(oracle, handoff.vehicleId);
      const v = evaluateVehicleLink({
        links: link.links,
        vehicleOwnerId: link.vehicleOwnerId,
        expected: {
          driverId: handoff.driverId,
          vehicleId: handoff.vehicleId,
          ownerId: handoff.ownerId
        }
      });
      expect(
        v.ok,
        formatMismatches(`vinculo del vehiculo ${handoff.vehicleId}`, v.mismatches)
      ).toBe(true);
      return {
        pendingAfter: detail.pendingAfter,
        links: link.links,
        vehicleOwnerId: link.vehicleOwnerId
      };
    });

    // AC-50: los viajes CC del lote conservan UN cobro TIVR AUTOMATIC tras rendir.
    const ccTrips = closed.filter((t) => t.paymentMethod === 'CHECKING_ACCOUNT');
    if (ccTrips.length > 0) {
      await verifyAc(testInfo, 'AC-FR-50', async () => {
        const perTrip: Array<{ travelId: number; movementId: number | null }> = [];
        for (const t of ccTrips) {
          const v = evaluateCcChargeOfTrip(
            await movementsOfTravel(oracle, cfg.ccId, t.travelId),
            t
          );
          expect(
            v.ok,
            formatMismatches(`cobro CC del viaje ${t.travelId} tras la rendicion`, v.mismatches)
          ).toBe(true);
          perTrip.push({ travelId: t.travelId, movementId: v.movement?.ID ?? null });
        }
        return { perTrip };
      });
    }

    // Observaciones al PO (no se aseveran) y known issue del reporte Closed.
    const obsColumns = await readSurrenderObsColumns(oracle, surrenderId);
    observation(
      testInfo,
      'AC-FR-42',
      describeDriverCommissionNotBooked({
        expectedDriverCommission: round2(
          expected.commissions.cash.driver + expected.commissions.checkingAccount.driver
        ),
        driverBookRows: detail.driverBookRows,
        ownerBookByCode
      })
    );
    observation(testInfo, 'AC-FR-43', describeAgencyNetPaid(obsColumns));
    observation(testInfo, 'AC-FR-44', describeSettlementOwner(surrenderId, obsColumns));
    knownIssue(
      testInfo,
      'AC-FR-94',
      `H-AUTO-04: la rendicion automatica ${surrenderId} (DRIVER_ID NULL) no figura en Closed surrenders; se contrasta en el spec de reportes (R2).`
    );
    const verification = {
      surrenderId,
      idForCarrier: header.IDFORCARRIER,
      expected,
      row: detail.row,
      ownerBookByCode,
      driverBookRows: detail.driverBookRows,
      tddc
    };
    const flagAfter = await readOwnerCashCollector(oracle, ownerId);
    // El flag queda en 1 hasta correr `disarm` (se informa en verify-summary, no se afirma aqui).
    await attachJson('verify-summary', {
      surrenderId: verification.surrenderId,
      idForCarrier: verification.idForCarrier,
      trips: closed.map((t) => ({
        scenario: t.scenario,
        travelId: t.travelId,
        finalPrice: t.closed?.finalPrice
      })),
      expected: verification.expected,
      row: verification.row,
      ownerBookByCode: verification.ownerBookByCode,
      driverBookRows: verification.driverBookRows,
      tddc: verification.tddc,
      ownerBookApiRows: ownerRowsApi.length,
      driverBalanceBefore: handoff.booksBefore.driver.balance,
      driverBalanceAfter: booksAfter.driver.balance,
      ownerBalanceBefore: handoff.booksBefore.owner.balance,
      ownerBalanceAfter: booksAfter.owner.balance,
      flagBefore: handoff.ownerCashCollectorBefore,
      flagAfter
    });
    console.info(
      `FR_AUTO_SUMMARY ${JSON.stringify({ surrenderId: verification.surrenderId, trips: tripIds })}`
    );
    writeAutoHandoff({ ...handoff, surrenderId: verification.surrenderId });
  });
});
