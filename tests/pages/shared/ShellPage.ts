// tests/pages/shared/ShellPage.ts
// POM del shell global del portal carrier V2 (header + sidebar + user menu).
// Reutilizable desde cualquier pantalla autenticada.
//
// NOTA: V2 deployado NO marca el sidebar con role="navigation" ni el header con role="banner"
// de forma consistente. Por eso anclamos el shell ready a un menu item siempre presente
// ("Operations Control" / "Control Operaciones"), que es la entrada por defecto del sidebar
// para el rol carrier.
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class ShellPage extends BasePage {
  readonly header: Locator;
  readonly sidebar: Locator;
  /** Primer item del sidebar carrier - sirve como ancla de "shell listo". */
  readonly operationsControlMenuItem: Locator;
  readonly userMenu: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    super(page);
    // header / sidebar: dejamos los selectors ARIA aspiracionales como fallback
    // pero el ready check usa el menu item por estabilidad.
    this.header = page.getByRole('banner');
    this.sidebar = page.locator('aside, nav, .vertical-menu, .navbar-menu, .app-menu').first();
    this.operationsControlMenuItem = page
      .getByRole('link', { name: /operations control|control operaciones/i })
      .or(page.getByText(/^operations control$|^control operaciones$/i))
      .first();
    this.userMenu = page.getByTestId('user-menu');
    this.logoutButton = page.getByRole('menuitem', { name: /salir|logout|cerrar sesi[oó]n/i });
  }

  /** Considera el shell listo cuando el item raiz del sidebar esta visible. */
  async expectShellReady(): Promise<void> {
    await expect(this.operationsControlMenuItem).toBeVisible({ timeout: 15_000 });
  }

  async logout(): Promise<void> {
    await this.userMenu.click();
    await this.logoutButton.click();
  }
}
