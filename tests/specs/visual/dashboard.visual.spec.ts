// tests/specs/visual/dashboard.visual.spec.ts
// @visual @P1 @migration
// Regresion visual del dashboard carrier V2.
// El snapshot se genera con --update-snapshots y se versiona en tests/specs/visual/__screenshots__/.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';

test.describe('@visual @P1 @migration Dashboard carrier V2', () => {
  test('dashboard snapshot estable', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-PENDING-dashboard-visual' });

    // Ruta real V2 (Angular 18 + HashLocationStrategy + baseHref /carrier/).
    await visualPage.goto('/carrier/#/dashboard');

    // Esperar shell completo antes del shot.
    // El layout vertical V2 renderiza header + sidebar dentro de LayoutComponent.
    await visualPage.getByRole('banner').waitFor({ state: 'visible' });
    await visualPage.getByRole('navigation').waitFor({ state: 'visible' });

    await expect(visualPage).toHaveScreenshot('dashboard-desktop.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      // TODO: agregar masks por usuario logueado, fechas, contadores dinamicos.
      mask: [
        visualPage.getByTestId('current-user'),
        visualPage.getByTestId('notifications-badge')
      ]
    });
  });
});
