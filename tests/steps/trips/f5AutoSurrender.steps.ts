// tests/steps/trips/f5AutoSurrender.steps.ts
// Lecturas y snapshot de la rendicion AUTOMATICA F5 (W3). Todo SOLO LECTURA salvo lo que hace `OwnerEditPage` (armar/disparar/
// desarmar, con gates separados). Las reglas viven en helpers/f5-auto-oracle.ts y f5-auto-guards.ts; el spec asevera.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OracleDb } from '../../db/OracleDb.js';
import { f5TargetProfile, type F5Target } from '../../config/f5-targets.js';
import {
  prepOwner,
  prepPair,
  type CarrierProfile,
  type PrepOwner,
  type PrepPair
} from '../../config/carrier-profiles.js';
import type { F5AutoExpected, F5AutoRowReading } from '../../helpers/f5-auto-oracle.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type F5AutoContext = {
  target: F5Target;
  profile: CarrierProfile;
  owner: PrepOwner;
  pairKey: string;
  pair: PrepPair;
  /** DRIVER.ID del par (query `driverUserId` de la rendicion). */
  driverId: number;
  vehicleId: number;
  ownerId: number;
  carrierId: number;
  /** Patente de la fila del vehiculo en Owners > Edit. */
  domain: string;
};

/** Contexto del target: perfil (propietario + pares), par PROPIO de QA, patente. Lanza con el dato que falte. */
export function resolveAutoContext(
  target: F5Target,
  env: NodeJS.ProcessEnv = process.env
): F5AutoContext {
  const profile = f5TargetProfile(target, ['prep.owner', 'prep.pairs']);
  const owner = prepOwner(profile);
  const { key, pair } = prepPair(profile, env.F5_AUTO_PAIR?.trim() || target.pairKey);
  if (pair.ownerId !== owner.ownerId) {
    throw new Error(
      `[F5 auto] el par ${key} es del propietario ${pair.ownerId}, la ficha del perfil es ${owner.ownerId}`
    );
  }
  if (!owner.vehicleIds.includes(pair.vehicleId)) {
    throw new Error(
      `[F5 auto] el vehiculo ${pair.vehicleId} del par ${key} no esta en la ficha ${owner.ownerId} del perfil`
    );
  }
  const domain = env.F5_AUTO_VEHICLE_DOMAIN?.trim() || profile.fixtures.vehicleDomain;
  if (!domain) {
    throw new Error(
      `[F5 auto] sin patente del vehiculo ${pair.vehicleId}: definir F5_AUTO_VEHICLE_DOMAIN (el perfil no la declara)`
    );
  }
  return {
    target,
    profile,
    owner,
    pairKey: key,
    pair,
    driverId: pair.driverId,
    vehicleId: pair.vehicleId,
    ownerId: owner.ownerId,
    carrierId: profile.carrierId,
    domain: domain.toUpperCase()
  };
}

// Nombres de columnas fijos (nunca input): sin interpolacion de datos externos.
const AUTO_ROW_SQL = `SELECT DRIVER_ID, VEHICLEOWNERID, VEHICLE_ID, COLLECTEDPAYEE, TOTALCASH, TOTALCASHOTHERCOST_NOCOM,
  TOTALCASHOTHERCOSTQTY_NOCOM, TOTALOTHERCOST_NOCOM, TOTALCASHOTHERCOST, TOTALCASHTOSURRENDER, COMMISSIONSUM,
  OWNER_TOTALCOMMISSION, AGENCY_TOTALCOMMISSION, AGENCY_NETPAID, SURRENDERED, OPERATIVEDIFFERENCE
  FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;

/** Fila automatica (TEST/DB) + SURRENDERED/OPERATIVEDIFFERENCE para la observacion C2. */
export async function readAutoRowReading(
  db: OracleDb,
  surrenderId: number
): Promise<{
  row: F5AutoRowReading;
  surrendered: number | null;
  operativeDifference: number | null;
}> {
  const rows = await db.query<Record<string, unknown>>(AUTO_ROW_SQL, { surrenderId });
  const r = rows[0];
  if (!r) throw new Error(`[F5 auto] TRAVELSSURRENDER ${surrenderId} no existe`);
  return {
    row: {
      DRIVER_ID: asNum(r.DRIVER_ID),
      VEHICLEOWNERID: asNum(r.VEHICLEOWNERID),
      VEHICLE_ID: asNum(r.VEHICLE_ID),
      COLLECTEDPAYEE:
        r.COLLECTEDPAYEE === null || r.COLLECTEDPAYEE === undefined
          ? null
          : String(r.COLLECTEDPAYEE),
      TOTALCASH: asNum(r.TOTALCASH),
      TOTALCASHOTHERCOST_NOCOM: asNum(r.TOTALCASHOTHERCOST_NOCOM),
      TOTALCASHOTHERCOSTQTY_NOCOM: asNum(r.TOTALCASHOTHERCOSTQTY_NOCOM),
      TOTALOTHERCOST_NOCOM: asNum(r.TOTALOTHERCOST_NOCOM),
      TOTALCASHOTHERCOST: asNum(r.TOTALCASHOTHERCOST),
      TOTALCASHTOSURRENDER: asNum(r.TOTALCASHTOSURRENDER),
      COMMISSIONSUM: asNum(r.COMMISSIONSUM),
      OWNER_TOTALCOMMISSION: asNum(r.OWNER_TOTALCOMMISSION),
      AGENCY_TOTALCOMMISSION: asNum(r.AGENCY_TOTALCOMMISSION),
      AGENCY_NETPAID: asNum(r.AGENCY_NETPAID)
    },
    surrendered: asNum(r.SURRENDERED),
    operativeDifference: asNum(r.OPERATIVEDIFFERENCE)
  };
}

// ───────────────────────────── Snapshot entre fases ─────────────────────────────

/**
 * Estado entre fases (`arm` → `fire` → `verify` → `disarm`). NO guarda la ficha (PII): solo su huella de hashes. Vive en
 * `evidence/<env>/` (gitignored).
 */
export type F5AutoSnapshot = {
  version: 1;
  env: string;
  target: string;
  ownerId: number;
  vehicleId: number;
  createdAt: string;
  /** true = ESTA corrida cambio cashCollector a 1 (solo entonces corresponde desarmar). */
  armedByUs: boolean;
  armedAt?: string;
  firedAt?: string;
  firePutStatus?: number;
  fichaFingerprintBefore: Record<string, string>;
  ficha: { vehicleIds: number[] | null };
  toSettleBefore: number | null;
  ownerBookIdsBefore: number[];
  expected: F5AutoExpected;
  declared: { tripIds: number[] | null; balance: number | null };
};

export const autoSnapshotPath = (env: string, targetId: string): string =>
  `evidence/${env}/f5-auto-snapshot-${targetId}.json`;

export function readAutoSnapshot(path: string): F5AutoSnapshot | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as F5AutoSnapshot;
}

export function writeAutoSnapshot(path: string, snap: F5AutoSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 2), 'utf-8');
}
