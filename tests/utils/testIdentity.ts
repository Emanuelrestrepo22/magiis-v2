// tests/utils/testIdentity.ts
// Prefijos uniformes para datos generados por tests.
// Objetivo: poder identificar y limpiar datos QA en UAT/PROD con queries del tipo `WHERE name LIKE 'qa_e2e_%'`.

const PREFIX = 'qa_e2e_';

/**
 * Devuelve un identificador unico con prefijo de testing.
 * Ejemplo: qa_e2e_1731234567890_a3f
 */
export function makeTestId(suffix?: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 5);
  return `${PREFIX}${ts}_${rand}${suffix ? `_${suffix}` : ''}`;
}

/** Prefijo usado para identificar cualquier dato producido por tests. */
export const TEST_DATA_PREFIX = PREFIX;

/**
 * Asegura que un string llevara el prefijo de testing.
 * Util cuando una factory recibe un nombre opcional del caller.
 */
export function ensurePrefixed(value: string): string {
  return value.startsWith(PREFIX) ? value : `${PREFIX}${value}`;
}
