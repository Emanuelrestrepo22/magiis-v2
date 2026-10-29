// tests/pages/carrier-v2/reports/ReportsDailyPage.ts
/**
 * @jira MX-5438
 * @route /carrier/#/reports/daily
 * @priority P1
 * @type functional
 * @note Daily Report = dashboard de KPIs (NO es un list page). Pantalla con:
 *       - Heading h4 "Daily" (no h2)
 *       - flatpickr-input para fecha unica
 *       - widgets (no tabla principal con sort/resize/drag)
 *       - Boton PDF
 *       Por esto, override de selectores BaseListPage para apuntar al DOM real.
 *       Validado contra refs/v2/.../report-daily/report-daily.component.html.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';
import { FlatpickrCalendar, calendarDateFromIso } from '../../shared/FlatpickrCalendar.js';
import { parseDistance, parseLocalizedNumber, type DistanceReading } from '../../../utils/units.js';
import {
  METRIC_LABEL,
  waitForSummarizedTotals,
  type DistanceMetric,
  type SummarizedStatistics
} from './summarizedTotals.js';

/** Razones por distancia del Diario: «$ /Mi|Km» (facturado) y «Min/Mi|Km» (minutos). */
export type DistanceRatio = 'moneyPerDistance' | 'minutesPerDistance';

const RATIO_LABEL: Record<DistanceRatio, RegExp> = {
  moneyPerDistance: /^\s*\$\s*\/\s*(Mi|Km)\s*:/i,
  minutesPerDistance: /^\s*Min\s*\/\s*(Mi|Km)\s*:/i
};

export interface RatioReading {
  /** Valor numérico de la razón, ya parseado con el separador del carrier. */
  value: number;
  /** Unidad del rótulo («Mi» o «Km»). */
  unit: 'Mi' | 'Km';
  /** Texto completo de la fila (rótulo + valor). */
  text: string;
}

export class ReportsDailyPage extends BaseListPage {
  readonly path = '/carrier/#/reports/daily';

  /** Date picker flatpickr (single date selector). */
  readonly datePickerInput: Locator;
  /** Container principal del dashboard (proxy de "tabla" para tests genericos). */
  readonly dashboardContainer: Locator;
  /** Filas de detalle de los widgets: cada `.card-widget` trae una tabla rótulo + valor. */
  readonly widgetRows: Locator;

  protected get headingRegex(): RegExp {
    // Heading h4 con texto "Daily" (puede tener icono mdi prefix).
    return /daily/i;
  }

  constructor(page: Page) {
    super(page);
    // mwlFlatpickr crea dos inputs: uno HIDDEN con [(ngModel)] y uno VISIBLE "alt" para mostrar.
    // Anclamos al .input-group wrapper (contenedor visible que envuelve ambos inputs).
    // Angular renderiza attrs en lowercase, asi que [mwlflatpickr] es seguro sin flag i.
    this.datePickerInput = page.locator('.input-group:has(input[mwlflatpickr])').first();
    // Container del dashboard = primer .container-fluid dentro de la pagina.
    this.dashboardContainer = page.locator('.container-fluid').first();
    this.widgetRows = page.locator('.card-widget table.widget-detail-table tr');
  }

  /**
   * Daily Report no tiene tabla principal con sort/pagination - override expectListReady.
   * Validamos heading h4 + container dashboard.
   */
  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
    await expect(this.dashboardContainer).toBeVisible();
  }

  /**
   * Navega y espera la CARGA INICIAL (resumen del día en curso). Hace falta antes de tocar el
   * calendario: elegir la fecha mientras la carga inicial sigue en vuelo la pisa (ver
   * RankingReportBase.gotoLoaded).
   */
  async gotoLoaded(): Promise<void> {
    const initial = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/travels/surrendersSummarizedTotals'),
      { timeout: 30_000 }
    );
    await this.goto();
    await initial;
  }

  /**
   * Elige una fecha (ISO `2026-05-06`) en el calendario y devuelve `statistics` del
   * `surrendersSummarizedTotals` que el front dispara. La fecha debe ser distinta de la que
   * muestra el picker (hoy al cargar): con la misma no hay consulta nueva.
   */
  async selectDate(iso: string): Promise<SummarizedStatistics> {
    const calendar = new FlatpickrCalendar(this.page);
    const [statistics] = await Promise.all([
      waitForSummarizedTotals(this.page, iso, iso),
      (async () => {
        await this.datePickerInput.click();
        await calendar.pickDate(calendarDateFromIso(iso));
      })()
    ]);
    return statistics;
  }

  /** Fila del widget cuyo rótulo corresponde a la métrica de distancia. */
  distanceRow(metric: DistanceMetric): Locator {
    return this.widgetRows.filter({ hasText: METRIC_LABEL[metric] }).first();
  }

  /**
   * Texto completo (rótulo + valor) de la fila de una métrica. El «Total Mi:» trae la unidad
   * solo en el rótulo y las demás en el valor; el texto completo cubre las dos formas.
   */
  async distanceRowText(metric: DistanceMetric): Promise<string> {
    return (await this.distanceRow(metric).innerText()).replace(/\s+/g, ' ').trim();
  }

  /** Lectura «número + unidad» de una métrica: la unidad sale del valor o, si no, del rótulo. */
  async readDistance(metric: DistanceMetric): Promise<DistanceReading | null> {
    const row = this.distanceRow(metric);
    const label = (await row.locator('td').first().innerText()).replace(/\s+/g, ' ').trim();
    const value = (await row.locator('td').nth(1).innerText()).replace(/\s+/g, ' ').trim();
    const fromValue = parseDistance(value);
    if (fromValue) return fromValue;
    const labelUnit = /(?<![A-Za-z])(Mi|km)(?![A-Za-z])/i.exec(label)?.[1];
    if (!labelUnit) return null;
    return parseDistance(`${value} ${labelUnit.toLowerCase() === 'mi' ? 'Mi' : 'km'}`);
  }

  /**
   * Lectura de una razón por distancia («$ /Mi», «Min/Mi»; en carrier métrico «$ /Km»,
   * «Min/Km»). `decimalHint` = separador decimal del carrier ('.' imperial US, ',' métrico AR).
   * Devuelve `null` si la fila no existe o no trae número.
   */
  async readRatio(ratio: DistanceRatio, decimalHint: '.' | ','): Promise<RatioReading | null> {
    const row = this.widgetRows.filter({ hasText: RATIO_LABEL[ratio] }).first();
    if ((await row.count()) === 0) return null;
    const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
    const label = RATIO_LABEL[ratio].exec(text);
    if (!label) return null;
    const number = /-?\d[\d.,]*/.exec(text.slice(label[0].length))?.[0];
    if (!number) return null;
    const value = parseLocalizedNumber(number, decimalHint);
    if (Number.isNaN(value)) return null;
    return { value, unit: label[1].toLowerCase() === 'mi' ? 'Mi' : 'Km', text };
  }
}
