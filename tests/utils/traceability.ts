// tests/utils/traceability.ts
// Helper de trazabilidad CANÓNICO del portafolio QA MAGIIS (contrato de consistencia).
//
// Contrato (alineado con el HUB agentic-qa-boilerplate y el xray-reporter):
//   - type:'tms' → key del Test de Xray/Jira (MG-XXXX). Es la que consume el reporter.
//   - type:'tc'  → subcaso 1:1 con la matriz QA (MG-XXXX-TCNN).
//   - type:'route_v2' / 'dim' → metadatos opcionales de dimensión/ruta.
//
// Reemplaza los `function annotate()` locales duplicados en cada spec.
//
// Uso (import relativo con .js explicito — el alias @utils/* no resuelve en runtime, ver
// docs/architecture/CONVENTIONS.md §2):
//   import { makeAnnotate } from '../../utils/traceability.js';
//   const annotate = makeAnnotate('TM-501', '/carrier/#/travel/create');
//   test('TC01 ...', async ({ page }) => { annotate('TC01', 'HP'); ... });

import { test } from '@playwright/test';

export type AnnotateFn = (tc: string, dim?: string) => void;

/**
 * Key de Xray con ACs propios (annotation `tms_acs`): el reporter acredita esa key segun SOLO esos
 * AC-FR (FAILED si alguno fallo o es known-issue, PASSED si los ejecutados pasaron, TODO si ninguno
 * se ejecuto). Sin `acs`, la key toma el estado del test completo.
 */
export interface KeyTarget {
  key: string;
  acs?: readonly string[];
}

/**
 * Crea un annotador ligado a una o varias keys (MG-XXXX) y una ruta opcional del spec.
 * Con varias keys un test compuesto acredita cada Test de Xray (una annotation `tms` por key).
 * Empuja las annotations del contrato canónico en test.info().
 */
export function makeAnnotate(
  keys: string | KeyTarget | readonly (string | KeyTarget)[],
  route?: string
): AnnotateFn {
  const targets: KeyTarget[] = (Array.isArray(keys) ? keys : [keys]).map((k: string | KeyTarget) =>
    typeof k === 'string' ? { key: k } : k
  );
  return (tc: string, dim?: string) => {
    const a = test.info().annotations;
    for (const { key, acs } of targets) {
      a.push({ type: 'tms', description: key }); // canónico — consumido por xray-reporter
      if (acs && acs.length > 0)
        a.push({ type: 'tms_acs', description: `${key}: ${acs.join(', ')}` });
    }
    a.push({ type: 'tc', description: `${targets[0].key}-${tc}` });
    if (route) a.push({ type: 'route_v2', description: route });
    if (dim) a.push({ type: 'dim', description: dim });
  };
}
