# scripts/scaffold

Generadores para acelerar onboarding de pantallas migradas. Producen archivos alineados a [`docs/architecture/POM-CONVENTIONS.md`](../../docs/architecture/POM-CONVENTIONS.md) y [`docs/architecture/BEST-PRACTICES.md`](../../docs/architecture/BEST-PRACTICES.md).

## Comandos

### Crear un Page Object

```bash
npm run scaffold:page -- \
  --name ReportsTrips \
  --route /carrier/#/reports/trips \
  --jira MX-1234 \
  --priority P1

# Opcionales: --portal carrier-v2 (default), --type functional (default), --force, --dry
```

Output: `tests/pages/carrier-v2/ReportsTripsPage.ts` con JSDoc + locator placeholder + `goto()`.

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
npm run scaffold:page -- --name ReportsTrips --route /carrier/#/reports/trips --jira MX-1234 --priority P1
npm run scaffold:spec -- --name ReportsTrips --route /carrier/#/reports/trips --jira MX-1234 --priority P1 --domain reports

# 2. Implementar metodos de negocio en el POM (editar a mano).

# 3. Si se necesita visual:
npm run scaffold:spec -- --name ReportsTrips --route /carrier/#/reports/trips --jira MX-1234 --priority P1 --domain visual --type visual

# 4. Validar localmente
npx playwright test tests/specs/reports/reports-trips.spec.ts --headed --workers=1

# 5. Refrescar trazabilidad
npm run traceability
```

## Flags

| Flag         | Obligatorio | Notas                                                         |
| ------------ | ----------- | ------------------------------------------------------------- |
| `--name`     | si          | PascalCase o snake/kebab; se normaliza a PascalCase           |
| `--route`    | si          | URL V2 completa incluyendo hash (`/carrier/#/...`)            |
| `--jira`     | si          | Ticket `MX-XXXX`, `TC-*` o `TS-*`                             |
| `--priority` | no          | `P1`, `P2`, `P3` (default `P1`)                               |
| `--domain`   | spec si     | Carpeta bajo `tests/specs/` (ej `reports`, `trips`, `visual`) |
| `--portal`   | no          | Default `carrier-v2`. Preparado para multi-portal futuro      |
| `--type`     | no          | `functional` (default), `visual`, `a11y`                      |
| `--force`    | no          | Sobreescribir archivo existente                               |
| `--dry`      | no          | Mostrar contenido sin escribir                                |

## Gotcha — Git Bash (MSYS) en Windows

Git Bash convierte argumentos que empiezan con `/` a paths Windows (`C:/Program Files/Git/...`). Esto rompe `--route /carrier/...`. Dos soluciones:

```bash
# Opcion A: prefijo MSYS_NO_PATHCONV
MSYS_NO_PATHCONV=1 npm run scaffold:page -- --name X --route /carrier/#/foo --jira MX-1 --priority P1

# Opcion B: usar `=` (no se mangle)
npm run scaffold:page -- --name=X --route=/carrier/#/foo --jira=MX-1 --priority=P1
```

PowerShell y CMD nativos **no** tienen este problema.

## Lo que NO hace

- No agrega el POM al barrel `tests/pages/carrier-v2/index.ts`. Editarlo a mano.
- No abre el spec en el editor.
- No corre `npm run traceability` automaticamente (correr aparte).
- No infiere selectores reales — el heading es placeholder, hay que ajustar contra DOM.
