// tests/specs/visual/other-costs.visual.spec.ts
// @visual @P3 @migration - Regresion visual MX-5575 Settings Other Costs.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { SettingsOtherCostsPage } from '../../pages/carrier-v2/SettingsOtherCostsPage.js';

test.describe('@visual @P3 @migration MX-5575 Settings Other Costs - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5575' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/settings/otherCosts' });

    const p = new SettingsOtherCostsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'other-costs.png');
  });
});
