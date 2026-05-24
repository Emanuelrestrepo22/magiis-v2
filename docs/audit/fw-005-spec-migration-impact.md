# FW-005 — Auditoria preparatoria: impacto de segmentar specs por suite + dominio

**Fecha auditoria:** 2026-05-24
**Branch base:** `carrier-v2/teams-notifications`
**Alcance:** solo lectura, sin mover archivos.

## Resumen ejecutivo

| Metrica                                                   | Valor                                            |
| --------------------------------------------------------- | ------------------------------------------------ |
| Total specs `.spec.ts` en `tests/specs/**`                | 68                                               |
| Specs que YA estan en carpeta correcta (no mover)         | 32 (smoke 1 + visual 15 + a11y 16)               |
| Specs que requieren `git mv`                              | 36                                               |
| Specs con tags ambiguos / multi-dominio (decision manual) | 4                                                |
| Specs sin tags `@P*` / `@visual` / `@a11y` (explore)      | 5                                                |
| Imports `../../` que requieren `../../../` tras mover     | 36 ediciones (depth +1)                          |
| Cross-imports entre specs (blocker fuerte)                | 0                                                |
| Workflows con paths hardcoded a `tests/specs/...`         | 1 (`visual.yml`)                                 |
| Scripts/configs con paths hardcoded                       | 3 (`package.json` x2, `playwright.config.ts:93`) |
| Baselines visuales (`-snapshots/`) co-located             | 15 (se mueven con `git mv`)                      |
| Trazabilidad (`tc-map.{md,json}`)                         | Auto-regenerable                                 |

**Riesgo global: MEDIO**. Sin cross-imports y con un solo workflow hardcoded la migracion es mecanica; el riesgo real es **organizacional** (decidir destino de 4 specs `release-v2.0.2/*` multi-dominio y nombre del dominio nuevo `settlements`).

## Convencion de derivacion del destino

- `@visual` -> `visual/<dom>/` (mantiene root actual)
- `@a11y` -> `a11y/<dom>/` (mantiene root actual)
- `@P1` sin `@visual`/`@a11y` -> `smoke/<dom>/`
- `@P2`/`@P3` sin `@visual`/`@a11y` -> `regression/<dom>/`
- carpeta `explore/` -> `exploratory/<dom>/`

## Blockers identificados

| ID   | Tipo                          | Archivo                                         | Detalle                                                 | Accion                                                                                                                        |
| ---- | ----------------------------- | ----------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| B-01 | Spec multi-dominio            | `release-v2.0.2/sprint2-p1.spec.ts`             | Importa 7 POMs de 5 dominios distintos                  | **Decision producto**: (a) dejar en `smoke/release/`, (b) partir en 5 specs, (c) mover a dominio dominante. Recomendado: (a). |
| B-02 | Spec multi-dominio            | `release-v2.0.2/sprint3-p2.spec.ts`             | Importa 9 POMs reports+gnet, dominio dominante: reports | Mover a `regression/reports/`.                                                                                                |
| B-03 | Hardcoded path en CI          | `.github/workflows/visual.yml:69,71,88,92`      | `tests/specs/visual` aparece 4 veces                    | Sin cambio si `visual/` queda root (recursivo).                                                                               |
| B-04 | Hardcoded path en config      | `playwright.config.ts:93`                       | `testDir: './tests/specs/visual'`                       | Sin cambio si `visual/` queda root.                                                                                           |
| B-05 | Hardcoded path en npm scripts | `package.json` linea 13,14                      | `test:visual` y `test:visual:update`                    | Sin cambio.                                                                                                                   |
| B-06 | Trazabilidad stale            | `traceability/tc-map.{md,json}`                 | 68 paths embebidos, auto-regenerable                    | Ejecutar `npm run traceability` post-merge.                                                                                   |
| B-07 | Docs con paths embebidos      | README + docs/architecture/_ + docs/inventory/_ | Texto explicativo, no rompe build                       | Actualizar en commit final del PR.                                                                                            |
| B-08 | Imports profundos             | 36 specs                                        | `../../` -> `../../../`                                 | `sed` mecanico.                                                                                                               |
| B-09 | Baselines visuales co-located | 15 dirs `<spec>-snapshots/`                     | Playwright los busca relativos al spec                  | `git mv` del directorio mantiene los PNG.                                                                                     |
| B-10 | Cross-imports entre specs     | NINGUNO                                         | Confirmado                                              | Sin accion.                                                                                                                   |
| B-11 | Carpeta `release-v2.0.2/`     | 8 specs anclados a release pasado               | Se elimina concepto "release como carpeta"              | Distribuir por dominio (recomendado) o preservar carpeta temporal.                                                            |

## Riesgo por dominio destino

| Dominio                     | Specs a mover | Blockers especificos                                                | Riesgo |
| --------------------------- | ------------- | ------------------------------------------------------------------- | ------ |
| `auth`                      | 1             | -                                                                   | BAJO   |
| `customers`                 | 1             | -                                                                   | BAJO   |
| `drivers`                   | 1             | -                                                                   | BAJO   |
| `owners`                    | 1             | -                                                                   | BAJO   |
| `vehicles`                  | 1             | -                                                                   | BAJO   |
| `trips`                     | 1             | -                                                                   | BAJO   |
| `dashboards`                | 2             | -                                                                   | BAJO   |
| `shell`                     | 4             | -                                                                   | BAJO   |
| `settings`                  | 4             | -                                                                   | BAJO   |
| `affiliate`                 | 4             | -                                                                   | BAJO   |
| `settlements` (NUEVO)       | 3             | Crear dominio; nombre a confirmar (`settlements` vs `liquidations`) | MEDIO  |
| `reports`                   | 27            | Volumen alto; riesgo errores en imports                             | MEDIO  |
| `release-v2.0.2/sprint2-p1` | 1             | B-01                                                                | ALTO   |
| `release-v2.0.2/sprint3-p2` | 1             | B-02                                                                | MEDIO  |

## Orden recomendado de migracion

1. **Fase 1** — Dominios single-spec, riesgo bajo (validar procedimiento): auth, customers, drivers, owners, vehicles, trips.
2. **Fase 2** — Dominios con visual+a11y co-locados: dashboards, shell, settings, affiliate.
3. **Fase 3** — Dominio nuevo `settlements` (decidir nombre antes).
4. **Fase 4** — `reports` bulk (27 specs) — commits separados por tipo (detailed, a11y, visual).
5. **Fase 5** — Blockers ambiguos (B-01, B-11) + regen `tc-map` + actualizar docs.

## Mapping completo (resumen por categoria)

**A mover a `smoke/<dom>/`** (16 specs):

- `auth/login`, `customers/client-list`, `drivers/driver-list`, `owners/owner-list`, `vehicles/vehicle-list`, `trips/trips-list-demo`, `dashboards/operations-control`, `shell/navbar-detailed`, `smoke/carrier-v2-smoke` -> `smoke/shell/`, `affiliate/checking-account-detailed`, 5 reports `*-detailed`, sprint5-desbloqueadas -> `smoke/reports/`, sprint6-settlements + sprint8-detail-flows -> `smoke/settlements/`, sprint8-affiliate-flows -> `smoke/affiliate/`.

**A mover a `regression/<dom>/`** (11 specs):

- 8 reports `*-detailed` (@P2), `settings/other-costs-detailed` (@P3), sprint4-p3 (@P3) -> `regression/settings/`, sprint7-reports y sprint3-p2 -> `regression/reports/`.

**A mover a `exploratory/<dom>/`** (5 specs):

- `explore/sidebar-discovery` -> `exploratory/shell/`, los 4 sprint discovery -> `exploratory/{reports,settlements}/`.

**A mover a `visual/<dom>/`** (15 specs visuales): subdivision por dominio bajo `visual/`.

**A mover a `a11y/<dom>/`** (16 specs a11y): subdivision por dominio bajo `a11y/`.

**Blocker a decidir**: sprint2-p1 (B-01, multi-dominio sin dominante claro).

## Supuestos declarados

- **S-1**: dominio `settlements` reemplaza `liquidations` (ambos terminos aparecen). Si el equipo prefiere `liquidations`, reemplazar globalmente.
- **S-2**: `smoke/carrier-v2-smoke.spec.ts` se asigna dominio `shell` por cubrir sidebar + login.
- **S-3**: specs `release-v2.0.2/*` con multi-dominio se asignan a su dominio dominante (mayor numero de POMs importados).
- **S-4**: `explore/*` mantiene tag `@explore` para que workflows actuales (`--grep "@P1"`) lo excluyan sin cambios.
- **S-5**: `traceability/tc-map.{md,json}` se regenera automaticamente y no se considera blocker.

## Recomendacion final

FW-005 es viable como migracion mecanica de bajo riesgo tecnico. **Antes de iniciar**:

1. Resolver B-01 con producto (destino de sprint2-p1).
2. Confirmar nombre del dominio nuevo: `settlements` vs `liquidations`.
3. Decidir politica para `release-v2.0.2/` (B-11): distribuir vs preservar carpeta temporal.

Una vez resueltos los 3 puntos, ejecutar en 5 fases con un commit por fase para diff revisable. Validar tras cada fase con `npm run test:smoke` / `test:visual` / `test:a11y` segun corresponda.

## Script candidato (NO ejecutar)

Plantilla PowerShell para automatizar `git mv` + ajuste de imports + mover snapshots co-located. Disponible en este reporte (no incluido aqui por longitud — extraer desde el agent output al implementar FW-005).
