# Release V2.0.2 — Carrier V2 migración Angular

Snapshot 2026-05-19. Mapeo oficial de los 27 tickets de la release a URLs reales del portal + estrategia de automatización Playwright.

## Contexto

- **Versión**: V2.0.2 (Carrier V2)
- **Foco**: Migración paridad v1 → v2 de pantallas Carrier.
- **Tipo QA**: smoke + regresión focalizada (navegación, UI/UX, permisos, filtros, paginación, exportaciones, paridad funcional vs v1).
- **Ambiente target**: TEST (`apps-test.magiis.com/carrier`).
- **Rol prueba**: Carrier (region EEUU / AR según ticket).

## Checklist base por pantalla (de la QA Task)

1. Acceso desde menú → carga sin error.
2. Filtros básicos (fecha/estado/cliente) → aplican correctamente.
3. Paginación + ordenamiento → mantiene estado.
4. Acciones (ver detalle / editar / exportar si aplica) → funcionan y respetan permisos.
5. Validación de UI (columnas / etiquetas / totales) → consistente vs v1.
6. Network: sin 4xx/5xx, params correctos (UI-only — solo verificamos via DOM).
7. Evidencia: screenshots + videos por pantalla.

## Inventario release — 27 tickets

| # | MX | Pantalla | Status QA | URL real V2 | Branch V2 referencia | Backlog tier |
|---|---|---|---|---|---|---|
| 1 | MX-5438 | Viajes — Resumen Diario | Nuevo | `/carrier/#/reports/daily` ✅ | `reports-daily` | P1 |
| 2 | MX-5529 | Listado de Viajes | Finalizada | `/carrier/#/travel/dashboard` ✅ | `travel-dashboard` | P1 |
| 3 | MX-5531 | Travel unpaid list | Nuevo | rebota (variantes probadas) ❌ | `travel-unpaid-list` | **BLOQUEADO** |
| 4 | MX-5537 | Gestión Viajes Recurrentes | En curso | `/carrier/#/travel/recurring` ✅ | `travel-recurring` | P1 |
| 5 | MX-5553 | Viajes por Segmentos | Finalizada | rebota (variantes probadas) ❌ | `segment-travels` | **BLOQUEADO** |
| 6 | MX-5554 | Cuentas Corrientes Con Afiliados | Nuevo | `/carrier/#/affiliate/checking-account` ✅ | `affiliate-checking-account` | P1 |
| 7 | MX-5559 | Visor de Mapa | Nuevo | `/carrier/#/map-viewer` ✅ | `map-viewer` | P1 |
| 8 | MX-5560 | Reportes — Propina | Nuevo | `/carrier/#/reports/tips` ✅ | `reports-tips` | P2 |
| 9 | MX-5561 | Reportes — Antigüedad Deuda | Nuevo | `/carrier/#/reports/debt-aging` ✅ | `reports-debt-aging` | P2 |
| 10 | MX-5562 | Reportes — Movimientos Cobros | Nuevo | `/carrier/#/reports/cash-flow` ✅ | `reports-cash-flow` | P2 |
| 11 | MX-5563 | Reportes — Resumen Diario | **Rechazado** | — | — | **EXCLUIDO** |
| 12 | MX-5564 | Reportes — Cierres Caja Pendientes | Nuevo | rebota ❌ | n/a | **BLOQUEADO** |
| 13 | MX-5565 | Reportes — Transacciones Tarjeta | Nuevo | `/carrier/#/reports/transaction-tracking` ✅ | `reports-transaction-tracking` | P2 |
| 14 | MX-5566 | Reportes — Impuestos y Cargos | Nuevo | `/carrier/#/reports/taxes-and-fees` ✅ | `reports-taxes-and-fees` | P2 |
| 15 | MX-5568 | Reportes — Movimientos Pagos | Nuevo | `/carrier/#/reports/payment-flow` ✅ | `reports-payment-flow` | P2 |
| 16 | MX-5569 | Reportes — Documentación Vencida | Nuevo | `/carrier/#/reports/documentation` ✅ | `reports-documentation` | P2 |
| 17 | MX-5570 | Cierres de Caja Realizados | Nuevo | rebota (variantes probadas) ❌ | n/a | **BLOQUEADO** |
| 18 | MX-5571 | Reportes — Comisiones Agencia | Nuevo | `/carrier/#/reports/agency-commissions` ✅ | `reports-agency-commissions` | P2 |
| 19 | MX-5572 | Viajes — Cotizaciones | Nuevo | `/carrier/#/travel/quotes` ✅ | `travel-quotes` | P1 |
| 20 | MX-5573 | GNET Farm IN | Nuevo | `/carrier/#/gnet/farm-in` ✅ | `gnet-farm-in` | P2 |
| 21 | MX-5574 | GNET Cuentas Corrientes | Nuevo | `/carrier/#/gnet/credit-accounts` ✅ | `gnet-credit-accounts` | P2 |
| 22 | MX-5575 | Configuración — Otros Costos | Nuevo | `/carrier/#/settings/otherCosts` ✅ | `settings-other-costs` | P3 |
| 23 | MX-5646 | Liquidación cuenta corriente | Finalizada | rebota (requiere :id) ⚠️ | `affiliate-liquidation-detail` | P1 (necesita liquidacion previa) |
| 24 | MX-5647 | Liquidaciones | Nuevo | rebota ❌ | `affiliate-liquidations-list` | **BLOQUEADO** |
| 25 | MX-5648 | Detalle CC Afiliado | Nuevo | rebota (requiere :id) ⚠️ | `affiliate-checking-account-detail` | P1 (necesita cc previa) |
| 26 | MX-5650 | DevOps scripts v2.0.1 | Nuevo | — | — | **OUT scope** (backend) |
| 27 | MX-5684 | Revisión integral CarrierV2 | Nuevo | — | — | **OUT scope** (meta) |

**Legenda**: ✅ URL confirmada · ⚠️ existe pero requiere parámetro (`:id`) · ❌ rebota a `/dashboard` (no implementada o URL distinta) · — N/A

## Resultados discovery 2026-05-19

**URLs confirmadas (16/27)**: MX-5438, 5529, 5537, 5554, 5559, 5560, 5561, 5562, 5565, 5566, 5568, 5569, 5571, 5572, 5573, 5574, 5575.

**URLs con parámetro `:id` (2)**: MX-5646, MX-5648 — necesitan crear/seleccionar registro padre antes de navegar al detalle. Estrategia: en el spec hacer click desde la lista padre.

**URLs que rebotan a `/dashboard` (5)**: MX-5531, MX-5553, MX-5564, MX-5570, MX-5647. Pendiente confirmar URL real con dev — probable que estén bajo paths distintos no obvios (e.g., `/travel/dashboard?filter=unpaid` para unpaid-list, o vivan en submenús no expuestos).

**Excluidos (3)**: MX-5563 (Rechazado), MX-5650 (DevOps backend), MX-5684 (meta).

## Cobertura ajustada

| Item | Count |
|---|---|
| Total tickets release | 27 |
| Excluidos | 3 |
| URLs confirmadas (P1 + P2 + P3) | 16 |
| URLs con `:id` (cubrir via flujo padre) | 2 |
| **BLOQUEADAS (URL pendiente con dev)** | **5** |
| **Pantallas automatizables ahora** | **18** |
| Estimación tests funcionales | ~55-65 |

## Cobertura objetivo

| Item | Count |
|---|---|
| Total tickets release | 27 |
| Excluidos (rechazado / meta / devops) | 3 (MX-5563, MX-5650, MX-5684) |
| **Pantallas a automatizar** | **24** |
| URLs ya confirmadas | 7 |
| URLs por descubrir | 17 |
| Estimación tests funcionales | ~75 (~3 por pantalla, base checklist) |
| Estimación tests visuales | 8 P1 con baseline (login + dashboard + listados core) |

## Priorización dentro del release

### P1 (Sprint 2 — 12 pantallas, ~40 tests)

Pantallas críticas operativas: listados core de viajes, liquidaciones, cuentas corrientes con afiliados, visor de mapa, cotizaciones, cierre caja.

1. MX-5559 — Visor de Mapa (`/map-viewer`) ✅
2. MX-5529 — Listado de Viajes (`/travel/dashboard`) ✅
3. MX-5572 — Viajes Cotizaciones (`/travel/quotes`) ✅
4. MX-5537 — Viajes Recurrentes (`/travel/recurring`) ✅
5. MX-5531 — Travel unpaid list (`/travel/unpaid-list` ⏸)
6. MX-5553 — Viajes por Segmentos (`/travel/segments` ⏸)
7. MX-5554 — CC Con Afiliados (`/affiliate/checking-account`) ✅
8. MX-5648 — Detalle CC Afiliado (`/affiliate/checking-account-detail` ⏸)
9. MX-5646 — Liquidación CC (`/affiliate/liquidation-detail` ⏸)
10. MX-5647 — Liquidaciones (`/affiliate/liquidations-list` ⏸)
11. MX-5570 — Cierres Caja Realizados (`/cash-closing/list` ⏸)
12. MX-5438 — Viajes Resumen Diario (`/reports/daily` ⏸)

### P2 (Sprint 3 — 11 pantallas, ~30 tests)

Reportes + GNET — secundarios para operación pero core para análisis.

1. MX-5560 Tips · MX-5561 Debt aging · MX-5562 Cash flow · MX-5564 Cash closing pending
2. MX-5565 Card transactions · MX-5566 Taxes & fees · MX-5568 Payment flow
3. MX-5569 Documentation · MX-5571 Agency commissions
4. MX-5573 GNET Farm IN · MX-5574 GNET CC

### P3 (Sprint 4 — 1 pantalla, ~2 tests)

Configuración auxiliar.

1. MX-5575 — Configuración Otros Costos

## Estrategia de automatización

### Fase 1 — Discovery URLs (1 sesión spec exploratorio)

Las 17 URLs candidatas (⏸) se validan navegando con el spec `tests/specs/explore/sidebar-discovery.spec.ts`. Las que rebotan a `/dashboard` se reportan como bug de routing o se documentan como inexistentes.

### Fase 2 — POMs por pantalla (Sprint 2 = 12 POMs)

Cada pantalla:

```typescript
@jira MX-XXXX
@route /carrier/#/<path>
@priority P1
@type functional

tests/pages/carrier-v2/<NombrePantalla>Page.ts:
  - breadcrumb (h4)
  - heading (h2)
  - filtros (fecha, estado, cliente, etc. según pantalla)
  - searchInput
  - actionButtons (New / Export PDF / etc.)
  - table (getByRole table)
  - pagination (Previous / Next)
  - emptyState (cuando aplica)
  - Helper: applyFilter(), search(), openDetail(rowIndex), exportPdf()
```

### Fase 3 — Specs por checklist (Sprint 2 = ~40 tests)

Cada spec mínimo cubre los 7 items del checklist QA Task:

```typescript
test('1. acceso desde menú', async () => { await ops.goto(); /* via sidebar click */ });
test('2. filtros básicos aplican', async () => { /* fill filter, table updates */ });
test('3. paginación mantiene estado', async () => { /* next page, search persists */ });
test('4. acciones por fila respetan permisos', async () => { /* view detail / edit if not disabled */ });
test('5. UI consistente: columnas + totales', async () => { /* expect headers visible */ });
// 6. Network 4xx/5xx → fuera de scope (frontend only)
// 7. Evidencia → automática (screenshots + video on failure)
```

### Fase 4 — Visual baseline (Sprint 2 = +12 visual)

Cada P1 captura **solo zona estable** (heading + breadcrumb + sidebar context) para evitar diffs por datos volátiles. Estrategia probada en `sidebar-desktop` baseline actual.

### Fase 5 — CI Verde

Smoke nightly debe pasar 100% antes de cerrar release.

## Dependencias / bloqueadores conocidos

| Item | Bloqueador | Mitigación |
|---|---|---|
| 17 URLs ⏸ | Sidebar V2 no expone todas las URLs como links directos | Spec exploratorio + Postman/Network panel |
| MX-5570 cierres realizados | Sin entrypoint en sidebar | Confirmar URL con dev |
| MX-5564 cash closing pending | Sin entrypoint en sidebar | Confirmar URL con dev |
| Sidebar sin `role="navigation"` | Bug a11y | `ShellPage.expectShellReady()` ancla a menu item |
| Botones disabled en TEST | Permisos del usuario `remises.eeuu@yopmail.com` | Verificar solo visibilidad, no funcional de acciones |
| Driver list breadcrumb typo "Managment" | Typo del portal | POMs toleran ambos spellings |

## Roadmap actualizado

| Sprint | Pantallas | Tests acumulados | Status |
|---|---|---|---|
| Sprint 1 (DONE) | 8 | 20 | ✅ |
| Sprint 2 — Release V2.0.2 P1 | 12 | ~60 | 🔵 next |
| Sprint 3 — Release V2.0.2 P2 reportes | 11 | ~90 | 🔵 |
| Sprint 4 — Release V2.0.2 P3 + cleanup | 1 + visual baselines | ~100 | 🔵 |
| Sprint 5+ — Roadmap general (Sprints 4-7 originales) | resto del backlog general | ~135 | 🔵 |

## Plantilla bug report por pantalla

```markdown
**MX-XXXX** — [pantalla]
**Severidad**: blocker / mayor / menor
**Prioridad**: P1 / P2 / P3
**Ambiente**: TEST · apps-test.magiis.com/carrier
**User**: remises.eeuu@yopmail.com

**Pasos**:
1. Login
2. Navegar a [URL]
3. [acción]

**Esperado** (paridad v1):
**Obtenido** (v2):

**Evidencia**: screenshot + video
**Selector afectado**:
**Network**: (si aplica)
```
