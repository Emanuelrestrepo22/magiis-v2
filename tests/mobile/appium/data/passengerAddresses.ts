/**
 * Direcciones de prueba para preparar un viaje PAX (origen/destino con predicciones). Solo puntos de referencia
 * públicos (sin datos personales). Son datos puros: el spec elige la región; ninguna lógica por carrier.
 *
 * Las consultas son cortas y reconocibles por Google Places (la app consulta desde 3 caracteres con debounce de
 * 300 ms y muestra como máximo 3 predicciones). `pick` es un texto que debe aparecer en la predicción elegida; si
 * ninguna lo contiene, el PBO toma la primera. Pendiente de validar en vivo.
 */

export type PassengerRegion = 'AR' | 'US' | 'FR';

export type TripAddress = {
  /** Texto que se escribe en el campo. */
  query: string;
  /** Texto esperado en la predicción a elegir (opcional; sin coincidencia se toma la primera). */
  pick?: string;
};

export type PassengerAddressPair = { origin: TripAddress; destination: TripAddress };

export const PASSENGER_ADDRESS_PAIRS: Readonly<Record<PassengerRegion, PassengerAddressPair>> = {
  AR: {
    origin: { query: 'Obelisco Buenos Aires', pick: 'Obelisco' },
    destination: { query: 'Aeroparque Jorge Newbery', pick: 'Aeroparque' }
  },
  US: {
    origin: { query: 'Brickell City Centre Miami', pick: 'Brickell' },
    destination: { query: 'Miami International Airport', pick: 'Miami International' }
  },
  FR: {
    origin: { query: 'Gare de Cannes', pick: 'Cannes' },
    destination: { query: 'Aéroport Nice Côte d’Azur', pick: 'Nice' }
  }
};

export const DEFAULT_PASSENGER_REGION: PassengerRegion = 'AR';

export function isPassengerRegion(value: string): value is PassengerRegion {
  return value === 'AR' || value === 'US' || value === 'FR';
}

/** Par origen/destino de la región; región desconocida o vacía -> la por defecto. */
export function passengerAddressesFor(region?: string | null): PassengerAddressPair {
  const key = (region ?? '').trim().toUpperCase();
  return PASSENGER_ADDRESS_PAIRS[isPassengerRegion(key) ? key : DEFAULT_PASSENGER_REGION];
}
