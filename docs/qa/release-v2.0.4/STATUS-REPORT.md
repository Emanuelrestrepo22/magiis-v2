# Release V2.0.4 — Reporte ejecutivo de cierre QA

> **Fecha**: 2026-05-21
> **Branch**: `main` @ `b3b4ca2`
> **Alcance**: 16 pantallas baja-complejidad del portal carrier V2

## Cobertura triple

Las 16 pantallas baja-complejidad del Release V2.0.4 están cubiertas en las **3 dimensiones de testing** automatizadas:

| Dimensión                       |         Cobertura | Detalle                                              |
| ------------------------------- | ----------------: | ---------------------------------------------------- |
| **Funcional**                   |     223 / 223 TCs | Cada `MX-XXXX-TCNN` de la matriz tiene su `test()`   |
| **Accesibilidad (WCAG 2.1 AA)** |     16 / 16 specs | Soft audit con `@axe-core/playwright`                |
| **Visual regression**           | 16 / 16 baselines | Captura del card body con masking de datos volátiles |

## Mapeo MX-XXXX × Triple cobertura

| Ticket    | Pantalla              | Funcional TCs |  A11y  | Visual baseline |
| --------- | --------------------- | ------------: | :----: | :-------------: |
| MX-5560   | Tips Report           |            26 |   ✅   |       ✅        |
| MX-5561   | Aging Report          |            14 |   ✅   |       ✅        |
| MX-5562   | Collection Movements  |            11 |   ✅   |       ✅        |
| MX-5565   | Electronic Payment Tx |            10 |   ✅   |       ✅        |
| MX-5566   | Taxes & Fees          |            10 |   ✅   |       ✅        |
| MX-5568   | Payment Movements     |            10 |   ✅   |       ✅        |
| MX-5571   | Company Commissions   |            11 |   ✅   |       ✅        |
| MX-5438   | Daily Report          |            10 |   ✅   |       ✅        |
| MX-5569   | Expired Documentation |            10 |   ✅   |       ✅        |
| MX-5531   | Unpaid Trips          |             9 |   ✅   |       ✅        |
| MX-5553   | Trips Segments        |            10 |   ✅   |       ✅        |
| MX-5573   | GNET Farm IN          |            10 |   ✅   |       ✅        |
| MX-5574   | GNET Credit Accounts  |             9 |   ✅   |       ✅        |
| MX-5575   | Other Costs           |             8 |   ✅   |       ✅        |
| MX-5554   | Affiliate CC          |            10 |   ✅   |       ✅        |
| MX-5684   | Navbar / Shell        |            55 |   ✅   |  ✅ (sidebar)   |
| **TOTAL** |                       |       **223** | **16** |     **16**      |

## Infraestructura CI activa

| Workflow         | Trigger                                           | Suite                                                                |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `smoke.yml`      | PR + push branches + nightly 06:00 UTC + dispatch | `--grep @P1 --grep-invert @visual`                                   |
| `regression.yml` | nightly 07:00 UTC + dispatch                      | Suite completa funcional (UAT job comentado, pendiente credenciales) |
| `visual.yml`     | weekly lunes 08:00 UTC + dispatch                 | `--project=visual`                                                   |
| `a11y.yml`       | weekly lunes 08:00 UTC + dispatch                 | `--grep @a11y`                                                       |

**Multi-region**: US primaria + AR secundaria configuradas en GitHub Environment `TEST`. FR placeholder documentado in-file.

## Findings principales del audit a11y

478 nodos en 7 reglas WCAG distintas. **Bugs sistemáticos** (afectan todas las pantallas):

| Severity    | Regla                   | Pantallas | Nodos |
| ----------- | ----------------------- | --------: | ----: |
| 🔴 critical | `button-name`           |     16/16 |    64 |
| 🔴 critical | `label`                 |     10/16 |    19 |
| 🟡 serious  | `color-contrast`        |     16/16 |   320 |
| 🟡 serious  | `link-name`             |     16/16 |    36 |
| 🟡 serious  | `html-has-lang`         |     16/16 |    16 |
| 🟡 serious  | `autocomplete-valid`    |      7/16 |    12 |
| 🟡 serious  | `aria-progressbar-name` |     11/16 |    11 |

**Acción siguiente**: reportar `button-name` + `label` críticos a dev como tickets Jira A11Y. Una vez arreglados a nivel global, ~480 nodos bajan a casi 0 sin tocar pantallas individuales. Detalle completo en [`a11y-audit-results.md`](./a11y-audit-results.md).

## Tracking de evolución

| Hito                                                                   | Commit    |
| ---------------------------------------------------------------------- | --------- |
| Sprint 8 - Settlements + Affiliate detail flows                        | `a6d9ada` |
| Release V2.0.4 - Completar matriz funcional (12 specs + navbar 55 TCs) | `cdf8dcf` |
| Suite A11y - 16 specs WCAG + workflow + reporte                        | `7132994` |
| Suite Visual - 15 specs nuevos + 16 baselines                          | `b3b4ca2` |

## Sprints planificados (siguiente roadmap)

| Sprint | Foco                                                                         | Cuándo                                              |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| TBD    | Pantallas alta-complejidad (Map Viewer, Travel Detail, New Trip, Forms CRUD) | Bloqueado por dev — pantallas aún no migradas en V2 |
| TBD    | UAT environment activation                                                   | Bloqueado por credenciales pendientes               |
| TBD    | Carrier FR multi-region                                                      | Bloqueado por cuenta FR pendiente                   |
