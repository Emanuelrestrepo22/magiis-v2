// tests/data/xray/f5-keys.ts
// Keys de Xray de la rendicion F5 (MG-1024 BE + MG-1027 FE, Universal F5). Los specs las consumen con
// `makeAnnotate(key, route)` (annotation `tms`). Diseño: .session/shift-left-testing/2026-11-05-mg-1027-rendir-viajes/
// draft/test-design-mg1027.md (repo agentic-qa-boilerplate). Solo los Candidate de ROI se automatizan.
//
// - ATR TM-1659 y smoke TM-1663: runs donde ya hay evidencia manual del 05/11; la automatización
//   acredita por key sin pisar el veredicto manual hasta que el import se haga a propósito.
// - TC10/TC11/TC12 (TM-1655/TM-1656/TM-1657) son IRREVERSIBLES: solo se acreditan desde s1/s3/s5 con sus
//   gates abiertos (los corre un humano o el orquestador, nunca un subagente).

export const F5_KEYS = {
  /** TC1: línea de no comisionables separada y suma al efectivo a rendir (solo vista). */
  TC1_LINEA_NC: 'TM-1646',
  /** TC4: bloque «Costo» / línea NC según porcentajes (aquí solo la parte NC = 0 → línea ausente). */
  TC4_VISIBILIDAD: 'TM-1649',
  /** TC7: habilitación de Confirmar y saldo según «Entregar» (solo vista). */
  TC7_ENTREGAR: 'TM-1652',
  /** TC10: circuito completo de rendición con NC (irreversible). */
  TC10_CIRCUITO: 'TM-1655',
  /** TC11: confirmación con entrega parcial sin NC (irreversible). */
  TC11_PARCIAL: 'TM-1656',
  /** TC12: confirmación con gastos varios y NC (irreversible). */
  TC12_GASTOS: 'TM-1657',
  /** TC13: tarifa 0 con solo un no comisionable (R05; lote de confirmación irreversible). */
  TC13_TARIFA_CERO: 'TM-1660',
  /** TC15: la pantalla de confirmación manual no anuncia TDOC (solo vista, antes de confirmar R01). */
  TC15_SIN_TDOC: 'TM-1662',
  /** TC16: rendición automática con no comisionable (W3). */
  TC16_AUTOMATICA: 'TM-1700',
  /** TC17: liquidación de chofer y propietario con no comisionables (W4). */
  TC17_LIQUIDACION: 'TM-1701',
  /** TC3 / TC5 / TC9 / TC14: solo vista o PDF, contrastados con Jira el 11/11 (D-8). */
  TC3_LINEA_BASE: 'TM-1648',
  TC5_PDF: 'TM-1650',
  TC9_SALDO_CHOFER: 'TM-1654',
  TC14_PAR_VACIO: 'TM-1661'
} as const;

/**
 * Cucumber de OTROS epics (MG-1005/990/995..997) que la matriz de decision cita para la confirmación. Contrastadas
 * con Jira el 11/11 (D-8, lectura): el titulo es cercano pero el alcance es de otro epic -> mapeo DEBIL; el
 * spec las anota como key secundaria y no se acreditan sin revision del lider.
 */
export const F5_WEAK_KEYS = {
  /** TC131: confirmación con otros costos = importe del detalle (R01 paso 4). */
  CONFIRM_OTROS_COSTOS: 'TM-1112',
  /** TC129: la fila de rendición persistida = lo que muestra la pantalla (R06 / R01). */
  FILA_PERSISTIDA: 'TM-1110',
  /** TC068: conservación de totales del cierre vs baseline (R06). */
  CONSERVACION_TOTALES: 'TM-1048',
  /** TC134: importe del concepto coincide entre detalle, rendición, CC y reportes (FR 2021 R02). */
  IMPORTE_CONCEPTO: 'TM-1115'
} as const;
