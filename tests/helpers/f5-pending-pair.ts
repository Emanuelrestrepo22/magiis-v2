// tests/helpers/f5-pending-pair.ts
// Resolución del par chofer/vehículo pendiente SOLO por API (Daily Clearing › Pending =
// GET driversSurrenderSummary), para UAT donde no hay DB. Puro: recibe las filas de la grilla.
// - Vista previa (solo lectura): si no hay override, elige el par con MENOS viajes (lote más barato de
//   leer) y desempata por ids, de forma determinista.
// - Confirmación (irreversible): NUNCA se infiere; exige `F5_UAT_PAIR=<driverUserId>/<vehicleId>` y el
//   lote del GET debe seguir coincidiendo con F5_CONFIRM_TRIPS (lo valida el spec).
import type { SurrenderSummaryRow } from '../api/clients/surrender.client.js';

export type PendingPair = { driverUserId: number; vehicleId: number; travels: number };

export const F5_UAT_PAIR_ENV = 'F5_UAT_PAIR';

/** `F5_UAT_PAIR=5076/3849` → par; vacío → null; formato inválido lanza. */
export function parsePairOverride(
  raw: string | undefined
): { driverUserId: number; vehicleId: number } | null {
  const text = raw?.trim();
  if (!text) return null;
  const m = /^([1-9]\d*)\s*\/\s*([1-9]\d*)$/.exec(text);
  if (!m)
    throw new Error(`${F5_UAT_PAIR_ENV}="${text}" inválido: formato <driverUserId>/<vehicleId>`);
  return { driverUserId: Number(m[1]), vehicleId: Number(m[2]) };
}

/**
 * Par pendiente a usar. Con override: debe estar en la grilla (si no, null: «sin pendientes para el par»).
 * Sin override: el de menos viajes (> 0). Sin candidatos: null.
 */
export function pickPendingPair(
  rows: readonly SurrenderSummaryRow[],
  override: { driverUserId: number; vehicleId: number } | null = null
): PendingPair | null {
  const pairs: PendingPair[] = rows
    .filter(
      (r) =>
        Number.isInteger(r.driverId) &&
        r.driverId > 0 &&
        Number.isInteger(r.vehicleId) &&
        r.vehicleId > 0
    )
    .map((r) => ({
      driverUserId: r.driverId,
      vehicleId: r.vehicleId,
      travels: typeof r.travelsToSurrender === 'number' ? r.travelsToSurrender : 0
    }));
  if (override) {
    return (
      pairs.find(
        (p) => p.driverUserId === override.driverUserId && p.vehicleId === override.vehicleId
      ) ?? null
    );
  }
  const candidates = pairs.filter(
    (p) => p.travels > 0 || rows.every((r) => r.travelsToSurrender === undefined)
  );
  candidates.sort(
    (a, b) => a.travels - b.travels || a.driverUserId - b.driverUserId || a.vehicleId - b.vehicleId
  );
  return candidates[0] ?? null;
}

/** Unica rendicion nueva entre dos listas de Closed; 0 o >1 nuevas lanza (no se adivina cual es). */
export function newClosedSurrenderId(before: readonly number[], after: readonly number[]): number {
  const fresh = after.filter((id) => !before.includes(id));
  if (fresh.length !== 1) {
    throw new Error(
      `[F5 confirm] se esperaba exactamente 1 rendicion nueva en Daily Clearing > Closed, hay ${fresh.length} (antes ${before.length} ids, despues ${after.length})`
    );
  }
  return fresh[0];
}
