// tests/specs/explore/sprint8-tables-dom.spec.ts
// Discovery quirurgico: dumpea aria-snapshot de cada tabla padre del Sprint 8
// para entender estructura real (rows con datos vs loading vs empty state vs action buttons).
import { test, expect } from '../../TestBase.js';

const TARGETS = [
  { name: 'Contractor', url: '/carrier/#/liquidations/contractors/list' },
  { name: 'Affiliate CC', url: '/carrier/#/affiliate/checking-account' }
];

test.describe('@explore Sprint 8 tables DOM analysis', () => {
  test('aria-snapshot completo de tablas Sprint 8 (2 representativas)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of TARGETS) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('table').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
      // Esperar a que loading desaparezca si esta presente.
      await page.locator('text=/loading/i').first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => null);

      const tableSnapshot = await page.getByRole('table').first().ariaSnapshot({ timeout: 5_000 }).catch(() => '(no snapshot)');

      // eslint-disable-next-line no-console
      console.log(`\n=== ${target.name} (${target.url}) ===\n${tableSnapshot}\n`);
    }

    expect(true).toBe(true);
  });
});
