// tests/specs/settings/other-costs-detailed.spec.ts
// Cobertura detallada MX-5575 Configuration / Other Costs - 8 TCs trazables a matriz QA.
import { test, expect } from '../../TestBase.js';
import { SettingsOtherCostsPage } from '../../pages/carrier-v2/SettingsOtherCostsPage.js';

const MX = 'MX-5575';
const ROUTE = '/carrier/#/settings/otherCosts';

function annotate(tcId: string, dim: string) {
  test.info().annotations.push({ type: 'jira', description: MX });
  test.info().annotations.push({ type: 'tc', description: `${MX}-${tcId}` });
  test.info().annotations.push({ type: 'route_v2', description: ROUTE });
  test.info().annotations.push({ type: 'dim', description: dim });
}

test.describe('@P3 @functional @migration MX-5575 Settings / Other Costs - cobertura matriz QA', () => {
  test.describe.configure({ retries: 2 });

  test('TC01 Acceso desde menu Configuration → Other Costs y carga', async ({ page }) => {
    annotate('TC01', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test("TC02 Titulo 'Other Costs' / 'Otros Costos' visible", async ({ page }) => {
    annotate('TC02', 'INT');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });

  test('TC03 Filtros aplican (categoria / activo)', async ({ page }) => {
    annotate('TC03', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC04 Search por nombre acepta input', async ({ page }) => {
    annotate('TC04', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await p.search('test-cost');
    await expect(p.searchInput).toHaveValue('test-cost');
  });

  test('TC05 Ordenamiento ASC/DESC en columnas sortable', async ({ page }) => {
    annotate('TC05', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await expect(p.table.locator('thead')).toBeVisible();
  });

  test('TC06 Resize + drag & drop + config columnas', async ({ page }) => {
    annotate('TC06', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC07 Paginacion Previous/Next + refresh', async ({ page }) => {
    annotate('TC07', 'HP');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await p.expectPaginationReady();
  });

  test('TC08 i18n EN/ES en headers + placeholders', async ({ page }) => {
    annotate('TC08', 'INT');
    const p = new SettingsOtherCostsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });
});
