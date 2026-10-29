// tests/helpers/surrender-oracle.ts
// Oraculo del lote de rendicion: la vista previa debe contener EXACTAMENTE los viajes esperados.
// Un viaje ajeno (de otro escenario/lote) hace fallar el spec ANTES de cualquier confirmacion irreversible.

import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

export type BatchRowLike = { travelId?: number | null };

/** Ids de viaje de la vista previa; falla si una fila no trae travelId. */
export function previewTravelIds(previewRows: readonly BatchRowLike[]): number[] {
  return previewRows.map((row, index) => {
    if (typeof row.travelId !== 'number' || !Number.isInteger(row.travelId)) {
      throw new Error(`[surrender-oracle] la fila ${index} de la vista previa no trae travelId`);
    }
    return row.travelId;
  });
}

/** Resultado del oraculo del lote: `foreign`/`missing`/`duplicated` siempre vienen (vacios si ok). */
export type BatchVerdict = OracleVerdict & {
  foreign: number[];
  missing: number[];
  duplicated: number[];
  /** Mensaje listo para `expect(ok, message)` en el spec. */
  message: string;
};

/**
 * Evaluador puro (no lanza ni asevera): compara la vista previa con el conjunto esperado. El mensaje
 * nombra primero los viajes AJENOS (presentes y no esperados), luego los faltantes y los duplicados.
 * Un lote esperado vacio o una fila sin travelId entero tambien son diferencias (oraculo no vacuo).
 */
export function evaluateBatchExactly(
  previewRows: readonly BatchRowLike[],
  expectedTravelIds: readonly number[]
): BatchVerdict {
  const mismatches: Mismatch[] = [];
  const actual: number[] = [];
  previewRows.forEach((row, index) => {
    if (typeof row.travelId !== 'number' || !Number.isInteger(row.travelId)) {
      mismatches.push({
        field: `fila ${index} de la vista previa: travelId`,
        expected: 'entero',
        actual: row.travelId ?? null
      });
    } else actual.push(row.travelId);
  });
  const expected = new Set(expectedTravelIds);
  if (expected.size === 0) {
    mismatches.push({
      field: 'expectedTravelIds',
      expected: 'al menos un viaje (lote a validar)',
      actual: 'vacio'
    });
  }
  const seen = new Set<number>();
  const duplicated = new Set<number>();
  for (const id of actual) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }
  const foreign = [...seen].filter((id) => !expected.has(id));
  const missing = [...expected].filter((id) => !seen.has(id));
  if (foreign.length > 0) {
    mismatches.push({ field: 'viajes AJENOS en el lote', expected: [], actual: foreign });
  }
  if (missing.length > 0) {
    mismatches.push({ field: 'viajes esperados ausentes', expected: missing, actual: [] });
  }
  if (duplicated.size > 0) {
    mismatches.push({
      field: 'viajes duplicados',
      expected: 'cada viaje una vez',
      actual: [...duplicated]
    });
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    foreign,
    missing,
    duplicated: [...duplicated],
    message: formatMismatches('[surrender-oracle] lote distinto del esperado', mismatches)
  };
}
