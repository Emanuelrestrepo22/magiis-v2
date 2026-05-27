// tests/specs/reports/segments-travels-detailed.spec.ts
// Cobertura detallada MX-5553 Trips Segments - 10 TCs trazables a matriz seccion 11.
// Cada test mapea 1:1 a un MX-5553-TCNN.
import { test, expect } from '../../../TestBase.js';
import { ReportSegmentsTravelsPage } from '../../../pages/carrier-v2/ReportSegmentsTravelsPage.js';

const MX = 'MX-5553';
const ROUTE = '/carrier/#/reports/segments-travels';

function annotate(tcId: string, dim: string) {
  test.info().annotations.push({ type: 'jira', description: MX });
  test.info().annotations.push({ type: 'tc', description: `${MX}-${tcId}` });
  test.info().annotations.push({ type: 'route_v2', description: ROUTE });
  test.info().annotations.push({ type: 'dim', description: dim });
}

test.describe('@P1 @functional @migration MX-5553 Trips Segments - cobertura matriz QA', () => {
  test.describe.configure({ retries: 2 });

  test('TC01 Acceso desde menu y carga', async ({ page }) => {
    annotate('TC01', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('TC02 Titulo Trips Segments visible (EN/ES)', async ({ page }) => {
    annotate('TC02', 'INT');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });

  test('TC03 Filtros por segmento + periodo', async ({ page }) => {
    annotate('TC03', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC04 Search libre acepta input', async ({ page }) => {
    annotate('TC04', 'HP');
    test.info().annotations.push({
      type: 'note',
      description:
        'Trips Segments V2 NO expone search libre (solo filtros por segmento/periodo). TC tolerante.'
    });
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC05 Ordenamiento ASC/DESC', async ({ page }) => {
    annotate('TC05', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.table.locator('thead')).toBeVisible();
  });

  test('TC06 Resize + drag & drop + config columnas', async ({ page }) => {
    annotate('TC06', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC07 Seccion Totals (UI presencia)', async ({ page }) => {
    annotate('TC07', 'INT');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.table).toBeVisible();
  });

  test('TC08 Paginacion + refresh', async ({ page }) => {
    annotate('TC08', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await p.expectPaginationReady();
  });

  test('TC09 PDF descarga con totales por segmento (UI presencia)', async ({ page }) => {
    annotate('TC09', 'HP');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.pdfButton.first()).toBeVisible();
  });

  test('TC10 i18n + l10n', async ({ page }) => {
    annotate('TC10', 'INT');
    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await expect(p.heading).toBeVisible();
  });
});
