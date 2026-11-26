// tests/data/carrier-v2/waypoints/trip-locations.ts
// Coordenadas de los tests de viaje con puntos de referencia (MG-1132 PK-5), carrier 1521 (EEUU).
// El alta por API no valida ruteabilidad (Q5): las coordenadas deben ser rutables y estar en las zonas de
// cotizacion del 1521 (Florida). Archivo aparte de `locations.ts` (PK-1) para no tocarlo.
import type { Coordinate } from './locations.js';
import { MIAMI } from './locations.js';

/** Puntos con referencia / sin referencia en Miami (viajes TM-1760, 1795, 1821, 1823, 1830, 1836). */
export const TRIP_SPOTS = {
  origin: MIAMI.downtown,
  stop: { lat: MIAMI.downtown.lat + 0.0021, lng: MIAMI.downtown.lng + 0.0008 },
  second: { lat: MIAMI.brickell.lat, lng: MIAMI.brickell.lng }
} as const satisfies Record<string, Coordinate>;

/**
 * Camino rural sin nombre de Christmas, FL (medido 18/11/2026 en TM-1790: «Unnamed Rd», types [route],
 * cotiza y crea con el 1521). Origen del Test TM-1790.
 */
export const RURAL_CHRISTMAS: Coordinate = { lat: 28.526682, lng: -81.015356 };
/**
 * Dos caminos rurales de la pampa humeda (Buenos Aires, Argentina), a mas de 250 km del circulo «buenos aires»
 * del 1521 y fuera de la zona «USA»: destino de TM-1838 (cotizacion por distancia, fuera de toda zona). El alta
 * por API no valida ruteabilidad; que cotizan lo prueba el propio Test. Coordenadas propias de esta
 * automatizacion (el recon manual de TM-1838 uso otros puntos, en el carrier 1040).
 */
export const RURAL_PAMPA_A: Coordinate = { lat: -34.35, lng: -61.3 };
export const RURAL_PAMPA_B: Coordinate = { lat: -34.3, lng: -61.2 };

/**
 * Punto en Pensacola, FL (huso America/Chicago, UTC-6; el carrier 1521 esta en America/New_York y el
 * navegador del test se emula en Asia/Tokyo). Medido 17/11/2026 en TM-1802.
 */
export const PENSACOLA: Coordinate & { timeZone: string } = {
  lat: 30.4134710760892,
  lng: -87.21475878619536,
  timeZone: 'America/Chicago'
};
/** Destino de Google cercano a Pensacola (cotiza con el 1521). */
export const PENSACOLA_DESTINATION_TEXT = '400 Quietwater Beach Rd';

/** Referencia de los puntos con indicacion (se copia a la indicacion del lugar al elegirlo). */
export const POINT_REFERENCE = 'Porton verde, tocar timbre';
