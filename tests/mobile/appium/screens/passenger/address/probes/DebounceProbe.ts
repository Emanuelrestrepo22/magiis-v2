/**
 * B2 — debounce ~300 ms. Traza: TM-678 (flujo de viaje) / TM-733 (Perfil › Mis Direcciones).
 *
 * Oráculo: MG-116 CA-04 («~300 ms tras la última tecla»). Develop NO es uniforme: el input de viaje del home usa
 * 300 ms, pero `components/travel-edit-input` y `address-edit-modal` usan 2500 ms y `addresses.page` 500 ms. El
 * oráculo se mantiene en 300 ms (con tolerancia de harness 900 ms): esos FAIL son legítimos y NO se ajustan.
 *
 * SE MIDE, no se asume: la ráfaga se agenda dentro de la página y cada pulsación queda sellada, de modo que el
 * intervalo real es un dato. Si ese intervalo alcanza la ventana de debounce, la medición no distingue producto de
 * harness y se declara NO_EJERCIDO.
 */

import { autocompleteCalls, resetField, settle } from './autocompleteCapture.js';
import { typeBurst } from './fieldOps.js';
import {
  DEBOUNCE_TARGET_MS,
  DEBOUNCE_TOLERANCE_MS,
  DEFAULT_SETTLE_MS,
  queryParam,
  toEpochMs,
  toResult
} from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type DebounceMeasurements = {
  term: string;
  /** Pulsaciones que se pidieron (`term.length - 2`: la ráfaga arranca en 3 caracteres). */
  expectedKeystrokes: number;
  sequenceCompleted: boolean;
  /** `Date.now()` de la página por pulsación, en orden. */
  keystrokeStamps: readonly number[];
  /** `startedAt` (epoch ms, mismo reloj) de TODAS las requests capturadas a `places/autocomplete`. */
  requestStarts: readonly (number | null)[];
  targetMs?: number;
  toleranceMs?: number;
};

export type DebounceDerived = {
  callsTotal: number;
  callsInBurst: number;
  callsBeforeBurst: number;
  minIntervalMs: number | null;
  maxIntervalMs: number | null;
  delayFromLastKeystrokeMs: number | null;
  delayFromFirstKeystrokeMs: number | null;
};

/** Cálculo puro de lo que sostiene el veredicto; también viaja en `measured` para auditoría. */
export function deriveDebounce(m: DebounceMeasurements): DebounceDerived {
  const stamps = m.keystrokeStamps;
  const burstStart = stamps.length ? (stamps[0] as number) : null;
  const lastStamp = stamps.length ? (stamps[stamps.length - 1] as number) : null;
  // El INICIO de la ráfaga es el ancla para separar tráfico propio de heredado: contra el último sello no se puede,
  // porque sin debounce la primera request sale junto a la primera tecla (antes del último sello).
  const starts = m.requestStarts.filter((s): s is number => s !== null).sort((a, b) => a - b);
  const inBurst = burstStart === null ? starts : starts.filter((s) => s >= burstStart);
  const first = inBurst.length ? (inBurst[0] as number) : null;
  const intervals: number[] = [];
  for (let i = 1; i < stamps.length; i++)
    intervals.push((stamps[i] as number) - (stamps[i - 1] as number));
  return {
    callsTotal: m.requestStarts.length,
    callsInBurst: inBurst.length,
    callsBeforeBurst: starts.length - inBurst.length,
    minIntervalMs: intervals.length ? Math.min(...intervals) : null,
    maxIntervalMs: intervals.length ? Math.max(...intervals) : null,
    delayFromLastKeystrokeMs: lastStamp !== null && first !== null ? first - lastStamp : null,
    delayFromFirstKeystrokeMs: burstStart !== null && first !== null ? first - burstStart : null
  };
}

export function evaluateDebounce(m: DebounceMeasurements): Evaluation {
  const target = m.targetMs ?? DEBOUNCE_TARGET_MS;
  const tolerance = m.toleranceMs ?? DEBOUNCE_TOLERANCE_MS;
  const d = deriveDebounce(m);
  const n = m.keystrokeStamps.length;

  if (!m.sequenceCompleted || n < m.expectedKeystrokes) {
    return {
      status: 'NO_EJERCIDO',
      detail: `La secuencia no se completó: se sellaron ${n} de ${m.expectedKeystrokes} pulsaciones. Sin la ráfaga completa no hay agrupamiento que evaluar.`
    };
  }
  // GUARD DE PREMISA: a una cadencia >= ventana cada tecla es su propia ráfaga y varios requests son lo ESPERADO.
  if (d.maxIntervalMs !== null && d.maxIntervalMs >= target) {
    return {
      status: 'NO_EJERCIDO',
      detail: `El intervalo real entre pulsaciones llegó a ${d.maxIntervalMs} ms, igual o mayor que la ventana de ~${target} ms del AC: a esa cadencia cada tecla es su propia ráfaga y varios requests serían lo ESPERADO. La medición no distingue producto de harness.`
    };
  }
  if (m.requestStarts.some((s) => s === null)) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'Al menos un request capturado no trae el sello temporal: no se puede atribuir a la ráfaga ni medir la latencia.'
    };
  }
  if (d.callsInBurst === 0) {
    return {
      status: 'SIN_DATOS',
      detail: `Cero requests atribuibles a la ráfaga${d.callsBeforeBurst ? ` (se descartaron ${d.callsBeforeBurst} anteriores a la primera pulsación)` : ''}: no hay debounce que medir. La conducta no se ejerció.`
    };
  }
  // EL CONTEO VA ANTES que el guard de negatividad: sin debounce, `delayFromLastKeystroke` es negativo por
  // construcción, y con el guard primero este FAIL sería inalcanzable.
  if (d.callsInBurst > 1) {
    return {
      status: 'FAIL',
      detail: `${n} pulsaciones con intervalo real de ${d.minIntervalMs}-${d.maxIntervalMs} ms (bajo la ventana de ~${target} ms) generaron ${d.callsInBurst} requests dentro de la ráfaga. No agrupa: el debounce no opera en esta superficie.`
    };
  }
  if (d.delayFromLastKeystrokeMs === null) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        '1 request en la ráfaga, pero la captura no trae el sello temporal necesario para medir la latencia.'
    };
  }
  if (d.delayFromLastKeystrokeMs < 0) {
    return {
      status: 'NO_EJERCIDO',
      detail: `1 request en la ráfaga, pero salió ${Math.abs(d.delayFromLastKeystrokeMs)} ms antes de la última pulsación (${d.delayFromFirstKeystrokeMs} ms después de la primera): disparo en el borde de entrada, no un agrupamiento medible.`
    };
  }
  if (d.delayFromLastKeystrokeMs > tolerance) {
    return {
      status: 'FAIL',
      detail: `Agrupa en 1 request, pero la ventana medida es de ${d.delayFromLastKeystrokeMs} ms contra los ~${target} ms del AC. La demora es perceptible para el usuario.`
    };
  }
  return {
    status: 'PASS',
    detail: `1 request para ${n} pulsaciones con intervalo real de ${d.minIntervalMs}-${d.maxIntervalMs} ms, disparado ${d.delayFromLastKeystrokeMs} ms después de la última tecla.`
  };
}

export async function runDebounceProbe(
  target: AddressFieldTarget,
  opts: { term?: string; keyGapMs?: number; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const keyGapMs = opts.keyGapMs ?? 80;

  await resetField(driver, selector);
  const burst = await typeBurst(driver, selector, term, 3, keyGapMs);
  await settle(opts.settleMs ?? DEFAULT_SETTLE_MS);
  const calls = await autocompleteCalls(driver);

  const measurements: DebounceMeasurements = {
    term,
    expectedKeystrokes: term.length - 2,
    sequenceCompleted: burst.started && burst.completed,
    keystrokeStamps: burst.stamps,
    requestStarts: calls.map((c) => toEpochMs(c.startedAt))
  };
  return toResult(
    { behavior: 'B2', title: `Debounce ~${DEBOUNCE_TARGET_MS} ms` },
    evaluateDebounce(measurements),
    {
      ...measurements,
      keyGapMs,
      ...deriveDebounce(measurements),
      addresses: calls.map((c) => queryParam(String(c.url), 'address')),
      acTargetMs: DEBOUNCE_TARGET_MS,
      note: 'Ráfaga con eventos input sintéticos: confirmar un FAIL con tipeo real antes de reportarlo.'
    }
  );
}
