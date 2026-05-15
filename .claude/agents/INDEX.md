# Índice de agentes — magiis-carrier-v2-e2e

Pipeline canónico para automatizar pruebas frontend (visuales + funcionales) sobre la migración del portal carrier MAGIIS Angular 8 → Angular 18.

## Pipeline canónico

```
1. migration-doc-analyst
        │  inventory.json + traceability-map.json + gaps.md
        ▼
2. migration-flow-prioritizer
        │  critical-flows.json + priority-backlog.md + blockers.md
        ▼
3. (paralelo) Análisis V1 vs V2 → COMPARISON-V1-V2.md + canonical-selectors.md
        ▼
4. visual-regression-architect
        │  visual-regression-strategy.md + fixtures/visualBaseline.ts
        ▼
5. playwright-migration-draft-generator
        │  spec drafts + POMs + fixtures + data
```

Todo orquestado por `playwright-migration-orchestrator`.

## Agentes

| Agente | Tier | Modelo | Rol breve |
| --- | --- | --- | --- |
| `migration-doc-analyst` | Crítico | Opus 4.7 | Extrae inventario de 25 pantallas desde Jira MX-4820 + xlsx |
| `migration-flow-prioritizer` | Crítico | Opus 4.7 | Prioriza P1/P2/P3 por criticidad + complejidad + riesgo regresión |
| `playwright-migration-orchestrator` | Crítico | Opus 4.7 | Coordina todo el pipeline docs → drafts |
| `visual-regression-architect` | Crítico | Opus 4.7 | Diseña baselines, masking, thresholds para regresión visual |
| `playwright-migration-draft-generator` | Medium | Codex GPT-5.1 | Genera specs + POMs trazables a MX-XXXX |

## Cuándo invocar cada uno

### Entry point recomendado
Llamar siempre `playwright-migration-orchestrator` como puerta de entrada. Él decide qué especialista invocar según el estado del pipeline.

### Invocación directa (avanzado)
- ¿Hay nuevos tickets en MX-4820? → `migration-doc-analyst`.
- ¿Tengo `inventory.json` pero falta backlog? → `migration-flow-prioritizer`.
- ¿Pasamos a regresión visual de una pantalla específica? → `visual-regression-architect`.
- ¿Quiero un draft de una pantalla ya priorizada? → `playwright-migration-draft-generator`.

## Habilidades técnicas incorporadas en los agentes

Todos los agentes tienen ahora una sección **"Habilidades técnicas exigidas"** que les da capacidades específicas para analizar los repos V1 (Angular 8) y V2 (Angular 18) y producir artefactos Playwright de calidad:

### Playwright + TypeScript
- Locators modernos: `getByRole`, `getByLabel`, `getByTestId`, `getByText`.
- Visual regression: `toHaveScreenshot`, masks, thresholds, estabilización (clock, fonts, animations off).
- POM con composición y reutilización.
- Fixtures, projects, configs, retries.
- Sin `waitForTimeout` jamás.
- Storage state + globalSetup para auth.
- Tag-based filtering (`@P1`, `@visual`, `@functional`, `@migration`).

### Angular 8 (V1)
- NgModules, `*-routing.module.ts`, providers en módulos.
- ViewEngine, RxJS, FormsModule legacy.
- Lazy `loadChildren: './x/x.module#XModule'`.
- `*ngIf`, `*ngFor`, pipes async.

### Angular 18 (V2)
- Standalone components, `app.config.ts`, `provideRouter()`, `app.routes.ts`.
- Lazy con `loadComponent`/`loadChildren` + dynamic import.
- Signals, control flow `@if`/`@for`/`@switch`, `inject()`.
- Ivy, ReactiveFormsModule + signals.

### Extracción de selectores estables desde templates Angular
Orden de preferencia:
1. `data-testid` (ideal).
2. `id` estable.
3. `formControlName` (forms reactivos).
4. `aria-label`, `name`, `role`.
5. Texto visible literal y estable.
6. ❌ Evitar: CSS classes autogeneradas (`_ngcontent-*`), `nth-child`, paths CSS profundos.

### Detección de UI libraries
Reconocimiento de PrimeNG, Angular Material, ng-bootstrap, custom — para definir masks visuales y locators recomendados.

## Skills globales aplicables

Estos skills NO se duplican aquí — se usan tal cual desde la ruta global:

- `playwright-magiis` — convenciones Playwright + TypeScript MAGIIS.
- `magiis-branch-convention` — naming de ramas y commits.
- `code-reviewer` — revisión de PRs de specs.
- `test-fixing` — diagnóstico de tests fallando.
- `typescript-advanced-types` — apoyo para tipos complejos en POMs.

## Diferencias clave con los agentes del proyecto magiis-playwright

| Tema | magiis-playwright | magiis-carrier-v2-e2e |
| --- | --- | --- |
| Scope | Stripe / Gateway PG + E2E híbrido | Migración Angular 8→18 carrier (frontend puro) |
| Fuente | Excel matrices, recordings | Jira MX-4820 + xlsx estimación |
| Pruebas API | Sí (selectivas) | ❌ Prohibido |
| Mobile/Appium | Sí | ❌ Prohibido |
| Regresión visual | Limitada | ✅ Eje central |
| Backend asserts | Selectivos | ❌ Prohibido |

## Tag convention

Cada spec debe llevar al menos un tag de prioridad y uno de tipo:

- **Prioridad**: `@P1` | `@P2` | `@P3`
- **Tipo**: `@visual` | `@functional` | `@both`
- **Constante**: `@migration` (siempre — distingue del resto del ecosistema MAGIIS).

Ejemplo:
```ts
test('MX-1234 dashboard renderiza widgets principales @P1 @both @migration', ...);
```
