// tests/pages/carrier-v2/reports/OwnerReportPage.ts
/**
 * @jira MG-1193
 * @route /carrier/#/owner-report
 * @priority P1
 * @type functional
 * @note Tablero gerencial («Management Board» / «Tablero Gerencial»): tarjetas de KPIs + gráficos
 *       por día. Alimentado por el mismo `GET …/travels/surrendersSummarizedTotals` que el Reporte
 *       Diario, pero con un DOM propio (tarjetas `.card`, no `.card-widget`) y un picker de RANGO
 *       (`app-magiis-ranges-date-picker`).
 *       Selectores derivados del DOM VIVO de la v2.0.17 desplegada en UAT (07/10/2026): el fuente
 *       `refs/v2` (release/v2.0.15) no es el build servido. Las cuatro métricas de distancia
 *       (total, por viaje, por vehículo, por chofer) se ubican por su rótulo bilingüe; «$/Km» y
 *       «Min/Km» NO se modelan (decisión Q3/D-6: observación, fuera del alcance de MG-1193).
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { FlatpickrCalendar, calendarDateFromIso } from '../../shared/FlatpickrCalendar.js';
import { parseDistance, type DistanceReading } from '../../../utils/units.js';
import {
  METRIC_LABEL,
  waitForSummarizedTotals,
  type DistanceMetric,
  type SummarizedStatistics
} from './summarizedTotals.js';

export class OwnerReportPage extends BasePage {
  readonly path = '/carrier/#/owner-report';

  /** Picker de rango (hidden + alt input readonly + botón calendario). */
  readonly rangePicker: Locator;
  /** Tarjeta «Total Trips» / «Total Viajes»: ancla de que el tablero cargó. */
  readonly totalTripsCard: Locator;

  constructor(page: Page) {
    super(page);
    this.rangePicker = page.locator('app-magiis-ranges-date-picker');
    this.totalTripsCard = page
      .locator('.card')
      .filter({ hasText: /total\s+(trips|viajes)/i })
      .first();
  }

  /**
   * Navega al tablero y espera la CARGA INICIAL (resumen del rango por defecto) y la tarjeta de
   * viajes. Hace falta antes de tocar el picker: elegir el rango con la carga inicial en vuelo la
   * pisa (ver RankingReportBase.gotoLoaded).
   */
  async goto(): Promise<void> {
    const initial = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/travels/surrendersSummarizedTotals'),
      { timeout: 30_000 }
    );
    await this.navigate(this.path);
    await initial;
    await expect(this.totalTripsCard).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Elige un rango ISO (`2026-05-01` → `2026-05-31`) y devuelve `statistics` del
   * `surrendersSummarizedTotals` que el front dispara. El rango debe diferir del que muestra el
   * picker: con el mismo no hay consulta nueva. Un solo día = desde y hasta iguales.
   */
  async selectRange(from: string, to: string): Promise<SummarizedStatistics> {
    const calendar = new FlatpickrCalendar(this.page);
    const [statistics] = await Promise.all([
      waitForSummarizedTotals(this.page, from, to),
      (async () => {
        await this.rangePicker.locator('.input-group').click();
        await calendar.pickRange(calendarDateFromIso(from), calendarDateFromIso(to));
      })()
    ]);
    return statistics;
  }

  /** Elemento más chico que lleva el rótulo de la métrica. */
  distanceLabel(metric: DistanceMetric): Locator {
    return this.page.getByText(METRIC_LABEL[metric]).first();
  }

  /**
   * Texto de la métrica: el del propio elemento si trae el número («Total Mi: 7.16 Mi»,
   * «7.16 Mi/ Driver», «Mi/Vehicle: 7.15 Mi») o, si el valor vive en el hermano («Mi/Trip» +
   * «0.45 Mi»), el del contenedor.
   */
  async distanceText(metric: DistanceMetric): Promise<string> {
    const label = this.distanceLabel(metric);
    let text = (await label.innerText()).replace(/\s+/g, ' ').trim();
    if (!/\d/.test(text)) {
      text = (await label.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
    }
    return text;
  }

  /** Lectura «número + unidad» de una métrica. */
  async readDistance(metric: DistanceMetric): Promise<DistanceReading | null> {
    return parseDistance(await this.distanceText(metric));
  }
}
