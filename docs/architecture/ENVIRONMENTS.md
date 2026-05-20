# Environments — test / uat / prod

## Resumen

| Env    | Proposito                     | Archivo     | Workers | Retries | Tests permitidos                                  |
| ------ | ----------------------------- | ----------- | ------- | ------- | ------------------------------------------------- |
| `test` | Desarrollo local + CI nightly | `.env.test` | 4       | 0       | Todos                                             |
| `uat`  | Validacion pre-prod           | `.env.uat`  | 2       | 1       | Todos excepto los que modifican datos compartidos |
| `prod` | Smoke read-only en produccion | `.env.prod` | 1       | 2       | Solo `@smoke` y `@visual` no destructivos         |

## URLs conocidas (test)

| Capa     | URL                                                           |
| -------- | ------------------------------------------------------------- |
| V2 login | `https://apps-test.magiis.com/carrier/#/auth/login`           |
| V1 login | `https://apps-test.magiis.com/#/authentication/login/carrier` |

Ambas comparten el dominio `apps-test.magiis.com`; el subpath `/carrier/` diferencia V2.

## Variables por env

Cada `.env.<env>` debe definir:

```
ENV=<test|uat|prod>

# V2 (target principal)
BASE_URL=https://apps-test.magiis.com
LOGIN_PATH=/carrier/#/auth/login
DASHBOARD_URL_PATTERN=/carrier/#/home

# Credenciales por region
USER_CARRIER=<primaria>
PASS_CARRIER=<primaria>
USER_CARRIER_AR=<secundaria opcional>
PASS_CARRIER_AR=<secundaria opcional>

# Runtime
HEADLESS=true
WORKERS=<n>
RETRIES=<n>

# Referencia V1 (paridad opcional)
BASE_URL_V1=https://apps-test.magiis.com
LOGIN_PATH_V1=/#/authentication/login/carrier
ENABLE_V1_PARITY_TESTS=false
```

## Regiones soportadas

El framework soporta credenciales paralelas por region. `resolveCredentials(region)` lee `USER_CARRIER_<REGION>` y cae a la primaria si no esta seteada.

Region default = `''` (primaria, sin sufijo). Regiones tipadas: `'AR'`, `'US'`, `'MX'`.

Ejemplo en spec:

```ts
import { resolveCredentials } from '@config/runtime';

const { username, password } = resolveCredentials('AR'); // remiseriamagiis@gmail.com
```

> **Importante**: los `.env.*` no se commitean. Cada dev/QA llena los suyos a partir de `.env.example`.

## Como cambiar de env

```bash
# Desarrollo local - test
npm run test:test

# UAT
npm run test:uat

# PROD (smoke read-only)
npm run test:prod

# O explicito
cross-env ENV=uat npx playwright test --grep @smoke
```

## Aislamiento de evidencia

Cada env tiene su propia carpeta de salida:

```
evidence/
├── test/
│   ├── report/        (HTML report)
│   ├── junit.xml
│   └── playwright-artifacts/  (traces, videos, screenshots)
├── uat/
│   └── ...
└── prod/
    └── ...
```

## Storage state aislado

```
storage/
├── state-carrier-test.json
├── state-carrier-uat.json
└── state-carrier-prod.json
```

Cada uno se genera por `global-setup.ts` al primer run del env.

## Reglas duras por env

### `test`

- Permite cualquier tipo de spec (CRUD, destructivos, visuales).
- Es donde se generan baselines visuales por default.

### `uat`

- No correr specs que destruyan datos visibles para QA Funcional (que tambien usa UAT).
- Filtrar tags: usar `--grep "@smoke|@regression"`.
- Baselines visuales pueden diverger de `test` por datos reales -> mantener baselines separados por env si genera flake.

### `prod`

- **Read-only obligatorio**. Solo login + navegacion + assertions visuales.
- Filtro: `--grep "@smoke"` o `--grep "@visual"`.
- Cualquier spec que cree, edite o elimine debe estar protegida:
  ```ts
  test.skip(getCurrentEnv() === 'prod', 'No correr en prod');
  ```

## Baselines visuales por env

Convencion: nombrar snapshots con sufijo de env cuando es necesario.

```
tests/specs/visual/<spec>-snapshots/
├── sidebar-desktop-visual-linux.png   # <name>-<project>-<platform>.png
└── ...
```

Playwright nombra cada baseline con sufijo del project (`visual`) + platform (`linux` en CI). Una sola baseline por test/project se mantiene en disco; corridas en otros projects requieren `--project=visual` (definido en `npm run test:visual`).

Solo agregar sufijo cuando el env produce un baseline distinto (datos diferentes). La mayoria de pantallas estaticas comparten baseline.

## CI per-env

Los workflows en `.github/workflows/` parametrizan `ENV` por job:

- `smoke.yml`: corre en `test` + `prod` (PR + nightly).
- `regression.yml`: corre en `test` + `uat` (nightly).
- `visual.yml`: corre en `test` con actualizacion manual de baseline.
