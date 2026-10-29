// tests/pages/carrier-v2/reports/summarizedTotals.ts
// Observación PASIVA de `GET /carriers/{id}/travels/surrendersSummarizedTotals`, el endpoint que
// alimenta los widgets del Reporte Diario y del tablero gerencial (Owner Report). Es el oráculo
// de las distancias: el crudo en km que el front pide y después muestra convertido.
//
// scope-rules §1: solo se ESPERA la respuesta de una llamada que el propio front dispara; el spec
// no emite requests.
import type { Page, Response } from '@playwright/test';

/** Campos de `statistics` que consumen los specs de unidades (todos en km, crudo del backend). */
export interface SummarizedStatistics {
  totalKms: number;
  kmsPerTravel: number;
  kmsPerVehicle: number;
  kmsPerDriver: number;
  totalTravels: number;
  madeTravels: number;
  /** Facturado por km (km crudo): el front imperial lo muestra como «$ /Mi» (MG-1190 · H-8). */
  valuePerKm: number;
  /** Minutos por km (km crudo): el front imperial lo muestra como «Min/Mi» (MG-1190 · H-8). */
  minsPerKm: number;
}

function matchesRange(response: Response, from: string, to: string): boolean {
  const url = new URL(response.url());
  return (
    url.pathname.endsWith('/travels/surrendersSummarizedTotals') &&
    url.searchParams.get('dateFrom') === from &&
    url.searchParams.get('dateTo') === to &&
    response.request().method() === 'GET'
  );
}

/**
 * Espera la respuesta de `surrendersSummarizedTotals` para el rango ISO (`2026-05-06`) y devuelve
 * `statistics`. Registrar la espera ANTES de la acción que dispara la consulta (`Promise.all`).
 */
export async function waitForSummarizedTotals(
  page: Page,
  from: string,
  to: string
): Promise<SummarizedStatistics> {
  const response = await page.waitForResponse((r) => matchesRange(r, from, to), {
    timeout: 30_000
  });
  if (!response.ok()) {
    throw new Error(`surrendersSummarizedTotals ${from}..${to} respondió ${response.status()}`);
  }
  const body = (await response.json()) as { statistics?: SummarizedStatistics };
  if (!body.statistics) {
    throw new Error(`surrendersSummarizedTotals ${from}..${to} no trae «statistics»`);
  }
  return body.statistics;
}

/** Las cuatro métricas de distancia de los widgets (Reporte Diario y tablero gerencial). */
export type DistanceMetric = 'total' | 'perTrip' | 'perVehicle' | 'perDriver';

export const DISTANCE_METRICS: readonly DistanceMetric[] = [
  'total',
  'perTrip',
  'perVehicle',
  'perDriver'
];

/** Campo de `statistics` (km) que cada widget muestra convertido. */
export const METRIC_RAW_FIELD: Record<DistanceMetric, keyof SummarizedStatistics> = {
  total: 'totalKms',
  perTrip: 'kmsPerTravel',
  perVehicle: 'kmsPerVehicle',
  perDriver: 'kmsPerDriver'
};

/**
 * Rótulo (EN/ES) de cada métrica tal como lo imprimen ambas pantallas: «Total Mi:», «Mi/Trip»,
 * «Mi/Vehicle» (ES «Mi/Vehíc.»), «Mi/Driver» (ES «Mi/Chofer»). La unidad del rótulo cambia con el
 * carrier (Mi / km), por eso el patrón la acepta y la lectura la devuelve.
 */
export const METRIC_LABEL: Record<DistanceMetric, RegExp> = {
  total: /Total\s+(Mi|km)\s*:/i,
  perTrip: /(Mi|km)\s*\/\s*(Trip|Viaje)/i,
  perVehicle: /(Mi|km)\s*\/\s*(Vehicle|Veh[ií]c)/i,
  perDriver: /(Mi|km)\s*\/\s*(Driver|Chofer)/i
};
