// tests/utils/leafletMap.ts
// Click robusto sobre mapas Leaflet del portal (ABM de Puntos de referencia, puntero de Nuevo Viaje;
// MG-1132). Misma politica que tests/utils/leaflet.ts: un hook de solo observacion, aprobado por el
// owner, que registra las instancias `L.Map` en `window.__maps`; NO emite requests ni mockea.
//
// Uso:
//   await installMapHook(page);                       // ANTES de navegar
//   await page.goto(…);
//   const ack = await clickMapAndWaitForCheckPlace(page, mapRoot, { lat, lng });
//
// Como funciona clickMapAt: busca la instancia cuyo `getContainer()` es el mapRoot, centra el mapa en
// la coordenada con `setView` animado y espera el evento `moveend` (sin esperas fijas), calcula el pixel con
// `latLngToContainerPoint` y, si ahi hay un control o un pin, desplaza el mapa con `panBy` y recalcula.
// Limites medidos 17-18/11 (F-25/F-26): NUNCA click sobre un pin ni doble click; por eso el punto
// elegido esquiva `.leaflet-marker-icon`/`.leaflet-control`.
import type { Locator, Page } from '@playwright/test';
import type { CheckPlaceResult } from '../api/clients/places.client.js';

export type MapPoint = { lat: number; lng: number; zoom?: number };
export type MapClickDiagnostics = { x: number; y: number; zoom: number; attempts: number };

const DEFAULT_ZOOM = 17;
const MAX_PAN_ATTEMPTS = 4;

/**
 * Instala el hook ANTES de navegar: se inyecta en cada documento nuevo del contexto.
 * Medido en TEST (18-19/11/2026): el portal asigna `window.L` DESPUES de crear el primer mapa del ABM
 * (~8 s de carga), asi que `L.Map.addInitHook` solo ve mapas creados mas tarde. Por eso hay dos vias:
 * 1) `addInitHook` (mapas creados tras la carga de L); 2) envoltorio de `L.Map.prototype.fire`,
 * que registra el `L.Map` en el primer evento que dispare (zoom, move, click…), incluso si ya existia.
 */
export async function installMapHook(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    type LeafletLike = {
      Map?: {
        addInitHook?: (fn: (this: unknown) => void) => void;
        __mapHooked?: boolean;
        prototype: { fire: (...args: unknown[]) => unknown; __fireWrapped?: boolean };
      };
    };
    const w = window as unknown as { __maps: unknown[]; L?: LeafletLike };
    w.__maps = [];
    // OJO: sin funciones con nombre dentro de este script. tsx/esbuild agrega `__name(...)` a las
    // funciones con nombre y ese helper no existe en la pagina: el script moriria antes del setInterval.
    // `window.L` del portal no expone `Evented`: se envuelve `fire` sobre `L.Map.prototype` (hereda el de Evented).
    // Leaflet llega con el bundle del front: se espera a que `L` exista y se engancha una vez.
    const timer = setInterval(() => {
      const leaflet = w.L;
      const mapClass = leaflet?.Map;
      const proto = mapClass?.prototype;
      if (!leaflet || !mapClass || !proto) return;
      if (!mapClass.__mapHooked && typeof mapClass.addInitHook === 'function') {
        mapClass.addInitHook(function (this: unknown) {
          if (!w.__maps.includes(this)) w.__maps.push(this);
        });
        mapClass.__mapHooked = true;
      }
      if (!proto.__fireWrapped) {
        const originalFire = proto.fire;
        proto.fire = function (this: unknown, ...args: unknown[]) {
          if (!w.__maps.includes(this)) w.__maps.push(this);
          return originalFire.apply(this, args);
        };
        proto.__fireWrapped = true;
      }
      clearInterval(timer);
    }, 2);
  });
}

/** Pines (`.leaflet-marker-icon`) del mapa. */
export async function markerCount(mapRoot: Locator): Promise<number> {
  return mapRoot.locator('.leaflet-marker-icon').count();
}

/** Punto absoluto del viewport a partir del bbox del contenedor y el punto interno del contenedor. */
export function toViewportPoint(
  box: { x: number; y: number },
  p: { x: number; y: number }
): { x: number; y: number } {
  return { x: box.x + p.x, y: box.y + p.y };
}

/**
 * Si el mapa se creo antes de que existiera `window.L`, el primer evento que dispare lo registra: se
 * provoca con un click en el control «Zoom in» del propio mapa (accion inocua; la vista se fija despues).
 */
async function ensureMapRegistered(mapRoot: Locator): Promise<void> {
  const registered = await mapRoot.evaluate((el) => {
    const w = window as unknown as { __maps?: Array<{ getContainer(): HTMLElement }> };
    return (w.__maps ?? []).some((m) => m.getContainer() === el);
  });
  if (registered) return;
  await mapRoot.locator('.leaflet-control-zoom-in').click();
}

type MapTarget = { x: number; y: number; attempts: number } | { error: string };

/**
 * Centra el mapa en `p` y calcula un pixel libre (sin pines ni controles) SIN hacer click. Falla con
 * diagnostico (coordenada, zoom, bbox) si no encuentra el mapa o no hay un pixel libre.
 */
export async function locateMapPoint(
  _page: Page,
  mapRoot: Locator,
  p: MapPoint
): Promise<MapClickDiagnostics> {
  const zoom = p.zoom ?? DEFAULT_ZOOM;
  await mapRoot.scrollIntoViewIfNeeded();
  await ensureMapRegistered(mapRoot);
  const target: MapTarget = await mapRoot.evaluate(
    // Sin funciones con nombre aqui dentro (ver installMapHook): esbuild les agrega `__name`.
    async (el, args) => {
      type LMap = {
        getContainer(): HTMLElement;
        getCenter(): { lat: number; lng: number };
        getZoom(): number;
        invalidateSize?(): unknown;
        once(type: string, fn: () => void): unknown;
        setView(c: [number, number], z: number, o: { animate: boolean }): unknown;
        panBy(o: [number, number], opts: { animate: boolean }): unknown;
        latLngToContainerPoint(c: [number, number]): { x: number; y: number };
      };
      const w = window as unknown as { __maps?: LMap[] };
      const map = (w.__maps ?? []).find((m) => m.getContainer() === el);
      if (!map) return { error: 'no hay instancia L.Map registrada para este contenedor' };

      // Vista animada + espera de `moveend` (señal observable, tope de seguridad de 8 s). Medido en TEST
      // (19/11): `setView(…, {animate:false})` NO mueve el mapa del modal del ABM (la vista vuelve sola al
      // centro del carrier); la variante animada si converge.
      // (desestructurado a proposito: una arrow asignada a un const con nombre recibe `__name` bajo tsx)
      const [settle] = [
        (run: () => void): Promise<boolean> =>
          new Promise((resolve) => {
            const guard = setTimeout(() => resolve(false), 8000);
            map.once('moveend', () => {
              clearTimeout(guard);
              resolve(true);
            });
            run();
          })
      ];
      // Medido (19/11, rojo 1 de 3 corridas): el mapa del modal a veces vuelve solo al centro del carrier
      // tras el primer `setView`. Se recalcula el tamano y se converge con UN segundo `setView` (nunca
      // se hace click hasta que el centro coincide).
      if (typeof map.invalidateSize === 'function') map.invalidateSize();
      await settle(() => map.setView([args.lat, args.lng], args.zoom, { animate: true }));
      const first = map.getCenter();
      if (
        map.getZoom() !== args.zoom ||
        Math.abs(first.lat - args.lat) + Math.abs(first.lng - args.lng) > 1e-3
      ) {
        await settle(() => map.setView([args.lat, args.lng], args.zoom, { animate: true }));
      }
      const center = map.getCenter();
      const offCenter = Math.abs(center.lat - args.lat) + Math.abs(center.lng - args.lng);
      if (map.getZoom() !== args.zoom || offCenter > 1e-3) {
        return {
          error: `el mapa no quedo en la coordenada pedida (centro=${center.lat},${center.lng}, zoom=${map.getZoom()})`
        };
      }

      const shifts: Array<[number, number]> = [
        [0, 0],
        [60, 0],
        [-60, 0],
        [0, 60],
        [0, -60]
      ];
      let attempts = 0;
      for (const [dx, dy] of shifts.slice(0, args.maxAttempts + 1)) {
        attempts += 1;
        if (dx || dy) await settle(() => map.panBy([dx, dy], { animate: true }));
        const pt = map.latLngToContainerPoint([args.lat, args.lng]);
        const rect = el.getBoundingClientRect();
        const x = rect.left + pt.x;
        const y = rect.top + pt.y;
        const top = document.elementFromPoint(x, y);
        const blocked =
          !top ||
          !el.contains(top) ||
          !!top.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-popup');
        if (!blocked) return { x, y, attempts };
      }
      return {
        error: 'el pixel de la coordenada queda tapado por un control, un pin o fuera del mapa'
      };
    },
    { lat: p.lat, lng: p.lng, zoom, maxAttempts: MAX_PAN_ATTEMPTS }
  );
  if ('error' in target) {
    const box = await mapRoot.boundingBox();
    throw new Error(
      `[leafletMap] ${target.error} (lat=${p.lat}, lng=${p.lng}, zoom=${zoom}, bbox=${JSON.stringify(box)})`
    );
  }
  return { x: target.x, y: target.y, zoom, attempts: target.attempts };
}

/**
 * Centra el mapa en `p` y hace UN click sobre esa coordenada (sin doble click, sin click sobre pines o
 * controles). Falla con diagnostico; no reintenta a ciegas.
 */
export async function clickMapAt(
  page: Page,
  mapRoot: Locator,
  p: MapPoint
): Promise<MapClickDiagnostics> {
  const target = await locateMapPoint(page, mapRoot, p);
  await page.mouse.click(target.x, target.y);
  return target;
}

export type CheckPlaceAck = { url: string; status: number; body: CheckPlaceResult };
/** Ack del click: checkPlace + lo que el servidor vio en el `getPlace` del click (coordenada y pais). */
export type ClickedPlaceAck = CheckPlaceAck & {
  clicked: { lat: number; lng: number; country: string };
};

/**
 * Click en el mapa y espera la cadena de red del puntero con presupuesto propio por eslabon (30 s cada
 * uno): 1) centrar el mapa SIN esperas de red armadas; 2) armar `getPlace?latitude=` y
 * `checkPlace?waypoint=true`; 3) click. Cada eslabon que falta falla con su propio mensaje. Un solo
 * intento: no reintenta a ciegas.
 */
export async function clickMapAndWaitForCheckPlace(
  page: Page,
  mapRoot: Locator,
  p: MapPoint
): Promise<ClickedPlaceAck> {
  const diag = await locateMapPoint(page, mapRoot, p);
  const getPlace = page.waitForResponse((r) => /\/places\/getPlace\?latitude=/.test(r.url()), {
    timeout: 30_000
  });
  const check = page.waitForResponse(
    (r) => /\/places\/checkPlace\//i.test(r.url()) && /[?&]waypoint=true\b/.test(r.url()),
    { timeout: 30_000 }
  );
  getPlace.catch(() => undefined);
  check.catch(() => undefined);
  await page.mouse.click(diag.x, diag.y);
  const where = `(lat=${p.lat}, lng=${p.lng}, zoom=${diag.zoom}, px=${Math.round(diag.x)},${Math.round(diag.y)})`;
  const place = await getPlace.catch(() => null);
  if (!place) {
    throw new Error(
      `[leafletMap] el mapa no recibio el click ${where}: sin getPlace por coordenada en 30 s`
    );
  }
  const results = (await place.json().catch(() => [])) as Array<{
    place_id?: string;
    country?: string;
  }>;
  if (place.status() !== 200 || !results[0]?.place_id) {
    throw new Error(
      `[leafletMap] getPlace sin resultado (HTTP ${place.status()}) ${where}: el front rechaza sin llamar a checkPlace`
    );
  }
  const response = await check.catch(() => null);
  if (!response) {
    throw new Error(
      `[leafletMap] getPlace OK (${results[0].place_id}) pero checkPlace?waypoint=true no llego en 30 s ${where}`
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
