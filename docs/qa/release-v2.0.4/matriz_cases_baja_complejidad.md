# Test Suite — Release V2.0.4 · Pantallas de baja complejidad

> **Proyecto:** Automatización QA carrier V2 (Angular)
> **Alcance:** Listados simples del portal carrier (Reportes, GNET, Settings, Affiliate). Excluye Dashboard / Map / Forms CRUD / Detail flows con `:id`.
> **Fuente código:** `gitlab.com/repo.magiis/magiis-fe-carrier-v2 @ release/v2.0.4` (commit `4fce6b9`).
> **Trazabilidad:** cada TC tiene formato `MX-XXXX-TCNN` donde `MX-XXXX` es el ticket Jira de la pantalla.
> **Tipo de pruebas:** funcionales + UX (frontend only, sin backend asserts).
> **Plataforma de ejecución:** Playwright + TypeScript sobre `apps-test.magiis.com/carrier`.

---

## 0. Features transversales — Decision Table

Todas las pantallas de baja complejidad migradas en V2.0.4 comparten el mismo "esqueleto" funcional (validado leyendo `src/app/pages/carrier/reports/report-tips/report-tips.component.{html,ts}`).
Cada test case opera sobre **una** de estas dimensiones:

| # | Dimensión | Variantes |
| --- | --- | --- |
| 1 | Acceso desde menú | Sidebar item → carga pantalla |
| 2 | Search (input libre) | Texto que matchea / no matchea / vacío |
| 3 | Filtros dropdown | Por estado / método de pago / tipo viaje / canal |
| 4 | Date range picker | Predefinido (`Today` / `Last 7d` / ...) / custom (from-to) |
| 5 | Ordenamiento columna | ASC / DESC al click en columna `sortable` |
| 6 | Resize columna | Drag del `resize-handle` lateral |
| 7 | Drag & drop columna | Reordenar usando `cdkDrag` + `cdkDragHandle` |
| 8 | Config visibilidad columna | Modal/dropdown con checkbox `col.visible` |
| 9 | Paginación | Page size + Previous / Next |
| 10 | i18n (idioma) | EN ↔ ES → labels, columns, placeholders |
| 11 | l10n (regionalización) | Formato fecha por región (`localeData.dateFormat`) |
| 12 | Export PDF | `downloadPDF()` → archivo válido con header + footer + tabla + traducciones |
| 13 | Refresh data | Botón refresh → `getDataGrid()` con spinner `isLoading` |
| 14 | Empty state | Sin resultados → mensaje + PDF deshabilitado |
| 15 | Loading state | Mientras carga → spinner visible / acciones deshabilitadas |

> **Nota de alcance:** las columnas que actualmente no permiten orden ASC/DESC (validado manualmente por QA) **quedan fuera de scope** y NO se prueban su sort. Sí se prueba que el resto de columnas `sortable: true` funcionan en ambos sentidos.

---

## 1. MX-5560 — Reportes / Propinas (`/carrier/#/reports/tips`)

Pantalla referencia (mismo patrón se replica en el resto de reportes).

| ID | Descripción |
| --- | --- |
| MX-5560-TC01 | Validar acceso desde menú `Reports → Tips` y carga de la pantalla sin error |
| MX-5560-TC02 | Validar título de pantalla traducido en EN: "Tips Report" y en ES: "Reporte de Propinas" |
| MX-5560-TC03 | Validar breadcrumb traducido en EN/ES (`Reports / Tips`) |
| MX-5560-TC04 | Validar dropdown `travel type` con opciones Historical / Recent y default Historical |
| MX-5560-TC05 | Validar date range picker visible solo cuando travel type = Historical |
| MX-5560-TC06 | Validar date range picker con preset Today aplica el filtro y la tabla actualiza |
| MX-5560-TC07 | Validar date range picker con rango custom from-to aplica y persiste tras refresh |
| MX-5560-TC08 | Validar input search filtra resultados por nombre y reduce filas de la tabla |
| MX-5560-TC09 | Validar input search vacío restaura todos los resultados |
| MX-5560-TC10 | Validar dropdown payment method filtra (Checking Account / Credit Card) |
| MX-5560-TC11 | Validar dropdown payment method clear restaura todos los métodos |
| MX-5560-TC12 | Validar dropdown status filtra correctamente las filas |
| MX-5560-TC13 | Validar ordenamiento ASC al clickear columna sortable (`Date`) |
| MX-5560-TC14 | Validar ordenamiento DESC al volver a clickear la misma columna |
| MX-5560-TC15 | Validar resize de columna arrastrando `resize-handle` lateral cambia ancho |
| MX-5560-TC16 | Validar drag & drop de columna cambia el orden visualmente y persiste durante la sesión |
| MX-5560-TC17 | Validar modal/dropdown de configuración de columnas oculta/muestra columna |
| MX-5560-TC18 | Validar paginación Previous / Next navega entre páginas correctamente |
| MX-5560-TC19 | Validar selector "Show N" cambia cantidad de filas por página |
| MX-5560-TC20 | Validar botón Refresh recarga la tabla y muestra spinner durante la operación |
| MX-5560-TC21 | Validar botón PDF deshabilitado cuando `reportList.length === 0` |
| MX-5560-TC22 | Validar botón PDF descarga archivo `.pdf` con header + tabla + dates en formato local |
| MX-5560-TC23 | Validar PDF generado con locale ES usa formato fecha `DD/MM/YYYY` |
| MX-5560-TC24 | Validar PDF generado con locale EN usa formato fecha `MM/DD/YYYY` |
| MX-5560-TC25 | Validar cambio de idioma EN ↔ ES actualiza headers de columnas + placeholders + botones |
| MX-5560-TC26 | Validar empty state "No data" cuando filtros no devuelven filas |

---

## 2. MX-5561 — Reportes / Antigüedad de Deuda (`/carrier/#/reports/debt-aging`)

Heading real: **Aging Report**.

| ID | Descripción |
| --- | --- |
| MX-5561-TC01 | Validar acceso desde menú `Reports → Debt Aging` y carga sin error |
| MX-5561-TC02 | Validar título "Aging Report" / "Reporte Antigüedad de Deuda" según idioma |
| MX-5561-TC03 | Validar filtros aplican (cliente, fecha, etc.) |
| MX-5561-TC04 | Validar search filtra por nombre y restaura al limpiar |
| MX-5561-TC05 | Validar ordenamiento ASC/DESC en columnas sortable |
| MX-5561-TC06 | Validar resize de columnas con `resize-handle` |
| MX-5561-TC07 | Validar drag & drop reordena columnas |
| MX-5561-TC08 | Validar config columnas oculta/muestra correctamente |
| MX-5561-TC09 | Validar paginación Previous/Next + page size |
| MX-5561-TC10 | Validar refresh recarga datos con spinner |
| MX-5561-TC11 | Validar PDF deshabilitado sin datos |
| MX-5561-TC12 | Validar PDF descarga con totales calculados visibles |
| MX-5561-TC13 | Validar i18n EN/ES en headers + placeholders |
| MX-5561-TC14 | Validar l10n: formato fecha por región en columnas date |

---

## 3. MX-5562 — Reportes / Movimientos de Cobros (`/carrier/#/reports/cash-flow`)

Heading real: **Collection Movements**.

| ID | Descripción |
| --- | --- |
| MX-5562-TC01 | Validar acceso desde menú y carga sin error |
| MX-5562-TC02 | Validar título "Collection Movements" / "Movimientos de Cobros" |
| MX-5562-TC03 | Validar date range picker con preset y custom |
| MX-5562-TC04 | Validar filtros aplican (estado de cobro / método) |
| MX-5562-TC05 | Validar search por código/cliente |
| MX-5562-TC06 | Validar ordenamiento ASC/DESC |
| MX-5562-TC07 | Validar resize + drag & drop + config columnas |
| MX-5562-TC08 | Validar sección "Totals" (h4) muestra sumatorias correctas |
| MX-5562-TC09 | Validar paginación y refresh |
| MX-5562-TC10 | Validar PDF descarga con dates en formato local |
| MX-5562-TC11 | Validar i18n EN/ES + l10n fechas |

---

## 4. MX-5565 — Reportes / Transacciones Tarjeta (`/carrier/#/reports/transaction-tracking`)

Heading real: **Electronic Payment Transactions**.

| ID | Descripción |
| --- | --- |
| MX-5565-TC01 | Validar acceso desde menú y carga |
| MX-5565-TC02 | Validar título "Electronic Payment Transactions" / "Transacciones con Tarjeta" |
| MX-5565-TC03 | Validar filtros por estado de transacción + método de pago |
| MX-5565-TC04 | Validar date range picker |
| MX-5565-TC05 | Validar search libre |
| MX-5565-TC06 | Validar ordenamiento ASC/DESC en columnas sortable |
| MX-5565-TC07 | Validar resize + drag & drop + config columnas |
| MX-5565-TC08 | Validar paginación + refresh |
| MX-5565-TC09 | Validar PDF deshabilitado vacío + descarga con datos |
| MX-5565-TC10 | Validar i18n + l10n |

---

## 5. MX-5566 — Reportes / Impuestos y Cargos (`/carrier/#/reports/taxes-and-fees`)

Heading real: **Taxes & Fees Report**.

| ID | Descripción |
| --- | --- |
| MX-5566-TC01 | Validar acceso desde menú y carga |
| MX-5566-TC02 | Validar título "Taxes & Fees" / "Impuestos y Cargos" |
| MX-5566-TC03 | Validar filtros aplican (categoría / período) |
| MX-5566-TC04 | Validar date range picker |
| MX-5566-TC05 | Validar search |
| MX-5566-TC06 | Validar ordenamiento ASC/DESC |
| MX-5566-TC07 | Validar resize + drag & drop + config columnas |
| MX-5566-TC08 | Validar paginación + refresh |
| MX-5566-TC09 | Validar PDF con totales por categoría |
| MX-5566-TC10 | Validar i18n + l10n |

---

## 6. MX-5568 — Reportes / Movimientos de Pagos (`/carrier/#/reports/payment-flow`)

Heading real: **Payment Movements**.

| ID | Descripción |
| --- | --- |
| MX-5568-TC01 | Validar acceso desde menú y carga |
| MX-5568-TC02 | Validar título "Payment Movements" / "Movimientos de Pagos" |
| MX-5568-TC03 | Validar filtros aplican (tipo de pago / status) |
| MX-5568-TC04 | Validar date range picker |
| MX-5568-TC05 | Validar search |
| MX-5568-TC06 | Validar ordenamiento ASC/DESC |
| MX-5568-TC07 | Validar resize + drag & drop + config columnas |
| MX-5568-TC08 | Validar paginación + refresh |
| MX-5568-TC09 | Validar PDF descarga con dates correctas |
| MX-5568-TC10 | Validar i18n + l10n |

---

## 7. MX-5571 — Reportes / Comisiones Agencia (`/carrier/#/reports/agency-commissions`)

Heading real: **Company Commissions Reports**.

| ID | Descripción |
| --- | --- |
| MX-5571-TC01 | Validar acceso desde menú y carga |
| MX-5571-TC02 | Validar título "Company Commissions" / "Comisiones Agencia" |
| MX-5571-TC03 | Validar filtros aplican (cliente / período) |
| MX-5571-TC04 | Validar date range picker |
| MX-5571-TC05 | Validar search |
| MX-5571-TC06 | Validar ordenamiento ASC/DESC |
| MX-5571-TC07 | Validar resize + drag & drop + config columnas |
| MX-5571-TC08 | Validar sección "Totals" muestra sumatorias |
| MX-5571-TC09 | Validar paginación + refresh |
| MX-5571-TC10 | Validar PDF con totales por cliente |
| MX-5571-TC11 | Validar i18n + l10n |

---

## 8. MX-5438 — Reportes / Resumen Diario (`/carrier/#/reports/daily`)

Heading real: **Daily Report**.

| ID | Descripción |
| --- | --- |
| MX-5438-TC01 | Validar acceso desde menú y carga |
| MX-5438-TC02 | Validar título "Daily Report" / "Resumen Diario" |
| MX-5438-TC03 | Validar date picker día único + navegación día anterior/siguiente |
| MX-5438-TC04 | Validar filtros aplican (driver / cliente / status) |
| MX-5438-TC05 | Validar search libre |
| MX-5438-TC06 | Validar ordenamiento ASC/DESC en columnas sortable |
| MX-5438-TC07 | Validar resize + drag & drop + config columnas |
| MX-5438-TC08 | Validar paginación + refresh |
| MX-5438-TC09 | Validar PDF descarga con fecha del día seleccionado |
| MX-5438-TC10 | Validar i18n + l10n fechas |

---

## 9. MX-5569 — Reportes / Documentación Vencida (`/carrier/#/reports/documentation`)

Heading real: **Expired Documentation Report**.

| ID | Descripción |
| --- | --- |
| MX-5569-TC01 | Validar acceso desde menú y carga |
| MX-5569-TC02 | Validar título "Expired Documentation" / "Documentación Vencida y por Vencer" |
| MX-5569-TC03 | Validar filtros por tipo documento + estado (vencido / por vencer / vigente) |
| MX-5569-TC04 | Validar filtro por entidad (driver / vehicle / owner) |
| MX-5569-TC05 | Validar search libre |
| MX-5569-TC06 | Validar ordenamiento ASC/DESC por fecha vencimiento |
| MX-5569-TC07 | Validar resize + drag & drop + config columnas |
| MX-5569-TC08 | Validar paginación + refresh |
| MX-5569-TC09 | Validar PDF descarga con highlight de docs vencidos |
| MX-5569-TC10 | Validar i18n + l10n fechas |

---

## 10. MX-5531 — Reportes / Travel Unpaid List (`/carrier/#/reports/unpaid-travels-list`)

Heading real: **Unpaid Trips Report**.

| ID | Descripción |
| --- | --- |
| MX-5531-TC01 | Validar acceso desde menú y carga |
| MX-5531-TC02 | Validar título "Unpaid Trips" / "Viajes Impagos" |
| MX-5531-TC03 | Validar filtros aplican (cliente / período sin pago) |
| MX-5531-TC04 | Validar search libre |
| MX-5531-TC05 | Validar ordenamiento ASC/DESC |
| MX-5531-TC06 | Validar resize + drag & drop + config columnas |
| MX-5531-TC07 | Validar paginación + refresh |
| MX-5531-TC08 | Validar PDF descarga |
| MX-5531-TC09 | Validar i18n + l10n |

---

## 11. MX-5553 — Reportes / Viajes por Segmentos (`/carrier/#/reports/segments-travels`)

Heading real: **Trips Segments**.

| ID | Descripción |
| --- | --- |
| MX-5553-TC01 | Validar acceso desde menú y carga |
| MX-5553-TC02 | Validar título "Trips Segments" / "Viajes por Segmentos" |
| MX-5553-TC03 | Validar filtros por segmento + período |
| MX-5553-TC04 | Validar search libre |
| MX-5553-TC05 | Validar ordenamiento ASC/DESC |
| MX-5553-TC06 | Validar resize + drag & drop + config columnas |
| MX-5553-TC07 | Validar sección "Totals" |
| MX-5553-TC08 | Validar paginación + refresh |
| MX-5553-TC09 | Validar PDF descarga con totales por segmento |
| MX-5553-TC10 | Validar i18n + l10n |

---

## 12. MX-5573 — GNET Farm IN (`/carrier/#/gnet/farm-in`)

Heading real: **GNET Farm IN**.

| ID | Descripción |
| --- | --- |
| MX-5573-TC01 | Validar acceso desde menú `GNET → Farm IN` y carga |
| MX-5573-TC02 | Validar título "GNET Farm IN" |
| MX-5573-TC03 | Validar filtros aplican (estado / origen / período) |
| MX-5573-TC04 | Validar date range picker |
| MX-5573-TC05 | Validar search libre |
| MX-5573-TC06 | Validar ordenamiento ASC/DESC |
| MX-5573-TC07 | Validar resize + drag & drop + config columnas |
| MX-5573-TC08 | Validar paginación + refresh |
| MX-5573-TC09 | Validar PDF descarga con campos GNET correctos |
| MX-5573-TC10 | Validar i18n + l10n |

---

## 13. MX-5574 — GNET Cuentas Corrientes (`/carrier/#/gnet/credit-accounts`)

Heading real: **GNET Credit Accounts**.

| ID | Descripción |
| --- | --- |
| MX-5574-TC01 | Validar acceso desde menú `GNET → Credit Accounts` y carga |
| MX-5574-TC02 | Validar título "Credit Accounts" |
| MX-5574-TC03 | Validar filtros aplican (estado cuenta / saldo) |
| MX-5574-TC04 | Validar search por afiliado / código |
| MX-5574-TC05 | Validar ordenamiento ASC/DESC en columnas saldo / nombre |
| MX-5574-TC06 | Validar resize + drag & drop + config columnas |
| MX-5574-TC07 | Validar paginación + refresh |
| MX-5574-TC08 | Validar PDF descarga con saldos y formato moneda local |
| MX-5574-TC09 | Validar i18n + l10n formato moneda + fecha |

---

## 14. MX-5575 — Configuración / Otros Costos (`/carrier/#/settings/otherCosts`)

Heading real: **Other Costs**.

| ID | Descripción |
| --- | --- |
| MX-5575-TC01 | Validar acceso desde menú `Configuration → Other Costs` y carga |
| MX-5575-TC02 | Validar título "Other Costs" / "Otros Costos" |
| MX-5575-TC03 | Validar filtros aplican (categoría / activo) |
| MX-5575-TC04 | Validar search por nombre |
| MX-5575-TC05 | Validar ordenamiento ASC/DESC |
| MX-5575-TC06 | Validar resize + drag & drop + config columnas |
| MX-5575-TC07 | Validar paginación + refresh |
| MX-5575-TC08 | Validar i18n EN/ES |

---

## 15. MX-5554 — Cuentas Corrientes Con Afiliados (`/carrier/#/affiliate/checking-account`)

Heading real: **Credit Accounts With Affiliates**.

| ID | Descripción |
| --- | --- |
| MX-5554-TC01 | Validar acceso desde menú `eAffiliates → Credit Accounts` y carga |
| MX-5554-TC02 | Validar breadcrumb "eAffiliates / Credit Accounts" |
| MX-5554-TC03 | Validar título "Credit Accounts With Affiliates" |
| MX-5554-TC04 | Validar filtros aplican (clear all + ordenamiento por columna) |
| MX-5554-TC05 | Validar search libre |
| MX-5554-TC06 | Validar ordenamiento ASC/DESC en columnas sortable |
| MX-5554-TC07 | Validar resize + drag & drop + config columnas |
| MX-5554-TC08 | Validar empty state "No Data" cuando no hay afiliados con cuenta |
| MX-5554-TC09 | Validar paginación + refresh |
| MX-5554-TC10 | Validar i18n + l10n formato moneda |

---

## 16. MX-5684 — Navbar / Shell carrier (Revisión integral CarrierV2)

> **Trazabilidad:** [MX-5684 — Revisión integral CarrierV2](https://magiis.atlassian.net/browse/MX-5684).
> **Alcance:** validar el shell global del portal carrier V2 (sidebar + topbar) y la navegación a las 15 pantallas de baja complejidad de esta matriz.
> **Skill aplicada:** `qa-magiis` — cobertura mínima por dimensión (happy path → edge cases → negativos → regresión → integración).
>
> **Análisis código fuente** (`gitlab.com/repo.magiis/magiis-fe-carrier-v2 @ release/v2.0.4`):
>
> - `src/app/layouts/sidebar/sidebar.component.{ts,html}` — `menuItems: MenuItem[]` con propiedades `isActive` y `isCollapsed`. `withUiState()` sincroniza estado UI con routing. Lógica accordion confirmada en código (`siblings.forEach(sib => sib.isActive = false)`).
> - `src/app/layouts/topbar/topbar.component.{ts,html}` — `toggleMobileMenu()` hamburger, `changeMode(mode)` light/dark, `logout()` via `_identityService.logOut()`, dropdowns notifications + search + melita_ai quick access.
> - `src/app/layouts/vertical/vertical.component.{ts,html}` — layout vertical default que envuelve sidebar + topbar + router-outlet.
> - Logo: `<a routerLink="dashboard" class="logo">` (click en logo navega a dashboard, no a `/`).

---

### 16.1 Happy path — Estado inicial del shell post-login

> **Skill qa-magiis · Dimensión 1 (Happy path):** flujo principal feliz tras login exitoso.

| ID | Descripción |
| --- | --- |
| MX-5684-TC01 | Validar tras login que el componente `app-layout` se renderiza con `<app-sidebar>` + `<app-topbar>` + `<router-outlet>` |
| MX-5684-TC02 | Validar sidebar muestra **17 items raíz** del `menuItems[]` carrier en orden esperado (Operations Control, Map Viewer, Management Dashboards, Trips, Customers, Daily Clearing, Settlements, Credit Accounts, MAGIIS Book, Vehicles, Owners, Drivers, Reports, eAfiliates, GNET, Magiis Apps Store, Configuration) |
| MX-5684-TC03 | Validar topbar muestra: hamburger toggle, logo, search widget, melita_ai quick access, notifications dropdown, locale switcher (EN/ES), help icon, avatar usuario |
| MX-5684-TC04 | Validar que el item del sidebar correspondiente a la pantalla activa post-login tiene `isActive: true` y CSS de "highlight" aplicado |
| MX-5684-TC05 | Validar avatar usuario muestra `displayName` + `username` + `companyCode` (e.g., "Remises EEUU / US1000") del `_identityService` |

### 16.2 Happy path — Navegación sidebar a pantallas baja complejidad

> **Skill qa-magiis · Dimensión 1 (Happy path):** cada test cubre un item del sidebar que navega a una pantalla baja complejidad. 1 TC por pantalla = 15 TCs.
> **Cobertura cruzada:** cada pantalla tiene aquí 1 TC + sus propios TCs (sección 1-15) = defensa en profundidad.

| ID | Descripción |
| --- | --- |
| MX-5684-TC06 | Validar click en sidebar `Reports → Tips Report` invoca `routerLink="/reports/tips"` y heading "Tips Report" visible (MX-5560) |
| MX-5684-TC07 | Validar click en sidebar `Reports → Aging Report` carga `/reports/debt-aging` y heading "Aging Report" visible (MX-5561) |
| MX-5684-TC08 | Validar click en sidebar `Reports → Collection Movements` carga `/reports/cash-flow` (MX-5562) |
| MX-5684-TC09 | Validar click en sidebar `Reports → Electronic Payment Transactions` carga `/reports/transaction-tracking` (MX-5565) |
| MX-5684-TC10 | Validar click en sidebar `Reports → Taxes & Fees` carga `/reports/taxes-and-fees` (MX-5566) |
| MX-5684-TC11 | Validar click en sidebar `Reports → Payment Movements` carga `/reports/payment-flow` (MX-5568) |
| MX-5684-TC12 | Validar click en sidebar `Reports → Company Commissions` carga `/reports/agency-commissions` (MX-5571) |
| MX-5684-TC13 | Validar click en sidebar `Reports → Daily Report` carga `/reports/daily` (MX-5438) |
| MX-5684-TC14 | Validar click en sidebar `Reports → Expired Documentation` carga `/reports/documentation` (MX-5569) |
| MX-5684-TC15 | Validar click en sidebar `Reports → Unpaid Trips` carga `/reports/unpaid-travels-list` (MX-5531) |
| MX-5684-TC16 | Validar click en sidebar `Reports → Trips Segments` carga `/reports/segments-travels` (MX-5553) |
| MX-5684-TC17 | Validar click en sidebar `GNET → Farm IN` carga `/gnet/farm-in` (MX-5573) |
| MX-5684-TC18 | Validar click en sidebar `GNET → Credit Accounts` carga `/gnet/credit-accounts` (MX-5574) |
| MX-5684-TC19 | Validar click en sidebar `Configuration → Other Costs` carga `/settings/otherCosts` (MX-5575) |
| MX-5684-TC20 | Validar click en sidebar `eAffiliates → Credit Accounts With Affiliates` carga `/affiliate/checking-account` (MX-5554) |

### 16.3 Happy path — Toggle de submenús (lógica `isCollapsed`)

> **Skill qa-magiis · Dimensión 1 (Happy path):** comportamiento esperado de expand/collapse según `withUiState()`.

| ID | Descripción |
| --- | --- |
| MX-5684-TC21 | Validar click en toggle `Reports` cambia `isCollapsed: false` y CSS revela submenú animado |
| MX-5684-TC22 | Validar segundo click en `Reports` vuelve a `isCollapsed: true` (colapsa) |
| MX-5684-TC23 | Validar click en toggle `GNET` expande con `Farm IN` + `Credit Accounts` + sub-rutas |
| MX-5684-TC24 | Validar click en toggle `eAffiliates` expande con `atc-profile`, `offering`, `request`, `os-agreement-*`, `checking-account` |
| MX-5684-TC25 | Validar click en toggle `Configuration` expande con `parameters`, `transportTypes`, `servicesType`, `taxesAndFees`, `otherCosts`, `email-templates`, etc. |

### 16.4 Edge cases — Comportamiento accordion + restauración

> **Skill qa-magiis · Dimensión 2 (Edge cases):** validar el comportamiento accordion confirmado en código (`siblings.forEach(sib => sib.isActive = false)`).

| ID | Descripción |
| --- | --- |
| MX-5684-TC26 | Validar accordion: abrir toggle `Reports` mientras `Configuration` está abierto cierra `Configuration` automáticamente (siblings.isActive = false) |
| MX-5684-TC27 | Validar que al navegar a `/reports/tips`, el padre `Reports` queda `isCollapsed: false` (expandido) y el sub-item `Tips` queda `isActive: true` |
| MX-5684-TC28 | Validar refresh (F5) sobre `/reports/tips` restaura sidebar con `Reports` expandido + `Tips` highlighted (`withUiState()` reactiva al routing) |
| MX-5684-TC29 | Validar deep-link directo (`/carrier/#/gnet/farm-in`) en sesión limpia restaura sidebar con `GNET` expandido + `Farm IN` highlighted |
| MX-5684-TC30 | Validar back/forward del navegador entre pantallas actualiza `isActive` del item correspondiente |
| MX-5684-TC31 | Validar item Magiis Apps Store funciona como enlace directo (no toggle): un solo click navega sin necesidad de expansion |
| MX-5684-TC32 | Validar logo (`<a routerLink="dashboard">`) navega a `/carrier/#/dashboard` y resalta `Operations Control` en el sidebar |

### 16.5 Negativos / validaciones

> **Skill qa-magiis · Dimensión 3 (Negativos):** entradas inválidas, permisos, comportamiento ante fallos.

| ID | Descripción |
| --- | --- |
| MX-5684-TC33 | Validar deep-link a ruta inexistente (e.g., `/carrier/#/foo-bar`) redirige a `/carrier/#/dashboard` sin romper shell |
| MX-5684-TC34 | Validar deep-link a ruta sin permisos del rol carrier (e.g., admin-only) redirige a `/dashboard` o muestra mensaje "No autorizado" |
| MX-5684-TC35 | Validar items del sidebar que el rol carrier NO debe ver están ocultos (no renderizados en `menuItems[]` filtrado por permisos) |
| MX-5684-TC36 | Validar click rápido en 5+ items consecutivos no rompe `isActive` state ni deja inconsistencias en sidebar |
| MX-5684-TC37 | Validar sesión expirada en el medio de navegación redirige a `/auth/login` con mensaje informativo |
| MX-5684-TC38 | Validar logout (`_identityService.logOut()`) limpia storageState + cookies + redirige a `/carrier/#/auth/login` |
| MX-5684-TC39 | Validar intentar acceder a `/carrier/#/dashboard` sin sesión redirige a `/auth/login` (auth guard) |

### 16.6 Regresión — Flujos críticos que NO deben romper

> **Skill qa-magiis · Dimensión 4 (Regresión):** validaciones que protegen contra rotura de comportamientos previos.

| ID | Descripción |
| --- | --- |
| MX-5684-TC40 | Validar navegación entre 10+ pantallas consecutivas no degrada FPS ni genera memory leaks visibles (sin `console.error`) |
| MX-5684-TC41 | Validar que tras cambiar de pantalla, los filtros/search de la pantalla anterior se resetean al volver (no hay state leakage) |
| MX-5684-TC42 | Validar que el scroll del sidebar (`ngx-simplebar`) mantiene posición al cambiar pantalla |
| MX-5684-TC43 | Validar que el sidebar no se duplica visualmente al navegar con back/forward rápido |
| MX-5684-TC44 | Validar que la sesión persiste tras navegar a una pantalla, refresh, y volver a la misma sin re-login |
| MX-5684-TC45 | Validar que el breadcrumb h4 actualiza correctamente al cambiar de pantalla (no queda el de la pantalla anterior) |

### 16.7 Integración — i18n / l10n / Identity Service

> **Skill qa-magiis · Dimensión 5 (Integración):** con servicios externos (`TranslateService`, `LocalizationService`, `IdentityService`).

| ID | Descripción |
| --- | --- |
| MX-5684-TC46 | Validar cambio de locale EN → ES en topbar actualiza labels del sidebar en vivo sin refresh |
| MX-5684-TC47 | Validar cambio de locale ES → EN actualiza labels del topbar (Trip / Trips Management / dropdowns) |
| MX-5684-TC48 | Validar avatar usuario muestra datos del `_identityService.getSessionData()` (companyName, role) y no hardcoded |
| MX-5684-TC49 | Validar notifications dropdown del topbar lista items de `allnotifications[]` con icons y badges |
| MX-5684-TC50 | Validar melita_ai quick access dropdown (`carrier.melita.quick_access.title`) expande con sub-items del servicio Melita |
| MX-5684-TC51 | Validar dark/light mode toggle (`changeMode()`) propaga via `eventService.broadcast('changeMode', mode)` y actualiza CSS variables globales |

### 16.8 Topbar — Acciones del header (módulo Trips)

> **Skill qa-magiis · Dimensión 1+5 (Happy path + Integración):** acciones rápidas del topbar para flujo de viajes (out-of-scope pantalla destino, in-scope navegación desde topbar).

| ID | Descripción |
| --- | --- |
| MX-5684-TC52 | Validar botón verde `+ Trip` (topbar) navega a `/carrier/#/travel/create` |
| MX-5684-TC53 | Validar botón `Trips Management` (topbar) navega a `/carrier/#/travel/dashboard` |
| MX-5684-TC54 | Validar botón `Trips` (topbar dropdown) muestra accesos rápidos (Recurring, Quotes, Mappers) |
| MX-5684-TC55 | Validar avatar usuario despliega menú con `displayName`, opción "Perfil" si existe, y "Logout" |

---

---

## Resumen ejecutivo

| Sección | Pantalla / Ticket | MX | TCs |
| --- | --- | --- | --- |
| 1 | Reportes Tips | MX-5560 | 26 (referencia + cubre 100% features transversales) |
| 2 | Aging Report | MX-5561 | 14 |
| 3 | Collection Movements | MX-5562 | 11 |
| 4 | Electronic Payment Tx | MX-5565 | 10 |
| 5 | Taxes & Fees | MX-5566 | 10 |
| 6 | Payment Movements | MX-5568 | 10 |
| 7 | Company Commissions | MX-5571 | 11 |
| 8 | Daily Report | MX-5438 | 10 |
| 9 | Documentation Expired | MX-5569 | 10 |
| 10 | Unpaid Trips | MX-5531 | 9 |
| 11 | Trips Segments | MX-5553 | 10 |
| 12 | GNET Farm IN | MX-5573 | 10 |
| 13 | GNET Credit Accounts | MX-5574 | 9 |
| 14 | Settings Other Costs | MX-5575 | 8 |
| 15 | Affiliate CC | MX-5554 | 10 |
| 16 | Navbar / Shell (Revisión integral) | **MX-5684** | **55** (cobertura qa-magiis 5 dimensiones) |
| **TOTAL** | **15 pantallas + shell** | **16 tickets Jira** | **223 TCs** (168 P1 + 55 P2) |

### Cobertura MX-5684 por dimensión qa-magiis

| Subsección | Dimensión qa-magiis | TCs |
| --- | --- | --- |
| 16.1 Estado inicial del shell post-login | Happy path | 5 (TC01-TC05) |
| 16.2 Navegación sidebar → pantallas | Happy path | 15 (TC06-TC20) |
| 16.3 Toggle de submenús | Happy path | 5 (TC21-TC25) |
| 16.4 Accordion + restauración estado | Edge cases | 7 (TC26-TC32) |
| 16.5 Negativos / validaciones | Negativos | 7 (TC33-TC39) |
| 16.6 Regresión flujos críticos | Regresión | 6 (TC40-TC45) |
| 16.7 Integración i18n/l10n/IdentityService | Integración | 6 (TC46-TC51) |
| 16.8 Topbar acciones Trips | Happy path + Integración | 4 (TC52-TC55) |
| **TOTAL MX-5684** | **5 dimensiones cubiertas** | **55 TCs** |

## Pantallas excluidas del scope "baja complejidad"

Estas pantallas existen en `release/v2.0.4` pero NO se incluyen en este test suite (alta complejidad — necesitan suite dedicada):

- Operations Control (dashboard con KPIs, charts, mapa, tablas drivers)
- Map Viewer (Leaflet con markers en vivo)
- Travel Dashboard (tabs múltiples + asignación automática + checkboxes)
- Travel detail `/travel/detail/:id` (vista compuesta con mapa + costos + estados)
- Settlements detail flows (`/liquidations/*/create|details|history` con `:id`) — Sprint 8 dedicado
- Affiliate liquidation detail / cc detail (con `:id` y `:typeView`)
- Forms CRUD (New Trip, Owner add/edit, Vehicle add/edit, Driver add/edit, Contractor new, Imports)
- Configuración compleja (Travel fare rules, Profiles access, Branches/Zones/Areas)
- Reports avanzados (rankings con KPIs h4 "Billed" / "Trips" / "Average"): Drivers/Customers/Vehicles Ranking, Cost Center, Individual CA Travels, Corporate Services Type

## Próximos pasos

1. **Tu OK** sobre esta matriz (ajustes/agregar TCs/quitar TCs).
2. **Tras OK**: generar `matriz_cases_baja_complejidad.xlsx` aplicando skill `xlsx` con:
   - Sheet "Matriz" con columnas: ID, Sección, Pantalla, MX, Tipo (Funcional/UX), Prioridad (P1/P2), Descripción, Precondiciones, Pasos, Resultado esperado, Estado.
   - Sheet "Resumen" con cobertura por pantalla.
   - Sheet "Trazabilidad" con mapeo MX → URL → branch feature.
3. **Tras Excel**: generar specs Playwright que referencien cada `MX-XXXX-TCNN` en `test.info().annotations`.

## Reglas de trazabilidad (alineadas a `magiis-playwright-docs-to-drafts`)

- Todo TC en este `.md` debe existir en el `.xlsx` con mismo ID.
- Todo spec Playwright debe referenciar `MX-XXXX-TCNN` en `test.info().annotations.push({ type: 'tc', description: 'MX-5560-TC15' })`.
- Cadena: `matriz_cases_baja_complejidad.md` → `matriz_cases_baja_complejidad.xlsx` → `tests/specs/<modulo>/<pantalla>.spec.ts` → CI reporter junit.xml.
- Prohibido inventar IDs sin agregarlos primero al `.md`. Prohibido dejar `[SIN-ID]` en rama principal.
