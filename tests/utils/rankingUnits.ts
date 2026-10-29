// tests/utils/rankingUnits.ts
// Aserción compartida de los rankings de Choferes y Vehículos (MG-1193 · TM-1350 / TM-1352):
// cada celda «Dist/Viaje» y «Dist. Ocupada» (filas y totales) debe mostrar el crudo en km del
// reporte genérico convertido a la unidad del carrier. Las celdas se emparejan con la API POR
// POSICIÓN verificando la identidad de la fila (nombre / dominio): el dominio «MAGIIS6» aparece
// dos veces en UAT (categorías Standard / Premium) y emparejar por dominio dio un falso FAIL.
import { expect } from '@playwright/test';
import type {
  RankingRaw,
  RankingReportBase
} from '../pages/carrier-v2/reports/RankingReportBase.js';
import { expectDisplayedDistance } from './unitsAssert.js';
import type { UnitSystem } from './units.js';

/** Columnas del reporte genérico (`Col<N>`) que alimentan cada celda de distancia. */
export interface RankingColumns {
  rowPerTrip: string;
  rowBusy: string;
  totalPerTrip: string;
  totalBusy: string;
  /** Columna de identidad de la fila (nombre del chofer / dominio). */
  identity: string;
}

/** Tamaño de página por defecto del ranking («Show 20»). */
const PAGE_SIZE = 20;

export interface RankingCheck {
  ranking: RankingReportBase;
  raw: RankingRaw;
  columns: RankingColumns;
  system: UnitSystem;
  /** Etiqueta para los mensajes («EN, us-1481»). */
  context: string;
}

/**
 * Verifica todas las celdas de distancia visibles contra el crudo y devuelve las mediciones
 * (una línea por celda) para el comentario de evidencia.
 */
export async function expectRankingDistances(check: RankingCheck): Promise<string[]> {
  const { ranking, raw, columns, system, context } = check;
  const measured: string[] = [];
  const visibleRows = Math.min(raw.rows.length, PAGE_SIZE);

  await expect(
    ranking.rowsTable.locator('tbody tr'),
    `${context}: la tabla debe mostrar las ${visibleRows} filas que devolvió el reporte`
  ).toHaveCount(visibleRows, { timeout: 15_000 });

  for (let index = 0; index < visibleRows; index++) {
    const row = raw.rows[index];
    await expect(
      ranking.rowIdentityCell(index),
      `${context}: la fila ${index + 1} de la pantalla debe ser la fila ${index + 1} del reporte`
    ).toContainText(row[columns.identity]);
    for (const [column, key] of [
      ['perTrip', columns.rowPerTrip],
      ['busy', columns.rowBusy]
    ] as const) {
      const rawKm = Number(row[key]);
      const reading = await expectDisplayedDistance({
        label: `${context} · fila ${index + 1} (${row[columns.identity]}) · ${column}`,
        read: async () => (await ranking.readRowDistance(index, column)).reading,
        readText: async () => (await ranking.readRowDistance(index, column)).text,
        rawKm,
        system
      });
      measured.push(
        `${row[columns.identity]} ${column}: ${rawKm} km → ${reading.value} ${reading.unit}`
      );
    }
  }

  expect(raw.totals, `${context}: el reporte de totales debe traer una fila`).not.toBeNull();
  for (const [column, key] of [
    ['perTrip', columns.totalPerTrip],
    ['busy', columns.totalBusy]
  ] as const) {
    const rawKm = Number(raw.totals?.[key]);
    const reading = await expectDisplayedDistance({
      label: `${context} · totales · ${column}`,
      read: async () => (await ranking.readTotalDistance(column)).reading,
      readText: async () => (await ranking.readTotalDistance(column)).text,
      rawKm,
      system
    });
    measured.push(`totales ${column}: ${rawKm} km → ${reading.value} ${reading.unit}`);
  }
  return measured;
}

/** Precondición anti-vacuidad: al menos una fila con distancia cruda > 0 en alguna de las dos columnas. */
export function rankingDistinguishes(raw: RankingRaw, columns: RankingColumns): boolean {
  return raw.rows.some(
    (row) => Number(row[columns.rowPerTrip]) > 0 || Number(row[columns.rowBusy]) > 0
  );
}
