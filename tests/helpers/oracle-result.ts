// tests/helpers/oracle-result.ts
// Forma comun del resultado de los evaluadores puros (oraculos): NO lanzan ni aseveran; devuelven
// `ok` + la lista de diferencias y el spec decide con `expect(result.ok, formatMismatches(...)).toBe(true)`.

/** Una diferencia entre lo esperado y lo obtenido, con el campo (columna/regla) que la origina. */
export type Mismatch = { field: string; expected: unknown; actual: unknown };

/** Resultado minimo de un evaluador: `ok` es true si y solo si no hay diferencias. */
export type OracleVerdict = { ok: boolean; mismatches: Mismatch[] };

const show = (v: unknown): string =>
  v === null || v === undefined ? 'NULL' : typeof v === 'string' ? v : JSON.stringify(v);

/** Mensaje legible (el campo y los dos valores) para usar como mensaje del `expect` del spec. */
export function formatMismatches(label: string, mismatches: readonly Mismatch[]): string {
  if (mismatches.length === 0) return `${label}: sin diferencias`;
  const lines = mismatches.map(
    (m) => `${m.field}: obtenido ${show(m.actual)} vs esperado ${show(m.expected)}`
  );
  return `${label}: ${mismatches.length} diferencia(s)\n - ${lines.join('\n - ')}`;
}
