// tests/pages/shared/LoginPage.ts
// POM del login del portal carrier V2 (Angular 18).
// Selectores validados contra refs/v2/src/app/account/login/carrier/login-carrier.component.html
// Orden de preferencia aplicado: getByLabel > getByRole > getByTestId > formcontrolname.
/**
 * @jira MX-5711
 * @route /carrier/#/auth/login
 * @priority P1
 * @type both
 * @v1Route /#/authentication/login/carrier
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { resolveLoginPath } from '../../config/runtime.js';

export class LoginPage extends BasePage {
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  /** Error inline cuando credenciales son invalidas (showErrorUser=true). */
  readonly errorMessage: Locator;
  /** Toast global del shell - usado para mensajes no-form-level. */
  readonly toastContainer: Locator;

  constructor(page: Page) {
    super(page);
    // Email/Password: el HTML usa labels for="username|password-input" + formControlName.
    // getByLabel es lo mas robusto frente a cambios visuales y de i18n.
    this.emailInput = page.locator('input#email, input[formcontrolname="email"]').first();
    this.passwordInput = page.locator('input#password-input, input[formcontrolname="password"]').first();
    // Submit: el botón tiene type=submit y texto i18n {{ 'login.sign_in' | translate }}.
    // La regex cubre EN/ES y futuros idiomas razonables.
    this.submitButton = page.getByRole('button', { name: /sign in|iniciar|ingresar/i });
    // Error inline: <span class="error-sign-in"> (V2). Fallback a wrappers de toast.
    this.errorMessage = page.locator('.error-sign-in, .invalid-feedback, .toast-message, .mat-error');
    this.toastContainer = page.locator('app-toasts');
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
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async getErrorText(): Promise<string | null> {
    return this.errorMessage.first().textContent().catch(() => null);
  }
}
