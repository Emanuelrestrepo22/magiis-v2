// tests/pages/carrier-v2/TravelDashboardPage.ts
/**
 * @jira MX-5529
 * @route /carrier/#/travel/dashboard
 * @priority P1
 * @type functional
 * @note Listado de Viajes - panel principal con tabs por estado + asignacion automatica.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export type TravelTab = 'assign' | 'in-progress' | 'programmed' | 'in-conflict' | 'lost' | 'cancelled' | 'finalized';

export class TravelDashboardPage extends BaseListPage {
  readonly path = '/carrier/#/travel/dashboard';

  protected get headingRegex(): RegExp {
    // El portal V2 renderiza solo "Trips Management" como h4 (no h2). Aceptamos
    // varias variantes para tolerar futuros refactors.
    return /trips? management|gesti[oó]n de viajes|stable trips|trips? dashboard|asignaci[oó]n/i;
  }

  readonly automaticAssignmentCheckbox: Locator;
  readonly vipCheckbox: Locator;
  readonly tabAssign: Locator;
  readonly tabInProgress: Locator;
  readonly tabProgrammed: Locator;
  readonly tabInConflict: Locator;
  readonly tabLost: Locator;
  readonly tabCancelled: Locator;
  readonly tabFinalized: Locator;

  constructor(page: Page) {
    super(page);
    this.automaticAssignmentCheckbox = page.getByRole('checkbox', { name: /automatic assignment|asignaci[oó]n autom/i });
    this.vipCheckbox = page.getByRole('checkbox', { name: /^vip$/i });
    this.tabAssign = page.getByRole('tab', { name: /assign\s*\(\d+\)/i });
    this.tabInProgress = page.getByRole('tab', { name: /in progress\s*\(\d+\)|en curso\s*\(\d+\)/i });
    this.tabProgrammed = page.getByRole('tab', { name: /programmed\s*\(\d+\)|programados?\s*\(\d+\)/i });
    this.tabInConflict = page.getByRole('tab', { name: /in conflict\s*\(\d+\)|en conflicto\s*\(\d+\)/i });
    this.tabLost = page.getByRole('tab', { name: /^lost\s*\(\d+\)|perdidos?\s*\(\d+\)/i });
    this.tabCancelled = page.getByRole('tab', { name: /cancelled\s*\(\d+\)|cancelados?\s*\(\d+\)/i });
    this.tabFinalized = page.getByRole('tab', { name: /finalized\s*\(\d+\)|finalizados?\s*\(\d+\)/i });
  }

  async selectTab(tab: TravelTab): Promise<void> {
    const map: Record<TravelTab, Locator> = {
      assign: this.tabAssign,
      'in-progress': this.tabInProgress,
      programmed: this.tabProgrammed,
      'in-conflict': this.tabInConflict,
      lost: this.tabLost,
      cancelled: this.tabCancelled,
      finalized: this.tabFinalized
    };
    await map[tab].click();
  }

  async expectTabsReady(): Promise<void> {
    await expect(this.tabAssign).toBeVisible();
    await expect(this.tabInProgress).toBeVisible();
    await expect(this.tabFinalized).toBeVisible();
  }
}
