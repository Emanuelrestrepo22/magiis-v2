// tests/specs/explore/sidebar-discovery.spec.ts
// Spec exploratorio (tag @explore, fuera de smoke/regression).
// Itera sobre URLs reales del sidebar y dumpea aria-snapshot del main content.
// Util para extraer selectores estables antes de generar PageObjects.
import { test, expect } from '../../TestBase.js';

const TARGETS = [
  // Release V2.0.2 - URLs candidatas a confirmar (17 sin URL conocida).
  // Trips
  { name: 'MX-5531 travel-unpaid-list (variante 1)', url: '/carrier/#/travel/unpaid-list' },
  { name: 'MX-5531 travel-unpaid-list (variante 2)', url: '/carrier/#/travel/unpaid' },
  { name: 'MX-5553 segment-travels (variante 1)', url: '/carrier/#/travel/segments' },
  { name: 'MX-5553 segment-travels (variante 2)', url: '/carrier/#/travel/segments/list' },
  { name: 'MX-5438 viajes resumen diario', url: '/carrier/#/reports/daily' },
  // Reports
  { name: 'MX-5560 reports tips', url: '/carrier/#/reports/tips' },
  { name: 'MX-5561 reports debt aging', url: '/carrier/#/reports/debt-aging' },
  { name: 'MX-5562 reports cash flow / cobros', url: '/carrier/#/reports/cash-flow' },
  { name: 'MX-5564 reports cash closing pending', url: '/carrier/#/reports/cash-closing-pending' },
  { name: 'MX-5565 reports card transactions', url: '/carrier/#/reports/transaction-tracking' },
  { name: 'MX-5566 reports taxes and fees', url: '/carrier/#/reports/taxes-and-fees' },
  { name: 'MX-5568 reports payment flow', url: '/carrier/#/reports/payment-flow' },
  { name: 'MX-5569 reports documentation', url: '/carrier/#/reports/documentation' },
  { name: 'MX-5571 reports agency commissions', url: '/carrier/#/reports/agency-commissions' },
  // GNET
  { name: 'MX-5573 gnet farm in', url: '/carrier/#/gnet/farm-in' },
  { name: 'MX-5574 gnet credit accounts', url: '/carrier/#/gnet/credit-accounts' },
  // Cash closing
  { name: 'MX-5570 cash closing realizados (variante 1)', url: '/carrier/#/cash-closing/list' },
  { name: 'MX-5570 cash closing realizados (variante 2)', url: '/carrier/#/cash-closings/list' },
  // Affiliate
  { name: 'MX-5554 affiliate checking account', url: '/carrier/#/affiliate/checking-account' },
  { name: 'MX-5648 affiliate cc detail', url: '/carrier/#/affiliate/checking-account-detail' },
  { name: 'MX-5646 affiliate liquidation detail', url: '/carrier/#/affiliate/liquidation-detail' },
  { name: 'MX-5647 affiliate liquidations list', url: '/carrier/#/affiliate/liquidations-list' }
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
