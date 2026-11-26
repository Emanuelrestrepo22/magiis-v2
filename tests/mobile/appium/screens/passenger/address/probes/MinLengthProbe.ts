/**
 * B3 — piso de caracteres desde el que el campo consulta. Traza: TM-680/TM-681 (flujo de viaje, piso 3) y TM-734
 * (Perfil › Mis Direcciones, piso 4).
 *
 * Oráculo: MG-116 fija 3 en los campos del alta de viaje (un código IATA mide 3). Perfil › Direcciones acordó 4 el
 * 2026-08-20 (formulario de guardado, no existe el caso «guardar un aeropuerto»). El piso es POR SUPERFICIE
 * (`expectedFloor`), no global. Develop: `travel-edit-input` (home) consulta con `length >= 3`; los demás componentes
 * usan `length > 3` (= 4). Coincide con el oráculo de cada superficie.
 *
 * BARRIDO (1, 2, 3, …) y no «2 vs 3»: si dos longitudes dan cero requests no se distingue «nunca consulta» de «el
 * piso está por encima de 3».
 */

import { autocompleteCalls, resetField, settle } from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { DEFAULT_SETTLE_MS, MIN_CHARS_TRIP_FLOW, toResult } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type MinLengthSample = {
  length: number;
  text: string;
  /** `-1` = el campo no aceptó el texto (no hay medición para esa longitud). */
  calls: number;
};

export type MinLengthMeasurements = {
  term: string;
  perLength: readonly MinLengthSample[];
  expectedFloor: number;
};

export function firstQueryLength(perLength: readonly MinLengthSample[]): number | null {
  return perLength.find((p) => p.calls > 0)?.length ?? null;
}

export function evaluateMinLength(m: MinLengthMeasurements): Evaluation {
  const floor = m.expectedFloor;
  const rejected = m.perLength.filter((p) => p.calls < 0);
  const first = firstQueryLength(m.perLength);

  if (m.perLength.length === 0 || rejected.length === m.perLength.length) {
    return {
      status: 'SIN_DATOS',
      detail:
        'El campo no aceptó texto en ninguna longitud: no hay piso que medir. Revisar el estado de la pantalla antes de concluir algo del producto.'
    };
  }
  if (first === null) {
    return {
      status: 'SIN_DATOS',
      detail: `Ninguna longitud de 1 a ${m.perLength.length} generó consulta. Sin un caso positivo no se distingue «respeta el piso» de «el campo no consulta nunca».`
    };
  }
  if (first < floor) {
    return {
      status: 'FAIL',
      detail: `La primera consulta sale con ${first} carácter(es), por debajo del piso de ${floor} acordado para esta superficie. Se pagan consultas que el contrato de la pantalla pide no hacer.`
    };
  }
  if (first > floor) {
    return {
      status: 'FAIL',
      detail: `La primera consulta recién sale con ${first} caracteres, por encima del piso de ${floor} acordado para esta superficie. Un término de ${floor} caracteres no dispara búsqueda acá.`
    };
  }
  // Para acreditar «con floor-1 no consulta» esa longitud tiene que haberse medido (y aceptado por el campo).
  const below = m.perLength.find((p) => p.length === floor - 1);
  if (floor > 1 && (!below || below.calls < 0)) {
    return {
      status: 'NO_EJERCIDO',
      detail: `La primera consulta sale con ${first}, pero la longitud ${floor - 1} no se pudo medir: no se acredita que por debajo del piso no consulta.`
    };
  }
  return {
    status: 'PASS',
    detail: `El piso medido es ${first}, el acordado para esta superficie: con ${floor - 1} caracteres no consulta y con ${floor} sí.`
  };
}

export async function runMinLengthProbe(
  target: AddressFieldTarget,
  opts: { term?: string; maxLen?: number; expectedFloor?: number; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad';
  const maxLen = opts.maxLen ?? 6;
  const expectedFloor = opts.expectedFloor ?? MIN_CHARS_TRIP_FLOW;
  const perLength: MinLengthSample[] = [];

  for (let len = 1; len <= Math.min(maxLen, term.length); len++) {
    await resetField(driver, selector);
    const text = term.slice(0, len);
    if (!(await typeText(driver, selector, text))) {
      perLength.push({ length: len, text, calls: -1 });
      continue;
    }
    await settle(opts.settleMs ?? DEFAULT_SETTLE_MS);
    perLength.push({ length: len, text, calls: (await autocompleteCalls(driver)).length });
  }

  const measurements: MinLengthMeasurements = { term, perLength, expectedFloor };
  return toResult(
    { behavior: 'B3', title: `minLength ${expectedFloor}` },
    evaluateMinLength(measurements),
    { ...measurements, firstQueryAtLength: firstQueryLength(perLength) }
  );
}
