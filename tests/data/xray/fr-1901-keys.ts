// tests/data/xray/fr-1901-keys.ts
// Fuente unica de las keys de Xray del circuito FR (carrier 1901 TEST, no Universal). Los specs consumen
// estas keys con `makeAnnotate(key, route)` (annotation `tms`, la que lee xray-reporter). Detalle del
// mapeo y criterio de reuso: docs/qa/automation-stock/fr-1901/xray-trazabilidad-fr-1901-2026-10-21.md
// (repo agentic-qa-boilerplate).
//
// - ATP  TM-1285  Test Plan Universal F2+F3 (los Tests estan en el plan).
// - TS   TM-1481  Test Set de los Tests NUEVOS (TM-1482..TM-1500).
// - ATR  TM-1501  Test Execution automatizado FR 1901 (TEST): destino del import (XRAY_EXECUTION_KEY).
// Los Tests reusados (TM-1446, TM-1448, TM-1449, TM-1450, TM-1465) viven en el TS manual TM-1443 y su
// run manual esta en TM-1444: un Test tiene un run por ejecucion, el ATR TM-1501 no pisa TM-1444.
// Specs sin key a proposito: fr-circuit-s3-prepare y fr-circuit-s4-auto-prepare (preparan datos; el
// veredicto lo da su `verify`) y las fases prepare/arm/fire/disarm de fr-circuit-s5-auto (solo `verify`).

export const FR_1901_ATP = 'TM-1285';
export const FR_1901_TEST_SET = 'TM-1481';
export const FR_1901_ATR = 'TM-1501';

export const FR_1901_KEYS = {
  S1: 'TM-1449', // reusado
  S1_ALTA: 'TM-1445', // reusado: alta del viaje (solo sus AC-FR)
  S1_FINALIZACION_ADMIN: 'TM-1447', // reusado: finalizacion admin (solo sus AC-FR)
  S2: 'TM-1482',
  S3_VERIFY: 'TM-1446', // reusado
  S4_VERIFY: 'TM-1483',
  S5_AUTO_VERIFY: 'TM-1450', // reusado
  S6: 'TM-1448', // reusado
  SET_1: 'TM-1484',
  SET_2: 'TM-1485',
  SET_3: 'TM-1465', // reusado (liquidacion de chofer)
  SET_4: 'TM-1465', // reusado (liquidacion de propietario): mismo Test, consolidado por key
  EDM_SETTLED: 'TM-1485', // mismo Test que SET_2 (bloqueo de viaje liquidado, ruta API)
  EDM_FARE: 'TM-1486',
  EDM_TOLL: 'TM-1487',
  EDM_PARKING: 'TM-1488',
  EDM_OTHER_COM: 'TM-1489',
  EDM_OTHER_NOCOM: 'TM-1490',
  EDM_DISTANCE: 'TM-1491',
  R1: 'TM-1492',
  R2: 'TM-1493',
  R3: 'TM-1494',
  R4: 'TM-1495',
  R5: 'TM-1496',
  R6: 'TM-1497',
  R7: 'TM-1498',
  R8: 'TM-1499',
  R9: 'TM-1500'
} as const;

/** ACs que validan cada Test reusado acreditado por un spec compuesto (key -> AC-FR). */
export const FR_1901_KEY_ACS = {
  [FR_1901_KEYS.S1_ALTA]: ['AC-FR-01', 'AC-FR-02', 'AC-FR-03', 'AC-FR-04', 'AC-FR-05'],
  [FR_1901_KEYS.S1_FINALIZACION_ADMIN]: ['AC-FR-06', 'AC-FR-07', 'AC-FR-08']
} as const;

/**
 * Keys que acredita el spec S1 (un test, varias keys): TM-1449 con el estado del test completo,
 * TM-1445 «alta» y TM-1447 «finalizacion admin» solo con sus AC-FR (ver FR_1901_KEY_ACS).
 */
export const FR_1901_S1_TARGETS = [
  { key: FR_1901_KEYS.S1 },
  { key: FR_1901_KEYS.S1_ALTA, acs: FR_1901_KEY_ACS[FR_1901_KEYS.S1_ALTA] },
  {
    key: FR_1901_KEYS.S1_FINALIZACION_ADMIN,
    acs: FR_1901_KEY_ACS[FR_1901_KEYS.S1_FINALIZACION_ADMIN]
  }
] as const;

/** Campo editado por la matriz EDM (`Field` de fr-circuit-edit-matrix.spec.ts) -> key del Test. */
export const FR_1901_EDM_KEY_BY_FIELD = {
  fare: FR_1901_KEYS.EDM_FARE,
  toll: FR_1901_KEYS.EDM_TOLL,
  parking: FR_1901_KEYS.EDM_PARKING,
  otherCom: FR_1901_KEYS.EDM_OTHER_COM,
  otherNoCom: FR_1901_KEYS.EDM_OTHER_NOCOM,
  distance: FR_1901_KEYS.EDM_DISTANCE
} as const;

/**
 * Alcance automatizado de los Tests REUSADOS: el Test manual describe un recorrido mas amplio o con otro
 * disparador. El spec lo publica como `xray_comment` para que el run no sobre-declare cobertura.
 */
export const FR_1901_SCOPE_NOTES = {
  S1: 'Alcance automatizado (FR-S1): viaje propio recien creado (lote de 1 viaje), cierre administrativo y rendicion manual con oraculos API/DB; no recorre el lote historico A del Test manual.',
  S3_VERIFY:
    'Alcance automatizado (FR-S3-verify): cierre por la app real (DONE) y rendicion manual del viaje; los estados intermedios y el GPS los ejecuta la corrida de la app, no se asertan en este spec.',
  S5_AUTO_VERIFY:
    'Alcance automatizado (FR-S5-auto verify): rendicion automatica disparada por el PUT travelsSurrender de la edicion del propietario en V2 (no por el pop-up de desvincular de V1) y verificacion de la fila y los libros.',
  S6: 'Alcance automatizado (FR-S6): cancelacion por operador sin cargo (no toca lote ni libros); la cancelacion por chofer y el listado paginated-driver no se ejercitan en este spec.',
  SET_CONFIRM:
    'Alcance automatizado (FR-SET-3/4): confirma la liquidacion de chofer / propietario y verifica total, libros y estado PAID; el comprobante PDF no se valida en este spec. Filas omitidas = FR_CONFIRM_SETTLEMENT sin habilitar.'
} as const;
