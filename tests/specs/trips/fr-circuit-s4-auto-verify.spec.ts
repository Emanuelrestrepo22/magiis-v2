// tests/specs/trips/fr-circuit-s4-auto-verify.spec.ts
// FR S4, parte 2/2 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19): verifica el viaje CC que la APP REAL del
// chofer cerro y su destino en la RENDICION AUTOMATICA. Lee `evidence/test/fr-auto-handoff.json`
// (escrito por fr-circuit-s4-auto-prepare) -> espera DONE (hasta 10 min) -> precio final > 0 en EUR, costo =
// venta (API + DB), city taxes = 10 % de la base, recalculo de la app registrado (cotizado vs final y km
// medido; NO se asevera igualdad con la cotizacion) -> 1 cobro TIVR en la CC por el precio final y saldo
// de la CC = ese debito -> completa `closed` en el handoff. Si la rendicion automatica ya corrio
// (TRAVELSSURRENDER_ID != NULL), ademas verifica que la CC no recibio un segundo movimiento; si no, que el
// viaje figura en el lote pendiente con medio de pago distinto de Cash. La verificacion del lote completo
// (comisiones, libros, flag) vive en fr-circuit-s5-auto con FR_AUTO_PHASE=verify.
//
// ACs (registro tests/helpers/acceptance.ts): 09, 08, 10, 11, 47, 48, 49, 23 (lote pendiente), 50 (tras rendir).
// Las aserciones de negocio viven dentro de `verifyAc`; la espera del cierre y las guardas del handoff
// son tecnicas. Solo lectura; sin gates de escritura. Requiere ENV=test, FR_* completos y ORACLE_*_TEST.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { observation, verifyAc } from '../../helpers/acceptance.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { deltaMovements, snapshotClientCc } from '../../helpers/cc-delta.js';
import { COST_SALE_SCOPE_NOTE, evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import { evaluateSaleCostPairs, type MovementRow } from '../../helpers/db-oracle-eval.js';
import {
  evaluateCcChargeOfTrip,
  requireAutoHandoff,
  updateAutoHandoff,
  type AutoTrip
} from '../../helpers/auto-surrender.js';
import {
  evaluateBatchPaymentMethods,
  evaluateCurrencyEur,
  formatMismatches,
  readFinalKm
} from '../../helpers/fr-ac-eval-auto-settlement.js';
import { evaluateAppRecalc, evaluateClientCcBalance } from '../../helpers/fr-ac-eval-circuit.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import { frConfigOrNull, requireNumberField } from '../../helpers/fr-circuit.js';
import { readSaleCostData } from '../../steps/trips/dbOracles.steps.js';
import { movementsOfTravel, surrenderIdsOfTrips } from '../../steps/trips/autoSurrender.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_KEYS } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TS_KEY = FR_1901_KEYS.S4_VERIFY;
const STATE_DONE = /^(DONE|6)$/i;
const CLOSE_TIMEOUT_MS = 10 * 60_000;
const CITY_TAX_PCT = 0.1;
const CITY_TAX_TOL = 0.02; // el redondeo del backend puede diferir 1 centavo por linea.

const frGate = frConfigOrNull('FR S4 auto verify', []);

test.describe('Circuito Francia S4 auto verify (cierre por app, CC y destino en la rendicion automatica)', () => {
  test.skip(frGate.config === null, `FR S4 auto verify saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: CLOSE_TIMEOUT_MS + 300_000 });

  test('FR-S4-auto-verify: validar-circuito-francia cierre por app CC con city taxes', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR S4 auto verify');
    const cfg = frGate.config as FrCircuitConfig;
    makeAnnotate(TS_KEY, ROUTE)('FR-S4-auto-verify', 'HP');
    const handoff = requireAutoHandoff();
    const s4 = handoff.trips.S4;
    expect(s4, 'el handoff no tiene S4: correr fr-circuit-s4-auto-prepare').toBeDefined();
    const trip = s4 as AutoTrip;
    expect(trip.assigned, 'S4 no quedo asignado al chofer (prepare incompleto)').toBe(true);
    const { travelId } = trip;
    const attachJson = (name: string, data: unknown) =>
      testInfo.attach(name, {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json'
      });
    const stateOf = async (): Promise<string> =>
      String((await travelsApi.getDetail(travelId)).state ?? '');

    // ---- 1. Esperar el cierre por la app (DONE / 6) ----
    await test.step(`1. Wait for the app to finalize trip ${travelId} (max 10 min)`, async () => {
      await expect
        .poll(stateOf, {
          timeout: CLOSE_TIMEOUT_MS,
          intervals: [5_000, 10_000, 15_000],
          message:
            `el viaje ${travelId} no llego a DONE/6 en 10 min: la app del chofer ${cfg.driverId} no lo cerro. ` +
            'Cerrarlo en el emulador y volver a correr.'
        })
        .toMatch(STATE_DONE);
    });

    const done = await travelsApi.getDetail(travelId);
    const finalPrice = round2(Number(done.amount));
    const currency = evaluateCurrencyEur(done);

    // ---- 2. Precio final > 0 en EUR (AC-09), costo = venta API + DB (AC-08), recalculo (AC-10), city taxes (AC-11) ----
    await verifyAc(testInfo, 'AC-FR-09', () => {
      expect(finalPrice, `precio final del viaje ${travelId} debe ser > 0`).toBeGreaterThan(0);
      expect(currency.ok, formatMismatches('moneda S4 cerrado', currency.mismatches)).toBe(true);
      if (!currency.verified) {
        observation(
          testInfo,
          'AC-FR-09',
          'el detalle no expone simulationPrice.currencyCode: EUR sin verificar por API.'
        );
      }
      return { finalPrice, currency: currency.currency };
    });
    const costSale = evaluateCostEqualsSale({
      detail: done,
      label: `FR S4 trip ${travelId}`,
      expectOtherCost: true
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
    const measured = Object.fromEntries(
      Object.entries(done).filter(
        ([k, v]) => typeof v === 'number' && /km|distance|duration|time|minute/i.test(k)
      )
    );
    await verifyAc(testInfo, 'AC-FR-10', async () => {
      const dbData = await readSaleCostData(oracle, travelId);
      const recalc = evaluateAppRecalc({
        quote: trip.simulated,
        apiFinal: finalPrice,
        dbFinal: dbData.row.FINALPRICE,
        dbKm: await readFinalKm(oracle, travelId)
      });
      expect(
        recalc.ok,
        formatMismatches(`recalculo por app viaje ${travelId}`, recalc.mismatches)
      ).toBe(true);
      return {
        quote: trip.simulated,
        finalPrice,
        dbFinalPrice: dbData.row.FINALPRICE,
        quoteVsFinalDelta: recalc.delta,
        recalculated: recalc.differsFromQuote,
        measuredKmTimeFields: measured
      };
    });
    const cityTax = requireNumberField(done, FR_FACTS.detailFields.otherTotal.value);
    const tolls = requireNumberField(done, FR_FACTS.detailFields.toll.value);
    const parking = requireNumberField(done, FR_FACTS.detailFields.parking.value);
    const base = round2(finalPrice - cityTax - tolls - parking);
    await verifyAc(testInfo, 'AC-FR-11', () => {
      expect(
        cityTax,
        `el detalle del viaje ${travelId} debe traer otherCost (city taxes) > 0`
      ).toBeGreaterThan(0);
      expect(
        Math.abs(cityTax - round2(CITY_TAX_PCT * base)),
        `city taxes ${cityTax} debe ser 10 % de la base ${base} (venta ${finalPrice})`
      ).toBeLessThanOrEqual(CITY_TAX_TOL);
      return { cityTax, base, tolls, parking };
    });
    await attachJson('2-closed-by-app', {
      travelId,
      state: done.state,
      simulatedQuote: trip.simulated,
      finalPrice,
      quoteVsFinalDelta: round2(finalPrice - trip.simulated),
      cityTax,
      base,
      currencyCode: currency.currency,
      costSalePairs: costSale.pairs
    });
    await attachXrayEvidence(testInfo, page, {
      name: `fr-s4-closed-${travelId}`,
      comment: `FR S4 viaje ${travelId}: cerrado por app, precio final ${finalPrice} (cotizado ${trip.simulated}), city taxes ${cityTax}.`
    });

    // ---- 3. Un cobro TIVR AUTOMATIC en la CC por el precio final (DB y API) y saldo de la CC ----
    const closedTrip: AutoTrip = {
      ...trip,
      closed: { finalPrice, cityTax, tolls, parking, closedAt: new Date().toISOString() }
    };
    const ccCharge = evaluateCcChargeOfTrip(
      await movementsOfTravel(oracle, cfg.ccId, closedTrip.travelId),
      closedTrip
    );
    const apiRows = await checkingAccountApi.movementsByTravel({
      travelId,
      checkingAccountId: cfg.ccId
    });
    await verifyAc(testInfo, 'AC-FR-47', () => {
      expect(
        ccCharge.ok,
        formatMismatches(`cobro CC del viaje ${travelId}`, ccCharge.mismatches)
      ).toBe(true);
      expect(apiRows, 'la CC (API) debe mostrar exactamente UN cobro del viaje').toHaveLength(1);
      const movement = ccCharge.movement as MovementRow;
      return {
        movementId: movement.ID,
        code: movement.MOVEMENT_CODE,
        type: movement.MOVEMENT_TYPE
      };
    });
    await verifyAc(testInfo, 'AC-FR-48', () => {
      const movement = ccCharge.movement as MovementRow;
      expect(round2(Number(movement.MOUNT)), 'MOUNT (DB) = precio final').toBe(finalPrice);
      expect(round2(Number(apiRows[0]?.debit)), 'debito (API) = precio final').toBe(finalPrice);
      expect(round2(Number(apiRows[0]?.credit ?? 0)), 'credito (API) = 0').toBe(0);
      return {
        mount: movement.MOUNT,
        debit: apiRows[0]?.debit ?? null,
        credit: apiRows[0]?.credit ?? null
      };
    });
    await verifyAc(testInfo, 'AC-FR-49', async () => {
      const clientPage = await checkingAccountApi.page({
        checkingAccountId: cfg.ccId,
        size: 200,
        sort: 'DESC'
      });
      const rows = clientPage.content ?? [];
      const after = snapshotClientCc(rows, rows[0]?.balance ?? null);
      const delta = deltaMovements(handoff.booksBefore.client, after);
      const v = evaluateClientCcBalance({
        travelId,
        debit: finalPrice,
        added: delta.added,
        balanceDeltaDb: delta.balanceDelta
      });
      expect(v.ok, formatMismatches(`saldo CC ${cfg.ccId} (convencion DB)`, v.mismatches)).toBe(
        true
      );
      if (v.foreign.length > 0) {
        observation(
          testInfo,
          'AC-FR-49',
          `movimientos ajenos durante el run en la CC ${cfg.ccId}: ${v.foreign.map((r) => r.key).join(', ')}`
        );
      }
      return {
        balanceDeltaDb: delta.balanceDelta,
        own: v.own.map((r) => r.key),
        foreign: v.foreign.map((r) => r.key),
        sign: v.sign
      };
    });
    await attachJson('3-cc-charge', {
      movementId: ccCharge.movement?.ID ?? null,
      code: ccCharge.movement?.MOVEMENT_CODE ?? null,
      mount: ccCharge.movement?.MOUNT ?? null
    });
    updateAutoHandoff(
      (h) => ({
        ...h,
        trips: { ...h.trips, S4: { ...(h.trips.S4 as AutoTrip), closed: closedTrip.closed } }
      }),
      () => handoff
    );

    // ---- 4. Segun el estado de la rendicion automatica ----
    const surrenderId = (await surrenderIdsOfTrips(oracle, [travelId])).get(travelId) ?? null;
    if (surrenderId === null) {
      // Lote pendiente: el viaje cerrado figura con medio de pago de CC (distinto de Cash).
      await verifyAc(testInfo, 'AC-FR-23', async () => {
        const batch = await new SurrenderClient(carrierApi, carrierSession).preview({
          driverUserId: cfg.driverId,
          vehicleId: cfg.vehicleId
        });
        const v = evaluateBatchPaymentMethods(batch.rows, [{ travelId, kind: 'CHECKING_ACCOUNT' }]);
        expect(v.ok, formatMismatches('columna de pago del lote (S4 CC)', v.mismatches)).toBe(true);
        return {
          paymentMethod: batch.rows.find((r) => r.travelId === travelId)?.paymentMethod ?? null
        };
      });
      testInfo.annotations.push({
        type: 'info',
        description: `S4 cerrado; la rendicion automatica aun no corrio (viaje ${travelId} pendiente). Disparar/esperar y correr fr-circuit-s5-auto verify.`
      });
      return;
    }
    // sigue habiendo UN cobro: la rendicion no mueve la CC del cliente
    await verifyAc(testInfo, 'AC-FR-50', async () => {
      const after = evaluateCcChargeOfTrip(
        await movementsOfTravel(oracle, cfg.ccId, travelId),
        closedTrip
      );
      expect(
        after.ok,
        formatMismatches(`cobro CC del viaje ${travelId} tras la rendicion`, after.mismatches)
      ).toBe(true);
      return { surrenderId, movementType: after.movement?.MOVEMENT_TYPE ?? null };
    });
    observation(
      testInfo,
      'AC-FR-23',
      `viaje ${travelId} ya rendido (rendicion ${surrenderId}): el lote pendiente no lo lista; columna de pago no verificable en esta corrida.`
    );
    await attachJson('4-in-automatic-surrender', { travelId, surrenderId });
  });
});
