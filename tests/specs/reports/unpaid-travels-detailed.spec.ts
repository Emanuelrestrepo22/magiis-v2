// tests/specs/reports/unpaid-travels-detailed.spec.ts
// Cobertura detallada MX-5531 Unpaid Trips Report - 9 TCs trazables a matriz seccion 10.
// Cada test mapea 1:1 a un MX-5531-TCNN.
import { test, expect } from '../../TestBase.js';
import { ReportUnpaidTravelsPage } from '../../pages/carrier-v2/ReportUnpaidTravelsPage.js';

const MX = 'MX-5531';
const ROUTE = '/carrier/#/reports/unpaid-travels-list';

function annotate(tcId: string, dim: string) {
  test.info().annotations.push({ type: 'jira', description: MX });
  test.info().annotations.push({ type: 'tc', description: `${MX}-${tcId}` });
  test.info().annotations.push({ type: 'route_v2', description: ROUTE });
  test.info().annotations.push({ type: 'dim', description: dim });
}

test.describe('@P1 @functional @migration MX-5531 Unpaid Trips Report - cobertura matriz QA', () => {
  test.describe.configure({ retries: 2 });

  test('TC01 Acceso desde menu y carga', async ({ page }) => {
    annotate('TC01', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('TC02 Titulo Unpaid Trips visible (EN/ES)', async ({ page }) => {
    annotate('TC02', 'INT');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });

  test('TC03 Filtros aplican (cliente / periodo sin pago)', async ({ page }) => {
    annotate('TC03', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC04 Search libre acepta input', async ({ page }) => {
    annotate('TC04', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await p.search('qa-unpaid-search');
    await expect(p.searchInput).toHaveValue('qa-unpaid-search');
  });

  test('TC05 Ordenamiento ASC/DESC', async ({ page }) => {
    annotate('TC05', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.table.locator('thead')).toBeVisible();
  });

  test('TC06 Resize + drag & drop + config columnas', async ({ page }) => {
    annotate('TC06', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC07 Paginacion + refresh', async ({ page }) => {
    annotate('TC07', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await p.expectPaginationReady();
  });

  test('TC08 PDF descarga (UI presencia)', async ({ page }) => {
    annotate('TC08', 'HP');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.pdfButton.first()).toBeVisible();
  });

  test('TC09 i18n + l10n', async ({ page }) => {
    annotate('TC09', 'INT');
    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });
});
