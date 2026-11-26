/**
 * OtherCostsSummaryScreen — lecturas del Resumen del viaje (`app-travel-resume`) que necesita TM-1099:
 * filas de importes, ítems desplegados bajo «Otros costos», totales, medio de pago activo y su selección
 * por código. Complementa a `TripResumeScreen` (que no expone filas ni elige el medio por código).
 * Contrastado contra `magiis-mobile-driver-v2@develop` (travel-resume.html, travel-item-details.html):
 *   `.travel-detail ion-row` (`.amount_description` + `ion-label.amount`), `travel-item-details`
 *   (`.accordion-header`, `.accordion-content ion-item`), `.travel-total` (`.label` + `.ammount`; la comisión
 *   lleva `.travel-total-commission-label`), `.travel-payment button.payment` (+ `active`; el ícono es
 *   `…/<CÓDIGO>-black|white.svg`) y `ion-footer button.btn.finish`.
 * POM puro: sin aserciones de negocio. El cierre (con firma) lo hace `TripLifecyclePBO.closeTrip`.
 */

import type { MobileSession } from '../../../core/MobileSession.js';
import { Waits, type UntilOptions } from '../../../core/Waits.js';

export type DriverPaymentMethodCode = 'CASH' | 'CHECKING_ACCOUNT' | 'CREDIT_CARD';

export type TripSummaryValues = {
  /** Filas del detalle tal como se ven: [etiqueta, importe]. */
  rows: Array<[string, string]>;
  fare: string | null;
  otherFees: string | null;
  /** Ítems desplegados bajo «Otros costos» (texto de cada ion-item). */
  otherFeeItems: string[];
  total: string | null;
  commission: string | null;
  activePaymentMethod: string | null;
  paymentMethods: string[];
  closeButtonText: string | null;
};

/** Código de medio de pago a partir del `src` del ícono (`…/CASH-black.svg` -> `CASH`); '' si no coincide. */
export function paymentCodeFromIconSrc(src: string): string {
  const file = src.split('?')[0]!.split('/').pop() ?? '';
  return file.replace(/-(black|white)\.svg$/i, '').replace(/\.svg$/i, '');
}

const RESUME = 'app-travel-resume';
const PAYMENT_BUTTONS = `${RESUME} .travel-payment button.payment`;

type RawSummary = Omit<TripSummaryValues, 'paymentMethods' | 'activePaymentMethod'> & {
  payments: Array<{ src: string; active: boolean }>;
};

export class OtherCostsSummaryScreen {
  constructor(private readonly session: MobileSession) {}

  private async web() {
    if ((await this.session.context()) !== 'webview') await this.session.switchContext('webview');
    return this.session.driver;
  }

  /**
   * La URL del Resumen cambia antes de que Angular pinte: espera los botones de extras («Otros costos» se
   * monta después de Peaje/Estac.: la app consulta el catálogo del chofer al llegar a destino) y el total.
   */
  async waitUntilRendered(options: UntilOptions = {}): Promise<void> {
    await Waits.until(
      async () => {
        const driver = await this.web();
        return driver
          .execute<boolean, [string]>((resumeSel: string) => {
            const root = Array.from(document.querySelectorAll(resumeSel)).find(
              (e) => e.getBoundingClientRect().height > 0
            );
            return Boolean(
              root?.querySelector('.travel-extras button img[src*="addCost"]') &&
              root.querySelector('.travel-total')
            );
          }, RESUME)
          .catch(() => false);
      },
      { label: 'Resumen renderizado', timeout: 20_000, ...options }
    );
  }

  async read(): Promise<TripSummaryValues> {
    const driver = await this.web();
    const values = await driver.execute<RawSummary | null, [string]>((resumeSel: string) => {
      // Ionic apila páginas: puede quedar un Resumen anterior oculto. Solo cuenta el visible.
      const root = Array.from(document.querySelectorAll(resumeSel)).find(
        (e) => e.getBoundingClientRect().height > 0
      );
      if (!root) return null;
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(root.querySelectorAll('.travel-detail ion-row'))
        .map((row) => {
          const label = row.querySelector('.amount_description, .amount-description');
          const amount = row.querySelector('ion-label.amount');
          return label && amount
            ? ([norm(label.textContent), norm(amount.textContent)] as [string, string])
            : null;
        })
        .filter((r): r is [string, string] => r !== null);
      const find = (re: RegExp) => rows.find(([label]) => re.test(label))?.[1] ?? null;
      const otherFeesBlock = Array.from(root.querySelectorAll('travel-item-details')).find(
        (block) =>
          /other fees|otros costos/i.test(
            norm(block.querySelector('.accordion-header')?.textContent)
          )
      );
      const totals = Array.from(root.querySelectorAll('.travel-total'));
      const totalBlock = totals.find((t) => !t.querySelector('.travel-total-commission-label'));
      const commissionBlock = totals.find((t) => t.querySelector('.travel-total-commission-label'));
      const payments = Array.from(root.querySelectorAll('.travel-payment button.payment')).map(
        (b) => ({
          src: String(
            (b.querySelector('ion-icon') as (Element & { src?: string }) | null)?.src ?? ''
          ),
          active: b.classList.contains('active')
        })
      );
      return {
        rows,
        fare: find(/^(fare|tarifa)$/i),
        otherFees: find(/other fees|otros costos/i),
        otherFeeItems: otherFeesBlock
          ? Array.from(otherFeesBlock.querySelectorAll('.accordion-content ion-item')).map((i) =>
              norm(i.textContent)
            )
          : [],
        total: norm(totalBlock?.querySelector('.ammount')?.textContent) || null,
        commission: norm(commissionBlock?.querySelector('.ammount')?.textContent) || null,
        payments,
        closeButtonText:
          norm(root.querySelector('ion-footer button.btn.finish')?.textContent) || null
      };
    }, RESUME);
    if (!values) throw new Error('[OtherCostsSummaryScreen] no se está en el Resumen del viaje.');
    const { payments, ...rest } = values;
    const codes = payments.map((p) => paymentCodeFromIconSrc(p.src));
    const activeIndex = payments.findIndex((p) => p.active);
    return {
      ...rest,
      paymentMethods: codes,
      activePaymentMethod: activeIndex >= 0 ? (codes[activeIndex] ?? null) : null
    };
  }

  /** Elige el medio de pago por su código y espera a que quede activo. Lanza si el Resumen no lo ofrece. */
  async selectPaymentMethod(code: DriverPaymentMethodCode, timeoutMs = 10_000): Promise<void> {
    const driver = await this.web();
    let done = false;
    for (const button of await driver.$$(PAYMENT_BUTTONS)) {
      if (!(await button.isDisplayed().catch(() => false))) continue;
      const src = await driver
        .execute<
          string,
          [HTMLElement]
        >((el: HTMLElement) => String((el.querySelector('ion-icon') as (Element & { src?: string }) | null)?.src ?? ''), button as unknown as HTMLElement)
        .catch(() => '');
      if (paymentCodeFromIconSrc(src) !== code) continue;
      await button.click();
      done = true;
      break;
    }
    if (!done) {
      throw new Error(`[OtherCostsSummaryScreen] el Resumen no ofrece el medio de pago ${code}.`);
    }
    await Waits.until(async () => (await this.read()).activePaymentMethod === code, {
      label: `medio de pago ${code} activo`,
      timeout: timeoutMs
    });
  }
}
