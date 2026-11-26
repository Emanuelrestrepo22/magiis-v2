/**
 * B6 — `sessionToken` presente y ESTABLE entre las consultas de un mismo campo. Traza: TM-686.
 *
 * Oráculo: MG-116 CA-28 (UUID por sesión de búsqueda, creado en la primera predicción y enviado a
 * `places/autocomplete`). Develop: `GooglePlacesService._autocompleteSessionToken` (UUID v4, perezoso, se descarta
 * al seleccionar). El alcance del token es de PANTALLA/servicio, no de campo (TM-693): acá solo se verifica lo
 * verificable por superficie — que el parámetro viaje y sea estable entre consultas distintas.
 *
 * «Estable» es una afirmación SOBRE VARIAS consultas: con una sola, `tokens.length === 1` es trivialmente cierto y
 * un campo que murió tras el primer término produce la misma firma (ocurrió en Mis Direcciones el 2026-08-19).
 */

import { autocompleteCalls, clearCapture, resetField, settle } from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { DEFAULT_SETTLE_MS, queryParam, toResult, uniq } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type SeenCall = { address: string; token: string };

export type SessionTokenMeasurements = {
  terms: readonly string[];
  /** Términos que el campo NO aceptó. */
  termsRejected: readonly string[];
  observed: readonly SeenCall[];
};

export function evaluateSessionToken(m: SessionTokenMeasurements): Evaluation {
  const seen = m.observed;
  const tokens = uniq(seen.map((s) => s.token).filter(Boolean));
  const distinctQueries = new Set(seen.map((s) => s.address).filter(Boolean)).size;

  if (seen.length === 0) {
    return { status: 'SIN_DATOS', detail: 'Cero requests: no hay token que observar.' };
  }
  if (tokens.length === 0) {
    return {
      status: 'NO_EJERCIDO',
      detail: `${seen.length} request(s) salieron SIN el parámetro sessionToken. El mecanismo de ahorro no está puesto en esta superficie.`
    };
  }
  if (tokens.length > 1) {
    return {
      status: 'FAIL',
      detail: `${seen.length} request(s) dentro del MISMO campo usaron ${tokens.length} tokens distintos. El parámetro viaja pero no agrupa la sesión, así que el ahorro no se materializa.`
    };
  }
  if (distinctQueries < 2) {
    return {
      status: 'NO_EJERCIDO',
      detail: `Solo se observó ${distinctQueries} consulta distinta de las ${m.terms.length} pedidas${m.termsRejected.length ? ` (el campo rechazó: ${m.termsRejected.join(', ')})` : ''}: un único request no puede acreditar estabilidad ENTRE consultas.`
    };
  }
  return {
    status: 'PASS',
    detail: `${seen.length} request(s) sobre ${distinctQueries} consultas distintas del mismo campo comparten un único token (${tokens[0]}).`
  };
}

export async function runSessionTokenProbe(
  target: AddressFieldTarget,
  opts: { terms?: readonly string[]; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const terms = opts.terms ?? ['libe', 'libertad', 'libertad 479'];

  await resetField(driver, selector);
  const observed: SeenCall[] = [];
  const termsRejected: string[] = [];
  for (const t of terms) {
    if (!(await typeText(driver, selector, t))) termsRejected.push(t);
    await settle(opts.settleMs ?? DEFAULT_SETTLE_MS);
    for (const c of await autocompleteCalls(driver)) {
      observed.push({
        address: queryParam(String(c.url), 'address'),
        token: queryParam(String(c.url), 'sessionToken')
      });
    }
    await clearCapture(driver);
  }

  const measurements: SessionTokenMeasurements = { terms, termsRejected, observed };
  return toResult(
    { behavior: 'B6', title: 'sessionToken presente y estable en el campo' },
    evaluateSessionToken(measurements),
    {
      ...measurements,
      calls: observed.length,
      distinctQueries: new Set(observed.map((s) => s.address).filter(Boolean)).size,
      distinctTokens: uniq(observed.map((s) => s.token).filter(Boolean))
    }
  );
}
