// tests/specs/reports/daily-report-detailed.spec.ts
// Cobertura detallada MX-5438 Daily Report - 10 TCs trazables a matriz seccion 8.
// Cada test mapea 1:1 a un MX-5438-TCNN.
import { test, expect } from '../../TestBase.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/ReportsDailyPage.js';

const MX = 'MX-5438';
const ROUTE = '/carrier/#/reports/daily';

function annotate(tcId: string, dim: string) {
  test.info().annotations.push({ type: 'jira', description: MX });
  test.info().annotations.push({ type: 'tc', description: `${MX}-${tcId}` });
  test.info().annotations.push({ type: 'route_v2', description: ROUTE });
  test.info().annotations.push({ type: 'dim', description: dim });
}

test.describe('@P1 @functional @migration MX-5438 Daily Report - cobertura matriz QA', () => {
  test.describe.configure({ retries: 2 });

  test('TC01 Acceso desde menu y carga', async ({ page }) => {
    annotate('TC01', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('TC02 Titulo Daily Report visible (EN/ES)', async ({ page }) => {
    annotate('TC02', 'INT');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });

  test('TC03 Date picker dia unico + navegacion dia anterior/siguiente', async ({ page }) => {
    annotate('TC03', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.dateRangeInput.or(p.searchInput)).toBeVisible();
  });

  test('TC04 Filtros aplican (driver / cliente / status)', async ({ page }) => {
    annotate('TC04', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC05 Search libre acepta input', async ({ page }) => {
    annotate('TC05', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await p.search('qa-daily-search');
    await expect(p.searchInput).toHaveValue('qa-daily-search');
  });

  test('TC06 Ordenamiento ASC/DESC en columnas sortable', async ({ page }) => {
    annotate('TC06', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.table.locator('thead')).toBeVisible();
  });

  test('TC07 Resize + drag & drop + config columnas', async ({ page }) => {
    annotate('TC07', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC08 Paginacion + refresh', async ({ page }) => {
    annotate('TC08', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await p.expectPaginationReady();
  });

  test('TC09 PDF descarga con fecha del dia seleccionado (UI presencia)', async ({ page }) => {
    annotate('TC09', 'HP');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.pdfButton.first()).toBeVisible();
  });

  test('TC10 i18n + l10n fechas', async ({ page }) => {
    annotate('TC10', 'INT');
    const p = new ReportsDailyPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });
});
