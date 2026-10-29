// tests/fixtures/authFixture.ts
// Fixture de autenticacion: provee LoginPage y ShellPage listos para usar.
// El storageState se levanta una vez en global-setup.ts; este fixture solo aporta los POMs.
import { test as base, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/shared/LoginPage.js';
import { ShellPage } from '../pages/shared/ShellPage.js';

/**
 * Red de seguridad de idioma (storageState alterado a mano, p.ej. 'es-ar'): tras la PRIMERA
 * navegacion del test, si el boton de idioma del topbar esta visible exige 'EN' y, si no, lo
 * cambia con ShellPage.setLanguage('en'). Si el topbar no aparece (login, pantallas sin shell)
 * no hace nada. global-setup ya normaliza el storageState; esto cubre el resto.
 */
async function guardEnglishAfterFirstGoto(page: Page): Promise<void> {
  const original = page.goto.bind(page);
  let guarded = false;
  page.goto = (async (...args: Parameters<Page['goto']>) => {
    const response = await original(...args);
    if (guarded) return response;
    guarded = true;
    const shell = new ShellPage(page);
    const shown = await shell.languageToggle
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(
        () => true,
        () => false
      );
    if (shown) {
      if ((await shell.languageToggle.first().innerText()).trim() !== 'EN') {
        await shell.setLanguage('en');
      }
      await expect(shell.languageToggle.first()).toHaveText('EN');
    }
    return response;
  }) as Page['goto'];
}

type AuthFixtures = {
  loginPage: LoginPage;
  shellPage: ShellPage;
};

export const test = base.extend<AuthFixtures>({
  page: async ({ page }, use) => {
    await guardEnglishAfterFirstGoto(page);
    await use(page);
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  shellPage: async ({ page }, use) => {
    await use(new ShellPage(page));
  }
});

export { expect };
