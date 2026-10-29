// tests/helpers/fr-circuit.ts
// Piezas compartidas por los specs FR S3 / S6 (PLAN-E2E-CARRIER-FRANCIA-UAT-2026-10-19). El spec S1
// conserva sus copias locales; aqui vive lo nuevo para no duplicarlo entre S3-prepare, S3-verify y S6.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CheckingAccountClient,
  DriverBookRow,
  OwnerBookRow
} from '../api/clients/checkingAccount.client.js';
import type { TravelDetail } from '../api/clients/travels.client.js';
import {
  getCurrentEnv,
  getFrCircuitConfig,
  isFrGateOpen,
  type FrCircuitConfig
} from '../config/runtime.js';
import { snapshotBook, snapshotClientCc, type CcSnapshot } from './cc-delta.js';

export const DEFAULT_OWNER_ID = 2927;
export const DEFAULT_CARRIER_ID = 1901;
/** Comisiones sobre venta del vehiculo 3765 (datos-1901 lote B): propietario 40, chofer 40, agencia 20. */
export const PCT = { owner: 0.4, driver: 0.4, agency: 0.2 } as const;
export const HANDOFF_PATH = 'evidence/test/fr-s3-handoff.json';

export type FrGateName =
  | 'FR_CIRCUIT_CREATE_TRIP'
  | 'FR_CONFIRM_SURRENDER'
  | 'FR_EDIT_AFTER_SURRENDER'
  | 'FR_TOGGLE_AUTO_SURRENDER';

/** Config FR si ENV=test y todos los gates pedidos estan abiertos; si no, el motivo del skip. */
export function frConfigOrNull(
  label: string,
  gates: readonly FrGateName[]
): { config: FrCircuitConfig | null; reason: string } {
  if (getCurrentEnv() !== 'test')
    return { config: null, reason: `${label} corre solo con ENV=test` };
  for (const gate of gates) {
    if (!isFrGateOpen(gate)) return { config: null, reason: `requiere ${gate}=1` };
  }
  try {
    return { config: getFrCircuitConfig(), reason: '' };
  } catch (e) {
    return { config: null, reason: (e as Error).message };
  }
}

export function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} no es un entero positivo`);
  return n;
}

/**
 * Numero de un campo que DEBE existir en el detalle (peaje/estacionamiento/espera). Lanza si falta, para
 * que un nombre equivocado no deje la base de comision «correcta» por vacuidad (0). Error de
 * configuracion, no regla de negocio.
 */
export function requireNumberField(detail: TravelDetail, field: string): number {
  if (!(field in detail)) {
    throw new Error(
      `campo ${field} ausente en TravelDetail: confirmar nombre en FR_FACTS.detailFields`
    );
  }
  const v = detail[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export type FrBooksSnapshot = {
  driver: CcSnapshot;
  owner: CcSnapshot;
  /** CC del contractor (Luis), balance en convencion DB. */
  client: CcSnapshot;
  driverRows: number;
  ownerRows: number;
};

/** Fotos de los tres libros (chofer DRIVER.ID, propietario, CC del cliente). Solo lectura. */
export async function readBooks(
  api: CheckingAccountClient,
  cfg: FrCircuitConfig,
  ownerId: number
): Promise<FrBooksSnapshot> {
  const driver = await api.driverMovements({ driverUserId: cfg.driverId });
  const owner = await api.ownerMovements({ ownerId });
  const client = await api.page({ checkingAccountId: cfg.ccId, size: 200, sort: 'DESC' });
  const clientRows = client.content ?? [];
  return {
    driver: snapshotBook(driver.rows, driver.balance),
    owner: snapshotBook(owner.rows, owner.balance),
    client: snapshotClientCc(clientRows, clientRows[0]?.balance ?? null),
    driverRows: driver.rows.length,
    ownerRows: owner.rows.length
  };
}

export type BookRows = Array<DriverBookRow | OwnerBookRow>;

export type FrS3Handoff = {
  travelId: number;
  simulated: number;
  booksBefore: FrBooksSnapshot;
  createdAt: string;
  /** true solo tras asignar al chofer; el spec verify exige true. */
  assigned: boolean;
  driverId: number;
  vehicleId: number;
  ownerId: number;
};

export function writeHandoff(data: FrS3Handoff): void {
  mkdirSync(dirname(HANDOFF_PATH), { recursive: true });
  writeFileSync(HANDOFF_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function readHandoff(): FrS3Handoff {
  let raw: string;
  try {
    raw = readFileSync(HANDOFF_PATH, 'utf-8');
  } catch {
    throw new Error(
      `[fr-s3] no existe ${HANDOFF_PATH}: correr primero fr-circuit-s3-prepare.spec.ts`
    );
  }
  const data = JSON.parse(raw) as Partial<FrS3Handoff>;
  if (
    !Number.isInteger(data.travelId) ||
    typeof data.simulated !== 'number' ||
    !data.booksBefore ||
    data.assigned !== true
  ) {
    throw new Error(
      `[fr-s3] ${HANDOFF_PATH} incompleto (travelId/simulated/booksBefore/assigned=true requeridos): el prepare no termino la asignacion`
    );
  }
  return data as FrS3Handoff;
}
