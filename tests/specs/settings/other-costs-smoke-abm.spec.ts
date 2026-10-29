// tests/specs/settings/other-costs-smoke-abm.spec.ts
// MG-995 / MG-996 (Universal F1, epic MG-990) — smoke automatizado del ABM de Otros Costos
// (Carrier V2, Configuración › Otros Costos). ATP TM-1116 · ATR de automatización TM-1281 (UAT,
// estado vigente). 6 Tests Xray, 1 test() = 1 Test: TM-985, TM-1002, TM-1007, TM-1008, TM-1014,
// TM-1017. Plan: MG-990-fase1/plan-automatizacion-smoke-abm.md (Anexo A).
//
// Recorrido: precondición por API (TM-1007/1008/1017) o alta por la UI (TM-985/1014, el alta es el
// objeto del Test) → acción en el ABM → request/response capturados → oráculo UI (grilla) + API
// (`otherCosts/search`) → evidencia (captura + medición JSON + comentario `xray_comment`) →
// limpieza por API en el teardown del fixture aunque el test falle. Prefijo «QA E2E OC SMK ».
//
// Oráculo de persistencia: API. Los Gherkin piden «en base se verifica…», pero la base de UAT no
// es alcanzable desde V2 (BL-046): la sustitución se declara en el comentario de cada run.
//
// Deriva de redacción de los pasos Xray (se asevera la UI REAL medida en UAT v2.0.17, recon R2
// 2026-09-29; los Tests se actualizan en el lugar, decisión D-A1 del plan):
// - Precondiciones «Carrier de TEST 1040 (ARS)»: la automatización corre en UAT 1481 (USD).
// - Botón «Nuevo concepto» (TM-985/1002): la UI dice «Nuevo Costo» («Nuevo concepto de Otros
//   Costos» es el TÍTULO del modal).
// - Columnas «Concepto / Disponibilidad / Comisiona» (TM-1017): la UI dice «Descripción /
//   Disponible para / Comisionable» («Comisiona» es el interruptor del modal).
// - TM-1002: al elegir Variable el Tope de venta abre VACÍO (no «0.00»); se tipea 0 para cumplir
//   «dejar el Tope de venta en cero».
//
// Acreditación (decisión D-A2): TM-1014 corre y adjunta evidencia, pero su key queda FUERA de la
// allowlist de la familia `othercosts-smoke` (borrado lógico sin firma del PO y no verificable sin
// base de UAT) → su run queda TO DO. TM-1017: COBERTURA PARCIAL DECLARADA (solo el rol con PRC.C;
// el rol sin PRC.C es TM-1149; `maxCostValue` es oráculo abierto y solo se registra).
//
// Gate OTHER_COSTS_CREATE_DATA=1: crea y borra conceptos reales en el ambiente. Sin el gate el spec
// se salta (smoke y regresión no generan datos). Solo UAT en la fase 1.
// Corrida local del agente (sin login con contraseña, sesión guardada):
//   OTHER_COSTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 ENV=uat npx playwright test \
//     tests/specs/settings/other-costs-smoke-abm.spec.ts --project=carrier-v2-desktop --workers=1
import { test as base, expect } from '../../fixtures/carrierApiFixture.js';
import { OtherCostsClient } from '../../api/clients/otherCosts.client.js';
import { fixedOtherCost, quantityOtherCost } from '../../fixtures/factories/otherCostFactory.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { otherCostsDataFor } from '../../data/carrier-v2/trips/other-costs.js';
import { otherCostsAbmAmountsFor } from '../../data/carrier-v2/settings/other-costs-abm.js';
import { OTHER_COSTS_GRID_HEADERS } from '../../pages/carrier-v2/settings/SettingsOtherCostsPage.js';
import {
  conceptView,
  OtherCostsAbmFlow,
  preservedFields
} from '../../steps/settings/otherCostsAbm.steps.js';
import { parseMoney } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/settings/otherCosts';
const ENV = getCurrentEnv();
const DATA = otherCostsDataFor(ENV);
const AMOUNTS = otherCostsAbmAmountsFor(ENV);

const YES = /^(si|sí|yes)$/i;
const TYPE_QTY = /^(cantidad|quantity)$/i;
const TYPE_FIX = /^(fijo|fixed)$/i;
const DRIVER = /chofer|driver/i;
const CREATED_TOAST = /creado con [ée]xito|created successfully/i;
const UPDATED_TOAST = /modificado con [ée]xito|updated successfully/i;
const DELETED_TOAST = /eliminado con [ée]xito|deleted successfully/i;
/** Aviso cruzado de Costo OFF (es-ar / en-us `cross_validation`); cubre la redacción del paso. */
const SALE_CAP_WARNING = /tope de venta.*distinto de cero|sale cap.*different from zero/i;

const test = base.extend<{ flow: OtherCostsAbmFlow }>({
  flow: async ({ page, carrierSession, otherCostsApi }, use, testInfo) => {
    if (!DATA || !AMOUNTS) {
      throw new Error(`sin datos del smoke ABM de Otros Costos para ENV=${ENV}`);
    }
    const flow = new OtherCostsAbmFlow(
      page,
      testInfo,
      carrierSession,
      otherCostsApi,
      DATA,
      AMOUNTS
    );
    try {
      await use(flow);
    } finally {
      await flow.cleanup();
    }
  }
});

test.describe('@P1 @functional @migration MG-995 MG-996 Otros Costos ABM - smoke automatizado (ATR TM-1281)', () => {
  test.skip(
    process.env.OTHER_COSTS_CREATE_DATA !== '1',
    'crea y borra conceptos reales en el ambiente; correr con OTHER_COSTS_CREATE_DATA=1'
  );
  test.skip(
    DATA === null || AMOUNTS === null,
    `el smoke ABM de Otros Costos no tiene datos para ENV=${ENV} (fase 1: solo uat)`
  );

  // SIN retries, explícito (.env.uat trae RETRIES=1): cada intento crea conceptos reales y un
  // reintento que pasa taparía en la corrida local la falla del primer intento (máscara de
  // importes, riesgo R2 del plan).
  test.describe.configure({ timeout: 120_000, retries: 0 });

  // Barrido de corridas anteriores: conceptos de la automatización (prefijo «QA E2E OC », incluye
  // SMK) con más de 24 h. Nunca toca 27/34/38 ni conceptos de otros agentes.
  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await new OtherCostsClient(carrierApi, carrierSession).sweep();
  });

  test('TM-985: debería dar de alta un concepto tipo Cantidad comisionable con costo unitario propio distinto de la venta', async ({
    flow
  }) => {
    makeAnnotate('TM-985', ROUTE)('TC005', 'HP');
    const a = flow.amounts.tm985;
    const name = flow.conceptName();

    await flow.openSettings();
    const header = await flow.commentHeader();
    await flow.openNewCostModal();
    await flow.modal.fillDescription(name);
    await flow.modal.selectType('QTY');
    await flow.modal.setSaleValue(a.sale);
    await flow.modal.setCostToggle(true);
    await flow.modal.setCost(a.cost);
    await flow.modal.setAvailability({ driver: true });
    await flow.modal.setCommissionable(true);
    // Compuerta previa a Guardar: el formulario muestra exactamente los importes tipeados.
    const formSale = await flow.modal.readSaleValue();
    const formCost = await flow.modal.readCostValue();
    await flow.screenshot('TM-985-formulario-antes-de-guardar');

    flow.expectCreatedByUi(name);
    const saved = await flow.submitCapturing('new', () => flow.modal.save());
    await flow.confirmSuccessToast(CREATED_TOAST);
    await expect(flow.settings.rowByName(name), 'el concepto nuevo debe listarse').toHaveCount(1, {
      timeout: 20_000
    });
    const row = await flow.settings.readRow(name);
    const item = await flow.trackByName(name);
    await flow.screenshot('TM-985-grilla-con-el-alta');

    await flow.attachMeasurement('TM-985', {
      form: { sale: formSale, cost: formCost },
      request: { method: saved.method, status: saved.status, body: flow.requestView(saved.body) },
      api: conceptView(item),
      grid: row
    });
    flow.comment(
      `${header} Alta por «Nuevo Costo»: «${name}», Cantidad, venta unitaria ${a.sale}, Costo ON ${a.cost}, ` +
        `Comisiona Sí, Disponible para Chofer. POST otherCosts/new → ${saved.status}, body conceptValue ` +
        `${String(saved.body.conceptValue)}, conceptValueCost ${String(saved.body.conceptValueCost)}, isByCost ` +
        `${String(saved.body.isByCost)}. API search: id ${item?.id ?? 'ausente'}, ${item?.conceptType ?? '-'}, ` +
        `${item?.conceptValue ?? '-'}/${item?.conceptValueCost ?? '-'} ${item?.currency?.code ?? '-'}. ` +
        `Grilla: ${row.type} · ${row.costSale} · ${row.currency} · ${row.saleValue} · ${row.costValue} · ` +
        `${row.availability} · ${row.commissionable}.`
    );

    expect(formSale, 'el campo de venta debe mostrar el importe tipeado').toBe(a.sale);
    expect(formCost, 'el campo de costo debe mostrar el importe tipeado').toBe(a.cost);
    expect(a.cost, 'dato del Test: el costo unitario debe ser distinto de la venta').not.toBe(
      a.sale
    );
    expect(saved.status, 'otherCosts/new debe responder 200').toBe(200);
    expect(saved.body, 'el alta debe enviar el concepto tal como se cargó').toMatchObject({
      name,
      type: 'QTY',
      conceptValue: a.sale,
      isByCost: true,
      conceptValueCost: a.cost,
      isCommisionable: true,
      apply: ['DRIVER']
    });
    expect(item, 'el concepto debe existir en el catálogo (search)').not.toBeNull();
    expect(item, 'la API debe persistir Cantidad con costo unitario propio').toMatchObject({
      conceptType: 'QTY',
      conceptValue: a.sale,
      isByCost: true,
      conceptValueCost: a.cost,
      isCommisionable: true,
      apply: ['DRIVER']
    });
    expect(item?.currency?.code, 'la moneda debe ser la del carrier').toBe(flow.data.currencyCode);
    expect(item?.conceptValueCost, 'el costo persistido debe ser distinto de la venta').not.toBe(
      item?.conceptValue
    );
    expect(row.type).toMatch(TYPE_QTY);
    expect(row.costSale, 'Costo - Venta debe quedar en Sí').toMatch(YES);
    expect(row.currency).toBe(flow.data.currencyCode);
    expect(parseMoney(row.saleValue), 'la grilla debe mostrar la venta unitaria').toBe(a.sale);
    expect(parseMoney(row.costValue), 'la grilla debe mostrar el costo unitario').toBe(a.cost);
    expect(row.availability).toMatch(DRIVER);
    expect(row.commissionable).toMatch(YES);
  });

  test('TM-1002: debería bloquear el guardado de un concepto Variable con tope de venta en cero y no llamar al alta', async ({
    flow
  }) => {
    makeAnnotate('TM-1002', ROUTE)('TC020', 'NEG');
    const a = flow.amounts.tm1002;
    const name = flow.conceptName();

    await flow.openSettings();
    const header = await flow.commentHeader();
    const before = await flow.catalog();
    const mark = flow.mark();
    await flow.openNewCostModal();
    await flow.modal.selectType('VAR');
    await flow.modal.fillDescription(name);
    const capOnOpen = await flow.modal.saleInput.inputValue();
    await flow.modal.setSaleValue(a.cap);
    await expect(
      flow.modal.costSwitch,
      'el interruptor Costo debe quedar apagado'
    ).not.toBeChecked();
    await flow.modal.setAvailability({ driver: true });

    await expect(
      flow.modal.crossValidationAlert,
      'debe verse el aviso de validación cruzada'
    ).toHaveText(SALE_CAP_WARNING);
    await expect(flow.modal.saveButton, 'Guardar debe quedar deshabilitado').toBeDisabled();
    flow.expectCreatedByUi(name);
    // Intento de guardar igual: el botón deshabilitado no debe disparar el alta.
    await flow.modal.saveButton.click({ force: true });
    await expect(flow.modal.dialog, 'el modal debe seguir abierto').toBeVisible();
    const warning = ((await flow.modal.crossValidationAlert.textContent()) ?? '').trim();
    await flow.screenshot('TM-1002-aviso-y-guardar-deshabilitado');

    // Par de control (evita el aserto vacuo): con un tope distinto de cero el MISMO formulario
    // habilita Guardar y el aviso desaparece. No se guarda: se cancela.
    await flow.modal.setSaleValue(a.controlCap);
    await expect(
      flow.modal.saveButton,
      'con tope de venta > 0 Guardar debe habilitarse'
    ).toBeEnabled();
    await expect(
      flow.modal.crossValidationAlert,
      'con tope de venta > 0 el aviso desaparece'
    ).toBeHidden();
    await flow.modal.cancel();

    const newRequests = flow.requestsSince('new', mark);
    const after = await flow.catalog();
    const leaked = after.filter((item) => item.concept === name);

    await flow.attachMeasurement('TM-1002', {
      capOnOpen,
      warning,
      postNewCount: newRequests.length,
      catalogCount: { before: before.length, after: after.length },
      conceptWithNameInCatalog: leaked.map(conceptView)
    });
    flow.comment(
      `${header} Nuevo Costo, Variable, «${name}», Tope de venta ${a.cap} (abre vacío: «${capOnOpen}»), Costo OFF, ` +
        `Chofer. Aviso: «${warning}». Guardar deshabilitado; click forzado sin efecto, modal abierto. ` +
        `POST otherCosts/new desde que se abrió el modal: ${newRequests.length}. API search: conceptos ` +
        `${before.length}→${after.length}, con ese nombre: ${leaked.length}. Control: con tope ${a.controlCap} ` +
        'Guardar se habilita y el aviso desaparece (se canceló sin guardar).'
    );

    expect(warning).toMatch(SALE_CAP_WARNING);
    expect(newRequests, 'no debe llamarse a otherCosts/new').toHaveLength(0);
    expect(leaked, 'no debe existir un concepto con ese nombre').toHaveLength(0);
    expect(after, 'el catálogo debe tener la misma cantidad de conceptos').toHaveLength(
      before.length
    );
  });

  test('TM-1007: debería editar solo el valor de venta de un concepto existente y conservar costo, moneda y disponibilidad', async ({
    flow
  }) => {
    makeAnnotate('TM-1007', ROUTE)('TC025', 'HP');
    const a = flow.amounts.tm1007;
    const concept = await flow.createConcept(
      fixedOtherCost(await flow.conceptContext(), a.sale, { cost: a.cost })
    );
    const before = await flow.catalogItem(concept.id);
    expect(
      before,
      'precondición: el concepto creado por API debe estar en el catálogo'
    ).not.toBeNull();

    await flow.openSettings();
    const header = await flow.commentHeader();
    await flow.openEditModal(concept.concept);
    const preload = await flow.modal.readSaleValue();
    await flow.modal.setSaleValue(a.newSale);
    const formSale = await flow.modal.readSaleValue();
    await flow.screenshot('TM-1007-modal-edicion-venta');

    const saved = await flow.submitCapturing('update', () => flow.modal.save());
    await flow.confirmSuccessToast(UPDATED_TOAST);
    const after = await flow.catalogItem(concept.id);
    await expect(flow.settings.rowByName(concept.concept)).toHaveCount(1, { timeout: 20_000 });
    await expect
      .poll(async () => parseMoney((await flow.settings.readRow(concept.concept)).saleValue), {
        message: 'la grilla debe refrescar la venta editada',
        timeout: 15_000
      })
      .toBe(a.newSale);
    const row = await flow.settings.readRow(concept.concept);
    await flow.screenshot('TM-1007-grilla-editada');

    await flow.attachMeasurement('TM-1007', {
      preload,
      form: { sale: formSale },
      request: { method: saved.method, status: saved.status, body: flow.requestView(saved.body) },
      api: { before: conceptView(before), after: conceptView(after) },
      grid: row
    });
    flow.comment(
      `${header} Concepto FIX ${concept.id} creado por API (venta ${a.sale}, costo ${a.cost}, Operador). ` +
        `Editar (lápiz de su fila): precarga ${preload}, venta → ${a.newSale}. PUT otherCosts/update → ` +
        `${saved.status}, body conceptValue ${String(saved.body.conceptValue)}, conceptValueCost ` +
        `${String(saved.body.conceptValueCost)}, isByCost ${String(saved.body.isByCost)}, currencyId ` +
        `${String(saved.body.currencyId)}. API search antes→después: venta ${before?.conceptValue}→` +
        `${after?.conceptValue}, costo ${before?.conceptValueCost}→${after?.conceptValueCost}, moneda ` +
        `${before?.currency?.code}→${after?.currency?.code}. Grilla: ${row.saleValue} · ${row.costValue}.`
    );

    expect(preload, 'el modal de edición debe precargar la venta vigente').toBe(a.sale);
    expect(formSale).toBe(a.newSale);
    expect(saved.status, 'otherCosts/update debe responder 200').toBe(200);
    expect(
      saved.body,
      'la edición debe enviar la venta nueva exacta y el resto sin cambios'
    ).toMatchObject({
      id: concept.id,
      conceptValue: a.newSale,
      isByCost: true,
      conceptValueCost: a.cost,
      currencyId: before?.currency?.currencyId,
      isCommisionable: before?.isCommisionable,
      apply: before?.apply
    });
    expect(after, 'el concepto debe seguir en el catálogo').not.toBeNull();
    expect(after?.conceptValue, 'solo la venta debe cambiar').toBe(a.newSale);
    expect(
      after ? preservedFields(after) : null,
      'isByCost, costo, moneda, disponibilidad y comisionable deben quedar como antes'
    ).toEqual(before ? preservedFields(before) : null);
    expect(parseMoney(row.saleValue)).toBe(a.newSale);
    expect(parseMoney(row.costValue), 'el costo de la grilla no debe cambiar').toBe(a.cost);
  });

  test('TM-1008: debería activar el costo en un concepto que no lo tenía y persistir isByCost y el valor de costo', async ({
    flow
  }) => {
    makeAnnotate('TM-1008', ROUTE)('TC026', 'HP');
    const a = flow.amounts.tm1008;
    const concept = await flow.createConcept(fixedOtherCost(await flow.conceptContext(), a.sale));
    const before = await flow.catalogItem(concept.id);
    expect(before?.isByCost, 'precondición: el concepto debe arrancar SIN costo').toBe(false);

    await flow.openSettings();
    const header = await flow.commentHeader();
    await flow.openEditModal(concept.concept);
    await expect(
      flow.modal.costSwitch,
      'el interruptor Costo debe abrir apagado'
    ).not.toBeChecked();
    await flow.modal.setCostToggle(true);
    const costPreload = await flow.modal.costInput.inputValue();
    await flow.modal.setCost(a.newCost);
    const formCost = await flow.modal.readCostValue();
    await flow.screenshot('TM-1008-modal-costo-encendido');

    const saved = await flow.submitCapturing('update', () => flow.modal.save());
    await flow.confirmSuccessToast(UPDATED_TOAST);
    const after = await flow.catalogItem(concept.id);
    await expect
      .poll(async () => (await flow.settings.readRow(concept.concept)).costSale, {
        message: 'la grilla debe refrescar Costo - Venta',
        timeout: 15_000
      })
      .toMatch(YES);
    const row = await flow.settings.readRow(concept.concept);
    await flow.screenshot('TM-1008-grilla-con-costo');

    await flow.attachMeasurement('TM-1008', {
      costPreload,
      form: { cost: formCost },
      request: { method: saved.method, status: saved.status, body: flow.requestView(saved.body) },
      api: { before: conceptView(before), after: conceptView(after) },
      grid: row
    });
    flow.comment(
      `${header} Concepto FIX ${concept.id} creado por API sin costo (venta ${a.sale}; Regla G: costo espejo ` +
        `${before?.conceptValueCost}). Editar: Costo ON (precarga «${costPreload}»), costo ${a.newCost}. PUT ` +
        `otherCosts/update → ${saved.status}, body isByCost ${String(saved.body.isByCost)}, conceptValueCost ` +
        `${String(saved.body.conceptValueCost)}, conceptValue ${String(saved.body.conceptValue)}. API search: ` +
        `isByCost ${before?.isByCost}→${after?.isByCost}, costo ${before?.conceptValueCost}→${after?.conceptValueCost}, ` +
        `moneda ${after?.currency?.code}. Grilla: ${row.costSale} · ${row.currency} · ${row.costValue}.`
    );

    expect(formCost).toBe(a.newCost);
    expect(
      a.newCost,
      'dato del Test: el costo cargado debe diferir del espejo de la venta'
    ).not.toBe(a.sale);
    expect(saved.status, 'otherCosts/update debe responder 200').toBe(200);
    expect(saved.body, 'la edición debe activar el costo con el importe cargado').toMatchObject({
      id: concept.id,
      isByCost: true,
      conceptValueCost: a.newCost,
      conceptValue: a.sale
    });
    expect(after, 'la API debe persistir el costo activado').toMatchObject({
      isByCost: true,
      conceptValueCost: a.newCost,
      conceptValue: a.sale
    });
    expect(after?.currency?.code, 'la moneda sigue siendo la de la venta').toBe(
      before?.currency?.code
    );
    expect(row.costSale, 'Costo - Venta debe quedar en Sí').toMatch(YES);
    expect(parseMoney(row.costValue), 'Valor Costo debe mostrar el importe cargado').toBe(
      a.newCost
    );
    expect(row.currency, 'la columna Moneda debe mostrar el código de la venta').toBe(
      after?.currency?.code
    );
  });

  test('TM-1014: debería eliminar de la grilla un concepto sin uso y no listarlo más en el catálogo', async ({
    flow
  }) => {
    // Fuera de la allowlist de la familia (D-A2): corre y adjunta evidencia, su run queda TO DO.
    makeAnnotate('TM-1014', ROUTE)('TC033', 'HP');
    const a = flow.amounts.tm1014;
    const name = flow.conceptName();

    await flow.openSettings();
    const header = await flow.commentHeader();
    await flow.openNewCostModal();
    await flow.modal.fillDescription(name);
    await flow.modal.selectType('FIX');
    await flow.modal.setSaleValue(a.sale);
    await flow.modal.setAvailability({ driver: true });
    flow.expectCreatedByUi(name);
    const created = await flow.submitCapturing('new', () => flow.modal.save());
    await flow.confirmSuccessToast(CREATED_TOAST);
    await expect(flow.settings.rowByName(name), 'el concepto nuevo debe listarse').toHaveCount(1, {
      timeout: 20_000
    });
    const item = await flow.trackByName(name);
    expect(
      item,
      'precondición: el concepto creado por la UI debe estar en el catálogo'
    ).not.toBeNull();
    const rowType = (await flow.settings.readRow(name)).type;
    const rowsBefore = await flow.settings.dataRows.count();

    await flow.openDeleteDialog(name);
    const dialogText = ((await flow.settings.deleteDialog.textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    await flow.screenshot('TM-1014-modal-eliminar');
    const deleted = await flow.submitCapturing('delete', () => flow.acceptDelete());
    await flow.confirmSuccessToast(DELETED_TOAST);
    // Primero el conteo (la grilla refrescada y legible) y recién después la ausencia de la fila:
    // así la ausencia nunca se verifica sobre una grilla vacía u oculta (aserto vacuo).
    await expect(flow.settings.dataRows, 'la grilla debe tener una fila menos').toHaveCount(
      rowsBefore - 1,
      { timeout: 15_000 }
    );
    await expect(
      flow.settings.rowByName(name),
      'el concepto debe desaparecer de la grilla'
    ).toHaveCount(0);
    const rowsAfter = await flow.settings.dataRows.count();
    const afterItem = await flow.catalogItem(item?.id ?? -1);
    await flow.screenshot('TM-1014-grilla-sin-el-concepto');

    await flow.attachMeasurement('TM-1014', {
      create: { status: created.status, body: flow.requestView(created.body) },
      concept: conceptView(item),
      dialogText,
      request: {
        method: deleted.method,
        status: deleted.status,
        body: flow.requestView(deleted.body)
      },
      gridRows: { before: rowsBefore, after: rowsAfter },
      stillInCatalog: afterItem !== null,
      logicalDeleteVerified: false
    });
    flow.comment(
      `${header} Alta por «Nuevo Costo»: «${name}» Fijo ${a.sale}, Chofer → id ${item?.id ?? '?'}. Papelera de su ` +
        `fila → «${dialogText}» → Aceptar. POST otherCosts/delete → ${deleted.status} (id ${String(deleted.body.id)}). ` +
        `Grilla ${rowsBefore}→${rowsAfter} filas, fila ausente. API search: ${afterItem ? 'TODAVÍA lista el id' : 'sin el id'}. ` +
        'NO verificado: borrado lógico en base (DELETED=1, DELETE_USER, DELETE_DATE): base de UAT no ' +
        'alcanzable y contrato pendiente de firma del PO (needs-po-confirmation). Run no acreditado (fuera de la allowlist).'
    );

    expect(rowType).toMatch(TYPE_FIX);
    expect(deleted.status, 'otherCosts/delete debe responder 200').toBe(200);
    expect(deleted.body, 'la baja debe enviar el id del concepto y el carrier').toMatchObject({
      carrierId: flow.session.carrierId,
      id: item?.id
    });
    expect(Number(deleted.body.userId), 'la baja debe enviar el usuario de la sesión').toBe(
      flow.session.subUserId
    );
    expect(dialogText, 'el diálogo debe nombrar al concepto').toContain(name);
    expect(afterItem, 'el catálogo (search) no debe listar el concepto eliminado').toBeNull();
  });

  test('TM-1017: debería listar todas las columnas del ABM y devolver el contrato de 4 campos del search', async ({
    flow
  }) => {
    // COBERTURA PARCIAL DECLARADA: solo el rol CARRIER con PRC.C (la sesión de la automatización).
    // El rol sin PRC.C es TM-1149 (necesita otra sesión). `maxCostValue` no se asevera (oráculo
    // abierto, needs-po-confirmation): se registra presente/ausente en la medición.
    makeAnnotate('TM-1017', ROUTE)('TC036', 'HP');
    const a = flow.amounts.tm1017;
    const concept = await flow.createConcept(
      quantityOtherCost(await flow.conceptContext({ apply: ['DRIVER', 'CARRIER'] }), a.sale, {
        cost: a.cost
      })
    );

    const search = await flow.openSettings();
    const header = await flow.commentHeader();
    await expect(
      flow.settings.rowByName(concept.concept),
      'la fila propia debe listarse'
    ).toHaveCount(1, {
      timeout: 20_000
    });
    const headers = await flow.settings.headerTexts();
    const missingHeaders = Object.entries(OTHER_COSTS_GRID_HEADERS)
      .filter(([, re]) => !headers.some((h) => re.test(h)))
      .map(([key]) => key);
    const row = await flow.settings.readRow(concept.concept);
    await expect(
      flow.settings.editButtonFor(concept.concept),
      'la fila debe ofrecer Editar'
    ).toBeVisible();
    await expect(
      flow.settings.deleteButtonFor(concept.concept),
      'la fila debe ofrecer Eliminar'
    ).toBeVisible();
    await flow.screenshot('TM-1017-listado-columnas');

    const contractViolations = search.items.flatMap((item) => {
      const problems: string[] = [];
      if (!('conceptValueCost' in item)) problems.push('sin conceptValueCost');
      if (typeof item.isByCost !== 'boolean') problems.push('isByCost no booleano');
      const c = item.currency;
      if (
        !c ||
        typeof c !== 'object' ||
        typeof c.currencyId !== 'number' ||
        typeof c.code !== 'string' ||
        typeof c.symbol !== 'string'
      ) {
        problems.push('currency sin {currencyId, code, symbol}');
      }
      return problems.length ? [`id ${item.id}: ${problems.join(', ')}`] : [];
    });
    const own = search.items.find((item) => item.id === concept.id) ?? null;
    const maxCostValuePresent = search.items.filter((item) => 'maxCostValue' in item).length;

    await flow.attachMeasurement('TM-1017', {
      headers,
      missingHeaders,
      searchStatus: search.status,
      searchItems: search.items.length,
      contractViolations,
      maxCostValue: { presentIn: maxCostValuePresent, of: search.items.length, asserted: false },
      own: conceptView(own),
      grid: row,
      partialCoverage: 'solo rol CARRIER con PRC.C; el rol sin PRC.C es TM-1149'
    });
    flow.comment(
      `${header} COBERTURA PARCIAL DECLARADA: solo rol CARRIER con PRC.C (sin PRC.C = TM-1149). Encabezados: ` +
        `${headers.filter(Boolean).join(' | ')} + editar/eliminar por fila. search de la pantalla → ${search.status}, ` +
        `${search.items.length} ítems, violaciones del contrato de 4 campos: ${contractViolations.length}. ` +
        `maxCostValue presente en ${maxCostValuePresent}/${search.items.length} (no se asevera: oráculo abierto). ` +
        `Fila propia ${concept.id}: ${row.type} · ${row.costSale} · ${row.currency} · ${row.saleValue} · ` +
        `${row.costValue} · ${row.availability} · ${row.commissionable}. Deriva de redacción: el paso dice ` +
        '«Concepto/Disponibilidad/Comisiona»; la UI dice «Descripción/Disponible para/Comisionable» ' +
        '(ES) o «Description/Availability/Commisionable» (EN), según el idioma del usuario.'
    );

    expect(missingHeaders, 'deben mostrarse las 8 columnas del ABM').toEqual([]);
    expect(search.status, 'otherCosts/search debe responder 200').toBe(200);
    expect(contractViolations, 'cada ítem del search debe traer el contrato de 4 campos').toEqual(
      []
    );
    expect(own, 'el search debe incluir el concepto propio').toMatchObject({
      conceptType: 'QTY',
      isByCost: true,
      conceptValue: a.sale,
      conceptValueCost: a.cost
    });
    expect(row.type).toMatch(TYPE_QTY);
    expect(row.costSale).toMatch(YES);
    expect(row.currency, 'Moneda de la grilla = currency.code del search').toBe(
      own?.currency?.code
    );
    expect(parseMoney(row.saleValue), 'Valor Venta de la grilla = conceptValue').toBe(
      own?.conceptValue
    );
    expect(parseMoney(row.costValue), 'Valor Costo de la grilla = conceptValueCost').toBe(
      own?.conceptValueCost
    );
    expect(row.availability).toMatch(DRIVER);
  });
});
