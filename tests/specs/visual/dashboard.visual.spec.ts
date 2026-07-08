// tests/specs/visual/dashboard.visual.spec.ts
// @visual @P1 @migration
// Regresion visual del shell del portal carrier V2.
// Captura solo el SIDEBAR completo (region scrollable) porque es la zona mas estable:
// - 17 items siempre visibles en el mismo orden.
// - Fonts custom (gnet/magiis icons) cargadas via fonts.ready.
// - No tiene datos volatiles ni async content.
// El dashboard body (Operations Control con KPIs/tabla drivers/mapa) es muy dinamico
// y produce diffs masivos entre los dos snapshots de retry; se cubre en specs
// dedicados por widget cuando el equipo defina el alcance visual concreto.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { OperationsControlPage } from '../../pages/carrier-v2/OperationsControlPage.js';

test.describe('@visual @P1 @migration Sidebar carrier V2', () => {
  test('sidebar render estable post-login', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/dashboard' });

    const ops = new OperationsControlPage(visualPage);
    const shell = new ShellPage(visualPage);

    await ops.goto();
    await shell.expectShellReady();

    // El sidebar V2 vive dentro de un <div role="region" name="scrollable content">.
    const sidebar = visualPage.getByRole('region', { name: /scrollable content/i });
    await expect(sidebar).toBeVisible();

    // Threshold absoluto (no ratio) por consistencia con captureCardAboveTheFold
    // (fixtures/visualBaseline.ts). El sidebar mide ~240x1080 px y sus iconos
    // custom (gnet/magiis) suelen tener antialiasing sub-pixel variable entre
    // runs de Linux; con ratio 0.001 fallaba por 3000+ px de diff en iconos.
    // maxDiffPixelRatio: 1 desactiva el default global (0.005) del config.
    await expect(sidebar).toHaveScreenshot('sidebar-desktop.png', {
      maxDiffPixels: 15000,
      maxDiffPixelRatio: 1,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret
    });
  });
});
