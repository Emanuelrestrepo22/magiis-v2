// tests/pages/carrier-v2/reports/RankingReportBase.ts
/**
 * @jira MG-1193
 * @priority P1
 * @type functional
 * @note Base común de los rankings de Choferes (`/reports/ranking-drivers`, reporte genérico 002) y
 *       Vehículos (`/reports/ranking-vehicles`, reporte 001). Comparten el DOM: picker de RANGO
 *       (`app-magiis-ranges-date-picker`), tabla de filas con cabecera de dos niveles (nombre de la
 *       columna + sub-cabecera con la UNIDAD: «USD», «#», «Mi»/«km») y tabla de totales debajo.
 *       Selectores derivados del DOM VIVO de la v2.0.17 desplegada en UAT (07/10/2026).
 *
 *       Oráculo: `POST /data/genericReport/{código}/paginated` (filas) y `…/{código}T/paginated`
 *       (totales) con `filters` dateFrom/dateTo en dd-mm-aaaa. Las celdas de distancia no llevan la
 *       unidad en el texto: la unidad sale de la sub-cabecera de la misma columna.
 */
import type { Locator, Page, Response } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';
import { FlatpickrCalendar, calendarDateFromIso } from '../../shared/FlatpickrCalendar.js';
import { parseDistance, type DistanceReading } from '../../../utils/units.js';

/** Fila cruda del reporte genérico (`content[].row`): `Col1…ColN` como texto. */
export type RankingRawRow = Record<string, string>;

export interface RankingRaw {
  rows: RankingRawRow[];
  /** Fila de totales (`…T`); `null` si el backend no devolvió ninguna. */
  totals: RankingRawRow | null;
}

/** Columnas de distancia del ranking: Dist/Viaje y Dist. Ocupada. */
export type RankingDistanceColumn = 'perTrip' | 'busy';

const COLUMN_HEADER: Record<RankingDistanceColumn, RegExp> = {
  // EN «Dist/Trips» · ES «Dist / Viaje».
  perTrip: /Dist\s*\/\s*(Trips?|Viaje)/i,
  // EN «Busy Dist.» · ES «Dist Ocupada».
  busy: /Busy\s+Dist|Dist\.?\s+Ocupada/i
};

/** `2026-05-31` → `31-05-2026` (formato de los filtros del reporte genérico). */
function toReportDate(iso: string): string {
  return iso.split('-').reverse().join('-');
}

async function waitForReport(
  page: Page,
  reportCode: string,
  from: string,
  to: string
): Promise<RankingRawRow[]> {
  const matches = (response: Response): boolean => {
    const request = response.request();
    if (request.method() !== 'POST') return false;
    if (!new URL(response.url()).pathname.endsWith(`/genericReport/${reportCode}/paginated`)) {
      return false;
    }
    try {
      const body = JSON.parse(request.postData() ?? '{}') as {
        filters?: { alias: string; value: string }[];
      };
      const filter = (alias: string) => body.filters?.find((f) => f.alias === alias)?.value;
      return filter('dateFrom') === toReportDate(from) && filter('dateTo') === toReportDate(to);
    } catch {
      return false;
    }
  };
  const response = await page.waitForResponse(matches, { timeout: 30_000 });
  if (!response.ok()) {
    throw new Error(`genericReport/${reportCode} ${from}..${to} respondió ${response.status()}`);
  }
  const body = (await response.json()) as { content?: { row: RankingRawRow }[] };
  return (body.content ?? []).map((entry) => entry.row);
}

export abstract class RankingReportBase extends BaseListPage {
  /** Código del reporte genérico de filas: `002` (choferes) o `001` (vehículos). */
  abstract readonly reportCode: string;

  readonly rangePicker: Locator;
  /** Tabla de filas (la primera) y de totales (la segunda). */
  readonly rowsTable: Locator;
  readonly totalsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.rangePicker = page.locator('app-magiis-ranges-date-picker');
    this.rowsTable = page.locator('table').first();
    this.totalsTable = page.locator('table').nth(1);
  }

  /**
   * Navega y espera la CARGA INICIAL (filas + totales del rango por defecto). Hace falta antes de
   * tocar el picker: si el rango se elige mientras la carga inicial sigue en vuelo, el front pisa la
   * selección con el rango por defecto y la consulta del rango elegido nunca sale (flake medido en
   * el carrier 1040 de TEST, ~1 de cada 6 corridas).
   */
  async gotoLoaded(): Promise<void> {
    const isInitial = (suffix: string) => (response: Response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith(
        `/genericReport/${this.reportCode}${suffix}/paginated`
      );
    const initial = Promise.all([
      this.page.waitForResponse(isInitial(''), { timeout: 30_000 }),
      this.page.waitForResponse(isInitial('T'), { timeout: 30_000 })
    ]);
    await this.goto();
    await initial;
  }

  /**
   * Elige un rango ISO y devuelve las filas y los totales CRUDOS (km) que el front pidió. El rango
   * debe diferir del que muestra el picker (por defecto los últimos 15 días): con el mismo no hay
   * consulta nueva.
   */
  async selectRange(from: string, to: string): Promise<RankingRaw> {
    const calendar = new FlatpickrCalendar(this.page);
    const [rows, totals] = await Promise.all([
      waitForReport(this.page, this.reportCode, from, to),
      waitForReport(this.page, `${this.reportCode}T`, from, to),
      (async () => {
        await this.rangePicker.locator('.input-group').click();
        await calendar.pickRange(calendarDateFromIso(from), calendarDateFromIso(to));
      })()
    ]);
    return { rows, totals: totals[0] ?? null };
  }

  /** Celda de identidad de la fila (chofer «(504) Senna Ayrton» / dominio «MAGIIS6»). */
  rowIdentityCell(rowIndex: number): Locator {
    return this.rowsTable.locator('tbody tr').nth(rowIndex).locator('td').nth(1);
  }

  private async columnIndex(table: Locator, column: RankingDistanceColumn): Promise<number> {
    const headers = await table.locator('thead tr').first().locator('th').allInnerTexts();
    const index = headers.findIndex((text) =>
      COLUMN_HEADER[column].test(text.replace(/\s+/g, ' '))
    );
    if (index < 0) {
      throw new Error(`No hay columna ${column} en la cabecera: ${headers.join(' | ')}`);
    }
    return index;
  }

  /** Unidad que declara la sub-cabecera de la columna («Mi» / «km»). */
  private async columnUnit(table: Locator, index: number): Promise<string> {
    return (await table.locator('thead tr').nth(1).locator('th').nth(index).innerText()).trim();
  }

  private async readCell(
    table: Locator,
    row: Locator,
    column: RankingDistanceColumn
  ): Promise<{ reading: DistanceReading | null; text: string }> {
    const index = await this.columnIndex(table, column);
    const value = (await row.locator('td').nth(index).innerText()).trim();
    const unit = await this.columnUnit(table, index);
    const text = `${value} ${unit}`;
    return { reading: parseDistance(text), text };
  }

  /** Distancia de una fila de la tabla principal (valor de la celda + unidad de la sub-cabecera). */
  async readRowDistance(rowIndex: number, column: RankingDistanceColumn) {
    return this.readCell(this.rowsTable, this.rowsTable.locator('tbody tr').nth(rowIndex), column);
  }

  /** Distancia de la fila de totales (tabla de abajo). */
  async readTotalDistance(column: RankingDistanceColumn) {
    return this.readCell(this.totalsTable, this.totalsTable.locator('tbody tr').first(), column);
  }
}
