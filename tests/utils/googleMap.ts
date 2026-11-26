// tests/utils/googleMap.ts
// Click robusto sobre el mapa de Google de Nuevo Viaje (puntero «Select on Map» / «Seleccionar en el
// mapa»; MG-1132 PK-3). El plan asumia Leaflet, pero MEDIDO en TEST (19/11/2026) el mapa de Nuevo Viaje
// es Google Maps (`.gm-style`); Leaflet es solo el de Configuracion › Puntos de referencia (ver
// tests/utils/leafletMap.ts). Mismo criterio: hook de solo observacion (registra las instancias en
// `window.__gmaps`), sin requests propios ni mocks.
//
// Uso:
//   await installGoogleMapHook(page);                 // ANTES de navegar
//   await page.goto(…);
//   const ack = await clickGoogleMapAndWaitForCheckPlace(page, mapRoot, { lat, lng });
//
// centerGoogleMapAt / clickGoogleMapAt: fija centro y zoom con `setOptions`, espera el evento `idle` (señal observable, sin
// esperas fijas), calcula el pixel con la proyeccion del mapa y el bbox del contenedor, y hace UN click.
// Un click, sin doble click ni click sobre un pin/control (F-25/F-26 de la ejecucion manual).
import type { Locator, Page } from '@playwright/test';
import type { CheckPlaceAck } from './leafletMap.js';
import type { CheckPlaceResult } from '../api/clients/places.client.js';

export type GoogleMapPoint = { lat: number; lng: number; zoom?: number };

const DEFAULT_ZOOM = 17;

/** Instala el hook ANTES de navegar: envuelve `google.maps.Map` con un Proxy que registra las instancias. */
export async function installGoogleMapHook(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    type GmLike = { Map?: unknown };
    const w = window as unknown as {
      __gmaps: unknown[];
      google?: { maps?: GmLike };
      __gmapsHooked?: boolean;
    };
    w.__gmaps = [];
    // Se espera a que el script de Google defina `google.maps.Map` y se envuelve una sola vez.
    const timer = setInterval(() => {
      const maps = w.google?.maps;
      if (!maps || !maps.Map || w.__gmapsHooked) return;
      maps.Map = new Proxy(maps.Map as object, {
        construct: (target, args, newTarget) => {
          const instance = Reflect.construct(
            target as new (...a: unknown[]) => object,
            args,
            newTarget
          );
          w.__gmaps.push(instance);
          return instance;
        }
      });
      w.__gmapsHooked = true;
      clearInterval(timer);
    }, 2);
  });
}

export type GoogleMapClickDiagnostics = { x: number; y: number; zoom: number };

/** Ack del click: respuesta de `checkPlace?waypoint=true` + lo que el servidor vio en el `getPlace` del click. */
export type GoogleClickAck = CheckPlaceAck & {
  clicked: { lat: number; lng: number; country: string };
};

/**
 * Centra el mapa en `p` y calcula el pixel de la coordenada, SIN hacer click. Espera el evento `idle`
 * (señal observable) solo si el mapa tiene que moverse; si el `idle` no llega en 8 s falla con su
 * propio mensaje (antes el vencimiento se tragaba y se consumia el presupuesto del ack).
 */
export async function centerGoogleMapAt(
  _page: Page,
  mapRoot: Locator,
  p: GoogleMapPoint
): Promise<GoogleMapClickDiagnostics> {
  const zoom = p.zoom ?? DEFAULT_ZOOM;
  await mapRoot.scrollIntoViewIfNeeded();
  const target = await mapRoot.evaluate(
    // El script corre en la pagina: sin funciones con nombre (ver tests/utils/leafletMap.ts).
    async (el, args) => {
      type GMap = {
        getDiv(): HTMLElement;
        setOptions(o: { center: { lat: number; lng: number }; zoom: number }): void;
        getZoom(): number;
        getCenter(): { lat(): number; lng(): number } | undefined;
        getBounds(): {
          getNorthEast(): { lat(): number; lng(): number };
          getSouthWest(): { lat(): number; lng(): number };
        } | null;
        getProjection(): {
          fromLatLngToPoint(l: unknown): { x: number; y: number };
        } | null;
        addListener(e: string, fn: () => void): { remove(): void };
      };
      const w = window as unknown as {
        __gmaps?: GMap[];
        google?: { maps: { LatLng: new (lat: number, lng: number) => unknown } };
      };
      const map = (w.__gmaps ?? []).find((m) => m.getDiv() === el || el.contains(m.getDiv()));
      if (!map || !w.google)
        return { error: 'no hay instancia google.maps.Map registrada para este mapa' };
      const gm = w.google.maps;
      const current = map.getCenter();
      const alreadyThere =
        !!current &&
        map.getZoom() === args.zoom &&
        Math.abs(current.lat() - args.lat) < 1e-7 &&
        Math.abs(current.lng() - args.lng) < 1e-7;
      if (!alreadyThere) {
        const idle = await new Promise<boolean>((resolve) => {
          const guard = setTimeout(() => resolve(false), 8000);
          const listener = map.addListener('idle', () => {
            listener.remove();
            clearTimeout(guard);
            resolve(true);
          });
          map.setOptions({ center: { lat: args.lat, lng: args.lng }, zoom: args.zoom });
        });
        if (!idle) return { error: 'el evento idle del mapa no llego en 8 s tras centrarlo' };
      }
      const projection = map.getProjection();
      const bounds = map.getBounds();
      if (!projection || !bounds || map.getZoom() !== args.zoom) {
        return {
          error: 'el mapa no quedo estable en el zoom pedido (sin proyeccion/limites tras idle)'
        };
      }
      const scale = Math.pow(2, args.zoom);
      const nw = projection.fromLatLngToPoint(
        new gm.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng())
      );
      const pt = projection.fromLatLngToPoint(new gm.LatLng(args.lat, args.lng));
      const rect = (map.getDiv() as HTMLElement).getBoundingClientRect();
      const x = rect.left + (pt.x - nw.x) * scale;
      const y = rect.top + (pt.y - nw.y) * scale;
      const top = document.elementFromPoint(x, y);
      if (!top || !el.contains(top))
        return { error: 'el pixel de la coordenada cae fuera del mapa' };
      return { x, y };
    },
    { lat: p.lat, lng: p.lng, zoom }
  );
  if ('error' in target) {
    const box = await mapRoot.boundingBox();
    throw new Error(
      `[googleMap] ${target.error} (lat=${p.lat}, lng=${p.lng}, zoom=${zoom}, bbox=${JSON.stringify(box)})`
    );
  }
  return { x: target.x, y: target.y, zoom };
}

/** Centra el mapa en `p` y hace UN click sobre esa coordenada. Falla con diagnostico, sin reintentos. */
export async function clickGoogleMapAt(
  page: Page,
  mapRoot: Locator,
  p: GoogleMapPoint
): Promise<GoogleMapClickDiagnostics> {
  const target = await centerGoogleMapAt(page, mapRoot, p);
  await page.mouse.click(target.x, target.y);
  return target;
}

/**
 * Click en el mapa y espera la cadena de red del puntero, con presupuesto propio por eslabon:
 * 1) centrar el mapa (idle) SIN esperas de red armadas; 2) `beforeClick` (estado previo al click, ej.
 * puntero armado); 3) recien ahi se arman `getPlace?latitude=` y `checkPlace?waypoint=true` (30 s cada
 * una) y se hace el click. Cada eslabon que falta falla con su propio mensaje. Un solo intento.
 */
export async function clickGoogleMapAndWaitForCheckPlace(
  page: Page,
  mapRoot: Locator,
  p: GoogleMapPoint,
  opts: { beforeClick?: () => Promise<void> } = {}
): Promise<GoogleClickAck> {
  const target = await centerGoogleMapAt(page, mapRoot, p);
  await opts.beforeClick?.();
  // Nada sale a la red antes del click: las esperas se arman aqui, con 30 s propios.
  const getPlace = page.waitForResponse((r) => /\/places\/getPlace\?latitude=/.test(r.url()), {
    timeout: 30_000
  });
  const check = page.waitForResponse(
    (r) => /\/places\/checkPlace\//i.test(r.url()) && /[?&]waypoint=true\b/.test(r.url()),
    { timeout: 30_000 }
  );
  getPlace.catch(() => undefined);
  check.catch(() => undefined);
  await page.mouse.click(target.x, target.y);
  const where = `(lat=${p.lat}, lng=${p.lng}, zoom=${target.zoom}, px=${Math.round(target.x)},${Math.round(target.y)})`;
  const place = await getPlace.catch(() => null);
  if (!place) {
    throw new Error(
      `[googleMap] el mapa no recibio el click ${where}: sin getPlace por coordenada en 30 s`
    );
  }
  const results = (await place.json().catch(() => [])) as Array<{
    place_id?: string;
    country?: string;
  }>;
  if (place.status() !== 200 || !results[0]?.place_id) {
    throw new Error(
      `[googleMap] getPlace sin resultado (HTTP ${place.status()}) ${where}: el front rechaza sin llamar a checkPlace`
    );
  }
  const response = await check.catch(() => null);
  if (!response) {
    throw new Error(
      `[googleMap] getPlace OK (${results[0].place_id}) pero checkPlace?waypoint=true no llego en 30 s ${where}`
    );
  }
  const url = new URL(place.url());
  return {
    url: `${response.url().split('?')[0]}?waypoint=true`,
    status: response.status(),
    body: (await response.json()) as CheckPlaceResult,
    clicked: {
      lat: Number(url.searchParams.get('latitude')),
      lng: Number(url.searchParams.get('longitude')),
      country: (results[0].country ?? '').trim()
    }
  };
}
