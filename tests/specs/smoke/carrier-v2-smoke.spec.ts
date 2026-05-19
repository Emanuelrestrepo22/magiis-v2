// tests/specs/smoke/carrier-v2-smoke.spec.ts
// Suite minima de smoke - valida que el shell del portal carrier V2 levanta correctamente
// tras el login automatico de global-setup.ts.
// Alcance reducido a proposito mientras se hace inventario completo de pantallas V2
// (refs/v2 trae solo `main` skeleton; el portal real corre features mergeadas en gitlab).
import { test, expect } from '../../TestBase.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { resolveDashboardPattern } from '../../config/runtime.js';

test.describe('@P1 @functional @migration carrier V2 smoke', () => {
  test('shell del portal carrier V2 carga tras login', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/dashboard' });

    const shell = new ShellPage(page);

    // Llegar al home autenticado - el storageState ya tiene la sesion activa.
    await page.goto('/carrier/#/dashboard');

    // URL real post-login debe contener el patron configurado.
    const dashboardPattern = resolveDashboardPattern();
    await expect(page).toHaveURL(new RegExp(dashboardPattern.replace(/[#/]/g, '\\$&')));

    // El menu carrier debe levantar - usamos el item raiz como ancla del shell.
    await shell.expectShellReady();
  });
});
