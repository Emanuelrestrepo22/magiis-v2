// tests/api/clients/places.client.ts
// Cliente de Places (autocomplete, getPlace, checkPlace) para el feature Puntos de referencia (MG-1132).
// Solo lectura. Endpoints medidos en TEST (plan MG-1132/automation-plan.md §1):
// - autocomplete: GET places/autocomplete?address=&sessionToken=<uuid>[&carrierId=]
//   Sin carrierId: minimo 3 caracteres, sin puntos. Con carrierId (Nuevo Viaje): minimo 2, puntos primero.
// - getPlace:     GET places/getPlace?latitude=&longitude=  -> [{place_id, types[], formattedAddress, timeZone, ...}]
// - checkPlace:   GET places/checkPlace/{placeId}[?waypoint=true]
//   Con waypoint=true solo bloquean NO_GEOCODE_RESULTS y NO_COUNTRY.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendGetOk } from './carrierSession.js';

export type AutocompleteItem = {
  placeId: string;
  mainText: string;
  secondaryText: string | null;
  shortName: string;
  latitude: string | null;
  longitude: string | null;
  airport: boolean;
  iataCode: string | null;
  source: 'CARRIER' | 'GOOGLE' | 'CACHE' | 'AIRPORT';
  reference: string | null;
};
export type CheckPlaceResult = {
  routable: boolean;
  fails: number;
  reasons: string[];
  formattedAddress: string;
  lat: number;
  lng: number;
};

/** Query de `places/autocomplete` (exportada para la prueba unitaria). */
export function autocompleteQuery(
  p: { address: string; carrierId?: number },
  sessionToken: string
): string {
  const params = new URLSearchParams({ address: p.address, sessionToken });
  if (p.carrierId !== undefined) params.set('carrierId', String(p.carrierId));
  return params.toString();
}

/** Ruta de `places/checkPlace` (exportada para la prueba unitaria). */
export function checkPlacePath(placeId: string, o: { waypoint?: boolean } = {}): string {
  return `places/checkPlace/${encodeURIComponent(placeId)}${o.waypoint ? '?waypoint=true' : ''}`;
}

export class PlacesClient {
  constructor(private readonly api: APIRequestContext) {}

  async autocomplete(p: { address: string; carrierId?: number }): Promise<AutocompleteItem[]> {
    const response = await sendGetOk('places/autocomplete', () =>
      this.api.get(`places/autocomplete?${autocompleteQuery(p, randomUUID())}`)
    );
    const body = await readJson<unknown>(response);
    if (!Array.isArray(body)) throw new Error('[places] autocomplete no devolvio un array');
    return body as AutocompleteItem[];
  }

  async getPlaceByCoords(
    lat: number,
    lng: number
  ): Promise<{
    placeId: string;
    types: string[];
    formattedAddress: string;
    timeZone: string | null;
  }> {
    const response = await sendGetOk('places/getPlace', () =>
      this.api.get(`places/getPlace?latitude=${lat}&longitude=${lng}`)
    );
    const body = await readJson<
      Array<{
        place_id?: string;
        types?: string[];
        formattedAddress?: string;
        timeZone?: string | null;
      }>
    >(response);
    const first = body?.[0];
    if (!first?.place_id) throw new Error(`[places] getPlace sin place_id para ${lat},${lng}`);
    return {
      placeId: first.place_id,
      types: first.types ?? [],
      formattedAddress: first.formattedAddress ?? '',
      timeZone: first.timeZone ?? null
    };
  }

  async checkPlace(placeId: string, o: { waypoint?: boolean } = {}): Promise<CheckPlaceResult> {
    const response = await sendGetOk('places/checkPlace', () =>
      this.api.get(checkPlacePath(placeId, o))
    );
    const body = await readJson<CheckPlaceResult>(response);
    if (!body) throw new Error('[places] checkPlace respondio sin cuerpo');
    return body;
  }
}
