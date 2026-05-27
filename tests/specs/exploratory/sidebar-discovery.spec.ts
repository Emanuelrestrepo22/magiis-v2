// tests/specs/explore/sidebar-discovery.spec.ts
// Spec exploratorio (tag @explore, fuera de smoke/regression).
// Itera URLs reales del Release V2.0.2 y dumpea aria-snapshot del main content
// para extraer selectores estables antes de generar POMs.
import { test, expect } from '../../TestBase.js';

const RELEASE_V2_0_2_PAGES = [
  // Sprint 2 - P1
  { mx: 'MX-5559', name: 'Map Viewer', url: '/carrier/#/map-viewer' },
  { mx: 'MX-5529', name: 'Listado de Viajes', url: '/carrier/#/travel/dashboard' },
  { mx: 'MX-5572', name: 'Cotizaciones', url: '/carrier/#/travel/quotes' },
  { mx: 'MX-5537', name: 'Viajes Recurrentes', url: '/carrier/#/travel/recurring' },
  { mx: 'MX-5438', name: 'Reporte Resumen Diario', url: '/carrier/#/reports/daily' },
  { mx: 'MX-5554', name: 'CC Con Afiliados', url: '/carrier/#/affiliate/checking-account' },
  { mx: 'MX-5569', name: 'Documentacion Vencida', url: '/carrier/#/reports/documentation' },
  // Sprint 3 - P2
  { mx: 'MX-5560', name: 'Reporte Tips', url: '/carrier/#/reports/tips' },
  { mx: 'MX-5561', name: 'Reporte Debt Aging', url: '/carrier/#/reports/debt-aging' },
  { mx: 'MX-5562', name: 'Reporte Cash Flow', url: '/carrier/#/reports/cash-flow' },
  {
    mx: 'MX-5565',
    name: 'Reporte Card Transactions',
    url: '/carrier/#/reports/transaction-tracking'
  },
  { mx: 'MX-5566', name: 'Reporte Taxes & Fees', url: '/carrier/#/reports/taxes-and-fees' },
  { mx: 'MX-5568', name: 'Reporte Payment Flow', url: '/carrier/#/reports/payment-flow' },
  {
    mx: 'MX-5571',
    name: 'Reporte Agency Commissions',
    url: '/carrier/#/reports/agency-commissions'
  },
  { mx: 'MX-5573', name: 'GNET Farm IN', url: '/carrier/#/gnet/farm-in' },
  { mx: 'MX-5574', name: 'GNET Credit Accounts', url: '/carrier/#/gnet/credit-accounts' },
  // Sprint 4 - P3
  { mx: 'MX-5575', name: 'Settings Other Costs', url: '/carrier/#/settings/otherCosts' }
];

test.describe('@explore release V2.0.2 discovery', () => {
  test('dumpea aria-snapshot de las 17 pantallas confirmadas', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    for (const target of RELEASE_V2_0_2_PAGES) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      await page
        .getByRole('heading')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => null);

      const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
      const snapshot = await page
        .locator('main, .main-content, .page-content, body')
        .first()
        .ariaSnapshot({ timeout: 5_000 })
        .catch((e) => `(snapshot error: ${e.message})`);

      // eslint-disable-next-line no-console
      console.log(
        `\n=== ${target.mx} ${target.name} (target ${target.url}, final ${finalUrl}) ===\n${snapshot}\n`
      );
    }

    expect(true).toBe(true);
  });
});
