// tests/specs/smoke/carrier-v2-smoke.spec.ts
// Suite minima de smoke para validar que el shell carrier V2 levanta correctamente.
// Corre rapido y se ejecuta en CI antes de cualquier suite mas pesada.
import { test, expect } from '../../TestBase.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';

test.describe('@P1 @functional @migration carrier V2 smoke', () => {
  test('shell del portal carrier V2 carga tras login', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-PENDING-smoke' });

    const shell = new ShellPage(page);
    await page.goto('/');
    await shell.expectShellReady();

    // Validar URL del dashboard.
    await expect(page).toHaveURL(/\/home\/carrier/);
  });
});
