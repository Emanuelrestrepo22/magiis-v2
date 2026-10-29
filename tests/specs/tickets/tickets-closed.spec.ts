import { test, expect } from '../../TestBase.js';
import { TicketsClosedPage } from '../../pages/carrier-v2/tickets/TicketsClosedPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const MX = 'MX-5570';
const ROUTE = '/carrier/#/tickets/closed';

const annotate = makeAnnotate(MX, ROUTE);

test.describe('@P2 @functional Tickets Closed', () => {
  test('TC01 acceso a la pantalla y carga sin error', async ({ page }) => {
    annotate('TC01', 'HP');

    const screen = new TicketsClosedPage(page);
    await screen.goto();
    await expect(screen.heading).toBeVisible();
  });

  test('TC02 heading y tabla visibles', async ({ page }) => {
    annotate('TC02', 'HP');

    const screen = new TicketsClosedPage(page);
    await screen.goto();
    await screen.expectListReady();
  });

  test('TC03 search input acepta input del usuario', async ({ page }) => {
    annotate('TC03', 'EC');

    const screen = new TicketsClosedPage(page);
    await screen.goto();
    await screen.search('zz_qa_e2e_no_match');
    await expect(screen.searchInput).toHaveValue('zz_qa_e2e_no_match');
  });
});
