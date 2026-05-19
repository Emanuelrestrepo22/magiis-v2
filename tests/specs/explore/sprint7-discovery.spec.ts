// tests/specs/explore/sprint7-discovery.spec.ts
// Discovery one-shot para extraer DOM de los 7 reportes Sprint 7 descubiertos
// en el routing oficial release/v2.0.4.
import { test, expect } from '../../TestBase.js';

const TARGETS = [
  { mx: 'sprint7-1', url: '/carrier/#/reports/travels-list', name: 'Travels List Report' },
  { mx: 'sprint7-2', url: '/carrier/#/reports/ranking-drivers', name: 'Ranking Drivers' },
  { mx: 'sprint7-3', url: '/carrier/#/reports/cost-center-report', name: 'Cost Center' },
  { mx: 'sprint7-4', url: '/carrier/#/reports/corporate-services-type', name: 'Corporate Services Type' },
  { mx: 'sprint7-5', url: '/carrier/#/reports/individual-ca-travels', name: 'Individual CA Travels' },
  { mx: 'sprint7-6', url: '/carrier/#/reports/ranking-clients', name: 'Ranking Clients' },
  { mx: 'sprint7-7', url: '/carrier/#/reports/ranking-vehicles', name: 'Ranking Vehicles' }
];

test.describe('@explore Sprint 7 DOM discovery (7 reportes adicionales release/v2.0.4)', () => {
  test('dumpea headings reales de los 7 reportes para extraer regex de POMs', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of TARGETS) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null);

      const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
      const headings = await page.getByRole('heading').evaluateAll((els) =>
        els.slice(0, 5).map((e) => ({
          level: e.tagName,
          text: e.textContent?.trim().slice(0, 100)
        }))
      );

      // eslint-disable-next-line no-console
      console.log(`\n=== ${target.name} (target ${target.url}, final ${finalUrl}) ===`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(headings, null, 2));
    }

    expect(true).toBe(true);
  });
});
