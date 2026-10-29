/**
 * @jira MX-5570
 * @route /carrier/#/tickets/closed
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class TicketsClosedPage extends BaseListPage {
  readonly path = '/carrier/#/tickets/closed';

  protected get headingRegex(): RegExp {
    return /^closed$|^cerrados?$|tickets.+closed|tickets.+cerrados?/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
