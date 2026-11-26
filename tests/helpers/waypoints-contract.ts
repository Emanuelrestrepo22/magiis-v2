// tests/helpers/waypoints-contract.ts
// Utilidades puras de los Tests de contrato de Puntos de referencia (MG-1132, PK-1). Sin Playwright:
// se prueban con node:test (waypoints-contract.unit.ts).
import type { AutocompleteItem } from '../api/clients/places.client.js';

/** Minusculas sin tildes y con la ñ como n: el criterio de busqueda y de orden del autocomplete. */
export function normalizeName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Ids de punto de referencia (`MGWP-{id}-{version}`) o null si el placeId no es de un punto propio del carrier. */
export function parseWaypointPlaceId(placeId: string): { id: number; version: number } | null {
  const match = /^MGWP-(\d+)-(\d+)$/.exec(placeId);
  return match ? { id: Number(match[1]), version: Number(match[2]) } : null;
}

/** Items del autocomplete que vienen de los puntos de referencia del carrier. */
export function carrierItems(items: readonly AutocompleteItem[]): AutocompleteItem[] {
  return items.filter((item) => item.source === 'CARRIER');
}

/** Items que corresponden a alguno de los ids de punto dados (cualquier version del placeId). */
export function itemsOfWaypoints(
  items: readonly AutocompleteItem[],
  ids: readonly number[]
): AutocompleteItem[] {
  const wanted = new Set(ids);
  return items.filter((item) => {
    const parsed = parseWaypointPlaceId(item.placeId);
    return parsed !== null && wanted.has(parsed.id);
  });
}

/**
 * Timestamp de CARRIER_WAYPOINT leido como texto `YYYY-MM-DDTHH24:MI:SS.FF3` (TO_CHAR en SQL). Las columnas
 * son TIMESTAMP(6) sin zona y guardan UTC; OracleDb no fija la zona de sesion, asi que el Date que arma el
 * driver depende de la zona local. Parsear el texto como UTC elimina esa dependencia. null si no hay valor.
 */
export function parseUtcTimestamp(text: string | null): number | null {
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(text)) {
    throw new Error(`[waypoints] timestamp no ISO: «${text}»`);
  }
  return Date.parse(`${text}Z`);
}

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** true si los nombres vienen en orden ascendente por nombre normalizado (desempate estable permitido). */
export function isSortedByNormalizedName(names: readonly string[]): boolean {
  const keys = names.map(normalizeName);
  return keys.every((key, index) => index === 0 || keys[index - 1] <= key);
}
