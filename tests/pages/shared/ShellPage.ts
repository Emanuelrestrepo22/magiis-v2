// tests/pages/shared/ShellPage.ts
// POM del shell global del portal carrier V2 (header + sidebar + user menu).
// Reutilizable desde cualquier pantalla autenticada.
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class ShellPage extends BasePage {
  readonly header: Locator;
  readonly sidebar: Locator;
  readonly userMenu: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    super(page);
    // TODO: ajustar selectores con DOM real V2.
    this.header = page.getByRole('banner');
    this.sidebar = page.getByRole('navigation');
    this.userMenu = page.getByTestId('user-menu');
    this.logoutButton = page.getByRole('menuitem', { name: /salir|logout|cerrar sesi[oó]n/i });
  }

  async expectShellReady(): Promise<void> {
    await expect(this.header).toBeVisible({ timeout: 10_000 });
    await expect(this.sidebar).toBeVisible({ timeout: 10_000 });
  }

  async logout(): Promise<void> {
    await this.userMenu.click();
    await this.logoutButton.click();
  }
}
