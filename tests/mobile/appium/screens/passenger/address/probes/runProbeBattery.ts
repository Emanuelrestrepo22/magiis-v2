/**
 * runProbeBattery — compone las probes de conducta sobre UNA superficie (`AddressFieldTarget`).
 *
 * Alcanzar la pantalla (`reach`) y limpiarla (`cleanup`) los orquesta el spec ANTES/DESPUÉS: el selector se lee
 * después de `reach()`, porque casi todas las superficies resuelven su input dentro de `reach()`.
 *
 * Orden: B1 primero deja la superficie caracterizada y B4 corre después de una consulta válida. Las conductas
 * propias del componente (B7 rotación, B8 degradación 5xx/timeout, B9 sin conexión) no se repiten en todas las
 * superficies a propósito (miden el componente, no la pantalla): solo corren con `includeSingleSurface`.
 * B8 y B9 son evidencia de MECANISMO (ver `types.ts`).
 *
 * Sin `process.env`: el filtro de conductas (`behaviors`) lo resuelve el spec (en V1, `MG116_BEHAVIORS`).
 */

import { installCapture } from './autocompleteCapture.js';
import { runDebounceProbe } from './DebounceProbe.js';
import { runDegradedResponseProbe } from './DegradedResponseProbe.js';
import { runDistinctUntilChangedProbe } from './DistinctUntilChangedProbe.js';
import { runDtoMappingProbe } from './DtoMappingProbe.js';
import { focusField } from './fieldOps.js';
import { MIN_CHARS_TRIP_FLOW, toResult } from './measure.js';
import { runMinLengthProbe } from './MinLengthProbe.js';
import { runOfflineProbe } from './OfflineProbe.js';
import { runOwnEndpointProbe } from './OwnEndpointProbe.js';
import { runSessionTokenProbe } from './SessionTokenProbe.js';
import { runTokenRotationProbe } from './TokenRotationProbe.js';
import type { AddressFieldTarget, BehaviorId, ProbeResult, SurfaceProbeReport } from './types.js';

export const COMMON_BEHAVIORS: readonly BehaviorId[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
export const SINGLE_SURFACE_BEHAVIORS: readonly BehaviorId[] = ['B7', 'B8', 'B9'];

export type ProbeBatteryOptions = {
  /** Solo estas conductas. Una conducta por sesión aísla el SIN_DATOS de la contaminación entre chequeos. */
  behaviors?: readonly BehaviorId[];
  /** Agrega B7, B8 (status + timeout) y B9 a las comunes. */
  includeSingleSurface?: boolean;
  /** Piso esperado de B3 en esta superficie: 3 (alta de viaje) o 4 (Perfil › Mis Direcciones). */
  expectedMinLength?: number;
  settleMs?: number;
};

const NOT_EVALUATED_TITLE = 'no evaluada';

function notEvaluated(behavior: BehaviorId, detail: string): ProbeResult {
  return toResult({ behavior, title: NOT_EVALUATED_TITLE }, { status: 'SIN_DATOS', detail }, {});
}

export async function runProbeBattery(
  target: AddressFieldTarget,
  opts: ProbeBatteryOptions = {}
): Promise<SurfaceProbeReport> {
  const selector = target.fieldSelector();
  const base = { surfaceId: target.id, surfaceLabel: target.label, fieldSelector: selector };
  const wanted = (b: BehaviorId): boolean => !opts.behaviors?.length || opts.behaviors.includes(b);
  const all = opts.includeSingleSurface
    ? [...COMMON_BEHAVIORS, ...SINGLE_SURFACE_BEHAVIORS]
    : COMMON_BEHAVIORS;

  // Un selector vacío no mide nada y `querySelectorAll('')` lanza: se trata como no evaluada, nunca como verde.
  if (!selector.trim()) {
    return {
      ...base,
      results: all
        .filter(wanted)
        .map((b) =>
          notEvaluated(
            b,
            'La superficie no resolvió ningún selector de campo. Es un fallo del harness, NO del producto.'
          )
        )
    };
  }
  if (!(await focusField(target.driver, selector))) {
    return {
      ...base,
      results: [
        notEvaluated(
          'B1',
          `Se llegó a la pantalla pero el selector "${selector}" no encontró un input visible. Revisar el selector antes de concluir nada del producto.`
        )
      ]
    };
  }

  await installCapture(target.driver);
  const common = { settleMs: opts.settleMs };
  const results: ProbeResult[] = [];

  if (wanted('B1')) results.push(await runOwnEndpointProbe(target, common));
  if (wanted('B2')) results.push(await runDebounceProbe(target, common));
  if (wanted('B3')) {
    results.push(
      await runMinLengthProbe(target, {
        ...common,
        expectedFloor: opts.expectedMinLength ?? MIN_CHARS_TRIP_FLOW
      })
    );
  }
  if (wanted('B4')) results.push(await runDistinctUntilChangedProbe(target, common));
  if (wanted('B5')) results.push(await runDtoMappingProbe(target, common));
  if (wanted('B6')) results.push(await runSessionTokenProbe(target, common));

  if (opts.includeSingleSurface) {
    if (wanted('B7')) results.push(await runTokenRotationProbe(target, common));
    if (wanted('B8')) {
      results.push(await runDegradedResponseProbe(target, 'status', common));
      results.push(await runDegradedResponseProbe(target, 'timeout', common));
    }
    if (wanted('B9')) results.push(await runOfflineProbe(target, common));
  }

  return { ...base, results };
}

/** Fila de la matriz de consistencia (conductas comunes × superficie), lista para volcar a markdown. */
export function summarizeMatrix(reports: readonly SurfaceProbeReport[]): string[] {
  const glyph: Record<ProbeResult['status'], string> = {
    PASS: 'PASS',
    FAIL: 'FAIL',
    SIN_DATOS: '—',
    NO_EJERCIDO: 'n/e'
  };
  const lines = [
    `| Superficie | ${COMMON_BEHAVIORS.join(' | ')} |`,
    `|---|${COMMON_BEHAVIORS.map(() => '---').join('|')}|`
  ];
  for (const r of reports) {
    const cells = COMMON_BEHAVIORS.map((b) => {
      const hit = r.results.find((x) => x.behavior === b);
      return hit ? glyph[hit.status] : '—';
    });
    lines.push(`| ${r.surfaceId} ${r.surfaceLabel} | ${cells.join(' | ')} |`);
  }
  return lines;
}
