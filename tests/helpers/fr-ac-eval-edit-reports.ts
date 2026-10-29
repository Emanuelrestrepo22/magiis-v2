// tests/helpers/fr-ac-eval-edit-reports.ts
// Evaluadores PUROS (sin DB, sin Playwright, sin expect) de los ACs del circuito FR que cubren la matriz
// de edicion post-cierre (EDM) y los reportes financieros (RPT). Devuelven `ok` + `mismatches`; el spec
// asevera DENTRO de `verifyAc(testInfo, 'AC-FR-NN', ...)` con `expect(v.ok, v.message).toBe(true)`.
// Catalogo: docs/qa/automation-stock/fr-1901/criterios-aceptacion-circuito-fr-2026-10-21.md
import { round2 } from '../utils/money.js';
import { FR_FACTS } from './fr-facts.js';
import type { EditDiffs, ExpectedRow } from './edit-matrix.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';
import type { Discrepancy } from './report-oracle.js';

export type Verdict = OracleVerdict & { message: string };

const TOL = 0.011;
const near = (a: number, b: number): boolean => Math.abs(a - b) < TOL;

function verdict(label: string, mismatches: Mismatch[]): Verdict {
  return { ok: mismatches.length === 0, mismatches, message: formatMismatches(label, mismatches) };
}

// ───────────────────────── EDM ─────────────────────────

/** Fila de libro (chofer/propietario) tal como la devuelve la API; solo los campos que se comparan. */
export type BookRowLike = {
  id: number;
  amount?: number | null;
  paid?: number | null;
  origin?: number | null;
  checkingAccountCode?: string | null;
};

/** Campos de la edicion y la pregunta abierta al PO de la que dependen sus efectos en cascada. */
export type EditField = 'fare' | 'toll' | 'parking' | 'otherCom' | 'otherNoCom' | 'distance';
export const PO_QUESTION_OF_FIELD: Readonly<Record<EditField, string | null>> = {
  fare: null, // confirmado (regla PB-1 modelo A)
  otherCom: 'Q1',
  otherNoCom: 'Q2',
  distance: 'Q3',
  toll: 'Q4',
  parking: 'Q4'
};

/** AC-FR-54: el campo editado cambia exactamente lo pedido; el final cambia lo editado + colaterales registrados. */
export type FieldDeltaVerdict = Verdict & {
  /** Otros conceptos que cambiaron sin pedirlo (observacion PO, no falla). */
  collaterals: Record<string, number>;
  /** total - suma de partes (impuestos u otro recalculo; Q6), observacion PO. */
  taxesOrOther: number;
};

export function evaluateFieldDelta(
  field: EditField,
  requestedDelta: number,
  diffs: EditDiffs
): FieldDeltaVerdict {
  const m: Mismatch[] = [];
  const itemised = ['fare', 'wait', 'otherCom', 'otherNoCom', 'toll', 'parking'] as const;
  const collaterals = Object.fromEntries(
    itemised.filter((k) => k !== field && diffs[k] !== 0).map((k) => [k, diffs[k]])
  );
  const sumParts = round2(itemised.reduce((s, k) => s + diffs[k], 0));
  const taxesOrOther = round2(diffs.total - sumParts);
  if (field !== 'distance') {
    if (!near(diffs[field], requestedDelta)) {
      m.push({ field: `delta de ${field}`, expected: requestedDelta, actual: diffs[field] });
    }
    if (requestedDelta !== 0 && Math.sign(diffs.total) !== Math.sign(requestedDelta)) {
      m.push({
        field: 'sentido del precio final (sube/baja como lo editado)',
        expected: Math.sign(requestedDelta),
        actual: Math.sign(diffs.total)
      });
    }
  }
  return { ...verdict(`[AC-54 ${field}]`, m), collaterals, taxesOrOther };
}

/** AC-FR-55/56: deltas observados de TRAVELSSURRENDER vs esperados (solo las columnas pedidas). */
export function evaluateSurrenderDeltas(
  expected: Readonly<Record<string, number>>,
  observed: Readonly<Record<string, number>> | null,
  columns: readonly string[] | null,
  label: string
): Verdict {
  if (observed === null) {
    return verdict(label, [
      {
        field: 'TRAVELSSURRENDER',
        expected: 'columnas leidas de Oracle',
        actual: 'sin conexion DB'
      }
    ]);
  }
  const m: Mismatch[] = [];
  for (const [col, want] of Object.entries(expected)) {
    if (columns !== null && !columns.includes(col)) continue;
    const got = observed[col];
    if (got === undefined || !near(got, want)) m.push({ field: col, expected: want, actual: got });
  }
  return verdict(label, m);
}

/** Columnas que fijan la base comisionable c y las tres comisiones (AC-55); el resto es AC-56. */
export const COMMISSION_BASE_COLUMNS = [
  'TOTALBILLING',
  'COMMISSIONSUM',
  'OWNER_TOTALCOMMISSION',
  'AGENCY_TOTALCOMMISSION'
] as const;

export function columnsOutsideCommissionBase(expected: Readonly<Record<string, number>>): string[] {
  return Object.keys(expected).filter(
    (c) => !(COMMISSION_BASE_COLUMNS as readonly string[]).includes(c)
  );
}

const absAmounts = (r: BookRowLike): number[] =>
  [Math.abs(Number(r.amount ?? 0)), Math.abs(Number(r.paid ?? 0))].map(round2);

/** AC-FR-57: cantidad exacta de filas nuevas y cada fila esperada (monto + codigo si la fila lo informa). */
export function evaluateBookRows(
  side: 'chofer' | 'propietario',
  actualNew: readonly BookRowLike[],
  expected: readonly ExpectedRow[]
): Verdict {
  const m: Mismatch[] = [];
  if (actualNew.length !== expected.length) {
    m.push({
      field: `filas nuevas del libro (${side})`,
      expected: expected.length,
      actual: actualNew.length
    });
  }
  const pool = [...actualNew];
  for (const exp of expected) {
    const i = pool.findIndex(
      (r) =>
        absAmounts(r).some((a) => near(a, exp.amount)) &&
        (typeof r.checkingAccountCode !== 'string' ||
          r.checkingAccountCode === '' ||
          r.checkingAccountCode.includes(exp.code))
    );
    if (i < 0) {
      m.push({
        field: `fila esperada ${exp.code} (${exp.note}) en libro ${side}`,
        expected: exp.amount,
        actual: 'ausente'
      });
    } else {
      pool.splice(i, 1);
    }
  }
  return verdict(`[AC-57 libro ${side}]`, m);
}

const rowKey = (r: BookRowLike): string =>
  `${r.origin ?? 'n/a'}|${r.checkingAccountCode ?? ''}|${round2(Number(r.amount ?? 0))}|${round2(Number(r.paid ?? 0))}`;

/**
 * AC-FR-60: la edicion no repite filas (misma rendicion de origen, codigo y monto) ni entre las nuevas ni
 * contra las que ya existian en el libro.
 */
export function evaluateNoRepeatedBookRows(
  side: 'chofer' | 'propietario',
  before: readonly BookRowLike[],
  after: readonly BookRowLike[]
): Verdict {
  const known = new Set(before.map((r) => r.id));
  const fresh = after.filter((r) => !known.has(r.id));
  const priorKeys = new Set(before.map(rowKey));
  const seen = new Set<string>();
  const m: Mismatch[] = [];
  for (const r of fresh) {
    const key = rowKey(r);
    if (priorKeys.has(key)) {
      m.push({
        field: `fila nueva #${r.id} (${side}) repite una existente`,
        expected: 'unica',
        actual: key
      });
    } else if (seen.has(key)) {
      m.push({
        field: `fila nueva #${r.id} (${side}) repetida entre las nuevas`,
        expected: 'unica',
        actual: key
      });
    }
    seen.add(key);
  }
  return verdict(`[AC-60 libro ${side}]`, m);
}

export type CcMovementLike = {
  debit?: number | null;
  credit?: number | null;
  conceptCode?: string | null;
};

/** AC-FR-58: el movimiento TIVR de la CC se reescribe en el lugar (uno solo, debito +total, credito 0). */
export function evaluateCcRewrite(input: {
  before: readonly CcMovementLike[];
  after: readonly CcMovementLike[];
  expectedDelta: number;
  finalTotal: number;
}): Verdict {
  const { before, after, expectedDelta, finalTotal } = input;
  const m: Mismatch[] = [];
  if (after.length !== before.length || after.length !== 1) {
    m.push({
      field: 'movimientos de CC del viaje',
      expected: 1,
      actual: `${before.length} -> ${after.length}`
    });
  }
  const debitBefore = round2(Number(before[0]?.debit ?? 0));
  const debitAfter = round2(Number(after[0]?.debit ?? 0));
  if (!near(debitAfter - debitBefore, expectedDelta)) {
    m.push({
      field: 'delta del debito TIVR',
      expected: expectedDelta,
      actual: round2(debitAfter - debitBefore)
    });
  }
  if (!near(debitAfter, finalTotal)) {
    m.push({ field: 'debito TIVR = precio final', expected: finalTotal, actual: debitAfter });
  }
  if (!near(Number(after[0]?.credit ?? 0), 0)) {
    m.push({ field: 'credito TIVR', expected: 0, actual: after[0]?.credit });
  }
  return verdict('[AC-58 CC reescrita]', m);
}

/** AC-FR-47 (baseline antes de editar): exactamente UN cobro TIVR del viaje en la CC. */
export function evaluateSingleTivr(rows: readonly CcMovementLike[]): Verdict {
  const m: Mismatch[] = [];
  if (rows.length !== 1) {
    m.push({ field: 'movimientos de CC del viaje', expected: 1, actual: rows.length });
  }
  const code = rows[0]?.conceptCode;
  if (typeof code === 'string' && code !== '' && !code.includes('TIVR')) {
    m.push({ field: 'concepto del movimiento', expected: 'TIVR', actual: code });
  }
  return verdict('[AC-47 un cobro TIVR]', m);
}

export type CostSaleDetail = {
  total: number | null;
  totalCost: number | null;
  passThrough: number;
};

/**
 * AC-FR-61: costo final = venta final tras la edicion (no Universal). Estricto: un costo ausente es
 * diferencia (no se omite). Con peaje/estacionamiento/NO comisionables el costo = venta - pass-through
 * (AC-12); si `passThrough` > 0 el llamador lo trata como observacion PO (Q2/Q4).
 */
export function evaluateEditedCostEqualsSale(d: CostSaleDetail): Verdict {
  const m: Mismatch[] = [];
  if (d.total === null || d.totalCost === null) {
    m.push({
      field: 'amount / amountCost del detalle',
      expected: 'ambos numericos',
      actual: { total: d.total, totalCost: d.totalCost }
    });
  } else {
    const expectedCost = round2(d.total - d.passThrough);
    if (!near(d.totalCost, expectedCost)) {
      m.push({
        field: 'costo final (amountCost) vs venta final menos pass-through',
        expected: expectedCost,
        actual: d.totalCost
      });
    }
  }
  return verdict('[AC-61 costo = venta]', m);
}

export type FinalizeOutcome =
  | { accepted: true }
  | { accepted: false; status: number | null; message: string };

/** AC-FR-13: cerrar de nuevo un viaje ya rendido se rechaza (ACTION_NOT_ALLOWED observado; TRAVEL_SURRENDERED 409 tambien valido segun BE) y no cambia nada. */
export function evaluateFinalizeRejected(input: {
  outcome: FinalizeOutcome;
  before: { state: string; amount: number };
  after: { state: string; amount: number };
}): Verdict {
  const { outcome, before, after } = input;
  const m: Mismatch[] = [];
  if (outcome.accepted) {
    m.push({
      field: 'finalizeAdmin sobre viaje rendido',
      expected: 'rechazado (4xx ACTION_NOT_ALLOWED|TRAVEL_SURRENDERED)',
      actual: '2xx aceptado'
    });
  } else {
    if (outcome.status === null || outcome.status < 400 || outcome.status >= 500) {
      m.push({ field: 'HTTP status del rechazo', expected: '4xx', actual: outcome.status });
    }
    if (!FR_FACTS.reCloseRejectCodes.value.test(outcome.message)) {
      m.push({
        field: 'codigo de error',
        expected: 'ACTION_NOT_ALLOWED|TRAVEL_SURRENDERED',
        actual: outcome.message.slice(0, 200)
      });
    }
  }
  if (before.state !== after.state)
    m.push({ field: 'estado del viaje', expected: before.state, actual: after.state });
  if (!near(before.amount, after.amount))
    m.push({ field: 'precio final', expected: before.amount, actual: after.amount });
  return verdict('[AC-13 re-cierre rechazado]', m);
}

// ───────────────────────── RPT ─────────────────────────

export type SurrenderLike = { ID: number; DRIVER_ID: number | null };

/**
 * Alcance esperado de la grilla Closed: las rendiciones de DB con chofer (la grilla une por chofer) mas
 * las que la grilla muestre aunque no tengan chofer. Las automaticas (DRIVER_ID NULL) que la grilla omite
 * son el known-issue AC-FR-94 (H-AUTO-04), no un fallo de AC-79/80.
 */
export function closedGridScope<T extends SurrenderLike>(
  db: readonly T[],
  gridIds: ReadonlySet<number>
): { scope: T[]; omittedAutomatic: T[]; omittedWithDriver: T[] } {
  const scope = db.filter((s) => s.DRIVER_ID !== null || gridIds.has(s.ID));
  const omitted = db.filter((s) => !gridIds.has(s.ID));
  return {
    scope,
    omittedAutomatic: omitted.filter((s) => s.DRIVER_ID === null),
    omittedWithDriver: omitted.filter((s) => s.DRIVER_ID !== null)
  };
}

/** AC-FR-94: lo omitido por la grilla son SOLO rendiciones automaticas (cualquier otra omision es defecto nuevo). */
export function evaluateClosedOmission(omittedWithDriver: readonly SurrenderLike[]): Verdict {
  return verdict(
    '[AC-94 omision de automaticas]',
    omittedWithDriver.map((s) => ({
      field: `rendicion ${s.ID} con chofer ausente de la grilla`,
      expected: 'presente',
      actual: 'ausente'
    }))
  );
}

export type DownloadLike = {
  ok: boolean;
  kind?: 'pdf' | 'csv' | 'other';
  bytes?: number;
  suggestedName?: string;
  httpErrors: readonly string[];
};

/** Resultado de una descarga: valida, la firma del known-issue AC-90 / AC-91, o un fallo nuevo. */
export type DownloadOutcome = 'valid' | 'ki-90-empty-xml' | 'ki-91-http-500' | 'other';

/**
 * AC-90: «Generate pdf» devuelve un archivo vacio/.xml (THOUSANDS_SEPARATOR=SPACE). AC-91: el PDF de
 * detalle de CC / «Download Last Settlement» devuelve HTTP 500. Cualquier otra falla es `other` (defecto
 * nuevo, no tolerado).
 */
export function classifyDownload(
  file: DownloadLike,
  allow: readonly ('ki-90' | 'ki-91')[]
): DownloadOutcome {
  if (file.ok && file.kind === 'pdf' && (file.bytes ?? 0) > 1_000) return 'valid';
  if (
    allow.includes('ki-90') &&
    file.ok &&
    ((file.bytes ?? 0) === 0 || /\.xml$/i.test(file.suggestedName ?? ''))
  ) {
    return 'ki-90-empty-xml';
  }
  if (allow.includes('ki-91') && file.httpErrors.some((e) => /-> 500$/.test(e)))
    return 'ki-91-http-500';
  return 'other';
}

export type DownloadEntry = {
  key: string;
  file: DownloadLike;
  allow: readonly ('ki-90' | 'ki-91')[];
};

/** AC-FR-88: toda descarga es PDF/CSV valida, salvo la firma exacta de un known-issue permitido para ella. */
export function evaluateDownloads(entries: readonly DownloadEntry[]): Verdict & {
  tolerated: Array<{ key: string; outcome: DownloadOutcome }>;
} {
  const m: Mismatch[] = [];
  const tolerated: Array<{ key: string; outcome: DownloadOutcome }> = [];
  for (const e of entries) {
    const outcome = classifyDownload(e.file, e.allow);
    if (outcome === 'other') {
      m.push({
        field: `descarga ${e.key}`,
        expected: 'PDF valido (%PDF, > 1 KB)',
        actual: e.file.ok
          ? `${e.file.suggestedName} ${e.file.bytes} bytes (${e.file.kind})`
          : `sin descarga; ${e.file.httpErrors.join(' | ') || 'sin detalle'}`
      });
    } else if (outcome !== 'valid') {
      tolerated.push({ key: e.key, outcome });
    }
  }
  return { ...verdict('[AC-88 descargas]', m), tolerated };
}

/** AC-FR-92: firma exacta del defecto del backend: 400 BAD_FILTER_NAME «CURRENCY_ID». */
export type ReportHttp = 'ok' | 'ki-92-currency-id' | 'other';
export function classifyReportHttp(call: { status: number; body: unknown }): ReportHttp {
  if (call.status === 200) return 'ok';
  const body = call.body as { errorCode?: string; description?: string } | null;
  if (
    call.status === 400 &&
    body?.errorCode === 'BAD_FILTER_NAME' &&
    /CURRENCY_ID/i.test(body.description ?? '')
  ) {
    return 'ki-92-currency-id';
  }
  return 'other';
}

/** AC-FR-96: separa del libro el par residual documentado (monto exacto) de cualquier otro outlier. */
export function splitKnownOutliers(
  outliers: readonly Discrepancy[],
  knownAmount: number
): { known: Discrepancy[]; unexpected: Discrepancy[] } {
  const isKnown = (d: Discrepancy): boolean =>
    typeof d.actual === 'number' && Math.abs(Math.abs(d.actual) - knownAmount) < TOL;
  return { known: outliers.filter(isKnown), unexpected: outliers.filter((d) => !isKnown(d)) };
}

/** AC-FR-93: el PDF de Trip List imprime los mismos minutos en todas las filas («10»). */
export function isTripListMinutesKnownIssue(
  printedMinutes: string,
  wrongRows: number,
  totalRows: number
): boolean {
  return printedMinutes === '10' && wrongRows > 0 && wrongRows <= totalRows;
}

type GridRow = Record<string, string | null | undefined>;

/** AC-FR-86: cada viaje de CC terminado de DB figura en el reporte (id en alguna columna) y las cantidades coinciden. */
export function evaluateTripsInReport(rows: readonly GridRow[], dbIds: readonly number[]): Verdict {
  const m: Mismatch[] = [];
  if (rows.length !== dbIds.length) {
    m.push({ field: 'cantidad de viajes de CC', expected: dbIds.length, actual: rows.length });
  }
  for (const id of dbIds) {
    const found = rows.some((r) =>
      Object.values(r).some((v) => String(v ?? '').trim() === String(id))
    );
    if (!found)
      m.push({ field: `viaje ${id} en el reporte`, expected: 'presente', actual: 'ausente' });
  }
  return verdict('[AC-86 viajes CC]', m);
}

const toNumber = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * AC-FR-82: totales 067T = suma de la grilla 067 (columnas Col3..Col10 de la grilla ↔ Col1..Col8 de los
 * totales, forma medida en TEST 2026-10-21).
 */
export function evaluateAgingTotals(grid: readonly GridRow[], totals: readonly GridRow[]): Verdict {
  const m: Mismatch[] = [];
  const t = totals[0];
  if (!t)
    return verdict('[AC-82 aging 067T]', [
      { field: '067T', expected: 'una fila de totales', actual: 'vacio' }
    ]);
  for (let i = 1; i <= 8; i += 1) {
    const sum = round2(grid.reduce((s, r) => s + (toNumber(r[`Col${i + 2}`]) ?? 0), 0));
    const total = toNumber(t[`Col${i}`]);
    if (total === null || !near(sum, total)) {
      m.push({ field: `067T Col${i} vs suma de grilla Col${i + 2}`, expected: sum, actual: total });
    }
  }
  return verdict('[AC-82 aging 067T]', m);
}

/** AC-FR-82: cada propietario de la grilla figura en el CSV con el mismo total (|total| de la grilla). */
export function evaluateAgingCsv(
  grid: readonly GridRow[],
  csv: ReadonlyArray<Record<string, string>>,
  parse: (v: string) => number | null
): Verdict {
  const m: Mismatch[] = [];
  for (const row of grid) {
    const name = row.Col2 ?? '';
    const csvRow = csv.find((o) => Object.values(o).some((v) => v.includes(name)));
    if (!csvRow) {
      m.push({ field: `propietario ${name} en el CSV`, expected: 'presente', actual: 'ausente' });
      continue;
    }
    const want = Math.abs(Number(row.Col3));
    const hit = Object.values(csvRow)
      .map((v) => parse(v))
      .find((v) => v !== null && Math.abs(Math.abs(v) - want) < TOL);
    if (hit === undefined) {
      m.push({
        field: `Total del CSV de ${name} vs grilla`,
        expected: Number(row.Col3),
        actual: JSON.stringify(csvRow)
      });
    }
  }
  return verdict('[AC-82 aging CSV]', m);
}
