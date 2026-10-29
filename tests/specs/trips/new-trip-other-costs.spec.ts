// tests/specs/trips/new-trip-other-costs.spec.ts
// MG-995 / MG-996 (Universal F1, epic MG-990) — Otros Costos en el alta de viaje (Nuevo Viaje,
// Carrier V2). ATR de automatización: TM-1280 (UAT, estado vigente). Fase 1 = 8 Tests Xray:
// TM-1084, TM-1085, TM-1086, TM-1087, TM-1090, TM-1091, TM-1277, TM-1279 (1 test() = 1 Test).
//
// Recorrido (plan MG-990-fase1 §5.2): conceptos por API (prefijo «QA E2E OC ») → alta por UI de
// Nuevo Viaje con los conceptos → oráculo en UI (línea, Otros Costos, Total) y en API
// (`GET travels/{id}` → `simulationPrice.otherCosts[]`; catálogo `otherCosts/search`) → evidencia
// (captura + medición JSON + comentario `xray_comment`) → limpieza por API en el teardown del
// fixture (viaje cancelado, conceptos dados de baja) aunque el test falle.
// TM-1277 y TM-1279 NO guardan el alta.
//
// Oráculo de persistencia: API. Los Gherkin piden «en base se verifica…», pero la base de UAT no
// es alcanzable desde V2 (BL-046): la sustitución se declara en el comentario de cada run.
//
// Hallazgos de producto conocidos (NUNCA codificados como esperado):
// - D1: el widget «Datos Presupuestados» del detalle vuelve a multiplicar los conceptos Cantidad
//   (`quantity × total`). Con cantidad > 1 (TM-1085, TM-1090) el widget NO se asevera: se asevera
//   la API y el listado, y el valor del widget queda en la medición como `known-defect`.
// - O-UAT-03: el ABM descarta el signo menos. La clase negativa de TM-1279 se prepara por API;
//   si el backend la rechaza o la altera, TM-1279 termina en skip explícito («regla de negativos
//   pendiente de PO»), nunca PASSED.
//
// Gate OTHER_COSTS_CREATE_DATA=1: crea conceptos y viajes reales en el ambiente. Sin el gate el spec
// se salta (smoke y regresión no generan datos). Solo UAT en la fase 1 (plan §6).
// Corrida local del agente (sin login con contraseña, sesión guardada):
//   OTHER_COSTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 ENV=uat npx playwright test \
//     tests/specs/trips/new-trip-other-costs.spec.ts --project=carrier-v2-desktop --workers=1
import { test as base, expect } from '../../fixtures/carrierApiFixture.js';
import { OtherCostsClient } from '../../api/clients/otherCosts.client.js';
import { TravelsClient } from '../../api/clients/travels.client.js';
import {
  fixedOtherCost,
  percentageOtherCost,
  quantityOtherCost,
  variableOtherCost,
  type OtherCostApply,
  type OtherCostContext
} from '../../fixtures/factories/otherCostFactory.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { otherCostsDataFor } from '../../data/carrier-v2/trips/other-costs.js';
import { expectedLineAmount } from '../../data/carrier-v2/trips/other-costs.rules.f1.js';
import {
  NewTripOtherCostsFlow,
  recoverLeakedTrips,
  simulationItem,
  travelDetailView
} from '../../steps/trips/newTripWithOtherCosts.steps.js';
import { round2 } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const ENV = getCurrentEnv();
const DATA = otherCostsDataFor(ENV);

// Keys Xray como constantes sueltas (scripts/extract-tc-map.ts no resuelve mapas).
const TM_TC103 = 'TM-1084';
const TM_TC104 = 'TM-1085';
const TM_TC105 = 'TM-1086';
const TM_TC106 = 'TM-1087';
const TM_TC109 = 'TM-1090';
const TM_TC110 = 'TM-1091';
const TM_TC115 = 'TM-1277';
const TM_TC116 = 'TM-1279';

const MAX_VALUE_ERROR = /cannot exceed the maximum value|no puede superar el valor m[aá]ximo/i;

const test = base.extend<{ flow: NewTripOtherCostsFlow }>({
  flow: async ({ page, carrierSession, otherCostsApi, travelsApi }, use, testInfo) => {
    if (!DATA) {
      throw new Error(`sin datos de la familia Otros Costos para ENV=${ENV}`);
    }
    const flow = new NewTripOtherCostsFlow(
      page,
      testInfo,
      carrierSession,
      otherCostsApi,
      travelsApi,
      DATA
    );
    try {
      await use(flow);
    } finally {
      await flow.cleanup();
    }
  }
});

test.describe('Nuevo Viaje - otros costos (MG-995/MG-996 fase 1, ATR TM-1280)', () => {
  test.skip(
    process.env.OTHER_COSTS_CREATE_DATA !== '1',
    'crea conceptos y viajes reales en el ambiente; correr con OTHER_COSTS_CREATE_DATA=1'
  );
  test.skip(
    DATA === null,
    `la familia Otros Costos no tiene datos de ruta para ENV=${ENV} (fase 1: solo uat)`
  );

  // Google Places + simulateAll dependen de servicios externos (patrón de los specs de alta).
  // SIN retries (se hereda RETRIES=0 del config): cada intento crea viajes y conceptos reales, y un
  // reintento que pasa ocultaría en Xray la falla del primer intento.
  test.describe.configure({ timeout: 240_000 });

  // Barrido de corridas anteriores: conceptos con el prefijo de la automatización (> 24 h) y viajes
  // que quedaron anotados en el registro local sin cancelar (corrida cortada o limpieza fallida).
  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await new OtherCostsClient(carrierApi, carrierSession).sweep();
    const trips = await recoverLeakedTrips(
      new TravelsClient(carrierApi, carrierSession),
      carrierSession.env
    );
    if (trips.failed.length > 0) {
      console.warn(
        `[otros costos] viajes de corridas previas sin poder cancelar (quedan anotados): ${trips.failed.join(' | ')}`
      );
    }
  });

  test.describe('@P1 @functional MG-995 MG-996 Nuevo Viaje - otros costos (smoke)', () => {
    test('TC103 Refleja en el detalle del viaje un concepto Fijo con costo configurado', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC103, ROUTE)('TC103', 'HP');
      const a = flow.data.amounts.tm1084;
      const concept = await flow.createConcept(
        fixedOtherCost(await flow.conceptContext(), a.sale, { cost: a.cost })
      );
      const expected = expectedLineAmount({ type: 'FIX', sale: a.sale });

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      await flow.newTrip.addOtherCost({ name: concept.concept });
      const after = await flow.readSummary();
      const line = await flow.lineAmount(concept.concept);
      await flow.screenshot(`${TM_TC103}-alta-con-concepto`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const persisted = simulationItem(detail, concept.id);
      const ui = await flow.openDetail(saved.travelId, { expectBudgetedOtherCosts: true });
      await flow.screenshot(`${TM_TC103}-detalle`);

      await flow.attachMeasurement(TM_TC103, {
        concepts: flow.conceptsView([concept]),
        ui: { before, after, line, detailBudgetedOtherCosts: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Concepto FIX ${concept.id} (venta ${a.sale}, costo ${a.cost}). UI: línea ${line}, ` +
          `Otros Costos ${before.otherCosts}→${after.otherCosts}, Total ${before.total}→${after.total}. ` +
          `Alta ${saved.travelId} (${ui.tripCode}) con Enviar Manual: request ${JSON.stringify(saved.requestOtherCosts)}. ` +
          `API simulationPrice.otherCosts: price ${persisted?.price ?? 'ausente'}, cantidad ${persisted?.quantity ?? '-'}. ` +
          `Detalle, widget Datos Presupuestados: ${ui.budgetedOtherCosts ?? 'sin fila'}.`
      );

      expect.soft(line, 'la línea del Fijo debe mostrar su venta').toBe(expected);
      expect
        .soft(after.otherCosts, 'Otros Costos suma el Fijo')
        .toBe(round2(before.otherCosts + expected));
      expect.soft(after.subtotal, 'el concepto no altera el Subtotal').toBe(before.subtotal);
      expect
        .soft(after.total, 'el Total suma el Fijo (más la variación de impuestos, si los hay)')
        .toBe(round2(before.total + expected + (after.taxes - before.taxes)));
      expect
        .soft(saved.requestOtherCosts, 'el alta envía el concepto con cantidad 1 y su venta')
        .toEqual([expect.objectContaining({ id: concept.id, quantity: 1, price: expected })]);
      expect(persisted, 'el concepto debe persistir en simulationPrice.otherCosts').not.toBeNull();
      expect.soft(persisted?.quantity).toBe(1);
      expect.soft(persisted?.price, 'importe persistido = venta del Fijo').toBe(expected);
      expect(ui.budgetedOtherCosts, 'el detalle refleja el Fijo (cantidad 1: sin D1)').toBe(
        expected
      );
      // Control positivo del contador de altas que usan TM-1277/TM-1279 («el alta no se guarda»):
      // si la regex del POST dejara de matchear, este 1 caería a 0 y lo haría visible.
      expect(flow.createTravelRequestCount, 'un guardado = un POST de alta contado').toBe(1);
    });

    test('TC109 Refleja varios conceptos de tipos distintos, cada uno con su importe', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC109, ROUTE)('TC109', 'HP');
      const a = flow.data.amounts.tm1090;
      const fixed = await flow.createConcept(
        fixedOtherCost(await flow.conceptContext({ label: 'F' }), a.fixedSale, {
          cost: a.fixedCost
        })
      );
      const quantity = await flow.createConcept(
        quantityOtherCost(await flow.conceptContext({ label: 'Q' }), a.quantitySale, {
          cost: a.quantityCost
        })
      );
      const percentage = await flow.createConcept(
        percentageOtherCost(await flow.conceptContext({ label: 'P' }), a.percent, {
          cost: a.costPercent
        })
      );

      const before = await flow.startQuotedTrip('long');
      const header = await flow.commentHeader();
      await flow.newTrip.addOtherCost({ name: fixed.concept });

      // Riesgo más allá del AC: el concepto ya aplicado no se vuelve a ofrecer (ts:7837-7838).
      const modal = await flow.newTrip.openAddOtherCostModal();
      await modal.conceptSelect.click();
      await expect(
        modal.conceptOption(quantity.concept),
        'el combo cargó el catálogo (control: el Cantidad todavía se ofrece)'
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        modal.conceptOption(fixed.concept),
        'el Fijo ya aplicado no debe volver a ofrecerse'
      ).toHaveCount(0);
      await modal.close();

      await flow.newTrip.addOtherCost({ name: quantity.concept, quantity: a.quantity });
      await flow.newTrip.addOtherCost({ name: percentage.concept });
      const after = await flow.readSummary();
      const lines = {
        fixed: await flow.lineAmount(fixed.concept),
        quantity: await flow.lineAmount(quantity.concept),
        percentage: await flow.lineAmount(percentage.concept)
      };
      await flow.screenshot(`${TM_TC109}-alta-con-conceptos`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const persisted = {
        fixed: simulationItem(detail, fixed.id),
        quantity: simulationItem(detail, quantity.id),
        percentage: simulationItem(detail, percentage.id)
      };
      const fare = detail.simulationPrice?.pricePointToPoint;
      const ui = await flow.openDetail(saved.travelId);
      const listing = await flow.openDashboardBudget(ui.tripCode);
      await flow.screenshot(`${TM_TC109}-listado`);

      const expectedFixed = expectedLineAmount({ type: 'FIX', sale: a.fixedSale });
      const expectedQuantity = expectedLineAmount({
        type: 'QTY',
        sale: a.quantitySale,
        quantity: a.quantity
      });
      flow.knownDefect(
        `D1 (preexistente): el widget Datos Presupuestados muestra Otros Costos ${ui.budgetedOtherCosts ?? 'sin fila'}; ` +
          'no se asevera (multiplica de más el concepto Cantidad).'
      );
      await flow.attachMeasurement(TM_TC109, {
        concepts: flow.conceptsView([fixed, quantity, percentage]),
        ui: { before, after, lines, listingBudget: listing.text, widgetD1: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Conceptos FIX ${fixed.id}, QTY ${quantity.id} (×${a.quantity}), PCT ${percentage.id} (${a.percent}%), ruta larga. ` +
          `UI líneas ${lines.fixed} / ${lines.quantity} / ${lines.percentage}; Otros Costos ${after.otherCosts}; Total ${after.total}. ` +
          `Alta ${saved.travelId} (${ui.tripCode}). API: ${persisted.fixed?.price ?? '-'} / ${persisted.quantity?.price ?? '-'}` +
          ` (cant ${persisted.quantity?.quantity ?? '-'}) / ${persisted.percentage?.price ?? '-'}; tarifa ${fare ?? '-'}. ` +
          `Listado Presup. ${listing.text}. Widget del detalle no aseverado (D1).`
      );

      expect(typeof fare, 'el detalle debe traer la tarifa (pricePointToPoint)').toBe('number');
      const expectedPercentage = expectedLineAmount({
        type: 'PCT',
        percent: a.percent,
        base: fare as number
      });
      expect.soft(lines.fixed).toBe(expectedFixed);
      expect.soft(lines.quantity, 'Cantidad = unitario × cantidad').toBe(expectedQuantity);
      expect
        .soft(lines.percentage, 'el Porcentaje se calcula sobre la tarifa, no sobre el acumulado')
        .toBe(expectedPercentage);
      expect
        .soft(after.otherCosts)
        .toBe(round2(before.otherCosts + expectedFixed + expectedQuantity + expectedPercentage));
      expect(saved.requestOtherCosts, 'el alta envía los tres conceptos').toHaveLength(3);
      expect(
        detail.simulationPrice?.otherCosts ?? [],
        'persisten tres conceptos presupuestados'
      ).toHaveLength(3);
      expect.soft(persisted.fixed?.price).toBe(expectedFixed);
      expect.soft(persisted.quantity?.quantity).toBe(a.quantity);
      expect
        .soft(persisted.quantity?.price, 'Cantidad persistida = total de la línea')
        .toBe(expectedQuantity);
      expect
        .soft(persisted.percentage?.price, 'Porcentaje persistido = round2(tarifa × %)')
        .toBe(expectedPercentage);
      expect(listing.amount, 'el listado «Presup.» refleja el Total cotizado').toBe(after.total);
    });
  });

  test.describe('@P2 @functional MG-995 MG-996 Nuevo Viaje - otros costos', () => {
    test('TC104 Refleja el importe de un concepto Cantidad multiplicado por la cantidad indicada', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC104, ROUTE)('TC104', 'HP');
      const a = flow.data.amounts.tm1085;
      const concept = await flow.createConcept(
        quantityOtherCost(await flow.conceptContext(), a.unitSale, { cost: a.unitCost })
      );
      const expected = expectedLineAmount({ type: 'QTY', sale: a.unitSale, quantity: a.quantity });

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      await flow.newTrip.addOtherCost({ name: concept.concept, quantity: a.quantity });
      await expect
        .soft(
          flow.newTrip.otherCostLine(concept.concept),
          'la línea del Cantidad muestra la cantidad indicada'
        )
        .toContainText(`×${a.quantity}`);
      const after = await flow.readSummary();
      const line = await flow.lineAmount(concept.concept);
      await flow.screenshot(`${TM_TC104}-alta-con-concepto`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const persisted = simulationItem(detail, concept.id);
      const ui = await flow.openDetail(saved.travelId);
      const listing = await flow.openDashboardBudget(ui.tripCode);
      await flow.screenshot(`${TM_TC104}-listado`);

      flow.knownDefect(
        `D1 (preexistente): el widget Datos Presupuestados muestra Otros Costos ${ui.budgetedOtherCosts ?? 'sin fila'} ` +
          `para ${a.quantity} × ${a.unitSale}; no se asevera.`
      );
      await flow.attachMeasurement(TM_TC104, {
        concepts: flow.conceptsView([concept]),
        ui: { before, after, line, listingBudget: listing.text, widgetD1: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Concepto QTY ${concept.id} (unitario ${a.unitSale}, costo ${a.unitCost}) × ${a.quantity}. ` +
          `UI: línea ${line}, Otros Costos ${before.otherCosts}→${after.otherCosts}, Total ${after.total}. ` +
          `Alta ${saved.travelId} (${ui.tripCode}): request ${JSON.stringify(saved.requestOtherCosts)}. ` +
          `API: price ${persisted?.price ?? 'ausente'}, cantidad ${persisted?.quantity ?? '-'}. ` +
          `Listado Presup. ${listing.text}. Widget del detalle no aseverado (D1).`
      );

      expect.soft(line, 'Cantidad = unitario × cantidad').toBe(expected);
      expect.soft(after.otherCosts).toBe(round2(before.otherCosts + expected));
      expect.soft(after.total).toBe(round2(before.total + expected + (after.taxes - before.taxes)));
      expect(persisted, 'el concepto debe persistir en simulationPrice.otherCosts').not.toBeNull();
      expect.soft(persisted?.quantity).toBe(a.quantity);
      expect.soft(persisted?.price, 'importe persistido = total de la línea').toBe(expected);
      expect(listing.amount, 'el listado «Presup.» refleja el Total cotizado').toBe(after.total);
    });

    test('TC105 Refleja el importe de un concepto Porcentaje calculado sobre la tarifa', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC105, ROUTE)('TC105', 'HP');
      const a = flow.data.amounts.tm1086;
      const concept = await flow.createConcept(
        percentageOtherCost(await flow.conceptContext(), a.percent, { cost: a.costPercent })
      );

      const before = await flow.startQuotedTrip('long');
      const header = await flow.commentHeader();
      const vehiclePrice = await flow.selectedVehiclePrice();
      await flow.newTrip.addOtherCost({ name: concept.concept });
      const after = await flow.readSummary();
      const line = await flow.lineAmount(concept.concept);
      await flow.screenshot(`${TM_TC105}-alta-con-concepto`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const persisted = simulationItem(detail, concept.id);
      const fare = detail.simulationPrice?.pricePointToPoint;
      const ui = await flow.openDetail(saved.travelId, { expectBudgetedOtherCosts: true });
      await flow.screenshot(`${TM_TC105}-detalle`);

      await flow.attachMeasurement(TM_TC105, {
        concepts: flow.conceptsView([concept]),
        ui: { before, after, line, vehiclePrice, detailBudgetedOtherCosts: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Concepto PCT ${concept.id} (${a.percent}%, costo ${a.costPercent}%), ruta larga. ` +
          `UI: vehículo ${vehiclePrice}, línea ${line}, Total ${before.total}→${after.total}. ` +
          `Alta ${saved.travelId} (${ui.tripCode}): request (sin redondear, solo se registra) ${JSON.stringify(saved.requestOtherCosts)}. ` +
          `API: tarifa ${fare ?? '-'}, price ${persisted?.price ?? 'ausente'}. Widget del detalle ${ui.budgetedOtherCosts ?? 'sin fila'}.`
      );

      expect(typeof fare, 'el detalle debe traer la tarifa (pricePointToPoint)').toBe('number');
      const expected = expectedLineAmount({
        type: 'PCT',
        percent: a.percent,
        base: fare as number
      });
      expect(persisted, 'el concepto debe persistir en simulationPrice.otherCosts').not.toBeNull();
      expect.soft(persisted?.price, 'importe persistido = round2(tarifa × % / 100)').toBe(expected);
      expect.soft(line, 'la línea muestra el mismo importe que se persiste').toBe(expected);
      expect.soft(after.otherCosts).toBe(round2(before.otherCosts + expected));
      expect(ui.budgetedOtherCosts, 'el detalle refleja el Porcentaje (cantidad 1: sin D1)').toBe(
        expected
      );
    });

    test('TC106 Refleja exactamente el importe cargado de un concepto Variable', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC106, ROUTE)('TC106', 'HP');
      const a = flow.data.amounts.tm1087;
      const concept = await flow.createConcept(
        variableOtherCost(await flow.conceptContext(), { maxSale: a.maxSale, maxCost: a.maxCost })
      );
      const expected = expectedLineAmount({ type: 'VAR', amount: Number(a.amount) });

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      await flow.newTrip.addOtherCost({ name: concept.concept, amount: a.amount });
      const after = await flow.readSummary();
      const line = await flow.lineAmount(concept.concept);
      await flow.screenshot(`${TM_TC106}-alta-con-concepto`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const persisted = simulationItem(detail, concept.id);
      const ui = await flow.openDetail(saved.travelId, { expectBudgetedOtherCosts: true });
      await flow.screenshot(`${TM_TC106}-detalle`);

      await flow.attachMeasurement(TM_TC106, {
        concepts: flow.conceptsView([concept]),
        ui: { before, after, line, detailBudgetedOtherCosts: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Concepto VAR ${concept.id} (topes ${a.maxSale}/${a.maxCost}), importe tecleado ${a.amount}. ` +
          `UI: línea ${line}, Total ${before.total}→${after.total}. Alta ${saved.travelId} (${ui.tripCode}): ` +
          `request ${JSON.stringify(saved.requestOtherCosts)}. API price ${persisted?.price ?? 'ausente'}. ` +
          `Widget del detalle ${ui.budgetedOtherCosts ?? 'sin fila'}.`
      );

      expect.soft(line, 'la línea muestra exactamente el importe tecleado').toBe(expected);
      expect.soft(after.otherCosts).toBe(round2(before.otherCosts + expected));
      expect.soft(after.total).toBe(round2(before.total + expected + (after.taxes - before.taxes)));
      expect
        .soft(saved.requestOtherCosts)
        .toEqual([expect.objectContaining({ id: concept.id, quantity: 1, price: expected })]);
      expect(persisted, 'el concepto debe persistir en simulationPrice.otherCosts').not.toBeNull();
      expect.soft(persisted?.price, 'importe persistido sin redondeo inesperado').toBe(expected);
      expect(ui.budgetedOtherCosts, 'el detalle refleja el Variable (cantidad 1: sin D1)').toBe(
        expected
      );
    });

    test('TC110 Descarta un concepto quitado antes de guardar el alta', async ({
      flow,
      travelsApi
    }) => {
      makeAnnotate(TM_TC110, ROUTE)('TC110', 'EC');
      const a = flow.data.amounts.tm1091;
      const concept = await flow.createConcept(
        fixedOtherCost(await flow.conceptContext(), a.sale, { cost: a.cost })
      );
      const expected = expectedLineAmount({ type: 'FIX', sale: a.sale });

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      // «Vuelve al inicial» solo significa «sin conceptos» si el alta arrancó sin ninguno.
      expect.soft(before.otherCosts, 'el alta arranca sin conceptos cargados').toBe(0);
      expect.soft(before.lines, 'el alta arranca sin líneas de Otros Costos').toHaveLength(0);
      await flow.newTrip.addOtherCost({ name: concept.concept });
      const withConcept = await flow.readSummary();
      await flow.newTrip.removeOtherCost(concept.concept);
      const afterRemove = await flow.readSummary();
      await flow.screenshot(`${TM_TC110}-concepto-quitado`);

      const saved = await flow.saveManually();
      const detail = await travelsApi.getDetail(saved.travelId);
      const ui = await flow.openDetail(saved.travelId);
      await flow.screenshot(`${TM_TC110}-detalle`);

      await flow.attachMeasurement(TM_TC110, {
        concepts: flow.conceptsView([concept]),
        ui: { before, withConcept, afterRemove, detailBudgetedOtherCosts: ui.budgetedOtherCosts },
        travelId: saved.travelId,
        tripCode: ui.tripCode,
        requestOtherCosts: saved.requestOtherCosts,
        detail: travelDetailView(detail)
      });
      flow.comment(
        `${header} Concepto FIX ${concept.id} (venta ${a.sale}) agregado y quitado antes de guardar. ` +
          `UI: Otros Costos ${before.otherCosts}→${withConcept.otherCosts}→${afterRemove.otherCosts}, ` +
          `Total ${before.total}→${withConcept.total}→${afterRemove.total}. Alta ${saved.travelId} (${ui.tripCode}): ` +
          `request otherCosts ${JSON.stringify(saved.requestOtherCosts)}. ` +
          `API simulationPrice.otherCosts: ${(detail.simulationPrice?.otherCosts ?? []).length} ítems.`
      );

      expect
        .soft(withConcept.otherCosts, 'control: el concepto sumó antes de quitarlo')
        .toBe(round2(before.otherCosts + expected));
      expect
        .soft(afterRemove.otherCosts, 'quitar el concepto vuelve Otros Costos al inicial')
        .toBe(before.otherCosts);
      expect
        .soft(afterRemove.total, 'quitar el concepto vuelve el Total al inicial')
        .toBe(before.total);
      expect(saved.requestOtherCosts ?? [], 'el alta no envía el concepto quitado').toEqual([]);
      // La ausencia de la fila del widget NO se asevera: la fila también falta mientras el widget no
      // terminó de pintar y cuando el total es 0 (TravelDetailPage), así que un toHaveCount(0) no
      // detectaría nada. El oráculo de «no persiste» es la API (arriba) y el request del alta.
      expect(
        detail.simulationPrice?.otherCosts ?? [],
        'no persiste ningún concepto presupuestado'
      ).toHaveLength(0);
    });

    test('TC115 Respeta el tope de venta de un Variable con ambos topes al agregarlo en el alta', async ({
      flow
    }) => {
      makeAnnotate(TM_TC115, ROUTE)('TC115', 'EC');
      const a = flow.data.amounts.tm1277;
      const concept = await flow.createConcept(
        variableOtherCost(await flow.conceptContext(), { maxSale: a.maxSale, maxCost: a.maxCost })
      );
      const catalog = await flow.catalogItem(concept.id);

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      expect.soft(before.otherCosts, 'paso 1: el alta arranca sin conceptos cargados').toBe(0);
      expect.soft(before.lines, 'paso 1: sin líneas de Otros Costos').toHaveLength(0);
      const modal = await flow.newTrip.openAddOtherCostModal();
      await modal.selectConcept(concept.concept);
      const maxLabel = ((await modal.maxValueLabel.textContent()) ?? '').trim();
      const maxShown = await modal.readMaxValue();

      // Paso 3 del Test + BVA del tope (plan §5.6): válido, en el tope, tope + 1, fuera de tope.
      const bva: Record<string, { acceptEnabled: boolean; errors: number }> = {};
      const capError = modal.validationErrors.filter({ hasText: MAX_VALUE_ERROR });
      for (const value of [a.accepted, a.maxSale, a.maxSale + 1, a.rejected]) {
        const withinCap = value <= a.maxSale;
        await modal.setAmount(value);
        await expect
          .soft(
            modal.acceptButton,
            `con ${value} Aceptar ${withinCap ? 'se habilita' : 'se deshabilita'}`
          )
          .toBeEnabled({ enabled: withinCap });
        await expect
          .soft(capError, `con ${value} ${withinCap ? 'no hay' : 'aparece'} el mensaje de tope`)
          .toHaveCount(Number(!withinCap));
        bva[String(value)] = {
          acceptEnabled: await modal.acceptButton.isEnabled(),
          errors: await capError.count()
        };
      }
      await flow.screenshot(`${TM_TC115}-modal-tope-superado`);

      // Paso 4: volver al importe válido y aceptar, sin guardar el viaje.
      await modal.setAmount(a.accepted);
      await modal.accept();
      const after = await flow.readSummary();
      const line = await flow.lineAmount(concept.concept);
      await flow.screenshot(`${TM_TC115}-concepto-agregado`);
      await flow.leaveWithoutSaving();

      await flow.attachMeasurement(TM_TC115, {
        concepts: flow.conceptsView([concept]),
        catalog: catalog ? flow.conceptsView([catalog]) : null,
        ui: { before, after, line, maxLabel, maxShown, bva },
        createTravelRequests: flow.createTravelRequestCount
      });
      flow.comment(
        `${header} Concepto VAR ${concept.id} con Costo encendido (topes ${a.maxSale}/${a.maxCost}). ` +
          `Catálogo (search): tipo ${catalog?.conceptType ?? '-'}, maxValue ${catalog?.maxValue ?? '-'}, ` +
          `maxCostValue ${catalog?.maxCostValue ?? '-'}, isByCost ${catalog?.isByCost ?? '-'}. ` +
          `Modal «${maxLabel}». BVA ${JSON.stringify(bva)}. Aceptado ${a.accepted}: línea ${line}, ` +
          `Otros Costos ${before.otherCosts}→${after.otherCosts}, Total ${before.total}→${after.total}. ` +
          `Sin guardar el alta (POST de alta: ${flow.createTravelRequestCount}).`
      );

      expect(catalog, 'el concepto preparado debe estar en el catálogo').not.toBeNull();
      expect.soft(catalog?.conceptType).toBe('VAR');
      expect.soft(catalog?.maxValue).toBe(a.maxSale);
      expect.soft(catalog?.maxCostValue).toBe(a.maxCost);
      expect.soft(catalog?.isByCost).toBe(true);
      expect
        .soft(maxLabel, 'el modal muestra el tope de VENTA')
        .toMatch(new RegExp(`:\\s*${a.maxSale}\\s*\\$`));
      expect.soft(maxShown).toBe(a.maxSale);
      expect.soft(line).toBe(a.accepted);
      expect.soft(after.otherCosts).toBe(round2(before.otherCosts + a.accepted));
      expect
        .soft(after.total, 'el importe aceptado suma al Total del viaje')
        .toBe(round2(before.total + a.accepted + (after.taxes - before.taxes)));
      expect(flow.createTravelRequestCount, 'el alta no se guarda').toBe(0);
    });

    test('TC116 Agrega conceptos Fijo con Costo encendido en cero, Costo apagado, disponibilidad compartida y valor negativo', async ({
      flow
    }) => {
      makeAnnotate(TM_TC116, ROUTE)('TC116', 'EC');
      const a = flow.data.amounts.tm1279;
      const ctx = (extra: Partial<OtherCostContext>) => flow.conceptContext(extra);
      const costZero = await flow.createConcept(
        fixedOtherCost(await ctx({ label: 'A' }), a.costZeroSale, { cost: 0 })
      );
      const costOff = await flow.createConcept(
        fixedOtherCost(await ctx({ label: 'B' }), a.costOffSale)
      );
      const sharedApply: OtherCostApply[] = ['DRIVER', 'CARRIER'];
      const shared = await flow.createConcept(
        fixedOtherCost(await ctx({ label: 'C', apply: sharedApply }), a.sharedSale)
      );
      // Clase negativa (O-UAT-03): solo preparable por API; el backend puede rechazarla (4xx) o
      // alterarla (p. ej. guardar el valor sin signo). En ambos casos la clase NO se ejecuta.
      const negative = await flow.tryCreateConcept(
        fixedOtherCost(await ctx({ label: 'D' }), a.negativeSale, { allowNegative: true })
      );
      const negativeAltered =
        negative.item !== null && negative.item.conceptValue !== a.negativeSale
          ? `el backend guardó conceptValue ${negative.item.conceptValue} en vez de ${a.negativeSale}`
          : null;
      const negativeSkipReason = negative.rejection
        ? `el backend rechazó el concepto negativo (${negative.rejection})`
        : negativeAltered;

      // Esperado por clase = lo que se ENVIÓ (datos del Test en Xray), nunca el eco de la API.
      const classes = [
        { label: 'A', item: costZero, sale: a.costZeroSale, apply: ['CARRIER'] },
        { label: 'B', item: costOff, sale: a.costOffSale, apply: ['CARRIER'] },
        { label: 'C', item: shared, sale: a.sharedSale, apply: sharedApply },
        ...(negative.item && !negativeAltered
          ? [{ label: 'D', item: negative.item, sale: a.negativeSale, apply: ['CARRIER'] }]
          : [])
      ];
      // Suma algebraica de las ventas enviadas: el negativo RESTA, sin piso en 0.
      const expectedSum = round2(classes.reduce((sum, c) => sum + c.sale, 0));

      const before = await flow.startQuotedTrip('short');
      const header = await flow.commentHeader();
      expect.soft(before.otherCosts, 'paso 1: el alta arranca sin conceptos cargados').toBe(0);
      expect.soft(before.lines, 'paso 1: sin líneas de Otros Costos').toHaveLength(0);
      const preloads: Record<string, string> = {};
      const lines: Record<string, number> = {};
      for (const { item } of classes) {
        preloads[item.concept] = await flow.addConceptReadingPreload(item.concept);
        lines[item.concept] = await flow.lineAmount(item.concept);
      }
      const after = await flow.readSummary();
      await flow.screenshot(`${TM_TC116}-alta-con-conceptos`);
      await flow.leaveWithoutSaving();

      const catalog = await Promise.all(classes.map((c) => flow.catalogItem(c.item.id)));
      await flow.attachMeasurement(TM_TC116, {
        concepts: flow.conceptsView(classes.map((c) => c.item)),
        expected: classes.map((c) => ({ label: c.label, sale: c.sale, apply: c.apply })),
        negativeRejection: negative.rejection,
        negativeAltered,
        catalog: catalog.map((c) => (c ? flow.conceptsView([c])[0] : null)),
        ui: { before, after, preloads, lines },
        createTravelRequests: flow.createTravelRequestCount
      });
      flow.comment(
        `${header} Fijos: A ${costZero.id} Costo ON costo 0 venta ${a.costZeroSale}; B ${costOff.id} Costo OFF venta ${a.costOffSale}; ` +
          `C ${shared.id} Chofer+Operador venta ${a.sharedSale}; D negativo ${negativeSkipReason ? `NO EJECUTADO: ${negativeSkipReason}` : `${negative.item?.id} venta ${a.negativeSale}`}. ` +
          `Precargas ${JSON.stringify(preloads)}. Otros Costos ${before.otherCosts}→${after.otherCosts} (esperado +${expectedSum}); ` +
          `Total ${before.total}→${after.total}. Sin guardar el alta (POST de alta: ${flow.createTravelRequestCount}).`
      );

      expect(catalog, 'los conceptos preparados siguen vigentes en el catálogo').not.toContain(
        null
      );
      for (const [index, c] of classes.entries()) {
        const name = c.item.concept;
        expect.soft(catalog[index]?.conceptType, `${c.label}: tipo Fijo`).toBe('FIX');
        expect.soft(catalog[index]?.conceptValue, `${c.label}: venta configurada`).toBe(c.sale);
        expect
          .soft([...(catalog[index]?.apply ?? [])].sort(), `${c.label}: disponibilidad enviada`)
          .toEqual([...c.apply].sort());
        expect.soft(Number(preloads[name]), `«${name}» precarga su venta`).toBe(c.sale);
        expect.soft(lines[name], `«${name}» suma su venta, sin piso en 0`).toBe(c.sale);
      }
      expect.soft(catalog[0]?.isByCost, 'A: Costo encendido').toBe(true);
      expect.soft(catalog[0]?.conceptValueCost, 'A: costo en cero').toBe(0);
      expect.soft(catalog[1]?.isByCost, 'B: Costo apagado').toBe(false);
      expect.soft(after.otherCosts).toBe(round2(before.otherCosts + expectedSum));
      expect
        .soft(after.total, 'el Total refleja la suma algebraica de los conceptos')
        .toBe(round2(before.total + expectedSum + (after.taxes - before.taxes)));
      expect(flow.createTravelRequestCount, 'el alta no se guarda').toBe(0);

      // Si el backend rechazó o alteró el negativo, esa clase no se ejecutó: skip explícito, nunca
      // PASSED. Las otras tres clases ya se asertaron arriba (un fallo de ellas manda sobre el skip).
      test.skip(
        negativeSkipReason !== null,
        `regla de negativos pendiente de PO: ${negativeSkipReason}; ` +
          'las otras tres clases se ejecutaron y constan en la medición'
      );
    });
  });
});
