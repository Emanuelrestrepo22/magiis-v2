// tests/helpers/f5-auto-oracle.ts
// Oraculo PURO de la rendicion AUTOMATICA con no comisionable (NC) multi-carrier (F5 fase 2, W3; TM-1700 / TC16).
// Reglas medidas en UAT FR 2021 el 10/11 (handoff fr-1/fr-2) y TEST 1901 (rendiciones 13861 / 14182):
// - fila TRAVELSSURRENDER con DRIVER_ID NULL, VEHICLEOWNERID = propietario, COLLECTEDPAYEE = OWNER;
// - TOTALCASH = efectivo sin NC; TOTALCASHOTHERCOST_NOCOM = NC (0, no NULL, sin NC); TOTALCASHTOSURRENDER = TOTALCASH + NC;
// - comisiones = pct × base SIN NC (la base resta peaje/estacionamiento); AGENCY_NETPAID = 0 (H-AUTO-03, observacion);
// - libro del PROPIETARIO: TDCV = comision de agencia (CREDITO, obs-fr-preexistencia) y TDOC = NC solo si NC > 0; libro del
//   CHOFER sin movimientos (Q7b); liquidacion del propietario sube owner + COMMISSIONSUM (MX-4716: sin chofer todo es del dueno);
// - SURRENDERED/OPERATIVEDIFFERENCE: el test espera TOTALCASH; el sistema devuelve TOTALCASH + NC (C2 / MG-1024) = observacion.
// - «Closed» no lista automaticas (OBS-FR-01, PREEXISTENTE): jamas se asevera su presencia en Closed.
// H-04: la definicion de TOTALCASH con peaje/estacionamiento esta ABIERTA (D-6); por defecto la automatica FR incluye
// peaje/estacionamiento (`includeTollParking`), parametrizable con `totalCashDefinition`.
import type { CommissionSource, CommissionSplit } from '../config/carrier-profiles.js';
import { round2 } from '../utils/money.js';
import {
  expectedAutoSurrender,
  type AutoCommissionOptions,
  type AutoTrip
} from './auto-surrender.js';
import {
  evaluateOwnerTdoc,
  expectedF5,
  paymentKind,
  type F5Expected,
  type F5CommissionInputs,
  type F5Money,
  type F5OwnerBookRow,
  type F5TotalCashDefinition,
  type F5TripFacts
} from './f5-surrender-oracle.js';
import type { Mismatch, OracleVerdict } from './oracle-result.js';

const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});
const cents = (n: number): number => Math.round(n * 100);
const near = (a: number, b: number): boolean => cents(a) === cents(b);

/** Hechos del viaje + city tax en efectivo (opcional: solo para TOTALCASHOTHERCOST; sin el dato no se asevera). */
export type F5AutoTripFacts = F5TripFacts & { cityTax?: number };

export type F5AutoOptions = AutoCommissionOptions & {
  /** Dias de viaje distintos del lote (comision fija por dia, solo carriers con fija); default 1. */
  fixedDays?: number;
  /** H-04. Default `includeTollParking` (automatica FR medida: TOTALCASH = final − NC). */
  totalCashDefinition?: F5TotalCashDefinition;
};

export type F5AutoExpected = {
  travelIds: number[];
  row: {
    TOTALCASH: number;
    TOTALCASHOTHERCOST_NOCOM: number;
    TOTALCASHOTHERCOSTQTY_NOCOM: number;
    /** TOTALOTHERCOST_NOCOM (NC de viajes CC): la automatica lo deja en 0 (medido en 14182). */
    TOTALOTHERCOST_NOCOM: number;
    /** City taxes en efectivo; null = no declarado (no se asevera). */
    TOTALCASHOTHERCOST: number | null;
    TOTALCASHTOSURRENDER: number;
    COMMISSIONSUM: number;
    OWNER_TOTALCOMMISSION: number;
    AGENCY_TOTALCOMMISSION: number;
    /** H-AUTO-03: 0 en automaticas (en manuales = TOTAL_COLLECTED). */
    AGENCY_NETPAID: number;
  };
  /** R18 = NC > 0 (TDOC = NC); R19 = NC = 0 (sin TDOC). */
  scenario: 'R18-nc' | 'R19-sin-nc';
  ownerBook: { tdcvCredit: number | null; tdocCredit: number };
  /** Lo que sube «To Settle» del propietario: OWNER_TOTALCOMMISSION + COMMISSIONSUM (MX-4716). */
  ownerToSettleDelta: number;
  surrendered: { base: number; withNc: number | null };
  nc: F5Money;
  observations: string[];
};

function toAutoTrip(t: F5AutoTripFacts): AutoTrip {
  const kind = paymentKind(t.paymentMethod);
  if (kind === 'creditCard') {
    throw new Error(
      `[f5-auto-oracle] viaje ${t.travelId} en tarjeta: la automatica del circuito no lo modela`
    );
  }
  return {
    scenario: 'S5',
    travelId: t.travelId,
    paymentMethod: kind === 'cash' ? 'CASH' : 'CHECKING_ACCOUNT',
    simulated: t.finalPrice,
    closedBy: 'admin',
    assigned: true,
    closed: {
      finalPrice: t.finalPrice,
      cityTax: t.cityTax ?? 0,
      // La base de comision SIEMPRE resta peaje/estacionamiento; TOTALCASH depende de H-04 (sale de expectedF5).
      tolls: t.toll,
      parking: t.parking,
      noCom: t.noCom,
      closedAt: new Date(0).toISOString()
    }
  };
}

/** Esperado de la automatica del lote (R18/R19) a partir de los hechos por viaje (DB en TEST o sintetizados del GET). */
export function expectedF5Auto(
  trips: readonly F5AutoTripFacts[],
  options: F5AutoOptions = {}
): F5AutoExpected {
  if (trips.length === 0) throw new Error('[f5-auto-oracle] expectedF5Auto sin viajes');
  const definition = options.totalCashDefinition ?? 'includeTollParking';
  const f5 = expectedF5(trips, { totalCashDefinition: definition });
  const auto = expectedAutoSurrender(trips.map(toAutoTrip), options.fixedDays ?? 1, {
    pct: options.pct,
    fixed: options.fixed
  });
  const cashTrips = trips.filter((t) => paymentKind(t.paymentMethod) === 'cash');
  const cityTaxKnown = cashTrips.every((t) => typeof t.cityTax === 'number');
  const nc = f5.ncCash;
  const observations = [...(f5.observations ?? [])];
  const base = f5.totalCash.amount;
  return {
    travelIds: auto.travelIds,
    row: {
      TOTALCASH: base,
      TOTALCASHOTHERCOST_NOCOM: nc.amount,
      TOTALCASHOTHERCOSTQTY_NOCOM: nc.quantity,
      TOTALOTHERCOST_NOCOM: 0,
      TOTALCASHOTHERCOST: cityTaxKnown
        ? round2(cashTrips.reduce((s, t) => s + (t.cityTax ?? 0), 0))
        : null,
      TOTALCASHTOSURRENDER: f5.cashToSurrender,
      COMMISSIONSUM: auto.row.COMMISSIONSUM,
      OWNER_TOTALCOMMISSION: auto.row.OWNER_TOTALCOMMISSION,
      AGENCY_TOTALCOMMISSION: auto.row.AGENCY_TOTALCOMMISSION,
      AGENCY_NETPAID: 0
    },
    scenario: nc.amount > 0 ? 'R18-nc' : 'R19-sin-nc',
    ownerBook: { tdcvCredit: auto.ownerBook.TDCV, tdocCredit: nc.amount },
    ownerToSettleDelta: round2(auto.row.OWNER_TOTALCOMMISSION + auto.row.COMMISSIONSUM),
    surrendered: { base, withNc: nc.amount > 0 ? round2(base + nc.amount) : null },
    nc,
    observations
  };
}

/**
 * UAT sin DB: hechos sintetizados desde el esperado derivado del GET (`expectedFromGet`). Cada medio de pago entra como UN
 * viaje cuyo total ya excluye el NC; supone peaje/estacionamiento = 0 (el GET no los expone): con peaje la base de comision
 * seria menor y la diferencia aparece como falla de comision, a investigar con la capa DB de TEST.
 */
export function factsFromExpected(e: F5Expected): F5AutoTripFacts[] {
  const facts: F5AutoTripFacts[] = [];
  if (e.totalCash.quantity > 0) {
    facts.push({
      travelId: -1,
      paymentMethod: 'CASH',
      finalPrice: round2(e.totalCash.amount + e.ncCash.amount),
      toll: 0,
      parking: 0,
      noCom: e.ncCash.amount,
      taxes: e.taxesCash
    });
  }
  if (e.totalCheckingAccount.quantity > 0) {
    facts.push({
      travelId: -2,
      paymentMethod: 'CHECKING_ACCOUNT',
      finalPrice: round2(e.totalCheckingAccount.amount + e.ncCheckingAccount.amount),
      toll: 0,
      parking: 0,
      noCom: e.ncCheckingAccount.amount,
      taxes: 0
    });
  }
  if (facts.length === 0)
    throw new Error('[f5-auto-oracle] el esperado no trae viajes en efectivo ni en CC');
  return facts;
}

// ───────────────────────────── Fila TRAVELSSURRENDER (DB, TEST) ─────────────────────────────

export type F5AutoRowReading = {
  DRIVER_ID: number | null;
  VEHICLEOWNERID: number | null;
  VEHICLE_ID: number | null;
  COLLECTEDPAYEE: string | null;
  TOTALCASH: number | null;
  TOTALCASHOTHERCOST_NOCOM: number | null;
  TOTALCASHOTHERCOSTQTY_NOCOM: number | null;
  TOTALOTHERCOST_NOCOM: number | null;
  TOTALCASHOTHERCOST: number | null;
  TOTALCASHTOSURRENDER: number | null;
  COMMISSIONSUM: number | null;
  OWNER_TOTALCOMMISSION: number | null;
  AGENCY_TOTALCOMMISSION: number | null;
  AGENCY_NETPAID: number | null;
};

/** Fila automatica contra el esperado: identidad (DRIVER_ID NULL, propietario, vehiculo, OWNER) + importes. NULL falla. */
export function evaluateAutoRow(
  row: F5AutoRowReading,
  expected: F5AutoExpected,
  identity: { ownerId: number; vehicleId: number }
): OracleVerdict {
  const m: Mismatch[] = [];
  if (row.DRIVER_ID !== null) {
    m.push({
      field: 'TRAVELSSURRENDER.DRIVER_ID (automatica = NULL)',
      expected: null,
      actual: row.DRIVER_ID
    });
  }
  if (row.VEHICLEOWNERID !== identity.ownerId) {
    m.push({
      field: 'TRAVELSSURRENDER.VEHICLEOWNERID',
      expected: identity.ownerId,
      actual: row.VEHICLEOWNERID
    });
  }
  if (row.VEHICLE_ID !== identity.vehicleId) {
    m.push({
      field: 'TRAVELSSURRENDER.VEHICLE_ID',
      expected: identity.vehicleId,
      actual: row.VEHICLE_ID
    });
  }
  if (row.COLLECTEDPAYEE !== 'OWNER') {
    m.push({
      field: 'TRAVELSSURRENDER.COLLECTEDPAYEE',
      expected: 'OWNER',
      actual: row.COLLECTEDPAYEE
    });
  }
  const wants: Array<[keyof typeof expected.row, number | null]> = [
    ['TOTALCASH', expected.row.TOTALCASH],
    ['TOTALCASHOTHERCOST_NOCOM', expected.row.TOTALCASHOTHERCOST_NOCOM],
    ['TOTALCASHOTHERCOSTQTY_NOCOM', expected.row.TOTALCASHOTHERCOSTQTY_NOCOM],
    ['TOTALOTHERCOST_NOCOM', expected.row.TOTALOTHERCOST_NOCOM],
    ['TOTALCASHOTHERCOST', expected.row.TOTALCASHOTHERCOST],
    ['TOTALCASHTOSURRENDER', expected.row.TOTALCASHTOSURRENDER],
    ['COMMISSIONSUM', expected.row.COMMISSIONSUM],
    ['OWNER_TOTALCOMMISSION', expected.row.OWNER_TOTALCOMMISSION],
    ['AGENCY_TOTALCOMMISSION', expected.row.AGENCY_TOTALCOMMISSION],
    ['AGENCY_NETPAID', expected.row.AGENCY_NETPAID]
  ];
  for (const [col, want] of wants) {
    if (want === null) continue; // no declarado: no se asevera
    const got = row[col];
    if (got === null || !near(got, want)) {
      m.push({ field: `TRAVELSSURRENDER.${col}`, expected: want, actual: got });
    }
  }
  return verdict(m);
}

export type SurrenderedKind = 'esperado' | 'incluye-nc-c2' | 'distinto';

/**
 * SURRENDERED/OPERATIVEDIFFERENCE: el test espera TOTALCASH (efectivo sin NC). Si el sistema devuelve TOTALCASH + NC con NC > 0
 * es la discrepancia C2 (MG-1024, punto abierto): observacion, no falla. Cualquier otro valor es falla.
 */
export function classifySurrendered(
  actual: number | null,
  expected: F5AutoExpected['surrendered']
): { kind: SurrenderedKind; observation: string | null } {
  if (actual !== null && near(actual, expected.base))
    return { kind: 'esperado', observation: null };
  if (actual !== null && expected.withNc !== null && near(actual, expected.withNc)) {
    return {
      kind: 'incluye-nc-c2',
      observation:
        `C2 (MG-1024): SURRENDERED = ${actual} incluye el NC; el esperado del test es TOTALCASH ${expected.base}. ` +
        'Regla del PO abierta: se registra el valor real, no es PASS/FAIL.'
    };
  }
  return { kind: 'distinto', observation: null };
}

// ───────────────────────────── Libro del propietario ─────────────────────────────

/** TDCV (comision de agencia sobre efectivo) es CREDITO del propietario (obs-fr-preexistencia); TDOC lo juzga `evaluateOwnerTdoc`. */
export function evaluateAutoOwnerBook(
  rows: readonly F5OwnerBookRow[],
  expected: F5AutoExpected
): OracleVerdict & { tdcvCredit: number; tdocCredit: number } {
  const m: Mismatch[] = [];
  const tdcv = rows.filter((r) => r.CHECKINGACCOUNTCODE === 'TDCV');
  const tdcvCredit = round2(tdcv.reduce((s, r) => s + (r.CREDIT ?? 0) - (r.DEBIT ?? 0), 0));
  if (expected.ownerBook.tdcvCredit !== null) {
    if (tdcv.length !== 1 || !near(tdcvCredit, expected.ownerBook.tdcvCredit)) {
      m.push({
        field: 'libro propietario TDCV (credito = comision de agencia sobre efectivo)',
        expected: `1 fila, credito ${expected.ownerBook.tdcvCredit}`,
        actual: `${tdcv.length} fila(s), credito neto ${tdcvCredit}`
      });
    }
  }
  const tdoc = evaluateOwnerTdoc({ rows, automatic: true, ncCash: expected.nc.amount });
  m.push(...tdoc.mismatches);
  return { ...verdict(m), tdcvCredit, tdocCredit: tdoc.tdocCredit };
}

/** Fila del libro del propietario por API (`OwnerBookRow`): amount = debito, paid = credito; el codigo puede venir con prefijo i18n. */
export type OwnerBookApiRow = {
  id: number;
  amount?: number | null;
  paid?: number | null;
  checkingAccountCode?: string | null;
};

/** Ultimo segmento del codigo en mayusculas (`...concept_codes.TDCV` → `TDCV`). */
export function bookCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const last = raw.split('.').pop() ?? raw;
  return last.trim().toUpperCase() || null;
}

/** Filas NUEVAS del libro (ids que no estaban antes de disparar): en UAT sin DB son las de la rendicion automatica. */
export function newBookRows<T extends { id: number }>(
  before: readonly T[],
  after: readonly T[]
): T[] {
  const seen = new Set(before.map((r) => r.id));
  return after.filter((r) => !seen.has(r.id));
}

export function ownerBookApiToRows(rows: readonly OwnerBookApiRow[]): F5OwnerBookRow[] {
  return rows.map((r) => ({
    CHECKINGACCOUNTCODE: bookCode(r.checkingAccountCode),
    DEBIT: r.amount ?? null,
    CREDIT: r.paid ?? null
  }));
}

/** Q7b: la rendicion automatica NO genera movimientos en el libro del chofer. */
export function evaluateNoNewDriverBookRows(newRows: number): OracleVerdict {
  return verdict(
    newRows === 0
      ? []
      : [
          {
            field: 'libro del chofer: movimientos nuevos por la automatica (Q7b)',
            expected: 0,
            actual: newRows
          }
        ]
  );
}

/** «To Settle» del propietario (liquidaciones): sube exactamente owner + COMMISSIONSUM (MX-4716). */
export function evaluateToSettleDelta(
  before: number | null,
  after: number | null,
  expectedDelta: number
): OracleVerdict {
  if (before === null || after === null) {
    return verdict([
      {
        field: 'To Settle del propietario (antes/despues)',
        expected: 'numeros',
        actual: { before, after }
      }
    ]);
  }
  const delta = round2(after - before);
  return verdict(
    near(delta, expectedDelta)
      ? []
      : [
          {
            field:
              'To Settle del propietario: delta = OWNER_TOTALCOMMISSION + COMMISSIONSUM (MX-4716)',
            expected: expectedDelta,
            actual: delta
          }
        ]
  );
}

// ───────────────────────────── Reparto de comision del par ─────────────────────────────

/** `F5_AUTO_PCT=owner/driver/agency` en fracciones (p. ej. `0.4/0.4/0.2`); invalido lanza. */
export function parseAutoPct(raw: string): CommissionSplit {
  const parts = raw.split('/').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    throw new Error(
      `F5_AUTO_PCT invalido: "${raw}" (owner/driver/agency en fracciones, p. ej. 0.4/0.4/0.2)`
    );
  }
  return { owner: parts[0], driver: parts[1], agency: parts[2] };
}

/**
 * Reparto y fija del par. Precedencia: override `F5_AUTO_PCT` > lectura de DB (TEST; incluye la fija ya ajustada por dias) >
 * `split` fijo del perfil. Perfil `db` sin DB ni override lanza (no se inventa un reparto). La fija de AR 4288 (122/dia a la
 * agencia) NO esta modelada sin DB: una diferencia en AGENCY_TOTALCOMMISSION de ese carrier es esperable.
 */
export function resolveAutoCommission(input: {
  source: CommissionSource;
  dbInputs: F5CommissionInputs | null;
  override?: string;
}): {
  pct: CommissionSplit;
  fixed: { owner: number; agency: number };
  origin: 'override' | 'db' | 'profile';
} {
  if (input.override?.trim()) {
    return {
      pct: parseAutoPct(input.override),
      fixed: { owner: 0, agency: 0 },
      origin: 'override'
    };
  }
  if (input.dbInputs) {
    return {
      pct: {
        owner: input.dbInputs.pctOwner,
        driver: input.dbInputs.pctDriver,
        agency: input.dbInputs.pctAgency
      },
      fixed: { owner: input.dbInputs.ownerFixed, agency: input.dbInputs.agencyFixed },
      origin: 'db'
    };
  }
  if (input.source.kind === 'fixed') {
    return { pct: input.source.split, fixed: { owner: 0, agency: 0 }, origin: 'profile' };
  }
  throw new Error(
    '[f5-auto-oracle] reparto del par en DB y sin capa db: declarar F5_AUTO_PCT=owner/driver/agency'
  );
}
