# magiis-carrier-v2-e2e

> Framework Playwright + TypeScript para automatizar pruebas **frontend** (visuales + funcionales + accesibilidad) sobre la migración del portal carrier MAGIIS de **Angular 8 → Angular 18**.

[![Playwright](https://img.shields.io/badge/Playwright-1.49-2EAD33?logo=playwright)](https://playwright.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](https://nodejs.org/)

## Tabla de contenidos

- [Alcance](#alcance)
- [Stack](#stack)
- [Arquitectura](#arquitectura)
- [Quick start](#quick-start)
- [Environments](#environments)
- [Patrones clave](#patrones-clave)
- [Estructura de carpetas](#estructura-de-carpetas)
- [Comandos](#comandos)
- [CI](#ci)
- [Contribuir](#contribuir)

## Alcance

Automatización del **portal carrier V2** (Angular 18). Se valida:

- ✅ Visual regression (pixel diff por pantalla).
- ✅ Funcional UI (navegación, formularios, estados, mensajes).
- ✅ Accesibilidad (WCAG 2.1 AA via axe-core).
- ✅ Comparación V1 ↔ V2 cuando se exige paridad.

### Fuera de alcance

- ❌ Pruebas de API o backend.
- ❌ Tests E2E híbridos con mobile (Appium).
- ❌ Performance, carga, seguridad.

## Stack

| Capa | Tooling |
| --- | --- |
| Test runner | [Playwright](https://playwright.dev/) 1.49 |
| Lenguaje | TypeScript 5.7 (strict) |
| Data factories | [@faker-js/faker](https://fakerjs.dev/) 9.x con locales por región |
| Accesibilidad | [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) (WCAG 2.1 AA) |
| Env validation | [zod](https://zod.dev/) — schema del `.env` con fail-fast |
| Lint | ESLint 9 flat config + `eslint-plugin-playwright` |
| Format | Prettier |
| Git hooks | Husky + lint-staged + commitlint |
| CI | GitHub Actions (smoke, regression, visual) |

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  CI workflows (.github/workflows/)                      │
│  smoke.yml | regression.yml | visual.yml                │
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  playwright.config.ts                                   │
│  validateEnv() → carga .env.<env> con zod schema        │
│  globalSetup → login carrier V2 + storageState          │
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  tests/specs/                                           │
│  auth | dashboard | trips | visual | smoke              │
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  tests/fixtures/                                        │
│  authFixture | visualBaseline | a11yFixture | factories/│
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  tests/pages/                                           │
│  shared/  → BasePage, LoginPage, ShellPage              │
│  carrier-v2/ → 1 archivo por pantalla migrada           │
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  tests/helpers/ + tests/utils/ + tests/config/          │
│  assertions | waits | selectors | runtime | envSchema   │
└─────────────────────────────────────────────────────────┘
```

Documentación completa en [`docs/architecture/`](./docs/architecture/):
- [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)
- [ENVIRONMENTS.md](./docs/architecture/ENVIRONMENTS.md)
- [POM-CONVENTIONS.md](./docs/architecture/POM-CONVENTIONS.md)
- [BEST-PRACTICES.md](./docs/architecture/BEST-PRACTICES.md)

## Quick start

```bash
# 1. Clonar
git clone https://github.com/<owner>/magiis-carrier-v2-e2e.git
cd magiis-carrier-v2-e2e

# 2. Instalar deps + browsers
npm install
npx playwright install --with-deps chromium

# 3. Configurar env
cp .env.example .env.test
# Editar .env.test con BASE_URL + USER_CARRIER + PASS_CARRIER reales

# 4. Validar env
npm run validate:env

# 5. Smoke run
npm run test:smoke
```

## Environments

Tres environments aislados con su propio `.env`, storage y reportes.

| Env | URL referencia | Workers | Retries | Tests permitidos |
| --- | --- | --- | --- | --- |
| `test` | apps-test.magiis.com | 4 | 0 | Todos |
| `uat` | apps-uat.magiis.com | 2 | 1 | Todos no destructivos |
| `prod` | apps.magiis.com | 1 | 2 | Solo `@smoke` read-only |

Cambio de env:
```bash
npm run test:test    # ENV=test
npm run test:uat     # ENV=uat
npm run test:prod    # ENV=prod (read-only)
```

## Patrones clave

### 1. Trazabilidad MX-XXXX en cada spec

```ts
test('@P1 @functional @migration login carrier V2 happy path', async ({ page }) => {
  test.info().annotations.push({ type: 'jira', description: 'MX-1234' });
  test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/auth/login' });
  // ...
});
```

### 2. Page Object por pantalla migrada

```ts
/**
 * @jira MX-1234
 * @route /carrier/#/home/trips
 * @priority P1
 */
export class TripsListPage extends BasePage {
  private readonly newTripBtn = this.page.getByRole('button', { name: /nuevo viaje/i });
  async goto() { await this.navigate('/carrier/#/home/trips'); }
  async openNewTrip() { await this.newTripBtn.click(); }
}
```

### 3. Data factories con faker

```ts
import { makeTrip, makeDriver, makeVehicle } from '@fixtures/factories';

const trip = makeTrip({ region: 'AR', passengerCount: 3 });
// → { id: 'qa_e2e_1731234567_abc_trip', reference: 'TRIP-12345678', ... }
```

### 4. Regresión visual con masking

```ts
await expect(page).toHaveScreenshot('dashboard.png', {
  maxDiffPixelRatio: 0.005,
  mask: [page.getByTestId('current-user'), page.getByTestId('notifications-badge')]
});
```

### 5. Accesibilidad

```ts
import { test, expect } from '@fixtures/a11yFixture';

test('@P1 @a11y dashboard cumple WCAG 2.1 AA', async ({ page, scanA11y }) => {
  await page.goto('/carrier/#/home');
  const result = await scanA11y();
  expect(result.violations).toEqual([]);
});
```

## Estructura de carpetas

```
magiis-carrier-v2-e2e/
├── .claude/agents/         5 agentes especializados (analyst, prioritizer, draft-gen, ...)
├── .env.{test,uat,prod}    3 environments (gitignored)
├── .github/workflows/      smoke + regression + visual
├── .husky/                 pre-commit + commit-msg hooks
├── docs/
│   ├── architecture/       ARCHITECTURE, ENVIRONMENTS, POM-CONVENTIONS, BEST-PRACTICES
│   ├── analysis/           COMPARISON-V1-V2 (post clones)
│   ├── inventory/          INVENTORY-MX-4820 (post Jira)
│   └── scope-rules.md      Cero API/backend/Appium
├── refs/                   Clones read-only V1/V2 (gitignored)
├── storage/                storageState por env (gitignored)
├── evidence/               reportes + traces (gitignored)
├── tests/
│   ├── TestBase.ts         Re-export central
│   ├── config/             runtime.ts (env switch) + visualConfig.ts
│   ├── pages/
│   │   ├── shared/         BasePage, LoginPage, ShellPage
│   │   └── carrier-v2/     1 archivo por pantalla
│   ├── fixtures/
│   │   ├── factories/      faker: user, driver, vehicle, address, trip
│   │   ├── authFixture.ts
│   │   ├── visualBaseline.ts
│   │   └── a11yFixture.ts
│   ├── helpers/            assertions + waits + selectors (byFormControl, byTestId, ...)
│   ├── utils/              envSchema (zod), fakerSeed, testIdentity, env
│   ├── data/               JSON estático
│   └── specs/              auth + dashboard + trips + visual + smoke
├── playwright.config.ts    4 projects (desktop, laptop, visual, codegen)
├── global-setup.ts         Login + storageState
├── eslint.config.js        Reglas Playwright-aware
├── commitlint.config.js    Enforcement tipo(scope): [MX-XXXX]
└── tsconfig.json           strict: true + path aliases (@pages, @fixtures, ...)
```

## Comandos

```bash
# Tests
npm run test                    # default ENV=test, suite completa
npm run test:test               # ENV=test
npm run test:uat                # ENV=uat
npm run test:prod               # ENV=prod (smoke read-only)
npm run test:smoke              # solo @P1
npm run test:visual             # solo regresión visual
npm run test:visual:update      # regenerar baselines
npm run test:a11y               # solo specs @a11y

# Reportes
npm run report                  # abre HTML report

# Calidad
npm run lint                    # ESLint
npm run lint:fix                # ESLint con auto-fix
npm run format                  # Prettier write
npm run format:check            # Prettier check
npm run typecheck               # tsc --noEmit
npm run validate:env            # valida .env con zod
```

## CI

| Workflow | Trigger | Suite | Target |
| --- | --- | --- | --- |
| `smoke.yml` | PR + nightly | `@P1` | test |
| `regression.yml` | Nightly + manual | Todos excepto `@visual` | test, uat |
| `visual.yml` | Nightly + manual | `@visual` | test (baselines aquí) |

Secrets requeridos en GitHub:
```
CARRIER_V2_BASE_URL_TEST
CARRIER_V2_USER_TEST
CARRIER_V2_PASS_TEST
CARRIER_V2_BASE_URL_UAT
CARRIER_V2_USER_UAT
CARRIER_V2_PASS_UAT
```

## Contribuir

### Branch naming
Respetar [magiis-branch-convention](https://github.com/<owner>/magiis-branch-convention):

```
carrier-v2/<feature>      # specs nuevos
analysis/<topic>          # análisis comparativos
infra/<change>            # config/CI
```

### Commits
Formato enforced por commitlint:

```
<tipo>(<scope>): [MX-XXXX] descripción corta

feat(trips): [MX-1234] spec trips-list visual + funcional
docs(inventory): [MX-4820] poblar inventario 25 pantallas
chore(ci): actualizar workflow smoke (sin TC asociado)
```

### Pull request checklist
- [ ] Tests pasan local (`npm run test:smoke`)
- [ ] Typecheck pasa (`npm run typecheck`)
- [ ] Lint pasa (`npm run lint`)
- [ ] Si tocás visuales: baselines regenerados y commiteados
- [ ] Trazabilidad MX-XXXX en commits y annotations

## Roadmap

- [x] Scaffolding base con 3 environments
- [x] Page Objects compartidos (Login, Shell, Base)
- [x] Factories de datos (user, driver, vehicle, address, trip)
- [x] Fixtures de auth + visual + a11y
- [x] CI workflows (smoke, regression, visual)
- [ ] Inventario completo de pantallas migradas (MX-4820)
- [ ] 1 Page Object por cada pantalla migrada (~25 archivos)
- [ ] Suite funcional de las 25 pantallas
- [ ] Suite visual con baselines en test
- [ ] Análisis comparativo V1 ↔ V2 documentado

## Licencia

Privado - MAGIIS USA LLC.
