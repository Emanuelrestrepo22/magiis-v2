# Reporte de Auditoria A11y - Release V2.0.4

> **Generado**: 2026-05-21 via `npm run test:a11y`
> **Standard**: WCAG 2.1 AA (axe-core via @axe-core/playwright)
> **Modo**: Soft audit - 16/16 specs pasan, violations expuestas como findings QA

## Resumen ejecutivo

### Violations por regla (agregado 16 pantallas)

| Severity    | Regla WCAG              | Pantallas afectadas | Total nodos | Diagnostico                                                             |
| ----------- | ----------------------- | ------------------: | ----------: | ----------------------------------------------------------------------- |
| 🔴 critical | `button-name`           |             16 / 16 |          64 | Buttons icon-only sin aria-label (refresh, PDF, config columnas).       |
| 🔴 critical | `label`                 |             10 / 16 |          19 | Form inputs sin <label for> o aria-label (search, dropdowns ng-select). |
| 🟡 serious  | `color-contrast`        |             16 / 16 |         320 | Texto con contraste < 4.5:1 (theme issue global).                       |
| 🟡 serious  | `link-name`             |             16 / 16 |          36 | Links con solo icono o texto vacio (config columnas).                   |
| 🟡 serious  | `html-has-lang`         |             16 / 16 |          16 | <html> sin attr lang (Angular index.html).                              |
| 🟡 serious  | `autocomplete-valid`    |              7 / 16 |          12 | autocomplete attr con valor invalido HTML5.                             |
| 🟡 serious  | `aria-progressbar-name` |             11 / 16 |          11 | Spinners role=progressbar sin aria-label.                               |

## Findings por pantalla

### MX-5554 - affiliate checking account

- **Ruta**: `/carrier/#/affiliate/checking-account`
- **Spec**: `tests/specs/a11y/affiliate-checking-account-a11y.spec.ts`
- **Resumen**: 2 critical + 4 serious = 6 categorias

| Severity    | Rule                 | Nodos |
| ----------- | -------------------- | ----: |
| 🟡 serious  | `autocomplete-valid` |     2 |
| 🔴 critical | `button-name`        |     3 |
| 🟡 serious  | `color-contrast`     |    12 |
| 🟡 serious  | `html-has-lang`      |     1 |
| 🔴 critical | `label`              |     2 |
| 🟡 serious  | `link-name`          |     2 |

### MX-5571 - agency commissions

- **Ruta**: `/carrier/#/reports/agency-commissions`
- **Spec**: `tests/specs/a11y/agency-commissions-a11y.spec.ts`
- **Resumen**: 2 critical + 5 serious = 7 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🟡 serious  | `autocomplete-valid`    |     1 |
| 🔴 critical | `button-name`           |     3 |
| 🟡 serious  | `color-contrast`        |    16 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     1 |
| 🟡 serious  | `link-name`             |     3 |

### MX-5561 - aging report

- **Ruta**: `/carrier/#/reports/debt-aging`
- **Spec**: `tests/specs/a11y/aging-report-a11y.spec.ts`
- **Resumen**: 2 critical + 5 serious = 7 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🟡 serious  | `autocomplete-valid`    |     2 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    15 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     2 |
| 🟡 serious  | `link-name`             |     3 |

### MX-5562 - cash flow

- **Ruta**: `/carrier/#/reports/cash-flow`
- **Spec**: `tests/specs/a11y/cash-flow-a11y.spec.ts`
- **Resumen**: 2 critical + 3 serious = 5 categorias

| Severity    | Rule             | Nodos |
| ----------- | ---------------- | ----: |
| 🔴 critical | `button-name`    |     2 |
| 🟡 serious  | `color-contrast` |    16 |
| 🟡 serious  | `html-has-lang`  |     1 |
| 🔴 critical | `label`          |     3 |
| 🟡 serious  | `link-name`      |     3 |

### MX-5438 - daily report

- **Ruta**: `/carrier/#/reports/daily`
- **Spec**: `tests/specs/a11y/daily-report-a11y.spec.ts`
- **Resumen**: 1 critical + 4 serious = 5 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     3 |
| 🟡 serious  | `color-contrast`        |    46 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🟡 serious  | `link-name`             |     1 |

### MX-5569 - documentation

- **Ruta**: `/carrier/#/reports/documentation`
- **Spec**: `tests/specs/a11y/documentation-a11y.spec.ts`
- **Resumen**: 2 critical + 4 serious = 6 categorias

| Severity    | Rule                 | Nodos |
| ----------- | -------------------- | ----: |
| 🟡 serious  | `autocomplete-valid` |     1 |
| 🔴 critical | `button-name`        |     2 |
| 🟡 serious  | `color-contrast`     |    16 |
| 🟡 serious  | `html-has-lang`      |     1 |
| 🔴 critical | `label`              |     1 |
| 🟡 serious  | `link-name`          |     2 |

### MX-5574 - gnet credit accounts

- **Ruta**: `/carrier/#/gnet/credit-accounts`
- **Spec**: `tests/specs/a11y/gnet-credit-accounts-a11y.spec.ts`
- **Resumen**: 1 critical + 4 serious = 5 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    10 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🟡 serious  | `link-name`             |     2 |

### MX-5573 - gnet farm in

- **Ruta**: `/carrier/#/gnet/farm-in`
- **Spec**: `tests/specs/a11y/gnet-farm-in-a11y.spec.ts`
- **Resumen**: 1 critical + 3 serious = 4 categorias

| Severity    | Rule             | Nodos |
| ----------- | ---------------- | ----: |
| 🔴 critical | `button-name`    |     2 |
| 🟡 serious  | `color-contrast` |    20 |
| 🟡 serious  | `html-has-lang`  |     1 |
| 🟡 serious  | `link-name`      |     2 |

### MX-5684 - navbar shell

- **Ruta**: `/carrier/#/dashboard`
- **Spec**: `tests/specs/a11y/navbar-shell-a11y.spec.ts`
- **Resumen**: 2 critical + 3 serious = 5 categorias

| Severity    | Rule             | Nodos |
| ----------- | ---------------- | ----: |
| 🔴 critical | `button-name`    |    25 |
| 🟡 serious  | `color-contrast` |    61 |
| 🟡 serious  | `html-has-lang`  |     1 |
| 🔴 critical | `label`          |     1 |
| 🟡 serious  | `link-name`      |     2 |

### MX-5575 - other costs

- **Ruta**: `/carrier/#/settings/otherCosts`
- **Spec**: `tests/specs/a11y/other-costs-a11y.spec.ts`
- **Resumen**: 1 critical + 4 serious = 5 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     7 |
| 🟡 serious  | `color-contrast`        |    14 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🟡 serious  | `link-name`             |     2 |

### MX-5568 - payment flow

- **Ruta**: `/carrier/#/reports/payment-flow`
- **Spec**: `tests/specs/a11y/payment-flow-a11y.spec.ts`
- **Resumen**: 2 critical + 4 serious = 6 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    17 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     3 |
| 🟡 serious  | `link-name`             |     2 |

### MX-5553 - segments travels

- **Ruta**: `/carrier/#/reports/segments-travels`
- **Spec**: `tests/specs/a11y/segments-travels-a11y.spec.ts`
- **Resumen**: 1 critical + 4 serious = 5 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    14 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🟡 serious  | `link-name`             |     3 |

### MX-5566 - taxes fees

- **Ruta**: `/carrier/#/reports/taxes-and-fees`
- **Spec**: `tests/specs/a11y/taxes-fees-a11y.spec.ts`
- **Resumen**: 1 critical + 4 serious = 5 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    16 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🟡 serious  | `link-name`             |     3 |

### MX-5560 - tips report

- **Ruta**: `/carrier/#/reports/tips`
- **Spec**: `tests/specs/a11y/tips-report-a11y.spec.ts`
- **Resumen**: 2 critical + 5 serious = 7 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🟡 serious  | `autocomplete-valid`    |     3 |
| 🔴 critical | `button-name`           |     3 |
| 🟡 serious  | `color-contrast`        |    14 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     3 |
| 🟡 serious  | `link-name`             |     2 |

### MX-5565 - transaction tracking

- **Ruta**: `/carrier/#/reports/transaction-tracking`
- **Spec**: `tests/specs/a11y/transaction-tracking-a11y.spec.ts`
- **Resumen**: 2 critical + 5 serious = 7 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🟡 serious  | `autocomplete-valid`    |     2 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    19 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     2 |
| 🟡 serious  | `link-name`             |     2 |

### MX-5531 - unpaid travels

- **Ruta**: `/carrier/#/reports/unpaid-travels-list`
- **Spec**: `tests/specs/a11y/unpaid-travels-a11y.spec.ts`
- **Resumen**: 2 critical + 5 serious = 7 categorias

| Severity    | Rule                    | Nodos |
| ----------- | ----------------------- | ----: |
| 🟡 serious  | `aria-progressbar-name` |     1 |
| 🟡 serious  | `autocomplete-valid`    |     1 |
| 🔴 critical | `button-name`           |     2 |
| 🟡 serious  | `color-contrast`        |    14 |
| 🟡 serious  | `html-has-lang`         |     1 |
| 🔴 critical | `label`                 |     1 |
| 🟡 serious  | `link-name`             |     2 |

## Recomendaciones priorizadas

### Bugs CRITICOS (bloquean WCAG 2.1 AA)

1. **`button-name`** - 16/16 pantallas, 64 nodos. Buttons icon-only del header/topbar (refresh, PDF, config columnas) y dropdowns no tienen accessible name. Fix Angular: agregar `[attr.aria-label]="'buttons_labels_common.refresh' | translate"` a cada `<button>` icon-only.

2. **`label`** - 10/16 pantallas, 19 nodos. Forms con `<input>` y `<ng-select>` sin label asociado. Fix: envolver con `<label>` o agregar `aria-label`. Para `ng-select`: usar `labelForId` + `<label [for]="...">`.

### Bugs SERIOS (deberia arreglar antes de release)

1. **`color-contrast`** - 16/16, **320 nodos** (el mayor volumen). Bug GLOBAL del theme: texto secundario (clases `text-muted`, `text-secondary`) con contrast ratio < 4.5:1. Fix: revisar variables CSS y oscurecer los textos secundarios.

2. **`html-has-lang`** - 16/16, 16 nodos. Bug GLOBAL Angular: `src/index.html` necesita `<html lang="en">` o dinamico desde `TranslateService` (`<html [attr.lang]="currentLang">`).

3. **`link-name`** - 16/16, 36 nodos. Links icon-only (config columnas con `<i class="mdi mdi-tune-variant">` dentro de `<a>`) sin `aria-label`. Idem button-name.

4. **`aria-progressbar-name`** - 11/16, 11 nodos. Spinners Bootstrap con `role="status"` o `role="progressbar"` sin `aria-label`. Fix: agregar `aria-label="Loading data"`.

5. **`autocomplete-valid`** - 7/16, 12 nodos. `autocomplete=` con valores invalidos HTML5. Usar valores estandar (`name`, `email`, `tel`, `off`).

## Cobertura

- **16 / 16 pantallas baja-complejidad escaneadas** (Release V2.0.4)
- **Total violations agregadas**: 478 nodos en 7 reglas WCAG distintas
- **Workflow CI**: `.github/workflows/a11y.yml` weekly lunes 08:00 UTC + workflow_dispatch on-demand

## Trazabilidad

| MX      | Pantalla                   | Spec                                                       | TC ID            |
| ------- | -------------------------- | ---------------------------------------------------------- | ---------------- |
| MX-5438 | daily report               | `tests/specs/a11y/daily-report-a11y.spec.ts`               | `MX-5438-A11Y01` |
| MX-5531 | unpaid travels             | `tests/specs/a11y/unpaid-travels-a11y.spec.ts`             | `MX-5531-A11Y01` |
| MX-5553 | segments travels           | `tests/specs/a11y/segments-travels-a11y.spec.ts`           | `MX-5553-A11Y01` |
| MX-5554 | affiliate checking account | `tests/specs/a11y/affiliate-checking-account-a11y.spec.ts` | `MX-5554-A11Y01` |
| MX-5560 | tips report                | `tests/specs/a11y/tips-report-a11y.spec.ts`                | `MX-5560-A11Y01` |
| MX-5561 | aging report               | `tests/specs/a11y/aging-report-a11y.spec.ts`               | `MX-5561-A11Y01` |
| MX-5562 | cash flow                  | `tests/specs/a11y/cash-flow-a11y.spec.ts`                  | `MX-5562-A11Y01` |
| MX-5565 | transaction tracking       | `tests/specs/a11y/transaction-tracking-a11y.spec.ts`       | `MX-5565-A11Y01` |
| MX-5566 | taxes fees                 | `tests/specs/a11y/taxes-fees-a11y.spec.ts`                 | `MX-5566-A11Y01` |
| MX-5568 | payment flow               | `tests/specs/a11y/payment-flow-a11y.spec.ts`               | `MX-5568-A11Y01` |
| MX-5569 | documentation              | `tests/specs/a11y/documentation-a11y.spec.ts`              | `MX-5569-A11Y01` |
| MX-5571 | agency commissions         | `tests/specs/a11y/agency-commissions-a11y.spec.ts`         | `MX-5571-A11Y01` |
| MX-5573 | gnet farm in               | `tests/specs/a11y/gnet-farm-in-a11y.spec.ts`               | `MX-5573-A11Y01` |
| MX-5574 | gnet credit accounts       | `tests/specs/a11y/gnet-credit-accounts-a11y.spec.ts`       | `MX-5574-A11Y01` |
| MX-5575 | other costs                | `tests/specs/a11y/other-costs-a11y.spec.ts`                | `MX-5575-A11Y01` |
| MX-5684 | navbar shell               | `tests/specs/a11y/navbar-shell-a11y.spec.ts`               | `MX-5684-A11Y01` |

## Proximos pasos

1. **Reportar bugs criticos a dev**: abrir tickets Jira por `button-name` + `label` con lista de pantallas afectadas.
2. **Decidir threshold strict**: convertir specs a estrictos (`expect(violations).toEqual([])`) solo despues que dev arregle los 2 criticos globales.
3. **Re-ejecutar audit**: tras cada release UI, correr `npm run test:a11y` o dispatch del workflow y comparar con este baseline.
4. **Extender cobertura**: cuando se migren pantallas alta-complejidad (Map Viewer, Travel Detail, Forms CRUD), generar specs `@a11y` con mismo patron.
