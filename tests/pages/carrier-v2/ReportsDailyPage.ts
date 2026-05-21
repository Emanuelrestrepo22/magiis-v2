// tests/pages/carrier-v2/ReportsDailyPage.ts
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
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsDailyPage extends BaseListPage {
  readonly path = '/carrier/#/reports/daily';

  /** Date picker flatpickr (single date selector). */
  readonly datePickerInput: Locator;
  /** Container principal del dashboard (proxy de "tabla" para tests genericos). */
  readonly dashboardContainer: Locator;

  protected get headingRegex(): RegExp {
    // Heading h4 con texto "Daily" (puede tener icono mdi prefix).
    return /daily/i;
  }

  constructor(page: Page) {
    super(page);
    // flatpickr-input es el date picker real (sin placeholder generico).
    this.datePickerInput = page.locator('input.flatpickr-input').first();
    // Container del dashboard = primer .container-fluid dentro de la pagina.
    this.dashboardContainer = page.locator('.container-fluid').first();
  }

  /**
   * Daily Report no tiene tabla principal con sort/pagination - override expectListReady.
   * Validamos heading h4 + container dashboard.
   */
  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
    await expect(this.dashboardContainer).toBeVisible();
  }
}
