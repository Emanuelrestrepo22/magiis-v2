# tests/pages/carrier-v2

Page Objects del portal carrier V2 (Angular 18). **Un archivo por pantalla migrada**.

## Convencion de naming

`<NombrePantalla>Page.ts` en PascalCase. Ejemplos:

- `DashboardPage.ts`
- `TripsListPage.ts`
- `TripDetailPage.ts`
- `DriversListPage.ts`
- `VehiclesListPage.ts`
- `OperationalSettingsPage.ts`

Cada page debe:

1. **Extender `BasePage`** (heredar utilidades comunes).
2. **Declarar locators como propiedades readonly** en el constructor.
3. **Exponer metodos de negocio** (`openTripDetail(id)`, `searchByPlate(plate)`), NO de UI (`clickButton(x)`).
4. **Trazabilidad**: comentario JSDoc inicial con `@jira MX-XXXX`.
5. **Validacion DOM**: cada locator debe estar verificable en `refs/v2/src/app/**/*.component.html`.

## Orden de preferencia para locators

1. `page.getByRole('button', { name: 'Guardar' })`
2. `page.getByLabel('Correo electronico')`
3. `page.getByTestId('save-btn')` (cuando dev agregue `data-testid`)
4. `page.getByText('Texto estable')`
5. `page.locator('[formcontrolname="x"]')` (Angular reactive forms - estable)
6. ❌ Evitar: `nth-child`, CSS profundo, classes autogeneradas `_ngcontent-*`

## Plantilla base

```ts
// tests/pages/carrier-v2/TripsListPage.ts
/**
 * @jira MX-XXXX
 * @route /home/carrier/trips
 * @priority P1
 * @type both
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class TripsListPage extends BasePage {
  private readonly newTripBtn: Locator;
  private readonly searchInput: Locator;
  private readonly tripsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.newTripBtn = page.getByRole('button', { name: /nuevo viaje/i });
    this.searchInput = page.getByLabel('Buscar viaje');
    this.tripsTable = page.getByRole('table');
  }

  async goto(): Promise<void> {
    await this.navigate('/home/carrier/trips');
    await expect(this.tripsTable).toBeVisible({ timeout: 10_000 });
  }

  async searchTrip(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
  }

  async openNewTrip(): Promise<void> {
    await this.newTripBtn.click();
  }
}
```

## Lista de pantallas a crear (de MX-4820)

Pendiente de poblar tras destrabar Jira MCP. Cada item se mappea 1:1 a un archivo.

| MX-XXXX | Pantalla | Page Object file | Prioridad |
| --- | --- | --- | --- |
| _pending_ | | | |
