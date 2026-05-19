// tests/specs/explore/sidebar-discovery.spec.ts
// Spec exploratorio (tag @explore, fuera de smoke/regression).
// Itera sobre URLs reales del sidebar y dumpea aria-snapshot del main content.
// Util para extraer selectores estables antes de generar PageObjects.
import { test, expect } from '../../TestBase.js';

const TARGETS = [
  // Sprint 2 - Trips
  { name: 'New Trip', url: '/carrier/#/travel/create' },
  { name: 'Trip List', url: '/carrier/#/travel/list' },
  { name: 'Trip Detail (sin id)', url: '/carrier/#/travel/detail' },
  { name: 'Trips Dashboard', url: '/carrier/#/travel/dashboard' },
  { name: 'Map Viewer', url: '/carrier/#/map-viewer' },
  // Sprint 3 - Settlements
  { name: 'Owner Liquidations', url: '/carrier/#/liquidations/owners/list' },
  { name: 'Driver Liquidations', url: '/carrier/#/liquidations/drivers/list' }
];

test.describe('@explore screen discovery', () => {
  test('dumpea aria-snapshot de pantallas del backlog Sprint 2-3', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of TARGETS) {
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
