// tests/steps/trips/f5Surrender.steps.ts
// Lecturas (SOLO LECTURA) de la rendicion F5: hechos de los viajes del lote, columnas nuevas de
// TRAVELSSURRENDER y texto del Clearing PDF. Devuelven datos crudos; los veredictos viven en
// tests/helpers/f5-surrender-oracle.ts y los ejecuta el spec.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OracleDb } from '../../db/OracleDb.js';
import type { Mismatch } from '../../helpers/oracle-result.js';
import {
  decidePdfModes,
  parseF5PdfMode,
  type F5PdfDecision,
  type F5PdfMode,
  F5_CC_NC_COLUMNS,
  F5_SURRENDER_COLUMNS,
  expectedF5,
  type F5CommissionInputs,
  type F5Expected,
  type F5CcNcRow,
  type F5SurrenderRow,
  type F5TripFacts
} from '../../helpers/f5-surrender-oracle.js';
import { readSaleCostData } from './dbOracles.steps.js';
import { readCommissionSettings } from './commissionSettings.steps.js';
import { fixedCommissionDays, fixedPerDay } from '../../helpers/commission-settings.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// Nombres de una lista cerrada (nunca de input): sin interpolacion de datos externos.
const F5_SURRENDER_SQL = `SELECT ${F5_SURRENDER_COLUMNS.join(', ')} FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;

/** Columnas F5 de la rendicion (`evaluateF5SurrenderRow` las contrasta). Lanza si la fila no existe. */
export async function readF5SurrenderColumns(
  db: OracleDb,
  surrenderId: number
): Promise<F5SurrenderRow> {
  const rows = await db.query<Record<string, unknown>>(F5_SURRENDER_SQL, { surrenderId });
  const raw = rows[0];
  if (!raw) throw new Error(`[f5] TRAVELSSURRENDER ${surrenderId} no existe`);
  return Object.fromEntries(F5_SURRENDER_COLUMNS.map((c) => [c, asNum(raw[c])])) as F5SurrenderRow;
}

const F5_CC_NC_SQL = `SELECT ${F5_CC_NC_COLUMNS.join(', ')} FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;

/** Columnas del NC de viajes CC de la rendicion (AC-F5-16). Lanza si la fila no existe. */
export async function readF5CcNcColumns(db: OracleDb, surrenderId: number): Promise<F5CcNcRow> {
  const rows = await db.query<Record<string, unknown>>(F5_CC_NC_SQL, { surrenderId });
  const raw = rows[0];
  if (!raw) throw new Error(`[f5] TRAVELSSURRENDER ${surrenderId} no existe`);
  return Object.fromEntries(F5_CC_NC_COLUMNS.map((c) => [c, asNum(raw[c])])) as F5CcNcRow;
}

/**
 * Hechos de cada viaje del lote desde DB (TRAVEL o TRAVEL_HISTORY): precio final, peaje, estacionamiento,
 * no comisionable e impuestos. El medio de pago lo aporta quien llama (GET toSurrend: `paymentMethod`).
 */
export async function readF5TripFacts(
  db: OracleDb,
  trips: ReadonlyArray<{ travelId: number; paymentMethod: string; ccByCost?: boolean }>
): Promise<F5TripFacts[]> {
  const out: F5TripFacts[] = [];
  for (const trip of trips) {
    const { row } = await readSaleCostData(db, trip.travelId);
    out.push({
      travelId: trip.travelId,
      paymentMethod: trip.paymentMethod,
      finalPrice: Number(row.FINALPRICE),
      toll: Number(row.TOOLPRICE ?? 0),
      parking: Number(row.PARKING ?? 0),
      noCom: Number(row.OTHER_COST_TOTAL_NOCOM ?? 0),
      taxes: Number(row.TAXES_COST ?? 0),
      // H-02: costo final (para venta − costo con CC por costo); `ccByCost` lo declara quien llama (perfil).
      costPrice: row.FINAL_COST_PRICE === null ? null : Number(row.FINAL_COST_PRICE),
      ...(trip.ccByCost === undefined ? {} : { ccByCost: trip.ccByCost })
    });
  }
  return out;
}

/** Esperado F5 del lote (hechos de DB + medio de pago). Un lote sin viajes lanza. */
export async function f5ExpectedOf(
  db: OracleDb,
  trips: ReadonlyArray<{ travelId: number; paymentMethod: string; ccByCost?: boolean }>
): Promise<F5Expected> {
  return expectedF5(await readF5TripFacts(db, trips));
}

/** COUNTRY.THOUSANDS_SEPARATOR del pais del carrier (SELECT en vivo). Lanza si no hay fila. */
export async function countryThousandsSeparator(db: OracleDb, carrierId: number): Promise<string> {
  const rows = await db.query<{ SEP: string | null }>(
    `SELECT c.THOUSANDS_SEPARATOR AS SEP FROM CARRIERACCOUNT ca JOIN COUNTRY c ON c.ID = ca.COUNTRY_ID WHERE ca.ID = :carrierId`,
    { carrierId }
  );
  const sep = rows[0]?.SEP;
  if (typeof sep !== 'string') {
    throw new Error(`[f5] COUNTRY.THOUSANDS_SEPARATOR del carrier ${carrierId} no se pudo leer`);
  }
  return sep;
}

/** COMMISSIONSUM (comision total del chofer) de la rendicion; lanza si la fila no existe o es NULL. */
export async function readSurrenderDriverCommission(
  db: OracleDb,
  surrenderId: number
): Promise<number> {
  const rows = await db.query<{ C: number | null }>(
    `SELECT COMMISSIONSUM AS C FROM TRAVELSSURRENDER WHERE ID = :surrenderId`,
    { surrenderId }
  );
  const c = asNum(rows[0]?.C);
  if (c === null) throw new Error(`[f5] TRAVELSSURRENDER ${surrenderId}: COMMISSIONSUM ausente`);
  return c;
}

/**
 * Entradas de la comision independiente (B3): pct de cada actor desde TRAVEL.*_COMMISSION_PCT (fijados al
 * FINALIZAR; deben ser iguales en todo el lote) y fija ajustada por dias (`fixedCommissionDays`: dia ya
 * cubierto por MAX(TRAVELSSURRENDER.LAST_SURRENDER_DATE) del chofer = 0). `driverId` = DRIVER.ID.
 */
export async function readF5CommissionInputs(
  db: OracleDb,
  input: {
    travelIds: readonly number[];
    driverId: number;
    vehicleId: number;
    /** Modo verificacion: ignora esta rendicion y las posteriores al buscar la «ultima rendicion» del chofer. */
    beforeSurrenderId?: number;
  }
): Promise<F5CommissionInputs> {
  const pcts = new Set<string>();
  const days: string[] = [];
  let pct = { owner: 0, driver: 0, agency: 0 };
  for (const travelId of input.travelIds) {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT OWNER_COMMISSION_PCT O, DRIVER_COMMISSION_PCT D, AGENCY_COMMISSION_PCT A, TO_CHAR(TRAVEL_DATE, 'YYYY-MM-DD') DAY FROM TRAVEL WHERE ID = :travelId
       UNION ALL
       SELECT OWNER_COMMISSION_PCT, DRIVER_COMMISSION_PCT, AGENCY_COMMISSION_PCT, TO_CHAR(TRAVEL_DATE, 'YYYY-MM-DD') FROM TRAVEL_HISTORY WHERE ID = :travelId`,
      { travelId }
    );
    if (rows.length !== 1)
      throw new Error(`[f5] viaje ${travelId}: ${rows.length} filas de comision`);
    const r = rows[0];
    pct = { owner: Number(r.O), driver: Number(r.D), agency: Number(r.A) };
    pcts.add(JSON.stringify(pct));
    days.push(String(r.DAY));
  }
  if (pcts.size !== 1) {
    throw new Error(`[f5] el lote mezcla porcentajes de comision (${[...pcts].join(' | ')})`);
  }
  const last = await db.query<{ D: string | null }>(
    `SELECT TO_CHAR(MAX(LAST_SURRENDER_DATE), 'YYYY-MM-DD') AS D FROM TRAVELSSURRENDER WHERE DRIVER_ID = :driverId${input.beforeSurrenderId === undefined ? '' : ' AND ID < :beforeId'}`,
    input.beforeSurrenderId === undefined
      ? { driverId: input.driverId }
      : { driverId: input.driverId, beforeId: input.beforeSurrenderId }
  );
  const settings = await readCommissionSettings(db, {
    vehicleId: input.vehicleId,
    driverId: input.driverId
  });
  const perDay = fixedPerDay(settings);
  const fixedDays = fixedCommissionDays(days, last[0]?.D ?? null);
  return {
    pctOwner: pct.owner,
    pctDriver: pct.driver,
    pctAgency: pct.agency,
    ownerFixed: Math.round(perDay.owner * fixedDays * 100) / 100,
    agencyFixed: Math.round(perDay.agency * fixedDays * 100) / 100
  };
}

/**
 * Verifica que `driverId` exista como DRIVER.ID y lo devuelve. La query `driverUserId` de la rendicion
 * lleva DRIVER.ID, NO DRIVER.USER_ID (TEST 2026-11-06: TRAVELSSURRENDER.DRIVER_ID = 5036 = DRIVER.ID,
 * cuyo USER_ID es 16351; mismo criterio que fr-circuit-s1). Buscar por USER_ID devolvia 0 filas.
 */
export async function requireDriverId(db: OracleDb, driverId: number): Promise<number> {
  const rows = await db.query<{ ID: number }>(`SELECT ID FROM DRIVER WHERE ID = :driverId`, {
    driverId
  });
  if (rows.length !== 1) throw new Error(`[f5] DRIVER.ID ${driverId}: ${rows.length} filas`);
  return Number(rows[0].ID);
}

const PDFTOTEXT_CANDIDATES = [
  process.env.PDFTOTEXT_PATH,
  'pdftotext',
  'C:/Program Files/Git/mingw64/bin/pdftotext.exe'
];

function resolvePdftotext(): string {
  for (const candidate of PDFTOTEXT_CANDIDATES) {
    if (!candidate) continue;
    if (candidate !== 'pdftotext' && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['-v'], { encoding: 'utf8' }).error === undefined) return candidate;
  }
  throw new Error(
    '[f5] pdftotext no disponible (PATH, PDFTOTEXT_PATH o Git mingw64): no se puede juzgar el Clearing'
  );
}

/** Modo de lectura de pdftotext: `table` existe en xpdf 4 (no en poppler; ahí falla y se omite). */
export type PdfTextMode = F5PdfMode;

/** Texto del PDF (`pdftotext -<mode>`) sin dejar archivos: el PDF se escribe en un temporal y se borra. */
export function clearingText(pdf: Buffer, mode: PdfTextMode = 'layout'): string {
  const bin = resolvePdftotext();
  const dir = mkdtempSync(join(tmpdir(), 'f5-clearing-'));
  try {
    const file = join(dir, 'clearing.pdf');
    writeFileSync(file, pdf);
    const result = spawnSync(bin, [`-${mode}`, file, '-'], {
      encoding: 'utf8'
    });
    if (result.status !== 0) throw new Error(`[f5] pdftotext -${mode} salio con ${result.status}`);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Evalúa una verificación anclada leyendo el PDF en varios modos. El servidor genera el mismo Clearing con otra
 * estructura según el ambiente (UAT 06/11: con `-layout` los importes quedan desfasados de sus rótulos; con
 * `-table` quedan en su renglón). H-01: el modo se FIJA por ambiente (`F5_PDF_MODE` = layout|table|raw, o
 * `options.fixedMode`): decide solo ese modo —un PDF desalineado no se rescata con otra lectura— y los demás
 * quedan en `diagnostics`. Sin modo fijo se conserva el comportamiento histórico (primer modo que ancla todas
 * las filas) pero el resultado declara `decidedBy: 'fallback-any'` y `modesDisagree`. En cada modo el importe
 * debe estar en el renglón de su rótulo (la regla no se relaja). Un modo que el binario no soporta se omite.
 */
export function evaluateAcrossPdfModes<V extends { ok: boolean; mismatches: Mismatch[] }>(
  pdf: Buffer,
  modes: readonly PdfTextMode[],
  evaluate: (text: string) => V,
  options: { fixedMode?: PdfTextMode | null } = {}
): F5PdfDecision<V> {
  const fixedMode =
    options.fixedMode === undefined ? parseF5PdfMode(process.env.F5_PDF_MODE) : options.fixedMode;
  const toRead = fixedMode !== null && !modes.includes(fixedMode) ? [...modes, fixedMode] : modes;
  const readings: Array<{ mode: PdfTextMode; verdict: V }> = [];
  for (const mode of toRead) {
    let text: string;
    try {
      text = clearingText(pdf, mode);
    } catch {
      continue;
    }
    readings.push({ mode, verdict: evaluate(text) });
  }
  return decidePdfModes(readings, fixedMode);
}
