// tests/pages/carrier-v2/VehicleListPage.ts
// POM del listado de vehiculos (Vehicles Management) en carrier V2.
/**
 * @jira MX-5711
 * @route /carrier/#/vehicle/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class VehicleListPage extends BaseListPage {
  readonly path = '/carrier/#/vehicle/list';

  /** Switch "All / Only Active" - alterna entre mostrar todos los vehiculos o solo activos. */
  readonly activeFilterSwitch: Locator;
  readonly newVehicleButton: Locator;

  protected get headingRegex(): RegExp {
    return /^vehicles$|^veh[ií]culos$/i;
  }
  protected get breadcrumbRegex(): RegExp | null {
    return /vehicles?\s*\/?\s*vehicles management|veh[ií]culos?\s*\/?\s*gesti[oó]n/i;
  }

  constructor(page: Page) {
    super(page);
    this.activeFilterSwitch = page.getByRole('switch', {
      name: /all\s*only active|todos\s*solo activos/i
    });
    this.newVehicleButton = page.getByRole('button', {
      name: /new vehicle|nuevo veh[ií]culo/i
    });
  }

  async expectListReady(): Promise<void> {
    // super.expectListReady() apunta directo a BaseListPage.expectListReady (heading + table).
    // NO usar this.expectListReadyWithSearch() porque su implementacion en Base llama
    // this.expectListReady() y produciria recursion infinita por virtual dispatch.
    await super.expectListReady();
    await expect(this.searchInput).toBeVisible();
  }

  async toggleActiveFilter(): Promise<void> {
    await this.activeFilterSwitch.click();
  }
}
