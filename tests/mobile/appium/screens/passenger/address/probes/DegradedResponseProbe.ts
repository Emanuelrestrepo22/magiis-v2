/**
 * B8 — el campo SOBREVIVE a un 5xx / timeout del endpoint. Traza: TM-689.
 *
 * NIVEL: MECANISMO. La falla se inyecta con `WebViewFaultInjection` (el hook de fetch/XHR dentro del WebView
 * responde un 503 sintético o deja la request colgada); no es un backend real fallando. Un FAIL acá es evidencia de
 * que el componente no maneja el error, pero NO es reportable como bug sin reproducirlo con la UI real (backend
 * real devolviendo 5xx / red lenta real). Por eso `level: 'mechanism'` y `reportableAsBug: false` en el resultado.
 *
 * Oráculo: lo que se asierta NO es que el usuario vea un cartel (hueco de definición abierto) sino que el CAMPO SIGUE
 * VIVO: se puede seguir escribiendo y una consulta posterior vuelve a salir. Develop: `runGoogleAutocomplete(...)
 * .catch(() => resetPlacesCollection(item))` — la suscripción RxJS no se rompe porque el error se atrapa en la
 * promesa.
 *
 * Mejoras sobre V1: (1) PRUEBA DE VIDA previa a la falla (sin ella, «el campo no aceptó texto» no distingue campo
 * muerto de degradación) y (2) se exige evidencia de que la regla DISPARÓ (`hits > 0`); sin eso el PASS no dice nada
 * de la degradación.
 */

import {
  clearWebViewFaultInjection,
  installWebViewFaultInjection,
  readWebViewFaultInjectionState
} from '../../../../core/WebViewFaultInjection.js';
import { autocompleteCalls, clearCapture, resetField, settle } from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { AUTOCOMPLETE_PATH, DEFAULT_SETTLE_MS, toResult } from './measure.js';
import type { AddressFieldTarget, Evaluation, ProbeResult } from './types.js';

export type DegradedMode = 'status' | 'timeout';

export type DegradedMeasurements = {
  mode: DegradedMode;
  term: string;
  /** El campo aceptó texto ANTES de instalar la falla (prueba de vida). */
  typedBaseline: boolean;
  typedUnderFault: boolean;
  /** Veces que la regla de falla disparó; `null` = no se pudo leer el estado de la inyección. */
  faultHits: number | null;
  typedAfter: boolean;
  recoveryCalls: number;
};

export function evaluateDegradedResponse(m: DegradedMeasurements): Evaluation {
  const what = m.mode === 'status' ? 'un 503' : 'un timeout';
  if (!m.typedBaseline) {
    return {
      status: 'SIN_DATOS',
      detail:
        'El campo no aceptó texto ni siquiera antes de la falla: la degradación no se ejerció (límite del harness).'
    };
  }
  if (!m.typedUnderFault) {
    return {
      status: 'FAIL',
      detail: `El campo aceptaba texto antes de la falla pero NO lo aceptó bajo ${what}. El usuario queda sin poder escribir su dirección.`
    };
  }
  if (m.faultHits === null) {
    return {
      status: 'SIN_DATOS',
      detail:
        'No se pudo leer el estado de la inyección de fallas: no hay evidencia de que la falla se aplicara.'
    };
  }
  if (m.faultHits === 0) {
    return {
      status: 'NO_EJERCIDO',
      detail: `La regla de falla (${what}) no disparó ninguna vez: ningún request al endpoint pasó por ella, así que la degradación no se ejerció.`
    };
  }
  if (!m.typedAfter) {
    return {
      status: 'FAIL',
      detail: `Tras ${what} el campo DEJÓ de aceptar texto. El usuario queda sin poder completar la dirección y tiene que reiniciar el alta.`
    };
  }
  if (m.recoveryCalls === 0) {
    return {
      status: 'FAIL',
      detail: `El campo acepta texto pero YA NO CONSULTA después de ${what}: la suscripción quedó rota. Se puede escribir, pero no aparece ninguna predicción nunca más.`
    };
  }
  return {
    status: 'PASS',
    detail: `El campo sobrevive: tras ${what} (regla disparada ${m.faultHits} vez/veces) sigue aceptando texto y vuelve a consultar (${m.recoveryCalls} request).`
  };
}

export async function runDegradedResponseProbe(
  target: AddressFieldTarget,
  mode: DegradedMode = 'status',
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const wait = opts.settleMs ?? DEFAULT_SETTLE_MS;
  const meta = {
    behavior: 'B8',
    variant: mode,
    title: `Degradación ante ${mode === 'status' ? 'un 5xx' : 'un timeout'}`,
    level: 'mechanism'
  } as const;

  try {
    // Prueba de vida SIN falla: el campo acepta texto en esta pantalla.
    await resetField(driver, selector);
    const typedBaseline = await typeText(driver, selector, term);
    await settle(wait);
    await clearCapture(driver);

    await installWebViewFaultInjection(driver, [
      {
        id: `mg116-${mode}`,
        urlPattern: AUTOCOMPLETE_PATH,
        mode,
        ...(mode === 'status' ? { status: 503 } : { delayMs: 8000 })
      }
    ]);
    await resetField(driver, selector);
    const typedUnderFault = await typeText(driver, selector, `${term} x`);
    await settle(mode === 'timeout' ? wait + 4000 : wait);
    const state = await readWebViewFaultInjectionState(driver);
    const faultHits = state.installed ? state.totalHits : null;

    // La falla se levanta ANTES de la sonda de recuperación: si no, la segunda consulta caería en la regla y no se
    // distinguiría «el campo murió» de «sigue fallando».
    await clearWebViewFaultInjection(driver);
    await clearCapture(driver);
    await resetField(driver, selector);
    const typedAfter = await typeText(driver, selector, `${term} 2`);
    await settle(wait);
    const recoveryCalls = (await autocompleteCalls(driver)).length;

    const measurements: DegradedMeasurements = {
      mode,
      term,
      typedBaseline,
      typedUnderFault,
      faultHits,
      typedAfter,
      recoveryCalls
    };
    return toResult(meta, evaluateDegradedResponse(measurements), {
      ...measurements,
      note: 'Falla inyectada por JS (mecanismo): un FAIL requiere repro con backend real antes de reportarse como bug.'
    });
  } finally {
    // Que la regla no sobreviva al chequeo: una falla colgada envenena las superficies siguientes.
    await clearWebViewFaultInjection(driver).catch(() => undefined);
  }
}
