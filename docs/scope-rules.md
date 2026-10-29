# Reglas de alcance — magiis-carrier-v2-e2e

> Estas reglas son **inmutables** para este proyecto. Cualquier persona o proceso que opere sobre este repositorio debe respetarlas.

> Enmienda 2026-09-02 (aprobada por el owner): §1 admite observación pasiva de red; §3 pasa de MX-XXXX a TM/MG; pasarelas de pago declaradas en alcance sólo en `test` (ver docs/backlog/automation-backlog.json → scopePolicies).

> Enmienda 2026-09-29 (**PROPUESTA, pendiente de aprobación del owner**, junto con `docs/architecture/ADR-0003-precondiciones-api-y-capa-steps.md`): §1 admite la API como herramienta para precondiciones, limpieza y oráculo de persistencia. Origen: plan MG-990-fase1 (otros costos en Nuevo Viaje, ATR TM-1280). Hasta la aprobación, el spec `tests/specs/trips/new-trip-other-costs.spec.ts` y `tests/api/clients/` no se mergean.

## 1. Solo frontend

Este proyecto automatiza **únicamente** la capa visual y funcional del portal carrier V2 (Angular 18).

### Permitido

- ✅ Interacciones del usuario: clicks, inputs, navegación, hover, focus, teclado.
- ✅ Validaciones funcionales: mensajes de error, deshabilitar/habilitar campos, estados.
- ✅ Validaciones visuales: screenshot diff, DOM snapshot, estructura, layout, estilos visibles.
- ✅ Comparación V1 vs V2 a nivel UI/UX.
- ✅ Setup mínimo de auth para llegar a pantallas (storageState).
- ✅ Observación pasiva de red (`page.on('request')`, `waitForResponse`) sobre las llamadas que el propio front dispara: sin emitir requests, sin mocks y sin asserts sobre el payload (aprobado por el owner 2026-09-02, piloto MU-001).
- ✅ Pasarelas de pago (Stripe / Authorize / eBizCharge / Mercado Pago): sólo en `test`, sólo la epic de gateway, precondición de tarjeta persistente cargada por UI.
- ✅ (Enmienda 2026-09-29, propuesta — ADR-0003) API como **herramienta** desde `tests/api/clients/`: crear precondiciones, limpiar lo que creó la corrida y leer lo persistido como **oráculo de persistencia** (asserts sobre el payload de esa lectura, porque la base de UAT no es alcanzable). La acción bajo prueba sigue siendo por UI; nunca editar ni borrar datos preexistentes; prefijo propio en los datos creados; errores redactados y `401/403` = STOP.

### Prohibido

- ❌ Llamadas a API que no sean las que el frontend dispara naturalmente (excepción: los usos de herramienta de la enmienda 2026-09-29).
- ❌ Asserts sobre payloads de respuesta backend (excepto si la UI muestra ese dato, o como oráculo de persistencia según la enmienda 2026-09-29).
- ❌ Tests cuyo objetivo sea la API (contratos, performance, seguridad): la enmienda 2026-09-29 no los habilita.
- ❌ Validaciones de base de datos.
- ❌ Mocks de backend (usar ambiente real o stubs solo si el equipo lo decide explícitamente).
- ❌ Tests de performance, carga, seguridad.
- ❌ Cualquier prueba que requiera Appium o mobile.

## 2. V2 como objetivo, V1 como referencia

- El target de los tests es **siempre V2** (Angular 18).
- V1 (Angular 8) es **fuente de referencia** para:
  - Entender el comportamiento esperado original.
  - Detectar regresiones (algo que funcionaba en V1 y se rompió en V2).
  - Validar paridad visual cuando se acuerda mantener look & feel.

## 3. Trazabilidad obligatoria

Cada test debe declarar:

- `TM-nnn` (Test de Xray) por caso o familia de casos, vía `makeAnnotate`, como literal o const del mismo archivo del spec.
- Story padre `MG-nnn` en el título del describe.
- Módulo (carrier portal sub-área).
- Pantalla (nombre canónico).
- Tipo: `visual | functional | both`.
- Ruta V2 (ruta V1 solo cuando aplique comparación).

> Las keys `MX-XXXX` presentes en specs existentes son históricas (filtro MX-4820) y no deben reutilizarse para specs nuevos.

## 4. Sin invención

- No inventar selectores: extraerlos del DOM real de V2.
- No inventar rutas: solo las documentadas en el ticket Jira o validadas en el repo V2.
- No inventar requisitos: si falta criterio de aceptación, marcar TODO + bloquear el test hasta confirmación.

## 5. Cobertura priorizada

1. **P1**: Pantallas críticas (login, dashboard, listados principales del carrier).
2. **P2**: Formularios y CRUD.
3. **P3**: Pantallas auxiliares (settings, ayuda, perfil).

Las 25 pantallas del MX-4820 se priorizarán en base a complejidad y criticidad funcional declarada en cada ticket finalizado.

## 6. Convención de commits

Formato validado por commitlint en `commitlint.config.js`:

```
<tipo>(<scope>): [MX-XXXX] descripción corta
```

Ejemplos en este proyecto:

- `feat(carrier-v2/login): [MX-XXXX] spec visual+funcional pantalla login migrada`
- `docs(inventory): [MX-5711] poblar inventario de pantallas migradas`

## 7. Convención de ramas

- `carrier-v2/<feature>` para specs del portal carrier V2.
- `analysis/<topic>` para análisis comparativos.
- `infra/<change>` para configuración del framework.
