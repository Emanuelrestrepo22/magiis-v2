// tests/specs/trips/f5-surrender-confirm.spec.ts
// Universal F5 (MG-1024 BE + MG-1027 FE) · Rendición del chofer · CONFIRMACIÓN IRREVERSIBLE con trifuerza
// (UI → POST observado → DB → PDFs). Automatiza la confirmación manual TM-1655 (TC10) sobre un lote declarado.
//
// IRREVERSIBLE: consume el lote (viajes SURRENDERED=1, rendición nueva). Se omite SIEMPRE salvo
// `F5_CONFIRM_SURRENDER=1`, y solo lo ejecuta el orquestador desde el hilo principal (nunca un subagente).
// Un `test()` por regla de la tabla de decisión (R01 · R03 · R04 · R05 · R06; catálogo y matriz regla × carrier ×
// ambiente en `tests/data/carrier-v2/trips/f5-confirm-cases.ts`): una corrida confirma UN lote de UNA regla.
// Env:
//   F5_CONFIRM_SURRENDER=1        gate (obligatorio; alias de lectura FR_CONFIRM_SURRENDER)
//   ENV=uat|test                  nunca prod (H-08): la confirmación irreversible lanza con cualquier otro valor
//   F5_TARGETS=<id>               exactamente UN target (default 1040; ver tests/config/f5-targets.ts)
//   F5_CONFIRM_CASE=R01|R03|R04|R05|R06   regla a confirmar (obligatoria; el resto de los tests se salta)
//   F5_CONFIRM_TRIPS=<ids csv>    lote declarado a consumir (obligatorio; los pendientes del par deben ser EXACTAMENTE estos)
//   F5_CONFIRM_EXPECT_DUE=<importe> precondición de importe exacto: precarga de «Entregar» (o «Amount due to Driver» en
//                                 R06) tal como se ve en pantalla, p. ej. 49.250,00. Se contrasta antes de cualquier clic.
//   F5_CONFIRM_MISC=<n>           R04: gasto varios a teclear (decimal con punto; default 100 solo en AR 1040)
//   F5_CONFIRM_DELIVER=<n>        R03: entrega parcial en importe (default 60 % de lo adeudado)
//   F5_CONFIRM_DOUBLE_CLICK=1     (opcional) doble clic rápido en Confirm en cualquier regla (R04 lo hace siempre): UN solo POST
//   F5_CONFIRM_XRAY_KEY=TM-nnnn   (opcional) pisa la key primaria a acreditar (default: la de la regla; ver catálogo)
//   F5_PDF_MODE=layout|table|raw  modo fijo de pdftotext del ambiente (UAT = table)
//   F5_VERIFY_SURRENDER_ID=<TRAVELSSURRENDER.ID>  MODO SOLO VERIFICACION (no usa ni admite el gate): NO abre la vista
//                                 previa ni «Confirm»; re-ejecuta las comprobaciones posteriores contra una rendicion
//                                 YA confirmada (DB + Clearing/Driver Report re-descargados de Daily Clearing > Closed).
//                                 Guardia de red: aborta y cuenta cualquier escritura de rendicion.
//   F5_VERIFY_LAYERS=ui,api[,db]  capas (default TEST ui,api,db; ENV=uat ui,api). Sin `db` (UAT: decisión «solo UI+API») el
//                                 esperado sale del GET toTravelsSurrender previo (expectedFromGet), el id de la rendición de
//                                 la diferencia de Daily Clearing > Closed (antes/después) y los ACs de DB quedan «N/A»
//                                 (anotación `ac-na`, nunca PASS). El par chofer/vehículo exige F5_UAT_PAIR=<driverUserId>/<vehicleId>
//                                 (la confirmación irreversible no infiere el par). Verificación sin DB: además de
//                                 F5_VERIFY_SURRENDER_ID, F5_VERIFY_GET_SNAPSHOT=<ruta de f5-get-totals-preconfirm.json de la confirmación>.
// Orden: precondiciones y vista previa contra el oráculo (si algo no coincide NO se confirma: el lote no se
// gasta) → clic → comprobaciones posteriores ACUMULADAS (una falla no oculta las demás: la rendición no se repite).
// Comando exacto: ver `.session/regression-testing/2026-11-05-f5-rendicion-liquidacion/automation-confirm-spec.md`.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, regionStorageStatePath } from '../../fixtures/carrierRegionFixture.js';
import {
  CONFIRM_CASES,
  CONFIRM_RULES,
  assertCaseAllowed,
  formatTypedAmount,
  miscellanyAmount,
  parseConfirmCase,
  partialDeliverAmount,
  type ConfirmRule
} from '../../data/carrier-v2/trips/f5-confirm-cases.js';
import { parseMoney } from '../../utils/money.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { loadCarrierSession } from '../../api/clients/carrierSession.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import { activeF5Targets, resolveF5Target } from '../../config/f5-targets.js';
import { tryCreateOracleDb } from '../../db/OracleDb.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { f5DbNotApplicable, f5LayerEnabled } from '../../helpers/f5-layers.js';
import { evaluateGetInternal, expectedFromGet } from '../../helpers/f5-api-oracle.js';
import { newClosedSurrenderId } from '../../helpers/f5-pending-pair.js';
import {
  clearingNcObservation,
  clearingRows,
  driverReportRows,
  evaluateAnchoredRows,
  evaluateConfirmRow,
  evaluateDueBeforeConfirm,
  evaluateNoNaN,
  evaluateOwnerBook,
  evaluateZeroFareCommissions,
  type F5ConfirmExpected,
  evaluatePendingSet,
  evaluatePostAttempts,
  expectedConfirmation,
  expectedConfirmPost,
  parseConfirmTrips,
  withDeliver
} from '../../helpers/f5-confirm-oracle.js';
import { verifyF5Confirm } from '../../helpers/f5-confirm-acceptance.js';
import { verifyF5 } from '../../helpers/f5-acceptance.js';
import {
  evaluateCommissionsAgainstGet,
  evaluateGetAgainstExpected,
  evaluateGetCcNc,
  evaluateClearingNcRow,
  evaluateSurrenderPost,
  evaluateUiAgainstGet,
  evaluateUiFormats,
  expectedDeliverBalance,
  expectedF5,
  formatMismatches,
  parseF5Ui,
  parseF5UiRaw,
  readNcField,
  type F5Expected,
  type F5ExpectedPost,
  type F5UiReading
} from '../../helpers/f5-surrender-oracle.js';
import { isPdfBuffer } from '../../helpers/report-parse.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';
import {
  surrenderIdsOfTrips,
  readOwnerBookOfSurrender,
  readSurrenderHeader
} from '../../steps/trips/autoSurrender.steps.js';
import {
  F5_CONFIRM_GATE,
  F5_VERIFY_ENV,
  F5ConfirmSession,
  F5VerifyGuard,
  assertConfirmEnvAllowed,
  ccByCostOfTarget,
  clickPayDue,
  readDueState,
  readExpenseInputs,
  typeMiscellany,
  type ConfirmResult,
  downloadClosedSurrenderPdfs,
  downloadDriverReport,
  f5VerifySurrenderId,
  isConfirmRetired,
  isF5ConfirmGateOpen,
  listClosedSurrenderIds,
  readF5ConfirmRow,
  readPendingTripsOfPair,
  readTripPaymentMethods,
  readTripsSurrendered
} from '../../steps/trips/f5SurrenderConfirm.steps.js';
import {
  clearingText,
  evaluateAcrossPdfModes,
  type PdfTextMode,
  readF5CommissionInputs,
  readF5TripFacts,
  requireDriverId
} from '../../steps/trips/f5Surrender.steps.js';
import { verifyF5Surrender } from './f5-verify.js';
import { F5_KEYS } from '../../data/xray/f5-keys.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/pay/travels/confirm';

/** Primaria por regla (contrastada con Jira el 11/11, D-8); F5_KEYS es la fuente de los nombres. */
const F5_KEYS_BY_RULE: Record<ConfirmRule, string> = {
  R01: F5_KEYS.TC10_CIRCUITO,
  R03: F5_KEYS.TC11_PARCIAL,
  R04: F5_KEYS.TC12_GASTOS,
  R05: F5_KEYS.TC13_TARIFA_CERO,
  R06: F5_KEYS.TC9_SALDO_CHOFER
};

/** Key primaria a acreditar: `F5_CONFIRM_XRAY_KEY` pisa la de la regla (validada). */
const xrayKey = (rule: ConfirmRule): string => {
  const raw = process.env.F5_CONFIRM_XRAY_KEY?.trim() || F5_KEYS_BY_RULE[rule];
  if (!/^TM-\d+$/.test(raw)) throw new Error(`F5_CONFIRM_XRAY_KEY invalido: "${raw}"`);
  return raw;
};

/** Centavos enteros (null = NaN: no coincide con ningun esperado). */
const cents = (n: number | null): number => (n === null ? Number.NaN : Math.round(n * 100));

const num = (o: Record<string, unknown>, k: string): number =>
  typeof o[k] === 'number' ? (o[k] as number) : 0;

function pick(
  mismatches: ReadonlyArray<{ field: string; expected: unknown; actual: unknown }>,
  ...prefixes: string[]
): Array<{ field: string; expected: unknown; actual: unknown }> {
  return mismatches.filter((m) => prefixes.some((p) => m.field.startsWith(p)));
}

const attachJson = (testInfo: TestInfo, name: string, data: unknown): Promise<void> =>
  testInfo.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });

/** Persiste en el outputDir del test (y lo adjunta) ANTES de cualquier paso de UI que pueda cerrar la pagina. */
async function persist(testInfo: TestInfo, name: string, body: string | Buffer): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, body);
  await testInfo.attach(name, { path });
}

const targets = activeF5Targets();

// Una confirmación es irreversible: si un caso falla, los siguientes del archivo NO corren.
test.describe.configure({ mode: 'serial' });

const matrix = targets.flatMap((baseTarget) => CONFIRM_RULES.map((rule) => ({ baseTarget, rule })));

for (const { baseTarget, rule } of matrix) {
  const def = CONFIRM_CASES[rule];

  test.describe(`@P1 @functional @irreversible F5 rendición · confirmación ${rule} · carrier ${baseTarget.id}`, () => {
    test(`${F5_KEYS_BY_RULE[rule]}: ${def.title}; pantalla, POST, DB y PDFs coinciden con el oráculo (${rule} · ${baseTarget.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      let target = baseTarget;
      const verifyId = f5VerifySurrenderId();
      const dbLayer = f5LayerEnabled('db');
      // Sin gate se salta ANTES de abrir el navegador (ninguna fixture de página se pidió todavía).
      test.skip(
        verifyId === null && !isF5ConfirmGateOpen(),
        `${F5_CONFIRM_GATE}=1 requerido: la confirmación de la rendición es irreversible`
      );
      const selectedRule = parseConfirmCase(process.env.F5_CONFIRM_CASE);
      if (verifyId === null && selectedRule === null) {
        throw new Error(
          `[F5 confirm] declarar F5_CONFIRM_CASE=${CONFIRM_RULES.join('|')}: una corrida confirma UNA regla`
        );
      }
      test.skip(
        (selectedRule ?? 'R01') !== rule,
        `F5_CONFIRM_CASE=${selectedRule ?? '(verificación: R01)'}: este test es ${rule}`
      );
      if (verifyId === null) {
        const env = assertConfirmEnvAllowed();
        assertCaseAllowed(env, baseTarget.id, rule);
      }
      // E2E irreversible (preview + POST + PDFs + DB): el default de 60 s no alcanza (la corrida de 14189 lo agotó).
      test.setTimeout(300_000);
      if (verifyId !== null && isF5ConfirmGateOpen()) {
        throw new Error(
          `[F5 verify] ${F5_VERIFY_ENV} y ${F5_CONFIRM_GATE}=1 a la vez: la verificación es de solo lectura, quitar el gate`
        );
      }
      if (targets.length !== 1) {
        throw new Error(
          `[F5 confirm] una confirmación irreversible exige UN solo target en F5_TARGETS (hay ${targets.length})`
        );
      }
      const key = xrayKey(rule);
      makeAnnotate(key, ROUTE)(`${rule}-confirm`, 'E2E');
      // Keys secundarias: se ANOTAN como observation (no `tms`): son Cucumber de otros epics (mapeo débil, D-8) o
      // casos solo-vista; no se acreditan sin la auditoría de consistencia del GO.
      for (const sec of def.secondaryKeys) {
        testInfo.annotations.push({
          type: 'observation',
          description: `key secundaria ${sec.key} (no acredita): ${sec.note}`
        });
      }
      const declared = parseConfirmTrips(process.env.F5_CONFIRM_TRIPS);
      const clicks = def.doubleClick || process.env.F5_CONFIRM_DOUBLE_CLICK === '1' ? 2 : 1;
      const miscellany = def.miscellany
        ? miscellanyAmount(baseTarget.id, process.env.F5_CONFIRM_MISC)
        : 0;
      const expectDueRaw = process.env.F5_CONFIRM_EXPECT_DUE?.trim() ?? '';
      if (verifyId === null && expectDueRaw === '') {
        throw new Error(
          '[F5 BLOCKED] declarar F5_CONFIRM_EXPECT_DUE=<importe exacto precargado en «Entregar», p. ej. 49.250,00>'
        );
      }

      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId, `la sesión de región debe ser del carrier ${target.id}`).toBe(
        target.carrierId
      );
      const api = await session.newApiContext(playwright.request);
      try {
        const client = new SurrenderClient(api, session);
        // Par: fijo en TEST; en UAT (par en runtime) sale de la grilla de pendientes y la confirmación lo exige
        // explícito (F5_UAT_PAIR). El modo verificación no abre el par: no lo necesita.
        if (target.pair === 'runtime' && verifyId === null) {
          const resolved = resolveF5Target(target, await client.pendingSummary(), {
            requireExplicit: true
          });
          if (!resolved) {
            throw new Error(
              `[F5 BLOCKED] sin pendientes para el par de F5_UAT_PAIR en la grilla de Daily Clearing › Pending (${target.id})`
            );
          }
          target = resolved;
        }
        const batch = { driverUserId: target.driverUserId, vehicleId: target.vehicleId };
        // Capa DB: solo con `db` activa (TEST). Sin ella (UAT) no se abre ninguna conexión.
        const oracle = dbLayer
          ? requireOracle(tryCreateOracleDb(), `F5 ${target.id} (confirmación)`)
          : null;
        const driverId =
          oracle === null ? null : await requireDriverId(oracle, target.driverUserId);
        const buildOracle = async (
          tripsIn: ReadonlyArray<{ travelId: number; paymentMethod: string }>,
          financialCost: number,
          beforeSurrenderId?: number
        ) => {
          if (oracle === null || driverId === null) {
            throw new Error('[F5] buildOracle requiere la capa db');
          }
          // H-02: CC por costo según el perfil del vehiculo del par (undefined = el oraculo no asume).
          const ccByCost = ccByCostOfTarget(target);
          const facts = await readF5TripFacts(
            oracle,
            tripsIn.map((t) => ({ ...t, ...(ccByCost === undefined ? {} : { ccByCost }) }))
          );
          const exp = expectedF5(facts);
          const inp = await readF5CommissionInputs(oracle, {
            travelIds: tripsIn.map((t) => t.travelId),
            driverId,
            vehicleId: target.vehicleId,
            beforeSurrenderId
          });
          const wnt = expectedConfirmation({
            expected: exp,
            inputs: inp,
            ownerFinancialCost: financialCost,
            miscellanyVoucher: miscellany
          });
          await attachJson(testInfo, 'f5-oracle', {
            declared,
            facts,
            expected: exp,
            inputs: inp,
            want: wnt
          });
          return { expected: exp, inputs: inp, want: wnt };
        };

        let trips: Array<{ travelId: number; paymentMethod: string }>;
        let expected!: F5Expected;
        let want: F5ConfirmExpected | null = null;
        let wantPost!: F5ExpectedPost;
        let ownerFinancialCost = 0;
        // Acciones del operador de la regla (R03 entrega parcial): el esperado del POST/DB las incluye.
        let driverCommission = 0;
        let zeroFareEvidence: Record<string, unknown> | null = null;
        let deliverAmount: number | undefined;
        const resolveDeliver = (dueNet: number): number | undefined => {
          if (def.deliver.kind !== 'ratio') return undefined;
          const override = process.env.F5_CONFIRM_DELIVER?.trim();
          if (override) {
            const n = Number(override);
            if (!Number.isFinite(n) || n <= 0) {
              throw new Error(`F5_CONFIRM_DELIVER invalido: "${override}"`);
            }
            return n;
          }
          return partialDeliverAmount(dueNet, def.deliver.ratio);
        };
        /** POST esperado sin DB (esperado del GET): gastos + entrega parcial de la regla. */
        const postFromGet = (cashToSurrender: number, commission: number): F5ExpectedPost => {
          driverCommission = commission;
          const due = expectedConfirmPost({
            cashToSurrender,
            driverCommission: commission,
            miscellanyVoucher: miscellany
          });
          deliverAmount = resolveDeliver(due.agencyNetPaid);
          return expectedConfirmPost({
            cashToSurrender,
            driverCommission: commission,
            miscellanyVoucher: miscellany,
            deliver: deliverAmount
          });
        };
        /** Esperado de DB con la entrega parcial de la regla (la precarga sale del propio esperado). */
        const withRuleDeliver = (w: F5ConfirmExpected): F5ConfirmExpected => {
          driverCommission = w.commissions.COMMISSIONSUM as number;
          deliverAmount = resolveDeliver(w.post.agencyNetPaid);
          return deliverAmount === undefined ? w : withDeliver(w, deliverAmount);
        };
        // Capa API (UAT): rendiciones de Closed antes de confirmar (la nueva = la diferencia).
        let closedBefore: number[] = [];
        let apiBatchRows: ReadonlyArray<{ paymentMethod?: string | null }> = [];
        let page: Page;
        let surrender: SurrenderPage | null = null;
        let guard: F5ConfirmSession | null = null;
        let verifyGuard: F5VerifyGuard | null = null;
        let result: ConfirmResult | null = null;
        let surrenderId: number | null = verifyId;

        if (verifyId === null) {
          // ───── Precondiciones (nada se confirma si alguna falla) ─────
          if (oracle !== null && driverId !== null) {
            const pendingDb = await readPendingTripsOfPair(oracle, {
              driverId,
              vehicleId: target.vehicleId
            });
            const pendingVerdict = evaluatePendingSet(pendingDb, declared);
            expect(
              pendingVerdict.ok,
              formatMismatches(
                '[F5 BLOCKED] pendientes del par en DB vs lote declarado (F5_CONFIRM_TRIPS)',
                pendingVerdict.mismatches
              )
            ).toBe(true);
          } else {
            f5DbNotApplicable(testInfo, 'precondición: pendientes del par en DB vs lote declarado');
          }
          const preview = await client.preview(batch);
          trips = preview.rows.map((row) => {
            if (typeof row.travelId !== 'number' || typeof row.paymentMethod !== 'string') {
              throw new Error('precondición: fila de toSurrend sin travelId/paymentMethod');
            }
            return { travelId: row.travelId, paymentMethod: row.paymentMethod };
          });
          const getBatchVerdict = evaluatePendingSet(
            trips.map((t) => t.travelId),
            declared
          );
          expect(
            getBatchVerdict.ok,
            formatMismatches(
              '[F5 BLOCKED] lote del GET toSurrend vs declarado',
              getBatchVerdict.mismatches
            )
          ).toBe(true);

          const apiTotals = await client.totals(batch);
          ownerFinancialCost =
            num(apiTotals, 'ownerCheckingAccountFinancialCost') +
            num(apiTotals, 'ownerCreditCardFinancialCost');
          let inputs: Awaited<ReturnType<typeof buildOracle>>['inputs'] | null = null;
          if (oracle !== null) {
            const built = await buildOracle(trips, ownerFinancialCost);
            expected = built.expected;
            want = withRuleDeliver(built.want);
            wantPost = want.post;
            inputs = built.inputs;
          } else {
            // Sin DB: el esperado sale del GET (identidades + pantalla + POST + PDF se contrastan entre sí).
            expected = expectedFromGet(apiTotals);
            wantPost = postFromGet(expected.cashToSurrender, num(apiTotals, 'commissionSum'));
            apiBatchRows = preview.rows;
            await attachJson(testInfo, 'f5-oracle-api', { declared, expected, wantPost });
            // Closed antes de confirmar, en una página aparte (no se navega fuera de la confirmación).
            closedBefore = await listClosedSurrenderIds(await carrierPage(target.region));
          }

          // ───── Vista previa contra el oráculo (si no coincide, NO se confirma) ─────
          page = await carrierPage(target.region);
          const ui0 = new SurrenderPage(page);
          surrender = ui0;
          const guard0 = await F5ConfirmSession.arm(page, batch);
          guard = guard0;
          await ui0.openPending();
          await ui0.selectBatch(batch);
          const opened = await ui0.readPreview();
          if (opened.totals === null) {
            throw new Error(
              'precondición: la pantalla no disparó GET toTravelsSurrender (totales)'
            );
          }
          const uiTotals = opened.totals;
          const lines = await ui0.readBodyLines();
          const ui: F5UiReading = parseF5Ui(lines);
          const rawUi = parseF5UiRaw(lines);
          const uiVsGet = evaluateUiAgainstGet(ui, uiTotals);

          await verifyF5(testInfo, 'AC-F5-07', () => {
            expect(
              opened.travelIds.slice().sort((a, b) => a - b),
              'lote de la pantalla = declarado'
            ).toEqual(declared);
            expect(opened.uiTravelsCount, 'tarjeta de viajes = lote declarado').toBe(
              declared.length
            );
            return { travelIds: opened.travelIds, uiTravelsCount: opened.uiTravelsCount };
          });
          if (oracle !== null) {
            await verifyF5(testInfo, 'AC-F5-08', () => {
              const v = evaluateGetAgainstExpected(uiTotals, expected);
              expect(
                v.ok,
                formatMismatches('GET de la pantalla vs esperado desde DB', v.mismatches)
              ).toBe(true);
              return { expected };
            });
          } else {
            f5DbNotApplicable(testInfo, 'AC-F5-08 (GET vs esperado desde DB)');
            const internal = evaluateGetInternal(uiTotals, apiBatchRows);
            expect(
              internal.ok,
              formatMismatches('GET toTravelsSurrender · identidades (API)', internal.mismatches)
            ).toBe(true);
          }
          await verifyF5(testInfo, 'AC-F5-01', () => {
            const nc = readNcField(uiTotals);
            expect(nc.verdict.ok, formatMismatches('GET campo NC', nc.verdict.mismatches)).toBe(
              true
            );
            return { nc: nc.field };
          });
          await verifyF5(testInfo, 'AC-F5-02', () => {
            // Línea NC: presente sii NC efectivo > 0 y con ese importe; con NC = 0 ausente (ni «0,00»).
            if (expected.ncCash.amount > 0) {
              expect(cents(ui.ncLine), 'línea NC de la pantalla').toBe(
                cents(expected.ncCash.amount)
              );
            } else expect(ui.ncLine, 'sin NC efectivo la línea no se muestra').toBeNull();
            const m = pick(uiVsGet.mismatches, 'UI linea NC');
            expect(m.length === 0, formatMismatches('línea NC vs GET', m)).toBe(true);
            return { ncLineUi: ui.ncLine, ncExpected: expected.ncCash };
          });
          await verifyF5(testInfo, 'AC-F5-03', () => {
            expect(
              cents(ui.totalCash),
              'Total Cash de la pantalla = efectivo a rendir esperado'
            ).toBe(cents(expected.cashToSurrender));
            const m = pick(uiVsGet.mismatches, 'UI Total Cash');
            expect(m.length === 0, formatMismatches('Total Cash vs GET', m)).toBe(true);
            return { totalCashUi: ui.totalCash, expected: expected.cashToSurrender };
          });
          await verifyF5(testInfo, 'AC-F5-04', () => {
            expect(cents(ui.totalCollected), 'Total Amount Collected = esperado').toBe(
              cents(expected.totalCollected)
            );
            const m = pick(
              uiVsGet.mismatches,
              'UI Total Amount Collected',
              'UI Cash Trips',
              'UI Credit Account',
              'UI Taxes'
            );
            expect(m.length === 0, formatMismatches('Total recaudado vs GET', m)).toBe(true);
            return { totalCollectedUi: ui.totalCollected, expected: expected.totalCollected };
          });
          await verifyF5(testInfo, 'AC-F5-05', () => {
            const m = pick(
              uiVsGet.mismatches,
              'UI driverCommissions',
              'UI companyCommissions',
              'UI ownerCommissions'
            );
            expect(m.length === 0, formatMismatches('comisiones de pantalla vs GET', m)).toBe(true);
            return {
              driver: ui.driverCommissions,
              company: ui.companyCommissions,
              owner: ui.ownerCommissions
            };
          });
          if (inputs !== null) {
            const commissionInputs = inputs;
            await verifyF5(testInfo, 'AC-F5-14', () => {
              const v = evaluateCommissionsAgainstGet(uiTotals, expected, commissionInputs);
              expect(
                v.ok,
                formatMismatches('comisiones del GET vs pct × base sin NC', v.mismatches)
              ).toBe(true);
              return { inputs: commissionInputs };
            });
          } else {
            f5DbNotApplicable(testInfo, 'AC-F5-14 (pct × base sin NC desde DB)');
          }
          await verifyF5(testInfo, 'AC-F5-15', () => {
            const required: Array<keyof F5UiReading> = [
              'totalCash',
              'totalCollected',
              'cashTrips',
              ...(expected.ncCash.amount > 0 ? (['ncLine'] as const) : [])
            ];
            const v = evaluateUiFormats(rawUi, target.moneyFormat, required);
            expect(v.ok, formatMismatches('formato de importes', v.mismatches)).toBe(true);
            return { raw: rawUi };
          });
          await verifyF5(testInfo, 'AC-F5-16', () => {
            // Con DB: contra la suma NC de los viajes CC. Sin DB: el campo es contrato (presente y numérico) y el
            // GET es internamente coherente; comparar el GET consigo mismo no sería una aserción.
            const v =
              oracle !== null
                ? evaluateGetCcNc(uiTotals, expected)
                : evaluateGetInternal(uiTotals, apiBatchRows);
            expect(
              v.ok,
              formatMismatches('GET checkingAccountAgencyProfitDiff', v.mismatches)
            ).toBe(true);
            return {
              layer: oracle !== null ? 'db' : 'api',
              ncCheckingAccount: expected.ncCheckingAccount
            };
          });
          // ───── Precondición de importe exacto (antes de cualquier acción) ─────
          // «Entregar» sin tocar: precarga = monto a entregar; es lo que viaja como agencyNetPaid (sin lado «Driver»).
          // Con saldo a favor del chofer (R06) no hay precarga que validar: el importe exacto es «Amount due to Driver».
          const expectDue = parseMoney(expectDueRaw);
          const preloadWant = expectedConfirmPost({
            cashToSurrender: expected.cashToSurrender,
            driverCommission
          });
          let deliverBase = 0;
          if (def.driverBalance) {
            const due0 = await readDueState(page);
            expect(due0.kind, `${rule}: el saldo debe ser a favor del chofer`).toBe('Driver');
            expect(
              cents(due0.amount),
              'F5_CONFIRM_EXPECT_DUE vs «Amount due to Driver» (precondición del lote)'
            ).toBe(cents(expectDue));
          } else {
            const deliver = await ui0.assertDeliverFieldIsEntregar();
            deliverBase = Math.abs(deliver.base);
            const preloaded = parseMoney(await ui0.deliverInput.inputValue());
            expect(
              cents(preloaded),
              'precarga EXACTA de «Entregar» vs F5_CONFIRM_EXPECT_DUE (precondición del lote)'
            ).toBe(cents(expectDue));
            expect(
              cents(deliverBase),
              'precarga de «Entregar» = agencyNetPaid esperado (sin acciones del operador)'
            ).toBe(cents(preloadWant.agencyNetPaid));
          }
          await expect(
            ui0.confirmButton,
            'Confirm debe estar habilitado antes de confirmar'
          ).toBeEnabled();
          expect(guard0.postCount(), 'la vista previa no puede haber intentado el POST').toBe(0);

          // ───── Tarifa 0 (R05): sin NaN/Infinity ni comisión; la evidencia se juzga con los PDF (AC-F5-21) ─────
          if (def.zeroFare) {
            const screenNaN = evaluateNoNaN('pantalla de confirmación', lines.join('\n'));
            expect(
              screenNaN.ok,
              formatMismatches('R05 pantalla sin NaN/Infinity', screenNaN.mismatches)
            ).toBe(true);
            const zeroCommissions = evaluateZeroFareCommissions(uiTotals);
            expect(
              zeroCommissions.ok,
              formatMismatches('R05 comisiones del GET con tarifa 0', zeroCommissions.mismatches)
            ).toBe(true);
            zeroFareEvidence = { screenLines: lines.length, getCommissionsZero: true };
          }

          // ───── Acciones del operador de la regla (AC-F5-22); ninguna pulsa Confirm ─────
          if (def.deliver.kind === 'ratio' || def.miscellany || def.driverBalance) {
            await verifyF5Confirm(testInfo, 'AC-F5-22', async () => {
              const fmt = target.moneyFormat;
              const dueMismatches = async (want: {
                kind: 'Company' | 'Driver';
                amount: number;
              }): Promise<string> =>
                JSON.stringify(evaluateDueBeforeConfirm(await readDueState(page), want).mismatches);
              if (def.deliver.kind === 'ratio') {
                // R03: entrega parcial. Se teclea, se sale con Tab y se contrasta ANTES del clic (un dígito perdido
                // dejaría 7.250 en vez de 47.250: handoff AR #2).
                const amount = deliverAmount as number;
                await ui0.typeDeliver(formatTypedAmount(amount, fmt), { guardShown: false });
                await page.keyboard.press('Tab');
                await expect
                  .poll(async () => cents(parseMoney(await ui0.deliverInput.inputValue())), {
                    timeout: 10_000,
                    message: '«Entregar» no quedó con la entrega parcial tecleada'
                  })
                  .toBe(cents(amount));
                const w = expectedDeliverBalance(deliverBase, amount);
                await expect
                  .poll(() => dueMismatches({ kind: w.kind, amount: w.balance }), {
                    timeout: 10_000,
                    message: 'saldo tras la entrega parcial distinto del cálculo independiente'
                  })
                  .toBe('[]');
                return { typed: amount, due: w };
              }
              if (def.miscellany) {
                // R04: gasto varios y luego «$» (entrega todo lo adeudado). Tras el gasto, «Entregar» sigue en la
                // precarga y el saldo pasa a ser del chofer por el gasto (handoff AR #3: Due to Driver 100,00).
                await typeMiscellany(page, formatTypedAmount(miscellany, fmt));
                const afterMisc = await ui0.readDeliverBase();
                expect(cents(afterMisc.deductions), 'Deductions & Expenses = gasto varios').toBe(
                  cents(miscellany)
                );
                expect(cents(afterMisc.base), 'monto a entregar = precarga − gasto varios').toBe(
                  cents(deliverBase - miscellany)
                );
                await clickPayDue(page);
                await expect
                  .poll(async () => cents(parseMoney(await ui0.deliverInput.inputValue())), {
                    timeout: 10_000,
                    message: 'el clic en «$» no dejó «Entregar» con todo lo adeudado'
                  })
                  .toBe(cents(afterMisc.base));
                await expect
                  .poll(() => dueMismatches({ kind: 'Company', amount: 0 }), {
                    timeout: 10_000,
                    message: 'tras «$» el saldo debe quedar en 0,00'
                  })
                  .toBe('[]');
                const inputs = await readExpenseInputs(page);
                expect(cents(parseMoney(inputs.miscellany)), 'campo Other Expenses').toBe(
                  cents(miscellany)
                );
                expect(cents(parseMoney(inputs.fuel)), 'campo Fuel Expenses sin tocar').toBe(0);
                return { miscellany, deliverAfterPay: afterMisc.base, inputs };
              }
              // R06: saldo a favor del chofer = comisión − efectivo a rendir (oráculo independiente).
              const w = {
                kind: 'Driver' as const,
                amount: Math.round((driverCommission - expected.cashToSurrender) * 100) / 100
              };
              await expect
                .poll(() => dueMismatches(w), {
                  timeout: 10_000,
                  message: 'saldo a favor del chofer distinto del cálculo independiente'
                })
                .toBe('[]');
              return { due: w };
            });
            await expect(
              ui0.confirmButton,
              'Confirm debe seguir habilitado tras las acciones del operador'
            ).toBeEnabled();
            expect(
              guard0.postCount(),
              'las acciones previas no pueden haber intentado el POST'
            ).toBe(0);
          }

          // ───── CONFIRMACIÓN (irreversible) ─────
          result = await guard0.confirm(ui0, clicks);
          // Persistir YA (antes de cualquier paso de UI que pueda cerrar la página o agotar el timeout).
          await persist(
            testInfo,
            'f5-post-request-body.json',
            JSON.stringify(result.requestBody, null, 2)
          );
          await persist(
            testInfo,
            'f5-post-response.json',
            JSON.stringify({ status: result.status, body: result.responseSummary }, null, 2)
          );
          if (result.clearingPdf !== null) {
            await persist(testInfo, 'f5-clearing-post.pdf', result.clearingPdf);
          }
          await persist(
            testInfo,
            'f5-get-totals-preconfirm.json',
            JSON.stringify(uiTotals, null, 2)
          );
        } else {
          // ───── MODO SOLO VERIFICACION: ni vista previa ni «Confirm»; rendición ya confirmada ─────
          if (oracle !== null) {
            trips = await readTripPaymentMethods(oracle, declared);
            // Última rendición del chofer = la anterior a esta (la fija por día depende de ella).
            const built = await buildOracle(trips, 0, verifyId);
            expected = built.expected;
            want = withRuleDeliver(built.want);
            wantPost = want.post;
            if (
              expected.totalCheckingAccount.quantity > 0 ||
              expected.totalCreditCard.quantity > 0
            ) {
              throw new Error(
                '[F5 verify] el lote tiene viajes CC/tarjeta: el costo financiero del propietario solo se conoce del GET previo a la confirmación; este modo no lo soporta'
              );
            }
          } else {
            // Sin DB: el esperado sale del GET previo a la confirmación (lo persistió la corrida de confirmación).
            const snapshotPath = process.env.F5_VERIFY_GET_SNAPSHOT?.trim();
            if (!snapshotPath) {
              throw new Error(
                '[F5 verify] sin capa db hace falta F5_VERIFY_GET_SNAPSHOT=<ruta de f5-get-totals-preconfirm.json de la confirmación>'
              );
            }
            const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<
              string,
              unknown
            >;
            expected = expectedFromGet(snapshot);
            wantPost = postFromGet(expected.cashToSurrender, num(snapshot, 'commissionSum'));
            trips = [];
          }
          page = await carrierPage(target.region);
          verifyGuard = await F5VerifyGuard.arm(page);
        }

        // ───── Comprobaciones posteriores: se ACUMULAN (la rendición no se repite) ─────
        const failures: string[] = [];
        const guarded = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
          try {
            await fn();
          } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        };

        // 1) DB primero (no depende de la página): el snapshot se persiste antes de tocar la UI.
        // Sin capa db (UAT) el id de la rendición sale de la diferencia de Daily Clearing > Closed.
        let ownerRows: Awaited<ReturnType<typeof readOwnerBookOfSurrender>> = [];
        if (surrenderId === null && oracle === null) {
          const aux = await carrierPage(target.region);
          const holder: { id: number | null } = { id: null };
          await expect
            .poll(
              async () => {
                const fresh = (await listClosedSurrenderIds(aux)).filter(
                  (id) => !closedBefore.includes(id)
                );
                holder.id = fresh.length === 1 ? fresh[0] : null;
                return fresh.length;
              },
              {
                timeout: 30_000,
                message:
                  'Daily Clearing > Closed no muestra exactamente 1 rendición nueva tras confirmar'
              }
            )
            .toBe(1);
          surrenderId = newClosedSurrenderId(closedBefore, [...closedBefore, holder.id as number]);
        }
        if (surrenderId === null && oracle !== null) {
          const holder: { id: number | null } = { id: null };
          await expect
            .poll(
              async () => {
                holder.id =
                  (await surrenderIdsOfTrips(oracle, [declared[0]])).get(declared[0]) ?? null;
                return holder.id;
              },
              {
                timeout: 30_000,
                message: `el viaje ${declared[0]} no obtuvo TRAVELSSURRENDER_ID tras confirmar`
              }
            )
            .not.toBeNull();
          surrenderId = holder.id;
        }
        const sid = surrenderId as number;
        if (oracle !== null) {
          ownerRows = await readOwnerBookOfSurrender(oracle, sid);
          const dbOracle = oracle;
          const dbOwnerRows = ownerRows;
          await guarded('snapshot DB', async () => {
            const snapshot = {
              surrenderId: sid,
              trips: await readTripsSurrendered(dbOracle, declared),
              header: await readSurrenderHeader(dbOracle, sid),
              row: await readF5ConfirmRow(dbOracle, sid),
              ownerRows: dbOwnerRows
            };
            await persist(testInfo, 'f5-db-snapshot.json', JSON.stringify(snapshot, null, 2));
          });
        } else {
          f5DbNotApplicable(
            testInfo,
            'snapshot DB y ACs AC-F5-09/10/18/19 (TRAVELSSURRENDER, libro del propietario)'
          );
        }

        // 2) PDFs: confirmación = respuesta del POST + Reporte Chofer; verificación = re-descarga de Daily Clearing > Closed.
        // Los PDF reimpresos desde Closed (servidor) vienen en columnas: con -layout el importe no queda en el renglon
        // del rotulo. `-raw` (orden del content stream) lo deja «rotulo ... importe», igual que el Clearing del POST.
        const pdfMode = verifyId === null ? 'layout' : 'raw';
        // Orden de lectura para las filas ancladas: el modo habitual primero y luego los otros (UAT 06/11: el
        // Clearing del POST solo queda anclado con `-table`). El anclaje por renglón es el mismo en todos.
        const pdfModes: readonly PdfTextMode[] =
          verifyId === null ? ['layout', 'table', 'raw'] : ['raw', 'table', 'layout'];
        let clearingPdf: Buffer | null = result?.clearingPdf ?? null;
        let driverReport: Buffer | null = null;
        if (verifyId !== null) {
          await guarded('descarga PDFs Daily Clearing > Closed', async () => {
            const closed = await downloadClosedSurrenderPdfs(page, sid);
            clearingPdf = closed.clearing;
            driverReport = closed.driverReport;
            await persist(testInfo, 'f5-clearing-closed.pdf', closed.clearing);
            await persist(testInfo, 'f5-reporte-chofer-closed.pdf', closed.driverReport);
          });
        } else {
          await guarded('descarga Reporte Chofer (#print_surrender_driver)', async () => {
            driverReport = await downloadDriverReport(page);
            if (driverReport !== null) {
              await persist(testInfo, 'f5-reporte-chofer-post.pdf', driverReport);
            }
          });
        }

        // 3) Aserciones.
        if (result !== null && guard !== null && surrender !== null) {
          const confirmed = result;
          const confirmGuard = guard;
          const confirmUi = surrender;
          await guarded('AC-F5-17', () =>
            verifyF5Confirm(testInfo, 'AC-F5-17', async () => {
              expect(confirmed.status, 'status del POST toTravelsSurrender').toBe(200);
              await expect
                .poll(() => isConfirmRetired(confirmUi), {
                  timeout: 15_000,
                  message: 'Confirm sigue accionable tras el 200 (riesgo de doble envío)'
                })
                .toBe(true);
              const v = evaluatePostAttempts(confirmGuard.postCount());
              expect(v.ok, formatMismatches('POST único', v.mismatches)).toBe(true);
              expect(
                confirmGuard.foreignWriteCount(),
                'escrituras ajenas abortadas por la guardia'
              ).toBe(0);
              return { posts: confirmGuard.postCount(), clicks, status: confirmed.status };
            })
          );
          await guarded('AC-F5-12', () =>
            verifyF5(testInfo, 'AC-F5-12', () => {
              // Body contra el oráculo INDEPENDIENTE (comisión del chofer calculada, no leída de DB). Sin gastos tipeados.
              const v = evaluateSurrenderPost(confirmed.requestBody, wantPost);
              expect(v.ok, formatMismatches('POST toTravelsSurrender (body)', v.mismatches)).toBe(
                true
              );
              return { body: confirmed.requestBody, want: wantPost };
            })
          );
        } else if (verifyGuard !== null) {
          const readOnlyGuard = verifyGuard;
          await guarded('guardia solo-lectura', async () => {
            expect(
              readOnlyGuard.blockedCount(),
              'escrituras de rendición abortadas por la guardia (debe ser 0)'
            ).toBe(0);
          });
          testInfo.annotations.push({
            type: 'observation',
            description:
              'AC-F5-17/AC-F5-12 no aplican en verificación: el POST ocurrió en la confirmación y no es observable a posteriori; su efecto (columnas, libro, viajes) lo juzgan AC-F5-19/18/09.'
          });
        }

        if (oracle !== null && want !== null) {
          const dbOracle = oracle;
          const dbWant = want;
          await guarded('AC-F5-19', () =>
            verifyF5Confirm(testInfo, 'AC-F5-19', async () => {
              const tripRows = await readTripsSurrendered(dbOracle, declared);
              expect(
                tripRows.map((t) => t.id),
                'viajes del lote en DB'
              ).toEqual(declared);
              for (const t of tripRows) {
                expect(t.surrendered, `viaje ${t.id} SURRENDERED`).toBe(1);
                expect(t.surrenderId, `viaje ${t.id} TRAVELSSURRENDER_ID`).toBe(sid);
              }
              const header = await readSurrenderHeader(dbOracle, sid);
              expect(header.DRIVER_ID, 'TRAVELSSURRENDER.DRIVER_ID').toBe(target.driverUserId);
              expect(header.VEHICLE_ID, 'TRAVELSSURRENDER.VEHICLE_ID').toBe(target.vehicleId);
              const row = await readF5ConfirmRow(dbOracle, sid);
              const v = evaluateConfirmRow(row, dbWant);
              expect(
                v.ok,
                formatMismatches(`TRAVELSSURRENDER ${sid} vs oráculo`, v.mismatches)
              ).toBe(true);
              return { sid, tripRows, header, row };
            })
          );

          await guarded('AC-F5-18', () =>
            verifyF5Confirm(testInfo, 'AC-F5-18', () => {
              if (
                expected.totalCheckingAccount.quantity === 0 &&
                expected.totalCreditCard.quantity === 0
              ) {
                expect(
                  ownerFinancialCost,
                  'sin viajes CC/tarjeta el costo financiero del propietario es 0'
                ).toBe(0);
              }
              const v = evaluateOwnerBook(ownerRows, dbWant.ownerBook);
              expect(
                v.ok,
                formatMismatches(`libro del propietario (rendición ${sid})`, v.mismatches)
              ).toBe(true);
              return {
                ownerRows,
                want: dbWant.ownerBook,
                otherCodes: v.otherCodes,
                ownerFinancialCost
              };
            })
          );
        } else {
          // API: el lote queda consumido (GET toSurrend del par sin los viajes declarados). Sin etiqueta AC: los
          // AC-F5-18/19 son de DB y quedan N/A, nunca PASS.
          await guarded('API lote consumido', async () => {
            await expect
              .poll(
                async () => {
                  const left = (await client.preview(batch)).rows.map((r) => r.travelId);
                  return declared.filter((id) => left.includes(id));
                },
                {
                  timeout: 30_000,
                  message: 'el GET toSurrend del par sigue listando viajes del lote tras confirmar'
                }
              )
              .toEqual([]);
          });
        }

        // AC-F5-09 (columnas F5), AC-F5-16 (NC de CC en DB), AC-F5-10 (sin TDOC en manual), AC-F5-11 (fila NC del
        // Clearing). El body (AC-F5-12) ya se juzgó arriba con el oráculo independiente (postBody omitido a propósito).
        if (oracle !== null) {
          const dbOracle = oracle;
          await guarded('verifyF5Surrender', () =>
            verifyF5Surrender({
              testInfo,
              oracle: dbOracle,
              trips,
              surrender: { surrenderId: sid },
              automatic: false,
              ownerRows,
              clearingPdf
            })
          );
        } else {
          f5DbNotApplicable(testInfo, 'AC-F5-09 / AC-F5-10 (columnas y libro en DB)');
          // AC-F5-11 es del PDF (capa API/UI): se juzga igual, contra el NC del GET previo a la confirmación.
          await guarded('AC-F5-11', async () => {
            const pdf = clearingPdf;
            if (pdf === null) {
              if (expected.ncCash.amount > 0) {
                await verifyF5(testInfo, 'AC-F5-11', () => {
                  throw new Error(
                    'sin PDF del Clearing y NC efectivo > 0: no se puede verificar la fila NC'
                  );
                });
              }
              return;
            }
            await verifyF5(testInfo, 'AC-F5-11', () => {
              const { verdict: v, mode } = evaluateAcrossPdfModes(pdf, pdfModes, (t) =>
                evaluateClearingNcRow(t, { ncCash: expected.ncCash.amount })
              );
              expect(v.ok, formatMismatches('Clearing PDF (fila NC)', v.mismatches)).toBe(true);
              return {
                ncCash: expected.ncCash.amount,
                labelPresent: v.labelPresent,
                pdfMode: mode
              };
            });
          });
        }

        await guarded('AC-F5-20', () =>
          verifyF5Confirm(testInfo, 'AC-F5-20', async () => {
            const pdf = clearingPdf;
            expect(
              pdf !== null && isPdfBuffer(pdf),
              'el Clearing (PDF) debe estar disponible: respuesta del POST o Daily Clearing > Closed'
            ).toBe(true);
            const text = clearingText(pdf as Buffer, pdfMode);
            await testInfo.attach('f5-clearing.pdf', {
              body: pdf as Buffer,
              contentType: 'application/pdf'
            });
            // Q2 (abierta con el PO): con NC efectivo = 0 el Clearing puede dibujar la fila NC en 0,00. Se registra el
            // comportamiento ACTUAL como observación (no se asevera a favor ni en contra).
            const q2 = clearingNcObservation(text, expected.ncCash.amount);
            if (q2 !== null) testInfo.annotations.push({ type: 'observation', description: q2 });
            const { verdict: c, mode: clearingMode } = evaluateAcrossPdfModes(
              pdf as Buffer,
              pdfModes,
              (t) => evaluateAnchoredRows(t, clearingRows(expected, wantPost))
            );
            expect(c.ok, formatMismatches('Clearing PDF (filas ancladas)', c.mismatches)).toBe(
              true
            );
            let driverReportChecked = false;
            if (driverReport === null) {
              testInfo.annotations.push({
                type: 'observation',
                description:
                  'AC-F5-20 Reporte Chofer no disponible o no capturable: solo se juzgó el Clearing'
              });
            } else {
              await testInfo.attach('f5-reporte-chofer.pdf', {
                body: driverReport,
                contentType: 'application/pdf'
              });
              const { verdict: r } = evaluateAcrossPdfModes(driverReport, pdfModes, (t) =>
                evaluateAnchoredRows(t, driverReportRows(expected))
              );
              expect(
                r.ok,
                formatMismatches('Reporte Chofer PDF (filas ancladas)', r.mismatches)
              ).toBe(true);
              driverReportChecked = true;
            }
            return { clearingChars: text.length, clearingMode, driverReportChecked };
          })
        );

        // R05 (tarifa 0): ninguna superficie con NaN/Infinity; el body del POST trae solo importes finitos.
        if (def.zeroFare) {
          await guarded('AC-F5-21', () =>
            verifyF5Confirm(testInfo, 'AC-F5-21', () => {
              const surfaces: Array<[string, string | null]> = [
                ['Clearing PDF', clearingPdf === null ? null : clearingText(clearingPdf, pdfMode)],
                [
                  'Reporte Chofer PDF',
                  driverReport === null ? null : clearingText(driverReport, pdfMode)
                ],
                ['body del POST', result === null ? null : JSON.stringify(result.requestBody)]
              ];
              const read = surfaces.filter(([, text]) => text !== null);
              expect(
                read.length,
                'al menos una superficie posterior legible (PDF o body)'
              ).toBeGreaterThan(0);
              for (const [name, text] of read) {
                const v = evaluateNoNaN(name, text as string);
                expect(v.ok, formatMismatches(`R05 ${name} sin NaN/Infinity`, v.mismatches)).toBe(
                  true
                );
              }
              return { ...(zeroFareEvidence ?? {}), surfaces: read.map(([name]) => name) };
            })
          );
        }

        // Handoff de la corrida (sin credenciales): lo que declaró el orquestador, lo esperado y lo observado.
        await attachJson(testInfo, 'f5-confirm-handoff', {
          rule,
          env: process.env.ENV ?? null,
          target: {
            id: target.id,
            carrierId: target.carrierId,
            driverUserId: target.driverUserId,
            vehicleId: target.vehicleId
          },
          declaredTrips: declared,
          expectDue: expectDueRaw === '' ? null : expectDueRaw,
          miscellany,
          deliver: deliverAmount ?? null,
          clicks,
          surrenderId: sid,
          wantPost,
          postBody: result?.requestBody ?? null,
          posts: guard?.postCount() ?? null,
          failures
        });

        // Captura final: si la página ya no existe se REGISTRA como falla (no se traga), sin abortar lo anterior.
        await guarded('captura final', () =>
          attachXrayEvidence(testInfo, page, {
            name: `f5-${verifyId === null ? 'confirm' : 'verify'}-${target.id}`,
            comment:
              `F5 ${verifyId === null ? 'confirmación' : 'verificación (solo lectura)'} ${target.id} (chofer ${target.driverUserId} / vehículo ${target.vehicleId}), viajes ${declared.join(', ')}, ` +
              `rendición ${sid}: ` +
              (result === null
                ? 'sin POST (modo verificación). '
                : `POST único (${guard?.postCount() ?? 0}) → ${result.status}, body ${JSON.stringify(result.requestBody)}. `) +
              `Esperado: efectivo a rendir ${expected.cashToSurrender}, NC ${expected.ncCash.amount} (${expected.ncCash.quantity}), ` +
              (want === null
                ? `capas ui+api (DB N/A en UAT, decisión: solo UI+API); body esperado ${JSON.stringify(wantPost)}. `
                : `comisión agencia ${want.commissions.AGENCY_TOTALCOMMISSION} / propietario ${want.commissions.OWNER_TOTALCOMMISSION} / chofer ${want.commissions.COMMISSIONSUM}, ` +
                  `libro TDDV ${want.ownerBook.tddv} TDCF ${want.ownerBook.tdcf} TDDG ${want.ownerBook.tddg}, sin TDOC. `) +
              `Resultado: ${failures.length === 0 ? 'todas las aserciones coinciden' : `${failures.length} falla(s) previas`}.`
          })
        );
        expect(
          failures,
          `comprobaciones posteriores a la confirmación fallidas:\n${failures.join('\n')}`
        ).toEqual([]);
      } finally {
        await api.dispose();
      }
    });
  });
}
