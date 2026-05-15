// tests/fixtures/visualBaseline.ts
// Fixture especializada para regresion visual:
// - Desactiva animaciones CSS y Angular transitions.
// - Congela hora del sistema para evitar diffs por timestamps.
// - Espera fonts.ready antes de capturar.
// Uso: import { test, expect } from '@fixtures/visualBaseline'.
import { test as base, expect, type Page } from '@playwright/test';

type VisualFixtures = {
  visualPage: Page;
};

export const test = base.extend<VisualFixtures>({
  visualPage: async ({ page }, use) => {
    // 1. Congelar hora a un valor fijo (evita diff en clocks visibles).
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });

    // 2. Reducir movimiento - respeta prefers-reduced-motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 3. Inyectar CSS que neutraliza transitions/animations remanentes.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          transition: none !important;
          animation: none !important;
          animation-duration: 0s !important;
          transition-duration: 0s !important;
        }
      `
    });

    // 4. Esperar a que fonts terminen de cargar.
    await page.evaluate(() => document.fonts.ready);

    await use(page);
  }
});

export { expect };
