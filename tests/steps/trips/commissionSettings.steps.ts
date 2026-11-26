// tests/steps/trips/commissionSettings.steps.ts
// Lectura (SOLO SELECT) de la configuracion de comision que el backend aplica a un par vehiculo/chofer:
// COMMISSIONSETTINGS (VEHICLE.CURRENTCOMMISSION_ID) + DRIVERSETTLPARAM (DRIVER.DRIVERSETTPARAM_ID).
// Verificado contra TEST el 2026-10-23 (vehiculo 2625 / chofer 3727: settings 1589, 30 % + 30 fijo AGENCY, chofer 0/0).
// Formula y evidencia: helpers/commission-settings.ts.
import type { OracleDb } from '../../db/OracleDb.js';
import {
  loadCarrierProfile,
  registerCommissionSettings,
  type CarrierProfile
} from '../../config/carrier-profiles.js';
import type { CommissionPayee, CommissionSettings } from '../../helpers/commission-settings.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function asPayee(value: unknown, column: string): CommissionPayee {
  if (value === 'OWNER' || value === 'AGENCY') return value;
  throw new Error(`[commission] ${column} inesperado: ${String(value)} (OWNER | AGENCY)`);
}

/** Configuracion vigente (la que usa el backend al finalizar un viaje) del vehiculo y el chofer. */
export async function readCommissionSettings(
  db: OracleDb,
  ids: { vehicleId: number; driverId: number }
): Promise<CommissionSettings> {
  for (const [label, id] of Object.entries(ids)) {
    if (!Number.isInteger(id) || id <= 0) throw new Error(`[commission] ${label} invalido: ${id}`);
  }
  const rows = await db.query<Record<string, unknown>>(
    `SELECT cs.PERCENTAGECOMMISSION, cs.PERCENTAGECOMMISSION_FOR_COST, cs.PERCENTAGECOMMISSIONPAYEE,
            cs.FIXEDCOMMISSION, cs.FIXEDCOMMISSIONPAYEE, dp.TRAVELPERCENTAGE, dp.COST_PERCENTAGE
     FROM VEHICLE v, COMMISSIONSETTINGS cs, DRIVER d, DRIVERSETTLPARAM dp
     WHERE cs.ID = v.CURRENTCOMMISSION_ID AND dp.ID = d.DRIVERSETTPARAM_ID
       AND v.ID = :vehicleId AND d.ID = :driverId`,
    ids
  );
  if (rows.length !== 1) {
    throw new Error(
      `[commission] vehiculo ${ids.vehicleId} / chofer ${ids.driverId}: ${rows.length} filas de configuracion (se espera 1)`
    );
  }
  const r = rows[0];
  return {
    percentage: Number(r.PERCENTAGECOMMISSION),
    percentageForCost: asNum(r.PERCENTAGECOMMISSION_FOR_COST),
    percentagePayee: asPayee(r.PERCENTAGECOMMISSIONPAYEE, 'PERCENTAGECOMMISSIONPAYEE'),
    fixed: Number(r.FIXEDCOMMISSION),
    fixedPayee: asPayee(r.FIXEDCOMMISSIONPAYEE, 'FIXEDCOMMISSIONPAYEE'),
    driverTravelPct: Number(r.TRAVELPERCENTAGE),
    driverCostPct: asNum(r.COST_PERCENTAGE)
  };
}

/**
 * Resuelve la comision del perfil activo: `fixed` no toca la DB (devuelve null); `db` lee y registra la
 * configuracion para que PCT / COMMISSION_FIXED y los esperados la usen.
 */
export async function ensureCommissionResolved(
  db: OracleDb,
  ids: { vehicleId: number; driverId: number },
  profile: CarrierProfile = loadCarrierProfile()
): Promise<CommissionSettings | null> {
  if (profile.commission.kind === 'fixed') return null;
  const settings = await readCommissionSettings(db, ids);
  registerCommissionSettings(settings);
  return settings;
}
