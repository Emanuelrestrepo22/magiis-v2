// tests/specs/trips/commission-base.spec.ts
// TM-1432 · MG-1537 AC3 · PK-B (plan docs/plans/PK-B-circuito-admin-chofer-2026-10-21.md §3.1):
// «Validar que la comision de chofer y dueno se calcule sin la parte no comisionable».
//
// Flujo por fila: alta por UI («Enviar Manual», nunca «A») -> cancel + finalizeAdmin por API (cierre
// admin, irreversible: el viaje queda DONE) -> detalle (API) + DB (FINALPRICEI, TRAVEL) -> vista previa
// del lote en «Cierres de Caja» (GET toSurrend por API, y la pantalla de confirmacion abierta SOLO para
// observar y capturar). NUNCA se confirma la rendicion (el POST es irreversible): el spec cuenta
// cualquier POST a toTravelsSurrender y exige 0.
//
// Oraculo: `evaluateCommissionBase` (helpers/commission-base.ts) = el AC ORIGINAL (los no comisionables NO
// entran a la base de comision). La decision D-17/10 (Nayla) los dejo «comportandose como comisionables»;
// esa desviacion esta pendiente de confirmar con el QA lead: se registra como `observation`, no como
// known-issue, y el oraculo no se acomoda a ella.
//
// Alcance acreditable: UI (apertura sin confirmar) + API + DB. NO acredita `[Chofer]` (la comision de la
// tarjeta «¡Viaje Asignado!» sale de getDriverCommissionsInfo por push, sin API de lectura): sigue en el
// run manual.
//
// Gate ADMIN_CIRCUIT_CREATE_TRIP=1 (cada test crea un viaje que termina DONE, anotado en el ledger
// `admin-circuit`). Requiere ADMIN_FINALIZE_DRIVER_ID (DRIVER.ID del chofer con comision > 0, TEST: 4987),
// PKB_SURRENDER_VEHICLE_ID (su vehiculo, TEST: 3265) y ORACLE_*_TEST. Sin retries.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  COMMISSION_BASE_ROWS,
  type CommissionBaseRow
} from '../../data/carrier-v2/trips/commission-base.js';
import { evaluateCommissionBase, expectedCommissionPcts } from '../../helpers/commission-base.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import {
  createTripViaUi,
  readCommissionConfig,
  readCommissionDbPrice,
  readCommissionTravelDb,
  readOpenTripsOfDriver,
  readOtherCostConcept,
  readPreviewRows,
  readRateByCost,
  readVehicleOwnerFlag,
  watchSurrenderPosts
} from '../../steps/trips/commissionBase.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TM_COMMISSION_BASE = 'TM-1432';
const STATE_DONE = /^DONE$/i;

const stateOf = (detail: TravelDetail): string => String(detail.state ?? '');

function requirePositiveEnv(name: string): number {
  const value = Number(process.env[name]?.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[commission-base] ${name} no esta definido o no es un entero positivo`);
  }
  return value;
}

/** `yyyy-MM-dd` de manana (el BE interpreta `to` en la zona del carrier; manana cubre el viaje recien cerrado). */
function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Costo quoted de la tarifa: por costo = `pricePointToPointCost`; solo venta = la venta copiada. */
function quotedTourCost(detail: TravelDetail, byCost: boolean): number {
  const sim = (detail.simulationPrice ?? {}) as Record<string, unknown>;
  const raw = byCost ? sim.pricePointToPointCost : sim.pricePointToPoint;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[commission-base] simulationPrice.${byCost ? 'pricePointToPointCost' : 'pricePointToPoint'} no es un numero positivo (${String(raw)})`
    );
  }
  return value;
}

test.describe('TM-1432 comision de chofer y dueno sin la parte no comisionable', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- gate intencional: el spec crea viajes permanentes
  test.skip(
    process.env.ADMIN_CIRCUIT_CREATE_TRIP !== '1',
    'Crea viajes permanentes (DONE por cierre admin): requiere ADMIN_CIRCUIT_CREATE_TRIP=1'
  );
  test.describe.configure({ timeout: 240_000 });

  // Viaje creado por el test en curso y aun no DONE; se cancela en afterEach si el flujo se corta a mitad.
  let pendingTripId: number | null = null;

  test.afterEach(async ({ travelsApi }, testInfo) => {
    const id = pendingTripId;
    pendingTripId = null;
    if (id === null || testInfo.status === 'passed') return;
    try {
      const state = stateOf(await travelsApi.getDetail(id));
      if (/^(DONE|CANCELL?ED|LOST)$/i.test(state)) return;
      await travelsApi.cancel(id);
      console.info(
        `[commission-base] limpieza: viaje ${id} (${state}) cancelado tras flujo fallido`
      );
    } catch (e) {
      console.info(
        `[commission-base] limpieza: no se pudo cancelar el viaje ${id}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`
      );
    }
  });

  for (const row of COMMISSION_BASE_ROWS) {
    test(`${TM_COMMISSION_BASE}: validar-comision-sin-no-comisionable fila ${row.label}`, async ({
      page,
      carrierApi,
      carrierSession,
      travelsApi,
      checkingAccountApi,
      db
    }, testInfo) => {
      const oracle = requireOracle(db, `TM-1432 fila ${row.label}`);
      makeAnnotate(TM_COMMISSION_BASE, ROUTE)(`PKB-${row.label.split(' ')[0]}`, 'HP');
      const driverId = requirePositiveEnv('ADMIN_FINALIZE_DRIVER_ID');
      const vehicleId = requirePositiveEnv('PKB_SURRENDER_VEHICLE_ID');
      const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
      const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
      const attachJson = async (name: string, data: unknown): Promise<void> => {
        await testInfo.attach(name, {
          body: JSON.stringify(data, null, 2),
          contentType: 'application/json'
        });
      };

      // ---- 1. Precondiciones (solo lectura): nada se crea si alguna falla ----
      const rateByCost = await readRateByCost(oracle, row.tariff);
      expect(
        rateByCost,
        `precondicion: el tarifador ${row.tariff} debe ser ${row.byCost ? 'por costo (RATE_BY_COST=1)' : 'solo venta (RATE_BY_COST=0)'}`
      ).toBe(row.byCost ? 1 : 0);
      for (const concept of row.concepts) {
        const cfgRow = await readOtherCostConcept(oracle, concept.id);
        expect(cfgRow, `precondicion: el concepto ${concept.id} debe existir`).not.toBeNull();
        expect(
          {
            name: cfgRow?.CONCEPT,
            sale: cfgRow?.CONCEPT_VALUE,
            cost: cfgRow?.CONCEPT_VALUE_COST,
            commissionable: cfgRow?.IS_COMMISIONABLE === 1,
            deleted: cfgRow?.DELETED
          },
          `precondicion: el concepto ${concept.id} debe estar configurado como los datos del spec`
        ).toEqual({
          name: concept.name,
          sale: concept.sale,
          cost: concept.cost,
          commissionable: concept.commissionable,
          deleted: 0
        });
      }
      const openTrips = await readOpenTripsOfDriver(oracle, driverId);
      expect(
        openTrips,
        `precondicion: el chofer ${driverId} no debe tener viajes abiertos (ids: ${openTrips.join(', ') || '-'})`
      ).toEqual([]);
      const owner = await readVehicleOwnerFlag(oracle, vehicleId);
      // Guarda del cron de rendicion automatica (lanza solo con CASHCOLLECTOR=1 y ventana abierta).
      const cronWindow = assertOutsideCronWindow({ cashCollectorFlag: owner.cashCollector });
      const config = await readCommissionConfig(oracle, driverId, vehicleId);
      const expectedPcts = expectedCommissionPcts(row.byCost, config);
      expect(
        expectedPcts.driver > 0 && expectedPcts.owner > 0,
        `precondicion: la configuracion del chofer ${driverId} y vehiculo ${vehicleId} debe dar comision de chofer y dueno > 0 (sin eso la asercion seria vacua)`
      ).toBe(true);
      await attachJson('1-preconditions', {
        carrierId: carrierSession.carrierId,
        tariff: row.tariff,
        rateByCost,
        driverId,
        vehicleId,
        ownerCashCollector: owner.cashCollector,
        cronWindowInWindow: cronWindow.inWindow,
        commissionConfig: config,
        expectedPcts
      });

      // ---- 2. Alta por UI (Enviar Manual) ----
      const created = await test.step(`2. alta por UI (${row.client})`, () =>
        createTripViaUi({
          page,
          runId: flow.runId,
          client: row.client,
          authorizer: row.authorizer,
          paymentMethod: row.paymentMethod,
          otherCosts: row.concepts.map((c) => c.name),
          note: `QA PK-B TM-1432 ${row.label.split(' ')[0]} ${flow.runId}`,
          ledger: 'admin-circuit',
          assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
            expect(
              resolvedOrigin !== resolvedDestination,
              `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
            ).toBe(true);
            expect(
              simulatedAmount,
              `precondicion: la cotizacion del cliente «${row.client}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
            ).toBeGreaterThan(0);
          }
        }));

      const { travelId } = created;
      pendingTripId = travelId;
      const quoted = await flow.readDetail({ travelId });
      const tourCost = quotedTourCost(quoted, row.byCost);
      await attachJson('2-created', {
        travelId,
        simulatedAmount: created.simulatedAmount,
        state: stateOf(quoted),
        paymentMethod: quoted.paymentMethod ?? null,
        quotedTourCost: tourCost,
        otherCostLines: created.summary.lines
      });

      // ---- 3. Cierre administrativo (cancel + finalizeAdmin con DRIVER.ID) ----
      await flow.cancel({ travelId });
      await flow.finalizeAdmin({ travelId });
      const done = await flow.readDetail({ travelId });
      pendingTripId = null;
      expect(stateOf(done), 'finalizeAdmin debe dejar el viaje DONE').toMatch(STATE_DONE);

      // ---- 4. DB: componentes de costo y porcentajes guardados ----
      const dbPrice = await readCommissionDbPrice(oracle, travelId);
      const travelBefore = await readCommissionTravelDb(oracle, travelId);
      expect(
        { driverId: travelBefore.DRIVER_ID, vehicleId: travelBefore.VEHICLE_ID },
        'el viaje debe cerrarse con el chofer y vehiculo cuya configuracion se leyo'
      ).toEqual({ driverId, vehicleId });

      // ---- 5. Vista previa de «Cierres de Caja»: API (todas las paginas, solo GET) ----
      const batch = { driverUserId: driverId, vehicleId };
      const to = tomorrow();
      const api = await readPreviewRows(surrenderClient, batch, travelId, to);
      expect(
        api.matches,
        `el viaje ${travelId} debe figurar exactamente una vez en el lote pendiente (${api.batchSize} viajes)`
      ).toHaveLength(1);
      const previewRow = api.matches[0];

      // ---- 6. Vista previa por UI: abrir SIN confirmar y capturar ----
      const posts = watchSurrenderPosts(page);
      const surrenderPage = new SurrenderPage(page);
      await surrenderPage.openPending();
      await surrenderPage.selectBatch({ driverUserId: driverId, vehicleId });
      const uiPreview = await surrenderPage.readPreview();

      // ---- 7. Estado de rendicion despues de mirar la vista previa ----
      const travelAfter = await readCommissionTravelDb(oracle, travelId);

      const verdict = evaluateCommissionBase({
        label: `TM-1432 ${row.label} viaje ${travelId}`,
        quotedTourCost: tourCost,
        expectedWaitCost: 0,
        commissionableCost: row.concepts
          .filter((c) => c.commissionable)
          .reduce((sum, c) => sum + c.cost, 0),
        nonCommissionableCost: row.concepts
          .filter((c) => !c.commissionable)
          .reduce((sum, c) => sum + c.cost, 0),
        nonCommissionableSale: row.concepts
          .filter((c) => !c.commissionable)
          .reduce((sum, c) => sum + c.sale, 0),
        expectedPcts,
        detail: {
          amountCost: done.amountCost ?? null,
          tourPriceCost: done.tourPriceCost ?? null,
          waitTotalPriceCost: done.waitTotalPriceCost ?? null,
          otherCostPriceCost: done.otherCostPriceCost ?? null,
          otherCostNoCom: done.otherCostNoCom ?? null,
          otherCostPriceCostNoCom: done.otherCostPriceCostNoCom ?? null
        },
        db: dbPrice,
        travelPcts: travelBefore,
        preview: previewRow,
        sideEffects: {
          before: {
            travelsSurrenderId: travelBefore.TRAVELSSURRENDER_ID,
            surrendered: travelBefore.SURRENDERED
          },
          after: {
            travelsSurrenderId: travelAfter.TRAVELSSURRENDER_ID,
            surrendered: travelAfter.SURRENDERED
          },
          surrenderPosts: posts.count()
        }
      });

      // Medicion (lista blanca: sin PII del pasajero ni tokens). Se adjunta pase o falle.
      await attachJson(`medicion-${travelId}`, {
        travelId,
        row: row.label,
        tariff: row.tariff,
        paymentMethod: done.paymentMethod ?? null,
        state: stateOf(done),
        detail: {
          amount: done.amount ?? null,
          amountCost: done.amountCost ?? null,
          tourPriceCost: done.tourPriceCost ?? null,
          waitTotalPriceCost: done.waitTotalPriceCost ?? null,
          otherCostPriceCost: done.otherCostPriceCost ?? null,
          otherCostNoCom: done.otherCostNoCom ?? null,
          otherCostPriceCostNoCom: done.otherCostPriceCostNoCom ?? null
        },
        db: dbPrice,
        travelPcts: {
          driver: travelBefore.DRIVER_COMMISSION_PCT,
          owner: travelBefore.OWNER_COMMISSION_PCT,
          agency: travelBefore.AGENCY_COMMISSION_PCT
        },
        expectedPcts,
        previewRow: {
          travelAmount: previewRow.travelAmount ?? null,
          driverCommissionPct: previewRow.driverCommissionPct ?? null,
          driverCommissionAmount: previewRow.driverCommissionAmount ?? null,
          ownerCommissionPct: previewRow.ownerCommissionPct ?? null,
          ownerCommissionAmount: previewRow.ownerCommissionAmount ?? null,
          agencyCommissionPct: previewRow.agencyCommissionPct ?? null,
          agencyCommissionAmount: previewRow.agencyCommissionAmount ?? null
        },
        ui: {
          pagedTravelIds: uiPreview.travelIds.length,
          totalElements: uiPreview.totalElements,
          travelsCountCard: uiPreview.uiTravelsCount,
          previewToDate: to
        },
        measured: verdict.measured,
        sideEffects: {
          before: {
            travelsSurrenderId: travelBefore.TRAVELSSURRENDER_ID,
            surrendered: travelBefore.SURRENDERED
          },
          after: {
            travelsSurrenderId: travelAfter.TRAVELSSURRENDER_ID,
            surrendered: travelAfter.SURRENDERED
          },
          surrenderPosts: posts.count()
        },
        dbOracle: 'ok',
        verdictOk: verdict.ok,
        mismatches: verdict.mismatches,
        measuredAt: new Date().toISOString()
      });

      testInfo.annotations.push({
        type: 'observation',
        description:
          'D-17/10 (Nayla) dejo diferido el AC original y dice que los no comisionables «se comportan como comisionables»; ' +
          'este run asevera el AC original (FINAL_COST_PRICE sin el no comisionable). Desviacion pendiente de confirmar con el QA lead.'
      });
      testInfo.annotations.push({
        type: 'xray_comment',
        description:
          'Alcance: UI (apertura de la vista previa de Cierres de Caja sin confirmar) + API + DB. No acredita [Chofer] ' +
          '(tarjeta «¡Viaje Asignado!» de la app): sigue en el run manual. Ola 1: lote 4987/3265 compartido, no se asevera ninguna celda.'
      });
      await attachXrayEvidence(testInfo, page, {
        name: `commission-base-${travelId}`,
        comment: describeRun(
          row,
          travelId,
          created.simulatedAmount,
          done,
          dbPrice,
          travelBefore,
          previewRow,
          verdict.measured
        )
      });

      expect(verdict.ok, verdict.message).toBe(true);
    });
  }
});

function describeRun(
  row: CommissionBaseRow,
  travelId: number,
  simulated: number,
  done: TravelDetail,
  dbPrice: Awaited<ReturnType<typeof readCommissionDbPrice>>,
  travel: Awaited<ReturnType<typeof readCommissionTravelDb>>,
  preview: {
    driverCommissionPct?: number | null;
    driverCommissionAmount?: number | null;
    ownerCommissionPct?: number | null;
    ownerCommissionAmount?: number | null;
  },
  measured: {
    expectedFinalCostPrice: number;
    expectedDriverCommission: number;
    expectedOwnerCommission: number;
  }
): string {
  return (
    `Viaje ${travelId} fila ${row.label} (tarifador ${row.tariff}): cotizado ${simulated}; cierre admin -> ${stateOf(done)}. ` +
    `DB FINAL_COST_PRICE ${dbPrice.FINAL_COST_PRICE} (esperado ${measured.expectedFinalCostPrice}; costo comisionable ${dbPrice.OTHER_COST_TOTAL_PRICE_COST}, ` +
    `no comisionable costo ${dbPrice.OTHER_COST_PRICE_COST_NOCOM} / venta ${dbPrice.OTHER_COST_TOTAL_NOCOM}); API amountCost ${done.amountCost}. ` +
    `Porcentajes TRAVEL chofer ${travel.DRIVER_COMMISSION_PCT} / dueno ${travel.OWNER_COMMISSION_PCT}. ` +
    `Vista previa: chofer ${preview.driverCommissionPct} -> ${preview.driverCommissionAmount} (esperado ${measured.expectedDriverCommission}), ` +
    `dueno ${preview.ownerCommissionPct} -> ${preview.ownerCommissionAmount} (esperado ${measured.expectedOwnerCommission}). ` +
    `TRAVELSSURRENDER_ID ${travel.TRAVELSSURRENDER_ID}, la rendicion no se confirmo.`
  );
}
