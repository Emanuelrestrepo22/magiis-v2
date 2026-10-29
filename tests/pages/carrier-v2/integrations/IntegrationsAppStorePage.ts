// tests/pages/carrier-v2/integrations/IntegrationsAppStorePage.ts
/**
 * @jira MG-920
 * @route /carrier/#/settings/integrations/list
 * @priority P1
 * @type functional
 * @note POM-owner: MU-002. Superficie reservada para MU-003/004/005 (OAuth Stripe, modales
 *   Authorize.Net/eBizCharge, modal de confirmacion de unlink - html:580-595) - no se implementa aca.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';

/** Nombres literales de las 4 tarjetas de pasarela de pago (h6, texto EN/ES identico). */
export const PAYMENT_GATEWAY_NAMES = [
  'Mercado Pago',
  'Stripe',
  'Authorize.Net',
  'EBizCharge'
] as const;

export const APPSTORE_PATH = '/carrier/#/settings/integrations/list';

/**
 * Claves de las 4 flags de pasarela en el body real de GET carriers/{id}/preferences - medido en
 * vivo 2026-09-04 (docs/qa/migration/units/MU-002-plan.md, seccion "Forma medida del body de
 * preferences"). Invariante anti-drift: si el backend deja de declarar alguna, el assert de shape
 * de cada TC lo detecta antes de leer las flags individuales.
 */
export const GATEWAY_FLAG_KEYS = [
  'hasStripe',
  'hasAuthorize',
  'hasEbiz',
  'hasMercadopago'
] as const;

// getCarrierPreference.command.ts:15-16 - GET carriers/{id}/preferences hidrata el estado real.
export const GATEWAY_PREFERENCES_URL = /\/carriers\/[^/]+\/preferences(?:$|[?#])/;

/**
 * Cuerpo real de GET carriers/{id}/preferences (integrations-list.component.ts:184-186,202).
 * Los nombres NO son simetricos con los literales de la UI: hasAuthorizeNet en pantalla viene de
 * `preferences.hasAuthorize` (ts:185) y hasEBizCharge de `preferences.hasEbiz` (ts:186) - no
 * `hasAuthorizeNet`/`hasEBizCharge` en el body. MP llega en `hasMercadopago` (ts:202).
 */
export type CarrierPreferences = {
  hasStripe?: boolean;
  hasAuthorize?: boolean;
  hasEbiz?: boolean;
  hasMercadopago?: boolean;
  unlinkingInProgress?: boolean;
  [k: string]: unknown;
};

/**
 * Cruce API<->UI (scope-rules.md §1: "excepto si la UI muestra ese dato" - la UI muestra
 * exactamente cual pasarela esta vinculada). Mapea las flags reales del body a los literales de
 * `PAYMENT_GATEWAY_NAMES`; funcion total - devuelve TODAS las pasarelas con la flag en true (no
 * solo la primera), para que el test pueda separar pertenencia (`toContain(linkedName)`) de
 * exclusividad (`linked.length`) como dos oraculos independientes.
 */
export function linkedGatewaysFromPreferences(
  p: CarrierPreferences
): Array<(typeof PAYMENT_GATEWAY_NAMES)[number]> {
  const linked: Array<(typeof PAYMENT_GATEWAY_NAMES)[number]> = [];
  if (p.hasMercadopago) linked.push('Mercado Pago');
  if (p.hasStripe) linked.push('Stripe');
  if (p.hasAuthorize) linked.push('Authorize.Net');
  if (p.hasEbiz) linked.push('EBizCharge');
  return linked;
}

export class IntegrationsAppStorePage extends BasePage {
  /** Titulo nativo V2 (h4 breadcrumb) - EN "Integrations / MAGIIS Apps Store", ES "Integraciones / Lista". */
  readonly pageTitle: Locator;
  /** Seccion "Payment Interfaces" / "Interfaces de pago" (div.mb-4 hermano del h5). */
  readonly paymentSection: Locator;
  /** Las 4 tarjetas de pasarela de pago, escopeadas a paymentSection (nunca .integration-cards-container solo). */
  readonly paymentCards: Locator;
  /** Subconjunto de paymentCards con el link "Unlink"/"Desvincular" visible. */
  readonly cardsWithUnlink: Locator;
  /** Subconjunto de paymentCards con el link "Link"/"Vincular" visible. */
  readonly cardsWithLink: Locator;
  /** Iframe puente V1 (*ngIf="!migrated") - debe ser 0 en la pantalla nativa. */
  readonly v1BridgeIframe: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.getByRole('heading', {
      level: 4,
      name: /^(integrations \/ magiis apps store|integraciones \/ lista)$/i
    });
    this.paymentSection = page.locator('div.mb-4').filter({
      has: page.getByRole('heading', {
        level: 5,
        name: /^(payment interfaces|interfaces de pago)$/i
      })
    });
    this.paymentCards = this.paymentSection.locator('.card.integration-card');
    this.cardsWithUnlink = this.paymentCards.filter({
      has: page.getByRole('link', { name: /^(unlink|desvincular)$/i })
    });
    this.cardsWithLink = this.paymentCards.filter({
      has: page.getByRole('link', { name: /^(link|vincular)$/i })
    });
    this.v1BridgeIframe = page.locator('iframe.w-100.h-100'); // html:3 class literal
  }

  /** Tarjeta de una pasarela puntual por su nombre literal (h6.card-title). */
  cardByName(name: (typeof PAYMENT_GATEWAY_NAMES)[number]): Locator {
    return this.paymentCards.filter({ has: this.page.getByRole('heading', { level: 6, name }) });
  }

  unlinkLinkIn(card: Locator): Locator {
    return card.getByRole('link', { name: /^(unlink|desvincular)$/i });
  }

  linkLinkIn(card: Locator): Locator {
    return card.getByRole('link', { name: /^(link|vincular)$/i });
  }

  statusTextIn(card: Locator): Locator {
    return card.locator('.card-footer');
  }

  /** Nombre de la unica tarjeta vinculada (Unlink visible). Asume cardsWithUnlink.toHaveCount(1) ya verificado. */
  async linkedGatewayName(): Promise<string | null> {
    const heading = this.cardsWithUnlink.first().getByRole('heading', { level: 6 });
    return heading.textContent();
  }

  async goto(): Promise<CarrierPreferences> {
    const prefsResponse = this.page.waitForResponse(
      (r) => r.request().method() === 'GET' && GATEWAY_PREFERENCES_URL.test(r.url()),
      { timeout: 30_000 }
    );
    await this.navigate(APPSTORE_PATH);
    const response = await prefsResponse;
    expect(response.status(), 'carriers/{id}/preferences debe responder 200').toBe(200);
    const body = (await response.json()) as CarrierPreferences;
    await expect(this.pageTitle).toBeVisible({ timeout: 15_000 });
    return body;
  }

  async reloadAndWaitState(): Promise<CarrierPreferences> {
    const prefsResponse = this.page.waitForResponse(
      (r) => r.request().method() === 'GET' && GATEWAY_PREFERENCES_URL.test(r.url()),
      { timeout: 30_000 }
    );
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    const response = await prefsResponse;
    expect(response.status(), 'carriers/{id}/preferences debe responder 200 tras el reload').toBe(
      200
    );
    const body = (await response.json()) as CarrierPreferences;
    await expect(this.pageTitle).toBeVisible({ timeout: 15_000 });
    return body;
  }

  /**
   * Ready-gate: pantalla nativa V2 (no iframe puente V1), seccion de pago visible, 4 tarjetas
   * escopeadas (invariante anti-vacuidad antes de cualquier toHaveCount(0) en los tests).
   */
  async expectMainSectionsReady(): Promise<void> {
    await expect(
      this.v1BridgeIframe,
      'no debe haber iframe puente V1 (pantalla debe estar migrated)'
    ).toHaveCount(0);
    await expect(this.pageTitle).toBeVisible();
    await expect(this.paymentSection).toBeVisible();
    await expect(
      this.paymentCards,
      'las 4 tarjetas de pasarela de pago deben estar escopeadas antes de cualquier assert de count(0)'
    ).toHaveCount(4);
  }
}
