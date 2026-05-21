// tests/specs/a11y/gnet-credit-accounts-a11y.spec.ts
// Audit WCAG 2.1 AA con axe-core sobre GNET Credit Accounts. Soft audit (no falla CI).
import { test, expect } from '../../fixtures/a11yFixture.js';
import { GnetCreditAccountsPage } from '../../pages/carrier-v2/GnetCreditAccountsPage.js';

const MX = 'MX-5574';
const ROUTE = '/carrier/#/gnet/credit-accounts';

test.describe('@a11y @P2 @migration MX-5574 GNET Credit Accounts - audit WCAG 2.1 AA', () => {
  test.describe.configure({ retries: 1 });

  test('A11Y01 axe-core scan loguea violations (soft audit, no falla CI)', async ({
    page,
    scanA11y
  }) => {
    test.info().annotations.push({ type: 'jira', description: MX });
    test.info().annotations.push({ type: 'tc', description: `${MX}-A11Y01` });
    test.info().annotations.push({ type: 'route_v2', description: ROUTE });
    test.info().annotations.push({ type: 'dim', description: 'A11Y' });

    const p = new GnetCreditAccountsPage(page);
    await p.goto();
    await p.expectListReady();

    const result = await scanA11y({
      exclude: ['app-magiis-ranges-date-picker', '.ngx-pagination']
    });

    for (const v of result.violations) {
      const msg = `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`;
      test.info().annotations.push({ type: 'a11y_violation', description: msg });

      console.warn(`A11Y >>> ${msg}`);
    }
    test.info().annotations.push({
      type: 'a11y_summary',
      description:
        `Total: ${result.violations.length} | ` +
        `Critical: ${result.violations.filter((v) => v.impact === 'critical').length} | ` +
        `Serious: ${result.violations.filter((v) => v.impact === 'serious').length}`
    });

    expect(result).toBeDefined();
  });
});
