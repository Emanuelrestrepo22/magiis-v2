// tests/specs/trips/fr-circuit-s3-verify.spec.ts
// FR S3, parte 2/2 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): verifica el viaje que la APP REAL del
// chofer cerro. Lee el handoff de fr-circuit-s3-prepare -> espera DONE (hasta 10 min) -> precio
// final > 0 en EUR, costo = venta, km/tiempo medidos vs simulados (la app recalcula: NO se asevera
// igualdad con la cotizacion) -> lote de rendicion exacto [travelId] con comisiones 40/40/20 ->
// confirmacion IRREVERSIBLE -> delta de libros.
//
// Gate: FR_CONFIRM_SURRENDER=1 (rendicion irreversible). Sin el gate se salta ANTES de leer nada.
// Problema conocido: en TEST el POST toTravelsSurrender puede responder 500 por el PDF
// (TEST COUNTRY 1080 THOUSANDS_SEPARATOR='SPACE') DESPUES de persistir la rendicion; se verifica la
// persistencia por API y se anota `known-issue`; falla solo si no quedo persistida.
// ACs (tests/helpers/acceptance.ts): 02 08 09 10 12 21 22 23 24 25 26 27 28 29 30 31 51; AC-95 (App Driver 2.6.17
// conserva la oferta de un viaje cancelado asignado a mano) es known-issue: solo se anota. Toda asercion
// de negocio vive dentro de verifyAc; DB de solo lectura obligatoria (fixture `db`).
// Horario: NO correr entre 10:00 y 10:20 ART, es decir 13:00-13:20 UTC (cron de rendicion automatica con CASHCOLLECTOR=1 contamina el lote). Sin retries.
import { evaluateBatchExactly } from '../../helpers/surrender-oracle.js';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { DriverBookRow, OwnerBookRow } from '../../api/clients/checkingAccount.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { knownIssue, verifyAc } from '../../helpers/acceptance.js';
import { deltaMovements } from '../../helpers/cc-delta.js';
import { COST_SALE_SCOPE_NOTE, evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import { evaluateSaleCostPairs, evaluateSurrenderRow } from '../../helpers/db-oracle-eval.js';
import {
  evaluateAppRecalc,
  evaluateBalanceDelta,
  evaluateBookCodes,
  evaluateCommissionPreview,
  evaluateNoAgencyBookRow,
  evaluatePaymentColumn,
  evaluateSurrenderHeader,
  expectedManualSurrender,
  formatMismatches,
  nullAsZeroWhereExpectedZero,
  readBatchStateUntilEmpty,
  splitSaleCostMismatches
} from '../../helpers/fr-ac-eval-circuit.js';
import {
  DEFAULT_CARRIER_ID,
  frConfigOrNull,
  optionalInt,
  PCT,
  readBooks,
  readHandoff,
  requireNumberField
} from '../../helpers/fr-circuit.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import {
  movementsOfTravel,
  readSurrenderHeader,
  surrenderIdsOfTrips
} from '../../steps/trips/autoSurrender.steps.js';
import { readSaleCostData, readSurrenderRow } from '../../steps/trips/dbOracles.steps.js';
import { SurrenderFlow } from '../../steps/trips/surrender.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_KEYS, FR_1901_SCOPE_NOTES } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_KEYS.S3_VERIFY;
const STATE_DONE = /^(DONE|6)$/i;
const CLOSE_TIMEOUT_MS = 10 * 60_000;
const KNOWN_ISSUE_NOTE =
  'TEST FR THOUSANDS_SEPARATOR SPACE -> surrender PDF 500 (rendicion persistida)';

const frGate = frConfigOrNull('FR S3 verify', ['FR_CONFIRM_SURRENDER']);

const bookKey = (row: DriverBookRow | OwnerBookRow): string => String(row.origin ?? 'null');

test.describe('Circuito Francia S3 verify (cierre por app, rendicion)', () => {
  test.skip(frGate.config === null, `FR S3 verify saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: CLOSE_TIMEOUT_MS + 300_000 });

  test('FR-S3-verify: validar-circuito-francia cierre por app y rendicion manual', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S3 verify');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(TS_KEY, ROUTE)('FR-S3-verify', 'HP');
    testInfo.annotations.push({ type: 'xray_comment', description: FR_1901_SCOPE_NOTES.S3_VERIFY });
    const handoff = readHandoff();
    const { travelId, ownerId } = handoff;
    const batch = { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId }; // DRIVER.ID
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const surrender = new SurrenderFlow(page, surrenderClient);
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });
    const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
    const stateOf = async (): Promise<string> =>
      String((await travelsApi.getDetail(travelId)).state ?? '');
    // AC-FR-95 (oferta vieja de App Driver) no se anota aca: este flujo cierra por app y no lo ejercita.

    // ---- 1. Esperar el cierre por la app (DONE / 6) ----
    await test.step(`1. Wait for the app to finalize trip ${travelId} (max 10 min)`, async () => {
      await expect
        .poll(stateOf, {
          timeout: CLOSE_TIMEOUT_MS,
          intervals: [5_000, 10_000, 15_000],
          message:
            `el viaje ${travelId} no llego a DONE/6 en 10 min: la app del chofer ${cfg.driverId} no lo cerro ` +
            '(o quedo en otro estado). Cerrarlo en el emulador y volver a correr verify.'
        })
        .toMatch(STATE_DONE);
    });

    const done = await travelsApi.getDetail(travelId);

    // ---- 2. Precio final > 0 en EUR, costo = venta, medido vs simulado ----
    const finalPrice = round2(Number(done.amount));
    const currency = (done.simulationPrice as Record<string, unknown> | null | undefined)
      ?.currencyCode;
    await verifyAc(testInfo, 'AC-FR-09', async () => {
      expect(finalPrice, `precio final del viaje ${travelId} debe ser > 0`).toBeGreaterThan(0);
      // TODO(verificar en TEST): la moneda EUR solo se asevera si el detalle trae
      // simulationPrice.currencyCode; si no, queda null en la evidencia (revisar la captura).
      if (currency !== undefined && currency !== null) {
        expect(String(currency), 'moneda del viaje debe ser EUR').toMatch(/EUR/i);
      }
      return { finalPrice, currencyCode: currency ?? null };
    });
    await verifyAc(testInfo, 'AC-FR-02', async () => {
      if (currency !== undefined && currency !== null) {
        expect(String(currency), 'moneda del viaje debe ser EUR').toMatch(/EUR|€/i);
      }
      return {
        currencyCode: currency ?? null,
        verifiedByApi: currency !== undefined && currency !== null
      };
    });
    const costSale = evaluateCostEqualsSale({
      detail: done,
      label: `FR S3 trip ${travelId}`,
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
    // Medidas de la app: nombres de campo no verificados, se adjuntan los numericos del detalle cuyo
    // nombre sugiere km/distancia/tiempo (sin PII). La app recalcula: no se asevera igualdad con la cotizacion.
    const measured = Object.fromEntries(
      Object.entries(done).filter(
        ([k, v]) => typeof v === 'number' && /km|distance|duration|time|minute/i.test(k)
      )
    );
    await verifyAc(testInfo, 'AC-FR-10', async () => {
      const v = evaluateAppRecalc({
        quote: handoff.simulated,
        apiFinal: finalPrice,
        dbFinal: saleCostData.row.FINALPRICE,
        dbKm: saleCostData.row.KM
      });
      expect(
        v.ok,
        formatMismatches(`cierre por app: recalculo del viaje ${travelId}`, v.mismatches)
      ).toBe(true);
      return {
        simulatedQuote: handoff.simulated,
        finalPrice,
        quoteVsFinalDelta: v.delta,
        differsFromQuote: v.differsFromQuote,
        dbKm: saleCostData.row.KM,
        measuredKmTimeFields: measured
      };
    });
    await attachJson('2-closed-by-app', {
      travelId,
      state: done.state,
      simulatedQuote: handoff.simulated,
      finalPrice,
      currencyCode: currency ?? null,
      quoteVsFinalDelta: round2(finalPrice - handoff.simulated),
      measuredKmTimeFields: measured,
      costSalePairs: costSale.pairs
    });

    // ---- 3. Lote de rendicion = [travelId] exacto, comisiones 40/40/20 ----
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
    const row = apiPreview.rows[0];
    await attachJson('3-surrender-preview', {
      uiTravelIds: ui.travelIds,
      apiTravelIds: apiIds,
      row: {
        paymentMethod: row?.paymentMethod ?? null,
        travelAmount: row?.travelAmount,
        driverCommissionAmount: row?.driverCommissionAmount ?? null,
        ownerCommissionAmount: row?.ownerCommissionAmount ?? null,
        agencyCommissionAmount: row?.agencyCommissionAmount ?? null
      },
      totalCashAmount: apiPreview.totalCashAmount,
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
      // TODO(verificar en TEST): si toSurrend no expone la comision por viaje (null) se verifica en los
      // libros (AC-FR-28) y TRAVELSSURRENDER (AC-FR-30).
      const v = evaluateCommissionPreview(row, base);
      expect(
        v.ok,
        formatMismatches(`comisiones de la vista previa sobre la base ${base}`, v.mismatches)
      ).toBe(true);
      return { exposed: v.exposed, notExposed: v.notExposed, expectedCommission };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s3-preview-${travelId}`,
      comment:
        `FR S3 viaje ${travelId}: cerrado por app, precio final ${finalPrice} (cotizado ${handoff.simulated}); ` +
        `lote exacto [${travelId}], comisiones esperadas propietario ${expectedCommission.owner} / chofer ${expectedCommission.driver} / agencia ${expectedCommission.agency}.`
    });

    // ---- 4. Confirmacion IRREVERSIBLE (gate FR_CONFIRM_SURRENDER=1 dentro del POM) ----
    const confirmStatus = await test.step('4. Confirm surrender (irreversible)', async () =>
      surrender.confirm());

    await verifyAc(testInfo, 'AC-FR-25', async () => {
      if (confirmStatus >= 500) {
        // El 500 llega tras el commit (PDF): se verifica la persistencia por API; falla si no se persistio.
        const r = await readBatchStateUntilEmpty(surrenderClient, batch, travelId);
        expect(
          r.settled,
          `POST toTravelsSurrender respondio ${confirmStatus} y el viaje ${travelId} sigue pendiente tras ${r.elapsedMs} ms: la rendicion NO se persistio (fallo real, no el known-issue del PDF)`
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
      return { stillPending: false, elapsedMs: r.elapsedMs };
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s3-confirmed-${travelId}`,
      comment:
        `FR S3 viaje ${travelId}: rendicion confirmada, POST status ${confirmStatus}.` +
        (confirmStatus >= 500 ? ` Rendicion persistida (lote vacio). ${KNOWN_ISSUE_NOTE}.` : '')
    });

    // ---- 5. Delta de libros de chofer y propietario ----
    const before = handoff.booksBefore;
    const driverAfter = await checkingAccountApi.driverMovements({ driverUserId: cfg.driverId });
    const ownerAfter = await checkingAccountApi.ownerMovements({ ownerId });
    const booksAfter = await readBooks(checkingAccountApi, cfg, ownerId);
    const driverDelta = deltaMovements(before.driver, booksAfter.driver);
    const ownerDelta = deltaMovements(before.owner, booksAfter.owner);
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
    const mapRows = (rows: Array<DriverBookRow | OwnerBookRow>) =>
      rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        paid: r.paid,
        code: r.checkingAccountCode,
        origin: r.origin
      }));

    const summary = {
      tripId: travelId,
      surrenderId,
      surrenderIdSource: 'origin (IDFORCARRIER) de los movimientos nuevos de los libros',
      simulatedAmount: handoff.simulated,
      finalPrice,
      measuredKmTimeFields: measured,
      base,
      expectedCommission,
      confirmStatus,
      knownIssue: confirmStatus >= 500 ? KNOWN_ISSUE_NOTE : null,
      driverBook: {
        added: mapRows(driverNew),
        balanceBefore: before.driver.balance,
        balanceAfter: booksAfter.driver.balance,
        balanceDelta: driverDelta.balanceDelta
      },
      ownerBook: {
        ownerId,
        added: mapRows(ownerNew),
        balanceBefore: before.owner.balance,
        balanceAfter: booksAfter.owner.balance,
        balanceDelta: ownerDelta.balanceDelta
      }
    };
    await attachJson('5-books-delta', summary);
    console.info(`FR_S3_SUMMARY ${JSON.stringify(summary)}`);

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
      // signo (el codigo se juzga en AC-FR-29).
      expect(
        has(ownerNew, expectedCommission.owner),
        `libro del propietario ${ownerId}: no aparece un movimiento = ${expectedCommission.owner} (40% de ${base}); recibido ${JSON.stringify(amountsOf(ownerNew))}`
      ).toBe(true);
      expect(
        has(driverNew, expectedCommission.driver),
        `libro del chofer ${cfg.driverId}: no aparece un movimiento = ${expectedCommission.driver} (40% de ${base}); recibido ${JSON.stringify(amountsOf(driverNew))}`
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
