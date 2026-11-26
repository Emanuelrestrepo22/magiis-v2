/**
 * Delta MÓVIL por carrier (app Chofer): `id de perfil V2 -> {locale de la app, ruta GPS, perfil de chofer
 * por ambiente}`. Es SOLO lo que el perfil administrativo `tests/config/carrier-profiles.ts` no tiene.
 *
 * Qué NO se duplica (vive en `carrier-profiles.ts`, fuente única): `carrierId`, nombre/label, región
 * (`'FR' | 'US' | 'AR'`), moneda (`currency.code`) y el resto de hechos de mercado. V1 repetía
 * `carrierId/name/region/currency` en su propio `CARRIERS`; acá se consultan por `profileId`
 * (`peekCarrierProfile`), nunca se copian. Nota: el `locale` del perfil V2 (`en-US`) es el del PORTAL web
 * Carrier; `appLocale` es el idioma de la APP del chofer (p. ej. `fr-FR` en 1901) y por eso sí vive acá.
 *
 * REGLA: un carrier nuevo = UNA entrada en `MOBILE_CARRIERS` con el id de un perfil V2 existente (y, si
 * hace falta, un JSON en `gps/routes/<region>/` y un perfil en `data/driverProfiles.ts`). Cero lógica por
 * carrier en código: las funciones de abajo solo leen datos. La ruta se resuelve e INYECTA; no se muta
 * el entorno del proceso.
 *
 * Mapeo de nombres de ruta GPS (V1 vs V2): V2 nombra la ruta FR como `cannes-niza`
 * (`APP_GPS_ROUTES_AVAILABLE` en `helpers/f5-app-handoff.ts`); el archivo portado de V1 se llama
 * `cannes-nice.json` y ese es el que se usa (un solo archivo, sin renombrar el JSON para no romper la
 * paridad con V1). La equivalencia `cannes-niza` = `gps/routes/cannes-nice.json` queda en
 * `V2_ROUTE_ALIASES`; el handoff V2 la usa para resolver su nombre al archivo real.
 *
 * Los perfiles de chofer son ids (nombres de clave de env); aquí no hay credenciales.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownCircuitCarriers, peekCarrierProfile } from '../../../config/carrier-profiles.js';
import type { MobileEnvironment } from '../config/appiumRuntime.js';
import { loadRouteFile, type LatLng } from '../gps/GpsRouteFeeder.js';
import type { DriverProfileId } from './driverProfiles.js';

export type MobileCarrierDelta = {
  /** BCP-47 del idioma de la APP del chofer para ese carrier (≠ locale del portal web de V2). */
  appLocale: string;
  /** Ruta GPS por defecto, relativa a `gps/routes/` (p. ej. `us/miami-brickell.json`). */
  routeId: string;
  /** Perfil de chofer por ambiente. Solo ids de `DRIVER_PROFILES`. */
  driverProfiles: Partial<Record<MobileEnvironment, DriverProfileId>>;
  /** Pendientes de verificación que el reporte debe repetir (p. ej. geocerca sin confirmar). */
  notes?: string[];
};

/** Entrada resuelta: el delta + el id del perfil V2 del que se deriva el resto de los hechos. */
export type MobileCarrier = MobileCarrierDelta & { profileId: string };

/** Clave = id de perfil de `tests/config/carrier-profiles.ts` (p. ej. `'1901'`, `'1521'`). */
export type MobileCarrierRegistry = Record<string, MobileCarrierDelta>;

export const MOBILE_CARRIERS: MobileCarrierRegistry = {
  '1901': {
    appLocale: 'fr-FR',
    routeId: 'cannes-nice.json',
    driverProfiles: { test: 'fr-1901' }
  },
  '1521': {
    appLocale: 'en-US',
    // Ruta del alta F5 de cv2-f5 (origen 900 Collins Ave -> destino 1111 Lincoln Rd, Miami Beach): arranca en el
    // origen para que el km medido por la app no sume el salto desde otro punto (11/11: Brickell dio 14,14 km).
    routeId: 'us/miami-beach-collins-lincoln.json',
    driverProfiles: { test: 'test-default' },
    notes: [
      'Ruta con vértices aproximados sobre calles (sin router externo); la geocerca del carrier 1521 sigue sin verificar.',
      'us/miami-brickell.json queda como alternativa; no empieza en el origen del alta F5.'
    ]
  }
};

/** Nombre de ruta en V2 (`APP_GPS_ROUTES_AVAILABLE`) -> archivo real en `gps/routes/`. */
export const V2_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  'cannes-niza': 'cannes-nice.json'
};

export const GPS_ROUTES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../gps/routes'
);

/** Delta móvil del perfil V2 `profileId`; falla nombrando los disponibles. */
export function getMobileCarrier(
  profileId: string,
  registry: MobileCarrierRegistry = MOBILE_CARRIERS
): MobileCarrier {
  const delta = registry[profileId];
  if (!delta) {
    throw new Error(
      `Carrier "${profileId}" sin datos móviles. Disponibles: ${Object.keys(registry).join(', ')}. Agregá una entrada en data/carriers.ts.`
    );
  }
  return { profileId, ...delta };
}

/**
 * Delta móvil por `CARRIER.ID` (lo que traen los handoffs): resuelve el perfil V2 con ese `carrierId` entre
 * los que tienen delta móvil. Un perfil con `carrierId` pendiente (TODO) no coincide con nadie.
 */
export function findMobileCarrier(
  carrierId: number,
  registry: MobileCarrierRegistry = MOBILE_CARRIERS
): MobileCarrier {
  const profileId = Object.keys(registry).find((id) => {
    const known = knownCircuitCarriers().includes(id);
    return known && (peekCarrierProfile(id).carrierId as unknown) === carrierId;
  });
  if (!profileId) {
    throw new Error(
      `Carrier ${carrierId} sin datos móviles. Disponibles: ${Object.keys(registry).join(', ')}. Agregá una entrada en data/carriers.ts.`
    );
  }
  return getMobileCarrier(profileId, registry);
}

/** Perfil de chofer del carrier para el ambiente; falla nombrando carrier y ambiente. */
export function resolveDriverProfileId(
  carrier: MobileCarrier,
  env: MobileEnvironment
): DriverProfileId {
  const id = carrier.driverProfiles[env];
  if (!id)
    throw new Error(`Carrier ${carrier.profileId} sin perfil de chofer para el ambiente "${env}".`);
  return id;
}

/**
 * Ruta GPS del carrier (o `routeId` explícito) como puntos; sin tocar el entorno del proceso. Acepta el
 * nombre V2 (`cannes-niza`) vía `V2_ROUTE_ALIASES`.
 */
export function loadCarrierRoute(
  carrier: MobileCarrier,
  routeId: string = carrier.routeId,
  routesDir: string = GPS_ROUTES_DIR
): LatLng[] {
  const resolved = V2_ROUTE_ALIASES[routeId] ?? routeId;
  const file = path.resolve(routesDir, resolved);
  const rel = path.relative(routesDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`routeId "${routeId}" fuera de gps/routes/.`);
  return loadRouteFile(file, `Ruta ${routeId} (carrier ${carrier.profileId})`);
}
