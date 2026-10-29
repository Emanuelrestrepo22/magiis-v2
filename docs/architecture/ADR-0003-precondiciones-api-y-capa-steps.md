# ADR-0003 — Precondiciones vía API y capa Steps en magiis-carrier-v2-e2e

- **Estado**: Propuesto (pendiente de aprobación humana del owner). Mientras siga en este estado, la
  enmienda 2026-09-29 de `docs/scope-rules.md` §1 que depende de él tampoco está aprobada.
- **Fecha**: 2026-09-29
- **Origen**: plan `MG-990-fase1` (otros costos en Nuevo Viaje, ATR TM-1280), decisión 11.
- **Desbloquea**: FW-008 (`tests/api/README.md`, sección Clients).

## Contexto

`docs/scope-rules.md` §1 limitaba el proyecto a frontend. Prohibía emitir requests propios y
asertar payloads del backend. La familia Otros Costos (MG-995/MG-996) necesita tres cosas que la
UI no puede dar de forma estable ni barata:

1. **Precondiciones**: conceptos de Otros Costos de cada tipo (Fijo, Cantidad, Porcentaje,
   Variable), con topes y disponibilidad controlados. El ABM descarta el signo menos (O-UAT-03), así
   que la clase negativa de TM-1279 no se puede preparar por UI.
2. **Limpieza**: cada test crea un viaje real en UAT (ambiente compartido con testers manuales). El
   viaje tiene que cancelarse y el concepto darse de baja aunque el test falle.
3. **Oráculo de persistencia**: la base de UAT no es alcanzable desde este repo (BL-046). Además, el
   widget «Datos Presupuestados» del detalle multiplica de más los conceptos Cantidad (hallazgo D1), así
   que no sirve como oráculo.

## Decisión

1. Se admite una **capa API de herramienta** en `tests/api/clients/`: sesión desde el
   `storageState` guardado (sin login con contraseña), otros costos (`search` / `new` / `delete`) y
   viajes (detalle y cancelación). Cada endpoint cita su fuente en el front (`ruta:línea`).
2. Usos permitidos, y solo estos:
   - preparar precondiciones (crear los datos que el test necesita);
   - limpiar lo que creó la corrida (y barrer restos de corridas interrumpidas);
   - **oráculo de persistencia**: leer por API lo que el alta hecha por UI guardó
     (`GET travels/{id}` → `simulationPrice.otherCosts[]`, catálogo `otherCosts/search`).
3. El objetivo del test sigue siendo la pantalla: la acción bajo prueba se hace **siempre por UI**. La
   API no reemplaza el flujo que el caso de Xray describe.
4. Se crea la **capa Steps** (`tests/steps/<dominio>/`) para recorridos reutilizables (preparar →
   alta por UI → oráculo UI + API → evidencia → limpieza). La reutilizan las fases F2, F5 y F7 de
   Otros Costos. Las aserciones de negocio (importes) quedan en el test.
5. Guardas obligatorias de la capa API: errores redactados (headers, `Bearer`, JWT); nunca imprimir
   el token; `401/403` = STOP sin reintento ni login; prefijo propio en los datos creados; nunca
   editar ni borrar datos preexistentes (conceptos 27, 34 y 38 del carrier 1481); limpieza en
   `finally`.

## Consecuencias

- Positivas: precondiciones deterministas; limpieza verificable; oráculo de persistencia sin base de
  datos; recorrido reutilizable entre fases.
- Negativas: el repo deja de ser frontend puro. Un cambio de contrato de un endpoint rompe la
  preparación, no la pantalla bajo prueba. Hay que mantener las citas `ruta:línea` al día con el
  release desplegado.
- Fuera de alcance: tests cuyo objetivo sea la API (contratos, performance, seguridad) y mocks del
  backend. Siguen prohibidos.

## Alternativas descartadas

- **Preparar por la UI del ABM**: acopla 6 Tests de viaje a la pantalla del ABM (un fallo del ABM los
  bloquearía) y no permite la clase negativa. El ABM tendrá su propia familia.
- **Validar persistencia contra el widget del detalle**: D1 lo invalida para conceptos Cantidad.
- **Validar contra la base**: no alcanzable desde V2 (BL-046).
