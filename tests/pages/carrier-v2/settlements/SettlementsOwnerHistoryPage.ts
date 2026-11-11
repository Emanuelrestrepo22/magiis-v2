// tests/pages/carrier-v2/settlements/SettlementsOwnerHistoryPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/owners/history/:id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsOwnerHistoryPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // Breadcrumb h4 real (verificado 2026-09-01): "Settlements / Owners Settlement/ Record".
    // No hay h2 "Record Settlements"; el separador antes de "Record" es "/" sin espacio previo.
    // TEST 11/11: "Settlements / Owners / Record". Se aceptan ambos mientras UAT/PROD conserven el viejo.
    return /owners settlement\s*\/\s*record|settlements?\s*\/\s*owners\s*\/\s*record/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
