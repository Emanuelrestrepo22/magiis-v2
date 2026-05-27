// tests/specs/release-v2.0.2/sprint8-detail-create-flows.spec.ts
// Sprint 8 - Settlements detail/create flows via boton "+" por row.
//
// Continuacion de sprint8-detail-flows.spec.ts (que cubre History via boton index=1).
// Esta suite cubre el flujo Create/Detail via boton index=0 (`+`):
//   1. Llegar a la lista padre.
//   2. Verificar rows con datos reales (test.skip si vacia).
//   3. Click en boton index=0 (`+` = Create) de la primera row.
//   4. Validar URL match /(create|details|last-liquidation)/ porque V2 routea
//      las 3 paths al MISMO componente Angular (ContractorLiquidationCreateComponent
//      y equivalentes). Confirmado contra refs/v2 release/v2.0.4.
//   5. expectDetailReady() sobre el POM detail (heading visible).
//
// Cobertura: FW-007d senalo que los 4 Settlements*DetailPage no tenian
// specs consumidores. Este spec cierra ese gap manteniendo el patron
// padre->hijo establecido en sprint8-detail-flows.
import { test, expect } from '../../TestBase.js';
import { SettlementsContractorListPage } from '../../pages/carrier-v2/SettlementsContractorListPage.js';
import { SettlementsDriverListPage } from '../../pages/carrier-v2/SettlementsDriverListPage.js';
import { SettlementsOwnerListPage } from '../../pages/carrier-v2/SettlementsOwnerListPage.js';
import { SettlementsPassengerListPage } from '../../pages/carrier-v2/SettlementsPassengerListPage.js';
import { SettlementsContractorDetailPage } from '../../pages/carrier-v2/settlements/SettlementsContractorDetailPage.js';
import { SettlementsDriverDetailPage } from '../../pages/carrier-v2/settlements/SettlementsDriverDetailPage.js';
import { SettlementsOwnerDetailPage } from '../../pages/carrier-v2/settlements/SettlementsOwnerDetailPage.js';
import { SettlementsPassengerDetailPage } from '../../pages/carrier-v2/settlements/SettlementsPassengerDetailPage.js';

const CREATE_BUTTON_INDEX = 0;

test.describe('@P1 @functional @migration Sprint 8 - Settlements detail/create flows', () => {
  // Backend de auth + listas con latencia variable (validado 2026-05-20).
  // retries=2 absorbe timeouts puntuales sin marcar el test como fallido definitivo.
  test.describe.configure({ retries: 2 });

  test('MX-5647 Contractor: lista -> click + -> /contractors/(create|details|last-liquidation)/:id', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/contractors/(create|details|last-liquidation)'
    });

    const list = new SettlementsContractorListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Contractor liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(CREATE_BUTTON_INDEX);
    // Los 3 routes (create/details/last-liquidation) resuelven al mismo componente Angular.
    expect(finalUrl).toMatch(/\/liquidations\/contractors\/(create|details|last-liquidation)\//);

    const detail = new SettlementsContractorDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Driver: lista -> click + -> /drivers/(create|details|last-liquidation)/:id', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/drivers/(create|details|last-liquidation)'
    });

    const list = new SettlementsDriverListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Driver liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(CREATE_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/drivers\/(create|details|last-liquidation)\//);

    const detail = new SettlementsDriverDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Owner: lista -> click + -> /owners/(create|details|last-liquidation)/:id', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/owners/(create|details|last-liquidation)'
    });

    const list = new SettlementsOwnerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Owner liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(CREATE_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/owners\/(create|details|last-liquidation)\//);

    const detail = new SettlementsOwnerDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5647 Passenger: lista -> click + -> /passenger/(create|details|last-liquidation)/:id', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/liquidations/passenger/(create|details|last-liquidation)'
    });

    const list = new SettlementsPassengerListPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Passenger liquidations');

    const { finalUrl } = await list.clickFirstRowActionButton(CREATE_BUTTON_INDEX);
    expect(finalUrl).toMatch(/\/liquidations\/passenger\/(create|details|last-liquidation)\//);

    const detail = new SettlementsPassengerDetailPage(page);
    await detail.expectDetailReady();
  });
});
