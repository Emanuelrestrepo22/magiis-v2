// tests/specs/a11y/affiliate-checking-account-a11y.spec.ts
// Audit WCAG 2.1 AA con axe-core sobre Affiliate Credit Accounts. Soft audit (no falla CI).
// NOTA: esta pantalla anula heading h2 (bug a11y conocido) - el scan deberia detectar la
// violation 'page-has-heading-one' o similar.
import { test, expect } from '../../fixtures/a11yFixture.js';
import { AffiliateCheckingAccountPage } from '../../pages/carrier-v2/AffiliateCheckingAccountPage.js';

const MX = 'MX-5554';
const ROUTE = '/carrier/#/affiliate/checking-account';

test.describe('@a11y @P1 @migration MX-5554 Affiliate Checking Account - audit WCAG 2.1 AA', () => {
  test.describe.configure({ retries: 1 });

  test('A11Y01 axe-core scan loguea violations (soft audit, no falla CI)', async ({
    page,
    scanA11y
  }) => {
    test.info().annotations.push({ type: 'jira', description: MX });
    test.info().annotations.push({ type: 'tc', description: `${MX}-A11Y01` });
    test.info().annotations.push({ type: 'route_v2', description: ROUTE });
    test.info().annotations.push({ type: 'dim', description: 'A11Y' });
    test.info().annotations.push({
      type: 'note',
      description: 'Bug a11y conocido: heading h2 ausente. El scan deberia detectarlo.'
    });

    const p = new AffiliateCheckingAccountPage(page);
    await p.goto();
    await p.expectListReady();

    const result = await scanA11y({ exclude: ['.ngx-pagination'] });

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
