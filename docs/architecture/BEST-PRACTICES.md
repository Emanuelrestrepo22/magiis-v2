# Best Practices — magiis-carrier-v2-e2e

Documento vivo. Refleja decisiones que aplican a TODO el suite.

## 1. Capas de datos (separacion clara)

| Capa | Carpeta | Cuando usar | Ejemplo |
| --- | --- | --- | --- |
| **Estatica** | `tests/data/` | Catalogos inmutables: roles, paises, opciones de un dropdown conocido | `tests/data/countries.json` |
| **Generada** | `tests/fixtures/factories/` | Datos unicos por test con faker | `makeTrip({ region: 'AR' })` |
| **Inyectada** | `tests/fixtures/*.ts` (no factories) | Page Objects + setup (auth, visual, a11y) | `authFixture.ts` |

### Por que separar

- Los datos estaticos son inmutables y se comparten.
- Las factories generan datos unicos -> no hay colisiones entre tests en paralelo.
- Los fixtures de Playwright inyectan dependencias (POMs + setup) -> separar de "datos" puros.

## 2. Identidad de datos generados

Todos los datos producidos por factories llevan prefijo `qa_e2e_<timestamp>_<rand>`. Esto permite:

```sql
-- Limpieza en UAT/PROD si quedan residuos
DELETE FROM trips WHERE reference LIKE 'TRIP-%' AND notes LIKE 'qa_e2e_%';
DELETE FROM users WHERE email LIKE 'qa_e2e_%@yopmail.com';
```

**Regla**: cualquier nombre, email, codigo, id que se persista en backend debe pasar por `makeTestId()` o tener el prefijo.

## 3. Reproducibilidad con `FAKER_SEED`

Cuando un test falla con datos aleatorios:

```bash
# Reproducir el run exacto
FAKER_SEED=42 npx playwright test --grep MX-1234
```

Para reportar bugs determinsticos, fijar el seed en el spec:

```ts
import { getFaker } from '@utils/fakerSeed';
const f = getFaker('AR');
f.seed(42);
```

## 4. Selectores estables (Angular V2)

Orden de preferencia **inquebrantable**:

1. `getByRole('button', { name: /guardar/i })`
2. `getByLabel('Correo electronico')`
3. `getByTestId('save-btn')`
4. `getByText('texto literal estable')`
5. `locator('[formcontrolname="email"]')` (ultimo recurso)

**Prohibido**:
- `nth-child`, CSS profundo (`div > div > span`)
- Clases autogeneradas (`_ngcontent-*`, `mat-mdc-button-base-1234`)
- IDs autogenerados (`mat-input-0`)

> Si una pantalla V2 no tiene roles/labels accesibles, **se reporta como bug de accesibilidad** y se sugiere a dev agregar `data-testid`. No se parchea con CSS frail.

## 5. Web-first assertions

```ts
// ✓ Web-first: retry automatico hasta cumplir o timeout
await expect(page.getByRole('heading')).toHaveText('Dashboard');
await expect(page.getByTestId('row-count')).toContainText('25');

// ✗ Sincronico: no espera, frecuentemente flaky
const text = await page.getByRole('heading').textContent();
expect(text).toBe('Dashboard');
```

Lint regla activa (`playwright/prefer-web-first-assertions`).

## 6. Sin `waitForTimeout` jamas

```ts
// ✗ Prohibido
await page.waitForTimeout(2000);

// ✓ Esperar estado observable
await page.waitForLoadState('domcontentloaded');
await expect(locator).toBeVisible();
await page.waitForURL(/\/dashboard/);
```

Lint regla activa (`playwright/no-wait-for-timeout`).

## 7. Tags consistentes en specs

| Tag | Significado | Obligatorio |
| --- | --- | --- |
| `@P1` / `@P2` / `@P3` | Prioridad | ✓ |
| `@functional` / `@visual` / `@both` | Tipo de validacion | ✓ |
| `@migration` | Marca de pertenencia al suite | ✓ |
| `@a11y` | Incluye scan de accesibilidad | opcional |
| `@smoke` | Subset minimo (incluido en pipeline rapido) | opcional |
| `@regression` | Suite completa nightly | opcional |

Filtrado en CLI:
```bash
npm run test:smoke              # solo @P1
npx playwright test --grep @visual
npx playwright test --grep "@P1.*@functional"
```

## 8. Trazabilidad MX-XXXX

Cada test debe declarar el ticket asociado:

```ts
test('login carrier v2 happy path @P1 @functional @migration', async ({ page }) => {
  test.info().annotations.push({ type: 'jira', description: 'MX-1234' });
  test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/auth/login' });
  // ...
});
```

El reporter HTML los renderiza visibles; el JUnit los expone para integracion CI.

## 9. Validacion temprana del env

`tests/utils/envSchema.ts` valida con zod al arranque. Si `BASE_URL` no es URL valida o `USER_CARRIER` no es email, el framework falla con mensaje claro **antes** de cualquier spec.

Verificar manualmente:
```bash
npm run validate:env
# ✓ .env.test valido
#   ENV=test
#   BASE_URL=https://apps-test.magiis.com
```

## 10. Accesibilidad como ciudadano de primera

Para pantallas P1, agregar un spec `@a11y` que usa el fixture:

```ts
import { test, expect } from '@fixtures/a11yFixture';

test('@P1 @a11y @migration dashboard cumple WCAG 2.1 AA', async ({ page, scanA11y }) => {
  await page.goto('/carrier/#/home');
  const result = await scanA11y({ exclude: ['.third-party-widget'] });
  expect(result.violations).toEqual([]);
});
```

Beneficio doble: detecta regresiones de a11y + obliga al dev a poner roles/labels que mejoran los locators.

## 11. Pre-commit hooks (husky + lint-staged)

Al hacer `git commit`:

1. `lint-staged` corre `eslint --fix` + `prettier --write` solo en archivos modificados.
2. `tsc --noEmit` corre typecheck global.
3. Commit-msg valida formato `tipo(scope): [MX-XXXX] msg`.

Si algo falla, el commit aborta. Para bypass (ULTIMO recurso, justificado):
```bash
git commit --no-verify -m "..."
```

## 12. Visual regression: workflow

1. Local dev: `npm run test:visual:update` genera baselines en `tests/specs/visual/__screenshots__/`.
2. Commit baselines junto al spec.
3. CI corre `npm run test:visual` y compara contra baselines commiteados.
4. Si cambian intencionalmente: PR con `npm run test:visual:update` + descripcion del por que.
5. **Nunca** correr `--update-snapshots` en CI sin intencion explicita.

## 13. Storage state isolation por env

```
storage/
├── state-carrier-test.json   (generado por global-setup con .env.test)
├── state-carrier-uat.json    (idem .env.uat)
└── state-carrier-prod.json   (idem .env.prod)
```

Nunca compartir storage entre envs - cookies de UAT pueden romper TEST y viceversa.

## 14. Region-aware tests

Cuando una pantalla muestra distinto comportamiento por pais (formato fecha, currency, idioma):

```ts
import { resolveCredentials } from '@config/runtime';
import { getFaker } from '@utils/fakerSeed';

const { username, password } = resolveCredentials('AR');
const f = getFaker('AR');
// ahora address.zipCode, person.firstName usan locale AR
```

## 15. CI: que corre cuando

| Workflow | Trigger | Suite | Tiempo objetivo |
| --- | --- | --- | --- |
| `smoke.yml` | PR + nightly | `@P1` | < 5 min |
| `regression.yml` | Nightly + manual | Todo excepto `@visual` | < 30 min |
| `visual.yml` | Nightly + manual | `@visual` | < 15 min |

PRs solo deben bloquearse por smoke. Regression y visual reportan pero no bloquean (excepto en main).

## 16. Estructura de un Page Object (recap)

Ver `docs/architecture/POM-CONVENTIONS.md`. Reglas clave:
- Un archivo por pantalla.
- Locators readonly en constructor.
- Metodos de **negocio**, no de UI.
- Trazabilidad en JSDoc (`@jira`, `@route`, `@priority`, `@type`).
- Extender `BasePage`.

## 17. Que NO hacer

- ❌ Hardcodear credenciales, tokens, URLs.
- ❌ Compartir estado entre tests (cada test debe correr aislado).
- ❌ Acoplar test a backend (cero asserts sobre payloads API).
- ❌ Crear Page Objects "genericos" que cubren multiples pantallas.
- ❌ Usar `page.locator()` con CSS cuando hay un `getByRole`/`getByLabel` disponible.
- ❌ Commitear `.env.*`, `storage/`, `evidence/`, `node_modules/`.
- ❌ `console.log` en specs commiteados (warn solo en debug local).

## Referencias

- `docs/architecture/ARCHITECTURE.md` - vision general
- `docs/architecture/ENVIRONMENTS.md` - test/uat/prod
- `docs/architecture/POM-CONVENTIONS.md` - convencion de Page Objects
- `docs/scope-rules.md` - alcance del proyecto (frontend only)
