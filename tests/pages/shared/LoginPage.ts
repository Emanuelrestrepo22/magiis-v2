// tests/pages/shared/LoginPage.ts
// POM del login del portal carrier V2 (Angular 18).
// Selectores: orden de preferencia getByRole > getByLabel > getByTestId > formcontrolname.
// IMPORTANTE: validar contra refs/v2/src/app/**/*login*.component.html cuando se clone el repo V2.
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { resolveLoginPath } from '../../config/runtime.js';

export class LoginPage extends BasePage {
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    // Fallbacks a formcontrolname mientras se valida el DOM real V2.
    // TODO: reemplazar por getByLabel('Correo') / getByLabel('Contrasena') cuando se confirme.
    this.emailInput = page.locator('input[formcontrolname="email"]');
    this.passwordInput = page.locator('input[formcontrolname="password"]');
    this.submitButton = page.getByRole('button', { name: /iniciar|login|ingresar/i });
    this.errorMessage = page.locator('.toast-message, .mat-error, .p-error');
  }

  async goto(): Promise<void> {
    const loginPath = resolveLoginPath();
    await this.navigate(loginPath);
    await expect(this.emailInput).toBeVisible({ timeout: 15_000 });
  }

  async login(username: string, password: string): Promise<void> {
    await this.emailInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async isErrorVisible(timeout = 5000): Promise<boolean> {
    return this.errorMessage
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async getErrorText(): Promise<string | null> {
    return this.errorMessage.textContent().catch(() => null);
  }
}
