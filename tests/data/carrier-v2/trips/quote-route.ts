// tests/data/carrier-v2/trips/quote-route.ts
// Ruta real (origen != destino) que cotiza > 0 en TEST con «Stripe, Cliente»: 47.22 (viajes 71061,
// 71101). Mismo par que MG-682 (new-trip-frequent-destination.spec.ts, RULE_*_EXACT). El par por
// defecto de MG-19 (aeropuerto CMH -> «Columbus, OH») resuelve ambos al mismo punto: distancia 0 y
// precio 0 (viajes 71115-71119), por eso NO sirve para oraculos de importe.
// Override: ADMIN_CIRCUIT_ORIGIN_QUERY / ADMIN_CIRCUIT_DESTINATION_QUERY.
export const QUOTE_ORIGIN_QUERY =
  process.env.ADMIN_CIRCUIT_ORIGIN_QUERY ?? '100 N 31st Ave, Hollywood, FL 33021, USA';
export const QUOTE_DESTINATION_QUERY =
  process.env.ADMIN_CIRCUIT_DESTINATION_QUERY ?? '10101 Collins Ave, Bal Harbour, FL 33154, USA';

/**
 * Ruta de cotizacion por region. Region 'FR' (carrier Francia, p. ej. Cannes -> Nice) toma
 * FR_ORIGIN_QUERY / FR_DESTINATION_QUERY y falla rapido si faltan (no cae en la ruta de Florida).
 * `circuitEnvPrefix` (envPrefix del perfil de carrier del circuito, p. ej. 'US') fuerza la ruta
 * <PREFIX>_ORIGIN_QUERY / <PREFIX>_DESTINATION_QUERY con la misma regla fail-fast.
 * Cualquier otra region conserva el par por defecto de arriba.
 */
export function quoteRouteFor(
  region: '' | 'AR' | 'US' | 'MX' | 'FR' = '',
  circuitEnvPrefix?: string
): {
  origin: string;
  destination: string;
} {
  const prefix = circuitEnvPrefix ?? (region === 'FR' ? 'FR' : undefined);
  if (prefix === undefined) {
    return { origin: QUOTE_ORIGIN_QUERY, destination: QUOTE_DESTINATION_QUERY };
  }
  const origin = process.env[`${prefix}_ORIGIN_QUERY`]?.trim();
  const destination = process.env[`${prefix}_DESTINATION_QUERY`]?.trim();
  if (!origin || !destination) {
    throw new Error(
      `Missing ${prefix}_ORIGIN_QUERY / ${prefix}_DESTINATION_QUERY for region ${circuitEnvPrefix === undefined ? region : prefix}`
    );
  }
  return { origin, destination };
}
