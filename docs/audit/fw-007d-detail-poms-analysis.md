# FW-007d — Auditoria Detail + History POMs

**Fecha:** 2026-05-24
**Branch:** `carrier-v2/fw-007b-list-poms-inherit`
**Alcance:** 10 POMs (`*Detail*Page.ts` + `*HistoryPage.ts`) en `tests/pages/carrier-v2/`.

## Veredicto

✅ **TODO YA REFACTORIZADO CORRECTAMENTE.** Cero refactor requerido.

| Categoria            |      POMs |
| -------------------- | --------: |
| Total auditado       |        10 |
| LIMPIO (sin trabajo) | 10 (100%) |
| REFACTOR LIMPIO      |         0 |
| REFACTOR PARCIAL     |         0 |
| NO APLICA            |         0 |

Los 10 POMs Detail e History heredan correctamente de `BaseDetailPage` y unicamente customizan `headingRegex()`. **NO hay redeclaracion de locators ni metodos**. Constructor trivial (solo `super(page)`). Cero deuda tecnica.

## Detalle por POM

| POM                                  | Ruta                                               | Herencia         | Redeclaraciones | Override                                      | Specs consumidores                                          |
| ------------------------------------ | -------------------------------------------------- | ---------------- | --------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `AffiliateCheckingAccountDetailPage` | `/affiliate/checking-account-detail/:id/:typeView` | `BaseDetailPage` | 0               | `headingRegex` (i18n EN/ES + badge IN/OUT)    | `sprint8-affiliate-flows.spec.ts`                           |
| `AffiliateLiquidationDetailPage`     | `/affiliate/liquidation-detail/:id/:editMode`      | `BaseDetailPage` | 0               | `headingRegex` (TODO validar contra DOM real) | `sprint8-affiliate-flows.spec.ts` (validacion ruta sin :id) |
| `SettlementsContractorDetailPage`    | `/liquidations/contractors/details/:id`            | `BaseDetailPage` | 0               | `headingRegex`                                | (no consumido aun)                                          |
| `SettlementsDriverDetailPage`        | `/liquidations/drivers/details/:id`                | `BaseDetailPage` | 0               | `headingRegex`                                | (no consumido aun)                                          |
| `SettlementsOwnerDetailPage`         | `/liquidations/owners/details/:id`                 | `BaseDetailPage` | 0               | `headingRegex`                                | (no consumido aun)                                          |
| `SettlementsPassengerDetailPage`     | `/liquidations/passenger/details/:id`              | `BaseDetailPage` | 0               | `headingRegex`                                | (no consumido aun)                                          |
| `SettlementsContractorHistoryPage`   | `/liquidations/contractors/history/:id`            | `BaseDetailPage` | 0               | `headingRegex`                                | `sprint8-detail-flows.spec.ts`                              |
| `SettlementsDriverHistoryPage`       | `/liquidations/drivers/history/:id`                | `BaseDetailPage` | 0               | `headingRegex`                                | `sprint8-detail-flows.spec.ts`                              |
| `SettlementsOwnerHistoryPage`        | `/liquidations/owners/history/:id`                 | `BaseDetailPage` | 0               | `headingRegex`                                | `sprint8-detail-flows.spec.ts`                              |
| `SettlementsPassengerHistoryPage`    | `/liquidations/passenger/history/:id`              | `BaseDetailPage` | 0               | `headingRegex`                                | `sprint8-detail-flows.spec.ts`                              |

## Hallazgos clave

### BaseDetailPage es suficiente

`BaseDetailPage` expone:

- Locators: `heading`, `breadcrumb`, `backButton`.
- Metodos: `expectDetailReady()`, `getPathSegments()`.

Todos los POMs auditados utilizan **exactamente** este API sin redeclarar.

### Patron History = Detail (correcto)

History pages heredan `BaseDetailPage` (no `BaseListPage`). Razon:

- URL `/liquidations/:type/history/:parent-id` es una pantalla de detalle con `:id`.
- No es una tabla generica — es el historial de un padre especifico.
- Comportamiento: breadcrumb + heading + back button (patron Detail).
- Specs usan `.expectDetailReady()` de BaseDetailPage.

### Cero redundancias

- Ningun POM redeclara `heading`, `breadcrumb`, `backButton`.
- Ningun POM redeclara `expectDetailReady()` o `getPathSegments()`.
- Cada POM solo especializa `headingRegex()`.

## Conclusion

FW-007d se cierra sin cambios al codigo. La jerarquia Detail/History del framework esta sana — a diferencia de las 4 List POMs (que heredaban `BasePage` innecesariamente), los Detail/History jamas desviaron del patron.

## Proximos candidatos (fuera de scope FW-007\*)

- **Cobertura de specs**: agregar specs para los 4 Settlements Details (no consumidos aun). FW-001x.
- **Validar `AffiliateLiquidationDetailPage.headingRegex`** contra DOM real cuando se implemente el spec correspondiente.
- **Auditar especs `release-v2.0.2/sprint8-detail-flows.spec.ts`** para verificar que no asumen estructura interna del POM que el refactor pueda haber alterado.
