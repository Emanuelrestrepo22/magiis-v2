// tests/specs/drivers/driver-list.spec.ts
// @P1 @functional @migration
import { test, expect } from '../../TestBase.js';
import { DriverListPage } from '../../pages/carrier-v2/DriverListPage.js';

test.describe('@P1 @functional @migration Driver list', () => {
  test('renderiza heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/driver/list' });

    const drivers = new DriverListPage(page);
    await drivers.goto();
    await drivers.expectListReady();
  });

  test('search input acepta input del usuario', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const drivers = new DriverListPage(page);
    await drivers.goto();
    await drivers.search('zz_qa_e2e_no_match');
    await expect(drivers.searchInput).toHaveValue('zz_qa_e2e_no_match');
  });
});
