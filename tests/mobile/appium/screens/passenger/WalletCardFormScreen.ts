/**
 * WalletCardFormScreen (POM, PAX) — formulario «Nuevo método de pago» (`app-credit-card-payment-data`, modal) con
 * Stripe Elements: detectarlo, completar número / vencimiento / CVC (iframes de Stripe) y nombre del titular, tocar
 * «Guardar» y observar el resultado. Sin aserciones de negocio.
 *
 * REGLA DE SEGURIDAD: `tapSave` es IRREVERSIBLE (crea la tarjeta en Stripe y en el backend del pasajero). NO debe
 * llamarse desde un spec: solo `pbo/PassengerWalletPBO.addCard` lo invoca, tras `assertConfirmed`. Los datos de
 * tarjeta los pasa el PBO (solo números de PRUEBA públicos de Stripe, ver `data/stripeTestCards.ts`).
 *
 * Relevado del código (`magiis-mobile-passenger-v2@develop`, `credit-card-payment-data.component.{html,ts}`; NO
 * validado en vivo):
 *  - La pasarela la decide el carrier activo (`carrier.mercadopagoAppCode == 'STRIPE'` -> `isStripe`). Con Stripe el
 *    número / vencimiento / CVC son iframes montados en `div.stripe-element` (hosts `#stripeCardNumber|Expiry|Cvc`);
 *    vencimiento y CVC aparecen cuando el número está completo (`showSecondSegment`). Con otra pasarela
 *    (MercadoPago, EBIZ, Authorize) el formulario es NATIVO (`ion-input[formcontrolname="cardNumber"]`): este screen
 *    lo detecta (`kind() === 'native'`) pero NO lo completa (fuera de alcance).
 *  - Titular: `ion-input[formcontrolname="cardholderName"]`, obligatorio, máx. 30, patrón `[a-zA-Z-' ]+` (solo letras).
 *  - «Guardar» (`button.btn.primary`, `credit_card.save_card` en mayúsculas) está deshabilitado hasta que los tres
 *    elementos de Stripe estén completos, el titular sea válido y no haya un submit en curso (`submitting`).
 *    `submit()` -> `confirmCardSetup` (con 3DS abre el desafío de Stripe) -> el modal se cierra con los datos y
 *    `cards.page` llama a `saveStripeCard` -> toast `cards.add_card_success`. Si Stripe rechaza, se abre un
 *    `app-confirm-modal` con el mensaje y el botón «Reintentar» (`cards.retry_button`); el formulario sigue abierto.
 *  - DIFERENCIA vs V1: se descarta la cascada `ng.doConfirmCardSetup` / `ng.verifyCreditCard` (dependía de `window.ng`
 *    de builds de desarrollo): se toca el botón como un usuario (JS click y, si el botón sigue habilitado, click
 *    WebDriver sobre su `span`).
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { sleep, tryUntil } from '../../core/Waits.js';
import { webDriver } from './passengerWeb.js';
import { SAVE_CARD_LABELS } from './walletParsing.js';

export type WalletCardInput = {
  /** PAN de PRUEBA (público de Stripe), con o sin espacios. */
  number: string;
  /** `MM/AA` o `MM/AAAA`. */
  expiry: string;
  cvc: string;
  /** Solo letras, espacios, guion y apóstrofo; máx. 30 (validación de la app). */
  holderName: string;
};

export type CardFormKind = 'stripe' | 'native' | 'none';
export type SaveResult = 'tapped' | 'disabled' | 'not-found';
export type FormOutcome =
  | { state: 'open' }
  | { state: 'closed' }
  | { state: 'challenge' }
  | { state: 'error'; text: string };

export const WALLET_FORM_LOCATORS = {
  // código: host del formulario (hay una instancia por modal abierto)
  host: defineLocator({ id: 'passenger.walletForm.host', web: 'app-credit-card-payment-data' }),
  // código: contenedores de Stripe Elements (solo existen si la pasarela es Stripe)
  stripeElement: defineLocator({
    id: 'passenger.walletForm.stripeElement',
    web: 'app-credit-card-payment-data .stripe-element'
  }),
  // código: formulario nativo (MercadoPago / EBIZ / Authorize)
  nativeNumber: defineLocator({
    id: 'passenger.walletForm.nativeNumber',
    web: 'app-credit-card-payment-data ion-input[formcontrolname="cardNumber"]'
  }),
  holder: defineLocator({
    id: 'passenger.walletForm.holder',
    web: [
      'app-credit-card-payment-data ion-input[formcontrolname="cardholderName"] input',
      'app-credit-card-payment-data ion-input[formcontrolname="cardholderName"] .native-input'
    ]
  }),
  saveButton: defineLocator({
    id: 'passenger.walletForm.save',
    web: 'app-credit-card-payment-data button.btn.primary'
  }),
  back: defineLocator({
    id: 'passenger.walletForm.back',
    web: 'app-credit-card-payment-data .arrow-back'
  }),
  // código: diálogo de error de Stripe (`messageService.showConfirmModal` -> `app-confirm-modal`)
  errorDialog: defineLocator({ id: 'passenger.walletForm.errorDialog', web: 'app-confirm-modal' })
} as const;

/** Pistas para ubicar el iframe de cada elemento de Stripe por su `name`/`src`/`title`. */
export const STRIPE_FRAME_HINTS = {
  number: /componentName=cardNumber/i,
  expiry: /componentName=cardExpiry/i,
  cvc: /componentName=cardCvc/i
} as const;
const NOISE_FRAME = /metrics|hcaptcha|controller/i;
const CHALLENGE_FRAME =
  /three-ds-2-challenge|stripe-challenge-frame|3d_secure_2|acs|authenticate|verify|challenge/i;
const ELEMENT_FRAME =
  /elements-inner-card|cardnumber|cardexpiry|cardcvc|controller|metrics|hcaptcha/i;

const INPUT_SELECTORS: Record<keyof typeof STRIPE_FRAME_HINTS, readonly string[]> = {
  number: ['input[name="cardnumber"]'],
  expiry: ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', 'input[name="exp"]'],
  cvc: ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', 'input[name="cc-csc"]']
};

/** Pura: normaliza `MM/AA` o `MM/AAAA` a `MM/AA` (falla si no coincide). */
export function normalizeExpiry(expiry: string): string {
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry.trim());
  if (!m) throw new Error(`Vencimiento inválido «${expiry}»: se espera MM/AA o MM/AAAA.`);
  return `${m[1]!.padStart(2, '0')}/${m[2]!.slice(-2)}`;
}

/** Pura: la app solo acepta letras, espacios, guion y apóstrofo, hasta 30 caracteres. */
export function isValidHolderName(name: string): boolean {
  return name.length > 0 && name.length <= 30 && /^[a-zA-Z-' ]+$/.test(name);
}

type FrameEntry = { element: WebdriverIO.Element; signature: string };

export class WalletCardFormScreen {
  constructor(private readonly session: MobileSession) {}

  /** SOLO LECTURA: el modal del formulario está visible. */
  async isOpen(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        return (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      }, resolveWebSelectors(WALLET_FORM_LOCATORS.host)[0]!)
      .catch(() => false);
  }

  /** SOLO LECTURA: qué tipo de formulario montó la app según la pasarela del carrier. */
  async kind(): Promise<CardFormKind> {
    const driver = await webDriver(this.session);
    return driver
      .execute<CardFormKind, [string, string]>(
        (stripeSel: string, nativeSel: string) => {
          if (document.querySelector(stripeSel)) return 'stripe';
          if (document.querySelector(nativeSel)) return 'native';
          return 'none';
        },
        resolveWebSelectors(WALLET_FORM_LOCATORS.stripeElement)[0]!,
        resolveWebSelectors(WALLET_FORM_LOCATORS.nativeNumber)[0]!
      )
      .catch(() => 'none' as const);
  }

  /** Vuelve atrás sin guardar (flecha del encabezado). Reversible. */
  async dismiss(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        const back = document.querySelector(sel) as HTMLElement | null;
        if (!back) return false;
        back.click();
        return true;
      }, resolveWebSelectors(WALLET_FORM_LOCATORS.back)[0]!)
      .catch(() => false);
  }

  /** Completa un formulario STRIPE (número -> espera 2º segmento -> vencimiento -> CVC -> titular). Falla si no. */
  async fillStripe(card: WalletCardInput): Promise<void> {
    if (!isValidHolderName(card.holderName)) {
      throw new Error(
        '[WalletCardFormScreen] titular inválido para la app (solo letras, máx. 30).'
      );
    }
    const expiry = normalizeExpiry(card.expiry);
    const number = card.number.replace(/\s+/g, '');
    await this.typeInStripeFrame('number', number);
    const second = await tryUntil(async () => (await this.findFrames('expiry')).length > 0, {
      timeout: 10_000,
      label: 'iframes de vencimiento / CVC tras completar el número'
    });
    if (!second) {
      throw new Error('[WalletCardFormScreen] no aparecieron vencimiento / CVC tras el número.');
    }
    await this.typeInStripeFrame('expiry', expiry);
    await this.typeInStripeFrame('cvc', card.cvc.replace(/\s+/g, ''));
    await this.fillHolder(card.holderName);
  }

  /** SOLO LECTURA: «Guardar» está habilitado. */
  async isSaveEnabled(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string, readonly string[]]>(
        (sel: string, labels: readonly string[]) => {
          const norm = (v: unknown): string =>
            String(v ?? '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          const b = (Array.from(document.querySelectorAll(sel)) as HTMLButtonElement[]).find((x) =>
            labels.includes(norm(x.textContent))
          );
          return !!b && !b.disabled;
        },
        resolveWebSelectors(WALLET_FORM_LOCATORS.saveButton)[0]!,
        SAVE_CARD_LABELS
      )
      .catch(() => false);
  }

  /**
   * Toca «Guardar» (IRREVERSIBLE). JS click; si tras 1,5 s el botón sigue habilitado y el modal abierto (el click
   * no disparó el submit), un click WebDriver sobre su `span`. `disabled` si no está habilitado: no se toca.
   */
  async tapSave(): Promise<SaveResult> {
    if (!(await this.isSaveEnabled())) {
      const driver = await webDriver(this.session);
      const exists = await driver
        .execute<
          boolean,
          [string]
        >((sel: string) => document.querySelector(sel) !== null, resolveWebSelectors(WALLET_FORM_LOCATORS.saveButton)[0]!)
        .catch(() => false);
      return exists ? 'disabled' : 'not-found';
    }
    const driver = await webDriver(this.session);
    const sel = resolveWebSelectors(WALLET_FORM_LOCATORS.saveButton)[0]!;
    await driver.execute((s: string) => {
      const b = document.querySelector(s) as HTMLElement | null;
      b?.click();
    }, sel);
    const started = await tryUntil(
      async () => !(await this.isSaveEnabled()) || !(await this.isOpen()),
      {
        timeout: 1_500,
        interval: 250
      }
    );
    if (!started) {
      let spans: WebdriverIO.Element[] = [];
      try {
        spans = Array.from((await driver.$$(`${sel} span`)) as Iterable<WebdriverIO.Element>);
      } catch {
        spans = [];
      }
      for (const span of spans) {
        if (!(await span.isDisplayed().catch(() => false))) continue;
        try {
          await span.click();
          break;
        } catch {
          // se prueba el siguiente
        }
      }
    }
    return 'tapped';
  }

  /** SOLO LECTURA: resultado observable del submit (modal abierto / cerrado / desafío 3DS / diálogo de error). */
  async readOutcome(): Promise<FormOutcome> {
    const driver = await webDriver(this.session);
    const snap = await driver
      .execute<
        { open: boolean; challenge: boolean; errorText: string },
        [string, string, string, string]
      >(
        (hostSel: string, errSel: string, challenge: string, element: string) => {
          const vis = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const open = (Array.from(document.querySelectorAll(hostSel)) as HTMLElement[]).some(vis);
          const challengeRe = new RegExp(challenge, 'i');
          const elementRe = new RegExp(element, 'i');
          const isChallenge = (
            Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[]
          ).some((f) => {
            const sig = `${f.name ?? ''} ${f.src ?? ''}`;
            return challengeRe.test(sig) && !elementRe.test(sig);
          });
          const dialog = (Array.from(document.querySelectorAll(errSel)) as HTMLElement[]).find(vis);
          return {
            open,
            challenge: isChallenge,
            errorText: dialog ? (dialog.innerText ?? '').replace(/\s+/g, ' ').trim() : ''
          };
        },
        resolveWebSelectors(WALLET_FORM_LOCATORS.host)[0]!,
        resolveWebSelectors(WALLET_FORM_LOCATORS.errorDialog)[0]!,
        CHALLENGE_FRAME.source,
        ELEMENT_FRAME.source
      )
      .catch(() => null);
    if (!snap) return { state: 'open' };
    if (snap.errorText) return { state: 'error', text: snap.errorText };
    if (snap.challenge) return { state: 'challenge' };
    return { state: snap.open ? 'open' : 'closed' };
  }

  // ───────────────────────── internos (iframes de Stripe) ─────────────────────────

  private async findFrames(which: keyof typeof STRIPE_FRAME_HINTS): Promise<FrameEntry[]> {
    const driver = await webDriver(this.session);
    await driver.switchFrame(null).catch(() => undefined);
    const frames = Array.from((await driver.$$('iframe')) as Iterable<WebdriverIO.Element>);
    const entries: FrameEntry[] = [];
    for (const element of frames) {
      const signature = [
        await element.getAttribute('name').catch(() => ''),
        await element.getAttribute('src').catch(() => ''),
        await element.getAttribute('title').catch(() => '')
      ].join(' ');
      if (STRIPE_FRAME_HINTS[which].test(signature) && !NOISE_FRAME.test(signature)) {
        entries.push({ element, signature });
      }
    }
    return entries.reverse();
  }

  private async isElementComplete(frame: WebdriverIO.Element): Promise<boolean> {
    const driver = await webDriver(this.session);
    await driver.switchFrame(null).catch(() => undefined);
    return driver
      .execute<boolean, [WebdriverIO.Element]>((iframe: unknown) => {
        const host = (iframe as HTMLElement).closest('.StripeElement, .stripe-element');
        const cls = `${host?.className ?? ''} ${host?.parentElement?.className ?? ''}`;
        return /StripeElement--complete/.test(cls) && !/StripeElement--invalid/.test(cls);
      }, frame)
      .catch(() => false);
  }

  /**
   * Escribe en el iframe de Stripe de `which`. Estrategias en orden: (1) setter nativo + eventos `input`/`change`
   * dentro del iframe; (2) click sobre el contenedor y tecleo real. Cada una se confirma con
   * `StripeElement--complete`; si ninguna completa, lanza con el detalle de los iframes vistos.
   */
  private async typeInStripeFrame(
    which: keyof typeof STRIPE_FRAME_HINTS,
    value: string
  ): Promise<void> {
    const driver = await webDriver(this.session);
    const frames = await tryUntil(
      async () => {
        const f = await this.findFrames(which);
        return f.length > 0 ? f : null;
      },
      { timeout: 20_000, label: `iframe de Stripe «${which}»` }
    );
    if (!frames) {
      throw new Error(`[WalletCardFormScreen] no se encontró el iframe de Stripe «${which}».`);
    }
    for (const { element } of frames) {
      await element.scrollIntoView().catch(() => undefined);
      // (1) setter nativo dentro del iframe
      try {
        await driver.switchFrame(element);
        const set = await driver.execute(
          (selectors: readonly string[], v: string) => {
            for (const s of selectors) {
              const input = document.querySelector(s) as HTMLInputElement | null;
              if (!input) continue;
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
              )?.set;
              if (!setter) return false;
              input.focus();
              setter.call(input, v);
              input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return true;
            }
            return false;
          },
          INPUT_SELECTORS[which],
          value
        );
        await driver.switchFrame(null);
        if (
          set &&
          (await tryUntil(() => this.isElementComplete(element), { timeout: 2_000, interval: 150 }))
        ) {
          return;
        }
      } catch {
        await driver.switchFrame(null).catch(() => undefined);
      }
      // (2) click en el contenedor + tecleo real
      try {
        await driver.execute((iframe: unknown) => {
          const f = iframe as HTMLElement;
          const target = (f.closest('.stripe-element-wrapper') ??
            f.closest('ion-item') ??
            f) as HTMLElement;
          target.scrollIntoView?.({ block: 'center' });
          target.click?.();
        }, element);
        await sleep(150);
        for (const ch of Array.from(value)) {
          await driver.keys([ch]);
          await sleep(35);
        }
        if (
          await tryUntil(() => this.isElementComplete(element), { timeout: 2_000, interval: 150 })
        ) {
          return;
        }
      } catch {
        // se prueba el siguiente iframe candidato
      }
    }
    const seen = (await this.findFrames(which)).map((f) => f.signature.slice(0, 120));
    throw new Error(
      `[WalletCardFormScreen] el campo «${which}» de Stripe no llegó a «completo» (iframes candidatos: ${JSON.stringify(seen)}).`
    );
  }

  private async fillHolder(name: string): Promise<void> {
    const driver = await webDriver(this.session);
    await driver.switchFrame(null).catch(() => undefined);
    const ok = await driver
      .execute<boolean, [readonly string[], string]>(
        (selectors: readonly string[], v: string) => {
          for (const s of selectors) {
            const input = document.querySelector(s) as HTMLInputElement | null;
            if (!input) continue;
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value'
            )?.set;
            if (!setter) return false;
            input.focus();
            setter.call(input, v);
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            input.blur();
            return true;
          }
          return false;
        },
        resolveWebSelectors(WALLET_FORM_LOCATORS.holder),
        name
      )
      .catch(() => false);
    if (!ok) throw new Error('[WalletCardFormScreen] no se encontró el campo del titular.');
  }
}
