// tests/specs/a11y/daily-report-a11y.spec.ts
// Audit WCAG 2.1 AA con axe-core sobre Daily Report. Soft audit (no falla CI).
// NOTA: Daily Report es dashboard de KPIs widgets, no list page. expectListReady() override
// en ReportsDailyPage valida heading + dashboardContainer.
import { test, expect } from '../../fixtures/a11yFixture.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/ReportsDailyPage.js';

const MX = 'MX-5438';
const ROUTE = '/carrier/#/reports/daily';

test.describe('@a11y @P2 @migration MX-5438 Daily Report - audit WCAG 2.1 AA', () => {
  test.describe.configure({ retries: 1 });

  test('A11Y01 axe-core scan loguea violations (soft audit, no falla CI)', async ({
    page,
    scanA11y
  }) => {
    test.info().annotations.push({ type: 'jira', description: MX });
    test.info().annotations.push({ type: 'tc', description: `${MX}-A11Y01` });
    test.info().annotations.push({ type: 'route_v2', description: ROUTE });
    test.info().annotations.push({ type: 'dim', description: 'A11Y' });

    const p = new ReportsDailyPage(page);
    await p.goto();
    await p.expectListReady();

    // Daily Report no usa app-magiis-ranges-date-picker (usa mwlFlatpickr).
    const result = await scanA11y({ exclude: ['.flatpickr-calendar', '.ngx-pagination'] });

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
