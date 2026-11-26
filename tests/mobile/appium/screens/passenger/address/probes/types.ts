/**
 * Tipos compartidos de las probes de conducta del autocompletado de direcciones (App PAX, MG-116).
 *
 * Reemplaza al monolito V1 `AddressFieldProbe` (P-41): una probe por conducta, cada una con una función PURA
 * `evaluate…(measurements)` que decide el veredicto y un runner delgado que maneja el campo y recolecta mediciones
 * con la captura de red del WebView de V2 (`core/WebViewNetworkCapture`).
 *
 * DISCIPLINA DE VEREDICTO (heredada de V1, aprendida a golpes en la campaña MG-116):
 *  - Cero requests NUNCA es PASS: es `SIN_DATOS`.
 *  - Un parámetro/condición ausente que impide medir es `NO_EJERCIDO`.
 *  - Una superficie o campo que no responde es `SIN_DATOS` (límite del harness), no un defecto del producto.
 *  - Todo veredicto lleva el valor MEDIDO (`measured`), no solo el binario, para que sea auditable.
 *  - NUNCA se ajusta un valor esperado al comportamiento actual: el oráculo sale del requerimiento/AC (MG-116).
 */

import type { Browser } from 'webdriverio';

export type Verdict = 'PASS' | 'FAIL' | 'SIN_DATOS' | 'NO_EJERCIDO';

export type BehaviorId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9';

/**
 * Nivel de la evidencia.
 *  - `real-ui`: lo medido ocurre por el camino real del usuario (tipeo en el campo, request real).
 *  - `mechanism`: el resultado depende de INYECCIÓN JS de fallas (`WebViewFaultInjection`) o de eventos sintéticos
 *    que no pasan por el teclado real. Es evidencia de MECANISMO: un FAIL NO se reporta como bug sin repro en la UI
 *    real (red real caída / backend real fallando).
 */
export type EvidenceLevel = 'real-ui' | 'mechanism';

/** Resultado de evaluar una conducta. Lo produce cada `evaluate…` (pura). */
export type Evaluation = {
  status: Verdict;
  /** La explicación en una línea: qué se midió y por qué da ese estado. */
  detail: string;
};

export type ProbeResult = Evaluation & {
  behavior: BehaviorId;
  /** Distingue variantes de una misma conducta (B8: `status` | `timeout`). */
  variant?: string;
  title: string;
  level: EvidenceLevel;
  /** `false` cuando `level === 'mechanism'`: un FAIL solo es reportable como bug tras repro con la UI real. */
  reportableAsBug: boolean;
  /** El dato crudo que sostiene el veredicto. Sin esto el resultado no es auditable. */
  measured: Record<string, unknown>;
};

export type SurfaceProbeReport = {
  surfaceId: string;
  surfaceLabel: string;
  fieldSelector: string;
  results: ProbeResult[];
};

/**
 * Contrato mínimo que una superficie (pantalla que monta un campo de dirección) implementa para ser medida.
 *
 * La superficie SOLO sabe llegar a la pantalla, decir cuál es su input y elegir la primera predicción con un tap
 * real. Escribir, vaciar, enfocar y leer el valor son operaciones DOM agnósticas de la pantalla y viven en
 * `fieldOps.ts`, parametrizadas por `driver` + `fieldSelector()`.
 *
 * Llegar a la pantalla (`reach`) y limpiarla (`cleanup`) NO forman parte del contrato de las probes: las orquesta
 * el spec antes y después de `runProbeBattery`, y se re-evalúa `fieldSelector()` después de `reach()`.
 */
export interface AddressFieldTarget {
  /** `S1`, `S7`, … Identifica la fila en la matriz de consistencia. */
  readonly id: string;
  readonly label: string;
  /** Driver de la sesión; el contexto WEBVIEW lo resuelven las funciones de captura. */
  readonly driver: Browser;
  /** Selector CSS del input de dirección (primer elemento visible). Cadena vacía = no resuelto. */
  fieldSelector(): string;
  /**
   * Elige la PRIMERA predicción con un tap NATIVO (el `click()` programático no dispara el handler de Ionic y ya
   * simuló defectos inexistentes en TM-684/TM-687). Devuelve su etiqueta, o `null` si no había ninguna.
   */
  selectFirstPrediction(): Promise<string | null>;
}
