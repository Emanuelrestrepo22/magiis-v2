/**
 * B9 — el campo sigue USABLE sin conexión y recupera las predicciones al volver la red. Traza: TM-697.
 *
 * NIVEL: MECANISMO. La caída de red se simula con `WebViewFaultInjection` (`networkError`: la request rechaza con un
 * TypeError, como un fetch real sin red), solo sobre el endpoint de autocompletado; el resto de la red sigue viva.
 * Un FAIL NO es reportable como bug sin repro con la UI real (modo avión / corte de red real). Por eso
 * `level: 'mechanism'` y `reportableAsBug: false`.
 *
 * Distinto del 5xx de B8: ahí hay respuesta, acá no hay ninguna. Se asierta que el usuario puede seguir escribiendo
 * y que, al volver la red, las predicciones vuelven solas (sin reiniciar el alta).
 *
 * Mismas mejoras que B8 sobre V1: prueba de vida previa (el FAIL «no acepta texto sin red» sale de V1 sin saber si
 * el campo aceptaba texto antes) y evidencia de que la regla disparó.
 */

import {
  clearWebViewFaultInjection,
  installWebViewFaultInjection,
  readWebViewFaultInjectionState
} from '../../../../core/WebViewFaultInjection.js';
import { autocompleteCalls, clearCapture, resetField, settle } from './autocompleteCapture.js';
import { isEditable, typeText } from './fieldOps.js';
import { AUTOCOMPLETE_PATH, DEFAULT_SETTLE_MS, toResult } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type OfflineMeasurements = {
  term: string;
  /** El campo aceptó texto ANTES de instalar la falla (prueba de vida). */
  typedBaseline: boolean;
  typedOffline: boolean;
  stillEditable: boolean;
  /** Veces que la regla `networkError` disparó; `null` = estado de la inyección ilegible. */
  faultHits: number | null;
  callsAfterRecovery: number;
};

export function evaluateOfflineUsable(m: OfflineMeasurements): Evaluation {
  if (!m.typedBaseline) {
    return {
      status: 'SIN_DATOS',
      detail:
        'El campo no aceptó texto ni siquiera antes de la falla: la conducta sin conexión no se ejerció (límite del harness).'
    };
  }
  if (!m.typedOffline) {
    return {
      status: 'FAIL',
      detail:
        'Con la red caída el campo NO aceptó texto (sí lo aceptaba antes). El usuario no puede ni escribir su dirección mientras espera que vuelva la conexión.'
    };
  }
  if (m.faultHits === null) {
    return {
      status: 'SIN_DATOS',
      detail:
        'No se pudo leer el estado de la inyección de fallas: no hay evidencia de que la caída se aplicara.'
    };
  }
  if (m.faultHits === 0) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'La regla networkError no disparó ninguna vez: ningún request al endpoint pasó por ella, así que la caída de red no se ejerció.'
    };
  }
  if (!m.stillEditable) {
    return {
      status: 'FAIL',
      detail: 'El campo quedó bloqueado (readonly o deshabilitado) tras la caída de red.'
    };
  }
  if (m.callsAfterRecovery === 0) {
    return {
      status: 'FAIL',
      detail:
        'El campo sigue editable pero no volvió a consultar cuando la red se restableció: hay que reiniciar el alta para recuperar las predicciones.'
    };
  }
  return {
    status: 'PASS',
    detail: `El campo acepta texto con la red caída (regla disparada ${m.faultHits} vez/veces) y vuelve a consultar al restablecerse (${m.callsAfterRecovery} request).`
  };
}

export async function runOfflineProbe(
  target: AddressFieldTarget,
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const wait = opts.settleMs ?? DEFAULT_SETTLE_MS;
  const meta = {
    behavior: 'B9',
    title: 'El campo sigue usable sin conexión',
    level: 'mechanism'
  } as const;

  try {
    await resetField(driver, selector);
    const typedBaseline = await typeText(driver, selector, term);
    await settle(wait);
    await clearCapture(driver);

    await installWebViewFaultInjection(driver, [
      { id: 'mg116-offline', urlPattern: AUTOCOMPLETE_PATH, mode: 'networkError' }
    ]);
    await resetField(driver, selector);
    const typedOffline = await typeText(driver, selector, `${term} x`);
    await settle(wait);
    const stillEditable = await isEditable(driver, selector);
    const state = await readWebViewFaultInjectionState(driver);
    const faultHits = state.installed ? state.totalHits : null;

    await clearWebViewFaultInjection(driver);
    await clearCapture(driver);
    await resetField(driver, selector);
    await typeText(driver, selector, `${term} 2`);
    await settle(wait);
    const callsAfterRecovery = (await autocompleteCalls(driver)).length;

    const measurements: OfflineMeasurements = {
      term,
      typedBaseline,
      typedOffline,
      stillEditable,
      faultHits,
      callsAfterRecovery
    };
    return toResult(meta, evaluateOfflineUsable(measurements), {
      ...measurements,
      note: 'Caída simulada por JS (mecanismo): un FAIL requiere repro con la red real caída antes de reportarse como bug.'
    });
  } finally {
    await clearWebViewFaultInjection(driver).catch(() => undefined);
  }
}
