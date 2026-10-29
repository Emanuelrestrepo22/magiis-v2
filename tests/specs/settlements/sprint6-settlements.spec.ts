// tests/specs/settlements/sprint6-settlements.spec.ts
// Sprint 6 - Release V2.0.2 - Settlements (Liquidaciones) 4 sublistas.
// Trazabilidad: MX-5647 (Liquidaciones, antes bloqueada).
import { test } from '../../TestBase.js';
import { SettlementsContractorListPage } from '../../pages/carrier-v2/settlements/SettlementsContractorListPage.js';
import { SettlementsPassengerListPage } from '../../pages/carrier-v2/settlements/SettlementsPassengerListPage.js';
import { SettlementsDriverListPage } from '../../pages/carrier-v2/settlements/SettlementsDriverListPage.js';
import { SettlementsOwnerListPage } from '../../pages/carrier-v2/settlements/SettlementsOwnerListPage.js';

test.describe('@P1 @functional @migration Sprint 6 - Release V2.0.2 settlements', () => {
  test('MX-5647 Settlements Contractor list - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'tms', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/contractors/list'
    });

    const p = new SettlementsContractorListPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5647 Settlements Passenger list - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'tms', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/passenger/list'
    });

    const p = new SettlementsPassengerListPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5647 Settlements Driver list - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'tms', description: 'MX-5647' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/liquidations/drivers/list' });

    const p = new SettlementsDriverListPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5647 Settlements Owner list - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'tms', description: 'MX-5647' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/liquidations/owners/list' });

    const p = new SettlementsOwnerListPage(page);
    await p.goto();
    await p.expectListReady();
  });
});
