// tests/specs/auth/login.spec.ts
// @migration @P1
// Cubre login basico del portal carrier V2 (Angular 18) - happy path + credenciales invalidas.
// Sin auth fixture aqui: probamos el flujo completo desde sesion limpia.
// Trazabilidad: MX-5711 (esfuerzo de migracion Angular 8 -> 18).
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/shared/LoginPage.js';
import { resolveCredentials, resolveDashboardPattern } from '../../config/runtime.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('@P1 @functional @migration Login carrier V2', () => {
  test('happy path: credenciales validas redirigen al dashboard', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/auth/login' });

    const login = new LoginPage(page);
    const { username, password } = resolveCredentials();
    const dashboardPattern = resolveDashboardPattern();

    await login.goto();
    await login.login(username, password);

    await expect(page).toHaveURL(new RegExp(dashboardPattern.replace(/[#/]/g, '\\$&')), {
      timeout: 20_000
    });
  });

  test('credenciales invalidas muestran error visible', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'note', description: 'V2 muestra <span class="error-sign-in"> cuando showErrorUser=true' });

    const login = new LoginPage(page);
    await login.goto();
    await login.login('usuario-invalido@test.com', 'password-incorrecto');

    expect(await login.isErrorVisible()).toBe(true);
  });
});
