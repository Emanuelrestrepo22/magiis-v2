// tests/specs/visual/gnet-farm-in.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5573 GNET Farm IN.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { GnetFarmInPage } from '../../pages/carrier-v2/GnetFarmInPage.js';

test.describe('@visual @P2 @migration MX-5573 GNET Farm IN - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5573' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/gnet/farm-in' });

    const p = new GnetFarmInPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'gnet-farm-in.png');
  });
});
