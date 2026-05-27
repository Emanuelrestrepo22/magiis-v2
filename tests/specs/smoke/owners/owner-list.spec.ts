// tests/specs/owners/owner-list.spec.ts
// @P1 @functional @migration
import { test, expect } from '../../../TestBase.js';
import { OwnerListPage } from '../../../pages/carrier-v2/OwnerListPage.js';

test.describe('@P1 @functional @migration Owner list', () => {
  test('renderiza heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5604' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/owner/list' });

    const owners = new OwnerListPage(page);
    await owners.goto();
    await owners.expectListReady();
  });

  test('search input acepta input del usuario', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5604' });

    const owners = new OwnerListPage(page);
    await owners.goto();
    await owners.search('zz_qa_e2e_no_match');
    await expect(owners.searchInput).toHaveValue('zz_qa_e2e_no_match');
  });
});
