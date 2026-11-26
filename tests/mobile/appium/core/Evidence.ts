/**
 * Evidence — wrapper de `ScreenEvidence` (checkpoint -> captura) sin cambiar su contrato.
 * La captura se crea de forma perezosa: no toca el driver hasta el primer `capture`.
 * Carpeta: `evidence/<env>/mobile/<runLabel>` (contrato Xray: >=1 PNG adjunto en `finally`).
 */

import path from 'node:path';
import {
  ScreenEvidence,
  type ScreenEvidenceOptions,
  type ScreenshotRef
} from './ScreenEvidence.js';

export type { ScreenshotRef } from './ScreenEvidence.js';

/** Opciones de ubicación de la evidencia (raíz / env / cwd). */
export type EvidenceOptions = ScreenEvidenceOptions;

/** Subconjunto de `ScreenEvidence` que usa el wrapper (permite fakes en unit). */
export type EvidenceCapturer = {
  capture(label: string): Promise<ScreenshotRef>;
  all(): ScreenshotRef[];
  manifest(): string[];
};

/** Subconjunto de `TestInfo.attach` de Playwright (permite fakes en unit). */
export type EvidenceAttacher = {
  attach(name: string, options: { path: string; contentType: string }): Promise<void>;
};

export class Evidence {
  private capturer: EvidenceCapturer | null = null;

  constructor(
    private readonly factory: () => EvidenceCapturer,
    private readonly cwd: string = process.cwd()
  ) {}

  /** Evidencia real sobre un driver (carpeta `evidence/<env>/mobile/<runLabel>`). */
  static forDriver(
    getDriver: () => WebdriverIO.Browser,
    runLabel: string,
    options: EvidenceOptions = {}
  ): Evidence {
    return new Evidence(
      () => new ScreenEvidence(getDriver(), runLabel, options),
      options.cwd ?? process.cwd()
    );
  }

  private get shots(): EvidenceCapturer {
    this.capturer ??= this.factory();
    return this.capturer;
  }

  capture(label: string): Promise<ScreenshotRef> {
    return this.shots.capture(label);
  }

  /** Captura con la etiqueta `checkpoint-<stage>` (convención del flujo F5). */
  checkpoint(stage: string): Promise<ScreenshotRef> {
    return this.shots.capture(`checkpoint-${stage}`);
  }

  all(): ScreenshotRef[] {
    return this.capturer?.all() ?? [];
  }

  /** Rutas relativas en orden, listas para pegar en un reporte. */
  manifest(): string[] {
    return this.capturer?.manifest() ?? [];
  }

  /**
   * Para el `finally` del spec: garantiza >=1 PNG. Si no hubo capturas toma una (`final`); si la captura
   * falla (device caído) no lanza, para no tapar el error original del test. Devuelve las capturas.
   */
  async finalize(fallbackLabel = 'final'): Promise<ScreenshotRef[]> {
    if (this.all().length === 0) {
      try {
        await this.capture(fallbackLabel);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Evidence] finalize: no se pudo capturar (${message}).`);
      }
    }
    return this.all();
  }

  /** `finalize` + adjunta cada PNG al reporte (`testInfo.attach`), listo para el reporter Xray. */
  async attachTo(attacher: EvidenceAttacher, fallbackLabel = 'final'): Promise<ScreenshotRef[]> {
    const shots = await this.finalize(fallbackLabel);
    for (const s of shots) {
      await attacher.attach(s.label, {
        path: path.resolve(this.cwd, s.relPath),
        contentType: 'image/png'
      });
    }
    return shots;
  }
}
