# Análisis comparativo V1 (Angular 8) vs V2 (Angular 18)

> Pendiente de poblar post-reinicio de Claude Code (requiere GitLab MCP activo + clones en `refs/v1` y `refs/v2`).

## Objetivos del análisis

1. **Stack y dependencias**: versiones de Angular, RxJS, librerías de UI, build tooling.
2. **Routing**: paths, lazy loading, guards, redirects. Tabla V1 → V2.
3. **Arquitectura de módulos**: feature modules, shared modules, módulos eliminados o renombrados.
4. **Componentes UI**: librería usada en V1 (probable: PrimeNG / Material / custom) vs V2.
5. **Patrones de estado**: services + RxJS, NgRx, signals (Angular 18).
6. **Autenticación**: flujos de login, interceptores HTTP, guards de rutas.
7. **Selectores estables**: identificadores que sobreviven la migración (`data-testid`, ids, atributos ARIA).
8. **Deltas funcionales conocidos**: cambios intencionados en V2 (no son bugs).
9. **Riesgos de regresión**: áreas con probabilidad alta de comportamiento divergente.

## Estructura de la tabla por pantalla

| Pantalla | Ruta V1 | Ruta V2 | Componente V1 | Componente V2 | Estado migración | Selectores compatibles | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Método de análisis

```text
1. Clonar V1 y V2 (read-only) en refs/.
2. Glob package.json + angular.json en ambos.
3. Diff de dependencias.
4. Mapear src/app/**/*-routing.module.ts y src/app/**/*.routes.ts.
5. Para cada pantalla finalizada en MX-4820:
   a. Localizar componente V1 (template + ts).
   b. Localizar componente V2 (template + ts).
   c. Extraer selectores (data-testid, id, formControlName, name).
   d. Marcar compatibilidad y migración del selector.
6. Documentar deltas funcionales acordados con dev.
```

## Resultado esperado

- Esta sección poblada con tablas reales.
- JSON normalizado en `docs/analysis/v1-v2-map.json` para que los agentes lo consuman.
- Lista de **selectores estables canónicos** en `docs/analysis/canonical-selectors.md`.
