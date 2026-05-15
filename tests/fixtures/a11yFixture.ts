// tests/fixtures/a11yFixture.ts
// Fixture de accesibilidad: ejecuta axe-core sobre la pagina y expone helper para asserts.
// Uso: import { test, expect } from '@fixtures/a11yFixture'.
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type A11yFixtures = {
  a11yPage: Page;
  /** Corre axe-core y retorna violations. */
  scanA11y: (options?: { include?: string[]; exclude?: string[]; tags?: string[] }) => Promise<
    Awaited<ReturnType<AxeBuilder['analyze']>>
  >;
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

export { expect };
