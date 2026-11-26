/**
 * B7 — el `sessionToken` ROTA al seleccionar una predicción. Traza: TM-687 (CA-30).
 *
 * Complemento de B6: B6 asierta que un campo agrupa sus consultas bajo un token; esto asierta que el token se
 * CIERRA al elegir. Develop: `geocode()` / `resolveAddressSelection()` leen `_autocompleteSessionToken`, lo envían a
 * `places/getPlace` y lo ponen en `null`; la próxima búsqueda genera uno nuevo.
 *
 * GUARD DE PREMISA: que el tap encuentre una fila NO significa que la app procesó la elección. Si el campo no se
 * pobla, la selección no ocurrió y el token no tenía por qué rotar (así se reportó un defecto inexistente en
 * TM-687). Tampoco se vacía el campo entre la selección y la segunda consulta: escribir '' es en Places el cierre
 * natural de una sesión y haría PASS a un producto que rota al reiniciar pero no al elegir.
 *
 * La segunda consulta usa un término DISTINTO (si fuera el mismo, `distinctUntilChanged` no volvería a consultar) y
 * se correlaciona por `address` para descartar requests rezagados de la consulta anterior.
 */

import { autocompleteCalls, clearCapture, resetField, settle } from './autocompleteCapture.js';
import { focusField, readValue, typeText } from './fieldOps.js';
import { DEFAULT_SETTLE_MS, queryParam, toResult, uniq } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type TokenRotationMeasurements = {
  term: string;
  termAfter: string;
  /** El campo aceptó el primer término. */
  typed: boolean;
  tokensBefore: readonly string[];
  /** Etiqueta de la predicción tapeada; `null` = no había ninguna; `undefined` = no se llegó a esa etapa. */
  picked?: string | null;
  valueBefore?: string;
  valueAfter?: string;
  /** El campo aceptó el segundo término; `undefined` = no se llegó a esa etapa. */
  typedAfter?: boolean;
  tokensAfter?: readonly string[];
};

export function selectionPopulated(valueBefore: string, valueAfter: string): boolean {
  return valueAfter.length > 0 && valueAfter !== valueBefore;
}

export function evaluateTokenRotation(m: TokenRotationMeasurements): Evaluation {
  if (!m.typed) {
    return { status: 'SIN_DATOS', detail: 'El campo no aceptó texto: no hay token que observar.' };
  }
  if (m.picked === undefined || m.picked === null) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'No apareció ninguna predicción para seleccionar, así que la transición no se ejerció. NO es un defecto: sin selección no hay rotación que medir.'
    };
  }
  const before = m.valueBefore ?? '';
  const after = m.valueAfter ?? '';
  if (!selectionPopulated(before, after)) {
    return {
      status: 'SIN_DATOS',
      detail: `Se tapeó "${m.picked}" pero el campo no cambió ("${before}" -> "${after}"): la selección no llegó a concretarse, así que NO hay rotación que medir. Límite del harness, NO un defecto del producto.`
    };
  }
  if (m.typedAfter === undefined || !m.typedAfter) {
    return {
      status: 'SIN_DATOS',
      detail: `Tras seleccionar "${m.picked}" el campo no aceptó la segunda consulta ("${m.termAfter}"), así que no hay token posterior que comparar. Límite del harness, no un defecto.`
    };
  }
  const tb = uniq(m.tokensBefore.filter(Boolean));
  const ta = uniq((m.tokensAfter ?? []).filter(Boolean));
  if (tb.length === 0 || ta.length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: `Falta al menos un lado de la comparación (antes: ${tb.length}, después: ${ta.length}). Sin los dos tokens no se puede afirmar ni negar la rotación.`
    };
  }
  const rotated = ta.every((t) => !tb.includes(t));
  if (!rotated) {
    return {
      status: 'FAIL',
      detail: `El token NO rota: ${ta[0]} sigue vigente después de seleccionar "${m.picked}". La sesión de autocompletado no se cierra al elegir, así que el ahorro por sesión no se materializa.`
    };
  }
  return {
    status: 'PASS',
    detail: `El token rota al seleccionar: ${tb[0]} -> ${ta[0]} (seleccionado: "${m.picked}").`
  };
}

export async function runTokenRotationProbe(
  target: AddressFieldTarget,
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const termAfter = term.slice(0, -1);
  const wait = opts.settleMs ?? DEFAULT_SETTLE_MS;
  const meta = {
    behavior: 'B7',
    title: 'El sessionToken rota al seleccionar una predicción'
  } as const;
  const done = (m: TokenRotationMeasurements, extra: Record<string, unknown> = {}): ProbeResult =>
    toResult(meta, evaluateTokenRotation(m), { ...m, ...extra });

  await resetField(driver, selector);
  const typed = await typeText(driver, selector, term);
  if (!typed) return done({ term, termAfter, typed, tokensBefore: [] });
  await settle(wait);
  const tokensBefore = (await autocompleteCalls(driver))
    .map((c) => queryParam(String(c.url), 'sessionToken'))
    .filter(Boolean);

  const valueBefore = await readValue(driver, selector);
  const picked = await target.selectFirstPrediction();
  if (picked === null) return done({ term, termAfter, typed, tokensBefore, picked, valueBefore });

  const valueAfter = await readValue(driver, selector);
  if (!selectionPopulated(valueBefore, valueAfter)) {
    return done({ term, termAfter, typed, tokensBefore, picked, valueBefore, valueAfter });
  }
  // La resolución de la dirección elegida dispara su propio request (`places/getPlace`): se deja terminar.
  await settle(2600);
  await clearCapture(driver);

  await focusField(driver, selector);
  const typedAfter = await typeText(driver, selector, termAfter);
  await settle(wait);
  const callsAfter = (await autocompleteCalls(driver)).filter(
    (c) => queryParam(String(c.url), 'address') === termAfter
  );
  const tokensAfter = callsAfter
    .map((c) => queryParam(String(c.url), 'sessionToken'))
    .filter(Boolean);

  return done(
    {
      term,
      termAfter,
      typed,
      tokensBefore,
      picked,
      valueBefore,
      valueAfter,
      typedAfter,
      tokensAfter
    },
    { addressesAfter: callsAfter.map((c) => queryParam(String(c.url), 'address')) }
  );
}
