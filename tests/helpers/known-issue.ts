// tests/helpers/known-issue.ts
// Defecto conocido de un Test de MG-1132 (D3 del plan): el test afirma la AC correcta; si el valor
// medido es el del defecto, registra la annotation `known-issue` y NO lanza. Playwright queda verde y
// el reporter de Xray deja el run FAILED; cuando el defecto se corrige la rama no se ejecuta y el run
// pasa solo a PASSED. Generico: `acceptance.ts#knownIssue` esta atado a ids `AC-FR-*`.
import type { TestInfo } from '@playwright/test';

/** `id` = identificador del hallazgo (ej. «H-AP-01», «F-20»); `note` = medicion concreta, sin secretos. */
export function recordKnownIssue(testInfo: TestInfo, id: string, note: string): void {
  testInfo.annotations.push({ type: 'known-issue', description: `${id}: ${note}` });
}
