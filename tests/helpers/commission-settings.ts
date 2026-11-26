// tests/helpers/commission-settings.ts
// Reparto de comision que el BACKEND aplica a un viaje/rendicion, derivado de la configuracion real del
// carrier (COMMISSIONSETTINGS del vehiculo + DRIVERSETTLPARAM del chofer). Funciones puras, sin I/O.
//
// Formula (magiis-be, rama develop):
// - Travel.setCommissionPct (entities/travels/Travel.java): driverPct = (RATE_BY_COST ? COST_PERCENTAGE :
//   TRAVELPERCENTAGE) / 100 (escala 2, HALF_UP). Segun PERCENTAGECOMMISSIONPAYEE del vehiculo:
//   OWNER  -> ownerPct = pct / 100 y agencyPct = 1 - (driverPct + ownerPct);
//   AGENCY -> agencyPct = pct / 100 y ownerPct = 1 - (driverPct + agencyPct).
//   `pct` = PERCENTAGECOMMISSION_FOR_COST si el tarifador es por costo, si no PERCENTAGECOMMISSION.
//   Los pct quedan en TRAVEL.*_COMMISSION_PCT al FINALIZAR el viaje (no al rendir).
// - Comision variable por viaje: pct * Travel.getBillingCostPrice() (Travel.getVariableCommissionOwner/Agency);
//   la del chofer = driverPct * base del medio de pago (Cash/CheckingAccountTravelSurrenderStrategy).
// - Comision FIJA (TravelsSurrenderService.addPartialFixedCommissionSettings): FIXEDCOMMISSION una vez por
//   DIA de viaje distinto (no por viaje), a FIXEDCOMMISSIONPAYEE; suma a OWNER_/AGENCY_TOTALCOMMISSION.
import { round2 } from '../utils/money.js';

export type CommissionPayee = 'OWNER' | 'AGENCY';

/** Configuracion de comision aplicable a un par vehiculo/chofer (columnas de COMMISSIONSETTINGS y DRIVERSETTLPARAM). */
export type CommissionSettings = {
  /** COMMISSIONSETTINGS.PERCENTAGECOMMISSION (0..100). */
  percentage: number;
  /** COMMISSIONSETTINGS.PERCENTAGECOMMISSION_FOR_COST (nullable en DB). */
  percentageForCost: number | null;
  percentagePayee: CommissionPayee;
  /** COMMISSIONSETTINGS.FIXEDCOMMISSION (monto por dia de viaje). */
  fixed: number;
  fixedPayee: CommissionPayee;
  /** DRIVERSETTLPARAM.TRAVELPERCENTAGE (0..100). */
  driverTravelPct: number;
  /** DRIVERSETTLPARAM.COST_PERCENTAGE (nullable en DB). */
  driverCostPct: number | null;
};

export type CommissionFractions = { owner: number; driver: number; agency: number };

export type CommissionOptions = {
  /** Tarifador por costo (RATE_BY_COST = 1): usa los porcentajes *_FOR_COST / COST_PERCENTAGE. */
  byCost?: boolean;
  /** Dias de viaje distintos del lote para la comision fija (default 1). */
  fixedDays?: number;
};

export type ExpectedCommissions = {
  split: CommissionFractions;
  /** Variables: fraccion * base. */
  owner: number;
  driver: number;
  agency: number;
  /** Fija total del lote (fixed * dias) a cada beneficiario. */
  ownerFixed: number;
  agencyFixed: number;
  /** Variable + fija (lo que persiste OWNER_/AGENCY_TOTALCOMMISSION). */
  ownerTotal: number;
  agencyTotal: number;
};

/** pct/100 con escala 2 HALF_UP, como `divide(100, 2, RoundingMode.HALF_UP)` del backend. */
const toFraction = (pct: number): number => Math.round((pct / 100 + Number.EPSILON) * 100) / 100;

function need(value: number | null, label: string): number {
  if (value === null) {
    throw new Error(
      `[commission] ${label} es NULL en DB y el tarifador es por costo: el backend no lo resuelve`
    );
  }
  return value;
}

/** Fracciones owner/driver/agency (suman 1). */
export function splitFromSettings(
  settings: CommissionSettings,
  options: Pick<CommissionOptions, 'byCost'> = {}
): CommissionFractions {
  const byCost = options.byCost === true;
  const driver = toFraction(
    byCost
      ? need(settings.driverCostPct, 'DRIVERSETTLPARAM.COST_PERCENTAGE')
      : settings.driverTravelPct
  );
  const payeePct = toFraction(
    byCost
      ? need(settings.percentageForCost, 'COMMISSIONSETTINGS.PERCENTAGECOMMISSION_FOR_COST')
      : settings.percentage
  );
  const rest = Math.round((1 - (driver + payeePct)) * 10000) / 10000;
  return settings.percentagePayee === 'OWNER'
    ? { owner: payeePct, driver, agency: rest }
    : { owner: rest, driver, agency: payeePct };
}

/**
 * Dias de viaje a los que se cobra la comision fija (TravelsSurrenderService.addPartialFixedCommissionSettings):
 * una vez por dia DISTINTO de viaje, salvo el dia igual a MAX(last_surrender_date) del chofer (ya cubierto por
 * su ultima rendicion). Fechas ISO `YYYY-MM-DD`. Evidencia: 14185 (fija 0, ultima rendicion 2026-11-05 = dia
 * del viaje) y lote B (fija 122: viaje del 06/11 con ultima rendicion del 05/11).
 */
export function fixedCommissionDays(
  tripDays: readonly string[],
  lastSurrenderDay: string | null
): number {
  const distinct = new Set(tripDays);
  if (lastSurrenderDay !== null) distinct.delete(lastSurrenderDay);
  return distinct.size;
}

/** Comision fija (por dia de viaje) por beneficiario. */
export function fixedPerDay(settings: CommissionSettings): { owner: number; agency: number } {
  return {
    owner: settings.fixedPayee === 'OWNER' ? settings.fixed : 0,
    agency: settings.fixedPayee === 'AGENCY' ? settings.fixed : 0
  };
}

/**
 * Comisiones esperadas sobre `base` (suma de la base comisionable del lote). `fixedDays` = dias de viaje
 * distintos del lote (la fija es por dia, no por viaje).
 */
export function expectedCommissionsFromSettings(
  settings: CommissionSettings,
  base: number,
  options: CommissionOptions = {}
): ExpectedCommissions {
  const split = splitFromSettings(settings, options);
  const days = options.fixedDays ?? 1;
  const perDay = fixedPerDay(settings);
  const owner = round2(split.owner * base);
  const agency = round2(split.agency * base);
  const ownerFixed = round2(perDay.owner * days);
  const agencyFixed = round2(perDay.agency * days);
  return {
    split,
    owner,
    driver: round2(split.driver * base),
    agency,
    ownerFixed,
    agencyFixed,
    ownerTotal: round2(owner + ownerFixed),
    agencyTotal: round2(agency + agencyFixed)
  };
}
