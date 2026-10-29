// tests/specs/trips/fr-circuit-settlement.spec.ts
// Circuito e2e carrier Francia (TEST 1901): liquidaciones (settlements) de CHOFER (DRIVER.ID 4965) y
// PROPIETARIO (2927) contra rendiciones, libros de cuenta corriente y viajes.
// Diseno y formulas: docs/qa/automation-stock/fr-1901/liquidaciones-diseno-2026-10-21.md.
//
// Estructura (serial):
//   FR-SET-1  SOLO LECTURA  pendientes: API == DB == oraculo (comNeta por rendicion, total, columna
//                           «A liquidar») y vista previa de la UI == oraculo.
//   FR-SET-2  SOLO LECTURA  un viaje de una rendicion liquidada: el detalle marca liquidationDriver /
//                           liquidationOwner y la UI muestra el modal de alerta SIN abrir la edicion ni
//                           emitir PUT (el 409 TRAVEL_LIQUIDATED del PUT solo ocurre con detalle viejo;
//                           ver «Fuera de alcance» en el documento de diseno).
//   FR-SET-3  IRREVERSIBLE  crea la liquidacion de chofer con TODAS las rendiciones pendientes (gate
//                           FR_CONFIRM_SETTLEMENT=1). Post: cabecera/detalle/flags en DB, libros intactos,
//                           «A liquidar» = 0, viaje bloqueado.
//   FR-SET-4  IRREVERSIBLE  idem para el propietario (gate FR_CONFIRM_SETTLEMENT=1).
//
// Estado de TEST al 2026-10-21: las 10 rendiciones de 1901 ya estan en liquidaciones PAID de
// propietario (2681, 2682); 5 en liquidaciones de chofer (1621, 1623); quedan PENDIENTES para el
// chofer 13841, 13843, 13858, 13878 (total 2659.00) y NADA para el propietario. Por eso FR-SET-4 se
// salta limpio sin pendientes en lugar de fallar: generar rendiciones nuevas (S1/S2/S3) o anular la
// ULTIMA liquidacion (accion de escritura, fuera de este spec) antes de correrlo.
//
// ACs (registro tests/helpers/acceptance.ts), aseverados dentro de verifyAc: SET-1 66-70; SET-2 73, 62, 74;
// SET-3/4 70 (previa), 71, 72, 75 (salen de pendientes, DB + API), 73, 62, 74; observacion 76 (PO).
// Los pendientes vacios (oraculo vacuo) se anotan como observation, no se saltan.
//
// Opcionales: FR_OWNER_ID (default 2927), FR_CARRIER_ID (default 1901).
// Run (solo lectura):  npx cross-env ENV=test playwright test tests/specs/trips/fr-circuit-settlement.spec.ts --workers=1 --retries=0
// Run (confirma):      FR_CONFIRM_SETTLEMENT=1 + el mismo comando (sin retries: un reintento duplicaria la liquidacion).
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { observation, verifyAc } from '../../helpers/acceptance.js';
import {
  describeLiquidationObservation,
  evaluateSettledLeftPending,
  ownerSurrenderIds,
  readIsLiquidated
} from '../../helpers/fr-ac-eval-auto-settlement.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  SettlementClient,
  isSettlementGateOpen,
  todayParam
} from '../../api/clients/settlement.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  readBooks
} from '../../helpers/fr-circuit.js';
import {
  bookStatusCounts,
  compareAmounts,
  driverCreateTotal,
  driverNet,
  driverOpenSurrenders,
  driverToLiquidateColumn,
  evaluateBooksUntouched,
  evaluateCreatedLiquidation,
  liquidationFromDb,
  ownerCreateTotal,
  ownerNet,
  ownerOpenSurrenders,
  ownerToLiquidateColumn,
  paidLiquidationsOfSurrender,
  surrendersByIds,
  type LiquidationKind,
  type Mismatch
} from '../../helpers/settlement-oracle.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { formatMismatches } from '../../helpers/oracle-result.js';
import {
  SettledTripEditAlert,
  SettlementPage
} from '../../pages/carrier-v2/settlements/SettlementPage.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_KEYS, FR_1901_SCOPE_NOTES } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';
import type { OracleDb } from '../../db/OracleDb.js';

const ROUTE = '/carrier/#/liquidations/drivers/list';

const frGate = frConfigOrNull('FR settlements', []);

/**
 * Intenta editar un viaje liquidado y devuelve lo observado. AC-FR-62: el spec exige el bloqueo (modal de
 * alerta, sin panel de edicion ni PUT) dentro de `verifyAc`.
 */
async function openSettledTripAlert(
  testInfo: TestInfo,
  page: Page,
  travelId: number
): Promise<string> {
  const read = await new SettledTripEditAlert(page).openAndReadAlert(travelId);
  await verifyAc(testInfo, 'AC-FR-62', () => {
    expect(read.alertShown, 'viaje liquidado: debe abrirse el modal de alerta').toBe(true);
    expect(read.editPanelOpen, 'viaje liquidado: NO debe abrirse el panel de edicion').toBe(false);
    expect(
      read.putUrls,
      'viaje liquidado: la pantalla no debe emitir PUT updateFinalPrices'
    ).toEqual([]);
    return { travelId, alertShown: read.alertShown, putUrls: read.putUrls };
  });
  return read.alertText;
}

test.describe('Circuito Francia - liquidaciones chofer y propietario', () => {
  test.skip(frGate.config === null, `FR settlements saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  /** Veredicto canonico a partir de las diferencias del oraculo; el spec asevera `ok` (Mismatch.field). */
  const verdictOf = (mismatches: readonly Mismatch[]) => ({
    ok: mismatches.length === 0,
    mismatches: [...mismatches]
  });
  const expectNoMismatch = (label: string, mismatches: readonly Mismatch[]): void => {
    const verdict = verdictOf(mismatches);
    expect(verdict.ok, formatMismatches(label, verdict.mismatches)).toBe(true);
  };

  /** Trae un viaje de una rendicion (para probar el bloqueo de edicion). */
  const tripOf = async (db: OracleDb, surrenderId: number): Promise<number | null> => {
    const rows = await db.query<{ ID: number }>(
      'SELECT ID FROM TRAVEL WHERE TRAVELSSURRENDER_ID = :id ORDER BY ID',
      { id: surrenderId }
    );
    return rows[0]?.ID ?? null;
  };

  test('FR-SET-1: validar-liquidaciones pendientes API, DB y UI coinciden con el oraculo', async ({
    page,
    carrierApi,
    carrierSession,
    checkingAccountApi,
    db: dbFixture
  }, testInfo) => {
    const db = requireOracle(dbFixture, 'FR-SET-1');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(FR_1901_KEYS.SET_1, ROUTE)('FR-SET-1', 'POS');
    const carrierId = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
    expect(carrierSession.carrierId, `la sesion guardada debe ser del carrier ${carrierId}`).toBe(
      carrierId
    );
    const client = new SettlementClient(carrierApi, carrierSession);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });

    // ---- CHOFER: DB (oraculo) vs API (lo que ve la pantalla) ----
    const driverRows = await driverOpenSurrenders(db, { carrierId, driverAccountId: cfg.driverId });
    const driverApi = await client.driverUnsettled({
      driverAccountId: cfg.driverId,
      to: todayParam()
    });
    if (driverRows.length === 0 && driverApi.length === 0) {
      // Oraculo vacuo (sin pendientes): las igualdades pasan en vacio; se deja constancia, no se salta el caso.
      observation(
        testInfo,
        'AC-FR-66',
        'el chofer no tiene rendiciones pendientes: API == DB se cumple en vacio.'
      );
    }
    await verifyAc(testInfo, 'AC-FR-66', () => {
      expect(
        driverApi.map((r) => r.id).sort((a, b) => a - b),
        'rendiciones pendientes del chofer: API == DB'
      ).toEqual(driverRows.map((r) => r.ID));
      return { api: driverApi.map((r) => r.id), db: driverRows.map((r) => r.ID) };
    });
    await verifyAc(testInfo, 'AC-FR-67', () => {
      const driverMismatch = driverApi.flatMap((r) => {
        const row = driverRows.find((d) => d.ID === r.id);
        return row
          ? compareAmounts([
              { what: `comNeta rendicion ${r.id}`, expected: driverNet(row).net, actual: r.comNeta }
            ])
          : [];
      });
      expectNoMismatch('comNeta por rendicion (chofer)', driverMismatch);
      return { perSurrender: driverRows.map(driverNet) };
    });
    const driverTotal = driverCreateTotal(driverRows);
    // Columna «A liquidar» de la grilla (otra formula del BE: sin peajes/estacionamiento).
    const summary = await client.driversSummary();
    const mine = (summary.content ?? []).find((r) => r.driverAccountId === cfg.driverId);
    await verifyAc(testInfo, 'AC-FR-68', () => {
      expectNoMismatch(
        'total chofer',
        compareAmounts([
          {
            what: 'suma de comNeta (API)',
            expected: driverTotal,
            actual: round2(driverApi.reduce((s, r) => s + Number(r.comNeta ?? 0), 0))
          }
        ])
      );
      expect(mine, `el chofer ${cfg.driverId} debe figurar en findDrivers`).toBeDefined();
      expectNoMismatch(
        'columna A liquidar (chofer)',
        compareAmounts([
          {
            what: 'toLiquidate',
            expected: driverToLiquidateColumn(driverRows),
            actual: mine?.toLiquidate
          }
        ])
      );
      return { total: driverTotal, gridColumn: mine?.toLiquidate ?? null };
    });

    // ---- PROPIETARIO ----
    const ownerRows = await ownerOpenSurrenders(db, { carrierId, ownerId });
    const ownerApi = await client.ownerUnsettled({ ownerId, to: todayParam() });
    const ownerApiIds = ownerSurrenderIds(ownerApi);
    if (ownerRows.length === 0 && ownerApiIds.length === 0) {
      observation(
        testInfo,
        'AC-FR-69',
        'el propietario no tiene rendiciones pendientes: API == DB y totales se cumplen en vacio.'
      );
    }
    const ownerTotal = ownerCreateTotal(ownerRows);
    const ownerDetail = await client.ownerDetail(ownerId);
    await verifyAc(testInfo, 'AC-FR-69', () => {
      expect(ownerApiIds, 'rendiciones pendientes del propietario: API == DB').toEqual(
        ownerRows.map((r) => r.ID)
      );
      expectNoMismatch(
        'total propietario',
        compareAmounts([
          {
            what: 'suma de comNeta de los grupos (API)',
            expected: ownerTotal,
            actual: round2(ownerApi.reduce((s, g) => s + Number(g.comNeta ?? 0), 0))
          }
        ])
      );
      expectNoMismatch(
        'columna A liquidar (propietario)',
        compareAmounts([
          {
            what: 'toLiquidate',
            expected: ownerToLiquidateColumn(ownerRows),
            actual: ownerDetail.toLiquidate
          }
        ])
      );
      return {
        api: ownerApiIds,
        db: ownerRows.map((r) => r.ID),
        total: ownerTotal,
        gridColumn: ownerDetail.toLiquidate ?? null
      };
    });

    // ---- Libros (linea base; la liquidacion no debe tocarlos) ----
    const books = await readBooks(checkingAccountApi, cfg, ownerId);
    const driverBookStatus = await bookStatusCounts(db, 'driver', cfg.driverId);
    const ownerBookStatus = await bookStatusCounts(db, 'owner', ownerId);

    // ---- UI: vista previa == oraculo (solo lectura; tilda en pantalla, no envia nada) ----
    const driverPage = new SettlementPage(page, 'driver');
    await driverPage.gotoCreate(cfg.driverId);
    const driverPreview = await driverPage.readPreview();
    const ownerPage = new SettlementPage(page, 'owner');
    await ownerPage.gotoCreate(ownerId);
    const ownerPreview = await ownerPage.readPreview();
    await verifyAc(testInfo, 'AC-FR-70', () => {
      expect(driverPreview.rows, 'filas de la vista previa del chofer').toBe(driverRows.length);
      expect(driverPreview.totalBeforeSelect, 'sin tildar el total es 0').toBe(0);
      expect(driverPreview.total, 'total de la UI == oraculo (suma de comNeta)').toBeCloseTo(
        driverTotal,
        2
      );
      expect(ownerPreview.total, 'total de la UI del propietario == oraculo').toBeCloseTo(
        ownerTotal,
        2
      );
      return { driver: driverPreview, owner: ownerPreview };
    });

    const measurement = {
      driver: {
        accountId: cfg.driverId,
        openSurrenders: driverRows.map((r) => r.ID),
        perSurrender: driverRows.map(driverNet),
        createTotal: driverTotal,
        gridColumn: driverToLiquidateColumn(driverRows),
        ui: driverPreview
      },
      owner: {
        ownerId,
        openSurrenders: ownerRows.map((r) => r.ID),
        perSurrender: ownerRows.map(ownerNet),
        createTotal: ownerTotal,
        gridColumn: ownerToLiquidateColumn(ownerRows),
        ui: ownerPreview
      },
      books: {
        driver: {
          rows: books.driverRows,
          balance: books.driver.balance,
          statusCounts: driverBookStatus
        },
        owner: {
          rows: books.ownerRows,
          balance: books.owner.balance,
          statusCounts: ownerBookStatus
        }
      }
    };
    await attachJson('1-pending-vs-oracle', measurement);
    console.info(`FR_SET1_SUMMARY ${JSON.stringify(measurement)}`);
    await attachXrayEvidence(testInfo, page, {
      name: 'fr-settlement-preview-owner',
      comment:
        `FR liquidaciones: chofer ${cfg.driverId} pendientes ${driverRows.length} total ${driverTotal}; ` +
        `propietario ${ownerId} pendientes ${ownerRows.length} total ${ownerTotal}; UI == oraculo.`
    });
  });

  test('FR-SET-2: validar-liquidaciones un viaje liquidado no se edita (alerta, sin PUT)', async ({
    page,
    carrierApi,
    carrierSession,
    travelsApi,
    db: dbFixture
  }, testInfo) => {
    const db = requireOracle(dbFixture, 'FR-SET-2');
    makeAnnotate(FR_1901_KEYS.SET_2, '/carrier/#/travel/detail')('FR-SET-2', 'NEG');
    const carrierId = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    expect(carrierSession.carrierId).toBe(carrierId);
    void carrierApi;
    const surrenders = await db.query<{ ID: number }>(
      'SELECT ID FROM TRAVELSSURRENDER WHERE CARRIER_ID = :c ORDER BY ID',
      { c: carrierId }
    );
    // Primera rendicion con liquidacion PAID de chofer, y primera SOLO de propietario.
    let driverSettled: number | null = null;
    let ownerOnly: number | null = null;
    for (const { ID } of surrenders.slice(0, 80)) {
      // Solo rendiciones con viaje asociado (hay rendiciones sin TRAVEL.TRAVELSSURRENDER_ID, ej. 13840).
      if ((await tripOf(db, ID)) === null) continue;
      const d = (await paidLiquidationsOfSurrender(db, 'driver', ID)).length > 0;
      const o = (await paidLiquidationsOfSurrender(db, 'owner', ID)).length > 0;
      if (d && driverSettled === null) driverSettled = ID;
      if (o && !d && ownerOnly === null) ownerOnly = ID;
    }
    test.skip(
      driverSettled === null && ownerOnly === null,
      'no hay rendiciones liquidadas en 1901: correr antes FR-SET-3/FR-SET-4 con FR_CONFIRM_SETTLEMENT=1'
    );

    const checks: Array<{ label: string; surrenderId: number; driver: boolean; owner: boolean }> =
      [];
    if (driverSettled !== null)
      checks.push({ label: 'chofer', surrenderId: driverSettled, driver: true, owner: false });
    if (ownerOnly !== null)
      checks.push({ label: 'propietario', surrenderId: ownerOnly, driver: false, owner: true });

    const evidence: unknown[] = [];
    for (const c of checks) {
      const travelId = await tripOf(db, c.surrenderId);
      expect(travelId, `la rendicion ${c.surrenderId} debe tener al menos un viaje`).not.toBeNull();
      const detail = await travelsApi.getDetail(travelId as number);
      // TODO(no verificado en TEST): nombres liquidationDriver/liquidationOwner del JSON del detalle
      // (TravelController.java:2253-2256 los setea en el DTO; el contrato JSON no se midio aun).
      await verifyAc(testInfo, 'AC-FR-73', () => {
        expect(
          detail.liquidationOwner,
          `detalle ${travelId}: liquidationOwner debe ser true (campo ausente = TODO verificar contrato)`
        ).toBe(true);
        expect(detail.liquidationDriver, `detalle ${travelId}: liquidationDriver`).toBe(c.driver);
        return {
          travelId,
          liquidationOwner: detail.liquidationOwner,
          liquidationDriver: detail.liquidationDriver
        };
      });
      const alertText = await openSettledTripAlert(testInfo, page, travelId as number);
      // Cuerpo i18n (en-us/es-ar): responsables en mayuscula, separados por « | ».
      await verifyAc(testInfo, 'AC-FR-74', () => {
        if (c.driver) expect(alertText, 'la alerta nombra al CHOFER').toMatch(/DRIVER|CHOFER/);
        expect(alertText, 'la alerta nombra al PROPIETARIO').toMatch(/OWNER|PROPIETARIO/);
        if (!c.driver)
          expect(alertText, 'liquidado solo por propietario: no nombra al chofer').not.toMatch(
            /DRIVER|CHOFER/
          );
        return { travelId, alertText };
      });
      evidence.push({ ...c, travelId, alertText });
    }
    await testInfo.attach('2-settled-trip-alert', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json'
    });
    await attachXrayEvidence(testInfo, page, {
      name: 'fr-settlement-trip-edit-blocked',
      comment: `FR liquidaciones: ${checks.map((c) => `${c.label} rend. ${c.surrenderId}`).join('; ')}: modal de alerta, sin panel de edicion ni PUT.`
    });
  });

  const confirmTest = (kind: LiquidationKind, id: string, title: string) =>
    test(
      id + ': ' + title,
      async (
        { page, carrierApi, carrierSession, checkingAccountApi, travelsApi, db: dbFixture },
        testInfo
      ) => {
        const cfg = frGate.config as FrCircuitConfig;
        makeAnnotate(
          kind === 'driver' ? FR_1901_KEYS.SET_3 : FR_1901_KEYS.SET_4,
          kind === 'driver' ? ROUTE : '/carrier/#/liquidations/owners/list'
        )(id, 'POS');
        testInfo.annotations.push({
          type: 'xray_comment',
          description: FR_1901_SCOPE_NOTES.SET_CONFIRM
        });
        test.skip(
          !isSettlementGateOpen(),
          'requiere FR_CONFIRM_SETTLEMENT=1 (crea una liquidacion PAID irreversible)'
        );
        const db = requireOracle(dbFixture, `FR-SET-CONFIRM ${kind}`);
        const carrierId = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
        const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
        const accountId = kind === 'driver' ? cfg.driverId : ownerId;
        expect(carrierSession.carrierId).toBe(carrierId);
        const client = new SettlementClient(carrierApi, carrierSession);
        const attachJson = (name: string, data: unknown) =>
          testInfo.attach(name, {
            body: JSON.stringify(data, null, 2),
            contentType: 'application/json'
          });

        // ---- 1. Precondiciones: pendientes + oraculo + linea base de libros ----
        const open =
          kind === 'driver'
            ? await driverOpenSurrenders(db, { carrierId, driverAccountId: accountId })
            : await ownerOpenSurrenders(db, { carrierId, ownerId: accountId });
        test.skip(
          open.length === 0,
          `${kind} ${accountId} sin rendiciones pendientes: generar rendiciones nuevas (S1/S2/S3) o anular la ultima liquidacion antes de correr`
        );
        const expectedTotal = kind === 'driver' ? driverCreateTotal(open) : ownerCreateTotal(open);
        const booksBefore = await readBooks(checkingAccountApi, cfg, ownerId);
        const bookBefore =
          kind === 'driver'
            ? { rows: booksBefore.driverRows, balance: booksBefore.driver.balance }
            : { rows: booksBefore.ownerRows, balance: booksBefore.owner.balance };
        const otherKind: LiquidationKind = kind === 'driver' ? 'owner' : 'driver';
        await attachJson('1-preconditions', {
          kind,
          accountId,
          openSurrenders: open.map((r) => r.ID),
          expectedTotal,
          bookBefore
        });

        // ---- 2. Vista previa == oraculo y confirmacion IRREVERSIBLE (gate dentro del POM) ----
        const settlementPage = new SettlementPage(page, kind);
        await settlementPage.gotoCreate(accountId);
        const preview = await settlementPage.readPreview();
        // Fail-fast ANTES de confirmar: si la UI no coincide con el oraculo no se crea nada.
        await verifyAc(testInfo, 'AC-FR-70', () => {
          expect(preview.total, 'total de la UI == oraculo antes de confirmar').toBeCloseTo(
            expectedTotal,
            2
          );
          return { uiTotal: preview.total, expectedTotal };
        });
        const result = await settlementPage.confirm({
          expectedTotal,
          observations: `QA FR ${id} ${new Date().toISOString().slice(0, 10)}`
        });

        // ---- 3. Post: DB (cabecera, detalle, flags) ----
        const { liquidation, details } = await liquidationFromDb(db, kind, result.liquidationId);
        const chosen = await surrendersByIds(
          db,
          carrierId,
          open.map((r) => r.ID)
        );
        await verifyAc(testInfo, 'AC-FR-71', async () => {
          expect(result.postStatus, 'POST de la liquidacion responde 201').toBe(201);
          expect(
            result.totalShownAfter,
            'el detalle posterior muestra el total liquidado'
          ).toBeCloseTo(expectedTotal, 2);
          expect(
            liquidation,
            `liquidacion ${result.liquidationId} debe existir en DB`
          ).not.toBeNull();
          expectNoMismatch(
            `liquidacion ${kind} ${result.liquidationId}`,
            evaluateCreatedLiquidation({
              kind,
              liquidation: liquidation as NonNullable<typeof liquidation>,
              details,
              chosen,
              untouched: [],
              expectedTotal
            })
          );
          expect(liquidation?.CARRIER_ID, 'la liquidacion pertenece al carrier de la sesion').toBe(
            carrierId
          );
          expect(
            await paidLiquidationsOfSurrender(db, kind, open[0]?.ID as number),
            'la rendicion queda en una liquidacion PAID'
          ).toContain(result.liquidationId);
          return {
            liquidationId: result.liquidationId,
            status: liquidation?.STATUS ?? null,
            total: liquidation?.TOTAL ?? null,
            detailSurrenders: details.map((d) => d.TRAVELSSURRENDER_ID),
            flags: chosen.map((r) => ({
              id: r.ID,
              driver: r.SETTLEMENT_DRIVER,
              owner: r.SETTLEMENT_OWNER
            }))
          };
        });
        // AC-76 (pregunta abierta al PO): el BE no recalcula el total y TRAVEL.ISLIQUIDATED no cambia.
        const postedTotal = (result.postPayload as { total?: unknown } | null)?.total;
        observation(
          testInfo,
          'AC-FR-76',
          describeLiquidationObservation({
            kind,
            liquidationId: result.liquidationId,
            dbTotal: liquidation?.TOTAL ?? null,
            postedTotal: typeof postedTotal === 'number' ? postedTotal : expectedTotal,
            isLiquidated: await readIsLiquidated(
              db,
              open.map((r) => r.ID)
            )
          })
        );

        // ---- 4. Libros intactos y «A liquidar» en cero ----
        const booksAfter = await readBooks(checkingAccountApi, cfg, ownerId);
        await verifyAc(testInfo, 'AC-FR-72', () => {
          expectNoMismatch(
            `libro ${kind}`,
            evaluateBooksUntouched({
              label: kind,
              before: bookBefore,
              after:
                kind === 'driver'
                  ? { rows: booksAfter.driverRows, balance: booksAfter.driver.balance }
                  : { rows: booksAfter.ownerRows, balance: booksAfter.owner.balance }
            })
          );
          return { bookBefore };
        });
        // AC-75: las rendiciones liquidadas salen de pendientes (DB y API); «A liquidar» en 0.
        await verifyAc(testInfo, 'AC-FR-75', async () => {
          const settledIds = open.map((r) => r.ID);
          const dbPending =
            kind === 'driver'
              ? await driverOpenSurrenders(db, { carrierId, driverAccountId: accountId })
              : await ownerOpenSurrenders(db, { carrierId, ownerId: accountId });
          const apiPendingIds =
            kind === 'driver'
              ? (
                  await client.driverUnsettled({ driverAccountId: accountId, to: todayParam() })
                ).map((r) => r.id)
              : ownerSurrenderIds(
                  await client.ownerUnsettled({ ownerId: accountId, to: todayParam() })
                );
          const left = evaluateSettledLeftPending({
            settledSurrenderIds: settledIds,
            dbPendingIds: dbPending.map((r) => r.ID),
            apiPendingIds
          });
          expect(
            left.ok,
            `rendiciones liquidadas que siguen pendientes: ${JSON.stringify(left.mismatches)}`
          ).toBe(true);
          if (kind === 'driver') {
            const after = ((await client.driversSummary()).content ?? []).find(
              (r) => r.driverAccountId === accountId
            );
            expect(Number(after?.toLiquidate ?? 0), 'A liquidar (chofer) queda en 0').toBe(0);
            expect(Number(after?.lastLiquidationId), 'ultima liquidacion = la nueva').toBe(
              result.liquidationId
            );
          } else {
            const after = await client.ownerDetail(accountId);
            expect(Number(after.toLiquidate ?? 0), 'A liquidar (propietario) queda en 0').toBe(0);
          }
          return { settledIds, dbPending: dbPending.map((r) => r.ID), apiPendingIds };
        });
        void otherKind;

        // ---- 5. El viaje liquidado ya no se edita (alerta; el PUT daria 409 TRAVEL_LIQUIDATED) ----
        // Una rendicion liquidada puede no tener fila TRAVEL (ej. 13840): se toma la primera que SI tenga viaje.
        let travelId: number | null = null;
        for (const r of open) {
          travelId = await tripOf(db, r.ID as number);
          if (travelId !== null) break;
        }
        expect(travelId, 'alguna rendicion liquidada debe tener al menos un viaje').not.toBeNull();
        const detail = await travelsApi.getDetail(travelId as number);
        await verifyAc(testInfo, 'AC-FR-73', () => {
          expect(
            kind === 'driver' ? detail.liquidationDriver : detail.liquidationOwner,
            `detalle ${travelId}: flag de liquidacion de ${kind} (TODO verificar nombre del campo en el JSON)`
          ).toBe(true);
          return {
            travelId,
            liquidationDriver: detail.liquidationDriver,
            liquidationOwner: detail.liquidationOwner
          };
        });
        const alertText = await openSettledTripAlert(testInfo, page, travelId as number);
        await verifyAc(testInfo, 'AC-FR-74', () => {
          expect(alertText).toMatch(kind === 'driver' ? /DRIVER|CHOFER/ : /OWNER|PROPIETARIO/);
          return { travelId, alertText };
        });

        const measurement = {
          kind,
          liquidationId: result.liquidationId,
          postPayload: result.postPayload,
          expectedTotal,
          dbHead: liquidation,
          detailSurrenders: details.map((d) => d.TRAVELSSURRENDER_ID),
          bookBefore,
          bookAfter:
            kind === 'driver'
              ? { rows: booksAfter.driverRows, balance: booksAfter.driver.balance }
              : { rows: booksAfter.ownerRows, balance: booksAfter.owner.balance },
          tripChecked: travelId,
          alertText
        };
        await attachJson('3-confirmed', measurement);
        console.info(`FR_${id.replace('-', '')}_SUMMARY ${JSON.stringify(measurement)}`);
        await attachXrayEvidence(testInfo, page, {
          name: `fr-settlement-${kind}-${result.liquidationId}`,
          comment: `FR liquidacion ${kind} ${result.liquidationId}: total ${expectedTotal}, ${open.length} rendiciones, libros intactos, viaje ${String(travelId)} bloqueado.`
        });
      }
    );

  confirmTest('driver', 'FR-SET-3', 'validar-liquidaciones confirmar liquidacion de chofer');
  confirmTest('owner', 'FR-SET-4', 'validar-liquidaciones confirmar liquidacion de propietario');
});
