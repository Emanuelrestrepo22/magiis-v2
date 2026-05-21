// tests/specs/a11y/navbar-shell-a11y.spec.ts
// Audit WCAG 2.1 AA con axe-core sobre Shell (sidebar + topbar). Soft audit (no falla CI).
// El shell se navega sobre /dashboard porque es el unico router-outlet con shell completo
// visible (sidebar + topbar + content). El scan cubre ambos componentes shell + Operations Control.
import { test, expect } from '../../fixtures/a11yFixture.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';

const MX = 'MX-5684';
const ROUTE = '/carrier/#/dashboard';

test.describe('@a11y @P1 @migration MX-5684 Navbar / Shell - audit WCAG 2.1 AA', () => {
  test.describe.configure({ retries: 1 });

  test('A11Y01 axe-core scan loguea violations (soft audit, no falla CI)', async ({
    page,
    scanA11y
  }) => {
    test.info().annotations.push({ type: 'jira', description: MX });
    test.info().annotations.push({ type: 'tc', description: `${MX}-A11Y01` });
    test.info().annotations.push({ type: 'route_v2', description: ROUTE });
    test.info().annotations.push({ type: 'dim', description: 'A11Y' });

    await page.goto(ROUTE);
    const shell = new ShellPage(page);
    await shell.expectShellReady();

    // Scan completo sin exclusions: queremos ver violations del shell global.
    const result = await scanA11y();

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
