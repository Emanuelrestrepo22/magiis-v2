# Traceability

Mapping versionado **TC-ID <-> Spec** generado automaticamente desde tags y annotations.

## Generar / actualizar

```bash
npm run traceability
```

El script `scripts/extract-tc-map.ts`:

1. Escanea `tests/specs/**/*.spec.ts`.
2. Extrae tags `@TC-*`, `@MX-*`, `@TS-*`, `@P1`/`@P2`/`@P3`, `@functional`/`@visual`/etc.
3. Extrae annotations `test.info().annotations.push({ type: 'jira'|'route_v2', description: '...' })`.
4. Genera `tc-map.md` (legible) y `tc-map.json` (consumible por CI).

## Como queda trazado un spec

```ts
import { test, expect } from '../../TestBase.js';

test('@P1 @functional @migration trips list muestra columnas migradas', async ({ page }) => {
  test.info().annotations.push({ type: 'jira', description: 'MX-1234' });
  test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/travel/dashboard' });
  // ...
});
```

El extractor mostrara este test como:

| Spec                                   | Tags TC | Jira    | Rutas V2                    | Prio | Tipo                  |
| -------------------------------------- | ------- | ------- | --------------------------- | ---- | --------------------- |
| `tests/specs/trips/trips-list.spec.ts` | -       | MX-1234 | /carrier/#/travel/dashboard | P1   | functional, migration |

## CI

`tc-map.md` y `tc-map.json` se commitean en el repo. El workflow puede regenerarlos y comparar contra la version commiteada para detectar drift, pero ese gate todavia no esta activo.
