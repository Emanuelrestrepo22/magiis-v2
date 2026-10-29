// tests/helpers/fr-facts.ts
// Registro unico de hechos del circuito FR con estado y evidencia. Estructural = se asevera estricto
// ya; convencion (signo, base de comision) = tolerante hasta confirmar. Al confirmar un hecho se cambia
// SOLO `status` + `evidence` aqui (WP8). Solo constantes: sin Playwright ni DB.
export type FactStatus = 'confirmed' | 'assumed';
export type Fact<T> = { value: T; status: FactStatus; evidence: string };

export function fact<T>(value: T, status: FactStatus, evidence: string): Fact<T> {
  return { value, status, evidence };
}

export type BalanceSign = 'db' | 'api' | 'unknown';

export const FR_FACTS = {
  detailFields: {
    toll: fact(
      'roadToll',
      'confirmed',
      'GET travels/{id} detalle TEST viaje 71599 (2026-10-21): roadToll=0, parking=0, kilometers=27.28; FE travel-detail-final-data-form usa travel.roadToll'
    ),
    parking: fact(
      'parking',
      'confirmed',
      'GET travels/{id} detalle TEST viaje 71599 (2026-10-21): roadToll=0, parking=0, kilometers=27.28; FE travel-detail-final-data-form usa travel.parking'
    ),
    fare: fact(
      'tourPrice',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (tipado; medido TEST 2026-10-13, viajes 71124/71106)'
    ),
    total: fact(
      'amount',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (tipado; medido TEST 2026-10-13, viajes 71124/71106)'
    ),
    otherTotal: fact(
      'otherCost',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (tipado; medido TEST 2026-10-13, viajes 71124/71106)'
    ),
    otherCom: fact(
      'otherCostCom',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (tipado; medido TEST 2026-10-13, viajes 71124/71106)'
    ),
    otherNoCom: fact(
      'otherCostNoCom',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (tipado; medido TEST 2026-10-13, viajes 71124/71106)'
    ),
    kilometers: fact(
      'kilometers',
      'confirmed',
      'GET travels/{id} detalle TEST viaje 71599 (2026-10-21): roadToll=0, parking=0, kilometers=27.28'
    ),
    wait: fact(
      'waitTimePrice',
      'confirmed',
      'tests/api/clients/travels.client.ts TravelDetail (medido TEST 2026-10-13, viajes 71124/71106)'
    )
  },
  bookCodes: {
    driverCash: fact(
      ['CASH_COMMISSION', 'CASH_PAYMENT_COMM'],
      'confirmed',
      'DB TEST 2026-10-21 CHECKINGACCOUNTFORDRIVER: rendiciones manuales 13843 y 13840 (efectivo) = 1 fila de cada codigo'
    ),
    driverCc: fact(
      ['CHECKING_ACCOUNT_COMM'],
      'assumed',
      'DB TEST 2026-10-21: el codigo existe (rendicion 13757, mixta); falta una rendicion CC-pura que lo aisle'
    ),
    owner: fact(
      ['TDDV'],
      'confirmed',
      'DB TEST 2026-10-21 CHECKINGACCOUNTFOROWNER rendicion manual 13843 = 1 fila TDDV; rendicion-automatica-diseno-2026-10-21.md'
    )
  },
  balanceSign: {
    driver: fact<BalanceSign>(
      'unknown',
      'assumed',
      'hoy valor absoluto; confirmar en primer run (cc-delta.ts: API sin inversion)'
    ),
    owner: fact<BalanceSign>('unknown', 'assumed', 'hoy valor absoluto; confirmar en primer run'),
    client: fact<BalanceSign>(
      'db',
      'confirmed',
      'tests/helpers/cc-delta.ts: API de CC cliente opuesta a CHECKINGACCOUNT.BALANCE; snapshotClientCc normaliza a DB'
    )
  },
  commissionBase: fact<'TOTALCASH+TOTALCHECKINGACCOUNT'>(
    'TOTALCASH+TOTALCHECKINGACCOUNT',
    'assumed',
    'matriz-edicion-post-cierre-2026-10-21.md; confirmar en primer run contra comisiones de la rendicion'
  ),
  reCloseRejectCodes: fact(
    /ACTION_NOT_ALLOWED|TRAVEL_SURRENDERED/i,
    'confirmed',
    'TEST viaje 71602 (2026-10-21): finalizeAdmin sobre viaje rendido -> 400 ACTION_NOT_ALLOWED, estado/monto sin cambio; BE TravelService.java:4242 puede devolver 409 TRAVEL_SURRENDERED (valido tambien)'
  ),
  readOnlyBadge: fact(
    /read\s*only|solo\s*lectura/i,
    'assumed',
    'UI detalle badge «Read only» en DONE (AC-FR); texto no verificado en primer run'
  )
} as const;

/** Rutas (p. ej. `detailFields.toll`) de los hechos con status 'assumed'. */
export function assumedFacts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const n = node as Record<string, unknown>;
    if (typeof n.status === 'string' && 'evidence' in n) {
      if (n.status === 'assumed') out.push(path);
      return;
    }
    for (const [k, v] of Object.entries(n)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(FR_FACTS, '');
  return out;
}
