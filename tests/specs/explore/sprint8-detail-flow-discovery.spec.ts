// tests/specs/explore/sprint8-detail-flow-discovery.spec.ts
// Discovery del flujo padre->hijo Settlements + Affiliate.
// Para cada lista:
//  1. Naveva a la lista.
//  2. Cuenta rows visibles (filtra status "Loading" o "No data").
//  3. Si hay rows: click en primera row + captura URL final.
//  4. Dumpea aria-snapshot del detail.
import { test, expect } from '../../TestBase.js';

const SETTLEMENTS = [
  { name: 'Contractor', listPath: '/carrier/#/liquidations/contractors/list' },
  { name: 'Passenger', listPath: '/carrier/#/liquidations/passenger/list' },
  { name: 'Driver', listPath: '/carrier/#/liquidations/drivers/list' },
  { name: 'Owner', listPath: '/carrier/#/liquidations/owners/list' }
];

const AFFILIATE = [
  { name: 'Affiliate CC', listPath: '/carrier/#/affiliate/checking-account' }
];

test.describe('@explore Sprint 8 detail flow discovery', () => {
  test('Settlements y Affiliate - lista -> click row -> capturar URL detail', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const targets = [...SETTLEMENTS, ...AFFILIATE];

    for (const target of targets) {
      await page.goto(target.listPath, { waitUntil: 'domcontentloaded' });
      await page.getByRole('table').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);

      const rows = page.getByRole('table').first().locator('tbody tr');
      const rowCount = await rows.count();

      // eslint-disable-next-line no-console
      console.log(`\n=== ${target.name} (list ${target.listPath}) — rows visibles: ${rowCount} ===`);

      if (rowCount === 0) {
        // eslint-disable-next-line no-console
        console.log('  -> sin datos en TEST, skip detail flow');
        continue;
      }

      // Click en primera row visible.
      const urlBefore = page.url();
      await rows.first().click({ trial: false });

      // Esperar redirect o cambio de DOM.
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => null);
      await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);

      const urlAfter = page.url().replace(/^https?:\/\/[^/]+/, '');
      const headings = await page.getByRole('heading').evaluateAll((els) =>
        els.slice(0, 3).map((e) => ({ level: e.tagName, text: e.textContent?.trim().slice(0, 80) }))
      );

      // eslint-disable-next-line no-console
      console.log(`  URL antes: ${urlBefore.replace(/^https?:\/\/[^/]+/, '')}`);
      // eslint-disable-next-line no-console
      console.log(`  URL despues: ${urlAfter}`);
      // eslint-disable-next-line no-console
      console.log(`  Headings detail: ${JSON.stringify(headings)}`);
    }

    expect(true).toBe(true);
  });
});
