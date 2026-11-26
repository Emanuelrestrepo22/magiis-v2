/**
 * B5 — el cuerpo de la respuesta de `places/autocomplete` trae los 9 campos del contrato (`PredictionDTO`). Sin
 * traza propia en la matriz V1 (contrato MX-5851 §7.3).
 *
 * Oráculo: el CONTRATO real, no el texto del AC. El AC nombra `isAirport`; el endpoint devuelve `airport` (Lombok
 * `isAirport()` -> Jackson `airport`), confirmado en develop (`MagiisAutocompletePrediction.airport`). Esa
 * discrepancia ya está reportada y no se «corrige» acá: se deja constancia en el detalle.
 *
 * Solo se verifica PRESENCIA de la clave (en develop `placeId` puede ser null con source AIRPORT y `latitude`/
 * `longitude` null con source GOOGLE: son valores legítimos, la clave igual viaja).
 */

import { autocompleteCalls, resetField, settle } from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { CONTRACT_FIELDS, DEFAULT_SETTLE_MS, toResult } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type DtoMeasurements = {
  term: string;
  /** Primer cuerpo de respuesta no vacío; `null` si ningún request trajo cuerpo. */
  responseBody: string | null;
};

export type ParsedDto = {
  parseError: string | null;
  rows: Record<string, unknown>[];
};

export function parseDtoBody(body: string): ParsedDto {
  try {
    const parsed: unknown = JSON.parse(body);
    return {
      parseError: null,
      rows: Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : []
    };
  } catch (e) {
    return { parseError: (e as Error).message, rows: [] };
  }
}

export function evaluateDtoMapping(m: DtoMeasurements): Evaluation {
  if (m.responseBody === null || m.responseBody.trim().length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: 'Ningún request trajo cuerpo de respuesta para inspeccionar.'
    };
  }
  const { parseError, rows } = parseDtoBody(m.responseBody);
  if (parseError !== null) {
    return {
      status: 'NO_EJERCIDO',
      detail: `La respuesta no se pudo parsear como JSON (${parseError}).`
    };
  }
  if (rows.length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: `El endpoint respondió un arreglo vacío para "${m.term}". Sin filas no hay mapeo que verificar; probar con otro término.`
    };
  }
  const first = rows[0] as Record<string, unknown>;
  const missing = CONTRACT_FIELDS.filter((f) => !(f in first));
  if (missing.length > 0) {
    return {
      status: 'FAIL',
      detail: `Faltan campos del contrato en la respuesta: ${missing.join(', ')}.`
    };
  }
  const hasIsAirport = 'isAirport' in first;
  return {
    status: 'PASS',
    detail:
      `Los ${CONTRACT_FIELDS.length} campos del contrato están presentes en ${rows.length} fila(s). ` +
      `El AC nombra "isAirport" y el endpoint devuelve "airport"${hasIsAirport ? ' — acá vinieron los dos' : ' (isAirport no viene, como estaba medido)'}.`
  };
}

export async function runDtoMappingProbe(
  target: AddressFieldTarget,
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';

  await resetField(driver, selector);
  await typeText(driver, selector, term);
  await settle(opts.settleMs ?? DEFAULT_SETTLE_MS);
  const calls = await autocompleteCalls(driver);
  const withBody = calls.find((c) => (c.responseBody ?? '').trim().length > 0);

  const measurements: DtoMeasurements = { term, responseBody: withBody?.responseBody ?? null };
  const parsed = measurements.responseBody ? parseDtoBody(measurements.responseBody) : null;
  const first = parsed?.rows[0];
  return toResult(
    { behavior: 'B5', title: 'Mapeo del DTO (contrato 7.3)' },
    evaluateDtoMapping(measurements),
    {
      term,
      calls: calls.length,
      rows: parsed?.rows.length ?? null,
      fieldsPresent: first ? CONTRACT_FIELDS.filter((f) => f in first) : null,
      fieldsMissing: first ? CONTRACT_FIELDS.filter((f) => !(f in first)) : null,
      hasIsAirport: first ? 'isAirport' in first : null,
      sources: parsed
        ? [...new Set(parsed.rows.map((r) => String(r.source ?? '')).filter(Boolean))]
        : null,
      firstRow: first ?? null,
      bodyPreview: measurements.responseBody?.slice(0, 200) ?? null
    }
  );
}
