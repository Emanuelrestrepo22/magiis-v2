// tests/helpers/xray-evidence.ts
// Evidencia publicable en el run de Xray (evidence-conventions §4). El reporter adjunta al run
// todo `image/png` y usa la anotación `xray_comment` como comentario; un test sin adjunto
// queda retenido como TODO. Sin aserciones: solo registra lo ya medido por el test.
import type { Locator, Page, TestInfo } from '@playwright/test';

export interface XrayEvidenceOptions {
  /** Nombre del adjunto (sin extensión). */
  name: string;
  /** Medición en español con valores concretos: qué control, qué estado, qué texto. */
  comment: string;
  /** Bloque a capturar; si se omite, se captura el viewport. */
  locator?: Locator;
}

/** Adjunta captura PNG y comentario de medición al run del test en curso. */
export async function attachXrayEvidence(
  testInfo: TestInfo,
  page: Page,
  { name, comment, locator }: XrayEvidenceOptions
): Promise<void> {
  const body = await (locator ?? page).screenshot();
  await testInfo.attach(name, { body, contentType: 'image/png' });
  testInfo.annotations.push({ type: 'xray_comment', description: comment });
}
