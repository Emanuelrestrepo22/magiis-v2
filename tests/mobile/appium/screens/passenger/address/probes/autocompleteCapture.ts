/**
 * autocompleteCapture — lectura de lo que la captura de red de V2 (`core/WebViewNetworkCapture`) vio del
 * autocompletado. Adaptador delgado: filtra por endpoint, reinicia entre mediciones y espera la ventana de ausencia.
 *
 * Mapeo V1 -> V2 (ver docs P-41): `readWebViewNetworkCapture`, `clearWebViewNetworkCapture`,
 * `installWebViewNetworkCapture`, `readWebViewGoogleActivity`, `installWebViewFaultInjection` y
 * `clearWebViewFaultInjection` existen en V2 con la misma firma `(driver, …)`. Diferencia a tener en cuenta:
 * `readWebViewGoogleActivity` de V2 devuelve `resourceEntries[].startTime` RELATIVO a `timeOrigin` (V1 calculaba un
 * epoch propio que nunca usaba en un veredicto), así que acá solo se usa el CONTEO antes/después.
 */

import type { Browser } from 'webdriverio';
import {
  clearWebViewNetworkCapture,
  installWebViewNetworkCapture,
  readWebViewNetworkCapture
} from '../../../../core/WebViewNetworkCapture.js';
import { readWebViewGoogleActivity } from '../../../../core/WebViewGoogleActivity.js';
import type { WebViewGoogleActivity } from '../../../../core/WebViewNetworkCaptureTypes.js';
import { sleep } from '../../../../core/Waits.js';
import { isAutocompleteUrl, isGoogleUrl, type CapturedCall } from './measure.js';
import { clearField } from './fieldOps.js';

export async function installCapture(driver: Browser): Promise<void> {
  await installWebViewNetworkCapture(driver);
}

export async function clearCapture(driver: Browser): Promise<void> {
  await clearWebViewNetworkCapture(driver);
}

/** Requests al endpoint propio `places/autocomplete` capturados hasta ahora. */
export async function autocompleteCalls(driver: Browser): Promise<CapturedCall[]> {
  const dump = await readWebViewNetworkCapture(driver);
  return dump.entries.filter((e) => isAutocompleteUrl(e.url));
}

/** Requests (fetch/XHR) a hosts de Google capturados hasta ahora. */
export async function googleCalls(driver: Browser): Promise<CapturedCall[]> {
  const dump = await readWebViewNetworkCapture(driver);
  return dump.entries.filter((e) => isGoogleUrl(e.url));
}

/** Actividad de Google fuera de fetch/XHR (SDK de Places por su propio transporte). */
export async function googleActivity(driver: Browser): Promise<WebViewGoogleActivity | null> {
  return readWebViewGoogleActivity(driver).catch(() => null);
}

/**
 * Espera `ms` para dejar pasar la ventana en la que un request EXISTIRÍA. Es una espera por tiempo a propósito: las
 * conductas B3/B4/B6 se deciden por AUSENCIA de requests y no hay condición observable que anuncie «no va a salir
 * nada». El valor por defecto cubre el debounce más lento de develop (2500 ms) más la latencia del endpoint.
 */
export async function settle(ms: number): Promise<void> {
  await sleep(ms);
}

/** Deja el campo vacío y la captura en cero: cada medición parte de cero. */
export async function resetField(driver: Browser, selector: string): Promise<void> {
  await clearField(driver, selector);
  await clearCapture(driver);
}
