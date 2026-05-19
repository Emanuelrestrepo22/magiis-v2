// tests/specs/release-v2.0.2/sprint3-p2.spec.ts
// Sprint 3 - Release V2.0.2 - 9 pantallas P2 (7 reportes + 2 GNET).
import { test } from '../../TestBase.js';
import { ReportsTipsPage } from '../../pages/carrier-v2/ReportsTipsPage.js';
import { ReportsDebtAgingPage } from '../../pages/carrier-v2/ReportsDebtAgingPage.js';
import { ReportsCashFlowPage } from '../../pages/carrier-v2/ReportsCashFlowPage.js';
import { ReportsTransactionTrackingPage } from '../../pages/carrier-v2/ReportsTransactionTrackingPage.js';
import { ReportsTaxesFeesPage } from '../../pages/carrier-v2/ReportsTaxesFeesPage.js';
import { ReportsPaymentFlowPage } from '../../pages/carrier-v2/ReportsPaymentFlowPage.js';
import { ReportsAgencyCommissionsPage } from '../../pages/carrier-v2/ReportsAgencyCommissionsPage.js';
import { GnetFarmInPage } from '../../pages/carrier-v2/GnetFarmInPage.js';
import { GnetCreditAccountsPage } from '../../pages/carrier-v2/GnetCreditAccountsPage.js';

test.describe('@P2 @functional @migration Sprint 3 - Release V2.0.2 reportes + GNET', () => {
  test('MX-5560 Tips Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5560' });
    const p = new ReportsTipsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5561 Debt Aging Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5561' });
    const p = new ReportsDebtAgingPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5562 Cash Flow Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5562' });
    const p = new ReportsCashFlowPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5565 Transaction Tracking Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5565' });
    const p = new ReportsTransactionTrackingPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5566 Taxes & Fees Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5566' });
    const p = new ReportsTaxesFeesPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5568 Payment Flow Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5568' });
    const p = new ReportsPaymentFlowPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5571 Agency Commissions Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5571' });
    const p = new ReportsAgencyCommissionsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5573 GNET Farm IN - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5573' });
    const p = new GnetFarmInPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5574 GNET Credit Accounts - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5574' });
    const p = new GnetCreditAccountsPage(page);
    await p.goto();
    await p.expectListReady();
  });
});
