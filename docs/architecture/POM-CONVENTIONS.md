# POM Conventions — carrier V2

## Regla de oro

**Una pantalla migrada = un archivo Page Object = un archivo spec (o set de specs por categoria).**

Esto garantiza:

- Escalabilidad lineal: sumar pantallas no toca archivos existentes.
- Reusabilidad clara: cada page expone metodos de negocio.
- Trazabilidad directa con MX-XXXX y ruta V2.

## Naming

| Tipo            | Patron                             | Ejemplo                    |
| --------------- | ---------------------------------- | -------------------------- |
| Page Object     | `<Pantalla>Page.ts` en PascalCase  | `TripsListPage.ts`         |
| Spec functional | `<pantalla>.spec.ts` en kebab-case | `trips-list.spec.ts`       |
| Spec visual     | `<pantalla>.visual.spec.ts`        | `dashboard.visual.spec.ts` |
| Carpeta dominio | minusculas                         | `tests/specs/trips/`       |

## Estructura de un Page Object

```ts
/**
 * @jira MX-XXXX
 * @route /home/carrier/<segmento>
 * @priority P1
 * @type both
 * @v1Route /carrier/legacy/<segmento>   (cuando aplique paridad)
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class <Pantalla>Page extends BasePage {
  // 1. Locators como propiedades readonly privadas.
  private readonly mainHeading: Locator;
  private readonly primaryActionBtn: Locator;
  private readonly itemsTable: Locator;

  // 2. Constructor define locators con orden de preferencia.
  constructor(page: Page) {
    super(page);
    this.mainHeading = page.getByRole('heading', { name: /titulo de la pantalla/i });
    this.primaryActionBtn = page.getByRole('button', { name: /accion principal/i });
    this.itemsTable = page.getByRole('table');
  }

  // 3. Metodos de NEGOCIO (no de UI).
  async goto(): Promise<void> {
    await this.navigate('/home/carrier/<segmento>');
    await expect(this.mainHeading).toBeVisible({ timeout: 10_000 });
  }

  async openPrimaryAction(): Promise<void> {
    await this.primaryActionBtn.click();
  }
}
```

## Orden de preferencia para locators

1. `page.getByRole('button', { name: 'Guardar' })`
   Mejor opcion. Accesibilidad + estabilidad maxima.

2. `page.getByLabel('Correo electronico')`
   Para inputs con `<label>` asociado.

3. `page.getByTestId('save-btn')`
   Si dev agregó `data-testid` en V2. Negociar con dev para que aparezca en V2.

4. `page.getByText('Texto literal estable')`
   Para titulos, labels, items de menu cuando el texto no cambia.

5. `page.locator('[formcontrolname="email"]')`
   Estable en Angular ReactiveForms.

6. `page.locator('[aria-label="..."]')` / `[role="..."]`

7. **Evitar**:
   - `nth-child`, paths CSS profundos (`div > div > span`).
   - Clases CSS autogeneradas (`_ngcontent-*`, `mat-mdc-button-base-1234`).
   - IDs autogenerados (`mat-input-0`).

## Metodos de pagina: que SI, que NO

### SI

- Metodos de negocio: `selectDriver(name)`, `confirmTrip()`, `goToDetail(id)`.
- Validaciones de UI exigidas por el flujo: `expectFormHasError(field, msg)`.
- Helpers de extraccion: `getTripCount()`, `getRowByPlate(plate)`.

### NO

- Asserts finales de la business rule (esos van en el spec).
- Lectura/escritura directa de localStorage (mejor en helpers/utils).
- Llamadas a API/backend (out of scope).

## Cuando crear `BasePage` vs herencia simple

- `BasePage` (ya creado): comun a TODAS las pantallas (header, toasts, dismiss).
- `BaseListPage extends BasePage` (ya creado): listados con heading h2 + search + table + paginacion + PDF. Usar para CUALQUIER pantalla de listado del carrier V2.
- `BaseDetailPage extends BasePage` (ya creado): pantallas de detalle con breadcrumb h4 + bloques de info.
- Si dos pantallas comparten muchos elementos (ej. dos formularios CRUD con la misma plantilla), crear un mid-level: `class FormPageBase extends BasePage`.
- No sobre-abstraer: 3 pantallas similares no justifican base intermedia.

### Decision tree para nuevo POM

1. ¿Es un listado con tabla, search, paginacion? -> `extends BaseListPage`.
2. ¿Es una pantalla de detalle con breadcrumb h4 + bloques? -> `extends BaseDetailPage`.
3. ¿Es otra cosa (login, dashboard, mapa, modal)? -> `extends BasePage`.

### Settlements: patron especifico

Los listados `Settlements*` (Contractor/Driver/Owner/Passenger) usan `extends BaseListPage` y aprovechan helpers nativos:

- `clickFirstRowActionButton(buttonIndex)` — rows con N botones de accion (Create, History, PDF).
- `clickFirstRowLastActionButton()` — cuando el numero de botones varia por tipo de row.
- `getDataRowCount()` — para `test.skip(rowCount === 0, 'sin datos')` en flujos padre -> hijo.

No redeclarar estos metodos en los POMs concretos.

## Gotcha: virtual dispatch en jerarquia de POMs

Cuando un metodo de la clase base llama `this.otroMetodo()` y una subclase override `otroMetodo`, **virtual dispatch resuelve al override del child desde el constructor o desde otros metodos de la base**. Si el override del child a su vez llama al metodo original de la base, se produce recursion infinita -> `RangeError: Maximum call stack size exceeded`.

### Caso real (FW-007b, 2026-05-24)

- `BaseListPage.expectListReadyWithSearch()` llamaba `await this.expectListReady()`.
- `ClientListPage.expectListReady()` (override) llamaba `await this.expectListReadyWithSearch()`.
- Resultado: loop infinito. CI smoke fallo. Typecheck + lint NO lo detectan (es runtime-only).

### Regla

1. **En la subclase, si necesitas extender un metodo de Base, usar `super.X()`** (apunta directo a Base, sin virtual dispatch).

   ```ts
   async expectListReady(): Promise<void> {
     await super.expectListReady();          // ← OK, sin virtual dispatch
     await expect(this.searchInput).toBeVisible();
   }
   ```

   No hacer:

   ```ts
   async expectListReady(): Promise<void> {
     await this.expectListReadyWithSearch();  // ← TRAMPA si Base llama this.expectListReady
   }
   ```

2. **En la base, evitar `this.X()` cuando X sea overridable** y la subclase pueda llamar de vuelta. Preferir inline-ar las assertions:

   ```ts
   // BaseListPage
   async expectListReadyWithSearch(): Promise<void> {
     await expect(this.heading).toBeVisible();   // ← inline
     await expect(this.table).toBeVisible();
     await expect(this.searchInput).toBeVisible();
   }
   ```

3. **Antes de mergear refactor de herencia, correr un smoke real** local (`npx playwright test --grep @P1 --workers=1`). `npm run typecheck + lint` no detecta este tipo de bug.

## Trazabilidad MX-XXXX en specs

```ts
test('@P1 @both @migration MX-1234 trips-list muestra columnas migradas', async ({ page }) => {
  test.info().annotations.push({ type: 'jira', description: 'MX-1234' });
  test.info().annotations.push({ type: 'route_v2', description: '/home/carrier/trips' });

  const tripsList = new TripsListPage(page);
  await tripsList.goto();
  // ...
});
```

## Reutilizacion antes que duplicacion

Antes de crear un `LocatorX` nuevo en tu Page, revisar:

1. ¿`BasePage` ya lo expone? -> usalo.
2. ¿`ShellPage` ya lo cubre (header/sidebar)? -> usalo.
3. ¿`helpers/selectors.ts` tiene `byFormControl`, `tableRowByText`, etc.? -> usalo.
4. Si nada aplica, crearlo PRIVADO en tu Page Object.

## Que va en `tests/pages/shared/` vs `tests/pages/carrier-v2/`

- `shared/`: piezas reutilizables cross-pantalla (Login, Shell, Base, modales globales).
- `carrier-v2/`: una pantalla concreta del portal V2.

Cuando una pantalla "compartida" empieza a tener dependencias de carrier-v2 -> moverla a `carrier-v2/`.
