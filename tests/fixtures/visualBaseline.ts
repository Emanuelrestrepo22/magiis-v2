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
 * Captura el "above-the-fold" del `.card` con altura FIJA (150 px).
 *
 * Iteracion v5 (2026-07-08): tras validar que en V2 NO existe `.card-header`
 * de Bootstrap (v4 fallo con "element not found" en 14 specs), volvemos al
 * clip pero con altura HARDCODED en lugar de calculada dinamicamente vs el
 * thead. Razon: `theadBbox` es fundamentalmente inestable en Chromium Linux
 * porque el thead V2 contiene columnas cuyo ancho se ajusta al contenido
 * async del tbody, disparando reflow multi-fila con altura variable entre
 * runs (visto v2/v3: tips-report 183->161, taxes-fees 181->203, +/-22px).
 *
 * Solucion: capturar SIEMPRE los primeros 150 px del card, desde el top
 * (x/y/width dinamicos, height fijo). Cubre toolbar de filtros + primera
 * linea del thead sin depender de bbox calculado. 150 px es suficiente para
 * la mayoria de reports V2 (toolbar ~50-60px + thead ~40-50px).
 *
 * Trade-off aceptado: no capturamos el thead completo si tiene >1 fila. A
 * cambio ganamos estabilidad total: el clip nunca cambia de tamano entre runs.
 *
 * Uso:
 *   await captureCardAboveTheFold(visualPage, 'payment-flow.png');
 */
export async function captureCardAboveTheFold(
  page: Page,
  pngName: string,
  options?: { maxDiffPixels?: number; clipHeight?: number }
): Promise<void> {
  const card = page.locator('.card').first();
  await expect(card).toBeVisible({ timeout: 15_000 });

  const cardBbox = await card.boundingBox();
  if (!cardBbox) {
    throw new Error(`captureCardAboveTheFold: card.boundingBox null para ${pngName}`);
  }

  await expect(page).toHaveScreenshot(pngName, {
    clip: {
      x: Math.round(cardBbox.x),
      y: Math.round(cardBbox.y),
      width: Math.round(cardBbox.width),
      height: options?.clipHeight ?? 150
    },
    maxDiffPixels: options?.maxDiffPixels ?? 8000,
    // Override: playwright.config.ts define maxDiffPixelRatio: 0.005 global.
    // Con imagenes de 1622x150 = 243K px, 0.005 = 1215 px - insuficiente
    // para absorber antialiasing sub-pixel de fonts Linux. maxDiffPixels
    // absoluto (8000) es el criterio real, este override desactiva el ratio.
    maxDiffPixelRatio: 1,
    animations: VISUAL_DEFAULTS.animations,
    caret: VISUAL_DEFAULTS.caret
  });
}
