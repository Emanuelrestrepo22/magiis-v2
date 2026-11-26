# Otros costos F1 en TEST (carrier 1521) - plan

Stock TM-1361, fase 3.1 / tarea T10 del circuito admin. Rama `test/TM-1285-other-costs-test`.
Merge de `carrier-v2/trips-otros-costos-f1` (head 8923f58): ya es ancestro de la rama, sin cambios que traer.

## Contrato (MG-1601)

El tarifador del cliente fija el tipo de concepto que se puede agregar al viaje:
venta -> solo conceptos por venta (`isByCost=false`); costo -> solo por costo. Un concepto del
tipo equivocado no se ofrece en el combo del modal y, por API, responde 409
`OTHER_COST_RATE_TYPE_MISMATCH`. Ese 409 es contrato real: se reporta FAILED, nunca se oculta.

Sondeo de solo lectura en TEST (2026-10-13): con «Stripe, Cliente» (tarifador 2261, venta) y la ruta
`quote-route.ts` (47.22) el combo ofrece solo conceptos por venta; los de costo (143-145, 148)
no aparecen. «Mclaren F1» (contractor, tarifador 6203) abre otro formulario (pasajero, autorizante,
Cuenta Corriente): fuera del alcance de este cambio.

## Datos TEST (`DATA_BY_ENV.test`)

| Dato                      | Valor                                                           | Origen         |
| ------------------------- | --------------------------------------------------------------- | -------------- |
| carrierId / moneda        | 1521 / USD                                                      | datos-1521     |
| Cliente                   | `Stripe, Cliente` (2261, venta)                                 | circuito admin |
| Pago                      | `Cash` (el flow lo elige; en UAT no cambia)                     | circuito admin |
| Ruta                      | `quote-route.ts` (origen != destino, cotiza 47.22)              | circuito admin |
| Ruta «larga» (Porcentaje) | misma ruta: 20 % de 47.22 = 9.44, no queda en centavos          | -              |
| `rateType`                | `sale`: conceptos sin costo (Regla G: el costo espeja la venta) | MG-1601        |
| Montos                    | los de UAT                                                      | -              |

UAT queda con `rateType: 'cost'` (comportamiento actual, sin cambios).

Oraculos de precondicion nuevos en `startQuotedTrip`: origen != destino resueltos y Subtotal > 0.

## Por key

| Key                                  | Spec                  | TEST                       | Motivo                                                                                                                       |
| ------------------------------------ | --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| TM-1085, 1086, 1087, 1091, 1090      | new-trip-other-costs  | corre (concepto por venta) | el costo no es el objeto del Test                                                                                            |
| TM-1084                              | new-trip-other-costs  | skip explicito             | el objeto es «Fijo con costo configurado»: exige tarifador por costo (6203)                                                  |
| TM-1277                              | new-trip-other-costs  | skip explicito             | «ambos topes» = Variable por costo: exige tarifador por costo                                                                |
| TM-1279                              | new-trip-other-costs  | skip explicito             | clase A (Costo ON en 0) y B (Costo OFF) en un mismo viaje: ningun tarifador admite ambas; requiere redisenar el Test (A1/A2) |
| TM-985, 1002, 1007, 1008, 1014, 1017 | other-costs-smoke-abm | corre                      | el ABM solo trabaja el catalogo del carrier; no depende del tarifador                                                        |
| TM-1099                              | -                     | manual                     | Cucumber app Chofer, carrier 1040 (nunca se escribe 1040); no hay spec en el repo                                            |

Los skips de costo se destraban con un pasajero 6203 (D3, Nayla) y el spec en modo `rateType: 'cost'`.

## Seguridad de datos

- Conceptos de la corrida: prefijo `QA E2E OC `, baja por API en el teardown, barrido > 24 h.
- Ids de conceptos manuales de 1521 (29, 30, 47, 135, 136, 143-149, 164-169) agregados a
  `PROTECTED_OTHER_COST_IDS`: ni edicion ni baja desde la automatizacion.
- Nunca carrier 1040.

## Riesgos

1. Combo de Places puede devolver otra sugerencia: la ruta se elige por texto exacto del domicilio.
2. TC109 y siguientes que guardan el alta crean viajes reales en TEST (cancelados en el teardown).
3. UI del ABM en TEST no verificada contra UAT v2.0.17 (sin guardar en la exploracion).

## Corrida (orquestador)

```
cross-env ENV=test OTHER_COSTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
  tests/specs/trips/new-trip-other-costs.spec.ts tests/specs/settings/other-costs-smoke-abm.spec.ts \
  --project=carrier-v2-desktop --workers=1 --retries=0
```
