// tests/data/carrier-v2/waypoints/locations.ts
// Coordenadas MEDIDAS del feature Puntos de referencia (MG-1132), ejecucion manual y de recon del
// 16-18/11/2026 en TEST (plan MG-1132/automation-plan.md §5 y §3.1). El placeId de Google NUNCA se
// hardcodea: se resuelve en runtime con PlacesClient.getPlaceByCoords(lat, lng).
// Regla de checkPlace (MG-1757 DISENO.md): con `waypoint=true` solo bloquean NO_GEOCODE_RESULTS y
// NO_COUNTRY; sin el parametro no cambia el comportamiento previo.

export type Coordinate = { lat: number; lng: number };

export type LocationCase = Coordinate & {
  /** Descripcion de la fila de la tabla de decision. */
  label: string;
  /** Veredicto medido de `routable` con `?waypoint=true`. */
  routableWithWaypoint: boolean;
  /** Veredicto medido de `routable` sin el parametro; null = no medido en este recon. */
  routableWithoutWaypoint: boolean | null;
  /** Motivos (codigos de MAGIIS, no texto de Google) con `?waypoint=true`; `[]` = medido y vacio. */
  reasonsWithWaypoint?: string[];
  /** Motivos esperados sin el parametro (se exigen todos; pueden venir otros). */
  reasonsWithoutWaypoint?: string[];
};

export const LOCATIONS = {
  F1: {
    lat: -34.19597,
    lng: -59.656,
    label: 'camino rural con localidad',
    routableWithWaypoint: true,
    routableWithoutWaypoint: true,
    reasonsWithWaypoint: []
  },
  F2: {
    lat: -34.17514,
    lng: -59.65218,
    label: 'camino rural sin localidad',
    routableWithWaypoint: true,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: [],
    reasonsWithoutWaypoint: ['NO_CITY', 'UNNAMED_ROAD']
  },
  F3: {
    lat: -34.403054,
    lng: -59.504013,
    label: 'campo (sin ciudad ni calle)',
    routableWithWaypoint: true,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: []
  },
  F4a: {
    lat: -35.6,
    lng: -58.045,
    label: 'laguna (agua con pais)',
    routableWithWaypoint: true,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: []
  },
  F4b: {
    lat: -34.9,
    lng: -57.5,
    label: 'Rio de la Plata (agua con pais)',
    routableWithWaypoint: true,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: []
  },
  F5a: {
    lat: -40,
    lng: -56,
    label: 'mar abierto (sin pais)',
    routableWithWaypoint: false,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: ['NO_COUNTRY']
  },
  F5b: {
    lat: -32.945,
    lng: -60.615,
    label: 'canal del Parana (sin pais)',
    routableWithWaypoint: false,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: ['NO_COUNTRY']
  },
  F6: {
    lat: -34.60958,
    lng: -58.38178,
    label: 'plaza',
    routableWithWaypoint: true,
    routableWithoutWaypoint: false,
    reasonsWithWaypoint: [],
    reasonsWithoutWaypoint: ['NON_ROUTABLE_TYPE']
  }
} as const satisfies Record<string, LocationCase>;

/** Puntos validos en Miami para el perfil carrier 1521 (zonas de cotizacion de EEUU). */
export const MIAMI = {
  downtown: { lat: 25.77483, lng: -80.18849 },
  brickell: { lat: 25.7619992, lng: -80.1923449 }
} as const satisfies Record<string, Coordinate>;

/** Coordenada en la forma del cuerpo de `POST/PUT carriers/{id}/waypoint`. */
export function toWaypointCoords(c: Coordinate): { latitude: number; longitude: number } {
  return { latitude: c.lat, longitude: c.lng };
}
