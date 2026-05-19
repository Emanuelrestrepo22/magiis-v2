// tests/specs/explore/sprint5-6-discovery.spec.ts
// Discovery one-shot para extraer DOM de Sprint 5+6 pages que fallan.
import { test, expect } from '../../TestBase.js';

const TARGETS = [
  { mx: 'MX-5553', url: '/carrier/#/reports/segments-travels' },
  { mx: 'MX-5647 Contractor', url: '/carrier/#/liquidations/contractors/list' },
  { mx: 'MX-5647 Passenger', url: '/carrier/#/liquidations/passenger/list' },
  { mx: 'MX-5647 Driver', url: '/carrier/#/liquidations/drivers/list' },
  { mx: 'MX-5647 Owner', url: '/carrier/#/liquidations/owners/list' }
];

test.describe('@explore Sprint 5+6 DOM discovery', () => {
  test('dumpea headings reales de las 5 pantallas que fallaron', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of TARGETS) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null);

      const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
      const headings = await page.getByRole('heading').evaluateAll((els) =>
        els.slice(0, 5).map((e) => ({
          level: e.tagName,
          text: e.textContent?.trim().slice(0, 80)
        }))
      );

      // eslint-disable-next-line no-console
      console.log(`\n=== ${target.mx} (target ${target.url}, final ${finalUrl}) ===`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(headings, null, 2));
    }

    expect(true).toBe(true);
  });
});
