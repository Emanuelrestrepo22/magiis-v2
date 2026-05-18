# Análisis comparativo V1 (Angular 8) vs V2 (Angular 18) — carrier portal

Snapshot: 2026-05-15. Refs analizados:
- V1: `refs/v1` (HEAD `f180b91`, branch `main`, repo `gitlab.com/repo.magiis/magiis-fe`)
- V2: `refs/v2` (HEAD `86b31cc`, branch `main`, repo `gitlab.com/repo.magiis/magiis-fe-carrier-v2`)

## 1. Stack y dependencias

| Tema | V1 (Angular 8) | V2 (Angular 18 base) |
| --- | --- | --- |
| Angular runtime | 8.x (legado, mono-repo multi-rol) | 18.0.4 (rol-único: carrier) |
| Arquitectura de componentes | NgModule + ViewEngine | **Sigue siendo NgModule** (no standalone). Mismo loadChildren con `then(m => m.XModule)` |
| Routing | `RouterModule.forRoot(routes)` en `app.routing.ts` | `RouterModule.forRoot(routes)` en `app-routing.module.ts` (idéntico patrón) |
| Library UI primaria | (V1 usa CSS custom + Bootstrap nativo + `fa fa-*` icons) | **ng-bootstrap** (`NgbToast`, `NgbDropdown`, `NgbPagination`, `NgbTypeahead`, `NgbTooltip`, `NgbProgressbar`) + `angular-feather` icons |
| Otras libs visibles | RxJS legacy, FormsModule básico | ng-apexcharts, ngx-leaflet, fullcalendar, ng-select, flatpickr, ckeditor5, ngx-countup, simplebar |
| LocationStrategy | hash (`#`) | hash (`#`) — sin cambio |
| baseHref deploy | `/` raíz | **`/carrier/`** (rol único bajo subpath) |
| i18n | `@ngx-translate/core` con keys `carrier.login.*` | `@ngx-translate/core` con keys `login.*` (namespace plano) |

> **Implicación QA**: tests deben usar locators agnósticos a la librería UI (`getByRole`, `getByLabel`) en lugar de selectores específicos del framework (`.mat-*`, `.p-*`, `.ngb-*`). El cambio de namespace i18n (`carrier.login.*` → `login.*`) NO afecta los locators porque usamos texto renderizado.

## 2. Routing real validado por código

### V1 (multi-rol)
- Login carrier: `/#/authentication/login/carrier` → `LoginCarrierComponent` (`refs/v1/src/app/authentication/login/carrier/`)
- App tenía rutas separadas por rol: `authentication/login/admin`, `/contractor`, `/owner`, `/carrier`.

### V2 (rol único carrier, snapshot @ main)
| Path final | Componente V2 | Estado |
| --- | --- | --- |
| `/carrier/#/auth/login` | `LoginCarrierComponent` (`refs/v2/src/app/account/login/carrier/`) | ✅ funcional |
| `/carrier/#/auth/register` | `RegisterComponent` | 🟡 stub (declarado pero no validado) |
| `/carrier/#/dashboard` | `CarrierDashboardComponent` (`refs/v2/src/app/pages/carrier-dashboard/`) | 🟡 **skeleton: solo `<app-breadcrumbs title="DASHBOARD">`** |
| `/carrier/#/auth/signin`/`signup`/`pass-reset`/`errors`/... | Componentes del template Velzon | ❌ NO usados por el flujo real (lazy modules sin entrypoint del producto) |

### Estado actual de la migración (importante)
El repo V2 en `main` está como **skeleton + login funcional**. El último commit es:
```
86b31cc terminado skeleton de carrier, login con setteo de translateServices como en admin, y menu como en admin
```
Las 25 pantallas listadas en el filtro MX-4820 corresponden a **tickets de planificación cerrados**, no a pantallas implementadas en V2. La automatización debe partir cubriendo lo que existe hoy (login + dashboard skeleton) y crecer conforme dev migre cada módulo.

## 3. Componentes ya migrados — comparativa por pantalla

### Login carrier — V1 vs V2

| Tema | V1 | V2 |
| --- | --- | --- |
| Path final | `/#/authentication/login/carrier` | `/carrier/#/auth/login` |
| Component selector | `login-carrier` | `login-carrier` |
| Form group property | `myForm` | **`loginForm`** (cambio) |
| Email input | `formControlName="email"` + `type="text"` + placeholder i18n `carrier.login.email` | `formControlName="email"` + `id="email"` + `type="email"` + label i18n `login.email` + placeholder i18n `login.enter_email` |
| Password input | `formControlName="password"` + `type="password"` + placeholder i18n `carrier.login.password` | `formControlName="password"` + `id="password-input"` + `type` dinámico (toggle show/hide via `mdi-eye-*`) + label i18n `login.password` |
| Submit button | `<button type="submit" class="btn btn-primary btn-lg ingresar">` + texto i18n `carrier.login.login_enter` | `<button type="submit" class="btn btn-success w-100">` + texto i18n `login.sign_in` |
| Forgot password | `(click)="forgotPassword()"` con `btn btn-link` | Comentado en V2 (no hay link visible) |
| Register link | `(click)="registration()"` con `btn btn-link` | Comentado en V2 |
| Error feedback | (depende de servicio `_notificationService`, comentado en código V1) | **Inline** `span.error-sign-in` con texto i18n `login.error_sign_in` cuando `showErrorUser=true` |
| Toast container | (no observado en V1 login) | `<app-toasts aria-live="polite" aria-atomic="true">` (custom component basado en `NgbToast`) |
| Show/hide password toggle | ❌ no presente | ✅ presente (icon `mdi-eye-outline`/`mdi-eye-off-outline`) |
| Loading state | `loadingSignIn` (boolean) deshabilita doble submit | `loadingSignIn` (boolean) + `[disabled]="loadingSignIn"` en el botón |
| Layout | 2 columnas custom (`card-login-left` + `card-login-right`) | 1 columna centrada Velzon (`auth-page-wrapper` + `card-bg-fill`) |

### Dashboard carrier — V1 vs V2

| Tema | V1 | V2 |
| --- | --- | --- |
| Path | `/#/views/dashboard` (vía `views/dashboard/dashboard-routing.module.ts`) | `/carrier/#/dashboard` |
| Componente | `DashboardComponent` (en V1 `views/dashboard/`) | `CarrierDashboardComponent` (en V2 `pages/carrier-dashboard/`) |
| Contenido visible | Widgets reales (no inspeccionados en este snapshot) | **Vacío: solo `<app-breadcrumbs title="DASHBOARD">`** |
| Estado | Producción | Skeleton inicial |

## 4. Deltas funcionales conocidos

1. **Login error UX**: V1 dependía de `_notificationService` (toast). V2 muestra error **inline** debajo del form (`.error-sign-in`).
2. **i18n namespace**: V1 = `carrier.login.*`. V2 = `login.*`.
3. **Layout login**: V1 usa diseño 2 columnas custom; V2 adopta el template Velzon (1 columna centrada).
4. **Toggle password**: V2 agrega visibilidad de password (no existía en V1).
5. **Forgot/Register links**: ocultos/comentados en V2 (decisión consciente, no bug).
6. **baseHref**: V2 sirve bajo `/carrier/` (rol único) mientras V1 servía la raíz multi-rol.
7. **Dashboard**: V2 está en **skeleton**, no tiene paridad funcional con V1 todavía.

## 5. Riesgos de regresión visual

| Área | Riesgo | Mitigación |
| --- | --- | --- |
| Login layout | Alto (cambio total de columnas) | Tratar V2 como **baseline evolutivo**, no paridad pixel V1. |
| i18n keys | Medio | Tests usan regex multilingüe (`/sign in\|iniciar\|ingresar/i`). |
| Dashboard | N/A (skeleton vs vacío) | Solo validar breadcrumb hasta que dev agregue widgets. |

## 6. Selectores estables canónicos

Ver [canonical-selectors.md](./canonical-selectors.md) para la lista priorizada.

## 7. Próximos pasos cuando dev avance la migración

Cuando un módulo nuevo aparezca en V2, esta tabla debe extenderse siguiendo el patrón:
1. Identificar el nuevo `*-routing.module.ts` en `refs/v2`.
2. Mapear path V1 ↔ V2.
3. Inspeccionar el HTML real del componente V2 para extraer selectores estables.
4. Crear `<Pantalla>Page.ts` en `tests/pages/carrier-v2/`.
5. Crear spec funcional + visual + (opcional) a11y.
6. Anotar en este documento bajo "Componentes ya migrados".
