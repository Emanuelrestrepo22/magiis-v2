# FW-007c — Auditoria Settlements ListPage POMs

**Fecha:** 2026-05-24
**Branch:** `carrier-v2/fw-007b-list-poms-inherit`
**Alcance:** 4 POMs Settlements en `tests/pages/carrier-v2/`.

## Veredicto

✅ **TODO YA REFACTORIZADO CORRECTAMENTE.** No requiere cambios.

Los 4 Settlements POMs (`Contractor`, `Driver`, `Owner`, `Passenger`) ya extienden `BaseListPage` con cero redeclaracion. Esta auditoria preventiva confirma que NO hay deuda tecnica analoga a la de los 4 List POMs (`Client/Driver/Owner/Vehicle`) que motivo FW-007b.

## Detalle por POM

| POM                             | Herencia                  | Redeclaraciones | Custom                                                                  | API publico                                                                  | Veredicto |
| ------------------------------- | ------------------------- | --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| `SettlementsContractorListPage` | ✅ `extends BaseListPage` | 0               | `path` + `headingRegex` (`/^corporations?\|contractors?\|empresas?$/i`) | `goto`, `expectListReady`, `getDataRowCount`, `clickFirstRowActionButton(1)` | ✅ Limpio |
| `SettlementsDriverListPage`     | ✅ `extends BaseListPage` | 0               | `path` + `headingRegex` (`/^drivers?\|conductores?$/i`)                 | idem                                                                         | ✅ Limpio |
| `SettlementsOwnerListPage`      | ✅ `extends BaseListPage` | 0               | `path` + `headingRegex` (`/^owners?\|propietarios?$/i`)                 | idem                                                                         | ✅ Limpio |
| `SettlementsPassengerListPage`  | ✅ `extends BaseListPage` | 0               | `path` + `headingRegex` (`/^individuals?\|passengers?\|pasajeros?$/i`)  | idem                                                                         | ✅ Limpio |

## Consumo por specs

| Spec                                          | POMs consumidos | Metodos usados                                                                               |
| --------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `release-v2.0.2/sprint6-settlements.spec.ts`  | los 4           | `goto`, `expectListReady` (smoke checks)                                                     |
| `release-v2.0.2/sprint8-detail-flows.spec.ts` | los 4           | `goto`, `expectListReady`, `getDataRowCount`, `clickFirstRowActionButton(1)` (padre -> hijo) |

## Patron Settlements confirmado

Las rows de Settlements exponen N botones de accion en la ultima columna:

- index 0 = `+` (Create)
- index 1 = `clock` (History)
- index 2 = `PDF` (opcional)

`BaseListPage` ya provee los helpers nativos para este patron:

- `clickFirstRowActionButton(buttonIndex: number)` — click en boton N de la primera row
- `clickFirstRowLastActionButton()` — click en el ultimo boton (cuando varia el count)
- `getDataRowCount()` — cuenta rows con datos reales para `test.skip(empty)`

Los 4 Settlements POMs **consumen este API sin override**. Documentar en `POM-CONVENTIONS.md` para que el patron Settlements siga el mismo camino en futuros POMs.

## Conclusion

FW-007c se cierra sin cambios al codigo. El refactor FW-007b ya incluyo implicitamente todos los POMs jerarquicos correctos. La auditoria preventiva valida la salud del subsistema Settlements.

**Proximos candidatos** (fuera de scope de FW-007b/c):

- Auditar POMs detalle (`SettlementsContractorDetailPage`, `AffiliateCheckingAccountDetailPage`, etc.) vs `BaseDetailPage` — mismo patron de auditoria.
- Documentar en `POM-CONVENTIONS.md` el patron Settlements explicitamente para guiar futuros POMs.
