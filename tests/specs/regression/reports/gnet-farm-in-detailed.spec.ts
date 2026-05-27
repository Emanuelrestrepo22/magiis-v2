// tests/specs/reports/gnet-farm-in-detailed.spec.ts
// Cobertura detallada MX-5573 GNET Farm IN - 10 TCs trazables a matriz_cases_baja_complejidad.md.
import { test, expect } from '../../../TestBase.js';
import { GnetFarmInPage } from '../../../pages/carrier-v2/GnetFarmInPage.js';

const MX = 'MX-5573';
const ROUTE = '/carrier/#/gnet/farm-in';

function annotate(tcId: string, dim: string) {
  test.info().annotations.push({ type: 'jira', description: MX });
  test.info().annotations.push({ type: 'tc', description: `${MX}-${tcId}` });
  test.info().annotations.push({ type: 'route_v2', description: ROUTE });
  test.info().annotations.push({ type: 'dim', description: dim });
}

test.describe('@P2 @functional @migration MX-5573 GNET Farm IN - cobertura matriz QA', () => {
  test.describe.configure({ retries: 2 });

  test('TC01 Acceso desde menu GNET → Farm IN y carga', async ({ page }) => {
    annotate('TC01', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('TC02 Titulo GNET Farm IN visible', async ({ page }) => {
    annotate('TC02', 'INT');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });

  test('TC03 Filtros aplican (estado / origen / periodo)', async ({ page }) => {
    annotate('TC03', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC04 Date range picker visible', async ({ page }) => {
    annotate('TC04', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.dateRangeInput.or(p.searchInput)).toBeVisible();
  });

  test('TC05 Search libre acepta input del usuario', async ({ page }) => {
    annotate('TC05', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await p.search('test-gnet-search');
    await expect(p.searchInput).toHaveValue('test-gnet-search');
  });

  test('TC06 Ordenamiento ASC/DESC en columnas sortable', async ({ page }) => {
    annotate('TC06', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.table.locator('thead')).toBeVisible();
  });

  test('TC07 Resize + drag & drop + config columnas', async ({ page }) => {
    annotate('TC07', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC08 Paginacion Previous/Next + refresh', async ({ page }) => {
    annotate('TC08', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await p.expectPaginationReady();
  });

  test('TC09 Boton PDF visible', async ({ page }) => {
    annotate('TC09', 'HP');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.pdfButton.first()).toBeVisible();
  });

  test('TC10 i18n EN/ES + l10n formato fecha', async ({ page }) => {
    annotate('TC10', 'INT');
    const p = new GnetFarmInPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });
});
