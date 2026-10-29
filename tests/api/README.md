# tests/api — Capa API (FW-008 / FW-009)

El objetivo de los tests sigue siendo el frontend (`docs/scope-rules.md`). Esta capa NO valida la
API como objetivo de test: la usa como **herramienta**. Los clientes (`clients/`) se habilitan con la
enmienda 2026-09-29 de `docs/scope-rules.md` §1 y el
[ADR-0003](../../docs/architecture/ADR-0003-precondiciones-api-y-capa-steps.md), ambos **propuestos
y pendientes de aprobación del owner**. Usos:

| Subdir     | Proposito                                                                                                                         | Estado                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `mocks/`   | Interceptar red con `route.fulfill` para estabilizar specs con datos volatiles (visual, edge cases dificiles de provocar via UI). | ✅ Scaffold (FW-009)                                           |
| `clients/` | Request contexts tipados para **precondiciones**, **limpieza** y **oráculo de persistencia** (ADR-0003).                          | ✅ Implementado (FW-008, otros costos y viajes; ADR propuesto) |

## Mocks (FW-009)

Ver `mocks/README.md`. Helper generico `mockListResponse` disponible para interceptar
respuestas de listado y devolver un fixture determinista de `tests/data/carrier-v2/`.

Uso tipico: un visual spec cuya pantalla depende de datos que cambian (saldos, fechas)
puede mockear la respuesta para tener un baseline estable.

## Clients (FW-008)

Implementado el 2026-09-29 para la familia Otros Costos (MG-995/MG-996, ATR TM-1280). Decisión y
límites en el [ADR-0003](../../docs/architecture/ADR-0003-precondiciones-api-y-capa-steps.md).

| Archivo                        | Qué hace                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients/carrierSession.ts`    | Sesión del carrier desde `storage/state-carrier-<env>.json` (sin login con contraseña), `sendOk` con errores redactados, `401/403` = `SessionRejectedError` (STOP). |
| `clients/otherCosts.client.ts` | `search` / `new` / `delete` de conceptos, con guardas de prefijo propio y de conceptos preexistentes protegidos (27, 34 y 38 del carrier 1481) y barrido > 24 h.    |
| `clients/travels.client.ts`    | Detalle del viaje (oráculo de persistencia) y cancelación con el DTO del front (limpieza).                                                                          |

Cada endpoint cita su fuente en el front (`ruta:línea`) en el encabezado del cliente. Uso vía el
fixture `tests/fixtures/carrierApiFixture.ts` (`carrierSession`, `carrierApi`, `otherCostsApi`,
`travelsApi`). Un dominio nuevo = `clients/<dominio>.client.ts` con las mismas guardas.
