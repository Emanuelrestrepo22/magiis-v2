// tests/specs/reports/fr-financial-reports.spec.ts
// Reportes financieros del carrier V2 para el carrier FR TEST 1901 «Cannes Ride Test»: cada reporte
// se abre por UI, se fija el rango 2026-10-19..2026-10-21, se DESCARGA (page.waitForEvent('download'))
// y lo que muestra/exporta se compara contra la base (Oracle SOLO LECTURA) y contra la propia
// respuesta del backend que alimenta la pantalla. Cada discrepancia sale con evidencia fila a fila.
//
// SOLO LECTURA: navegar, filtrar por fecha y descargar. No crea ni modifica viajes, rendiciones,
// liquidaciones ni configuracion. (El cambio de idioma EN/ES de la observacion de moneda es la
// preferencia de interfaz que ya usan otros specs; se restaura al final.)
//
// Alcance de formatos (inventario FE develop 2026-10-21): CSV solo en Aging, Taxes & Fees, Individual
// CA Travels y Cost Center; el resto exporta PDF. No hay XLSX. Del PDF se valida cabecera %PDF y, si
// `pdftotext` esta instalado, el contenido (importes/codigos) contra la DB.
//
// Ejecutar:
//   ENV=test ENV_FILE=.env.test-fr npx playwright test tests/specs/reports/fr-financial-reports.spec.ts \
//     --project=carrier-v2-desktop --workers=1 --retries=0
// Variables opcionales: FR_REPORT_FROM / FR_REPORT_TO (yyyy-MM-dd), FR_CARRIER_ID (1901),
// FR_REPORT_DIR (default evidence/test/reports).
// Salida: <FR_REPORT_DIR>/results.json (consumido por el informe docs/qa/.../reportes-financieros-*.md).
// Discrepancias = expect.soft: el spec falla pero SIEMPRE recorre todos los reportes.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { knownIssue, observation, verifyAc, type AcId } from '../../helpers/acceptance.js';
import { FR_1901_KEYS } from '../../data/xray/fr-1901-keys.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  classifyDownload,
  classifyReportHttp,
  closedGridScope,
  evaluateAgingCsv,
  evaluateAgingTotals,
  evaluateClosedOmission,
  evaluateDownloads,
  evaluateTripsInReport,
  isTripListMinutesKnownIssue,
  splitKnownOutliers,
  type DownloadEntry
} from '../../helpers/fr-ac-eval-edit-reports.js';
import type { OracleDb } from '../../db/OracleDb.js';
import {
  csvToObjects,
  detectCurrencyGlyphs,
  extractPdfText,
  findAmountInText,
  hasPdftotext,
  isPdfBuffer,
  parseCsv,
  parseMoney,
  textContainsAmount
} from '../../helpers/report-parse.js';
import {
  bookIntegrity,
  bookOutliers,
  clientCcApiBalanceFromDb,
  compareBalance,
  compareSurrenders,
  compareSurrenderTotals,
  compareTripsList,
  compareTripsListTotals,
  expectedRealPrice,
  displayedState,
  TRAVEL_STATE_TEXT,
  formatDiscrepancies,
  type BookRow,
  type DbSurrender,
  type DbTrip,
  type Discrepancy,
  type GenericRow,
  type SurrenderGridRow,
  type SurrenderTotals
} from '../../helpers/report-oracle.js';
import { FlatpickrCalendar, calendarDateFromIso } from '../../pages/shared/FlatpickrCalendar.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { round2 } from '../../utils/money.js';

const FROM = process.env.FR_REPORT_FROM?.trim() || '2026-10-19';
const TO = process.env.FR_REPORT_TO?.trim() || '2026-10-21';
const CARRIER_ID = Number(process.env.FR_CARRIER_ID?.trim() || 1901);
const OUT_DIR = resolve(process.env.FR_REPORT_DIR?.trim() || 'evidence/test/reports');
const OWNER_ID = 2927;
const DRIVER_ID = 4965;
const CLIENT_CC_ID = 5614;
const TASK_SURRENDERS = [13840, 13858, 13859, 13860, 13878];

const ddmmyyyy = (iso: string): string => iso.split('-').reverse().join('/');

type FileResult = {
  label: string;
  ok: boolean;
  suggestedName?: string;
  savedAs?: string;
  bytes?: number;
  kind?: 'pdf' | 'csv' | 'other';
  pdfTextChecked?: boolean;
  httpErrors: string[];
  note?: string;
};

type ReportResult = {
  report: string;
  route: string;
  format: string;
  endpoint: string;
  observations: string[];
  discrepancies: Discrepancy[];
  files: FileResult[];
  facts: Record<string, unknown>;
};

const RESULTS: ReportResult[] = [];

function newResult(report: string, route: string, format: string, endpoint: string): ReportResult {
  const result: ReportResult = {
    report,
    route,
    format,
    endpoint,
    observations: [],
    discrepancies: [],
    files: [],
    facts: {}
  };
  RESULTS.push(result);
  return result;
}

// ───────────────────────── utilidades de captura ─────────────────────────

type ReportCall = { status: number; request: Record<string, unknown>; body: unknown };

/** Espera una llamada genericReport/<code>/ cuyo cuerpo de request contenga todos los fragmentos. */
function waitForReportCall(
  page: Page,
  code: string,
  fragments: string[] = []
): Promise<ReportCall> {
  return page
    .waitForResponse(
      (r) => {
        if (!r.url().includes(`/data/genericReport/${code}/`)) return false;
        const post = r.request().postData() ?? '';
        return fragments.every((f) => post.includes(f));
      },
      { timeout: 45_000 }
    )
    .then(async (r) => ({
      status: r.status(),
      request: safeJson(r.request().postData() ?? '{}') as Record<string, unknown>,
      body: await r.json().catch(() => null)
    }));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function contentRows(call: ReportCall): GenericRow[] {
  const body = call.body as { content?: Array<{ row?: GenericRow }> } | GenericRow[] | null;
  const list = Array.isArray(body) ? body : (body?.content ?? []);
  return (list as Array<{ row?: GenericRow }>).map((e) => e.row ?? (e as unknown as GenericRow));
}

function errorSummary(call: ReportCall): string {
  const body = call.body as { errorCode?: string; description?: string } | null;
  return `HTTP ${call.status} ${body?.errorCode ?? ''} ${body?.description ?? ''}`.trim();
}

async function setRange(page: Page, from: string, to: string): Promise<void> {
  await page
    .getByRole('textbox', { name: /choose date|elegi.? fecha|seleccion.? fecha/i })
    .first()
    .click();
  await new FlatpickrCalendar(page).pickRange(calendarDateFromIso(from), calendarDateFromIso(to));
}

function safeName(text: string): string {
  return text.replace(/[^\w.-]+/g, '_').slice(0, 80);
}

/** Click que dispara una descarga; guarda el archivo y lo valida (PDF/CSV). Nunca lanza por falta de descarga. */
async function clickAndDownload(
  page: Page,
  trigger: Locator,
  label: string,
  key: string
): Promise<{ file: FileResult; path?: string }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const httpErrors: string[] = [];
  const onResponse = (r: Response): void => {
    if (r.status() >= 400 && r.url().includes('/magiis-v0.2/')) {
      httpErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
    }
  };
  page.on('response', onResponse);
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 }).then(
    (d) => d,
    () => null
  );
  try {
    await trigger.click({ timeout: 15_000 });
  } catch (error) {
    page.off('response', onResponse);
    return {
      file: {
        label,
        ok: false,
        httpErrors,
        note: `no se pudo pulsar el control: ${(error as Error).message.split('\n')[0]}`
      }
    };
  }
  const download = await downloadPromise;
  page.off('response', onResponse);
  if (!download) {
    return { file: { label, ok: false, httpErrors, note: 'no hubo descarga en 30 s' } };
  }
  const suggestedName = download.suggestedFilename();
  const savedAs = join(OUT_DIR, `${key}__${safeName(suggestedName)}`);
  await download.saveAs(savedAs);
  const buffer = readFileSync(savedAs);
  const kind: FileResult['kind'] = isPdfBuffer(buffer)
    ? 'pdf'
    : /\.csv$/i.test(suggestedName)
      ? 'csv'
      : 'other';
  return {
    file: {
      label,
      ok: true,
      suggestedName,
      savedAs,
      bytes: statSync(savedAs).size,
      kind,
      httpErrors
    },
    path: savedAs
  };
}

/** Texto del PDF (o null si no hay pdftotext) y marca de verificacion en el resultado. */
function pdfText(file: FileResult, path: string | undefined): string | null {
  if (!path || file.kind !== 'pdf') return null;
  const text = extractPdfText(path);
  file.pdfTextChecked = text !== null;
  return text;
}

async function expectButtonState(
  result: ReportResult,
  name: string,
  button: Locator
): Promise<'enabled' | 'disabled' | 'absent'> {
  if ((await button.count()) === 0) {
    result.observations.push(`boton ${name}: ausente`);
    return 'absent';
  }
  const state = (await button.first().isDisabled()) ? 'disabled' : 'enabled';
  result.observations.push(`boton ${name}: ${state}`);
  return state;
}

const pdfButton = (page: Page): Locator =>
  page
    .locator(
      'button:has(i.ri-file-download-line), button:has(i.mdi-file-pdf-box), button:has(i.ri-file-pdf-line)'
    )
    .first();
const csvButton = (page: Page): Locator =>
  page
    .locator(
      'button:has(i.ri-file-excel-line), button:has(i.mdi-file-delimited), button:has(i.mdi-file-delimited-outline)'
    )
    .first();

async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(`/carrier/#${route}`);
}

// ───────────────────────── consultas DB (solo SELECT) ─────────────────────────

async function dbTrips(
  db: OracleDb,
  minId: number,
  maxId: number
): Promise<{ trips: DbTrip[]; liveIds: Set<number> }> {
  const live = await db.query<DbTrip>(
    `SELECT t.ID, t.STATE, t.PAYMENTMETHOD, f.FINALPRICE, t.FINALIZE_ADMIN, t.TRAVELSSURRENDER_ID
     FROM TRAVEL t LEFT JOIN FINALPRICEI f ON f.ID = t.FINALPRICE_ID
     WHERE t.CARRIERACCOUNT_ID = :c AND t.ID BETWEEN :a AND :b`,
    { c: CARRIER_ID, a: minId, b: maxId }
  );
  const history = await db.query<DbTrip>(
    `SELECT h.ID, h.STATE, h.PAYMENTMETHOD, h.FINALPRICE, h.FINALIZE_ADMIN, h.TRAVELSSURRENDER_ID
     FROM TRAVEL_HISTORY h
     WHERE h.CARRIERACCOUNT_ID = :c AND h.ID BETWEEN :a AND :b`,
    { c: CARRIER_ID, a: minId, b: maxId }
  );
  const byId = new Map<number, DbTrip>();
  for (const row of [...history, ...live]) byId.set(row.ID, row); // TRAVEL gana sobre el historico
  return { trips: [...byId.values()], liveIds: new Set(live.map((t) => t.ID)) };
}

async function dbSurrenders(db: OracleDb): Promise<DbSurrender[]> {
  return db.query<DbSurrender>(
    `SELECT ID, DRIVER_ID, TOTALBILLING, TOTALBILLINGQTY, TOTALCASH, TOTALCHECKINGACCOUNT,
            TOTALCREDITCARD, AGENCY_TOTALCOMMISSION, OWNER_TOTALCOMMISSION, COMMISSIONSUM,
            TOTAL_COLLECTED, CHECKINGACCOUNTTIPS, CREDITCARDTIPS, TOTALROADTOLL, TOTALPARKING
     FROM TRAVELSSURRENDER
     WHERE CARRIER_ID = :c AND CREATIONDATE >= TRUNC(SYSDATE) - 31
     ORDER BY ID`,
    { c: CARRIER_ID }
  );
}

async function dbDriverBook(db: OracleDb): Promise<BookRow[]> {
  const rows = await db.query<{
    ID: number;
    AMOUNT: number | null;
    PAID: number | null;
    BALANCE: number | null;
    TRAVELSSURRENDER_ID: number | null;
    CHECKINGACCOUNTCODE: string | null;
    COMMENTS: string | null;
  }>(
    `SELECT ID, AMOUNT, PAID, BALANCE, TRAVELSSURRENDER_ID, CHECKINGACCOUNTCODE, COMMENTS
     FROM CHECKINGACCOUNTFORDRIVER WHERE CARRIERACCOUNT_ID = :c AND DRIVERACCOUNT_ID = :d ORDER BY ID`,
    { c: CARRIER_ID, d: DRIVER_ID }
  );
  return rows.map((r) => ({
    ID: r.ID,
    DEBIT: r.AMOUNT,
    CREDIT: r.PAID,
    BALANCE: r.BALANCE,
    TRAVELSSURRENDER_ID: r.TRAVELSSURRENDER_ID,
    CODE: r.CHECKINGACCOUNTCODE,
    COMMENTS: r.COMMENTS
  }));
}

async function dbOwnerBook(db: OracleDb): Promise<BookRow[]> {
  const rows = await db.query<BookRow & { CHECKINGACCOUNTCODE: string | null }>(
    `SELECT ID, DEBIT, CREDIT, BALANCE, TRAVELSSURRENDER_ID, CHECKINGACCOUNTCODE, COMMENTS
     FROM CHECKINGACCOUNTFOROWNER WHERE CARRIERACCOUNT_ID = :c AND VEHICLEOWNER_ID = :o ORDER BY ID`,
    { c: CARRIER_ID, o: OWNER_ID }
  );
  return rows.map((r) => ({ ...r, CODE: r.CHECKINGACCOUNTCODE }));
}

const lastBalance = (rows: readonly BookRow[]): number | null =>
  rows.length > 0 ? (rows[rows.length - 1].BALANCE ?? null) : null;

function persistResults(): void {
  if (RESULTS.length === 0) return;
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'results.json');
  let previous: ReportResult[] = [];
  try {
    previous =
      (JSON.parse(readFileSync(file, 'utf8')) as { results?: ReportResult[] }).results ?? [];
  } catch {
    previous = [];
  }
  const mine = new Set(RESULTS.map((r) => r.report));
  const merged = [...previous.filter((r) => !mine.has(r.report)), ...RESULTS];
  writeFileSync(
    file,
    JSON.stringify(
      {
        carrier: CARRIER_ID,
        range: { from: FROM, to: TO },
        pdftotext: hasPdftotext(),
        generatedAt: new Date().toISOString(),
        results: merged
      },
      null,
      2
    ),
    'utf8'
  );
}

// ───────────────────────── spec ─────────────────────────
// Politica de clasificacion de cada discrepancia (cada aserto de negocio vive en verifyAc):
//  - defecto real nuevo / sin etiquetar  -> aserto duro (FAIL correcto);
//  - known-issue documentado (AC-90..96) -> knownIssue() con la firma EXACTA del defecto; cualquier otra
//    falla sigue siendo roja (la tolerancia no oculta defectos distintos);
//  - dato/ambiente de TEST (archivado a TRAVEL_HISTORY, refresh de mviews pendiente) -> knownIssue(AC-89)/observation();
//  - pregunta al PO (base del aging) -> observation().
const KI_OUTLIER_AMOUNT = 11_312_004;
const MVIEWS_REFRESHED = process.env.FR_MVIEWS_REFRESHED?.trim() === '1';

/** Reune la lista de discrepancias de un AC, la suma al resultado del reporte y la asevera dentro de verifyAc. */
async function verifyList(
  testInfo: TestInfo,
  id: AcId,
  result: ReportResult,
  list: Discrepancy[],
  extra: Record<string, unknown> = {}
): Promise<void> {
  result.discrepancies.push(...list);
  await verifyAc(testInfo, id, async () => {
    expect.soft(list, formatDiscrepancies(list)).toEqual([]);
    return { discrepancies: list.length, ...extra };
  });
}

/** AC-88: descargas validas; cada tolerancia (AC-90 / AC-91) se anota como known-issue con su clave. */
async function verifyDownloads(
  testInfo: TestInfo,
  result: ReportResult,
  entries: DownloadEntry[],
  contentDiscrepancies: Discrepancy[]
): Promise<void> {
  const v = evaluateDownloads(entries);
  for (const t of v.tolerated) {
    knownIssue(
      testInfo,
      t.outcome === 'ki-90-empty-xml' ? 'AC-FR-90' : 'AC-FR-91',
      `${result.report} · ${t.key}: ${t.outcome}`
    );
  }
  result.discrepancies.push(
    ...v.mismatches.map((m) => ({
      report: `${result.report} (descarga)`,
      key: m.field,
      field: 'archivo descargado',
      expected: m.expected,
      actual: m.actual
    })),
    ...contentDiscrepancies
  );
  if (entries.length === 0 && contentDiscrepancies.length === 0) return;
  await verifyAc(testInfo, 'AC-FR-88', async () => {
    expect.soft(v.ok, v.message).toBe(true);
    expect.soft(contentDiscrepancies, formatDiscrepancies(contentDiscrepancies)).toEqual([]);
    return {
      files: entries.length,
      tolerated: v.tolerated,
      contentChecked: entries.some((e) => e.file.kind === 'pdf') && hasPdftotext()
    };
  });
}

test.describe('@read-only FR 1901 reportes financieros: UI + descarga vs DB', () => {
  test.beforeAll(async ({ carrierSession }) => {
    test.skip(getCurrentEnv() !== 'test', 'FR 1901 vive solo en ENV=test');
    if (carrierSession.carrierId !== CARRIER_ID) {
      throw new Error(`la sesion guardada debe ser la del carrier ${CARRIER_ID}`);
    }
    mkdirSync(OUT_DIR, { recursive: true });
  });

  // Un Test de Xray por reporte (R1..R9): la key sale del prefijo del titulo (fr-1901-keys.ts).
  test.beforeEach(() => {
    const reportId = /^(R[1-9])\b/.exec(test.info().title)?.[1] as
      | 'R1'
      | 'R2'
      | 'R3'
      | 'R4'
      | 'R5'
      | 'R6'
      | 'R7'
      | 'R8'
      | 'R9'
      | undefined;
    if (reportId) makeAnnotate(FR_1901_KEYS[reportId])(reportId, 'POS');
  });

  // Cada fallo (expect.soft) reinicia el worker: el estado en memoria no sobrevive. Por eso se fusiona
  // en results.json despues de CADA test, por nombre de reporte.
  // Evidencia obligatoria por run de Xray (evidence-before-verdict): si el test no adjunto ninguna
  // imagen (ej. R6, cuyo hallazgo es solo HTTP), se anexa la captura de la pantalla del reporte.
  test.afterEach(async ({ page }, testInfo) => {
    persistResults();
    if (testInfo.status === 'skipped') return;
    if (testInfo.attachments.some((a) => a.contentType === 'image/png')) return;
    const id = /^(R[1-9])/.exec(testInfo.title)?.[1] ?? 'report';
    try {
      await attachXrayEvidence(testInfo, page, {
        name: `fr-report-${id}-screen`,
        comment: `${id}: captura de la pantalla del reporte tras la ejecucion (${page.url()}).`
      });
    } catch {
      // pagina cerrada: sin captura posible; el reporter retendra el veredicto si no hay evidencia
    }
  });

  test('R1 Trip List (024/024T): PDF + filas vs TRAVEL + totales por metodo', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R1');
    test.setTimeout(240_000);
    const result = newResult(
      'Trip List',
      '/reports/travels-list',
      'PDF (jsPDF, cliente)',
      'POST data/genericReport/024 + 024T'
    );
    const rowsCall = waitForReportCall(page, '024', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`
    ]);
    const totalsCall = waitForReportCall(page, '024T', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`
    ]);
    await openRoute(
      page,
      `/reports/travels-list?startDate=${FROM}&endDate=${TO}&travelTypeParam=2`
    );
    const [gridCall, totals] = await Promise.all([rowsCall, totalsCall]);
    const grid = contentRows(gridCall);
    result.facts.gridRows = grid.length;
    result.facts.gridText = (await page.locator('tbody').first().innerText())
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    const glyphs = detectCurrencyGlyphs(String(result.facts.gridText));
    result.observations.push(`moneda en la grilla (EN): ${glyphs.join(' ') || 'sin simbolo'}`);

    // PDF: la descarga re-pide TODO el rango sin paginar (size=9999): esa es la fuente real del PDF.
    const fullCall = waitForReportCall(page, '024', ['"size":9999']);
    const download = await clickAndDownload(page, pdfButton(page), 'Trip List PDF', 'trips-list');
    result.files.push(download.file);
    const full = await fullCall.catch(() => null);
    const source = full && full.status === 200 ? contentRows(full) : grid;
    result.facts.pdfSourceRows = source.length;

    const ids = source.map((r) => Number(r.Col1));
    const dbAll = ids.length > 0 ? await dbTrips(oracle, Math.min(...ids), Math.max(...ids)) : null;
    // Trip List «actuales» lee TRAVEL; los viajes que el job de archivo ya paso a TRAVEL_HISTORY no figuran
    // (dato de TEST: se comprobo que los ausentes de la grilla son exactamente los archivados).
    // Solo viajes terminados (STATE 6/7/8, los que TRAVEL_STATE_TEXT mapea): abiertos/sin asignar no figuran en la grilla.
    const live =
      dbAll?.trips.filter((t) => dbAll.liveIds.has(t.ID) && Number(t.STATE) in TRAVEL_STATE_TEXT) ??
      [];
    const archived = dbAll?.trips.filter((t) => !dbAll.liveIds.has(t.ID)) ?? [];
    if (archived.length > 0) {
      observation(
        testInfo,
        'AC-FR-77',
        `${archived.length} viajes ya archivados a TRAVEL_HISTORY no figuran en Trip List actuales (${archived.map((t) => t.ID).join(', ')}): dato de TEST, no defecto`
      );
    }
    const disc77: Discrepancy[] = [];
    const disc78: Discrepancy[] = [];
    if (dbAll) {
      disc77.push(...compareTripsList(source, live));
      disc78.push(...compareTripsListTotals(contentRows(totals), source));
      const dbAsRows: GenericRow[] = live
        .filter((t) => ids.includes(t.ID))
        .map((t) => ({
          Col1: String(t.ID),
          Col11: String(expectedRealPrice(t)),
          Col13: t.PAYMENTMETHOD
        }));
      disc78.push(
        ...compareTripsListTotals(contentRows(totals), dbAsRows).map((d) => ({
          ...d,
          report: 'trips-list (024T vs DB)'
        }))
      );
      result.facts.dbStates = Object.fromEntries(live.map((t) => [t.ID, displayedState(t)]));
    }
    await verifyAc(testInfo, 'AC-FR-77', async () => {
      expect.soft(gridCall.status, errorSummary(gridCall)).toBe(200);
      expect.soft(ids.length, 'el rango debe tener viajes').toBeGreaterThan(0);
      expect.soft(disc77, formatDiscrepancies(disc77)).toEqual([]);
      return { gridRows: grid.length, discrepancies: disc77.length };
    });
    await verifyAc(testInfo, 'AC-FR-78', async () => {
      expect.soft(totals.status, errorSummary(totals)).toBe(200);
      expect.soft(disc78, formatDiscrepancies(disc78)).toEqual([]);
      return { discrepancies: disc78.length };
    });
    result.discrepancies.push(...disc77, ...disc78);

    // Contenido del PDF: cada importe real y cada hora de las filas debe estar impreso.
    const disc88: Discrepancy[] = [];
    const text = pdfText(download.file, download.path);
    if (text) {
      const wrapped: string[] = [];
      const wrongTime: string[] = [];
      for (const row of source) {
        const real = parseMoney(row.Col11 ?? '');
        if (real !== null && real > 0) {
          const match = findAmountInText(text, real);
          if (match === null) {
            disc88.push({
              report: 'trips-list (PDF)',
              key: String(row.Col1),
              field: 'importe Actual impreso en el PDF',
              expected: real,
              actual: 'no aparece'
            });
          } else if (match === 'wrapped') {
            wrapped.push(`${row.Col1}:${real}`);
          }
        }
        const time = /(\d{2}:\d{2}):\d{2}/.exec(row.Col3 ?? '')?.[1];
        if (time && !text.includes(time)) wrongTime.push(`${row.Col1} esperado ${time}`);
      }
      if (wrapped.length > 0) {
        const note = `importes con separador de miles (espacio) partidos en dos renglones en el PDF: ${wrapped.join(', ')} (THOUSANDS_SEPARATOR=SPACE del pais FR)`;
        result.observations.push(note);
        knownIssue(testInfo, 'AC-FR-93', note);
      }
      if (wrongTime.length > 0) {
        const printedMinutes = /\d{2}\/\d{2}\/\d{4}\s*\n?\s*\d{2}:(\d{2})/.exec(text)?.[1] ?? '?';
        const note = `${wrongTime.length} de ${source.length} filas con otra hora; el PDF imprime los minutos como «${printedMinutes}» (ej. ${wrongTime.slice(0, 3).join('; ')})`;
        if (isTripListMinutesKnownIssue(printedMinutes, wrongTime.length, source.length)) {
          knownIssue(testInfo, 'AC-FR-93', note);
        } else {
          disc88.push({
            report: 'trips-list (PDF)',
            key: 'columna Date',
            field: 'hora impresa HH:mm vs hora de la grilla',
            expected: 'minutos reales del viaje',
            actual: note
          });
        }
      }
      const footer =
        /(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+\d+/.exec(text);
      if (footer) {
        result.observations.push(
          `tabla de totales del PDF con punto decimal (${footer[1]}) mientras las filas usan coma (54,00): formato inconsistente en un pais con coma decimal`
        );
        const pdfTotal = Number(footer[1]);
        const dbTotal = round2(
          live.filter((t) => ids.includes(t.ID)).reduce((a, t) => a + expectedRealPrice(t), 0)
        );
        disc88.push(
          ...compareBalance(
            'trips-list (PDF totales)',
            'Total',
            'Total del PDF vs suma real de DB',
            dbTotal,
            pdfTotal
          )
        );
      }
      const pdfGlyphs = detectCurrencyGlyphs(text);
      result.observations.push(
        `moneda en el PDF: ${pdfGlyphs.join(' ') || 'sin simbolo (solo «Currency: EUR» en el encabezado)'}`
      );
    } else {
      observation(
        testInfo,
        'AC-FR-88',
        'pdftotext no disponible: PDF validado solo por estructura (%PDF, tamano)'
      );
    }
    await verifyDownloads(
      testInfo,
      result,
      [{ key: 'Trip List PDF', file: download.file, allow: [] }],
      disc88
    );
  });

  test('R2 Closed surrenders: grilla + totales + PDFs vs TRAVELSSURRENDER y 40/40/20', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R2');
    test.setTimeout(420_000);
    const result = newResult(
      'Daily Clearing > Closed (rendiciones cerradas)',
      '/pay/surrenders-report',
      'PDF servidor (Generate pdf) + PDF cliente (Driver Report)',
      'GET carriers/{id}/travels/surrendersReports/paginated + /totals'
    );
    const paged = page.waitForResponse((r) => r.url().includes('/surrendersReports/paginated'), {
      timeout: 45_000
    });
    const totalsResp = page.waitForResponse((r) => r.url().includes('/surrendersReports/totals'), {
      timeout: 45_000
    });
    await openRoute(page, '/pay/surrenders-report');
    const [pagedResponse, totalsResponse] = await Promise.all([paged, totalsResp]);
    const body = (await pagedResponse.json()) as {
      content?: SurrenderGridRow[];
      totalElements?: number;
    };
    const gridRows = body.content ?? [];
    const totals = (await totalsResponse.json()) as SurrenderTotals;
    result.facts.totalElements = body.totalElements;
    result.facts.pageRows = gridRows.length;
    const rowVisible = await page
      .locator('tbody tr')
      .first()
      .isVisible()
      .catch(() => false);
    if ((body.totalElements ?? 0) > gridRows.length) {
      result.observations.push(
        `grilla paginada: se leyo ${gridRows.length} de ${body.totalElements}; totales vs filas solo parcial`
      );
    }
    const gridText = (await page.locator('tbody').first().innerText()).replace(/\s+/g, ' ');
    const headText = (await page.locator('thead').first().innerText()).replace(/\s+/g, ' ');
    result.observations.push(
      `moneda en la grilla Closed (EN): celdas ${detectCurrencyGlyphs(gridText).join(' ') || 'sin simbolo'}; encabezado ${detectCurrencyGlyphs(headText).join(' ') || 'sin moneda'}`
    );

    const dbRows = await dbSurrenders(oracle);
    const gridIds = new Set(gridRows.map((r) => r.id));
    // Totales (AC-80) son del servidor sobre TODO el rango: alcance completo de DB.
    const { scope } = closedGridScope(dbRows, gridIds);
    // Fila a fila (AC-79/94): si la grilla esta paginada y ordenada por id DESC, solo se compara el rango
    // que la pagina leida cubre (ID >= menor id de la pagina); las paginas siguientes quedan fuera de alcance.
    const gridPartial = (body.totalElements ?? 0) > gridRows.length;
    const idsDesc = gridRows.every((r, i) => i === 0 || gridRows[i - 1].id > r.id);
    const rangeMin = gridPartial && idsDesc && gridRows.length > 0 ? Math.min(...gridIds) : null;
    if (gridPartial && rangeMin === null) {
      result.observations.push(
        'grilla paginada sin orden id DESC verificable: sin acotar el alcance de DB'
      );
    }
    const rowScopeDb = rangeMin === null ? dbRows : dbRows.filter((s) => s.ID >= rangeMin);
    const {
      scope: rowScope,
      omittedAutomatic,
      omittedWithDriver
    } = closedGridScope(rowScopeDb, gridIds);
    const disc79: Discrepancy[] = compareSurrenders(gridRows, rowScope);
    const disc80: Discrepancy[] = [];
    if ((body.totalElements ?? 0) <= gridRows.length) {
      disc80.push(...compareSurrenderTotals(totals, gridRows));
    }
    // Totales de pantalla vs DB del alcance de la grilla (las automaticas omitidas son AC-94).
    const dbSum = (f: (s: DbSurrender) => number | null): number =>
      round2(scope.reduce((a, s) => a + (f(s) ?? 0), 0));
    disc80.push(
      ...compareBalance(
        'surrenders-closed (totales vs DB)',
        'totales',
        'sumTotalBilling vs SUM(TOTALBILLING)',
        dbSum((s) => s.TOTALBILLING),
        totals.sumTotalBilling ?? null
      ),
      ...compareBalance(
        'surrenders-closed (totales vs DB)',
        'totales',
        'sumAgencyCommission vs SUM(AGENCY_TOTALCOMMISSION)',
        dbSum((s) => s.AGENCY_TOTALCOMMISSION),
        totals.sumAgencyCommission ?? null
      ),
      ...compareBalance(
        'surrenders-closed (totales vs DB)',
        'totales',
        'sumTotalTravelsQty vs SUM(TOTALBILLINGQTY)',
        dbSum((s) => s.TOTALBILLINGQTY),
        totals.sumTotalTravelsQty ?? null
      )
    );

    // Descargas por fila (las rendiciones de las pruebas FR): PDF del servidor y Driver Report.
    const entries: DownloadEntry[] = [];
    const disc88: Discrepancy[] = [];
    for (const surrenderId of TASK_SURRENDERS) {
      const index = gridRows.findIndex((r) => r.id === surrenderId);
      if (index < 0 && gridPartial && gridIds.size > 0 && surrenderId < Math.min(...gridIds)) {
        // Grilla paginada (id DESC): la rendicion quedo en una pagina posterior; no es defecto del reporte.
        result.observations.push(
          `descarga #${surrenderId} omitida: fuera de la pagina leida de la grilla (ids >= ${Math.min(...gridIds)})`
        );
        continue;
      }
      if (index < 0) {
        disc79.push({
          report: 'surrenders-closed (descarga)',
          key: String(surrenderId),
          field: 'fila en la grilla',
          expected: 'presente',
          actual: 'ausente'
        });
        continue;
      }
      const row = page.locator('tbody tr').nth(index);
      const gridRow = gridRows[index];
      const server = await clickAndDownload(
        page,
        row.locator('button[ng-reflect-ngb-tooltip="Generate pdf"]').first(),
        `#${surrenderId} Generate pdf (servidor)`,
        `surrender-${surrenderId}-server`
      );
      result.files.push(server.file);
      entries.push({ key: `#${surrenderId} Generate pdf`, file: server.file, allow: ['ki-90'] });
      if (classifyDownload(server.file, ['ki-90']) === 'valid') {
        const text = pdfText(server.file, server.path);
        if (
          text &&
          gridRow.totalBilling !== null &&
          gridRow.totalBilling !== undefined &&
          !textContainsAmount(text, gridRow.totalBilling)
        ) {
          disc88.push({
            report: 'surrenders-closed (PDF servidor)',
            key: String(surrenderId),
            field: 'facturacion impresa',
            expected: gridRow.totalBilling,
            actual: 'no aparece'
          });
        }
      }
      const client = await clickAndDownload(
        page,
        row.locator('button[ng-reflect-ngb-tooltip="Driver Report"]').first(),
        `#${surrenderId} Driver Report (cliente)`,
        `surrender-${surrenderId}-driver-report`
      );
      result.files.push(client.file);
      entries.push({ key: `#${surrenderId} Driver Report`, file: client.file, allow: [] });
      if (classifyDownload(client.file, []) === 'valid') {
        const text = pdfText(client.file, client.path);
        if (text) {
          const dbRow = dbRows.find((s) => s.ID === surrenderId);
          // El Driver Report imprime facturacion y comision del chofer (no las de agencia/propietario).
          for (const [field, value] of [
            ['TOTALBILLING', dbRow?.TOTALBILLING],
            ['COMMISSIONSUM (comision chofer)', dbRow?.COMMISSIONSUM]
          ] as const) {
            if (typeof value === 'number' && value > 0 && !textContainsAmount(text, value)) {
              disc88.push({
                report: 'surrenders-closed (Driver Report PDF)',
                key: String(surrenderId),
                field: `${field} impreso`,
                expected: value,
                actual: 'no aparece'
              });
            }
          }
          const pct = /Commission Percentage:\s*(\d+)%/.exec(text)?.[1];
          if (pct !== undefined && Number(pct) !== 40) {
            disc88.push({
              report: 'surrenders-closed (Driver Report PDF)',
              key: String(surrenderId),
              field: 'Commission Percentage impreso',
              expected: 40,
              actual: Number(pct)
            });
          }
          result.observations.push(
            `#${surrenderId} Driver Report moneda impresa: ${detectCurrencyGlyphs(text).join(' ') || 'sin simbolo'}`
          );
        }
      }
    }

    await verifyAc(testInfo, 'AC-FR-79', async () => {
      expect.soft(pagedResponse.status(), 'surrendersReports/paginated').toBe(200);
      expect.soft(rowVisible, 'la grilla Closed debe mostrar filas').toBe(true);
      expect.soft(disc79, formatDiscrepancies(disc79)).toEqual([]);
      return { gridRows: gridRows.length, scope: rowScope.length, discrepancies: disc79.length };
    });
    await verifyAc(testInfo, 'AC-FR-80', async () => {
      expect.soft(totalsResponse.status(), 'surrendersReports/totals').toBe(200);
      expect.soft(disc80, formatDiscrepancies(disc80)).toEqual([]);
      return { discrepancies: disc80.length };
    });
    result.discrepancies.push(...disc79, ...disc80);
    // AC-94: la grilla omite las rendiciones automaticas (DRIVER_ID NULL, H-AUTO-04). Solo se tolera esa omision.
    if (omittedAutomatic.length > 0) {
      knownIssue(
        testInfo,
        'AC-FR-94',
        `Closed omite ${omittedAutomatic.length} rendicion(es) automatica(s) DRIVER_ID NULL: ${omittedAutomatic.map((s) => s.ID).join(', ')}`
      );
      await verifyAc(testInfo, 'AC-FR-94', async () => {
        const v = evaluateClosedOmission(omittedWithDriver);
        expect.soft(v.ok, v.message).toBe(true);
        return { omittedAutomatic: omittedAutomatic.map((s) => s.ID) };
      });
    } else {
      observation(
        testInfo,
        'AC-FR-94',
        'sin rendiciones automaticas omitidas en el rango: AC-94 sin material'
      );
    }
    await verifyDownloads(testInfo, result, entries, disc88);

    // Observacion de formato en espanol (la pantalla de rendiciones mostraba «$» para EUR).
    const shell = new ShellPage(page);
    try {
      await shell.setLanguage('es');
      await expect(page.locator('thead th').first()).toContainText(/fecha/i, { timeout: 15_000 });
      const esText = (await page.locator('tbody').first().innerText()).replace(/\s+/g, ' ');
      const esHead = (await page.locator('thead').first().innerText()).replace(/\s+/g, ' ');
      result.observations.push(
        `moneda en la grilla Closed (ES): celdas ${detectCurrencyGlyphs(esText).join(' ') || 'sin simbolo'}; encabezado ${detectCurrencyGlyphs(esHead).join(' ') || 'sin moneda'} (esperado EUR/€ en un carrier EUR)`
      );
    } catch (error) {
      result.observations.push(
        `no se pudo cambiar a ES: ${(error as Error).message.split('\n')[0]}`
      );
    } finally {
      await shell.setLanguage('en').catch(() => undefined);
    }
  });

  test('R3 Cuentas corrientes (cliente / chofer / propietario): saldos y continuidad de libros vs DB', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R3');
    test.setTimeout(300_000);
    const result = newResult(
      'Credit Accounts (cliente, chofer, propietario)',
      '/checking-accounts/{clients|drivers|owners}',
      'PDF servidor en detalle (best-effort)',
      'GET checking-accounts/carrier/{id}/{clients|drivers|owners}/paginated'
    );
    const disc81: Discrepancy[] = [];
    const entries: DownloadEntry[] = [];

    // Cliente
    const clientsResp = page.waitForResponse((r) => r.url().includes('/clients/paginated'), {
      timeout: 45_000
    });
    await openRoute(page, '/checking-accounts/clients');
    const clients =
      (
        (await (await clientsResp).json()) as {
          content?: Array<{
            checkingAccountId: number;
            balance: number;
            limit: number;
            currencyCode?: string;
          }>;
        }
      ).content ?? [];
    const dbCc = await oracle.query<{
      BALANCE: number;
      CHECKINGACCOUNTLIMIT: number;
      DEBITSUM: number;
      CREDITSUM: number;
    }>(
      'SELECT BALANCE, CHECKINGACCOUNTLIMIT, DEBITSUM, CREDITSUM FROM CHECKINGACCOUNT WHERE ID = :id',
      { id: CLIENT_CC_ID }
    );
    const clientRow = clients.find((c) => c.checkingAccountId === CLIENT_CC_ID);
    result.facts.clientRow = clientRow ?? null;
    // Saldo de CC = suma de los viajes CC rendidos (movimientos TIVR de la cuenta).
    const mov = await oracle.query<{ S: number }>(
      'SELECT NVL(SUM(MOUNT),0) AS S FROM MOVEMENT WHERE CHECKINGACCOUNT_ID = :id',
      { id: CLIENT_CC_ID }
    );
    const ledgerSum = round2(mov[0]?.S ?? 0);
    if (!clientRow || dbCc.length === 0) {
      disc81.push({
        report: 'cc-cliente',
        key: String(CLIENT_CC_ID),
        field: 'cuenta en grilla/DB',
        expected: 'presente',
        actual: clientRow ? 'DB vacia' : 'ausente en grilla'
      });
    } else {
      result.observations.push(`CC cliente moneda de la API: ${clientRow.currencyCode ?? 'n/d'}`);
      // La API (ClientCheckingAccountSummaryProjection) informa DEBITSUM - CREDITSUM (contadores
      // desnormalizados de CHECKINGACCOUNT), NO limite - BALANCE ni la suma del libro.
      const apiSource = round2(dbCc[0].DEBITSUM - dbCc[0].CREDITSUM);
      const fromBalance = clientCcApiBalanceFromDb(dbCc[0]);
      // 1) La API debe reflejar fielmente su fuente.
      disc81.push(
        ...compareBalance(
          'cc-cliente',
          String(CLIENT_CC_ID),
          'balance (API) vs DEBITSUM - CREDITSUM',
          apiSource,
          clientRow.balance
        )
      );
      // 2) Coherencia interna de la DB: contadores vs BALANCE vs libro de movimientos.
      const counterDrift = round2(fromBalance - apiSource);
      if (Math.abs(fromBalance - ledgerSum) <= 0.01 && Math.abs(counterDrift) > 0.01) {
        // Firma H-CC-DEBITSUM: BALANCE y MOVEMENT coinciden entre si; el contador DEBITSUM quedo
        // desfasado (ediciones de rendicion/viaje ajustan MOVEMENT+BALANCE pero no DEBITSUM; la
        // regla es de BE: addDebitSum solo se invoca al generar el movimiento). Defecto de producto.
        knownIssue(
          testInfo,
          'AC-FR-81',
          `H-CC-DEBITSUM: CC cliente ${CLIENT_CC_ID} DEBITSUM-CREDITSUM=${apiSource} (lo que muestra la API) vs limite-BALANCE=${fromBalance} = SUM(MOVEMENT)=${ledgerSum}; desfase ${counterDrift} por contador desnormalizado no ajustado en ediciones`
        );
      } else {
        disc81.push(
          ...compareBalance(
            'cc-cliente',
            String(CLIENT_CC_ID),
            'balance (API) vs limite - BALANCE',
            fromBalance,
            clientRow.balance
          ),
          ...compareBalance(
            'cc-cliente',
            String(CLIENT_CC_ID),
            'balance (API) vs SUM(MOVEMENT.MOUNT)',
            ledgerSum,
            clientRow.balance
          )
        );
      }
    }

    // Chofer
    const driversResp = page.waitForResponse((r) => r.url().includes('/drivers/paginated'), {
      timeout: 45_000
    });
    await openRoute(page, '/checking-accounts/drivers');
    const drivers = (await (await driversResp).json()) as {
      page?: { content?: Array<{ driverId: number; balance: number }> };
      totalBalance?: number;
    };
    const driverRow = drivers.page?.content?.find((d) => d.driverId === DRIVER_ID);
    const driverBook = await dbDriverBook(oracle);
    disc81.push(
      ...compareBalance(
        'cc-chofer',
        String(DRIVER_ID),
        'balance (API) vs ultimo BALANCE del libro',
        lastBalance(driverBook),
        driverRow?.balance ?? null
      ),
      ...compareBalance(
        'cc-chofer',
        'totalBalance',
        'totalBalance vs ultimo BALANCE del libro',
        lastBalance(driverBook),
        drivers.totalBalance ?? null
      ),
      ...bookIntegrity('cc-chofer (libro)', driverBook)
    );
    const maxBilling = Math.max(...(await dbSurrenders(oracle)).map((r) => r.TOTALBILLING ?? 0), 0);
    const outlierLimit = Math.max(10 * maxBilling, 1_000);
    result.facts.bookOutlierLimit = outlierLimit;
    const outliers: Discrepancy[] = bookOutliers('cc-chofer (libro)', driverBook, outlierLimit);
    const driverDetail = page
      .locator('tbody tr')
      .first()
      .locator('button[ng-reflect-ngb-tooltip="Detail"]')
      .first();
    await detailPdf(page, result, entries, driverDetail, 'CC chofer detalle', 'cc-driver-detail');

    // Propietario
    const ownersResp = page.waitForResponse((r) => r.url().includes('/owners/paginated'), {
      timeout: 45_000
    });
    await openRoute(page, '/checking-accounts/owners');
    const owners = (await (await ownersResp).json()) as {
      page?: { content?: Array<{ ownerId: number; balance: number }> };
      totalBalance?: number;
    };
    const ownerRow = owners.page?.content?.find((o) => o.ownerId === OWNER_ID);
    const ownerBook = await dbOwnerBook(oracle);
    result.facts.ownerBalanceApi = ownerRow?.balance ?? null;
    disc81.push(
      ...compareBalance(
        'cc-propietario',
        String(OWNER_ID),
        'balance (API) vs ultimo BALANCE del libro',
        lastBalance(ownerBook),
        ownerRow?.balance ?? null
      ),
      ...bookIntegrity('cc-propietario (libro)', ownerBook)
    );
    outliers.push(...bookOutliers('cc-propietario (libro)', ownerBook, outlierLimit));
    const ownerDetail = page
      .locator('tbody tr')
      .first()
      .locator('button[ng-reflect-ngb-tooltip="Detail"]')
      .first();
    await detailPdf(
      page,
      result,
      entries,
      ownerDetail,
      'CC propietario detalle',
      'cc-owner-detail'
    );

    // Cliente: detalle
    await openRoute(page, '/checking-accounts/clients');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    const clientDetail = page
      .locator('tbody tr')
      .first()
      .locator('button:has(i.mdi-format-list-bulleted)')
      .first();
    await detailPdf(page, result, entries, clientDetail, 'CC cliente detalle', 'cc-client-detail');

    // AC-96: el par residual documentado (11.312.004) es dato de TEST; cualquier otro outlier es defecto.
    const { known, unexpected } = splitKnownOutliers(outliers, KI_OUTLIER_AMOUNT);
    if (known.length > 0) {
      knownIssue(
        testInfo,
        'AC-FR-96',
        `par residual ${KI_OUTLIER_AMOUNT} visible en libros: ${known.map((d) => d.key).join(', ')} (el saldo cierra)`
      );
    }
    disc81.push(...unexpected);
    await verifyList(testInfo, 'AC-FR-81', result, disc81, { knownOutliers: known.length });
    await verifyDownloads(testInfo, result, entries, []);
  });

  test('R4 Aging (067): CSV descargado vs grilla vs saldo del propietario', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R4');
    test.setTimeout(180_000);
    const result = newResult(
      'Aging Report',
      '/reports/debt-aging',
      'CSV (; con BOM) + PDF',
      'POST data/genericReport/067 + 067T'
    );
    const rowsCall = waitForReportCall(page, '067');
    const totalsCall = waitForReportCall(page, '067T');
    await openRoute(page, '/reports/debt-aging');
    const [rowsResp, totalsResp] = await Promise.all([rowsCall, totalsCall]);
    const gridRows = contentRows(rowsResp);
    const totalsRows = contentRows(totalsResp);
    result.facts.gridRows = gridRows;
    result.facts.totals = totalsRows;

    const download = await clickAndDownload(page, csvButton(page), 'Aging CSV', 'aging');
    result.files.push(download.file);
    const csv = download.path ? parseCsv(readFileSync(download.path, 'utf8')) : [];
    result.facts.csvHeader = csv[0];
    const csvObjects = csvToObjects(csv);
    result.facts.csvRows = csvObjects.length;
    const csvVerdict = evaluateAgingCsv(gridRows, csvObjects, parseMoney);
    const totalsVerdict = evaluateAgingTotals(gridRows, totalsRows);
    await verifyAc(testInfo, 'AC-FR-82', async () => {
      expect.soft(rowsResp.status, errorSummary(rowsResp)).toBe(200);
      expect.soft(totalsResp.status, errorSummary(totalsResp)).toBe(200);
      expect.soft(download.file.ok, JSON.stringify(download.file)).toBe(true);
      expect.soft(csvVerdict.ok, csvVerdict.message).toBe(true);
      expect.soft(totalsVerdict.ok, totalsVerdict.message).toBe(true);
      return { gridRows: gridRows.length, csvRows: csvObjects.length };
    });
    // Aging vs libro del propietario: la base del aging no esta documentada -> pregunta al PO (no se asevera).
    const ownerBalance = lastBalance(await dbOwnerBook(oracle));
    for (const row of gridRows) {
      observation(
        testInfo,
        'AC-FR-82',
        `PO: Total aging ${row.Col3} (propietario ${row.Col1}) vs saldo del libro ${ownerBalance}: base del aging sin documentar; confirmar si debe igualar el saldo de CC`
      );
    }
  });

  test('R5 Company (agency) commissions (021/021T): vs TRAVELSSURRENDER del rango', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R5');
    test.setTimeout(180_000);
    const result = newResult(
      'Company Commissions',
      '/reports/agency-commissions',
      'PDF (jsPDF, cliente)',
      'POST data/genericReport/021 + 021T'
    );
    const rowsCall = waitForReportCall(page, '021', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`
    ]);
    await openRoute(page, '/reports/agency-commissions');
    await expect(page.getByRole('textbox', { name: /choose date/i }).first()).toBeVisible({
      timeout: 30_000
    });
    await setRange(page, FROM, TO);
    const call = await rowsCall;
    const rows = contentRows(call);
    result.facts.gridRows = rows.length;
    const sums = await oracle.query<{ N: number; BILLED: number; AGENCY: number; OWNER: number }>(
      `SELECT COUNT(*) AS N, NVL(SUM(TOTALBILLING),0) AS BILLED, NVL(SUM(AGENCY_TOTALCOMMISSION),0) AS AGENCY, NVL(SUM(OWNER_TOTALCOMMISSION),0) AS OWNER
       FROM TRAVELSSURRENDER
       WHERE CARRIER_ID = :c AND VEHICLE_ID IS NOT NULL AND CREATIONDATE >= TO_DATE(:f, 'YYYY-MM-DD') AND CREATIONDATE < TO_DATE(:t, 'YYYY-MM-DD') + 1`,
      { c: CARRIER_ID, f: FROM, t: TO }
    );
    const s = sums[0];
    result.facts.dbSurrenders = s;
    const disc83: Discrepancy[] = [];
    if (call.status !== 200) {
      disc83.push({
        report: 'agency-commissions',
        key: 'genericReport/021',
        field: 'HTTP status',
        expected: 200,
        actual: errorSummary(call)
      });
    }
    let pendingRefresh = false;
    if (rows.length === 0 && s && s.N > 0) {
      const d: Discrepancy = {
        report: 'agency-commissions',
        key: `vehiculo/propietario ${OWNER_ID}`,
        field: 'filas del reporte vs rendiciones con comision de agencia en el rango',
        expected: `>=1 fila (DB: ${s.N} rendiciones, Billed ${s.BILLED}, Company Comm ${s.AGENCY})`,
        actual: '0 filas',
        note: 'el reporte lee VM_HeatMap (refresh diario); sin refresh posterior al dato no hay filas'
      };
      // Ambiente: con 0 filas y sin confirmacion de refresh es el pendiente AC-89; con refresh confirmado es defecto.
      if (MVIEWS_REFRESHED) disc83.push(d);
      else pendingRefresh = true;
    } else if (rows.length > 0 && s) {
      const billed = round2(rows.reduce((a, r) => a + (parseMoney(r.Col5 ?? '') ?? 0), 0));
      disc83.push(
        ...compareBalance(
          'agency-commissions',
          'Billed',
          'suma Billed vs SUM(TOTALBILLING)',
          s.BILLED,
          billed,
          `${rows.length} filas del reporte vs ${s.N} rendiciones de DB`
        ),
        ...(rows.length !== s.N
          ? [
              {
                report: 'agency-commissions',
                key: 'filas',
                field: 'cantidad de filas vs rendiciones del rango',
                expected: s.N,
                actual: rows.length
              }
            ]
          : [])
      );
    }
    if (pendingRefresh) {
      knownIssue(
        testInfo,
        'AC-FR-89',
        `R5: 0 filas vs DB ${s?.N} rendiciones; mview VM_HeatMap sin refrescar. Re-validar con FR_MVIEWS_REFRESHED=1 tras el refresh`
      );
    } else {
      await verifyList(testInfo, 'AC-FR-83', result, disc83, { rows: rows.length });
      if (MVIEWS_REFRESHED) {
        await verifyAc(testInfo, 'AC-FR-89', async () => {
          expect.soft(disc83, formatDiscrepancies(disc83)).toEqual([]);
          return { revalidatedAfterRefresh: true };
        });
      }
    }
    await expectButtonState(result, 'PDF', pdfButton(page));
    const download = await clickAndDownload(
      page,
      pdfButton(page),
      'Company Commissions PDF',
      'agency-commissions'
    );
    result.files.push(download.file);
    await verifyDownloads(
      testInfo,
      result,
      [{ key: 'Company Commissions PDF', file: download.file, allow: [] }],
      []
    );
  });

  test('R6 Cash flow (016) y Taxes & Fees (094): el backend debe responder 200', async ({
    page
  }, testInfo) => {
    test.setTimeout(180_000);
    const cash = newResult(
      'Collection Movements (cash-flow)',
      '/reports/cash-flow',
      'PDF (jsPDF, cliente)',
      'POST data/genericReport/016'
    );
    const cashCall = waitForReportCall(page, '016', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`,
      `"alias":"dateTo","value":"${ddmmyyyy(TO)}"`
    ]);
    await openRoute(page, '/reports/cash-flow');
    await expect(page.getByRole('textbox', { name: /choose date/i }).first()).toBeVisible({
      timeout: 30_000
    });
    await setRange(page, FROM, TO);
    const c = await cashCall;
    cash.facts.call = { status: c.status, body: c.body, filters: c.request.filters };
    await expectButtonState(cash, 'PDF', pdfButton(page));

    const taxes = newResult(
      'Taxes and Fees',
      '/reports/taxes-and-fees',
      'CSV (; con BOM) + PDF',
      'POST data/genericReport/094'
    );
    const taxCall = waitForReportCall(page, '094', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`,
      `"alias":"dateTo","value":"${ddmmyyyy(TO)}"`
    ]);
    await openRoute(page, '/reports/taxes-and-fees');
    await expect(page.getByRole('textbox', { name: /choose date/i }).first()).toBeVisible({
      timeout: 30_000
    });
    await setRange(page, FROM, TO);
    const t = await taxCall;
    taxes.facts.call = { status: t.status, body: t.body, filters: t.request.filters };
    await expectButtonState(taxes, 'CSV', csvButton(page));
    await expectButtonState(taxes, 'PDF', pdfButton(page));

    // AC-84 estricto salvo la firma exacta del known-issue AC-92 (400 BAD_FILTER_NAME CURRENCY_ID).
    for (const [result, call, code] of [
      [cash, c, '016'],
      [taxes, t, '094']
    ] as const) {
      const kind = classifyReportHttp(call);
      if (kind === 'ki-92-currency-id') {
        knownIssue(
          testInfo,
          'AC-FR-92',
          `genericReport/${code}: ${errorSummary(call)}; el front no envia CURRENCY_ID`
        );
        continue;
      }
      const disc: Discrepancy[] =
        kind === 'ok'
          ? []
          : [
              {
                report: result.report,
                key: `genericReport/${code}`,
                field: 'HTTP status del reporte',
                expected: 200,
                actual: errorSummary(call)
              }
            ];
      await verifyList(testInfo, 'AC-FR-84', result, disc, { code, status: call.status });
    }
  });

  test('R7 Payment Movements (055): vacio solo si la DB no tiene pagos/liquidaciones', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R7');
    test.setTimeout(180_000);
    const result = newResult(
      'Payment Movements (payment-flow)',
      '/reports/payment-flow',
      'PDF (jsPDF, cliente)',
      'POST data/genericReport/055'
    );
    const call055 = waitForReportCall(page, '055', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`,
      `"alias":"dateTo","value":"${ddmmyyyy(TO)}"`
    ]);
    await openRoute(page, '/reports/payment-flow');
    await expect(page.getByRole('textbox', { name: /choose date/i }).first()).toBeVisible({
      timeout: 30_000
    });
    await setRange(page, FROM, TO);
    const call = await call055;
    const rows = contentRows(call);
    const payments = await oracle.query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM CHECKINGACCOUNTFOROWNER WHERE CARRIERACCOUNT_ID = :c AND MOVEMENTTYPE <> 'AUTOMATIC'`,
      { c: CARRIER_ID }
    );
    const manual = payments[0]?.N ?? 0;
    result.facts.gridRows = rows.length;
    result.facts.dbManualOwnerMovements = manual;
    const disc: Discrepancy[] = [];
    if (manual === 0 && rows.length > 0) {
      disc.push({
        report: 'payment-flow',
        key: 'filas',
        field: 'filas con 0 pagos manuales en DB',
        expected: 0,
        actual: rows.length
      });
    } else if (manual > 0 && rows.length === 0) {
      disc.push({
        report: 'payment-flow',
        key: 'filas',
        field: 'filas vs pagos manuales de DB',
        expected: `>=1 (DB ${manual})`,
        actual: 0
      });
    }
    await expectButtonState(result, 'PDF', pdfButton(page));
    await verifyAc(testInfo, 'AC-FR-85', async () => {
      expect.soft(call.status, errorSummary(call)).toBe(200);
      result.discrepancies.push(...disc);
      expect.soft(disc, formatDiscrepancies(disc)).toEqual([]);
      return { rows: rows.length, dbManualOwnerMovements: manual };
    });
  });

  test('R8 Individual CA travels (060): viajes de CC del cliente vs DB', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R8');
    test.setTimeout(180_000);
    const result = newResult(
      'Customers - Credit Account (individual CA travels)',
      '/reports/individual-ca-travels',
      'CSV (; con BOM) + PDF + Detailed PDF',
      'POST data/genericReport/060 + 060T'
    );
    const call060 = waitForReportCall(page, '060', [
      `"alias":"dateFrom","value":"${ddmmyyyy(FROM)}"`,
      `"alias":"dateTo","value":"${ddmmyyyy(TO)}"`,
      '"size":1000000'
    ]);
    await openRoute(page, '/reports/individual-ca-travels');
    await expect(page.getByRole('textbox', { name: /choose date/i }).first()).toBeVisible({
      timeout: 30_000
    });
    await setRange(page, FROM, TO);
    const call = await call060;
    const rows = contentRows(call);
    result.facts.gridRows = rows.length;
    const dbSql = (table: string): string =>
      `SELECT t.ID, f.FINALPRICE FROM ${table} t LEFT JOIN FINALPRICEI f ON f.ID = t.FINALPRICE_ID
       WHERE t.CARRIERACCOUNT_ID = :c AND t.PAYMENTMETHOD = 'CHECKING_ACCOUNT' AND t.STATE = 6 AND t.ID >= :m ORDER BY t.ID`;
    const dbLive = await oracle.query<{ ID: number; FINALPRICE: number | null }>(dbSql('TRAVEL'), {
      c: CARRIER_ID,
      m: 71532
    });
    const dbHistory = await oracle.query<{ ID: number; FINALPRICE: number | null }>(
      `SELECT t.ID, t.FINALPRICE FROM TRAVEL_HISTORY t
       WHERE t.CARRIERACCOUNT_ID = :c AND t.PAYMENTMETHOD = 'CHECKING_ACCOUNT' AND t.STATE = 6 AND t.ID >= :m ORDER BY t.ID`,
      { c: CARRIER_ID, m: 71532 }
    );
    result.facts.dbLiveCheckingAccountTrips = dbLive;
    result.facts.dbHistoryCheckingAccountTrips = dbHistory;
    // El reporte lee VM_TRAVEL_HISTORY (refresh diario): los viajes archivados deben figurar; los vigentes
    // (aun en TRAVEL) o archivados despues del ultimo refresh son el pendiente AC-89 (dato de TEST).
    const reportHas = (id: number): boolean =>
      rows.some((r) => Object.values(r).some((v) => String(v ?? '').trim() === String(id)));
    const liveFound = dbLive.filter((t) => reportHas(t.ID));
    const livePending = dbLive.filter((t) => !reportHas(t.ID));
    const required = MVIEWS_REFRESHED ? [...dbHistory, ...dbLive] : [...dbHistory, ...liveFound];
    const v = evaluateTripsInReport(
      rows,
      required.map((t) => t.ID)
    );
    if (livePending.length > 0 && !MVIEWS_REFRESHED) {
      knownIssue(
        testInfo,
        'AC-FR-89',
        `R8: viajes CC vigentes/no archivados ausentes del reporte (${livePending.map((t) => t.ID).join(', ')}); VM_TRAVEL_HISTORY refresca a diario. Re-validar con FR_MVIEWS_REFRESHED=1`
      );
    }
    await verifyAc(testInfo, 'AC-FR-86', async () => {
      expect.soft(call.status, errorSummary(call)).toBe(200);
      expect.soft(v.ok, v.message).toBe(true);
      return { reportRows: rows.length, history: dbHistory.length, live: dbLive.length };
    });
    result.discrepancies.push(
      ...v.mismatches.map((m) => ({
        report: 'individual-ca-travels',
        key: m.field,
        field: 'viajes de CC terminados vs reporte',
        expected: m.expected,
        actual: m.actual
      }))
    );
    if (MVIEWS_REFRESHED) {
      await verifyAc(testInfo, 'AC-FR-89', async () => {
        expect.soft(v.ok, v.message).toBe(true);
        return { revalidatedAfterRefresh: true };
      });
    }
    const csvState = await expectButtonState(result, 'CSV', csvButton(page));
    await expectButtonState(result, 'PDF', page.getByRole('button', { name: /^pdf$/i }).first());
    if (csvState === 'enabled') {
      const download = await clickAndDownload(
        page,
        csvButton(page),
        'Individual CA CSV',
        'individual-ca'
      );
      result.files.push(download.file);
      if (download.path)
        result.facts.csvRows = parseCsv(readFileSync(download.path, 'utf8')).length - 1;
    }
  });

  test('R9 Settlements (074 chofer / 075 propietario / 073 pasajero): saldos vs DB', async ({
    page,
    db
  }, testInfo) => {
    const oracle = requireOracle(db, 'FR reports R9');
    test.setTimeout(240_000);
    const result = newResult(
      'Settlements (choferes, propietarios, pasajeros)',
      '/liquidations/{drivers|owners|passenger}/list',
      'PDF servidor en filas (best-effort)',
      'POST data/genericReport/074, 075, 073'
    );
    const driverBook = await dbDriverBook(oracle);
    const ownerBook = await dbOwnerBook(oracle);
    const disc87: Discrepancy[] = [];

    const drv = waitForReportCall(page, '074');
    await openRoute(page, '/liquidations/drivers/list');
    const drivers = contentRows(await drv);
    const drvRow = drivers.find((r) => r.Col1 === String(DRIVER_ID));
    disc87.push(
      ...compareBalance(
        'settlements-chofer',
        String(DRIVER_ID),
        'Balance (Col4) vs ultimo BALANCE del libro',
        lastBalance(driverBook),
        parseMoney(drvRow?.Col4 ?? '')
      )
    );
    const lastSurrender = await oracle.query<{ M: number }>(
      'SELECT MAX(ID) AS M FROM TRAVELSSURRENDER WHERE CARRIER_ID = :c AND DRIVER_ID = :d',
      { c: CARRIER_ID, d: DRIVER_ID }
    );
    disc87.push(
      ...compareBalance(
        'settlements-chofer',
        String(DRIVER_ID),
        'ultima rendicion (Col8) vs MAX(TRAVELSSURRENDER.ID)',
        lastSurrender[0]?.M ?? null,
        parseMoney(drvRow?.Col8 ?? '')
      )
    );

    const own = waitForReportCall(page, '075');
    await openRoute(page, '/liquidations/owners/list');
    const ownersRows = contentRows(await own);
    const ownRow = ownersRows.find((r) => r.Col1 === String(OWNER_ID));
    disc87.push(
      ...compareBalance(
        'settlements-propietario',
        String(OWNER_ID),
        'saldo (Col5) vs ultimo BALANCE del libro',
        lastBalance(ownerBook),
        parseMoney(ownRow?.Col5 ?? '')
      )
    );
    const ownerPdf = page
      .locator('tbody tr')
      .first()
      .locator('button[ng-reflect-ngb-tooltip="Download Last Settlement"]')
      .first();
    const ownerFile = await clickAndDownload(
      page,
      ownerPdf,
      'Owner Download Last Settlement',
      'settlement-owner-last'
    );
    result.files.push(ownerFile.file);

    const pax = waitForReportCall(page, '073');
    await openRoute(page, '/liquidations/passenger/list');
    const paxRows = contentRows(await pax);
    const paxRow = paxRows.find((r) => r.Col9 === String(CLIENT_CC_ID));
    const dbCc = await oracle.query<{ BALANCE: number; CHECKINGACCOUNTLIMIT: number }>(
      'SELECT BALANCE, CHECKINGACCOUNTLIMIT FROM CHECKINGACCOUNT WHERE ID = :id',
      { id: CLIENT_CC_ID }
    );
    disc87.push(
      ...compareBalance(
        'settlements-pasajero',
        String(CLIENT_CC_ID),
        'Balance (Col4) vs limite - BALANCE',
        dbCc[0] ? clientCcApiBalanceFromDb(dbCc[0]) : null,
        parseMoney(paxRow?.Col4 ?? '')
      ),
      ...compareBalance(
        'settlements-pasajero',
        String(CLIENT_CC_ID),
        'Disponible (Col5) vs BALANCE DB',
        dbCc[0]?.BALANCE ?? null,
        parseMoney(paxRow?.Col5 ?? '')
      )
    );
    await verifyAc(testInfo, 'AC-FR-87', async () => {
      expect.soft(drivers.length, 'el listado de choferes debe traer filas').toBeGreaterThan(0);
      result.discrepancies.push(...disc87);
      expect.soft(disc87, formatDiscrepancies(disc87)).toEqual([]);
      return { discrepancies: disc87.length };
    });
    await verifyDownloads(
      testInfo,
      result,
      [{ key: 'Owner Download Last Settlement', file: ownerFile.file, allow: ['ki-91'] }],
      []
    );
  });
});

/** Entra al detalle de una CC y descarga su PDF si el control existe (best-effort, solo lectura). */
async function detailPdf(
  page: Page,
  result: ReportResult,
  entries: DownloadEntry[],
  detailButton: Locator,
  label: string,
  key: string
): Promise<void> {
  if ((await detailButton.count()) === 0) {
    result.observations.push(`${label}: boton Detail ausente`);
    return;
  }
  await detailButton.click();
  const pdf = page
    .locator(
      'button:has(i[class*="file-pdf"]), button:has(i[class*="file-download"]), button:has-text("PDF")'
    )
    .first();
  try {
    await pdf.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    result.observations.push(`${label}: sin boton PDF visible en el detalle`);
    return;
  }
  const download = await clickAndDownload(page, pdf, label, key);
  result.files.push(download.file);
  entries.push({ key: label, file: download.file, allow: ['ki-91'] });
  if (classifyDownload(download.file, ['ki-91']) === 'valid') pdfText(download.file, download.path);
}
