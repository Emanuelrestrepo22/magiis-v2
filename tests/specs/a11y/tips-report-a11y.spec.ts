// tests/specs/a11y/tips-report-a11y.spec.ts
// Piloto del a11y suite Release V2.0.4. Audit WCAG 2.1 AA con axe-core sobre Tips Report.
//
// Approach: SOFT + AUDIT (no falla CI). Loguea violations como annotations en HTML report + junit.
// El objetivo es DESCUBRIR el estado real de accesibilidad en V2 antes de definir threshold strict.
// Despues del primer run, las violations recurrentes que sean genuinas se quedan; los falsos
// positivos se excluyen via options.exclude. Cuando V2 este estable, se convierte a strict.
//
// Trazabilidad: MX-5560-A11Y01 (Tips Report - WCAG 2.1 AA scan).
import { test, expect } from '../../fixtures/a11yFixture.js';
import { ReportsTipsPage } from '../../pages/carrier-v2/ReportsTipsPage.js';

const MX = 'MX-5560';
const ROUTE = '/carrier/#/reports/tips';

test.describe('@a11y @P2 @migration MX-5560 Tips Report - audit WCAG 2.1 AA', () => {
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
      description:
        'Soft audit: scan corre WCAG 2.1 AA, loguea cada violation como annotation. NO falla. ' +
        'Cuando V2 estabilice y se conozca el set de violations reales, se decide convertir a strict.'
    });

    const tips = new ReportsTipsPage(page);
    await tips.goto();
    await tips.expectListReady();

    const result = await scanA11y({
      // Excluir partes del DOM con problemas de a11y conocidos / 3rd party:
      // - .ngx-pagination: componente 3rd party
      // - app-magiis-ranges-date-picker internals: 3rd party
      exclude: ['app-magiis-ranges-date-picker', '.ngx-pagination']
    });

    // Loguear cada violation como annotation para que aparezca en HTML report + junit.
    // Tambien console.warn para visibilidad inmediata en CI logs.
    for (const v of result.violations) {
      const msg = `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`;
      test.info().annotations.push({ type: 'a11y_violation', description: msg });

      console.warn(`A11Y >>> ${msg}`);
    }

    // Soft assertion: pasa siempre, expone el conteo como annotation.
    test.info().annotations.push({
      type: 'a11y_summary',
      description:
        `WCAG 2.1 AA scan completado. Total violations: ${result.violations.length}. ` +
        `Critical: ${result.violations.filter((v) => v.impact === 'critical').length}. ` +
        `Serious: ${result.violations.filter((v) => v.impact === 'serious').length}. ` +
        `Moderate: ${result.violations.filter((v) => v.impact === 'moderate').length}. ` +
        `Minor: ${result.violations.filter((v) => v.impact === 'minor').length}.`
    });

    // El scan se considera exitoso si corrio sin error.
    expect(result, 'scan axe-core ejecutado').toBeDefined();
  });
});
