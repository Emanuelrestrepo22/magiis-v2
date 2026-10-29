// tests/helpers/commission-base.ts
// Oraculo puro de TM-1432 (MG-1537 AC3, PK-B T1): la base de la comision de chofer y dueno excluye la
// parte NO comisionable de los otros costos.
//
// - `FINAL_COST_PRICE` (base de comision) = tarifa de costo + espera de costo + otros costos
//   COMISIONABLES (costo). Los no comisionables no se suman.
// - La comision que muestra la vista previa de «Cierres de Caja» (GET toSurrend) es
//   `pct x FINAL_COST_PRICE` (magiis-be: TravelsSurrenderToResponseMapper, getBillingCostPrice()).
// - Los porcentajes salen de la CONFIGURACION del chofer y del vehiculo, no de constantes
//   (Travel.setCommissionPct, develop): por tarifador de costo usa DRIVERSETTLPARAM.COST_PERCENTAGE y
//   COMMISSIONSETTINGS.PERCENTAGECOMMISSION_FOR_COST; por venta, TRAVELPERCENTAGE y PERCENTAGECOMMISSION.
//   Agencia = pct del vehiculo (pagador AGENCY); dueno = 1 - chofer - agencia.
//
// Evaluador PURO: no lanza ni asevera; devuelve `ok` + diferencias (campo, esperado, obtenido) y el
// spec decide con `expect(v.ok, v.message)`. No reusa ni edita `evaluateCommissionPreview` de FR
// (porcentajes fijos 40/40/20, base explicita): propiedad de la otra linea.
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

/** Tolerancia monetaria / de fraccion (1 centavo). */
const TOLERANCE = 0.01;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE;
const num = (v: number | null | undefined): number => v ?? 0;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export type CommissionPcts = { driver: number; owner: number; agency: number };

/** Configuracion de comisiones medida en DB (en porcentaje 0-100, tal como se guarda). */
export type CommissionConfig = {
  /** DRIVERSETTLPARAM.TRAVELPERCENTAGE (viajes por venta). */
  driverSalePct: number | null;
  /** DRIVERSETTLPARAM.COST_PERCENTAGE (viajes por costo). */
  driverCostPct: number | null;
  /** COMMISSIONSETTINGS.PERCENTAGECOMMISSION del vehiculo (venta). */
  vehicleSalePct: number | null;
  /** COMMISSIONSETTINGS.PERCENTAGECOMMISSION_FOR_COST del vehiculo (costo). */
  vehicleCostPct: number | null;
  /** COMMISSIONSETTINGS.PERCENTAGECOMMISSIONPAYEE. */
  payee: string | null;
};

/**
 * Porcentajes esperados (fracciones) desde la configuracion. Lanza si la configuracion no permite
 * derivarlos (pagador distinto de AGENCY o valores ausentes): es un error de datos, no de negocio.
 */
export function expectedCommissionPcts(byCost: boolean, cfg: CommissionConfig): CommissionPcts {
  if (cfg.payee !== 'AGENCY') {
    throw new Error(
      `[commission-base] pagador de la comision del vehiculo = ${String(cfg.payee)}: solo se deriva con AGENCY`
    );
  }
  const driverPct = byCost ? cfg.driverCostPct : cfg.driverSalePct;
  const agencyPct = byCost ? cfg.vehicleCostPct : cfg.vehicleSalePct;
  if (driverPct === null || agencyPct === null) {
    throw new Error(
      `[commission-base] configuracion de comision incompleta (${byCost ? 'costo' : 'venta'}): ` +
        `chofer ${String(driverPct)}, vehiculo ${String(agencyPct)}`
    );
  }
  const driver = round4(driverPct / 100);
  const agency = round4(agencyPct / 100);
  return { driver, agency, owner: round4(1 - driver - agency) };
}

/** Campos del detalle del viaje (API) que usa el oraculo. */
export type CommissionDetail = {
  amountCost: number | null;
  tourPriceCost: number | null;
  waitTotalPriceCost: number | null;
  otherCostPriceCost: number | null;
  otherCostNoCom: number | null;
  otherCostPriceCostNoCom: number | null;
};

/** Columnas de FINALPRICEI / PRICEADDITIONAL (DB). */
export type CommissionDbPrice = {
  FINAL_COST_PRICE: number | null;
  TOTALCOSTPARTIAL_COST: number | null;
  WAIT_TOTAL_PRICE_COST: number | null;
  OTHER_COST_TOTAL_PRICE_COST: number | null;
  OTHER_COST_TOTAL_NOCOM: number | null;
  OTHER_COST_PRICE_COST_NOCOM: number | null;
};

/** TRAVEL.*_COMMISSION_PCT guardados al cerrar (fracciones). */
export type CommissionTravelPcts = {
  DRIVER_COMMISSION_PCT: number | null;
  OWNER_COMMISSION_PCT: number | null;
  AGENCY_COMMISSION_PCT: number | null;
};

/** Fila del viaje en GET toSurrend (misma respuesta que pinta la pantalla). */
export type CommissionPreviewRow = {
  travelId?: number;
  driverCommissionPct?: number | null;
  driverCommissionAmount?: number | null;
  ownerCommissionPct?: number | null;
  ownerCommissionAmount?: number | null;
  agencyCommissionPct?: number | null;
  agencyCommissionAmount?: number | null;
};

/** Estado de rendicion del viaje (DB) y POST observados. */
export type SurrenderSideEffects = {
  before: { travelsSurrenderId: number | null; surrendered: number | null };
  after: { travelsSurrenderId: number | null; surrendered: number | null };
  /** POST a toTravelsSurrender observados al abrir la vista previa por UI. */
  surrenderPosts: number;
};

export type CommissionBaseInput = {
  /** Etiqueta de fila/viaje para los mensajes. */
  label: string;
  /** Costo de la tarifa leido ANTES de cerrar (`simulationPrice.pricePointToPointCost`). */
  quotedTourCost: number;
  /** Espera de costo esperada (0 si el escenario no genera espera). */
  expectedWaitCost: number;
  /** Suma del COSTO de los otros costos comisionables agregados. */
  commissionableCost: number;
  /** Suma del COSTO de los otros costos NO comisionables agregados. */
  nonCommissionableCost: number;
  /** Suma de la VENTA de los otros costos no comisionables agregados (campo otherCostNoCom). */
  nonCommissionableSale: number;
  /** Porcentajes esperados desde la configuracion (`expectedCommissionPcts`). */
  expectedPcts: CommissionPcts;
  detail: CommissionDetail;
  db: CommissionDbPrice;
  travelPcts: CommissionTravelPcts;
  preview: CommissionPreviewRow;
  sideEffects: SurrenderSideEffects;
};

/** Valores medidos para la medicion JSON, pase o falle. */
export type CommissionBaseMeasured = {
  expectedFinalCostPrice: number;
  wrongBaseFinalCostPrice: number;
  expectedDriverCommission: number;
  expectedOwnerCommission: number;
  wrongBaseDriverCommission: number;
  wrongBaseOwnerCommission: number;
};

export type CommissionBaseVerdict = OracleVerdict & {
  measured: CommissionBaseMeasured;
  /** Mensaje listo para `expect(ok, message)`. */
  message: string;
};

/** Registra una diferencia si `actual` (null = ausente) no esta dentro de la tolerancia de `expected`. */
function checkNear(
  out: Mismatch[],
  field: string,
  actual: number | null | undefined,
  expected: number
): void {
  if (
    actual === null ||
    actual === undefined ||
    !Number.isFinite(actual) ||
    !near(actual, expected)
  ) {
    out.push({ field, expected, actual: actual ?? null });
  }
}

/**
 * Evalua E1..E6 del plan PK-B §3.1. El oraculo es el AC original (los no comisionables NO entran a la
 * base): no se acomoda a la decision diferida D-17/10.
 */
export function evaluateCommissionBase(input: CommissionBaseInput): CommissionBaseVerdict {
  const { detail, db, travelPcts, preview, sideEffects, expectedPcts: pct } = input;
  const errors: Mismatch[] = [];

  const expectedFinalCostPrice =
    input.quotedTourCost + input.expectedWaitCost + input.commissionableCost;
  const wrongBase = expectedFinalCostPrice + input.nonCommissionableCost;

  // E1 - base de comision = tarifa + espera + comisionables (API y DB deben coincidir).
  checkNear(
    errors,
    'E1 DB FINALPRICEI.FINAL_COST_PRICE',
    db.FINAL_COST_PRICE,
    expectedFinalCostPrice
  );
  checkNear(errors, 'E1 API amountCost', detail.amountCost, expectedFinalCostPrice);
  if (
    db.FINAL_COST_PRICE !== null &&
    detail.amountCost !== null &&
    !near(db.FINAL_COST_PRICE, detail.amountCost)
  ) {
    errors.push({
      field: 'E1 API amountCost vs DB FINAL_COST_PRICE',
      expected: db.FINAL_COST_PRICE,
      actual: detail.amountCost
    });
  }

  // E2 - no vacuo: hay costo, hay comisionable y, si el caso lo pide, hay no comisionable que podria colarse.
  if (!(expectedFinalCostPrice > 0)) {
    errors.push({ field: 'E2 base esperada', expected: '> 0', actual: expectedFinalCostPrice });
  }
  if (input.nonCommissionableCost > 0) {
    if (!(input.commissionableCost > 0)) {
      errors.push({
        field: 'E2 otros costos comisionables (costo)',
        expected: '> 0',
        actual: input.commissionableCost
      });
    }
    if (db.FINAL_COST_PRICE !== null && near(db.FINAL_COST_PRICE, wrongBase)) {
      errors.push({
        field: 'E2 FINAL_COST_PRICE no debe sumar el costo no comisionable',
        expected: `distinto de ${wrongBase}`,
        actual: db.FINAL_COST_PRICE
      });
    }
  }

  // E3 - componentes segregados.
  checkNear(errors, 'E3 API tourPriceCost', detail.tourPriceCost, input.quotedTourCost);
  checkNear(errors, 'E3 API waitTotalPriceCost', detail.waitTotalPriceCost, input.expectedWaitCost);
  checkNear(
    errors,
    'E3 API otherCostPriceCost',
    detail.otherCostPriceCost,
    input.commissionableCost
  );
  checkNear(
    errors,
    'E3 API otherCostPriceCostNoCom',
    detail.otherCostPriceCostNoCom,
    input.nonCommissionableCost
  );
  checkNear(errors, 'E3 API otherCostNoCom', detail.otherCostNoCom, input.nonCommissionableSale);
  checkNear(errors, 'E3 DB TOTALCOSTPARTIAL_COST', db.TOTALCOSTPARTIAL_COST, input.quotedTourCost);
  checkNear(
    errors,
    'E3 DB WAIT_TOTAL_PRICE_COST',
    db.WAIT_TOTAL_PRICE_COST,
    input.expectedWaitCost
  );
  checkNear(
    errors,
    'E3 DB OTHER_COST_TOTAL_PRICE_COST',
    db.OTHER_COST_TOTAL_PRICE_COST,
    input.commissionableCost
  );
  checkNear(
    errors,
    'E3 DB OTHER_COST_PRICE_COST_NOCOM',
    db.OTHER_COST_PRICE_COST_NOCOM,
    input.nonCommissionableCost
  );
  checkNear(
    errors,
    'E3 DB OTHER_COST_TOTAL_NOCOM',
    db.OTHER_COST_TOTAL_NOCOM,
    input.nonCommissionableSale
  );

  // E4 - porcentajes: de la configuracion, guardados en el viaje y expuestos por la vista previa; ambos > 0.
  if (!(pct.driver > 0))
    errors.push({ field: 'E4 pct chofer esperado', expected: '> 0', actual: pct.driver });
  if (!(pct.owner > 0))
    errors.push({ field: 'E4 pct dueno esperado', expected: '> 0', actual: pct.owner });
  checkNear(
    errors,
    'E4 TRAVEL.DRIVER_COMMISSION_PCT',
    travelPcts.DRIVER_COMMISSION_PCT,
    pct.driver
  );
  checkNear(errors, 'E4 TRAVEL.OWNER_COMMISSION_PCT', travelPcts.OWNER_COMMISSION_PCT, pct.owner);
  checkNear(
    errors,
    'E4 TRAVEL.AGENCY_COMMISSION_PCT',
    travelPcts.AGENCY_COMMISSION_PCT,
    pct.agency
  );
  checkNear(errors, 'E4 vista previa driverCommissionPct', preview.driverCommissionPct, pct.driver);
  checkNear(errors, 'E4 vista previa ownerCommissionPct', preview.ownerCommissionPct, pct.owner);

  // E5 - comisiones de la vista previa = pct x FINAL_COST_PRICE, y NO pct x (FINAL_COST_PRICE + no comisionable).
  const base = db.FINAL_COST_PRICE ?? expectedFinalCostPrice;
  const expectedDriver = pct.driver * base;
  const expectedOwner = pct.owner * base;
  const wrongDriver = pct.driver * (base + input.nonCommissionableCost);
  const wrongOwner = pct.owner * (base + input.nonCommissionableCost);
  checkNear(
    errors,
    'E5 vista previa driverCommissionAmount',
    preview.driverCommissionAmount,
    expectedDriver
  );
  checkNear(
    errors,
    'E5 vista previa ownerCommissionAmount',
    preview.ownerCommissionAmount,
    expectedOwner
  );
  if (input.nonCommissionableCost > 0) {
    if (
      preview.driverCommissionAmount !== null &&
      preview.driverCommissionAmount !== undefined &&
      near(preview.driverCommissionAmount, wrongDriver)
    ) {
      errors.push({
        field: 'E5 driverCommissionAmount no debe incluir el no comisionable',
        expected: `distinto de ${round4(wrongDriver)}`,
        actual: preview.driverCommissionAmount
      });
    }
    if (
      preview.ownerCommissionAmount !== null &&
      preview.ownerCommissionAmount !== undefined &&
      near(preview.ownerCommissionAmount, wrongOwner)
    ) {
      errors.push({
        field: 'E5 ownerCommissionAmount no debe incluir el no comisionable',
        expected: `distinto de ${round4(wrongOwner)}`,
        actual: preview.ownerCommissionAmount
      });
    }
  }

  // E6 - la vista previa no genera rendicion: ni antes ni despues, y ningun POST.
  for (const phase of ['before', 'after'] as const) {
    const s = sideEffects[phase];
    if (s.travelsSurrenderId !== null) {
      errors.push({
        field: `E6 TRAVEL.TRAVELSSURRENDER_ID (${phase})`,
        expected: null,
        actual: s.travelsSurrenderId
      });
    }
    if (num(s.surrendered) !== 0) {
      errors.push({
        field: `E6 TRAVEL.SURRENDERED (${phase})`,
        expected: 0,
        actual: s.surrendered
      });
    }
  }
  if (sideEffects.surrenderPosts !== 0) {
    errors.push({
      field: 'E6 POST toTravelsSurrender durante la vista previa',
      expected: 0,
      actual: sideEffects.surrenderPosts
    });
  }

  return {
    ok: errors.length === 0,
    mismatches: errors,
    measured: {
      expectedFinalCostPrice,
      wrongBaseFinalCostPrice: wrongBase,
      expectedDriverCommission: round4(expectedDriver),
      expectedOwnerCommission: round4(expectedOwner),
      wrongBaseDriverCommission: round4(wrongDriver),
      wrongBaseOwnerCommission: round4(wrongOwner)
    },
    message: formatMismatches(`[${input.label}] base de comision`, errors)
  };
}
