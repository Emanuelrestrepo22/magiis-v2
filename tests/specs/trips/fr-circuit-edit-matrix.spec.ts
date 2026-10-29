// tests/specs/trips/fr-circuit-edit-matrix.spec.ts
// Matriz de EDICION POST-CIERRE (post-rendicion) del carrier Francia 1901 (TEST). Cada caso crea su
// propio viaje (alta UI -> cierre admin -> rendicion manual), edita UN campo de «Datos finales» por UI y
// asevera la cascada: precio final, TRAVELSSURRENDER, libros de chofer/propietario y CC del cliente.
// Oraculo = formulas de `expectedEditEffects` aplicadas a los DELTAS observados del detalle (valida que
// el BE propague cada diferencia como corresponde). Matriz y preguntas al PO:
// docs/qa/automation-stock/fr-1901/matriz-edicion-post-cierre-2026-10-21.md
//
// Gates (todos exactamente `1`; sin ellos el spec se salta ANTES de crear nada):
// FR_CIRCUIT_CREATE_TRIP, FR_CONFIRM_SURRENDER, FR_EDIT_AFTER_SURRENDER. Ademas ENV=test, FR_* completos
// y storage state del carrier 1901. Filtro de casos: FR_EDIT_CASES = ids separados por coma (ej.
// `EDM-CASH-FARE-UP,EDM-CC-TOLL-UP`), `all` (los 14 + liquidado) o vacio (solo prioridad P1).
// Caso EDM-SETTLED-409: requiere FR_SETTLED_TRAVEL_ID = viaje de 1901 YA incluido en una liquidacion de
// chofer/propietario con STATUS=1 (lo prepara el orquestador; este spec no liquida nada).
// Sin retries (cada intento crearia otro viaje permanente). NO correr entre 10:00 y 10:20 ART, es decir 13:00-13:20 UTC (cron de
// rendicion automatica contamina el lote). Los casos corren en serie: el lote debe estar vacio al inicio.
import { evaluateBatchExactly } from '../../helpers/surrender-oracle.js';
import type { Page } from '@playwright/test';
import { ApiStatusError } from '../../api/clients/carrierSession.js';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import type { OracleDb } from '../../db/OracleDb.js';
import type { FrCircuitConfig } from '../../config/runtime.js';
import { deltaMovements } from '../../helpers/cc-delta.js';
import { knownIssue, observation, verifyAc } from '../../helpers/acceptance.js';
import { evaluateCostEqualsSale } from '../../helpers/cost-sale.js';
import { evaluateSaleCostPairs, formatMismatches } from '../../helpers/db-oracle-eval.js';
import {
  expectedEditEffects,
  type EditDiffs,
  type PaymentKind
} from '../../helpers/edit-matrix.js';
import {
  COMMISSION_BASE_COLUMNS,
  columnsOutsideCommissionBase,
  evaluateBookRows,
  evaluateCcRewrite,
  evaluateEditedCostEqualsSale,
  evaluateFieldDelta,
  evaluateFinalizeRejected,
  evaluateNoRepeatedBookRows,
  evaluateSingleTivr,
  evaluateSurrenderDeltas,
  PO_QUESTION_OF_FIELD,
  type FinalizeOutcome
} from '../../helpers/fr-ac-eval-edit-reports.js';
import {
  DEFAULT_CARRIER_ID,
  DEFAULT_OWNER_ID,
  frConfigOrNull,
  optionalInt,
  readBooks,
  requireNumberField
} from '../../helpers/fr-circuit.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { readIsolation } from '../../helpers/fr-preflight.js';
import { assertOutsideCronWindow } from '../../helpers/run-window.js';
import { FR_FACTS } from '../../helpers/fr-facts.js';
import { readBatchStateUntilEmpty } from '../../helpers/fr-ac-eval-circuit.js';
import type { FinalPriceEdits } from '../../pages/carrier-v2/trips/TripEditPage.js';
import { TripEditPage } from '../../pages/carrier-v2/trips/TripEditPage.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { readSaleCostData } from '../../steps/trips/dbOracles.steps.js';
import { SurrenderFlow } from '../../steps/trips/surrender.steps.js';
import { round2 } from '../../utils/money.js';
import { FR_1901_EDM_KEY_BY_FIELD, FR_1901_KEYS } from '../../data/xray/fr-1901-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const PAYMENT_CC = process.env.FR_CC_PAYMENT_METHOD?.trim() || 'Credit Account';
const STATE_DONE = /^DONE$/i;
const STATE_CANCELLED = /^(CANCELL?ED|7)$/i;
const TOL = 0.011;
const MESSAGE_SELECTOR =
  '.swal2-popup, [role="alert"], [role="alertdialog"], [role="dialog"], ngb-modal-window, .modal.show, .toast, .toast-message, .alert, .ngx-toastr';

type Field = 'fare' | 'toll' | 'parking' | 'otherCom' | 'otherNoCom' | 'distance';
type EditCase = {
  id: string;
  kind: PaymentKind;
  field: Field;
  /** Delta sobre el valor actual del campo (distancia: km). */
  delta: number;
  /** El alta incluye el otro costo del catalogo FR (necesario para editar el comisionable). */
  withOtherCost: boolean;
  priority: 'P1' | 'P2';
};

const CASES: readonly EditCase[] = [
  ...(['cash', 'cc'] as const).flatMap((kind): EditCase[] => {
    const k = kind.toUpperCase();
    return [
      {
        id: `EDM-${k}-FARE-UP`,
        kind,
        field: 'fare',
        delta: 10,
        withOtherCost: false,
        priority: 'P1'
      },
      {
        id: `EDM-${k}-FARE-DOWN`,
        kind,
        field: 'fare',
        delta: -10,
        withOtherCost: false,
        priority: 'P1'
      },
      {
        id: `EDM-${k}-TOLL-UP`,
        kind,
        field: 'toll',
        delta: 5,
        withOtherCost: false,
        priority: 'P1'
      },
      {
        id: `EDM-${k}-PARKING-UP`,
        kind,
        field: 'parking',
        delta: 5,
        withOtherCost: false,
        priority: 'P2'
      },
      {
        id: `EDM-${k}-OTHERCOM-UP`,
        kind,
        field: 'otherCom',
        delta: 5,
        withOtherCost: true,
        priority: kind === 'cc' ? 'P1' : 'P2'
      },
      {
        id: `EDM-${k}-OTHERNOCOM-UP`,
        kind,
        field: 'otherNoCom',
        delta: 5,
        withOtherCost: false,
        priority: 'P2'
      },
      {
        id: `EDM-${k}-DISTANCE-UP`,
        kind,
        field: 'distance',
        delta: 1,
        withOtherCost: false,
        priority: 'P2'
      }
    ];
  })
];
const SETTLED_ID = 'EDM-SETTLED-409';

const selection = (process.env.FR_EDIT_CASES ?? '').trim();
const selected = (id: string, priority: 'P1' | 'P2'): boolean => {
  if (selection === '') return priority === 'P1';
  if (selection.toLowerCase() === 'all') return true;
  return selection
    .split(',')
    .map((s) => s.trim())
    .includes(id);
};

/** AC-13 se sondea una sola vez por corrida (un re-cierre rechazado por caso no aporta mas). */
let finalizeRejectProbed = false;

const frGate = frConfigOrNull('FR edit-matrix', [
  'FR_CIRCUIT_CREATE_TRIP',
  'FR_CONFIRM_SURRENDER',
  'FR_EDIT_AFTER_SURRENDER'
]);

/**
 * Primer campo numerico presente del detalle; null si ninguno existe. Lectura tolerante SOLO para el
 * desglose de otherCostCom, que es legitimamente opcional (si falta se deriva de otherCost - otherCostNoCom);
 * los campos de monto obligatorios usan requireNumberField.
 */
function pick(detail: TravelDetail, names: readonly string[]): number | null {
  for (const n of names) {
    const v = detail[n];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

const FIELD_NAMES = {
  fare: ['tourPrice'],
  otherTotal: ['otherCost'],
  otherCom: ['otherCostCom']
} as const;

type Parts = Record<
  'fare' | 'wait' | 'toll' | 'parking' | 'otherCom' | 'otherNoCom' | 'total',
  number
>;

function partsOf(detail: TravelDetail): { parts: Parts; km: number; missing: string[] } {
  const missing: string[] = [];
  const need = (key: keyof typeof FIELD_NAMES): number | null => {
    const v = pick(detail, FIELD_NAMES[key]);
    if (v === null) missing.push(key);
    return v;
  };
  const noCom = requireNumberField(detail, FR_FACTS.detailFields.otherNoCom.value);
  const otherCom =
    pick(detail, FIELD_NAMES.otherCom) ?? (pick(detail, FIELD_NAMES.otherTotal) ?? 0) - noCom;
  const parts: Parts = {
    fare: need('fare') ?? 0,
    wait: requireNumberField(detail, FR_FACTS.detailFields.wait.value),
    toll: requireNumberField(detail, FR_FACTS.detailFields.toll.value),
    parking: requireNumberField(detail, FR_FACTS.detailFields.parking.value),
    otherCom,
    otherNoCom: noCom,
    total: round2(Number(detail.amount))
  };
  return { parts, km: requireNumberField(detail, FR_FACTS.detailFields.kilometers.value), missing };
}

const diffsOf = (before: Parts, after: Parts): EditDiffs => ({
  fare: round2(after.fare - before.fare),
  wait: round2(after.wait - before.wait),
  otherCom: round2(after.otherCom - before.otherCom),
  otherNoCom: round2(after.otherNoCom - before.otherNoCom),
  toll: round2(after.toll - before.toll),
  parking: round2(after.parking - before.parking),
  total: round2(after.total - before.total)
});

const near = (a: number, b: number): boolean => Math.abs(a - b) < TOL;
const SURRENDER_COLS = [
  'TOTALBILLING',
  'COMMISSIONSUM',
  'OWNER_TOTALCOMMISSION',
  'AGENCY_TOTALCOMMISSION',
  'TOTALOTHERCOST_NOCOM',
  'CASHCOMMISSION',
  'OWNER_CASH_COMM',
  'AGENCY_CASH_COMM',
  'TOTALCASH',
  'TOTALCASHPARKING',
  'TOTALCASHROADTOLL',
  'TOTALCASHOTHERCOST',
  'TOTALCASHTOSURRENDER',
  'SURRENDERDIFFERENCE',
  'CHECKINGACCOUNTCOMMISSION',
  'OWNER_CHECK_ACC_COMM',
  'AGENCY_CHECK_ACC_COMM',
  'TOTALCHECKINGACCOUNT',
  'TOTALPARKING',
  'TOTALROADTOLL',
  'TOTALOTHERCOST'
] as const;
// Lista cerrada (sin input externo): no hay interpolacion de datos.
const SURRENDER_SQL = `SELECT ${SURRENDER_COLS.join(', ')} FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;
const TRAVEL_SURRENDER_SQL =
  'SELECT TRAVELSSURRENDER_ID AS SID FROM TRAVEL WHERE ID = :travelId UNION ALL ' +
  'SELECT TRAVELSSURRENDER_ID AS SID FROM TRAVEL_HISTORY WHERE ID = :travelId';

async function readSurrender(
  db: OracleDb,
  travelId: number
): Promise<{ id: number; cols: Record<string, number> }> {
  const link = await db.query<{ SID: number | null }>(TRAVEL_SURRENDER_SQL, { travelId });
  const id = link.map((r) => r.SID).find((v): v is number => typeof v === 'number');
  if (id === undefined)
    throw new Error(`[edit-matrix] el viaje ${travelId} no tiene TRAVELSSURRENDER_ID`);
  const rows = await db.query<Record<string, unknown>>(SURRENDER_SQL, { surrenderId: id });
  const raw = rows[0];
  if (!raw) throw new Error(`[edit-matrix] TRAVELSSURRENDER ${id} no existe`);
  return { id, cols: Object.fromEntries(SURRENDER_COLS.map((c) => [c, Number(raw[c] ?? 0)])) };
}

async function collectUiMessages(page: Page, until: Promise<unknown>): Promise<string[]> {
  const seen = new Set<string>();
  let settled = false;
  void until.then(
    () => (settled = true),
    () => (settled = true)
  );
  const sweep = async (): Promise<void> => {
    try {
      for (const text of await page.locator(MESSAGE_SELECTOR).allInnerTexts()) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) seen.add(clean);
      }
    } catch {
      // la pagina puede estar navegando: se reintenta en el proximo barrido
    }
  };
  while (!settled) {
    await sweep();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await sweep();
  return [...seen];
}

test.describe('Circuito Francia · matriz de edicion post-cierre (rendido, no liquidado)', () => {
  test.skip(frGate.config === null, `FR edit-matrix saltado: ${frGate.reason}`);
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  for (const c of CASES) {
    if (!selected(c.id, c.priority)) continue;

    test(`${c.id}-validar-edicion-post-cierre ${c.kind} ${c.field} ${c.delta > 0 ? '+' : ''}${c.delta}`, async ({
      page,
      travelsApi,
      checkingAccountApi,
      carrierApi,
      carrierSession,
      db: dbFixture
    }, testInfo) => {
      const db = requireOracle(dbFixture, `FR edit-matrix ${c.id}`);
      const cfg = frGate.config as FrCircuitConfig;
      makeAnnotate(FR_1901_EDM_KEY_BY_FIELD[c.field], ROUTE)(
        c.id,
        c.priority === 'P1' ? 'HP' : 'EDGE'
      );
      const ownerId = optionalInt('FR_OWNER_ID', DEFAULT_OWNER_ID);
      const expectedCarrier = optionalInt('FR_CARRIER_ID', DEFAULT_CARRIER_ID);
      const batch = { driverUserId: cfg.driverId, vehicleId: cfg.vehicleId };
      const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
      const surrender = new SurrenderFlow(page, surrenderClient);
      const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
      const attachJson = (name: string, data: unknown) =>
        testInfo.attach(name, {
          body: JSON.stringify(data, null, 2),
          contentType: 'application/json'
        });
      const nativeDialogs: string[] = [];
      page.on('dialog', (dialog) => {
        nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
        void dialog.dismiss().catch(() => undefined);
      });

      // ---- 1. Precondiciones (guardas tecnicas ANTES de crear nada: el alta es permanente) ----
      if (carrierSession.carrierId !== expectedCarrier) {
        throw new Error(`la sesion debe ser del carrier ${expectedCarrier}`);
      }
      const isolation = await readIsolation({
        surrender: surrenderClient,
        batch,
        db,
        ownerId
      });
      // Ventana del cron diario (13:00-13:20 UTC): solo bloquea con CASHCOLLECTOR=1; error de precondicion.
      assertOutsideCronWindow({ cashCollectorFlag: isolation.cashCollectorFlag });
      await verifyAc(testInfo, 'AC-FR-20', async () => {
        expect(
          isolation.batchRows,
          `lote de rendicion manual del chofer ${batch.driverUserId}/vehiculo ${batch.vehicleId} debe estar vacio antes de crear`
        ).toEqual([]);
        expect(isolation.summaryRows, 'resumen de pendientes del chofer/vehiculo vacio').toBe(0);
        return { batchBefore: isolation.batchRows, summaryRows: isolation.summaryRows };
      });

      // ---- 2. Alta + cierre admin ----
      const { travelId, simulatedAmount } =
        await test.step(`2. Create ${c.kind} trip via UI`, async () =>
          flow.createViaUi({
            page,
            client: cfg.clientQuery,
            paymentMethod: c.kind === 'cash' ? 'Cash' : PAYMENT_CC,
            ...(c.withOtherCost ? { otherCostName: cfg.otherCostName } : {}),
            region: 'FR',
            assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
              // Anti-vacuidad (guarda tecnica): sin esto un total 0 haria pasar los oraculos en vacio.
              if (resolvedOrigin === resolvedDestination) {
                throw new Error(
                  `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
                );
              }
              if (!(simulatedAmount > 0)) {
                throw new Error(
                  `precondicion: la cotizacion del cliente «${cfg.clientQuery}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
                );
              }
            }
          }));

      await test.step('3. Admin close: cancel', async () => {
        await flow.cancel({ travelId });
      });

      await verifyAc(testInfo, 'AC-FR-14', async () => {
        const cancelled = await flow.readDetail({ travelId });
        expect(String(cancelled.state ?? ''), 'tras cancelar: CANCELLED').toMatch(STATE_CANCELLED);
        return { travelId, state: cancelled.state ?? null };
      });

      await test.step('3. Admin close: finalizeAdmin', async () => {
        await travelsApi.finalizeAdmin({ travelId, driverId: cfg.driverId });
      });

      const done = await flow.readDetail({ travelId });
      await verifyAc(testInfo, 'AC-FR-06', async () => {
        expect(String(done.state ?? ''), 'finalizeAdmin debe dejar el viaje DONE').toMatch(
          STATE_DONE
        );
        return { travelId, state: done.state ?? null };
      });
      await verifyAc(testInfo, 'AC-FR-07', async () => {
        expect(round2(Number(done.amount)), 'cierre admin sin cambios: final = simulado').toBe(
          round2(simulatedAmount)
        );
        return { travelId, simulatedAmount, finalAmount: done.amount ?? null };
      });

      // ---- 4. Rendicion manual (lote = [travelId]) ----
      const ui = await surrender.readUiPreview(batch);
      const apiIds = await surrender.readApiBatchIds(batch);
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
        expect(ui.totalElements, 'totalElements de toSurrend debe igualar el lote esperado').toBe(
          1
        );
        return { travelId, uiIds: ui.travelIds, apiIds };
      });

      const confirmStatus = await test.step('4. Confirm surrender (irreversible)', async () =>
        surrender.confirm());

      await verifyAc(testInfo, 'AC-FR-25', async () => {
        if (confirmStatus >= 500) {
          // Known issue TEST FR (THOUSANDS_SEPARATOR=SPACE): 500 tras el commit; la rendicion DEBE persistir.
          const persisted = await readBatchStateUntilEmpty(surrenderClient, batch, travelId);
          expect(
            persisted.settled,
            `toTravelsSurrender ${confirmStatus} y el viaje ${travelId} sigue pendiente tras ${persisted.elapsedMs} ms: NO se persistio`
          ).toBe(true);
          knownIssue(
            testInfo,
            'AC-FR-90',
            `TEST FR THOUSANDS_SEPARATOR SPACE: toTravelsSurrender ${confirmStatus} con la rendicion persistida (viaje ${travelId})`
          );
        } else {
          expect(confirmStatus, 'toTravelsSurrender 2xx').toBeGreaterThanOrEqual(200);
          expect(confirmStatus, 'toTravelsSurrender 2xx').toBeLessThan(300);
        }
        return { confirmStatus, persistedDespite5xx: confirmStatus >= 500 };
      });
      await verifyAc(testInfo, 'AC-FR-26', async () => {
        const r = await readBatchStateUntilEmpty(surrenderClient, batch, travelId);
        expect(
          r.settled,
          `tras confirmar (POST ${confirmStatus}) el lote debe quedar vacio y el viaje ${travelId} no seguir pendiente (${r.elapsedMs} ms)`
        ).toBe(true);
        return { batchAfter: r.value, elapsedMs: r.elapsedMs };
      });

      // ---- 5. Foto previa a la edicion ----
      const detailBefore = await flow.readDetail({ travelId });
      const before = partsOf(detailBefore);
      const readCc = () =>
        checkingAccountApi.movementsByTravel({ travelId, checkingAccountId: cfg.ccId });
      const ccBefore = c.kind === 'cc' ? await readCc() : [];
      const driverBefore = (
        await checkingAccountApi.driverMovements({ driverUserId: cfg.driverId })
      ).rows;
      const ownerBefore = (await checkingAccountApi.ownerMovements({ ownerId })).rows;
      const booksSurrendered = await readBooks(checkingAccountApi, cfg, ownerId);
      const surBefore = await readSurrender(db, travelId);
      await attachJson('5-before-edit', {
        travelId,
        confirmStatus,
        parts: before.parts,
        km: before.km,
        missingFields: before.missing,
        surrender: surBefore
      });
      await verifyAc(testInfo, 'AC-FR-08', async () => {
        const api = evaluateCostEqualsSale({
          detail: detailBefore,
          label: `${c.id} viaje ${travelId} (previo a editar)`,
          expectOtherCost: c.withOtherCost
        });
        expect(api.ok, api.message).toBe(true);
        const data = await readSaleCostData(db, travelId);
        const dbPairs = evaluateSaleCostPairs(travelId, data.row, data.items);
        expect(
          dbPairs.ok,
          formatMismatches(`[${c.id} DB pares costo/venta]`, dbPairs.mismatches)
        ).toBe(true);
        return { pairs: api.pairs, dbSource: dbPairs.source, dbNotes: dbPairs.notes };
      });
      if (c.kind === 'cc') {
        await verifyAc(testInfo, 'AC-FR-47', async () => {
          const v = evaluateSingleTivr(ccBefore);
          expect(v.ok, v.message).toBe(true);
          return { movements: ccBefore.length };
        });
      }

      // ---- 6. Edicion por UI ----
      const edits: FinalPriceEdits = {};
      let requestedValue: number;
      if (c.field === 'distance') {
        requestedValue = round2(before.km + c.delta);
        edits.distance = requestedValue;
      } else {
        if (before.missing.includes('fare'))
          throw new Error('[edit-matrix] el detalle no trae tourPrice');
        const current = before.parts[c.field];
        requestedValue = round2(current + c.delta);
        edits[c.field] = requestedValue;
      }
      const reason = `QA FR edit-matrix ${c.id} (viaje ${travelId})`;
      const editPromise = new TripEditPage(page)
        .editFinalPrices({ travelId, reason, ...edits })
        .then(
          (result) => ({ result, error: null as string | null }),
          (error: unknown) => ({ result: null, error: (error as Error).message })
        );

      const [edit, uiMessages] =
        await test.step(`6. Edit ${c.field} ${c.delta > 0 ? '+' : ''}${c.delta} (UI, irreversible)`, async () =>
          Promise.all([editPromise, collectUiMessages(page, editPromise)]));

      const messages = [...uiMessages, ...nativeDialogs];
      await attachXrayEvidence(testInfo, page, {
        name: `edm-${c.id}-${travelId}`,
        comment: `${c.id} viaje ${travelId}: ${c.field} ${c.delta > 0 ? '+' : ''}${c.delta}; PUT ${edit.result?.putStatus ?? 'sin PUT'}, POST ${edit.result?.processStatus ?? 'sin POST'}; mensajes: ${messages.join(' | ') || 'ninguno'}.`
      });
      await attachJson('6-edit', {
        edits,
        putStatus: edit.result?.putStatus ?? null,
        processStatus: edit.result?.processStatus ?? null,
        putPayload: edit.result?.putPayload ?? null,
        uiError: edit.error,
        messages
      });
      const accepted =
        edit.error === null && edit.result?.putStatus === 200 && edit.result?.processStatus === 200;
      // AC-53: una edicion rechazada nunca es silenciosa. Se evalua primero para que AC-52 (que falla) no la oculte.
      const silent = accepted
        ? null
        : await verifyAc(testInfo, 'AC-FR-53', async () => {
            expect(
              messages.length,
              `edicion rechazada sin mensaje visible: bloqueo silencioso (${edit.error ?? '-'})`
            ).toBeGreaterThan(0);
            return { messages };
          }).then(
            () => null,
            (error: unknown) => error
          );
      await verifyAc(testInfo, 'AC-FR-52', async () => {
        expect(
          edit.error,
          `la edicion de un viaje rendido NO liquidado debe aceptarse (mensajes UI: ${messages.join(' | ') || '-'})`
        ).toBeNull();
        expect(edit.result?.putStatus, 'PUT updateFinalPrices').toBe(200);
        expect(edit.result?.processStatus, 'POST updateFinalPricesProcess').toBe(200);
        return {
          putStatus: edit.result?.putStatus ?? null,
          processStatus: edit.result?.processStatus ?? null
        };
      });
      if (silent !== null) throw silent;

      // ---- 7. Cascada: deltas observados + formulas esperadas ----
      // PO: las preguntas Q1-Q4 abiertas (peaje/estacionamiento, NOCOM, distancia, otro comisionable)
      // se registran con observation(); solo la edicion de TARIFA (regla PB-1 modelo A confirmada) asevera.
      const poQuestion = PO_QUESTION_OF_FIELD[c.field];
      const poAc = c.field === 'otherCom' ? 'AC-FR-64' : 'AC-FR-65';
      const pending = (ac: string, ok: boolean, message: string) =>
        observation(
          testInfo,
          poAc,
          `${poQuestion} abierta, ${c.id}, ${ac}: ${ok ? 'coincide con la matriz (sin confirmar por el PO)' : `difiere de la matriz: ${message}`}`
        );

      let detailAfter: TravelDetail = detailBefore;
      let after = before;
      let diffs!: EditDiffs;
      await verifyAc(testInfo, 'AC-FR-54', async () => {
        // El proceso posterior es asincrono: se espera por estado observable (campo editado reflejado).
        await expect
          .poll(
            async () => {
              const d = await flow.readDetail({ travelId });
              const p = partsOf(d);
              const inProcess =
                (d.pricesUpdating as { pricesUpdatingInProcess?: boolean } | null | undefined)
                  ?.pricesUpdatingInProcess === true;
              const reflected =
                c.field === 'distance'
                  ? near(p.km, requestedValue)
                  : near(p.parts[c.field], requestedValue);
              return reflected && !inProcess;
            },
            {
              timeout: 60_000,
              message: `edicion aceptada pero ${c.field} del viaje ${travelId} no llego a ${requestedValue}`
            }
          )
          .toBe(true);
        detailAfter = await flow.readDetail({ travelId });
        after = partsOf(detailAfter);
        diffs = diffsOf(before.parts, after.parts);
        const v = evaluateFieldDelta(c.field, c.delta, diffs);
        if (Object.keys(v.collaterals).length > 0 || v.taxesOrOther !== 0) {
          observation(
            testInfo,
            c.field === 'fare' ? 'AC-FR-64' : poAc,
            `Efectos colaterales de editar ${c.field}: ${JSON.stringify(v.collaterals)}; total - suma de partes = ${v.taxesOrOther} (impuestos u otro recalculo).`
          );
        }
        expect(v.ok, v.message).toBe(true);
        return { diffs, collaterals: v.collaterals, taxesOrOther: v.taxesOrOther };
      });
      const expected = expectedEditEffects(c.kind, diffs);

      // AC-63: el detalle de un viaje DONE ofrece «Editar precios» (permiso TMG.1) y el badge Read only.
      await verifyAc(testInfo, 'AC-FR-63', async () => {
        const tripEdit = new TripEditPage(page);
        await tripEdit.goto(travelId);
        await expect(
          tripEdit.editButton,
          'boton «Editar precios» visible en un viaje DONE'
        ).toBeVisible();
        // TODO(verificar): el locator del badge no esta confirmado contra el DOM real (texto i18n).
        const badges = await page.getByText(/read[\s-]?only|solo lectura/i).count();
        if (badges === 0) {
          observation(
            testInfo,
            'AC-FR-63',
            `${c.id}: badge «Read only» no localizado (locator sin verificar)`
          );
        }
        return { editButtonVisible: true, readOnlyBadgeCount: badges };
      });

      // Rendicion (DB): columnas del baseline fijan base comisionable (AC-55) y el resto de deltas (AC-56).
      const surAfter = await readSurrender(db, travelId);
      const surrenderDeltas: Record<string, number> = Object.fromEntries(
        Object.keys(expected.surrender).map((col) => [
          col,
          round2((surAfter.cols[col] ?? 0) - (surBefore.cols[col] ?? 0))
        ])
      );
      const baseVerdict = evaluateSurrenderDeltas(
        expected.surrender,
        surrenderDeltas,
        COMMISSION_BASE_COLUMNS,
        `[AC-55 TRAVELSSURRENDER ${surAfter.id}]`
      );
      const restVerdict = evaluateSurrenderDeltas(
        expected.surrender,
        surrenderDeltas,
        columnsOutsideCommissionBase(expected.surrender),
        `[AC-56 TRAVELSSURRENDER ${surAfter.id}]`
      );
      if (poQuestion === null) {
        await verifyAc(testInfo, 'AC-FR-55', async () => {
          expect(baseVerdict.ok, baseVerdict.message).toBe(true);
          return {
            commissionable: expected.commissionable,
            nonCommissionable: expected.nonCommissionable
          };
        });
        await verifyAc(testInfo, 'AC-FR-56', async () => {
          expect(restVerdict.ok, restVerdict.message).toBe(true);
          return { expected: expected.surrender, observed: surrenderDeltas };
        });
      } else {
        pending('AC-55', baseVerdict.ok, baseVerdict.message);
        pending('AC-56', restVerdict.ok, restVerdict.message);
      }

      // Libros de chofer / propietario
      const driverAfter = (await checkingAccountApi.driverMovements({ driverUserId: cfg.driverId }))
        .rows;
      const ownerAfter = (await checkingAccountApi.ownerMovements({ ownerId })).rows;
      const knownDriver = new Set(driverBefore.map((r) => r.id));
      const knownOwner = new Set(ownerBefore.map((r) => r.id));
      const driverNew = driverAfter.filter((r) => !knownDriver.has(r.id));
      const ownerNew = ownerAfter.filter((r) => !knownOwner.has(r.id));
      await attachJson('7-cascade', {
        diffs,
        expectedSurrender: expected.surrender,
        observedSurrender: surrenderDeltas,
        expectedDriverRows: expected.driverRows,
        expectedOwnerRows: expected.ownerRows,
        driverNew: driverNew.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid: r.paid,
          code: r.checkingAccountCode,
          origin: r.origin,
          comments: r.comments
        })),
        ownerNew: ownerNew.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid: r.paid,
          code: r.checkingAccountCode,
          origin: r.origin,
          comments: r.comments
        }))
      });
      const driverRowsVerdict = evaluateBookRows('chofer', driverNew, expected.driverRows);
      const ownerRowsVerdict = evaluateBookRows('propietario', ownerNew, expected.ownerRows);
      if (poQuestion === null) {
        await verifyAc(testInfo, 'AC-FR-57', async () => {
          expect(driverRowsVerdict.ok, driverRowsVerdict.message).toBe(true);
          expect(ownerRowsVerdict.ok, ownerRowsVerdict.message).toBe(true);
          return { driverRows: driverNew.length, ownerRows: ownerNew.length };
        });
      } else {
        pending(
          'AC-57',
          driverRowsVerdict.ok && ownerRowsVerdict.ok,
          `${driverRowsVerdict.message} | ${ownerRowsVerdict.message}`
        );
      }
      await verifyAc(testInfo, 'AC-FR-60', async () => {
        const dv = evaluateNoRepeatedBookRows('chofer', driverBefore, driverAfter);
        const ov = evaluateNoRepeatedBookRows('propietario', ownerBefore, ownerAfter);
        expect.soft(dv.ok, dv.message).toBe(true);
        expect.soft(ov.ok, ov.message).toBe(true);
        return { driverNew: driverNew.length, ownerNew: ownerNew.length };
      });

      // CC del cliente: un unico movimiento reescrito (efectivo: sin movimiento de CC del viaje)
      if (c.kind === 'cc') {
        const ccAfter = await readCc();
        await verifyAc(testInfo, 'AC-FR-58', async () => {
          const v = evaluateCcRewrite({
            before: ccBefore,
            after: ccAfter,
            expectedDelta: expected.ccMovementDelta ?? 0,
            finalTotal: after.parts.total
          });
          expect(v.ok, v.message).toBe(true);
          return {
            debitBefore: ccBefore[0]?.debit ?? null,
            debitAfter: ccAfter[0]?.debit ?? null
          };
        });
        const booksAfter = await readBooks(checkingAccountApi, cfg, ownerId);
        const clientDelta = deltaMovements(booksSurrendered.client, booksAfter.client);
        await attachJson('7-cc', {
          balanceDeltaDbConvention: clientDelta.balanceDelta,
          expectedBalanceDelta: -(expected.ccMovementDelta ?? 0),
          note: 'Saldo = observacion (job WA_CHECKINGACCOUNT lo toca); el oraculo es el movimiento.'
        });
      }

      // Costo = venta (no Universal). Con pass-through (peaje/estacionamiento/NOCOM) el costo = venta - pass-through
      // (AC-12), pendiente de Q2/Q4: observation; sin pass-through (tarifa, otro comisionable, distancia) es estricto.
      const passesThrough = poQuestion === 'Q2' || poQuestion === 'Q4';
      const passThrough = round2(after.parts.toll + after.parts.parking + after.parts.otherNoCom);
      const costVerdict = evaluateEditedCostEqualsSale({
        total: after.parts.total,
        totalCost: pick(detailAfter, ['amountCost', 'finalCostPrice']),
        passThrough: passesThrough ? passThrough : 0
      });
      if (!passesThrough) {
        await verifyAc(testInfo, 'AC-FR-61', async () => {
          expect(costVerdict.ok, costVerdict.message).toBe(true);
          return { total: after.parts.total, passThrough: 0 };
        });
      } else {
        observation(
          testInfo,
          'AC-FR-65',
          `${poQuestion} abierta, ${c.id}, AC-61: costo vs venta menos pass-through ${costVerdict.ok ? 'coincide' : `difiere: ${costVerdict.message}`}`
        );
      }

      // Invariante: el lote pendiente sigue vacio (el viaje no se reencola)
      await verifyAc(testInfo, 'AC-FR-59', async () => {
        const pendingBatch = await surrenderClient.preview(batch);
        expect(
          pendingBatch.rows.map((r) => r.travelId),
          'el lote pendiente debe seguir vacio tras editar'
        ).toEqual([]);
        return { pendingRows: pendingBatch.rows.length };
      });

      // AC-13 (una vez por corrida): cerrar de nuevo un viaje ya rendido debe rechazarse sin cambiar nada.
      if (!finalizeRejectProbed) {
        finalizeRejectProbed = true;
        const stateBefore = await flow.readDetail({ travelId });
        let outcome: FinalizeOutcome = { accepted: true };
        try {
          await travelsApi.finalizeAdmin({ travelId, driverId: cfg.driverId });
        } catch (error) {
          if (!(error instanceof ApiStatusError)) throw error;
          outcome = { accepted: false, status: error.status, message: error.message };
        }
        const stateAfter = await flow.readDetail({ travelId });
        await verifyAc(testInfo, 'AC-FR-13', async () => {
          const v = evaluateFinalizeRejected({
            outcome,
            before: {
              state: String(stateBefore.state ?? ''),
              amount: round2(Number(stateBefore.amount))
            },
            after: {
              state: String(stateAfter.state ?? ''),
              amount: round2(Number(stateAfter.amount))
            }
          });
          expect(v.ok, v.message).toBe(true);
          return { outcome, travelId };
        });
      }
    });
  }

  test(`${SETTLED_ID}-validar-bloqueo-liquidado fare +1 sobre viaje liquidado`, async ({
    page,
    travelsApi
  }, testInfo) => {
    const raw = process.env.FR_SETTLED_TRAVEL_ID?.trim();
    test.skip(
      !raw ||
        !(
          selection.toLowerCase() === 'all' ||
          selection
            .split(',')
            .map((s) => s.trim())
            .includes(SETTLED_ID)
        ),
      'requiere FR_SETTLED_TRAVEL_ID y seleccionar EDM-SETTLED-409 (o FR_EDIT_CASES=all)'
    );
    makeAnnotate(FR_1901_KEYS.EDM_SETTLED, ROUTE)(SETTLED_ID, 'NEG');
    const travelId = Number(raw);
    if (!Number.isInteger(travelId) || travelId <= 0)
      throw new Error('FR_SETTLED_TRAVEL_ID invalido');
    const before = partsOf(await travelsApi.getDetail(travelId));
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      void d.dismiss().catch(() => undefined);
    });
    const editPromise = new TripEditPage(page)
      .editFinalPrices({
        travelId,
        fare: round2(before.parts.fare + 1),
        reason: `QA FR edit-matrix ${SETTLED_ID} (viaje ${travelId})`
      })
      .then(
        (result) => ({ result, error: null as string | null }),
        (error: unknown) => ({ result: null, error: (error as Error).message })
      );
    const [edit, uiMessages] = await Promise.all([
      editPromise,
      collectUiMessages(page, editPromise)
    ]);
    const messages = [...uiMessages, ...dialogs];
    await testInfo.attach('settled-edit', {
      body: JSON.stringify(
        { put: edit.result?.putStatus ?? null, error: edit.error, messages },
        null,
        2
      ),
      contentType: 'application/json'
    });
    const after = partsOf(await travelsApi.getDetail(travelId));
    // AC-53: sin PUT, el bloqueo del FE nunca es silencioso (alerta edit_prices.alert.body visible).
    const silent =
      edit.result !== null
        ? null
        : await verifyAc(testInfo, 'AC-FR-53', async () => {
            expect(
              messages.length,
              `sin PUT y sin mensaje visible: bloqueo silencioso (${edit.error ?? '-'})`
            ).toBeGreaterThan(0);
            return { messages };
          }).then(
            () => null,
            (error: unknown) => error
          );
    await verifyAc(testInfo, 'AC-FR-62', async () => {
      if (edit.result !== null) {
        expect(
          edit.result.putStatus,
          'viaje liquidado: PUT updateFinalPrices debe responder 409 TRAVEL_LIQUIDATED'
        ).toBe(409);
      }
      expect(after.parts, 'viaje liquidado: ningun importe debe cambiar').toEqual(before.parts);
      return { putStatus: edit.result?.putStatus ?? null, blockedByUiAlert: edit.result === null };
    });
    if (silent !== null) throw silent;
  });
});
