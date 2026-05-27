// tests/specs/release-v2.0.2/sprint8-detail-flows.spec.ts
// Sprint 8 - Settlements history flows via boton "clock" por row.
// Patron padre->hijo descubierto en release/v2.0.4:
//   1. Llegar a la lista padre.
//   2. Verificar rows con datos reales (test.skip si vacia).
//   3. Click en boton index=1 (clock = History) de la primera row.
//   4. Validar URL match /history/:id.
//   5. expectDetailReady() sobre el POM history.
//
// Las rows NO son clickables directamente. Cada row expone botones de accion:
//   index 0 = `+` (Create nueva liquidacion)
//   index 1 = clock (History de liquidaciones)
//   index 2 = PDF (solo si hay last settlement)
// History es el mas estable porque siempre aparece para rows con datos.
import { test, expect } from '../../../TestBase.js';
import { SettlementsContractorListPage } from '../../../pages/carrier-v2/SettlementsContractorListPage.js';
import { SettlementsPassengerListPage } from '../../../pages/carrier-v2/SettlementsPassengerListPage.js';
import { SettlementsDriverListPage } from '../../../pages/carrier-v2/SettlementsDriverListPage.js';
import { SettlementsOwnerListPage } from '../../../pages/carrier-v2/SettlementsOwnerListPage.js';
import { SettlementsContractorHistoryPage } from '../../../pages/carrier-v2/settlements/SettlementsContractorHistoryPage.js';
import { SettlementsPassengerHistoryPage } from '../../../pages/carrier-v2/settlements/SettlementsPassengerHistoryPage.js';
import { SettlementsDriverHistoryPage } from '../../../pages/carrier-v2/settlements/SettlementsDriverHistoryPage.js';
import { SettlementsOwnerHistoryPage } from '../../../pages/carrier-v2/settlements/SettlementsOwnerHistoryPage.js';

const HISTORY_BUTTON_INDEX = 1;

test.describe('@P1 @functional @migration Sprint 8 - Settlements history flows', () => {
  // Backend de auth + listas con latencia variable (validado 2026-05-20).
  // retries=2 absorbe timeouts puntuales sin marcar el test como fallido definitivo.
  test.describe.configure({ retries: 2 });

  test('MX-5647 Contractor: lista -> click History -> /contractors/history/:id', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsContractorListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Contractor liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(HISTORY_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/contractors\/history\//);

    const detail = new SettlementsContractorHistoryPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Passenger: lista -> click History -> /passenger/history/:id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsPassengerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Passenger liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(HISTORY_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/passenger\/history\//);

    const detail = new SettlementsPassengerHistoryPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Driver: lista -> click History -> /drivers/history/:id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsDriverListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Driver liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(HISTORY_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/drivers\/history\//);

    const detail = new SettlementsDriverHistoryPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Owner: lista -> click History -> /owners/history/:id', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });

    const list = new SettlementsOwnerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Owner liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(HISTORY_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/owners\/history\//);

    const detail = new SettlementsOwnerHistoryPage(page);
    await detail.expectDetailReady();
  });
});
