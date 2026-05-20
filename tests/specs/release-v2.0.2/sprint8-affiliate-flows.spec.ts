// tests/specs/release-v2.0.2/sprint8-affiliate-flows.spec.ts
// Sprint 8 - Affiliate detail flows (3 pantallas con :id).
// Cada test valida que desde la lista padre AffiliateCheckingAccount se puede
// alcanzar el detail correspondiente capturando :checkingAccountId.
import { test, expect } from '../../TestBase.js';
import { AffiliateCheckingAccountPage } from '../../pages/carrier-v2/AffiliateCheckingAccountPage.js';
import { AffiliateCheckingAccountDetailPage } from '../../pages/carrier-v2/affiliate/AffiliateCheckingAccountDetailPage.js';

test.describe('@P1 @functional @migration Sprint 8 - Affiliate detail flows', () => {
  // Backend de listas con latencia variable (validado 2026-05-20).
  test.describe.configure({ retries: 2 });

  test('MX-5648 Affiliate CC detail: lista -> click Details -> /checking-account-detail/:id/:typeView', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5648' });
    test.info().annotations.push({
      type: 'note',
      description:
        'Las rows de Affiliate CC NO son clickables. Cada row expone botones por accion: ' +
        '[$ Liquidate] (solo type=IN), [clock History], [list Details]. Clickeamos el ultimo = Details.'
    });

    const list = new AffiliateCheckingAccountPage(page);
    await list.goto();
    await list.expectListReady();

    const rowCount = await list.getDataRowCount();
    test.skip(rowCount === 0, 'Sin datos en TEST para Affiliate Checking Account');

    const { finalUrl } = await list.clickFirstRowLastActionButton();
    // El boton Details navega a /affiliate/checking-account-detail/:id/:typeView.
    expect(finalUrl).toMatch(/\/affiliate\/checking-account-detail\//);

    const detail = new AffiliateCheckingAccountDetailPage(page);
    await detail.expectDetailReady();
  });

  test('MX-5646 Affiliate liquidation detail: ruta directa con :id/:editMode (sin datos reales, valida 404/redirect)', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5646' });
    test.info().annotations.push({
      type: 'note',
      description:
        'No tenemos :id real sin acceso a backend. Validamos que la ruta NO redirige a /dashboard cuando :id es invalido (probable muestra error inline o pagina vacia).'
    });

    await page.goto('/carrier/#/affiliate/liquidation-detail/test-invalid-id/view');
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => null);

    const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
    // Como no tenemos un :id real, esperamos que NO rebote al dashboard (probable que muestre
    // empty state o error). Si rebota, la pantalla no maneja :id invalidos correctamente.
    expect(finalUrl).toContain('/affiliate/liquidation-detail');
  });

  test('MX-5647 Affiliate liquidations list con :id: ruta directa (placeholder validation)', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5647' });
    test.info().annotations.push({
      type: 'note',
      description:
        'La URL real es /affiliate/checking-account/:id/liquidations/list/:typeView. Sin :id real validamos que el routing acepta la URL.'
    });

    await page.goto('/carrier/#/affiliate/checking-account/test-invalid-id/liquidations/list/view');
    await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => null);

    const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
    expect(finalUrl).toContain('/affiliate/checking-account/');
    expect(finalUrl).toContain('/liquidations/list/');
  });
});
