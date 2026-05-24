# FW-007 — Analisis de locators duplicados entre POMs

**Fecha auditoria:** 2026-05-24
**Branch:** `carrier-v2/teams-notifications`
**Alcance:** `tests/pages/carrier-v2/**/*.ts` + `tests/pages/shared/**/*.ts` (excluyendo `index.ts`)

## Veredicto

**NO crear `tests/locators/carrier-v2/` en FW-007.** El analisis muestra que el problema real es **redeclaracion indebida en 4 List POMs** (Client/Driver/Owner/Vehicle), no falta de un modulo de locators compartidos. `BaseListPage` ya es el lugar canonico.

Abrir ticket sucesor **FW-007b** con scope: _"Refactor `ClientListPage`, `DriverListPage`, `OwnerListPage`, `VehicleListPage` para heredar locators de `BaseListPage` y eliminar redeclaraciones."_

---

## Resumen ejecutivo

- POMs auditados: 48 archivos (`.ts`).
- POMs con locators inline: 14 (los otros 34 son thin extensions de `BaseListPage` / `BaseDetailPage` sin locators propios).
- Definiciones de locators totales: ~105.
- Patrones unicos identificados: ~88.
- Patrones duplicados (>=2 archivos): 16.
- Patrones criticos (>=3 archivos): 5 — **todos ya estan en `BaseListPage`**.

| Aparece en X archivos | Cantidad de patrones |
| --------------------- | -------------------- |
| 1 archivo             | ~72 (unicos)         |
| 2 archivos            | 11                   |
| 3 archivos            | 0                    |
| 4 archivos            | 0                    |
| 5 archivos            | 5                    |

## Top 16 locators duplicados

| #   | Patron                                                  | Factory          | Archivos                                                     | Count |
| --- | ------------------------------------------------------- | ---------------- | ------------------------------------------------------------ | ----- |
| 1   | `'table'.first()`                                       | getByRole        | BaseListPage, ClientList, DriverList, OwnerList, VehicleList | 5     |
| 2   | `'combobox', { name: /^show \d+/i }`                    | getByRole        | BaseListPage, ClientList, DriverList, OwnerList, VehicleList | 5     |
| 3   | `'link', { name: /^previous$\|^anterior$/i }`           | getByRole        | BaseListPage, ClientList, DriverList, OwnerList, VehicleList | 5     |
| 4   | `'link', { name: /^next$\|^siguiente$/i }`              | getByRole        | BaseListPage, ClientList, DriverList, OwnerList, VehicleList | 5     |
| 5   | `'button', { name: /^pdf$/i }`                          | getByRole        | BaseListPage, ClientList, DriverList, OwnerList, VehicleList | 5     |
| 6   | `/search name\|buscar nombre/i`                         | getByPlaceholder | ClientList, DriverList                                       | 2     |
| 7   | `/^search\.?\.?\.?$\|^buscar/i .first()`                | getByPlaceholder | OwnerList, VehicleList                                       | 2     |
| 8   | `'checkbox', { name: /^vip$/i }`                        | getByRole        | ClientList, TravelDashboard                                  | 2     |
| 9   | `'heading', { name: /^drivers$\|^conductores$/i }`      | getByRole        | DriverList (level:2), MapViewer                              | 2     |
| 10  | `'button', { name: /all\s*\(\d+\)/i }.first()`          | getByRole        | OperationsControl, MapViewer                                 | 2     |
| 11  | `'button', { name: /available\s*\(\d+\)/i }.first()`    | getByRole        | OperationsControl, MapViewer                                 | 2     |
| 12  | `'button', { name: /traveling\s*\(\d+\)/i }.first()`    | getByRole        | OperationsControl, MapViewer                                 | 2     |
| 13  | `'button', { name: /unavailable\s*\(\d+\)/i }.first()`  | getByRole        | OperationsControl, MapViewer                                 | 2     |
| 14  | `/operations control\|control operaciones/i`            | getByText        | OperationsControl, ShellPage                                 | 2     |
| 15  | `'h4'.first()`                                          | locator          | BaseDetailPage, BaseListPage                                 | 2     |
| 16  | `'.search-box input.search, input.form-control.search'` | locator          | BaseListPage, ReportsTipsPage                                | 2     |

## Refactor recomendado (FW-007b)

Refactorizar `ClientListPage`, `DriverListPage`, `OwnerListPage`, `VehicleListPage` para que hereden de `BaseListPage` y eliminen las redeclaraciones de los locators 1-5.

Ahorro estimado:

- 5 locators x 4 archivos = **20 lineas duplicadas eliminadas**.
- Cada POM bajaria de ~50 lineas a ~25 lineas.
- Source of truth unico en `BaseListPage` (ya existe).

## Duplicados engañosos (NO extraer)

| Patron                                                          | Archivos                                                  | Por que es engañoso                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getByRole('heading', { name: /^drivers$\|^conductores$/i })`   | DriverList (level:2), MapViewer (sin level)               | Mismo texto, distinto nivel jerarquico (h2 vs subheading de panel).                        |
| `getByRole('button', { name: /all\|available\|.../i }).first()` | OperationsControl, MapViewer                              | Mismo concepto pero coexisten en la misma pagina; extraer rompe tests cross-screen.        |
| `getByText(/operations control\|.../i)`                         | OperationsControl, ShellPage                              | Distinta capa: titulo de pantalla vs link de nav del shell.                                |
| `getByPlaceholder(/search name.../)`                            | ClientList+DriverList vs OwnerList+VehicleList            | Dos regex distintas porque V2 muestra placeholders diferentes; NO mergear.                 |
| `getByRole('checkbox', { name: /^vip$/i })`                     | ClientList (filtro listado), TravelDashboard (asignacion) | Distinta funcion de negocio; acoplar via locator compartido genera falsos positivos.       |
| `page.locator('h4').first()`                                    | BaseDetailPage, BaseListPage                              | Ya estan en archivos base.                                                                 |
| `.search-box input.search, ...`                                 | BaseListPage, ReportsTipsPage                             | ReportsTips redeclara con override sin justificacion visible. Caso de deuda tecnica local. |

## Acciones derivadas

1. **Cerrar FW-007** como "no-op de extraccion".
2. **Abrir FW-007b**: Refactor 4 List POMs para heredar de BaseListPage.
3. **Documentar regla** en `tests/pages/carrier-v2/README.md` o en `docs/architecture/POM-CONVENTIONS.md`: _"Antes de declarar un locator inline, verificar si `BaseListPage` o `BaseDetailPage` ya lo expone via herencia."_
4. **Auditar `ReportsTipsPage`** por separado — 11 locators inline y override de `searchInput` que duplica a `BaseListPage` sin justificacion visible.

## Metricas finales

- Locators unicos: ~88
- Locators duplicados extraibles con ganancia real: 0 (ya estan en Base)
- Locators a extraer a `tests/locators/`: **0**
- Refactor recomendado en su lugar: **4 POMs colapsan a Base** -> ahorro 20 lineas + source-of-truth unico
