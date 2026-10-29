// tests/data/carrier-v2/trips/other-costs.ts
// Datos por ambiente de la familia «Otros Costos en Nuevo Viaje» (MG-995/MG-996 fase 1, ATR TM-1280).
// Plan: MG-990-fase1/plan-automatizacion-otros-costos-e2e.md §5.3 (Discover → Modify → Generate).
//
// - Ruta y cliente: DISCOVER (existen en el ambiente; el typeahead y Google Places consultan al
//   backend real, no se inventan). UAT carrier 1481 verificado el 2026-09-29: cliente «EEUU, Magiis»,
//   ruta corta Rockefeller Center → Empire State Building y ruta larga Rockefeller Center → JFK
//   (para los Porcentaje, así el importe no queda en centavos).
// - Conceptos: GENERATE por API en cada test (otherCostFactory); acá solo los montos.
// - Overrides por variable de entorno autoexplicativa (patrón MG19_CLIENT_QUERY): OC_CLIENT_QUERY,
//   OC_ORIGIN_QUERY, OC_DESTINATION_QUERY, OC_LONG_DESTINATION_QUERY.
//
// La familia corre solo en UAT en la fase 1 (plan §6): TEST y PROD valen null y el spec se salta
// con motivo estructural (sin datos de ruta para ese ambiente).
import type { AppEnv } from '../../../config/runtime.js';

export type OtherCostsRoute = {
  /** Query del typeahead de cliente (busca por apellido, 3+ caracteres). */
  clientQuery: string;
  originQuery: string;
  /** Destino de la ruta corta (Fijo, Cantidad, Variable, TM-1091, TM-1277, TM-1279). */
  destinationQuery: string;
  /** Destino de la ruta larga (tests con Porcentaje: TM-1086, TM-1090). */
  longDestinationQuery: string;
  /** Sugerencia de Places a elegir para la ruta larga (la primera puede ser un POI). */
  longDestinationOption: RegExp;
};

/** Montos por Test (moneda del carrier). Plan §5.3, tabla «Montos para UAT». */
export type OtherCostsAmounts = {
  tm1084: { sale: number; cost: number };
  tm1085: { unitSale: number; unitCost: number; quantity: number };
  tm1086: { percent: number; costPercent: number };
  tm1087: { maxSale: number; maxCost: number; amount: string };
  tm1090: {
    fixedSale: number;
    fixedCost: number;
    quantitySale: number;
    quantityCost: number;
    quantity: number;
    percent: number;
    costPercent: number;
  };
  tm1091: { sale: number; cost: number };
  tm1277: {
    maxSale: number;
    maxCost: number;
    /** Importe válido del Test en Xray (paso 3 y 4). */
    accepted: number;
    /** Importe que supera el tope del Test en Xray (paso 3). */
    rejected: number;
  };
  tm1279: {
    /** (a) Costo encendido con costo en cero. */
    costZeroSale: number;
    /** (b) Costo apagado. */
    costOffSale: number;
    /** (c) Disponibilidad compartida Chofer + Operador. */
    sharedSale: number;
    /** (d) Valor negativo (dato legado; el ABM no lo permite: O-UAT-03). */
    negativeSale: number;
  };
};

export type OtherCostsEnvData = {
  carrierId: number;
  /** Código de moneda del carrier: el currencyId del concepto se descubre del catálogo por este código. */
  currencyCode: string;
  route: OtherCostsRoute;
  amounts: OtherCostsAmounts;
};

const UAT: OtherCostsEnvData = {
  carrierId: 1481,
  currencyCode: 'USD',
  route: {
    clientQuery: 'EEUU',
    originQuery: 'Rockefeller Center',
    destinationQuery: 'Empire State Building',
    longDestinationQuery: 'JFK Airport',
    longDestinationOption: /JFK|John F\.? Kennedy/i
  },
  amounts: {
    tm1084: { sale: 25, cost: 8 },
    tm1085: { unitSale: 2, unitCost: 1, quantity: 3 },
    tm1086: { percent: 20, costPercent: 10 },
    tm1087: { maxSale: 5000, maxCost: 2000, amount: '1234.56' },
    tm1090: {
      fixedSale: 25,
      fixedCost: 8,
      quantitySale: 10,
      quantityCost: 4,
      quantity: 3,
      percent: 20,
      costPercent: 10
    },
    tm1091: { sale: 25, cost: 8 },
    tm1277: { maxSale: 1500, maxCost: 700, accepted: 500, rejected: 2000 },
    tm1279: { costZeroSale: 30, costOffSale: 15, sharedSale: 12, negativeSale: -5 }
  }
};

const DATA_BY_ENV: Record<AppEnv, OtherCostsEnvData | null> = {
  test: null,
  uat: UAT,
  prod: null
};

/** Datos del ambiente con los overrides OC_* aplicados, o null si la familia no corre ahí. */
export function otherCostsDataFor(env: AppEnv): OtherCostsEnvData | null {
  const base = DATA_BY_ENV[env];
  if (!base) return null;
  return {
    ...base,
    route: {
      ...base.route,
      clientQuery: process.env.OC_CLIENT_QUERY ?? base.route.clientQuery,
      originQuery: process.env.OC_ORIGIN_QUERY ?? base.route.originQuery,
      destinationQuery: process.env.OC_DESTINATION_QUERY ?? base.route.destinationQuery,
      longDestinationQuery: process.env.OC_LONG_DESTINATION_QUERY ?? base.route.longDestinationQuery
    }
  };
}
