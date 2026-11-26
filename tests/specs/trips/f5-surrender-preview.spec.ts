// tests/specs/trips/f5-surrender-preview.spec.ts
// Universal F5 (MG-1024 BE + MG-1027 FE) · Rendición del chofer · VISTA PREVIA (`#/pay/travels/confirm`).
// SOLO LECTURA: abre la confirmación del par chofer/vehículo, lee pantalla + GET toTravelsSurrender
// (+ DB cuando es alcanzable) y NUNCA confirma: `SurrenderPage.blockWrites()` aborta cualquier POST
// toTravelsSurrender / PUT travelsSurrender y el spec falla si hubo intentos. No usa ningún gate FR_*.
//
// Tests (Candidates del diseño test-design-mg1027): TM-1646 (TC1), TM-1649 (TC4, parte NC = 0),
// TM-1652 (TC7). Pata DB de TM-1646 en un test aparte: si Oracle TEST es inalcanzable falla ESE test
// (ENVIRONMENT) sin tapar el veredicto de UI/GET.
//
// Ejecución (carrier 1040, par 5036/2565, sesión de región AR):
//   npx cross-env ENV=test REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/f5-surrender-preview.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
// F5_VERIFY_LAYERS=ui,api[,db]: default TEST ui,api,db; ENV=uat ui,api (la pata DB queda «N/A en UAT», anotación
// `ac-na`, nunca PASS). En UAT el par chofer/vehículo se resuelve por API (Daily Clearing › Pending); F5_UAT_PAIR
// lo fuerza (<driverUserId>/<vehicleId>). Sesión: storage/state-carrier-<región>-uat.json; ENV_FILE=.env.uat[-us|-fr].
// F5_TARGETS=1040,1901 agrega 1901 (TEST; en UAT: 1040|1481|2021). El lote pendiente se resuelve en runtime; sin pendientes el test FALLA
// («sin datos pendientes»). Solo F5_ALLOW_SKIP_NO_PENDING=1 lo convierte en skip anotado (`skip-reason`).
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, regionStorageStatePath } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { loadCarrierSession } from '../../api/clients/carrierSession.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import { activeF5Targets, resolveF5Target, type F5Target } from '../../config/f5-targets.js';
import { tryCreateOracleDb } from '../../db/OracleDb.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { dbNaReason, f5DbNotApplicable, f5LayerEnabled } from '../../helpers/f5-layers.js';
import { evaluateGetInternal } from '../../helpers/f5-api-oracle.js';
import {
  deliverQ9Question,
  evaluateCommissionsAgainstGet,
  evaluateGetAgainstExpected,
  evaluateGetCcNc,
  evaluateUiAgainstGet,
  evaluateUiFormats,
  expectedDeliverBalance,
  expectedF5,
  formatMismatches,
  matchedTotalCashDefinition,
  parseF5Ui,
  parseF5UiRaw,
  readNcField,
  splitDeliverCases,
  type F5UiReading
} from '../../helpers/f5-surrender-oracle.js';
import { verifyF5 } from '../../helpers/f5-acceptance.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';
import {
  readF5CommissionInputs,
  readF5TripFacts,
  requireDriverId
} from '../../steps/trips/f5Surrender.steps.js';
import { F5_KEYS } from '../../data/xray/f5-keys.js';
import { parseMoney } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/pay/travels/confirm';
const round2 = (n: number): number => Math.round(n * 100) / 100;

type Opened = {
  surrender: SurrenderPage;
  page: Page;
  totals: Record<string, unknown>;
  ui: F5UiReading;
  rawUi: Partial<Record<keyof F5UiReading, string>>;
  travelIds: number[];
  totalElements: number;
  uiTravelsCount: number;
};

/**
 * Falta de datos pendientes: FALLA con un mensaje claro («sin datos pendientes») en lugar de un skip
 * silencioso (un reporte verde con todo omitido no prueba nada). Solo F5_ALLOW_SKIP_NO_PENDING=1 permite el
 * skip, y queda anotado (`skip-reason`) para que el informe lo cuente.
 */
function noPendingData(testInfo: TestInfo, reason: string): never {
  if (process.env.F5_ALLOW_SKIP_NO_PENDING === '1') {
    testInfo.annotations.push({
      type: 'skip-reason',
      description: `sin datos pendientes: ${reason}`
    });
    test.skip(true, `sin datos pendientes: ${reason}`);
  }
  throw new Error(
    `[F5 BLOCKED] sin datos pendientes: ${reason} (preparar un lote pendiente o usar F5_ALLOW_SKIP_NO_PENDING=1 para omitir de forma anotada)`
  );
}

/** Par del target: fijo en TEST (sin llamada extra); en UAT se resuelve por API y, sin pendientes, falla con motivo. */
async function pairOf(
  target: F5Target,
  client: SurrenderClient,
  testInfo: TestInfo
): Promise<F5Target> {
  if (target.pair !== 'runtime') return target;
  const resolved = resolveF5Target(target, await client.pendingSummary());
  if (!resolved) {
    noPendingData(
      testInfo,
      `[${target.id}] la grilla de pendientes (Daily Clearing › Pending) no tiene pares`
    );
  }
  return resolved as F5Target;
}

/** Datos de la pantalla del par; sin pendientes falla con motivo (ver `noPendingData`). */
async function openPreview(
  page: Page,
  target: F5Target,
  client: SurrenderClient,
  testInfo: TestInfo
): Promise<Opened> {
  const pending = await client.pendingSummary();
  const hasPair = pending.some(
    (r) => r.driverId === target.driverUserId && r.vehicleId === target.vehicleId
  );
  if (!hasPair) {
    noPendingData(
      testInfo,
      `[${target.id}] sin pendientes para chofer ${target.driverUserId} / vehículo ${target.vehicleId} (no se crean datos desde este spec)`
    );
  }
  const surrender = new SurrenderPage(page);
  await surrender.blockWrites();
  await surrender.openPending();
  await surrender.selectBatch({
    driverUserId: target.driverUserId,
    vehicleId: target.vehicleId
  });
  const preview = await surrender.readPreview();
  if (preview.totals === null) {
    throw new Error('precondición: la pantalla no disparó GET toTravelsSurrender (totales)');
  }
  const lines = await surrender.readBodyLines();
  return {
    surrender,
    page,
    totals: preview.totals,
    ui: parseF5Ui(lines),
    rawUi: parseF5UiRaw(lines),
    travelIds: preview.travelIds,
    totalElements: preview.totalElements,
    uiTravelsCount: preview.uiTravelsCount
  };
}

/** Subconjunto de diferencias de un veredicto cuyo campo empieza con alguno de los prefijos. */
function pick(
  mismatches: ReadonlyArray<{ field: string; expected: unknown; actual: unknown }>,
  ...prefixes: string[]
): Array<{ field: string; expected: unknown; actual: unknown }> {
  return mismatches.filter((m) => prefixes.some((p) => m.field.startsWith(p)));
}

for (const baseTarget of activeF5Targets()) {
  test.describe(`@P1 @functional F5 rendición · vista previa · carrier ${baseTarget.id}`, () => {
    test(`TM-1646: debería mostrar la línea de no comisionables separada y sumarla al efectivo a rendir (${baseTarget.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      makeAnnotate(F5_KEYS.TC1_LINEA_NC, ROUTE)('TC1', 'HP');
      let target = baseTarget;
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId, `la sesión de región debe ser del carrier ${target.id}`).toBe(
        target.carrierId
      );
      const api = await session.newApiContext(playwright.request);
      try {
        target = await pairOf(target, new SurrenderClient(api, session), testInfo);
        const page = await carrierPage(target.region);
        const opened = await openPreview(page, target, new SurrenderClient(api, session), testInfo);
        const { totals, ui } = opened;
        const nc = readNcField(totals);
        const ncAmount = nc.field?.amount ?? 0;
        const all = evaluateUiAgainstGet(ui, totals);
        // Capa API (vale en todo ambiente): identidades del GET contra el lote de toSurrend. Sin DB (UAT) este
        // veredicto es además el de AC-F5-16 (campo checkingAccountAgencyProfitDiff presente y numérico) y el
        // de la forma de las comisiones por actor.
        const batchRows = (
          await new SurrenderClient(api, session).preview({
            driverUserId: target.driverUserId,
            vehicleId: target.vehicleId
          })
        ).rows;
        const internal = evaluateGetInternal(totals, batchRows);
        await verifyF5(testInfo, 'AC-F5-16', () => {
          expect(
            internal.ok,
            formatMismatches('GET toTravelsSurrender · identidades (API)', internal.mismatches)
          ).toBe(true);
          return {
            layer: 'api',
            checkingAccountAgencyProfitDiff: totals.checkingAccountAgencyProfitDiff,
            commissions: {
              driver: totals.commissionSum,
              agency: totals.agencyTotalCommission,
              owner: totals.ownerTotalCommission
            },
            tripsInBatch: batchRows.length
          };
        });
        if (!f5LayerEnabled('db')) {
          f5DbNotApplicable(
            testInfo,
            'AC-F5-08/AC-F5-14 (esperado y comisiones independientes desde DB)'
          );
        }

        await verifyF5(testInfo, 'AC-F5-01', () => {
          expect(nc.verdict.ok, formatMismatches('GET campo NC', nc.verdict.mismatches)).toBe(true);
          return { totalCashOtherCostNoCommissionable: nc.field };
        });
        await verifyF5(testInfo, 'AC-F5-02', () => {
          const m = pick(all.mismatches, 'UI linea NC');
          expect(m.length === 0, formatMismatches('línea NC de la pantalla', m)).toBe(true);
          return { ncLineUi: ui.ncLine, ncGet: ncAmount };
        });
        await verifyF5(testInfo, 'AC-F5-03', () => {
          const m = pick(all.mismatches, 'UI Total Cash');
          expect(m.length === 0, formatMismatches('Total Cash de la pantalla', m)).toBe(true);
          return { totalCashUi: ui.totalCash };
        });
        await verifyF5(testInfo, 'AC-F5-04', () => {
          const m = pick(
            all.mismatches,
            'UI Total Amount Collected',
            'UI Cash Trips',
            'UI Credit Account',
            'UI Taxes'
          );
          expect(m.length === 0, formatMismatches('Total recaudado de la pantalla', m)).toBe(true);
          return { totalCollectedUi: ui.totalCollected, cashTripsUi: ui.cashTrips };
        });
        await verifyF5(testInfo, 'AC-F5-05', () => {
          const m = pick(
            all.mismatches,
            'UI driverCommissions',
            'UI companyCommissions',
            'UI ownerCommissions'
          );
          expect(m.length === 0, formatMismatches('comisiones de la pantalla vs GET', m)).toBe(
            true
          );
          return {
            driver: ui.driverCommissions,
            company: ui.companyCommissions,
            owner: ui.ownerCommissions,
            get: {
              commissionSum: totals.commissionSum,
              agencyTotalCommission: totals.agencyTotalCommission,
              ownerTotalCommission: totals.ownerTotalCommission
            }
          };
        });
        await verifyF5(testInfo, 'AC-F5-06', () => {
          expect(
            opened.surrender.writeAttempts(),
            'la vista previa no debe intentar escrituras de la rendición'
          ).toBe(0);
          return { blockedWrites: opened.surrender.writeAttempts() };
        });

        await verifyF5(testInfo, 'AC-F5-07', () => {
          expect(
            opened.travelIds.length,
            'el lote resuelto en runtime no puede estar vacío'
          ).toBeGreaterThan(0);
          expect(
            opened.uiTravelsCount,
            'tarjeta de viajes de la pantalla = totalElements del GET toSurrend'
          ).toBe(opened.totalElements);
          return { travelIds: opened.travelIds, uiTravelsCount: opened.uiTravelsCount };
        });
        await verifyF5(testInfo, 'AC-F5-15', () => {
          const required: Array<keyof F5UiReading> = [
            'totalCash',
            'totalCollected',
            'cashTrips',
            'companyCommissions',
            'ownerCommissions',
            ...(ncAmount > 0 ? (['ncLine'] as const) : [])
          ];
          const v = evaluateUiFormats(opened.rawUi, target.moneyFormat, required);
          expect(v.ok, formatMismatches('formato de importes de la pantalla', v.mismatches)).toBe(
            true
          );
          return { format: target.moneyFormat, raw: opened.rawUi };
        });
        await attachXrayEvidence(testInfo, page, {
          name: `f5-preview-${target.id}`,
          comment:
            `F5 vista previa ${target.id} (chofer ${target.driverUserId} / vehículo ${target.vehicleId}), viajes ${opened.travelIds.join(', ')}: ` +
            `GET NC ${JSON.stringify(nc.field)}, pantalla NC ${ui.ncLine}, Total Cash ${ui.totalCash}, Total Amount Collected ${ui.totalCollected}. ` +
            `Escrituras abortadas: ${opened.surrender.writeAttempts()}.`
        });
      } finally {
        await api.dispose();
      }
    });

    test(`TM-1649: debería ocultar la línea de no comisionables cuando el lote no tiene no comisionables en efectivo (${baseTarget.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      makeAnnotate(F5_KEYS.TC4_VISIBILIDAD, ROUTE)('TC4', 'EP');
      let target = baseTarget;
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId).toBe(target.carrierId);
      const api = await session.newApiContext(playwright.request);
      try {
        target = await pairOf(target, new SurrenderClient(api, session), testInfo);
        const page = await carrierPage(target.region);
        const { totals, ui, surrender } = await openPreview(
          page,
          target,
          new SurrenderClient(api, session),
          testInfo
        );
        const ncAmount = readNcField(totals).field?.amount ?? 0;
        if (ncAmount > 0) {
          noPendingData(
            testInfo,
            `[${target.id}] el lote pendiente tiene NC efectivo ${ncAmount}: la ausencia de la línea solo se valida con un lote sin NC (TC4 completo es manual: F-A/F-B/F-C no se abren por UI)`
          );
        }
        await verifyF5(testInfo, 'AC-F5-02', () => {
          // Contrato (14184, TM-1664): con NC = 0 la línea está AUSENTE; «0,00» en pantalla es regresión.
          // Lo abierto con el PO (Q2) es solo la fila 0,00 del Clearing, no la pantalla.
          expect(ui.ncLine, 'sin NC efectivo la línea no debe mostrarse (ni como 0,00)').toBeNull();
          const v = evaluateUiAgainstGet(ui, totals);
          expect(v.ok, formatMismatches('pantalla vs GET sin NC', v.mismatches)).toBe(true);
          return { ncLineUi: ui.ncLine, writes: surrender.writeAttempts() };
        });
      } finally {
        await api.dispose();
      }
    });

    test(`TM-1652: debería habilitar Confirmar y calcular el saldo según el importe de «Entregar» sin confirmar (${baseTarget.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      makeAnnotate(F5_KEYS.TC7_ENTREGAR, ROUTE)('TC7', 'BVA');
      let target = baseTarget;
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId).toBe(target.carrierId);
      const api = await session.newApiContext(playwright.request);
      try {
        target = await pairOf(target, new SurrenderClient(api, session), testInfo);
        const page = await carrierPage(target.region);
        const { surrender } = await openPreview(
          page,
          target,
          new SurrenderClient(api, session),
          testInfo
        );
        // Base del saldo = Total Cash − deducciones − comisiones&propinas + costos financieros (NO «Total Cash»:
        // en 1521 la comisión del chofer la baja; en 1040 coincide solo porque esa comisión es 0). Antes de
        // teclear se valida que el campo localizado es «Entregar» (precarga = monto a entregar).
        const deliverBase = await surrender.assertDeliverFieldIsEntregar();
        const T = deliverBase.base;
        expect(
          T,
          'precondición: la base del saldo debe ser positiva para recorrer los límites'
        ).toBeGreaterThan(0.01);
        const dec = target.moneyFormat.decimal;
        const typed = (n: number): string => n.toFixed(2).replace('.', dec);
        const rows: Array<{
          raw: string;
          disabled: boolean;
          kind?: 'Company' | 'Driver';
          balance?: number;
        }> = [
          { raw: '', disabled: true },
          { raw: `0${dec}01`, disabled: false, kind: 'Company', balance: round2(T - 0.01) },
          {
            raw: typed(round2(T / 2)),
            disabled: false,
            kind: 'Company',
            balance: round2(T - round2(T / 2))
          },
          { raw: typed(round2(T - 0.01)), disabled: false, kind: 'Company', balance: 0.01 },
          { raw: typed(T), disabled: false, kind: 'Company', balance: 0 }
        ];
        const observed: unknown[] = [];
        await verifyF5(testInfo, 'AC-F5-13', async () => {
          for (const row of rows) {
            const r = await surrender.typeDeliver(row.raw);
            observed.push({ raw: row.raw, ...r });
            expect(r.confirmDisabled, `Confirmar con «${row.raw}»`).toBe(row.disabled);
            if (!row.disabled) {
              expect(r.balanceKind, `quién recibe el saldo con «${row.raw}»`).toBe(row.kind);
              expect(parseMoney(r.balanceText ?? ''), `saldo con «${row.raw}»`).toBeCloseTo(
                row.balance as number,
                2
              );
            }
          }
          return { rows: observed };
        });
        // H-03 / Q9 (PREEXISTENTE en PROD, regla no definida): «Entregar» = 0 y > adeudado hoy dejan Confirmar
        // habilitado. Se registra la conducta actual como `observation`; NO es esperado: si se corrige Q9 este
        // test no debe fallar por la corrección.
        const q9Rows: Array<{ raw: string; kind: 'zero' | 'overDue' }> = [
          { raw: '0', kind: 'zero' },
          { raw: typed(round2(T + 0.01)), kind: 'overDue' }
        ];
        for (const row of q9Rows) {
          const r = await surrender.typeDeliver(row.raw);
          testInfo.annotations.push({
            type: 'observation',
            description: `${deliverQ9Question(row.raw, row.kind)} Observado: Confirmar ${r.confirmDisabled ? 'DESHABILITADO' : 'habilitado'}, saldo ${r.balanceKind ?? 'n/d'} ${r.balanceText ?? ''}.`
          });
        }
        // Contrato HP-01 (FE 5693400f): 3.er decimal frenado (tipeado y pegado), «-» y letras descartados.
        // Con T = 1.645 «1234,567» → «1234,56» y saldo 410,44 (antes del fix 410,43): distingue fix de regresión.
        await verifyF5(testInfo, 'AC-F5-13', async () => {
          const contract: unknown[] = [];
          const { contract: contractCases, observation: q9Cases } = splitDeliverCases(dec);
          for (const c of contractCases) {
            for (const paste of [false, true]) {
              const r = await surrender.typeDeliver(c.raw, { guardShown: false, paste });
              contract.push({ raw: c.raw, paste, ...r });
              const how = `«${c.raw}» ${paste ? 'pegado' : 'tipeado'}`;
              expect(r.shown, `campo con ${how}`).toBe(c.shown);
              expect(r.confirmDisabled, `Confirmar con ${how}`).toBe(c.confirmDisabled);
              if (c.amount !== null) {
                const want = expectedDeliverBalance(T, c.amount);
                expect(r.balanceKind, `quién recibe el saldo con ${how}`).toBe(want.kind);
                expect(parseMoney(r.balanceText ?? ''), `saldo con ${how}`).toBeCloseTo(
                  want.balance,
                  2
                );
              }
            }
          }
          // «−10» → «10»: regla de signo no definida (Q9): se registra, no se asevera.
          for (const c of q9Cases) {
            for (const paste of [false, true]) {
              const r = await surrender.typeDeliver(c.raw, { guardShown: false, paste });
              testInfo.annotations.push({
                type: 'observation',
                description: `${deliverQ9Question(c.raw, 'negativeSign')} Observado (${paste ? 'pegado' : 'tipeado'}): campo «${r.shown}», Confirmar ${r.confirmDisabled ? 'DESHABILITADO' : 'habilitado'}.`
              });
            }
          }
          return { contract };
        });
        expect(surrender.writeAttempts(), 'Entregar no debe disparar escrituras').toBe(0);
        await attachXrayEvidence(testInfo, page, {
          name: `f5-entregar-${target.id}`,
          comment: `F5 «Entregar» ${target.id}: ${rows.length} valores límite; Confirmar nunca fue pulsado.`
        });
      } finally {
        await api.dispose();
      }
    });

    test(`TM-1646: debería coincidir el GET de totales con el esperado derivado de la DB (${baseTarget.id})`, async ({
      playwright
    }, testInfo) => {
      makeAnnotate(F5_KEYS.TC1_LINEA_NC, ROUTE)('TC1-DB', 'HP');
      let target = baseTarget;
      if (!f5LayerEnabled('db')) {
        // Pata DB fuera del alcance del ambiente (UAT: solo UI+API): N/A anotado, nunca PASS. Los equivalentes
        // por API (GET vs pantalla, identidades del GET, NC, CC diff, comisiones por actor) viven en el test de UI.
        f5DbNotApplicable(
          testInfo,
          'TM-1646 pata DB (AC-F5-08 esperado desde DB, AC-F5-14 pct × base)'
        );
        test.skip(true, dbNaReason());
      }
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId).toBe(target.carrierId);
      const api = await session.newApiContext(playwright.request);
      try {
        target = await pairOf(target, new SurrenderClient(api, session), testInfo);
        const client = new SurrenderClient(api, session);
        const batch = { driverUserId: target.driverUserId, vehicleId: target.vehicleId };
        const pending = await client.pendingSummary();
        if (
          !pending.some((r) => r.driverId === batch.driverUserId && r.vehicleId === batch.vehicleId)
        ) {
          noPendingData(testInfo, `[${target.id}] sin pendientes para el par: nada que contrastar`);
        }
        const preview = await client.preview(batch);
        const totals = await client.totals(batch);
        const oracle = requireOracle(tryCreateOracleDb(), `F5 ${target.id} (GET vs DB)`);
        const trips = preview.rows.map((row) => {
          if (typeof row.travelId !== 'number' || typeof row.paymentMethod !== 'string') {
            throw new Error('precondición: fila de toSurrend sin travelId/paymentMethod');
          }
          return { travelId: row.travelId, paymentMethod: row.paymentMethod };
        });
        const facts = await readF5TripFacts(oracle, trips);
        const expected = expectedF5(facts);
        // H-04 (D-6): con peaje/estacionamiento > 0 la definición de TOTALCASH está abierta; se registra con cuál
        // coincide el GET y el veredicto de totalCash de abajo se lee como observación en ese caso.
        for (const note of expected.observations ?? []) {
          testInfo.annotations.push({
            type: 'observation',
            description: `${note} GET coincide con: ${matchedTotalCashDefinition(totals, facts)}.`
          });
        }
        await verifyF5(testInfo, 'AC-F5-08', () => {
          const v = evaluateGetAgainstExpected(totals, expected);
          expect(v.ok, formatMismatches('GET vs esperado desde DB', v.mismatches)).toBe(true);
          return { facts, expected };
        });
        await verifyF5(testInfo, 'AC-F5-16', () => {
          const v = evaluateGetCcNc(totals, expected);
          expect(v.ok, formatMismatches('GET checkingAccountAgencyProfitDiff', v.mismatches)).toBe(
            true
          );
          return {
            ncCheckingAccount: expected.ncCheckingAccount,
            checkingAccountProfitDiff: expected.checkingAccountProfitDiff
          };
        });
        // B3: la base de comisión excluye el NC, verificado con un cálculo independiente (pct de
        // TRAVEL.*_COMMISSION_PCT × base derivada de DB) contra el GET, al centavo.
        await verifyF5(testInfo, 'AC-F5-14', async () => {
          // `driverUserId` del target ya es DRIVER.ID (ver F5Target); solo se verifica que exista.
          const driverId = await requireDriverId(oracle, target.driverUserId);
          const inputs = await readF5CommissionInputs(oracle, {
            travelIds: trips.map((t) => t.travelId),
            driverId,
            vehicleId: target.vehicleId
          });
          const v = evaluateCommissionsAgainstGet(totals, expected, inputs);
          expect(
            v.ok,
            formatMismatches('comisiones del GET vs pct × base sin NC', v.mismatches)
          ).toBe(true);
          return { inputs, expected };
        });
      } finally {
        await api.dispose();
      }
    });
  });
}
