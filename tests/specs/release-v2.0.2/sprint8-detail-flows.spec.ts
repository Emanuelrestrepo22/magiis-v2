// tests/specs/release-v2.0.2/sprint8-detail-flows.spec.ts
// Sprint 8 - Settlements + Affiliate detail flows (con :id).
// Patron padre->hijo:
//   1. Llegar a la lista padre (Sprint 6 POMs ya cubren).
//   2. Validar que hay rows (test.skip si lista vacia, comun en TEST con datos sinteticos).
//   3. Click en primera row + captura URL final con :id.
//   4. Validar redirect a detail/history segun corresponda.
//   5. expectDetailReady() sobre el POM detail.
//
// NOTA: Los selectores headingRegex de los POMs detail son TODOs heuristicos hasta poder
// validar el DOM real cuando el backend TEST se restaure (503 al momento de escribir esto).
import { test, expect } from '../../TestBase.js';
import { SettlementsContractorListPage } from '../../pages/carrier-v2/SettlementsContractorListPage.js';
import { SettlementsPassengerListPage } from '../../pages/carrier-v2/SettlementsPassengerListPage.js';
import { SettlementsDriverListPage } from '../../pages/carrier-v2/SettlementsDriverListPage.js';
import { SettlementsOwnerListPage } from '../../pages/carrier-v2/SettlementsOwnerListPage.js';
import { SettlementsContractorDetailPage } from '../../pages/carrier-v2/settlements/SettlementsContractorDetailPage.js';
import { SettlementsPassengerDetailPage } from '../../pages/carrier-v2/settlements/SettlementsPassengerDetailPage.js';
import { SettlementsDriverDetailPage } from '../../pages/carrier-v2/settlements/SettlementsDriverDetailPage.js';
import { SettlementsOwnerDetailPage } from '../../pages/carrier-v2/settlements/SettlementsOwnerDetailPage.js';

test.describe('@P1 @functional @migration Sprint 8 - Settlements detail flows', () => {
  test('MX-5647 Contractor: lista -> click row -> detail con :id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'note',
      description: 'Flujo padre->hijo. Requiere registros en TEST. test.skip si lista vacia.'
    });

    const list = new SettlementsContractorListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Contractor liquidations');

    const { finalUrl, lastSegment } = await list.clickFirstRowAndCaptureUrl();
    expect(finalUrl).toMatch(/\/liquidations\/contractors\/(create|details|last-liquidation|history)\//);
    expect(lastSegment).toBeTruthy();

    const detail = new SettlementsContractorDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Passenger: lista -> click row -> detail con :id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsPassengerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Passenger liquidations');

    const { finalUrl } = await list.clickFirstRowAndCaptureUrl();
    expect(finalUrl).toMatch(/\/liquidations\/passenger\/(create|details|last-liquidation|history)\//);

    const detail = new SettlementsPassengerDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Driver: lista -> click row -> detail con :id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsDriverListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Driver liquidations');

    const { finalUrl } = await list.clickFirstRowAndCaptureUrl();
    expect(finalUrl).toMatch(/\/liquidations\/drivers\/(create|details|last-liquidation|history)\//);

    const detail = new SettlementsDriverDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Owner: lista -> click row -> detail con :id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsOwnerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Owner liquidations');

    const { finalUrl } = await list.clickFirstRowAndCaptureUrl();
    expect(finalUrl).toMatch(/\/liquidations\/owners\/(create|details|last-liquidation|history)\//);

    const detail = new SettlementsOwnerDetailPage(page);
    await detail.expectDetailReady();
  });
});
