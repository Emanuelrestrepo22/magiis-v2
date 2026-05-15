// tests/fixtures/authFixture.ts
// Fixture de autenticacion: provee LoginPage y ShellPage listos para usar.
// El storageState se levanta una vez en global-setup.ts; este fixture solo aporta los POMs.
import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/shared/LoginPage.js';
import { ShellPage } from '../pages/shared/ShellPage.js';

type AuthFixtures = {
  loginPage: LoginPage;
  shellPage: ShellPage;
};

export const test = base.extend<AuthFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  shellPage: async ({ page }, use) => {
    await use(new ShellPage(page));
  }
});

export { expect };
