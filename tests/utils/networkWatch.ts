// tests/utils/networkWatch.ts
// Observa el trafico de lugares de una pagina para aserciones del tipo «no hubo llamadas a Google»
// (TM-1733, TM-1838). Solo registra; no emite requests ni mockea. Uso:
//   const watch = watchPlacesTraffic(page);
//   const mark = watch.mark();  // …accion bajo prueba…
//   expect(watch.since(mark)).toEqual([]);
import type { Page, Request } from '@playwright/test';

/**
 * Criterio FALLA CERRADO. Es llamada vigilada:
 *  1. el `places/getPlace` del backend (unica via real de resolucion de lugar de la app), y
 *  2. TODO request a un host de Google (`*.googleapis.com`, `maps.google.com`) que NO este en la lista corta
 *     de trafico benigno MEDIDO del mapa (carga del script, teselas, telemetria, rutas, fuentes). Un endpoint
 *     nuevo de Google (Places, Geocoding, Address Validation, …) sale rojo y obliga a clasificarlo.
 * Medido en TEST v2.0.22 (19/11/2026): el mapa de Nuevo Viaje emite solo lo de BENIGN_GOOGLE tras cada seleccion.
 * Limite: solo ve requests de la pagina (no de service workers ni del backend hacia Google).
 */
const GOOGLE_HOST = /^https?:\/\/([a-z0-9-]+\.)*(googleapis\.com|maps\.google\.com)(\/|$)/i;
const GET_PLACE = /\/places\/getPlace\b/i;
const BENIGN_GOOGLE = [
  /maps\.googleapis\.com\/maps\/api\/js\?/i, // loader del script del mapa
  /maps\.googleapis\.com\/maps-api-v3\/api\/js\//i, // chunks de la libreria (places_impl.js es la libreria, no una llamada)
  /maps\.googleapis\.com\/maps\/vt/i, // teselas
  /maps\.googleapis\.com\/maps\/api\/mapsjs\//i, // gen_204 y telemetria del script
  /MapsJsInternalService\/GetViewportInfo/i,
  /QuotaService\.RecordEvent/i,
  /AuthenticationService\.Authenticate/i,
  /DirectionsService\.Route/i, // ruta dibujada tras cotizar
  /fonts\.googleapis\.com/i
];

export type PlacesTrafficWatch = {
  /** Posicion actual del registro; pasarla a `since`. */
  mark(): number;
  /** `METHOD url-sin-query` de lo observado desde la marca. */
  since(mark: number): string[];
  /** URL completa (con query, sin claves ni tokens de sesion) de lo observado desde la marca. */
  sinceUrls(mark: number): string[];
  /** Deja de escuchar. */
  dispose(): void;
};

export function isWatchedPlacesUrl(url: string): boolean {
  if (GET_PLACE.test(url)) return true;
  return GOOGLE_HOST.test(url) && !BENIGN_GOOGLE.some((pattern) => pattern.test(url));
}

/** URL con los valores de `key`, `sessionToken` y `token` tachados (para registrar el resto de la query). */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|sessionToken|token)=)[^&]*/gi, '$1REDACTADO');
}

/** Forma registrable de un request: sin query (puede traer claves o tokens de sesion). */
export function describeRequest(method: string, url: string): string {
  return `${method} ${url.split('?')[0]}`;
}

export function watchPlacesTraffic(page: Page): PlacesTrafficWatch {
  const seen: string[] = [];
  const seenUrls: string[] = [];
  const onRequest = (request: Request): void => {
    if (isWatchedPlacesUrl(request.url())) {
      seen.push(describeRequest(request.method(), request.url()));
      seenUrls.push(redactUrl(request.url()));
    }
  };
  page.on('request', onRequest);
  return {
    mark: () => seen.length,
    since: (mark) => seen.slice(mark),
    sinceUrls: (mark) => seenUrls.slice(mark),
    dispose: () => {
      page.off('request', onRequest);
    }
  };
}

/**
 * Separa el `places/getPlace?placeId=MGWP-…` del backend de un punto PROPIO (el FE lo resuelve al cotizar; no
 * es Google) del resto de las llamadas vigiladas. Compara el parametro `placeId` COMPLETO (no por prefijo:
 * `MGWP-84-1` no debe coincidir con `MGWP-84-10`). Agregado por PK-5.
 */
export function splitOwnGetPlace(
  urls: string[],
  ownPlaceIds: string[]
): { own: string[]; other: string[] } {
  const isOwn = (url: string): boolean => {
    if (!GET_PLACE.test(url)) return false;
    try {
      return ownPlaceIds.includes(new URL(url).searchParams.get('placeId') ?? '');
    } catch {
      return false;
    }
  };
  const own = urls.filter(isOwn);
  return { own, other: urls.filter((u) => !isOwn(u)) };
}
