// tests/pages/carrier-v2/DashboardCarrierPage.ts
// POM del dashboard carrier V2 (Angular 18) en su estado actual: skeleton.
// Validado contra refs/v2/src/app/pages/carrier-dashboard/carrier.component.html
// que actualmente solo renderiza <app-breadcrumbs title="DASHBOARD">.
/**
 * @jira MX-5711
 * @route /carrier/#/dashboard
 * @priority P1
 * @type functional
 * @note Pantalla en estado skeleton. Los widgets reales se sumaran conforme
 *       dev migre cada modulo. Este POM cubre el contrato actual: breadcrumb visible
 *       + URL post-login correcta + shell renderizado.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class DashboardCarrierPage extends BasePage {
  /** Breadcrumb principal: <app-breadcrumbs title="DASHBOARD">. */
  private readonly breadcrumb: Locator;
  /** Titulo de la pantalla via aria heading. */
  private readonly pageTitle: Locator;

  constructor(page: Page) {
    super(page);
    this.breadcrumb = page.locator('app-breadcrumbs');
    this.pageTitle = page.getByRole('heading', { name: /dashboard/i });
  }

  /**
   * Navega al dashboard. Asume sesion activa (storageState de globalSetup).
   * URL real: /carrier/#/dashboard (HashLocationStrategy + baseHref /carrier/).
   */
  async goto(): Promise<void> {
    await this.navigate('/carrier/#/dashboard');
    await expect(this.breadcrumb).toBeVisible({ timeout: 15_000 });
  }

  /** Verifica que el contrato actual del skeleton se cumple. */
  async expectSkeletonReady(): Promise<void> {
    await expect(this.breadcrumb).toBeVisible();
    await expect(this.pageTitle).toBeVisible();
  }
}
