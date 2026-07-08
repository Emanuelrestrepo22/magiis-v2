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
 * Captura solo el `.card-header` de un listado (titulo del reporte + acciones
 * del header). Es la zona MAS ESTABLE de un card Bootstrap/Angular:
 * - Altura fija (~60-80px), NO depende del tbody ni del thead.
 * - No incluye filtros dinamicos ni columnas que ajusten ancho segun datos.
 * - No sufre reflow: es la primera fila renderizada por el component template.
 *
 * Iteracion v4 (2026-07-08): abandonamos el enfoque de "clip hasta el bottom
 * del thead" (v2/v3) porque `theadBbox` es fundamentalmente inestable entre
 * runs de Chromium Linux — cada dispatch tras update_baselines revelaba
 * OTRO spec con size mismatch de 22px (tips-report 183->161, taxes-fees
 * 181->203, etc.). El thead cambia altura porque contiene columnas cuyo
 * ancho se ajusta al contenido async del tbody, disparando reflow multi-fila.
 *
 * Trade-off aceptado: perdemos cobertura visual de filtros y thead. A cambio
 * ganamos estabilidad total. Cambios estructurales del header (renombrado
 * del reporte, nuevos botones export/acciones) siguen siendo detectados.
 *
 * Uso:
 *   await captureCardAboveTheFold(visualPage, 'payment-flow.png');
 */
export async function captureCardAboveTheFold(
  page: Page,
  pngName: string,
  options?: { maxDiffPixels?: number }
): Promise<void> {
  const cardHeader = page.locator('.card > .card-header, .card-header').first();
  await expect(cardHeader).toBeVisible({ timeout: 15_000 });

  await expect(cardHeader).toHaveScreenshot(pngName, {
    maxDiffPixels: options?.maxDiffPixels ?? 5000,
    // Override explicito: playwright.config.ts define maxDiffPixelRatio 0.005
    // como default global. Con el card-header (imagen pequena ~120K px)
    // 0.005 = 600 px, insuficiente para antialiasing de fonts Linux.
    maxDiffPixelRatio: 1,
    animations: VISUAL_DEFAULTS.animations,
    caret: VISUAL_DEFAULTS.caret
  });
}
