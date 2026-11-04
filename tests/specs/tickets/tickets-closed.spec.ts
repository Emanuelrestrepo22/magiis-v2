import { test, expect } from '../../TestBase.js';
import { TicketsClosedPage } from '../../pages/carrier-v2/tickets/TicketsClosedPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const MX = 'MX-5570';
const ROUTE = '/carrier/#/tickets/closed';

const annotate = makeAnnotate(MX, ROUTE);

test.describe('@P2 @functional Tickets Closed', () => {
  // Pantalla no desarrollada en V2 (CLAUDE.md regla 11): carrier.routing.ts @ v2.0.20 no declara
  // ninguna ruta `tickets` y `git log -S"tickets/closed"` no tiene rastro en el front; la URL cae al
  // dashboard ("Operations Control"). Medido 2026-10-30 en TEST v2.0.20 y en el run 41096592815.
  test.fixme(
    true,
    'Ruta /tickets/closed inexistente en el front V2 (v2.0.20): redirige al dashboard'
  );

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
