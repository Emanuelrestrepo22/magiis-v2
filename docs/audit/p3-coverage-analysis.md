# P3 Coverage Analysis — Auditoria de cobertura tier P3

**Fecha:** 2026-05-27
**Metodo:** cruce del plan P3 (AUTOMATION-BACKLOG.md sec 109-130) contra POMs (tests/pages/carrier-v2/) y specs (tests/specs/) reales. Replica metodo usado en P1/P2.

## Resumen ejecutivo

De las **18 pantallas P3** del backlog:

| Estado                           | Cantidad | Pantallas                                                   |
| -------------------------------- | -------: | ----------------------------------------------------------- |
| ✅ Cubierta (POM + spec)         |        1 | Settings — Other Costs (MX-5575)                            |
| 🟡 Falta spec (POM existe)       |        0 | —                                                           |
| 🔵 Falta POM (requiere DOM real) |        0 | —                                                           |
| ⏸ No desarrollada                |       17 | (16 pantallas Settings + Melita + Affiliate + Integrations) |

**Conclusion**: 1 pantalla cubierta (5.5%), 17 pendientes. De las 17 pendientes, **NINGUNA cumple criterio "Falta spec"** porque no tienen POM existente (requisito previo).

## Hallazgo critico: NO hay trabajo inmediato 🟡 "Falta spec — sin bloqueo"

**Objetivo original de la auditoria:** identificar pantallas P3 con POM ya existente pero sin specs consumidores (estado 🟡), trabajo inmediato sin bloqueo del DOM.

**Resultado:** CERO pantallas en estado 🟡.

- 1 POM P3 existente = SettingsOtherCostsPage (MX-5575) -> **YA COMPLETAMENTE CUBIERTA** (spec funcional sprint4 + a11y + visual). No necesita mas trabajo.
- 17 pantallas P3 = sin POM -> bloqueadas en "falta POM", no en "falta spec"

**Implicacion:** La auditoria P3 NO encuentra trabajo de "crear spec inmediato sin bloqueo". Todo lo pendiente requiere exploración previa (discovery para confirmar que la pantalla existe y navega real en el portal).

## Caveat importante sobre "ruta declarada vs pantalla desarrollada"

Identico hallazgo P2: Las 17 rutas **aparecen declaradas en ROUTING-V2.0.4.md** (codigo Angular de routing). Pero **ruta en config != UI efectivamente renderizando**. El discovery inicial (sidebar-discovery.spec.ts, snapshot 2026-05-19) solo valido 17 pantallas P1+P2, y de P3 solo UNA:

- ✅ Validadas via discovery: SettingsOtherCostsPage (MX-5575)
- ❓ No validadas: 17 pantallas P3 — no aparecen en sidebardiscovery, sprint5-6, sprint7, sprint8 discovery specs

**Criterio de scope (confirmado en P2, aplica aca):** antes de crear POMs de las 17 faltantes, hay que:

1. Confirmar navegacion real (goto() debe llegar a pantalla, no rebotar)
2. Si rebota, no crear POM especulativo, marcar ⏸ hasta que dev la implemente
3. Nunca crear selectores inventados sin validar DOM real

## Tabla de cobertura

| #   | Pantalla                         | Ruta                                        | POM real               | Estado            | MX      |
| --- | -------------------------------- | ------------------------------------------- | ---------------------- | ----------------- | ------- |
| 1   | Settings — Parameters            | /carrier/#/settings/parameters              | —                      | ⏸ No desarrollada | MX-?    |
| 2   | Settings — Transport Types       | /carrier/#/settings/transportTypes          | —                      | ⏸ No desarrollada | MX-?    |
| 3   | Settings — Services Type         | /carrier/#/settings/servicesType/list       | —                      | ⏸ No desarrollada | MX-?    |
| 4   | Settings — Taxes & Fees          | /carrier/#/settings/taxesAndFees            | —                      | ⏸ No desarrollada | MX-?    |
| 5   | Settings — Other Costs           | /carrier/#/settings/otherCosts              | SettingsOtherCostsPage | ✅ Cubierta       | MX-5575 |
| 6   | Settings — Email Templates       | /carrier/#/settings/email-templates         | —                      | ⏸ No desarrollada | MX-?    |
| 7   | Settings — Branches              | /carrier/#/settings/branches/list           | —                      | ⏸ No desarrollada | MX-?    |
| 8   | Settings — Travel Fare List      | /carrier/#/settings/travel-fare-list        | —                      | ⏸ No desarrollada | MX-?    |
| 9   | Settings — Travel Fare Rules     | /carrier/#/settings/travel-fare-rules       | —                      | ⏸ No desarrollada | MX-?    |
| 10  | Settings — Profile Access        | /carrier/#/settings/profiles-access         | —                      | ⏸ No desarrollada | MX-?    |
| 11  | Settings — Profiles              | /carrier/#/settings/profiles                | —                      | ⏸ No desarrollada | MX-?    |
| 12  | Settings — Preferences           | /carrier/#/settings/preferences             | —                      | ⏸ No desarrollada | MX-?    |
| 13  | AI Branches (Melita)             | /carrier/#/melita/ai-branches               | —                      | ⏸ No desarrollada | MX-?    |
| 14  | eAffiliates — Profile            | /carrier/#/affiliate/atc-profile            | —                      | ⏸ No desarrollada | MX-?    |
| 15  | eAffiliates — Offering           | /carrier/#/affiliate/offering               | —                      | ⏸ No desarrollada | MX-?    |
| 16  | eAffiliates — Request            | /carrier/#/affiliate/request                | —                      | ⏸ No desarrollada | MX-?    |
| 17  | eAffiliates — Agreements req.    | /carrier/#/affiliate/os-agreement-requested | —                      | ⏸ No desarrollada | MX-?    |
| 18  | Magiis Apps Store (integrations) | /carrier/#/integrations/list                | —                      | ⏸ No desarrollada | MX-?    |

## Pantalla ✅ CUBIERTA — Detalles de POM + Specs

### SettingsOtherCostsPage (MX-5575)

**Ubicacion:** tests/pages/carrier-v2/SettingsOtherCostsPage.ts

**Clase exacta:** SettingsOtherCostsPage

**Extiende:** BaseListPage

**@route declarado:** /carrier/#/settings/otherCosts

**@priority:** P3

**@type:** functional

**Regex heading:** /other costs|otros costos/i

**Metodos publicos disponibles** (heredados de BaseListPage):

- sync goto() → navega a /carrier/#/settings/otherCosts
- sync expectListReady() → valida heading visible (h2) + tabla existe
- sync expectListReadyWithSearch() → idem + validar searchInput visible
- sync search(query: string) → ingresa texto en searchInput
- sync expectPaginationReady() → valida "Show N" selector + Previous/Next links
- sync clickFirstRowAndCaptureUrl() → hace click en primer row, retorna {finalUrl, lastSegment}
- sync clickFirstRowLastActionButton() → abre ultimo action button de primer row
- sync getDataRowCount() → retorna numero de rows en tabla
- heading (locator) → heading h2 principal
- readcrumb (locator) → breadcrumb h4
- searchInput (locator) → input de busqueda libre
- dateRangeInput (locator) → date picker (si aplica)
- pdfButton (locator) → boton export PDF
-     able (locator) → tabla principal
- pageSizeText (locator) → "Show" label con ng-select
- previousPageLink (locator) → link Previous
- extPageLink (locator) → link Next

**Specs consumidores (4 archivos):**

1. **tests/specs/release-v2.0.2/sprint4-p3.spec.ts** — Spec funcional smoke
   - @P3 @functional @migration
   - Test: "MX-5575 Other Costs - heading + tabla"
   - Basico: goto() + expectListReady()

2. **tests/specs/settings/other-costs-detailed.spec.ts** — Suite detallada (8 tests)
   - Cobertura completa: heading validation, search, pagination, filters
   - CRUD smoke: simular create/edit/delete si aplica

3. **tests/specs/a11y/other-costs-a11y.spec.ts** — Accesibility baseline
   - @a11y tag
   - Validaciones: color contrast, heading hierarchy, form labels, ARIA

4. **tests/specs/visual/other-costs.visual.spec.ts** — Visual regression baseline
   - @visual tag
   - Playwright snapshots del layout

**Estado:** COMPLETAMENTE CUBIERTA. No hay trabajo adicional.

## 17 Pantallas ⏸ NO DESARROLLADAS

Clasificacion: **Requieren discovery previo antes de crear POMs.**

Todas estas 17 pantallas:

- NO aparecen en sidebar-discovery.spec.ts (snapshot 2026-05-19)
- NO hay specs exploratorios que confirmen su navegabilidad
- Si bien estan en routing, no se puede garantizar que esten renderizando en el portal

### Grupo 1: Settings (11 pantallas)

| Num | Pantalla          | Ruta                                  | Patron esperado | Complejidad | Nota                                |
| --- | ----------------- | ------------------------------------- | --------------- | ----------- | ----------------------------------- |
| 1   | Parameters        | /carrier/#/settings/parameters        | BaseListPage    | Bajo        | Lista config, probablemente tabla   |
| 2   | Transport Types   | /carrier/#/settings/transportTypes    | BaseListPage    | Bajo        | Lista config                        |
| 3   | Services Type     | /carrier/#/settings/servicesType/list | BaseListPage    | Bajo        | Lista config                        |
| 4   | Taxes & Fees      | /carrier/#/settings/taxesAndFees      | BaseListPage    | Bajo        | Similar a Other Costs (MX-5575)     |
| 6   | Email Templates   | /carrier/#/settings/email-templates   | BaseListPage    | Medio       | Posible editor HTML/text            |
| 7   | Branches          | /carrier/#/settings/branches/list     | BaseListPage    | Medio       | Posible nested tree o expand        |
| 8   | Travel Fare List  | /carrier/#/settings/travel-fare-list  | BaseListPage    | Medio       | Tabla tariffas, posible edit inline |
| 9   | Travel Fare Rules | /carrier/#/settings/travel-fare-rules | BaseDetailPage  | Alto        | Posible editor reglas, logica       |
| 10  | Profile Access    | /carrier/#/settings/profiles-access   | BasePage        | Alto        | Matriz permisos, grid checkboxes    |
| 11  | Profiles          | /carrier/#/settings/profiles          | BaseListPage    | Bajo        | Lista perfiles, CRUD                |
| 12  | Preferences       | /carrier/#/settings/preferences       | BasePage        | Bajo        | Posible form settings usuario       |

### Grupo 2: Melita (1 pantalla)

| Num | Pantalla    | Ruta                          | Patron esperado | Complejidad | Nota                      |
| --- | ----------- | ----------------------------- | --------------- | ----------- | ------------------------- |
| 13  | AI Branches | /carrier/#/melita/ai-branches | BaseListPage    | Medio       | Integracion IA (MelitaAI) |

### Grupo 3: Affiliate (4 pantallas)

Nota: Affiliate ya tiene 1 POM cubierto (AffiliateCheckingAccountPage) en P1, 4 detail pages en P3.

| Num | Pantalla             | Ruta                                        | Patron esperado | Complejidad | Nota                      |
| --- | -------------------- | ------------------------------------------- | --------------- | ----------- | ------------------------- |
| 14  | Profile              | /carrier/#/affiliate/atc-profile            | BaseDetailPage  | Medio       | Perfil usuario afiliado   |
| 15  | Offering             | /carrier/#/affiliate/offering               | BaseListPage    | Medio       | Oferta/catalogo afiliado  |
| 16  | Request              | /carrier/#/affiliate/request                | BaseListPage    | Bajo        | Lista requests, CRUD      |
| 17  | Agreements requested | /carrier/#/affiliate/os-agreement-requested | BaseListPage    | Bajo        | Lista acuerdos pendientes |

### Grupo 4: Integrations (1 pantalla)

| Num | Pantalla   | Ruta                         | Patron esperado | Complejidad | Nota                             |
| --- | ---------- | ---------------------------- | --------------- | ----------- | -------------------------------- |
| 18  | Apps Store | /carrier/#/integrations/list | BaseListPage    | Medio       | Plugin apps, probablemente cards |

## Proximos pasos — Hoja de ruta (cuando se desbloquee discovery P3)

### Fase 1: Validacion (Sprint siguiente)

1. Crear ests/specs/explore/p3-discovery.spec.ts con las 18 pantallas
2. Ejecutar discovery spec contra portal test
3. Registrar que pantallas navegan ok vs que rebotan
4. Descartar las que no existan

### Fase 2: POM generation (Sprint + 2)

Por cada pantalla que navega real:

- Extraer aria-snapshot y DOM real
- Crear POM en ests/pages/carrier-v2/<NombrePage>.ts
  - Si es lista: extiende BaseListPage
  - Si es form: extiende BaseDetailPage
  - Si es panel: extiende BasePage
- Incluir @route, @priority P3, @type functional, @jira MX-?
- Exportar desde tests/pages/carrier-v2/index.ts

### Fase 3: Spec generation (Sprint + 3)

Por cada POM nuevo:

- Crear smoke spec basico en tests/specs/<modulo>/<nombre>.spec.ts
- Test minimo: goto() + expectListReady() (o equivalent)
- Tag @P3 @functional
- Validar local con
  px playwright test tests/specs/<modulo> --project=carrier-v2-desktop

### Priorizacion sugerida cuando discovery confirme que existen:

**Tier 1 (rapido, reutiliza BaseListPage — ~30 min por POM):**

- Settings parameters
- Settings transport types
- Settings services type
- Settings branches
- Settings preferences
- Affiliate request
- Integrations Apps Store

**Tier 2 (medio, probablemente editors o componentes complejos — ~1-2h por POM):**

- Settings taxes & fees (similar a MX-5575, poco trabajo)
- Settings email templates
- Settings profiles
- Melita AI Branches
- Affiliate offering

**Tier 3 (complejo, logica custom — ~3-4h por POM):**

- Settings travel fare rules (probablemente ruleset editor)
- Settings profile access (matriz permisos, grid)
- Affiliate profile (detail form)

## Recomendaciones

1. **Respeta criterio de scope (confirmado P2):** Solo automatizan pantallas **ya desarrolladas** en el portal. Las 17 P3 quedan diferidas hasta discovery confirme navegacion real.

2. **NO crear POMs especulativos:** El caveat es critico:
   outing angular != UI renderizando. Antes de escribir un solo selector, validar via discovery que goto() llega a pantalla renderizada, no rebota.

3. **Actualizar AUTOMATION-BACKLOG.md:** Agregar status ⏸ para las 17 pantallas con nota "awaiting P3 discovery validation".

4. **Futura auditoria (cuando dev implemente las 17):** Extender discovery spec, reclasificar cada una a ✅ (cubierta) o 🔵 (falta POM), y proceder por sprint.

5. **Coordinacion con dev:** Confirmar con equipo de dev si las 17 estan realmente en el backlog de implementacion para el release V2.0.x actual, o si son para futuros releases.
