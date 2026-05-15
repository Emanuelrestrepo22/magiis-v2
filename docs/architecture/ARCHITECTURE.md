# Arquitectura del framework `magiis-carrier-v2-e2e`

Framework Playwright + TypeScript para validar la migracion del portal carrier MAGIIS de Angular 8 (V1) a Angular 18 (V2). Solo frontend (visual + funcional).

## Diagrama de capas

```
+----------------------------------------------------------+
|  CI workflows (.github/workflows/)                       |
|  smoke.yml | regression.yml | visual.yml                 |
+----------------------------------------------------------+
|  npm scripts (package.json)                              |
|  test:test | test:uat | test:prod | test:smoke | visual  |
+----------------------------------------------------------+
|  playwright.config.ts  --> runtime.ts --> .env.<env>     |
|  global-setup.ts (login + storageState)                  |
+----------------------------------------------------------+
|  tests/specs/<dominio>/<archivo>.spec.ts                 |
|    auth | dashboard | trips | visual | smoke             |
+----------------------------------------------------------+
|  tests/fixtures/                                         |
|    authFixture | visualBaseline                          |
+----------------------------------------------------------+
|  tests/pages/                                            |
|    shared/  -> BasePage, LoginPage, ShellPage            |
|    carrier-v2/ -> un archivo por pantalla migrada        |
+----------------------------------------------------------+
|  tests/helpers/  tests/utils/  tests/data/  tests/config |
+----------------------------------------------------------+
|  Repos referencia (read-only, gitignored)                |
|    refs/v1/  (Angular 8)  refs/v2/  (Angular 18)         |
+----------------------------------------------------------+
```

## Principios

1. **Separacion de capas**: specs declaran intencion, pages encapsulan DOM, fixtures inyectan dependencias.
2. **Escalabilidad por archivo**: una pantalla = un Page Object = un archivo. Sumar pantallas no agranda archivos existentes.
3. **Trazabilidad obligatoria**: cada spec referencia `MX-XXXX` en `test.info().annotations`.
4. **3 environments aislados**: `test`, `uat`, `prod` con su propio `.env`, `storageState` y carpeta `evidence/`.
5. **Sin secretos en git**: tokens, credenciales y `.env.*` quedan en `.gitignore`.
6. **Selectores estables**: prioridad `getByRole` > `getByLabel` > `getByTestId` > `formcontrolname`.
7. **Visual y funcional separados**: pueden tener prioridades y baselines distintas para la misma pantalla.

## Modulos clave

### `tests/config/runtime.ts`
Resuelve env activo, baseURL, credenciales, paths de login y storage state.
Funciones exportadas:
- `getCurrentEnv()` -> `'test'|'uat'|'prod'`
- `resolveCredentials()` -> `{ username, password }` o lanza error
- `getCarrierV2Runtime()` -> objeto completo de configuracion

### `tests/config/visualConfig.ts`
Constantes para regresion visual (thresholds, viewports, animations off).

### `global-setup.ts`
Antes de correr cualquier spec: login del carrier V2 + guardar `storage/state-carrier-<env>.json`.

### `playwright.config.ts`
Define 4 projects:
- `carrier-v2-desktop` (1920x1080)
- `carrier-v2-laptop` (1366x768)
- `visual` (suite dedicada a regresion visual)
- `codegen` (sesion limpia para Record new)

### `tests/pages/shared/`
- `BasePage`: clase abstracta, expone `navigate()`, `toastMessage()`, `dismissAnyDialog()`.
- `LoginPage`: login carrier V2.
- `ShellPage`: header, sidebar, user menu, logout.

### `tests/pages/carrier-v2/`
**Un archivo por pantalla migrada** (de MX-4820). Naming: `<Pantalla>Page.ts`.
Ver `tests/pages/carrier-v2/README.md` para la convencion completa.

### `tests/fixtures/`
- `authFixture`: provee `loginPage` y `shellPage` listos para usar.
- `visualBaseline`: provee `visualPage` con clock fijo, animaciones off, fonts ready.

### `tests/helpers/`
- `assertions.ts`: asserts complejas reutilizables.
- `waits.ts`: espera estables (jamas `waitForTimeout`).
- `selectors.ts`: `byFormControl()`, `byTestId()`, `bySelectOption()`, `tableRowByText()`.

## Flujo de ejecucion (run)

```
1. npm run test:test (ENV=test)
2. playwright.config.ts carga .env.test
3. global-setup.ts hace login -> storage/state-carrier-test.json
4. Cada spec hereda storageState segun su project
5. Reportes -> evidence/test/{report,junit.xml,playwright-artifacts}
```

## Crecer el suite (workflow)

Para automatizar una pantalla migrada nueva (`MX-XXXX`):

1. Crear `tests/pages/carrier-v2/<Pantalla>Page.ts` extendiendo `BasePage`.
2. Exportar desde `tests/pages/carrier-v2/index.ts`.
3. Crear spec en `tests/specs/<dominio>/<pantalla>.spec.ts`.
4. Agregar tags: `@P1|@P2|@P3` + `@visual|@functional|@both` + `@migration`.
5. Agregar `test.info().annotations.push({ type: 'jira', description: 'MX-XXXX' })`.
6. Para regresion visual: crear spec en `tests/specs/visual/` con fixture `visualBaseline`.
7. Correr `npm run test:test` localmente; generar baseline visual con `--update-snapshots`.

## Branch y commits

Respetar skill global `magiis-branch-convention`:
- `carrier-v2/<feature>` para specs nuevos.
- `analysis/<topic>` para analisis comparativos.
- `infra/<change>` para config/CI/setup.

Commits con convencion del CLAUDE.md global:
```
<tipo>(<scope>): [MX-XXXX] descripcion corta
```
