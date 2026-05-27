// tests/fixtures/a11yFixture.ts
// Fixture de accesibilidad: ejecuta axe-core sobre la pagina y expone helper para asserts.
// Uso: import { test, expect } from '@fixtures/a11yFixture'.
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type A11yFixtures = {
  a11yPage: Page;
  /** Corre axe-core y retorna violations. */
  scanA11y: (options?: {
    include?: string[];
    exclude?: string[];
    tags?: string[];
  }) => Promise<Awaited<ReturnType<AxeBuilder['analyze']>>>;
};

export const test = base.extend<A11yFixtures>({
  a11yPage: async ({ page }, use) => {
    await use(page);
  },

  scanA11y: async ({ page }, use) => {
    const scan = async (
      options: { include?: string[]; exclude?: string[]; tags?: string[] } = {}
    ) => {
      let builder = new AxeBuilder({ page });
      if (options.include) {
        for (const sel of options.include) builder = builder.include(sel);
      }
      if (options.exclude) {
        for (const sel of options.exclude) builder = builder.exclude(sel);
      }
      builder = builder.withTags(options.tags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
      return builder.analyze();
    };
    await use(scan);
  }
});

/**
 * Cuenta nodos con violation agrupados por regla, a partir de un resultado de axe.
 * Util para comparar contra `tests/fixtures/a11y-baseline.json` (FW-011) o para
 * pushear annotations `a11y_violation` consistentes desde un spec.
 *
 * @example
 * const res = await scanA11y();
 * const byRule = countA11yNodesByRule(res); // { 'color-contrast': 12, 'button-name': 4 }
 */
export function countA11yNodesByRule(
  results: Awaited<ReturnType<AxeBuilder['analyze']>>
): Record<string, number> {
  const byRule: Record<string, number> = {};
  for (const v of results.violations) {
    byRule[v.id] = (byRule[v.id] ?? 0) + v.nodes.length;
  }
  return byRule;
}

export { expect };
