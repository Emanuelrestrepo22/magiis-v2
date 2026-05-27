# tests/api — Capa API (FW-008 / FW-009)

Andamiaje para dos capacidades futuras del framework. El proyecto es **frontend-only**
por `docs/scope-rules.md`; esta capa NO valida payloads de API como objetivo de test,
sino que la usa como **herramienta** para:

| Subdir     | Proposito                                                                                                                         | Estado                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `mocks/`   | Interceptar red con `route.fulfill` para estabilizar specs con datos volatiles (visual, edge cases dificiles de provocar via UI). | ✅ Scaffold (FW-009)                                           |
| `clients/` | Request contexts tipados para **precondiciones** (crear un cliente via API en vez de via UI, mas rapido y estable).               | 🔵 Pendiente (FW-008, necesita endpoints reales + permisos QA) |

## Mocks (FW-009)

Ver `mocks/README.md`. Helper generico `mockListResponse` disponible para interceptar
respuestas de listado y devolver un fixture determinista de `tests/data/carrier-v2/`.

Uso tipico: un visual spec cuya pantalla depende de datos que cambian (saldos, fechas)
puede mockear la respuesta para tener un baseline estable.

## Clients (FW-008)

Bloqueado hasta tener:

1. Documentacion de endpoints reales del backend carrier V2.
2. Permisos de un usuario QA con acceso read/write controlado (o endpoints de test).
3. Decision sobre si las precondiciones via API entran en el scope (hoy frontend-only).

Cuando se desbloquee: crear `clients/<dominio>.client.ts` con un `APIRequestContext`
tipado por dominio. Ejemplo de contrato esperado documentado abajo cuando exista.
