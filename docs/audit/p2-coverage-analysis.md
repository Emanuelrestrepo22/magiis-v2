# P2 Coverage Analysis — Auditoria de cobertura tier P2

**Fecha:** 2026-05-24
**Metodo:** cruce del plan P2 (`AUTOMATION-BACKLOG.md`) contra POMs (`tests/pages/carrier-v2/`) y specs (`tests/specs/`) reales. Replica el metodo usado en P1.

## Resumen ejecutivo

De las **14 pantallas P2** del backlog:

| Estado                           | Cantidad | Pantallas                                                                                                           |
| -------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------- |
| ✅ Cubierta (POM + spec)         |        4 | Trip Quotes, Recurring Trips, Passenger Liquidations, Contractor Liquidations                                       |
| 🟡 Falta spec (POM existe)       |        0 | —                                                                                                                   |
| 🔵 Falta POM (requiere DOM real) |       10 | Client Create/Edit/Contractors, Owner Add/Edit, Mappers, Pay Travels, Surrenders Report, Management Board, Heat Map |
| ⏸ No desarrollada                |      0\* | \*ver caveat abajo                                                                                                  |

**Conclusion**: NO hay trabajo de "solo crear spec" disponible (0 pantallas 🟡). Las 10 pendientes requieren **crear POM nuevo**, lo que exige inspeccionar el DOM real -> mismo bloqueo que New Trip/Trip Detail. Fuera del scope inmediato sin acceso a backend/DOM.

## Caveat importante sobre "ruta declarada vs pantalla desarrollada"

El analisis confirmo que las 10 rutas sin POM **aparecen declaradas en `docs/inventory/ROUTING-V2.0.4.md`**. Pero **ruta declarada en el routing Angular != pantalla desarrollada y renderizando UI real**. Antes de crear cualquier POM de las 10, hay que confirmar via discovery (sidebar + navegacion real) que la pantalla renderiza, igual que se hizo para descartar New Trip/Trip Detail. No crear POMs con selectores inventados sobre rutas que podrian rebotar o no estar implementadas.

## Tabla de cobertura

| #   | Pantalla                     | Ruta                                       | POM real                        | Spec real                                                                | Estado                                                        |
| --- | ---------------------------- | ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | Client Create                | `/carrier/#/client/create`                 | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 2   | Client Edit                  | `/carrier/#/client/edit/:id`               | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 3   | Client Contractors list      | `/carrier/#/client/contractors`            | —                               | —                                                                        | 🔵 Falta POM (URL no confirmada en routing — discovery first) |
| 4   | Owner Add                    | `/carrier/#/owner/add`                     | —                               | —                                                                        | 🔵 Falta POM (routing dice `/owner/create` — confirmar URL)   |
| 5   | Owner Edit                   | `/carrier/#/owner/edit/:id`                | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 6   | Trip Quotes                  | `/carrier/#/travel/quotes`                 | `TravelQuotesPage`              | `release-v2.0.2/sprint2-p1.spec.ts` (MX-5572)                            | ✅ Cubierta                                                   |
| 7   | Recurring Trips              | `/carrier/#/travel/recurring`              | `TravelRecurringPage`           | `release-v2.0.2/sprint2-p1.spec.ts` (MX-5537)                            | ✅ Cubierta                                                   |
| 8   | Mappers                      | `/carrier/#/travel/mappers`                | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 9   | Pay travels (Daily Clearing) | `/carrier/#/pay/travels`                   | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 10  | Surrenders Report            | `/carrier/#/pay/surrenders-report`         | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 11  | Passenger Liquidations       | `/carrier/#/liquidations/passenger/list`   | `SettlementsPassengerListPage`  | `sprint6-settlements.spec.ts` + `sprint8-detail-flows.spec.ts` (MX-5647) | ✅ Cubierta (reclasificada P1)                                |
| 12  | Contractor Liquidations      | `/carrier/#/liquidations/contractors/list` | `SettlementsContractorListPage` | idem                                                                     | ✅ Cubierta (reclasificada P1)                                |
| 13  | Management Board             | `/carrier/#/owner-report`                  | —                               | —                                                                        | 🔵 Falta POM                                                  |
| 14  | Heat Map                     | `/carrier/#/owner-heat-map`                | —                               | —                                                                        | 🔵 Falta POM                                                  |

## Reclasificacion

Passenger Liquidations (#11) y Contractor Liquidations (#12) figuraban como P2 en el plan, pero sus POMs declaran `@priority P1` y ya tienen cobertura completa (lista + flujo padre->hijo con `:id`) en sprint6 + sprint8. Se consideran **P1 cubiertas**, reduciendo el P2 efectivo de 14 a 12.

## Pantallas 🔵 priorizadas por esfuerzo (cuando se desbloquee DOM)

Orden sugerido para cuando haya acceso a discovery/backend:

### Tier 1 — Listas (reutilizan BaseListPage, bajo esfuerzo)

1. **Pay Travels** (`/pay/travels`) — lista con filtros + batch actions.
2. **Management Board** (`/owner-report`) — KPI cards + tabla.
3. **Surrenders Report** (`/pay/surrenders-report`) — lista con filtros + totales.
4. **Heat Map** (`/owner-heat-map`) — mapa Leaflet (patron MapViewerPage).

### Tier 2 — Formularios CRUD (esfuerzo medio, validacion)

5. **Client Create** (`/client/create`)
6. **Client Edit** (`/client/edit/:id`)
7. **Owner Add** (`/owner/create`? confirmar) — incluye asignacion de vehiculos (complejo)
8. **Owner Edit** (`/owner/edit/:id`)

### Tier 3 — Discovery primero

9. **Mappers** (`/travel/mappers`) — tabla de reglas.
10. **Client Contractors** (`/client/contractors`) — URL sin confirmar, requiere discovery.

## Recomendaciones

1. **Cuando haya backend/DOM**: arrancar por Tier 1 (4 listas, reutilizan `BaseListPage`, patron ya probado en FW-007b). Usar `tests/specs/explore/sidebar-discovery.spec.ts` para capturar aria-snapshot y derivar selectores reales.
2. **Confirmar URLs ambiguas** con dev antes de crear POM: Owner Add (`/owner/add` vs `/owner/create`), Client Contractors (`/client/contractors` no confirmada).
3. **Actualizar backlog**: marcar Passenger/Contractor Liq como P1-cubiertas.
4. **No crear POMs especulativos**: respetar el criterio de scope (solo pantallas desarrolladas).
