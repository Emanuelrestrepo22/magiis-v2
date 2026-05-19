// tests/specs/explore/sidebar-discovery.spec.ts
// Spec exploratorio (tag @explore, fuera de smoke/regression).
// Itera sobre las URLs reales descubiertas del sidebar y dumpea aria-snapshot del main content.
// Util para extraer selectores estables antes de generar PageObjects.
import { test, expect } from '../../TestBase.js';

const LIST_URLS = [
  { name: 'Client list', url: '/carrier/#/client/list' },
  { name: 'Owner list', url: '/carrier/#/owner/list' },
  { name: 'Driver list', url: '/carrier/#/driver/list' },
  { name: 'Vehicle list', url: '/carrier/#/vehicle/list' }
];

test.describe('@explore list pages discovery', () => {
  test('dumpea aria-snapshot de las 4 listas P1 (clients/owners/drivers/vehicles)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of LIST_URLS) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);

      const finalUrl = page.url();
      const snapshot = await page
        .locator('main, .main-content, .page-content, body')
        .first()
        .ariaSnapshot({ timeout: 5_000 })
        .catch((e) => `(snapshot error: ${e.message})`);

      // eslint-disable-next-line no-console
      console.log(`\n=== ${target.name} (target ${target.url}, final ${finalUrl.replace(/^https?:\/\/[^/]+/, '')}) ===\n${snapshot}\n`);
    }

    expect(true).toBe(true);
  });
});
