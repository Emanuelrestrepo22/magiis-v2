# CI/CD — decisión pendiente

> **Estado: RELEVADO, SIN DECIDIR.** Este documento registra qué hay hoy y qué falta
> resolver. No propone una implementación: la decisión de dónde vive la ejecución es
> del equipo.
>
> Bloquea parcialmente la Fase 3 y la Fase 4 del saneamiento (ver más abajo).

## Lo que está verificado

Relevamiento del 2026-09-01 sobre el clone local y sobre `origin/main` (`568b65c`).

| Hecho                                                                                 | Cómo se verificó                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| El repo vive en **GitLab**: `https://gitlab.com/repo.magiis/magiis-fe-v2-testing.git` | `git remote -v` — un solo remote, `origin`               |
| **No hay remote de GitHub** configurado                                               | ídem                                                     |
| **No existe `.gitlab-ci.yml`** en ninguna parte del repo                              | `find` en el working tree + `git ls-tree -r origin/main` |
| Sí existen 4 workflows de GitHub Actions versionados                                  | `.github/workflows/{smoke,regression,visual,a11y}.yml`   |
| GitLab **no ejecuta** workflows de GitHub Actions                                     | comportamiento de plataforma                             |

**Consecuencia**: los 4 workflows están versionados pero **no los corre nadie desde el
repo actual**. Cualquier afirmación sobre "el nightly" o "CI está verde" referida a
este repo es, hoy, infundada.

### Origen probable de los workflows

Son artefactos de que el QA anterior los usaba contra un GitHub propio. Lo consistente
con eso: el repo se consolidó en GitLab recientemente (rama `chore/consolidacion-gitlab`,
mergeada en `568b65c` el 2026-08-24) y los `.github/` se arrastraron en la migración.

**No está confirmado** que hayan representado nunca un pipeline de la empresa.

## Lo que NO se pudo verificar desde el repo

- Si el proyecto de GitLab tiene un _custom CI config path_ apuntando a otro archivo,
  o pipelines definidos fuera del árbol. Requiere mirar Settings → CI/CD del proyecto.
- Si alguna vez corrió un pipeline. Requiere la sección Pipelines de GitLab.

## Qué conservan de valor los workflows actuales

Aunque no se ejecuten, **la lógica de orquestación sigue siendo válida como diseño** y
es la referencia para portarla a donde sea que termine viviendo:

| Workflow         | Disparadores                                            | Filtro                                          | Notas                                          |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `smoke.yml`      | PR (paths) + push a `carrier-v2/**` + nightly 11:30 UTC | `--grep @P1 --grep-invert @visual`              | + dashboard HTML                               |
| `regression.yml` | nightly 11:45 UTC                                       | `--grep-invert @visual`, sharding 4-way         | + **job `xray-import`** (ver abajo)            |
| `visual.yml`     | nightly 12:00 UTC                                       | project `visual` (testMatch `*.visual.spec.ts`) | commitea baselines con `update_baselines=true` |
| `a11y.yml`       | weekly lunes 11:30 UTC                                  | `--grep @a11y`                                  | + gate de regresión contra baseline            |

Los 4 comparten el composite `.github/actions/setup-pw` y un job previo de
`lint` + `typecheck` como gate.

### El job `xray-import` ya está escrito

`c29df97` agregó a `regression.yml` un job que mergea los `xray-results.json` de los 4
shards y hace **un solo** POST a Xray Cloud. Está **inerte** hasta que exista
`secrets.XRAY_CLIENT_ID` (los steps se saltean con `HAS_XRAY=false`).

Es una pieza central de la Fase 4 **ya construida** — pero atada a la sintaxis de GitHub
Actions (`secrets.*`, `inputs.*`, `actions/download-artifact`). Portarla a GitLab CI
implica reescribir esa plomería, no la lógica.

## La decisión pendiente

**¿Dónde va a vivir la ejecución para MAGIIS?**

| Opción                                  | A favor                                                                                                                      | En contra                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **GitLab CI** (`.gitlab-ci.yml`)        | Mismo lugar que el código; sin repos ni cuentas extra; los runners y las variables CI/CD ya son del ecosistema de la empresa | Hay que reescribir los 4 workflows + el job de Xray; hay que confirmar que existan runners disponibles |
| **GitHub Actions** en un repo de MAGIIS | Los 4 workflows y el job de Xray funcionan tal cual; `setup-pw` ya está hecho                                                | Duplica el hosting del código o exige mirroring; otra plataforma que administrar                       |

### Por qué bloquea a las Fases 3 y 4

- **Fase 4** (piloto de import a Xray sobre Alta de Viaje) tiene como criterio de éxito
  que una corrida actualice sola el estado del Test en TM. Eso necesita **un pipeline
  real** que corra los tests y dispare el import. Hoy no existe.
- **Fase 3** toca `screens.ts` y documentación de arquitectura; el diseño de i18n
  contempla projects `-en` / `-es` cuya selección por suite se configura **en el
  pipeline** (ver `I18N-STRATEGY.md` §3).

### Lo mínimo para desbloquear

1. Confirmar en GitLab → Settings → CI/CD si hay runners disponibles para el grupo
   `repo.magiis`.
2. Decidir plataforma.
3. Cargar las credenciales que hoy los workflows esperan como secrets:
   `BASE_URL`, `LOGIN_PATH`, `USER_CARRIER_US`/`PASS_CARRIER_US`,
   `USER_CARRIER_AR`/`PASS_CARRIER_AR`, `TEAMS_WEBHOOK_URL`,
   `XRAY_CLIENT_ID`/`XRAY_CLIENT_SECRET`.

## Regla mientras tanto

No tratar `.github/workflows/*.yml` como "la CI real" sin aclarar que es una suposición
no confirmada. Son **referencia de diseño** de qué automatizar y cuándo, no evidencia de
que exista ejecución.
