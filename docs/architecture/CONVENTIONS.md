# Convenciones — magiis-carrier-v2-e2e

> **Canon committeado.** Este archivo SUPERSEDE, donde discrepe, a `docs/architecture/POM-CONVENTIONS.md`,
> `docs/architecture/ARCHITECTURE.md` (§layout, §trazabilidad), `docs/architecture/BEST-PRACTICES.md`
> (§imports, §trazabilidad) y `traceability/README.md`, así como las plantillas de `scripts/scaffold/*`.
> Es la fuente de verdad medida contra el código real, no un plan aspiracional. Cuando este archivo y
> uno de los cuatro anteriores discrepen, **manda este archivo**. Cada regla lleva su evidencia
> (`path:line` o hecho medido). Fecha de la medición base: 2026-09-02.

---

## 1. Layout y naming

- Un Page Object por pantalla migrada en `tests/pages/carrier-v2/<dominio>/<Pantalla>Page.ts` (PascalCase),
  export agregado en el barrel `tests/pages/carrier-v2/index.ts`. Ejemplo:
  `tests/pages/carrier-v2/operations/MapViewerPage.ts`.
- Los POMs usan **los mismos dominios que los specs**, para que una pantalla se lea igual de los dos lados
  (`tests/specs/trips/new-trip.spec.ts` ↔ `tests/pages/carrier-v2/trips/NewTripPage.ts`). Medido: 13
  carpetas — `{affiliate,clients,drivers,gnet,integrations,operations,owners,reports,settings,settlements,tickets,trips,vehicles}/`.
  No hay `auth/` ni `shell/` acá: `LoginPage` y `ShellPage` son cross-portal y viven en `shared/`.
- `tests/specs/<dominio>/` — **una carpeta por dominio, sin nivel de suite intermedio**. El dominio es
  el namespace de ruta de la app. Medido: `tests/specs/{affiliate,auth,clients,drivers,gnet,integrations,operations,owners,reports,settings,settlements,shell,tickets,trips,vehicles}/`
  (15 dominios) más dos carpetas que **no** son dominio: `exploratory/` (herramientas de relevamiento)
  y `release/` (paquetes P1 que cruzan varios dominios).
- Las tres suites conviven en la carpeta de su dominio: el funcional es `<pantalla>.spec.ts`, el visual
  `<pantalla>.visual.spec.ts` y el de accesibilidad `<pantalla>-a11y.spec.ts`. **No** hay carpetas
  `smoke/`, `regression/`, `a11y/` ni `visual/`: la suite se elige por **tag**, no por ruta
  (`--grep @P1`, `--grep @a11y`, `--grep-invert @visual`). Por eso el project `visual` de
  `playwright.config.ts` selecciona por `testMatch: '**/*.visual.spec.ts'` y no por `testDir`.
- Corolario: **nada debe derivar la suite del path de un spec.** `scripts/generate-dashboard.cjs` lo
  hacía y ahora lee `spec.tags` del reporter json.
- Spec visual: `<pantalla>.visual.spec.ts`, baseline commiteado junto al spec en `<spec>.spec.ts-snapshots/`.
- `shared/` = piezas reutilizables cross-pantalla (`BasePage`, `LoginPage`, `ShellPage`). `carrier-v2/` = una
  pantalla concreta del portal V2.

## 2. Imports — ESM relativo con `.js`, NUNCA alias

- Los alias `@pages/@fixtures/@helpers/@config/@data/@utils` **existen** en `tsconfig.json:20-25`, pero
  **no hay resolver conectado a Playwright**: un import aliaseado explota en runtime, no en typecheck.
- Medido: **0 archivos** en `tests/specs/` (77 specs) y **0** en `tests/pages/` importan con alias. Los 7 hits
  de alias del repo están fuera de la ruta caliente — `tests/fixtures/{a11yFixture,visualBaseline}.ts`,
  `tests/fixtures/factories/index.ts`, `tests/api/mocks/listMock.ts`, dos `README.md` y el JSDoc de
  `tests/utils/traceability.ts:12` (corregido en este Wave 0, ver §15).
- Regla: import relativo con extensión `.js` explícita (ESM), tal como hace `new-trip.spec.ts:28-30`:
  ```ts
  import { test, expect } from '../../TestBase.js';
  import { NewTripPage } from '../../pages/carrier-v2/NewTripPage.js';
  import { makeAnnotate } from '../../utils/traceability.js';
  ```

## 3. Idioma

- Comentarios, JSDoc, títulos de `test()`, motivos de `test.skip`/`test.fixme` y este documento: **español**
  (sin excepción — medido sobre 72 specs). Identificadores de clase/método/variable, nombres de archivo,
  tags, commits y ramas: **inglés**.
- Es una desviación deliberada de la Regla #14 del HUB (artefactos de repo en inglés) — ver §15.

## 4. Tags y títulos

- Tags en el título del `test.describe`, orden fijo: `@P1|@P2|@P3 @functional|@visual|@a11y|@explore @migration`
  - key TM/MG cuando aplica. Ejemplo real: `new-trip.spec.ts:52` —
    `'@P1 @functional @migration MG-19 Nuevo Viaje - primera ronda matriz QA'`.
- Título de test: `TC<NN> <descripción en español>`. Ejemplo: `'TC161 Destino Abierto ofrece el switch...'`.
- `@smoke` / `@regression` como tags de título están **sin uso** — medido: `npm run test:smoke` filtra por
  `--grep @P1` (`package.json:14`), no por `@smoke`. La suite sale de la **prioridad** (`@P1` → smoke,
  `@P2`/`@P3` → regression) y del **sufijo del archivo** (`.visual.` / `-a11y`); ya no hay carpeta de
  suite que la nombre (ver §1).

## 5. Trazabilidad

- Helper canónico `makeAnnotate(key, route?)` de `tests/utils/traceability.ts`, contrato `type:'tms'` (no
  `type:'jira'`, que es legacy muerto — medido: 1 sola ocurrencia en todo el repo y es un comentario de
  `tests/utils/reporters/xray-reporter.ts:54` explicando el puente legacy, cero specs lo emiten hoy).
- `scripts/extract-tc-map.ts` **parsea fuente, no runtime**: resuelve `makeAnnotate('TM-1', ROUTE)` (literal)
  o `makeAnnotate(CONST, ROUTE)` (constante `const`/`let` del **mismo archivo**), nunca una expresión indexada
  (`MAPA[clave]`) ni un wrapper propio — ver `scripts/extract-tc-map.ts:44-54` (`CONST_BINDING_REGEX` +
  `MAKE_ANNOTATE_REGEX`). Envolver `makeAnnotate` en un mapa deja el spec huérfano en silencio.
- Key namespace: **TM-** (Test Xray) referenciando la story **MG-** en el JSDoc/comentario del spec —
  precedente `new-trip.spec.ts:6` (`ATP TM-36 · ATR TM-18`, keys `TM-508..TM-784` declaradas como
  constantes sueltas en `new-trip.spec.ts:38-47`). MX-XXXX es histórico (migración MX→MG del 2026-07-17);
  no emitir keys MX nuevas.
- Patrón exacto a copiar:
  ```ts
  const ROUTE = '/carrier/#/travel/create';
  const TM_TC161 = 'TM-602';
  makeAnnotate(TM_TC161, ROUTE)('TC161', 'EC');
  ```

### 5.1 ATR de automatización — de la corrida en V2 al import en el padre

Flujo verificado end-to-end (MG-682, piloto TM-1139..TM-1143, 2026-09-09):

1. **Este repo (V2) genera el archivo de resultados**, nunca importa nada él mismo
   (no tiene credenciales de Xray). `tests/utils/reporters/xray-reporter.ts` es un
   reporter Playwright OPT-IN (activado con `XRAY=1` en `playwright.config.ts`) que
   escribe `evidence/<env>/xray-results.json` en formato Xray JSON nativo,
   deduplicando por `testKey` (annotation `type:'tms'`, ver §5) y quedándose con el
   peor estado si hay retries (`PASSED < TODO < ABORTED < FAILED`).
2. **El padre (`agentic-qa-boilerplate`) importa**, con sus propias credenciales
   Xray/Jira (nunca copiadas a este repo):
   ```bash
   bun cli/xray/index.ts import xray --file "<ruta absoluta al xray-results.json de V2>"
   ```
   El import devuelve solo `{ id, key }` de la Test Execution creada — **no** es
   confirmación de que el contenido quedó bien acreditado (ver gotcha de
   `info.project` más abajo). Verificar siempre leyendo Xray:
   ```bash
   bun cli/xray/index.ts exec get <key-devuelta>
   bun cli/xray/index.ts run list --execution <key-devuelta>
   ```
3. **Env vars que arma el reporter en `info` de la ejecución nueva** (todas
   opcionales, todas leídas por `xray-reporter.ts` al correr con `XRAY=1`):
   - `XRAY_PROJECT_KEY` → `info.project` — el proyecto Xray (`TMS_PROJECT_KEY`,
     ej. `TM`) donde crear la ejecución. **Gotcha confirmado**: Xray Cloud NO
     rechaza un import sin `info.project` ni con un valor equivocado — crea la
     Test Execution igual y simplemente no matchea el `testKey` contra ningún
     Test real de ese proyecto. El resultado se ve "importado" en la consola pero
     no acredita nada. Por eso el paso de verificación leída (arriba) es
     obligatorio, nunca confiar en la salida del `import`.
   - `XRAY_TEST_PLAN_KEY` → `info.testPlanKey` (ATP al que se quiere asociar).
   - `XRAY_SUMMARY` → `info.summary` de la ejecución nueva.
   - `XRAY_EXECUTION_KEY` (alternativa a las tres de arriba) → importa contra un
     ATR **ya existente** en vez de crear uno nuevo.
   - `XRAY_KEY_ALLOWLIST` → CSV de keys aceptadas. Si está seteada, toda key fuera
     de la lista se descarta (no se emite) y se cuenta en consola: evita que el
     import sume al ATR un Test que no es miembro o pise runs de otra familia.
     Vacía o ausente = sin filtro. La fija `scripts/run-xray-atr.ts` por familia.
   - El reporter también arma el `comment` de medición (annotation `xray_comment`)
     y `evidence[]` (adjuntos png/json redactados). **Sin evidencia no hay
     veredicto**: un PASSED/FAILED sin adjuntos se emite como TODO con el motivo
     «veredicto retenido» y la corrida sale con código distinto de 0
     (evidence-conventions §4).
4. **Gotcha adicional confirmado (2026-09-09): `info.testPlanKey` NO crea el
   link Jira Plan↔Execution.** El import con `testPlanKey` en el body no generó
   ningún `issuelink` visible entre la Test Execution nueva y el Test Plan — se
   verificó leyendo `issuelinks` de ambos issues por REST y el plan no lista la
   ejecución nueva entre sus links (`is tested by` / `tests`), a diferencia de
   ATRs previos (p. ej. `TM-1137`, `TM-1138`) que sí aparecen enlazados porque
   ese link se creó a mano en su momento. El `xray-cli` de este framework no
   trae un comando para crear ese issuelink — si se necesita el ATR colgando
   visiblemente del ATP en Jira, hay que enlazarlo a mano (o vía Atlassian
   MCP/`acli`) después del import.
5. **`--reporter=list` en la CLI de Playwright pisa el reporter de Xray
   (gotcha).** El array `reporter: [...]` de `playwright.config.ts` sólo se
   respeta completo cuando no se pasa `--reporter` por línea de comandos —
   pasar `--reporter=list` reemplaza TODA la lista configurada (incluido
   `xray-reporter.ts`) por el reporter `list` a secas, y `evidence/<env>/xray-results.json`
   queda con el contenido de la corrida anterior sin avisar del todo (no hay
   error, simplemente no se reescribe). Medido corriendo la misma prueba con y
   sin el flag: con `--reporter=list` el archivo no cambió de timestamp; sin el
   flag, sí. **Nunca pasar `--reporter=` cuando se corre con `XRAY=1`** — dejar
   que `playwright.config.ts` arme la lista completa.
6. **Modelo vigente (2026-09-09, actualizado el mismo día): un ATR FIJO por
   familia, que se ACTUALIZA en cada corrida, en vez de un ATR nuevo por
   corrida.** Los pasos 1-5 de arriba describen el mecanismo genérico; esta es
   la decisión de cómo se usa hoy:
   - **`TM-1146`** — _ATR · Carrier v2 — Alta de Viaje (automatizado, estado
     vigente)_ — es el **único** destino de reporte de la automatización de
     MG-19 (pantalla Nuevo Viaje), con sus **26 casos** (2026-09-30): `TM-501`, `TM-603`,
     `TM-604`, `TM-606`, `TM-607`, `TM-610`, `TM-611`, `TM-612`, `TM-616`,
     `TM-508`, `TM-522`, `TM-602`, `TM-605`, `TM-608`, `TM-609`,
     `TM-770`, `TM-783`, `TM-784`, `TM-843`, `TM-844`, `TM-538`, `TM-772`,
     `TM-817`, `TM-789`, `TM-802`, `TM-819`. `TM-500` (TC059) fue retirado el
     2026-09-30: era un `fixme` sin lógica; en Xray se quitó del ATR y volvió a Manual.
   - **`TM-1147`** — _ATR · Carrier v2 — MG-682 flags de ruta (automatizado,
     estado vigente)_ — 5 casos: `TM-1139`..`TM-1143`.
   - **`TM-1280`** — _ATR de automatización de Otros Costos en Nuevo Viaje
     (MG-995/MG-996, estado vigente)_ — 11 casos. La fase 1 automatiza 8:
     `TM-1084`, `TM-1085`, `TM-1086`, `TM-1087`, `TM-1090`, `TM-1091`, `TM-1277`,
     `TM-1279`; `TM-1088`, `TM-1092` y `TM-1093` quedan TO DO hasta la fase 2.
     Familia `othercosts` (`npm run test:xray:othercosts`): corre en **UAT** por
     defecto, un solo project (`carrier-v2-desktop`) y `--workers=1`; fija el gate
     `OTHER_COSTS_CREATE_DATA=1` (crea conceptos y viajes reales y los limpia),
     `XRAY_KEY_ALLOWLIST` con las 11 keys y `REUSE_STORAGE_STATE=1` por defecto
     (sesión guardada, sin login con contraseña; login explícito =
     `REUSE_STORAGE_STATE=0`).
   - **`TM-1281`** — _ATR: MG-995/MG-996: Smoke automatizado — ABM de otros costos
     (Carrier V2, automatizado, estado vigente)_ — 6 casos: `TM-985`, `TM-1002`, `TM-1007`,
     `TM-1008`, `TM-1014`, `TM-1017`. Familia `othercosts-smoke`
     (`npm run test:xray:othercosts-smoke`, spec
     `tests/specs/settings/other-costs-smoke-abm.spec.ts`): mismo criterio que `othercosts`
     (UAT, `carrier-v2-desktop`, `--workers=1`, gate `OTHER_COSTS_CREATE_DATA=1`,
     `REUSE_STORAGE_STATE=1`). `XRAY_KEY_ALLOWLIST` = las 6 **menos `TM-1014`**: el test corre y
     adjunta evidencia, pero el borrado lógico no tiene firma del PO ni es verificable sin base de
     UAT, así que su run queda TO DO (decisión D-A2 del plan smoke ABM). `TM-1017` se acredita con
     cobertura parcial declarada (solo rol con PRC.C; el resto es `TM-1149`). Escribe su propio
     archivo, `evidence/<env>/xray-results.othercosts-smoke.json` (campo `resultsFile` de la
     familia → `XRAY_RESULTS_FILE`, que `playwright.config.ts` respeta), para no pisar el de
     Nuevo Viaje. Conceptos con el nombre `QA E2E OC SMK <runId>` (el `sweep` los reconoce).
   - Cada corrida setea `XRAY_EXECUTION_KEY` a uno de esos valores (nunca
     `XRAY_PROJECT_KEY`/`XRAY_SUMMARY`/`XRAY_TEST_PLAN_KEY` para armar un
     bloque `info` — con `XRAY_EXECUTION_KEY` seteada el reporter nunca
     construye `info`, ver punto 3) y el import ACTUALIZA los runs existentes
     de ese ATR en lugar de crear uno nuevo. Es el único lugar que hay que
     mirar para saber cómo está la automatización de esa familia hoy; la
     evidencia manual histórica (`TM-18`, `TM-967`, y los pilotos
     `TM-1137`/`TM-1138`/`TM-1144`/`TM-1145`) queda intacta y no recibe runs
     nuevos.
   - Scripts: `scripts/run-xray-atr.ts <familia>` (`trips` → `TM-1146`, `mg682`
     → `TM-1147`, `othercosts` → `TM-1280`, `othercosts-smoke` → `TM-1281`), invocado vía
     `npm run test:xray:trips` / `npm run test:xray:mg682` / `npm run test:xray:othercosts` /
     `npm run test:xray:othercosts-smoke`. Un solo script parametrizado por familia — no dos casi
     iguales — para no duplicar la lógica de projects/env por cada nueva
     familia que se agregue.
   - **`TM-538` (`new-trip-happy-path.spec.ts`, TC37) corre siempre en la
     familia `trips`** (desde 2026-09-30): crea un viaje real con pasajero
     invitado `qa_e2e_*` y lo cancela por UI en `afterEach` (política de datos
     G5, cancelación en `TravelDashboardPage`). El gate `MG19_CREATE_TRIP` fue
     retirado. Si la cancelación falla, el test adjunta el id y falla explícitamente
     para que quede en el run record.
   - **Evidencia por run (desde 2026-09-30)**: cada caso de la familia cierra con
     `attachXrayEvidence(testInfo, page, { name, comment })` (`tests/helpers/xray-evidence.ts`,
     re-exportado por `TestBase`): captura + anotación `xray_comment` que el reporter
     sube al run. Un test sin adjunto queda retenido como `TO DO` en Xray. Sin `retries`
     en la familia: el ATR muestra el estado real.
   - **Corte de reporte a `TM-830` (decisión 2026-09-09)**: `TM-830` — _ATR ·
     Alta de Viaje — Catálogo TL (Ronda 2)_, 66 casos, status _Listo para
     Producción_ — **ya no recibe corridas de este script**. Antes 3 de sus 66
     casos (`TM-770`, `TM-783`, `TM-784`) se reportaban ahí también, mediante
     la familia `tm830` con un `--grep` obligatorio (`TC(197|210|211)`) para no
     colar los 7 tests de Ronda 1 (`TM-18`) que comparten archivo fuente. Esa
     familia y su `--grep` obligatorio **se eliminaron** de
     `scripts/run-xray-atr.ts` — el reporte de esos 3 casos se centralizó en
     `TM-1146` (que ya los tenía como miembros: ver lista de 22 arriba), y
     `TM-830` queda como ronda **solo manual**, sin recibir más runs
     automatizados. El aviso sobre el `--grep` obligatorio de `tm830` que
     figuraba en esta sección quedó retirado: no hay ninguna familia vigente
     que lo necesite.
   - **Verificado end-to-end el 2026-09-09 contra TEST** _(medición histórica: `TM-500` y el gate
     `MG19_CREATE_TRIP` que se mencionan abajo ya no existen desde 2026-09-30)_ (el login que había
     rechazado credenciales el día anterior, por el front recién subido a
     v2.0.15, ya funcionaba): `npm run test:xray:trips` corrió los 5 specs de
     la familia (44 tests = 22 casos × 2 projects, `carrier-v2-desktop` +
     `carrier-v2-laptop`) contra `ENV=test`, 40 passed + 4 skipped (`TM-500`
     por `test.fixme` preexistente sin relación con este cambio, y `TM-538`
     por el gate `MG19_CREATE_TRIP` sin activar). `evidence/test/xray-results.json`
     trajo 20 entradas (`testExecutionKey: TM-1146`, sin bloque `info`) — las
     22 menos `TM-500`/`TM-538`. El import devolvió `key: TM-1146` (no una key
     nueva); `run list --execution TM-1146` mostró 20 `PASSED` + 2 `TO DO`
     (`TM-500`, `TM-538`) sobre un total que **se mantuvo en 22**;
     `run list --execution TM-830` dio 66 antes y 66 después, sin cambios de
     estado nuevos; `exec list --project TM --limit 5` no mostró ninguna
     ejecución nueva (siguió con `TM-1147`/`TM-1146` como más recientes).

## 6. POM

- Jerarquía: `BasePage` (común a todas las pantallas) → `BaseListPage` / `BaseDetailPage` (según patrón de
  pantalla) → `<Pantalla>Page`. Ver `docs/architecture/POM-CONVENTIONS.md` §"Cuando crear BasePage vs
  herencia simple" para el árbol de decisión (esa sección no está entre las desactualizadas).
- Locators: **`readonly` público**, sin `private`. Ejemplo real: `MapViewerPage.ts:14-28` (16 locators
  `readonly ...: Locator`, ninguno `private`). Medido: queda **1 archivo legacy** con `private readonly`
  (`LoginPage.ts`) — no imitarlo, es anterior a la convención actual. El otro legacy que figuraba acá,
  `DashboardCarrierPage.ts`, se eliminó al unificar los dos POMs de `/carrier/#/dashboard`.
- Al extender un método de la Base, usar `super.X()` dentro del override — nunca que la Base llame
  `this.X()` sobre un método overrideable (virtual dispatch → recursión infinita, caso real documentado en
  `POM-CONVENTIONS.md` §"Gotcha: virtual dispatch", FW-007b 2026-05-24). Esa sección tampoco está
  desactualizada.
- Barrel `tests/pages/carrier-v2/index.ts`: el scaffolding **no** lo actualiza — agregar el export a mano.
  Es hot file de programa (ver §11): un único escritor por ola.

## 7. Selectores

- Orden de preferencia medido en el spec ejemplar: `getByRole` con nombre accesible bilingüe → `id` /
  `formcontrolname` → clase CSS acotada (`PLAN-ITERATIVO.md` R1). `getByLabel` cuando hay `<label>` asociado.
- **`data-testid` no existe en el front v2** (0 ocurrencias en `refs/`). El helper `byTestId()` de
  `tests/helpers/selectors.ts` está listo para cuando el equipo de front lo exponga, pero **no tiene
  llamadores hoy** (ver §8, `tests/helpers/*` está muerto).
- Una pantalla sin roles/labels accesibles se reporta como **bug de accesibilidad**; no se parchea con CSS
  frágil ni `nth-child`.
- Derivar selectores SIEMPRE de `git show origin/main:<path>` sobre `refs/v2/`, nunca del working tree —
  medido: el working tree de `refs/v2/` está congelado en **v2.0.4** (mayo 2026), lo desplegado es
  **v2.0.13**. Confirmar el release desplegado leyendo `ng-version` + el footer "Version x.y.z" del login
  antes de dar por buena una nota "no desarrollada" (ver §14 y §15).

## 8. Assertions y lint

- Prohibido `waitForTimeout` y `networkidle` — reglas ESLint `playwright/no-wait-for-timeout: 'error'` y
  ausencia deliberada de `networkidle` (`eslint.config.js:38`, `tests/helpers/waits.ts:2-3`). Medido: 0 usos
  reales en `tests/`, las únicas 4 ocurrencias son comentarios explicando la prohibición.
- `playwright/expect-expect` es **error** con allowlist cerrada (`eslint.config.js:43-58`), copiada
  literal:
  `expect`, `expectListReady`, `expectListReadyWithSearch`, `expectPaginationReady`, `expectShellReady`,
  `expectSkeletonReady`, `expectMapReady`, `expectTabsReady`, `expectMainSectionsReady`.
  Un `expectFooReady()` nuevo rompe el lint — reusar un nombre de la lista o dejar un `expect()` explícito
  en el test.
- `tests/helpers/*` (`assertions.ts`, `selectors.ts`, `waits.ts`, `index.ts`) tiene **0 llamadores** medidos
  en `tests/specs/` y `tests/pages/`, y su diseño apunta a Angular Material / PrimeNG, que **este front no
  usa**. No estrenarlos — locators y asserts inline, como el resto del repo.
- Assert vacuo prohibido: no afirmar sobre un locator que **nunca existe** en ese estado (ejemplo real:
  `toBeHidden()` de un botón que nunca se renderiza pasaría también con la validación rota — ver
  `new-trip.spec.ts:217-221`). Probar el efecto observable, o el par de control en el estado contrario.
- `readonly` de Locators con `@typescript-eslint/consistent-type-imports: 'error'` (`eslint.config.js:34`):
  importar tipos con `import type`.

## 9. Datos y ambientes

- Vocabulario `test` / `uat` / `prod`. `test` es agnóstico y sirve de contraste porque suele exponer la
  misma versión que `uat` (medido en vivo 2026-09-02: Angular 18.2.14 / v2.0.13 en ambos — ver
  `new-trip.spec.ts:13-19`).
- `DEFAULT_LOCALE = 'en-US'` (`tests/config/runtime.ts:28`) — pruebas i18n/`es-AR` requieren un project
  Playwright con `locale` propio, todavía no existe.
- Prefijo `qa_e2e_` para datos generados (limpieza en UAT/PROD); `storageState` por ambiente en
  `storage/state-carrier-<env>.json`, nunca compartido entre envs.
  - **Excepción documentada — conceptos de Otros Costos** (2026-09-29): el nombre sigue el formato
    `QA E2E OC <TIPO> <runId>[ <etiqueta>]` (p. ej. `QA E2E OC FIX 0T3K9Z4A B`), porque el validador del
    ABM (`conceptPattern`) rechaza guion bajo, guion y apóstrofe. `<runId>` codifica el instante de
    creación, así que el barrido `OtherCostsClient.sweep()` (en el `beforeAll` de la familia) da de baja
    los que tienen más de 24 h. Una limpieza por `LIKE 'qa_e2e_%'` **no** los encuentra: buscar por el
    prefijo `QA E2E OC `. Fuente: `tests/fixtures/factories/otherCostFactory.ts`.
  - Viajes creados por la familia Otros Costos: se cancelan en el `finally` del test; los que quedan
    sin cancelar (corrida interrumpida) se anotan en `evidence/<env>/other-costs-open-trips.json` y los
    cancela el `beforeAll` de la corrida siguiente.
- **Pasarelas de pago EN alcance** (decisión de programa C1): se validan solo en `test`, solo la epic de
  gateway; el resto de las features en `uat`. Una pasarela probada en UAT es prueba manual, no automatizada.
- **Precondición de tarjeta** (decisión C4): tarjeta de test **persistente** ya cargada en carrier/pasajero
  de `apps-test` + alta por UI para el flujo `card-new`. Cero llamadas API para preparar el dato.
- `npm run validate:env` es **no-op silencioso en Windows** — su guard compara `import.meta.url` contra
  `file://${process.argv[1]}` (`tests/utils/envSchema.ts:66`) y en Windows nunca matchea (`file:///C:/…`
  vs `file://C:/…`). Sale 0 aunque el `.env` sea inválido: falso verde. No usarlo como gate — importar
  `validateEnv()` directamente.
- `ALLURE=1` falla en rutas OneDrive (`errno -4094`), que es donde vive este repo — dejarlo apagado.

## 10. Verificación por unidad

- **Ladder E2 (desviación aprobada de la Regla #7 del HUB "tests → typecheck → lint")**:
  **typecheck → lint scoped → tests** — mismos tres pasos, orden distinto, justificado por que el ambiente
  `test` está serializado (1 cuenta carrier, 1 `storage/state-carrier-test.json`): correr specs antes de
  saber que compilan y lintan desperdicia el turno serializado. Ver decisión E2 del plan de migración.
  ```bash
  npm run typecheck
  npx eslint <spec> <pom>                     # scoped: el lint global trae warnings ajenos
  npx cross-env ENV=test npx playwright test <spec> --project=carrier-v2-desktop --workers=1   # 2x
  ```
- DoD por unidad (7 puntos): archivos = exactamente los del plan · `npm run typecheck` exit 0 · eslint
  scoped 0 errores · **2 corridas consecutivas verdes** (`--workers=1`, `package.json:11`) · run record
  committeado en `docs/qa/runs/<fecha>/<spec-slug>.<env>.run.json` · cobertura parcial declarada en el spec
  con evidencia (`COBERTURA PARCIAL DECLARADA`) si aplica · 1 commit `test(carrier-v2/<dom>): [TM-nnn] …`
  pasando `commit-msg` + `pre-commit`.
- Árbol de rojo (orden obligatorio; **copiar `error-context.md` + `test-failed-1.png` a
  `docs/analysis/<scope>-evidence/` antes de re-correr** — Playwright borra `outputDir` en cada invocación):
  1. Guard `[envSchema]` antes de cargar specs → precondición env: STOP, nombrar variable, humano.
  2. Elemento ausente / drift `origin/main` vs header del POM → drift de selector: re-derivar, nunca del
     working tree.
  3. Falla se mueve entre corridas + overlay (p. ej. ng-select) → sincronización: esperar estado observable,
     nunca timeout/retries como fix.
  4. Precondición de datos ausente (typeahead vacío) → parametrizar por env var autoexplicativa (patrón
     `MG19_CLIENT_QUERY`) o escalar. Nunca `test.skip`.
  5. AC dice X, evidencia prueba Y, reproducible 2x → defecto de producto: STOP, `test.fixme('<motivo +
evidencia>')`, ticket vía `/magiis-qa-bug-reporter` para confirmación humana.
  6. Assert vacuo → error de diseño: reescribir contra el efecto observable o declarar gap.
  7. **3er intento rojo → corte duro**: `gap-accepted` con evidencia en el spec, la ola sigue.
- Prohibido para llegar a verde: relajar un `expect`, inflar un timeout, `waitForTimeout`, o `skip`/`fixme`
  sin motivo + evidencia escritos.

## 11. Unidad de trabajo, hot files y ramas del programa de migración V1→V2

- **1 unidad = 1 pantalla V2 × 1 familia de casos V1 (2-4 TCs) = 1 spec nuevo + máx. 1 POM
  nuevo/extendido, en un commit type-closed.** La primera unidad de una pantalla es **POM-owner**: crea el
  archivo. Las siguientes solo **agregan** miembros `readonly`, nunca reordenan ni modifican lo existente.
  Dos unidades nunca escriben el mismo spec; conjuntos de archivos disjuntos por pares dentro de una ola.
- Por qué: `pre-commit` corre `lint-staged` + `npm run typecheck` **global** — un POM sin su spec (o
  viceversa) bloquea el commit de todo el resto del equipo.
- **Hot files — single-writer, el orquestador (R0), una vez por ola**:

  | Archivo                                     | Regla de conflicto                                                     |
  | ------------------------------------------- | ---------------------------------------------------------------------- |
  | `tests/pages/carrier-v2/index.ts`           | 0 importadores, es registro; append bajo header `// Wave NN`           |
  | `traceability/tc-map.*`                     | `generatedAt` siempre conflictúa; conflicto = borrar ambos y regenerar |
  | `docs/backlog/automation-backlog.json`      | refresh por pantalla, no por unidad                                    |
  | `docs/migration/LEDGER.json`                | artefacto rector del programa, escritura del orquestador               |
  | `docs/qa/runs/INDEX.md`                     | una fila por unidad; R4 relee antes de editar y toca solo su fila      |
  | `docs/analysis/migration-evidence/INDEX.md` | ídem: append de filas propias, nunca reordenar                         |

- Prohibido para una unidad de implementación: tocar `eslint.config.js` (allowlist cerrada), `tests/helpers/*`
  (muerto), `scripts/scaffold/*` (obsoletos), el barrel o `tc-map.*` directamente.
- Rama por ola: `carrier-v2/migration-w<NN>-<bloque>` (esta ola: `carrier-v2/migration-w00-foundation`).
  Commit por unidad, 1 MR por ola. Rebase sobre `origin/main` solo mientras no esté pusheada la rama;
  después, merge forward-only (Regla #4/#6 del HUB).

## 12. Roles de agentes R0-R6

| Rol                   | Modelo                                                         | Decide                                                                                        | Escala (STOP + report)                                                              |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R0 Orquestador        | **Fable** (sesión principal, no es agente)                     | próximas unidades, cierre de ola, orden de merge, hot files                                   | push/MR, tickets, `.env.*`, `scope-rules.md`, `settings.json`                       |
| R1 Plan               | Opus                                                           | descomposición, ownership de archivos, shape del POM, argumento de no-vacuidad de cada assert | TC sin key TM, selector sin fuente citada, helper nuevo, violación de scope-rules   |
| R2 Recon              | Sonnet (`Explore`)                                             | qué nombre accesible ancla cada control                                                       | drift `origin/main` vs versión desplegada                                           |
| R3 Implementación     | Sonnet (`general-purpose`), ≤3 en paralelo, archivos disjuntos | locators dentro de la tabla dada, cuerpo del test                                             | archivo fuera de su lista, `expect-expect`, key ausente. **No corre, no commitea.** |
| R4 Verificación       | Sonnet, 1 a la vez                                             | clasificación de rojo (§10), fix de locator, wait observable                                  | defecto de producto, precondición de datos/env, 3er intento                         |
| R5 Review adversarial | Opus, ≤4 lentes                                                | CRITICAL/MAJOR/drop con `file:line`                                                           | — (es el gate)                                                                      |
| R6 Commit             | Sonnet, 1 a la vez                                             | redacción del commit                                                                          | hook falla                                                                          |

Modelos por naturaleza del trabajo, no por jerarquía: Sonnet donde el error es barato y mecánicamente
detectable (tsc/eslint/run); Opus donde el error es caro e invisible (descomposición mal hecha costó 4
iteraciones de fix en la ronda 1 de MG-19; asserts que pasan sin probar nada). Fable donde vive el estado
cross-ola y los límites de consentimiento. Haiku: nunca — todo termina en un `pre-commit` estricto.

## 13. Realidad de CI y evidencia

- **No hay CI real para este repo**: no existe `.gitlab-ci.yml` (el origin es GitLab,
  `gitlab.com/repo.magiis/magiis-fe-v2-testing`) y crear uno está prohibido — el CI corre en infraestructura
  interna. Los `.github/workflows/*` del repo son **documentación inerte** (diseño de referencia, no
  ejecutan). No citarlos como "lo que corre en cada PR".
- Toda evidencia de corrida es **local, committeada por el operador**:
  `docs/qa/runs/<YYYY-MM-DD>/<spec-slug>.<env>.run.json` con `spec, unit, commit, branch, env, baseUrl,
appVersion{ngVersion, footer}, command, runs[], gaps[]`, transcripto de `evidence/<env>/results.json`.
  Índice `docs/qa/runs/INDEX.md`. Rojos: `error-context.md` + `test-failed-1.png` en
  `docs/analysis/<scope>-evidence/`.
- La **versión desplegada** (leída del footer de login: `ng-version` + texto "Version x.y.z") es
  **obligatoria** en cada run record — evita repetir el falso "no existe" de v2.0.4 (working tree) vs
  v2.0.13 (desplegado) que produjo la nota errónea "Destino Abierto no existe" en la ronda 1 de MG-19.

## 14. Trampas verificadas (2026-09-01) — no perder tiempo redescubriéndolas

| Trampa                              | Realidad medida                                                                                                                                                                         | Qué hacer                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `refs/v2/` como fuente de verdad    | Working tree congelado en **v2.0.4** (mayo 2026, HEAD git de marzo 2025). Lo desplegado es **v2.0.13**.                                                                                 | Leer siempre `git show origin/main:<path>`. NUNCA `checkout` (hay cambios sin commitear).                                                                                                        |
| Aliases `@pages/*`, `@utils/*`…     | Declarados en `tsconfig.json:20-25` pero 0 archivos de `tests/specs/`/`tests/pages/` los usan, y no hay resolver conectado a Playwright: revientan en runtime.                          | Rutas relativas con extensión `.js` explícita (ESM).                                                                                                                                             |
| `tests/helpers/*`                   | 4 archivos, 0 llamadores medidos. Apuntan a Angular Material / PrimeNG, que este front no usa.                                                                                          | No estrenarlos. Locators y asserts inline.                                                                                                                                                       |
| Trazabilidad y `makeAnnotate`       | `scripts/extract-tc-map.ts` parsea fuente, no runtime: resuelve literal o constante suelta, no `MAPA[clave]`.                                                                           | Constante suelta o literal. Verificar con `npm run traceability` + grep de la key.                                                                                                               |
| `npm run validate:env`              | No-op silencioso en Windows (`envSchema.ts:66`, comparación `file://` nunca matchea). Falso verde.                                                                                      | No usarlo como gate. Importar `validateEnv()` directo.                                                                                                                                           |
| `ALLURE=1`                          | Falla bajo npm en rutas OneDrive (`errno -4094`), donde vive este repo.                                                                                                                 | Dejarlo apagado acá.                                                                                                                                                                             |
| `expect-expect` de eslint           | Error, allowlist cerrada de 9 nombres (§8).                                                                                                                                             | Reusar un nombre de la lista o `expect()` explícito.                                                                                                                                             |
| `private readonly` en POMs          | 1 archivo legacy (`LoginPage.ts`) todavía lo usa; el patrón vigente es `readonly` público.                                                                                              | Imitar `MapViewerPage.ts`, no el legacy.                                                                                                                                                         |
| Nota "pantalla no desarrollada"     | Caduca con la migración — New Trip estaba "diferida" en mayo y en septiembre tenía 6613 líneas TS + 10 TCs verdes.                                                                      | Verificar contra `refs/v2/src/app/pages/` (`git show origin/main:`) antes de repetir la nota.                                                                                                    |
| Versión desplegada vs `origin/main` | El footer de `apps-test` decía **2.0.14** (2026-09-02) mientras `refs/v2 origin/main` = 2.0.13 y `origin/release/v2.0.14` seguía sin mergear. `origin/main` puede ir una release atrás. | Leer el footer (`contentinfo` del login) y, si supera `origin/main`, `git -C refs/v2 fetch origin release/v<footer>` y comparar `origin/release/...:<path>` con `origin/main`. Nunca `checkout`. |
| `--reporter=list` en la CLI         | Reemplaza los reporters del config: no se escribe `evidence/<env>/results.json` ni `junit.xml`, y el run record del DoD queda sin fuente (medido en MU-001, 4 corridas sin artefacto).  | R4 corre sin `--reporter` (el config ya incluye `list`) y transcribe `evidence/test/results.json` recién escrito.                                                                                |

## 15. Desviaciones deliberadas respecto al HUB

No son deudas: son decisiones documentadas. **No "arreglarlas" de oficio.**

| Tema                    | Regla del HUB                      | Acá                                                                                                                      | Razón                                                                                                                     |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Idioma de artefactos    | Regla #14: repo en inglés          | Títulos/comentarios/skip en **español** (identificadores/archivos/commits en inglés)                                     | Medido sobre 72 specs: 100% español. Escribir uno nuevo en inglés sería la anomalía.                                      |
| Orden de verificación   | Regla #7: tests → typecheck → lint | **typecheck → lint scoped → tests (2x)**                                                                                 | Ambiente `test` serializado (E2, §10): correr specs antes de saber que compilan/lintan desperdicia el turno.              |
| Registro de componentes | Regla #12: `kata-manifest.json`    | Sustituto: barrel `tests/pages/carrier-v2/index.ts` + `traceability/tc-map.json` + `targetPoms[].role` del `LEDGER.json` | Framework compartido con colegas, sin cambios de arquitectura fuera de este programa (C5).                                |
| Runtime                 | Bun                                | **npm + Node ≥20**                                                                                                       | Toolchain (husky, tsx, cross-env) estabilizado sobre npm. El propio HUB manda leer `package.json`, no asumir stack común. |
| `.context/` PBI         | Árbol local sincronizado           | No existe — vive `traceability/` y (desde este Wave 0) `docs/migration/LEDGER.json`                                      | El PBI se consume desde el HUB; acá el registro es propio.                                                                |
| TMS                     | Xray vía HUB genérico              | **Jira-native (MG) + Xray Tests (TM)**                                                                                   | Migración MX→MG; namespace TM- para Tests, MG- para la story.                                                             |

### JSDoc corregido de `traceability.ts`

`tests/utils/traceability.ts:12-13` mostraba `import { makeAnnotate } from '@utils/traceability';` y la key
de ejemplo `'MX-5438'` — el import alias no resuelve en runtime (§2) y la key es del namespace histórico.
Corregido en este Wave 0 al import relativo real (mirror de `new-trip.spec.ts:30`) y a una key `TM-`/`MG-`.
