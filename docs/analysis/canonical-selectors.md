# Selectores estables canónicos — carrier V2

Lista verificada contra el DOM real de `refs/v2` (snapshot `86b31cc` @ main, 2026-05-15).

## Convención general

Orden de preferencia (de POM-CONVENTIONS.md):
1. `getByRole(role, { name })`
2. `getByLabel(label)`
3. `getByTestId(testId)`
4. `getByText(text)`
5. `locator('[formcontrolname="x"]')` (Angular reactive forms — estable)
6. ❌ Evitar: `nth-child`, CSS profundo, classes autogeneradas (`_ngcontent-*`, `mat-mdc-button-base-*`)

## 1. Login carrier — `/carrier/#/auth/login`

Fuente: [refs/v2/src/app/account/login/carrier/login-carrier.component.html](../../refs/v2/src/app/account/login/carrier/login-carrier.component.html)

| Elemento | Selector recomendado Playwright | Justificación |
| --- | --- | --- |
| Email input | `page.locator('input#email, input[formcontrolname="email"]').first()` | `id="email"` estable + fallback a formControlName. `getByLabel` problemático por placeholder/label i18n. |
| Password input | `page.locator('input#password-input, input[formcontrolname="password"]').first()` | `id="password-input"` estable + fallback a formControlName. |
| Submit | `page.getByRole('button', { name: /sign in\|iniciar\|ingresar/i })` | Texto i18n `login.sign_in`; regex cubre EN/ES. |
| Show/hide password toggle | `page.locator('button#password-addon')` | `id="password-addon"` estable. |
| Error inline credenciales | `page.locator('.error-sign-in')` | Clase única condicional `*ngIf="showErrorUser"`. |
| Toast container | `page.locator('app-toasts')` | Component selector custom único. |
| Logo card | `page.locator('img[alt="Magiis"]')` | Atributo `alt` estable. |
| Card title | `page.getByRole('heading', { level: 5 })` | `<h5 class="text-primary">{{ 'login.card_title' \| translate }}</h5>` |
| Form root | `page.locator('form[formgroup]').first()` o `page.locator('form').first()` | Solo un form en la pantalla. |

### Anti-patrones detectados a evitar

- `.btn-success.w-100` → clases Bootstrap, frágiles si el botón cambia color/ancho.
- `mat-input-0`, `_ngcontent-*` → autogenerados.
- `nth-child(2)` → mutable con futuras adiciones (forgot password está comentado pero podría reaparecer).

## 2. Dashboard carrier skeleton — `/carrier/#/dashboard`

Fuente: [refs/v2/src/app/pages/carrier-dashboard/carrier.component.html](../../refs/v2/src/app/pages/carrier-dashboard/carrier.component.html)

Estado: **skeleton vacío**. Solo renderiza breadcrumb.

| Elemento | Selector recomendado | Notas |
| --- | --- | --- |
| Breadcrumb root | `page.locator('app-breadcrumbs')` | Component selector custom; siempre presente en pantallas internas. |
| Titulo "Dashboard" | `page.getByRole('heading', { name: /dashboard/i })` | El breadcrumb component (verificar refs/v2/src/app/shared/breadcrumbs/) renderiza un heading con el title prop. |

## 3. Shell global (LayoutComponent vertical) — visible en pantallas autenticadas

Fuente: [refs/v2/src/app/layouts/vertical/vertical.component.ts](../../refs/v2/src/app/layouts/vertical/vertical.component.ts) (a inspeccionar al crecer suite).

| Elemento | Selector tentativo | Validación pendiente |
| --- | --- | --- |
| Header (topbar) | `page.getByRole('banner')` | A confirmar contra `layouts/topbar/`. |
| Sidebar | `page.getByRole('navigation')` | A confirmar contra `layouts/sidebar/`. |
| Menú usuario | `page.getByTestId('user-menu')` | **TODO**: pedir a dev agregar `data-testid="user-menu"`. Si no existe aún, usar locator por avatar/icon contextual. |
| Botón logout | `page.getByRole('menuitem', { name: /salir\|logout\|cerrar sesi/i })` | A confirmar tras abrir menú. |

## 4. Reglas para extender este documento

Cuando dev agregue una pantalla nueva en V2:

1. Leer `refs/v2/src/app/.../<pantalla>.component.html`.
2. Listar todos los elementos interactivos del template (inputs, buttons, selects, tables, modals).
3. Para cada uno, elegir el selector más alto en el orden de preferencia.
4. Si no hay opción estable: levantar issue con dev pidiendo `data-testid`.
5. Agregar fila a este documento bajo una sección nueva `## N. <Pantalla>`.
6. Reflejar el cambio en el PageObject correspondiente en `tests/pages/carrier-v2/`.

## 5. Convenciones específicas de ng-bootstrap (presente en V2)

| Componente UI | Selector visible | Patrón Playwright |
| --- | --- | --- |
| `ngb-toast` | `<ngb-toast>` o `.toast.show` | `page.locator('ngb-toast').filter({ hasText: /.../ })` |
| `ngb-pagination` | `<ngb-pagination>` | `page.locator('ngb-pagination button[aria-label="Next"]')` |
| `ngb-dropdown` | `<ngb-dropdown>` (no se usa selector custom) | `page.getByRole('button', { name: ... })` + `page.getByRole('menu')` |
| `ngb-typeahead` | input plain con directiva | `page.getByLabel(...)` + `page.locator('ngb-typeahead-window button')` |

> Mantener los locators **agnósticos a la librería UI** siempre que sea posible (`getByRole`/`getByLabel`). Estas notas son fallbacks cuando ARIA no es suficiente.
