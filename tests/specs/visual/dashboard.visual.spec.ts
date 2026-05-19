// tests/specs/visual/dashboard.visual.spec.ts
// @visual @P1 @migration
// Regresion visual del dashboard carrier V2 (Operations Control real deployado).
// El snapshot se genera con --update-snapshots y se versiona en tests/specs/visual/__screenshots__/.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { OperationsControlPage } from '../../pages/carrier-v2/OperationsControlPage.js';

test.describe('@visual @P1 @migration Dashboard carrier V2', () => {
  test('dashboard snapshot estable', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/dashboard' });

    const ops = new OperationsControlPage(visualPage);
    const shell = new ShellPage(visualPage);

    // Ruta real V2 (Angular 18 + HashLocationStrategy + baseHref /carrier/).
    await ops.goto();

    // Esperar shell + secciones principales antes del shot.
    // ShellPage usa el menu item Operations Control como ancla porque el sidebar
    // del portal V2 NO tiene role="navigation" accesible (bug a11y pendiente con dev).
    await shell.expectShellReady();
    await ops.expectMainSectionsReady();

    await expect(visualPage).toHaveScreenshot('dashboard-desktop.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      // Masks para zonas dinamicas (fecha actual, KPIs con datos volatiles, usuario logueado).
      mask: [
        visualPage.getByText(/^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}/), // timestamp top-right
        visualPage.locator('app-toasts'),
        visualPage.getByLabel(/header avatar/i)
      ]
    });
  });
});
