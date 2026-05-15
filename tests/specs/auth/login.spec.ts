// tests/specs/auth/login.spec.ts
// @migration @P1
// Cubre login basico del portal carrier V2 (Angular 18).
// Sin auth fixture aqui: probamos el flujo completo desde sesion limpia.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/shared/LoginPage.js';
import { resolveCredentials } from '../../config/runtime.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('@P1 @functional @migration Login carrier V2', () => {
  test('happy path: credenciales validas redirigen al dashboard', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-PENDING-login-happy' });

    const login = new LoginPage(page);
    const { username, password } = resolveCredentials();

    await login.goto();
    await login.login(username, password);

    await expect(page).toHaveURL(/\/home\/carrier/, { timeout: 20_000 });
  });

  test('credenciales invalidas muestran error visible', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-PENDING-login-invalid' });

    const login = new LoginPage(page);
    await login.goto();
    await login.login('usuario-invalido@test.com', 'password-incorrecto');

    expect(await login.isErrorVisible()).toBe(true);
  });
});
