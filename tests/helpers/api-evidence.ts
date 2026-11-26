// tests/helpers/api-evidence.ts
// Evidencia IMAGEN de un test de API (decision D4 del 19/11/2026: cada run de Xray lleva una imagen).
// `attachXrayEvidence` exige una pagina con la pantalla; en un test de contrato no hay pantalla, asi
// que la medicion (JSON) se dibuja como tabla HTML en una pagina en blanco y se captura. Adjunta
// ademas el JSON redactado y registra el comentario `xray_comment`. Sin aserciones.
import type { Browser, TestInfo } from '@playwright/test';
import { redactSensitiveText } from '../utils/redact.js';

export interface ApiEvidenceOptions {
  /** Nombre del adjunto (sin extension). */
  name: string;
  /** Medicion en español con valores concretos: que endpoint, que se envio, que devolvio. */
  comment: string;
  /** Filas clave -> valor medidas por el test (se redactan antes de dibujarse y adjuntarse). */
  measurement: Record<string, unknown>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Medicion redactada: tokens y claves sensibles tachados, ida y vuelta por JSON. */
export function redactMeasurement(measurement: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactSensitiveText(JSON.stringify(measurement))) as Record<string, unknown>;
}

/** HTML de la tabla de medicion (exportado para la prueba unitaria). */
export function measurementHtml(title: string, measurement: Record<string, unknown>): string {
  const rows = Object.entries(measurement)
    .map(
      ([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(cell(value))}</td></tr>`
    )
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font:14px Segoe UI,Arial,sans-serif;margin:16px;background:#fff;color:#111}' +
    'h1{font-size:16px;margin:0 0 12px}table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top}' +
    'th{background:#f0f0f0;width:28%;white-space:nowrap}td{font-family:Consolas,monospace;word-break:break-all}' +
    `</style></head><body><h1>${escapeHtml(title)}</h1><table>${rows}</table></body></html>`
  );
}

/** Adjunta PNG de la medicion + JSON redactado y el comentario del run. */
export async function attachApiEvidence(
  testInfo: TestInfo,
  browser: Browser,
  { name, comment, measurement }: ApiEvidenceOptions
): Promise<void> {
  const safe = redactMeasurement(measurement);
  const context = await browser.newContext({ viewport: { width: 900, height: 400 } });
  try {
    const page = await context.newPage();
    await page.setContent(measurementHtml(name, safe));
    const body = await page.locator('body').screenshot();
    await testInfo.attach(name, { body, contentType: 'image/png' });
  } finally {
    await context.close();
  }
  await testInfo.attach(`${name}-medicion`, {
    body: JSON.stringify(safe, null, 2),
    contentType: 'application/json'
  });
  testInfo.annotations.push({ type: 'xray_comment', description: comment });
}
