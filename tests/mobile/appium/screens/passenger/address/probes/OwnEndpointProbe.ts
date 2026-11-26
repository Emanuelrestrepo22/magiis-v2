/**
 * B1 — el campo consulta el endpoint propio (`places/autocomplete`) y NO a Google. Traza: TM-674 (+ TM-675 con
 * `evaluateRequestParams`).
 *
 * Oráculo: MG-116 CA-27 («reemplaza a google.maps.places.AutocompleteService»). Develop:
 * `GooglePlacesService.runGoogleAutocomplete` -> `TravelService.getMagiisAutocomplete` -> `GET places/autocomplete`.
 *
 * PARTIDA DOBLE: la captura de fetch/XHR Y la actividad del SDK de Places (`readWebViewGoogleActivity`), porque el
 * SDK de Google usa su propio transporte y la captura de red no lo ve. A diferencia de V1 (que registraba la
 * actividad pero NO la usaba en el veredicto), acá es parte de la decisión: sin lectura confiable del SDK no hay
 * PASS (SIN_DATOS), y un recurso de Google nuevo durante la medición es FAIL.
 */

import {
  settle,
  autocompleteCalls,
  googleActivity,
  googleCalls,
  resetField
} from './autocompleteCapture.js';
import { typeText } from './fieldOps.js';
import { DEFAULT_SETTLE_MS, hasQueryParam, toResult } from './measure.js';
import type { Evaluation, AddressFieldTarget, ProbeResult } from './types.js';

export type OwnEndpointMeasurements = {
  term: string;
  autocompleteUrls: readonly string[];
  googleUrls: readonly string[];
  /** `null` = la lectura del SDK no estuvo disponible (`available:false` o con errores de sonda). */
  googleSdkResourcesDelta: number | null;
};

export function evaluateOwnEndpoint(m: OwnEndpointMeasurements): Evaluation {
  const own = m.autocompleteUrls.length;
  const google = m.googleUrls.length;
  if (own === 0 && google === 0 && !m.googleSdkResourcesDelta) {
    return {
      status: 'SIN_DATOS',
      detail: `Cero requests de cualquier tipo con el término "${m.term}". La conducta no se ejerció: revisar que el campo esté realmente enfocado antes de concluir algo.`
    };
  }
  if (google > 0) {
    return {
      status: 'FAIL',
      detail: `${google} request(s) a Google desde esta superficie${own ? ` (y ${own} al endpoint propio)` : ' y NINGUNO al endpoint propio'}. La migración no alcanzó a este campo.`
    };
  }
  if (m.googleSdkResourcesDelta !== null && m.googleSdkResourcesDelta > 0) {
    return {
      status: 'FAIL',
      detail: `El SDK de Places cargó ${m.googleSdkResourcesDelta} recurso(s) de Google durante la medición sin pasar por fetch/XHR${own ? ` (y ${own} request(s) al endpoint propio)` : ''}.`
    };
  }
  // Aquí own > 0 (con own = 0 y google = 0 ya salió SIN_DATOS, o FAIL si el SDK cargó recursos).
  if (m.googleSdkResourcesDelta === null) {
    return {
      status: 'SIN_DATOS',
      detail: `${own} request(s) al endpoint propio y cero a Google por fetch/XHR, pero la lectura de actividad del SDK de Places no estuvo disponible: no se puede descartar un fallback por otro transporte.`
    };
  }
  return {
    status: 'PASS',
    detail: `${own} request(s) a places/autocomplete y cero a Google, confirmado también fuera de banda por la actividad del SDK.`
  };
}

/**
 * TM-675 — el request lleva el término (`address`) y el sesgo de ubicación (`latitude` + `longitude`).
 *
 * Develop: el sesgo sale del dispositivo; si no hay permiso/GPS, del carrier; si tampoco hay coordenadas del
 * carrier NO se envía (`resolveAutocompleteBias`). Por eso la ausencia del sesgo depende del ENTORNO: se mide y se
 * reporta, y el spec decide si el dato de entorno permite afirmarlo. El oráculo (AC) sigue exigiendo el sesgo.
 */
export function evaluateRequestParams(urls: readonly string[]): Evaluation {
  if (urls.length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: 'Sin URLs capturadas no se puede verificar qué parámetros viajan.'
    };
  }
  const url = urls[0] as string;
  const missing = ['address', 'latitude', 'longitude'].filter((p) => !hasQueryParam(url, p));
  if (missing.length > 0) {
    return {
      status: 'FAIL',
      detail: `El request no lleva ${missing.join(', ')} — URL medida: ${url}`
    };
  }
  return {
    status: 'PASS',
    detail: `El request lleva address, latitude y longitude — URL medida: ${url}`
  };
}

export async function runOwnEndpointProbe(
  target: AddressFieldTarget,
  opts: { term?: string; settleMs?: number } = {}
): Promise<ProbeResult> {
  const { driver } = target;
  const selector = target.fieldSelector();
  const term = opts.term ?? 'libertad 479';
  const meta = { behavior: 'B1', title: 'Consulta el endpoint propio y no a Google' } as const;

  await resetField(driver, selector);
  const activityBefore = await googleActivity(driver);
  await typeText(driver, selector, term);
  await settle(opts.settleMs ?? DEFAULT_SETTLE_MS);

  const own = await autocompleteCalls(driver);
  const google = await googleCalls(driver);
  const activityAfter = await googleActivity(driver);

  const reliable = (a: typeof activityBefore): boolean =>
    !!a && a.available && a.probeErrors.length === 0;
  const googleSdkResourcesDelta =
    reliable(activityBefore) && reliable(activityAfter)
      ? Math.max(
          0,
          (activityAfter?.resourceEntries.length ?? 0) -
            (activityBefore?.resourceEntries.length ?? 0)
        )
      : null;

  const measurements: OwnEndpointMeasurements = {
    term,
    autocompleteUrls: own.map((c) => String(c.url)),
    googleUrls: google.map((c) => String(c.url)),
    googleSdkResourcesDelta
  };
  return toResult(meta, evaluateOwnEndpoint(measurements), {
    ...measurements,
    requestParams: evaluateRequestParams(measurements.autocompleteUrls),
    sdkPresent: activityAfter?.sdkPresent ?? null,
    sdkProbeErrors: activityAfter?.probeErrors ?? null
  });
}
