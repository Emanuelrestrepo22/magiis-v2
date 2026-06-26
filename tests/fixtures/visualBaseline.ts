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
 * Resuelve el problema cronico de visual flakiness en specs de reports/listados:
 * antes, el locator era .card completo + mask de tbody/pagination, pero el mask
 * no colapsa el layout - la altura del card seguia cambiando con el contenido.
 *
 * Captura asi solo lo estable: titulo del card, filtros y columnas (thead).
 *
 * Uso:
 *   await captureCardAboveTheFold(visualPage, 'payment-flow.png');
 */
export async function captureCardAboveTheFold(
  page: Page,
  pngName: string,
  options?: { maxDiffPixelRatio?: number }
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
      x: Math.floor(cardBbox.x),
      y: Math.floor(cardBbox.y),
      width: Math.ceil(cardBbox.width),
      height: Math.ceil(theadBbox.y + theadBbox.height - cardBbox.y)
    },
    maxDiffPixelRatio: options?.maxDiffPixelRatio ?? VISUAL_DEFAULTS.maxDiffPixelRatio,
    animations: VISUAL_DEFAULTS.animations,
    caret: VISUAL_DEFAULTS.caret
  });
}
