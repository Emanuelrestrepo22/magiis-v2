/**
 * B4 — `distinctUntilChanged`: reescribir el MISMO texto no reconsulta. Traza: TM-679.
 *
 * Oráculo: MG-116 (CA de no repetir consultas por un resultado ya conocido). Develop: `debounceTime(...)` +
 * `distinctUntilChanged()` sobre `inputEvent` en todos los componentes de dirección.
 *
 * El veredicto se apoya en una AUSENCIA, y cero requests es justo lo que produce un campo muerto: por eso hay PRUEBA
 * DE VIDA con un texto DISTINTO (nunca vaciando el campo, que en un producto sano podría volver a emitir).
 */

import { autocompleteCalls, clearCapture, resetField, settle } from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { DEFAULT_SETTLE_MS, queryParam, toResult } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type DistinctMeasurements = {
  term: string;
  callsFirstRound: number;
  /** El campo aceptó la reescritura del mismo texto. */
  retyped: boolean;
  callsOnRepeat: number;
  livenessTerm: string;
  livenessTyped: boolean;
  livenessCalls: number;
};

export function evaluateDistinctUntilChanged(m: DistinctMeasurements): Evaluation {
  if (m.callsFirstRound === 0) {
    return {
      status: 'SIN_DATOS',
      detail:
        'La primera consulta no salió, así que «no repite» no distingue la conducta de un campo inerte.'
    };
  }
  if (!m.retyped) {
    return {
      status: 'SIN_DATOS',
      detail:
        'El campo no aceptó la reescritura del mismo texto, así que la ausencia de requests no dice nada de la conducta.'
    };
  }
  if (m.callsOnRepeat > 0) {
    return {
      status: 'FAIL',
      detail: `Reescribir el mismo texto generó ${m.callsOnRepeat} request(s) nuevo(s). Se paga una consulta por un resultado ya conocido.`
    };
  }
  if (!m.livenessTyped || m.livenessCalls === 0) {
    return {
      status: 'SIN_DATOS',
      detail: `Cero requests al repetir, pero también cero con un texto DISTINTO ("${m.livenessTerm}"${m.livenessTyped ? '' : ', que el campo ni aceptó'}): el campo está inerte y la ausencia no acredita distinctUntilChanged.`
    };
  }
  return {
    status: 'PASS',
    detail: `Reescribir el mismo texto no generó ningún request nuevo, y el campo seguía vivo: un texto distinto sí disparó ${m.livenessCalls} request(s).`
  };
}

export async function runDistinctUntilChangedProbe(
  target: AddressFieldTarget,
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const wait = opts.settleMs ?? DEFAULT_SETTLE_MS;

  await resetField(driver, selector);
  await typeText(driver, selector, term);
  await settle(wait);
  const callsFirstRound = (await autocompleteCalls(driver)).length;

  await clearCapture(driver);
  const retyped = await typeText(driver, selector, term);
  await settle(wait);
  const repeated = await autocompleteCalls(driver);

  await clearCapture(driver);
  const livenessTerm = `${term} 2`;
  const livenessTyped = await typeText(driver, selector, livenessTerm);
  await settle(wait);
  const livenessCalls = (await autocompleteCalls(driver)).length;

  const measurements: DistinctMeasurements = {
    term,
    callsFirstRound,
    retyped,
    callsOnRepeat: repeated.length,
    livenessTerm,
    livenessTyped,
    livenessCalls
  };
  return toResult(
    { behavior: 'B4', title: 'distinctUntilChanged' },
    evaluateDistinctUntilChanged(measurements),
    {
      ...measurements,
      repeatedAddresses: repeated.map((c) => queryParam(String(c.url), 'address'))
    }
  );
}
