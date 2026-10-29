# scripts/scaffold

> ⚠ **`scaffold:spec` sigue desactualizado.** Emite `type: 'jira'`, que es legacy: el patrón vigente es
> `makeAnnotate` / `type:'tms'` (ver [`docs/architecture/CONVENTIONS.md`](../../docs/architecture/CONVENTIONS.md) §5).
> Escribir el spec a mano imitando
> [`tests/specs/trips/new-trip.spec.ts`](../../tests/specs/trips/new-trip.spec.ts).
>
> `scaffold:page` **ya está al día**: emite `readonly` público (no `private`) y escribe en
> `tests/pages/<portal>/<dominio>/`, alineado a CONVENTIONS.md §1. Su plantilla se puede seguir,
> imitando [`tests/pages/carrier-v2/operations/MapViewerPage.ts`](../../tests/pages/carrier-v2/operations/MapViewerPage.ts).

Generadores para acelerar onboarding de pantallas migradas. Producen archivos alineados a [`docs/architecture/POM-CONVENTIONS.md`](../../docs/architecture/POM-CONVENTIONS.md) y [`docs/architecture/BEST-PRACTICES.md`](../../docs/architecture/BEST-PRACTICES.md).

## Comandos

### Crear un Page Object

```bash
npm run scaffold:page -- \
  --name ReportsTrips \
  --route /carrier/#/reports/trips \
  --jira TM-1234 \
  --priority P1 \
  --domain reports

# Opcionales: --portal carrier-v2 (default), --type functional (default), --force, --dry
# --domain es OBLIGATORIO: define la subcarpeta, y debe ser el mismo dominio que el del spec.
```

Output: `tests/pages/carrier-v2/<dominio>/ReportsTripsPage.ts` con JSDoc + locator placeholder + `goto()`.

### Crear un spec

```bash
npm run scaffold:spec -- \
  --name ReportsTrips \
  --route /carrier/#/reports/trips \
  --jira MX-1234 \
  --priority P1 \
  --domain reports

# Para spec visual: agregar --type visual (genera <slug>.visual.spec.ts con toHaveScreenshot)
# Para spec a11y:    agregar --type a11y
```

Output: `tests/specs/<domain>/<slug>.spec.ts` con tags + annotations jira/route_v2.

### Workflow tipico (pantalla nueva)

```bash
# 1. Generar POM y spec funcional
npm run scaffold:page -- --name ReportsTrips --route /carrier/#/reports/trips --jira TM-1234 --priority P1 --domain reports
npm run scaffold:spec -- --name ReportsTrips --route /carrier/#/reports/trips --jira MX-1234 --priority P1 --domain reports

# 2. Implementar metodos de negocio en el POM (editar a mano).

# 3. Si se necesita visual: MISMO --domain que el funcional (el sufijo .visual lo separa, no la carpeta)
npm run scaffold:spec -- --name ReportsTrips --route /carrier/#/reports/trips --jira TM-1234 --priority P1 --domain reports --type visual

# 4. Validar localmente
npx playwright test tests/specs/reports/reports-trips.spec.ts --headed --workers=1

# 5. Refrescar trazabilidad
npm run traceability
```

## Flags

| Flag         | Obligatorio | Notas                                                                                                                                                                                                                                    |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name`     | si          | PascalCase o snake/kebab; se normaliza a PascalCase                                                                                                                                                                                      |
| `--route`    | si          | URL V2 completa incluyendo hash (`/carrier/#/...`)                                                                                                                                                                                       |
| `--jira`     | si          | Ticket `MX-XXXX`, `TC-*` o `TS-*`                                                                                                                                                                                                        |
| `--priority` | no          | `P1`, `P2`, `P3` (default `P1`)                                                                                                                                                                                                          |
| `--domain`   | si (ambos)  | Dominio: carpeta bajo `tests/specs/` **y** bajo `tests/pages/<portal>/`. Mismo valor para el POM y su spec (ej `reports`, `trips`, `operations`). **No** es un tipo de suite: un spec visual va al dominio de su pantalla, no a `visual` |
| `--portal`   | no          | Default `carrier-v2`. Preparado para multi-portal futuro                                                                                                                                                                                 |
| `--type`     | no          | `functional` (default), `visual`, `a11y`                                                                                                                                                                                                 |
| `--force`    | no          | Sobreescribir archivo existente                                                                                                                                                                                                          |
| `--dry`      | no          | Mostrar contenido sin escribir                                                                                                                                                                                                           |

## Gotcha — Git Bash (MSYS) en Windows

Git Bash convierte argumentos que empiezan con `/` a paths Windows (`C:/Program Files/Git/...`). Esto rompe `--route /carrier/...`. Dos soluciones:

```bash
# Opcion A: prefijo MSYS_NO_PATHCONV
MSYS_NO_PATHCONV=1 npm run scaffold:page -- --name X --route /carrier/#/foo --jira TM-1 --priority P1 --domain reports

# Opcion B: usar `=` (no se mangle)
npm run scaffold:page -- --name=X --route=/carrier/#/foo --jira=TM-1 --priority=P1 --domain=reports
```

PowerShell y CMD nativos **no** tienen este problema.

## Lo que NO hace

- No agrega el POM al barrel `tests/pages/carrier-v2/index.ts`. Editarlo a mano.
- No abre el spec en el editor.
- No corre `npm run traceability` automaticamente (correr aparte).
- No infiere selectores reales — el heading es placeholder, hay que ajustar contra DOM.
