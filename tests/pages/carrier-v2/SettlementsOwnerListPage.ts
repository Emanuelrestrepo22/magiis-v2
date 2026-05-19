// tests/pages/carrier-v2/SettlementsOwnerListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/owners/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class SettlementsOwnerListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/owners/list';
  protected get headingRegex(): RegExp {
    // El portal renderiza solo "Owners" como h2 (mismo texto que Fleet/OwnerList,
    // pero distinto componente y path - el contexto lo da el goto al path correcto).
    return /^owners?$|^propietarios?$/i;
  }
  constructor(page: Page) { super(page); }
}
