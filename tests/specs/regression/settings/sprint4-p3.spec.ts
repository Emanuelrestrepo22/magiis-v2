// tests/specs/release-v2.0.2/sprint4-p3.spec.ts
// Sprint 4 - Release V2.0.2 - Configuracion auxiliar.
import { test } from '../../../TestBase.js';
import { SettingsOtherCostsPage } from '../../../pages/carrier-v2/SettingsOtherCostsPage.js';

test.describe('@P3 @functional @migration Sprint 4 - Release V2.0.2 settings', () => {
  test('MX-5575 Other Costs - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5575' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/settings/otherCosts' });

    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await p.expectListReady();
  });
});
