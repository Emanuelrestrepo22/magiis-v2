// tests/specs/customers/client-list.spec.ts
// @P1 @functional @migration
import { test, expect } from '../../../TestBase.js';
import { ClientListPage } from '../../../pages/carrier-v2/ClientListPage.js';

test.describe('@P1 @functional @migration Client list', () => {
  test('renderiza heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5197' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/client/list' });

    const clients = new ClientListPage(page);
    await clients.goto();
    await clients.expectListReady();
  });

  test('search input acepta input del usuario', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5197' });

    const clients = new ClientListPage(page);
    await clients.goto();
    await clients.search('zz_qa_e2e_no_match');
    await expect(clients.searchInput).toHaveValue('zz_qa_e2e_no_match');
  });

  test('paginacion expone navegacion Previous/Next', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5197' });
    test.info().annotations.push({
      type: 'note',
      description:
        'El page size selector es ng-select (combobox hidden); validamos solo la navegacion estable.'
    });

    const clients = new ClientListPage(page);
    await clients.goto();
    // La barra de paginacion es un <nav> con role navigation que contiene Previous/Next.
    await expect(clients.previousPageLink).toBeVisible();
    await expect(clients.nextPageLink).toBeVisible();
  });
});
