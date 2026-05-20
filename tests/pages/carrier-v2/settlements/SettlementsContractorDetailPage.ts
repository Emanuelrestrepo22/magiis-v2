// tests/pages/carrier-v2/settlements/SettlementsContractorDetailPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/contractors/details/:contractor-id/:liquidation-id
 * @route /carrier/#/liquidations/contractors/create/:contractor-id
 * @route /carrier/#/liquidations/contractors/last-liquidation/:contractor-id/:last-liquidation-id
 * @priority P1
 * @type functional
 * @note El portal V2 routea create/details/last-liquidation al mismo componente
 *       (ContractorLiquidationCreateComponent). Validado contra routing release/v2.0.4.
 *       headingRegex con TODO - verificar contra DOM real cuando backend TEST restaure.
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsContractorDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // TODO: verificar heading real del detail (probable "Liquidation Detail" o "Settlement Detail").
    // Heuristico basado en pattern de las listas: probable "Corporation Liquidation" o similar.
    return /(corporation|contractor).*(liquidation|settlement|detail|create)|liquidaci[oó]n.*empresa|detalle/i;
  }
  constructor(page: Page) { super(page); }
}
