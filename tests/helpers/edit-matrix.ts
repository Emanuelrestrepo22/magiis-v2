// tests/helpers/edit-matrix.ts
// Efectos esperados de EDITAR los precios finales de un viaje ya rendido (carrier 1901, no Universal:
// costo = venta). Funcion pura sobre los DELTAS observados del detalle (antes/despues), de modo que el
// oraculo valida la cascada (rendicion, libros, CC) contra lo que el BE realmente aplico a cada campo.
//
// Fuente (magiis-be develop, leida 2026-10-21): TravelService.updateFinalPricesProcess (~L9813-10140) y
// TravelRepositoryImpl.updatePricesInTravelSurrenderForCash / ForCheckingAccount / updatePricesInMovement
// / updatePricesInCheckingAccount. Base comisionable del cambio:
//   c = diffTarifa + diffEspera + diffOtrosComisionables   (peaje, estacionamiento y NO comisionables fuera)
// Supuestos declarados: sin tarifador por costo (RATE_BY_COST = 0), rendicion MANUAL (driverSurrendered),
// costo financiero de chofer/propietario = 0 y porcentajes 40/40/20 del vehiculo 3765.
import { PCT } from './fr-circuit.js';

export type PaymentKind = 'cash' | 'cc';

/** Deltas observados (despues - antes) de cada concepto de venta del viaje. */
export type EditDiffs = {
  fare: number;
  wait: number;
  otherCom: number;
  otherNoCom: number;
  toll: number;
  parking: number;
  /** Delta del precio final (`amount` del detalle). */
  total: number;
};

export type ExpectedRow = { code: 'TCEA' | 'TCES' | 'TDEA' | 'TDES'; amount: number; note: string };

export type ExpectedEditEffects = {
  /** c: base comisionable del cambio. */
  commissionable: number;
  /** peaje + estacionamiento (pass-through: sin comision, pero movimiento "(NC)" del chofer). */
  nonCommissionable: number;
  /** Delta esperado por columna de TRAVELSSURRENDER. */
  surrender: Record<string, number>;
  driverRows: ExpectedRow[];
  ownerRows: ExpectedRow[];
  /** Delta esperado del MOUNT del movimiento TIVR de la CC del cliente; null en efectivo. */
  ccMovementDelta: number | null;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function expectedEditEffects(kind: PaymentKind, d: EditDiffs): ExpectedEditEffects {
  const c = r2(d.fare + d.wait + d.otherCom);
  const nc = r2(d.toll + d.parking);
  const owner = r2(c * PCT.owner);
  const driver = r2(c * PCT.driver);
  const agency = r2(c * PCT.agency);
  const common = {
    TOTALBILLING: c,
    COMMISSIONSUM: driver,
    OWNER_TOTALCOMMISSION: owner,
    AGENCY_TOTALCOMMISSION: agency,
    // Q-NOCOM (PO): el BE no toca TOTALOTHERCOST_NOCOM al editar; delta esperado = lo que el BE hace (0).
    TOTALOTHERCOST_NOCOM: 0
  };
  const surrender: Record<string, number> =
    kind === 'cash'
      ? {
          ...common,
          CASHCOMMISSION: driver,
          OWNER_CASH_COMM: owner,
          AGENCY_CASH_COMM: agency,
          TOTALCASH: c,
          TOTALCASHPARKING: d.parking,
          TOTALCASHROADTOLL: d.toll,
          TOTALCASHOTHERCOST: d.otherCom,
          TOTALCASHTOSURRENDER: d.total,
          SURRENDERDIFFERENCE: r2(nc - d.total)
        }
      : {
          ...common,
          CHECKINGACCOUNTCOMMISSION: driver,
          OWNER_CHECK_ACC_COMM: owner,
          AGENCY_CHECK_ACC_COMM: agency,
          TOTALCHECKINGACCOUNT: c,
          TOTALPARKING: d.parking,
          TOTALROADTOLL: d.toll,
          TOTALOTHERCOST: d.otherCom,
          SURRENDERDIFFERENCE: nc
        };

  const driverRows: ExpectedRow[] = [];
  const ownerRows: ExpectedRow[] = [];
  if (c !== 0) {
    driverRows.push({
      code: c > 0 ? 'TCEA' : 'TCES',
      amount: Math.abs(driver),
      note: 'comision chofer sobre c'
    });
    ownerRows.push({
      code: c > 0 ? 'TDEA' : 'TDES',
      amount: Math.abs(owner),
      note: 'comision propietario sobre c'
    });
  }
  if (nc !== 0) {
    driverRows.push({
      code: nc > 0 ? 'TCEA' : 'TCES',
      amount: Math.abs(nc),
      note: 'peaje/estacionamiento (NC) integro al chofer'
    });
  }
  return {
    commissionable: c,
    nonCommissionable: nc,
    surrender,
    driverRows,
    ownerRows,
    ccMovementDelta: kind === 'cc' ? d.total : null
  };
}
