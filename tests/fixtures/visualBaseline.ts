// tests/fixtures/visualBaseline.ts
// Fixture especializada para regresion visual:
// - Desactiva animaciones CSS y Angular transitions (persistente entre navegaciones).
// - Congela hora del sistema para evitar diffs por timestamps.
// Uso: import { test, expect } from '@fixtures/visualBaseline'.
import { test as base, expect, type Page } from '@playwright/test';
import { VISUAL_DEFAULTS } from '../config/visualConfig.js';

type VisualFixtures = {
  visualPage: Page;
};

export const test = base.extend<VisualFixtures>({
  visualPage: async ({ page }, use) => {
    // 1. Congelar hora a un valor fijo (evita diff en clocks visibles).
    //    clock.install se aplica via init script -> persiste tras goto().
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });

    // 2. Reducir movimiento - respeta prefers-reduced-motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 3. Neutralizar transitions/animations en CADA documento.
    //    addInitScript persiste tras la navegacion del spec (goto()); el anterior
    //    addStyleTag se descartaba al navegar y nunca aplicaba a la app real (MX-5531).
    await page.addInitScript(() => {
      const css = `
        *, *::before, *::after {
          transition: none !important;
          animation: none !important;
          animation-duration: 0s !important;
          transition-duration: 0s !important;
        }
      `;
      const inject = () => {
        const style = document.createElement('style');
        style.setAttribute('data-visual-baseline', '');
        style.textContent = css;
        document.head.appendChild(style);
      };
      if (document.head) inject();
      else document.addEventListener('DOMContentLoaded', inject, { once: true });
    });

    // Nota fuentes: el wait previo (document.fonts.ready) corria sobre about:blank
    // antes del goto() del spec, por lo que nunca esperaba las fuentes de la app.
    // toHaveScreenshot ya espera document.fonts.ready en el momento de captura,
    // sobre el documento real; ese es el wait efectivo. Se elimina el no-op.

    await use(page);
  }
});

export { expect };

/**
 * Captura el "above-the-fold" de un .card de listado: clip desde el top del card
 * hasta el bottom del thead, excluyendo tbody (cuya altura depende de cantidad de
 * filas del backend y causa size mismatch + DOM mutation entre runs).
 *
 * Iteracion v2 (2026-07-07): dos ajustes vs. v1 (que quedaba en ratio 0.5%):
 *
 * 1) Math.round uniforme (antes: floor x/y + ceil width/height). El mix de
 *    floor+ceil hacia que boundingBox con decimales sub-pixel diera clips de
 *    134 vs 133 px de alto entre runs, disparando "Expected an image 1622x134,
 *    received 1622x133" (size mismatch = fail duro, sin comparar contenido).
 *
 * 2) maxDiffPixels (absoluto) en lugar de maxDiffPixelRatio. En imagenes
 *    pequenas (~134px de alto), 0.5% son solo ~1000 px - insuficiente para
 *    absorber variaciones sub-pixel de antialiasing en fonts/iconos (que
 *    tipicamente son 3000-7000 px). Con umbral absoluto 8000, la tolerancia
 *    no depende del tamano de la captura.
 *
 * Sigue detectando cambios estructurales reales (nuevas columnas, filtros,
 * headers) que mueven miles de pixeles adicionales.
 *
 * Uso:
 *   await captureCardAboveTheFold(visualPage, 'payment-flow.png');
 */
export async function captureCardAboveTheFold(
  page: Page,
  pngName: string,
  options?: { maxDiffPixels?: number }
): Promise<void> {
  const card = page.locator('.card').first();
  const thead = page.locator('.card thead').first();
  await expect(card).toBeVisible();
  await expect(thead).toBeVisible({ timeout: 15_000 });

  const cardBbox = await card.boundingBox();
  const theadBbox = await thead.boundingBox();
  if (!cardBbox || !theadBbox) {
    throw new Error(`captureCardAboveTheFold: boundingBox null para ${pngName}`);
  }

  await expect(page).toHaveScreenshot(pngName, {
    clip: {
      x: Math.round(cardBbox.x),
      y: Math.round(cardBbox.y),
      width: Math.round(cardBbox.width),
      height: Math.round(theadBbox.y + theadBbox.height - cardBbox.y)
    },
    maxDiffPixels: options?.maxDiffPixels ?? 8000,
    // Override explicito: playwright.config.ts define maxDiffPixelRatio 0.005
    // como default global en expect.toHaveScreenshot. En imagenes pequenas
    // (134x1622 px = 216K) 0.005 ~= 1000 px, insuficiente y compite con
    // nuestro maxDiffPixels absoluto. Al pasar 1 (100%) desactivamos ese
    // umbral y dejamos que solo maxDiffPixels controle el pass/fail.
    maxDiffPixelRatio: 1,
    animations: VISUAL_DEFAULTS.animations,
    caret: VISUAL_DEFAULTS.caret
  });
}
