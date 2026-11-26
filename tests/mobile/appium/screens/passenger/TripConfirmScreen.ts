/**
 * TripConfirmScreen (POM, PAX) — pasos que CONFIRMAN el viaje: CTA «Seleccionar Vehículo» del home (lleva a
 * `travel-info`), CTA final «Viajo Ahora» de `travel-info` (crea el viaje REAL), diálogos de bloqueo («Ya tiene un
 * viaje creado», límite de crédito) y lectura del código del viaje. Sin aserciones de negocio.
 *
 * REGLA DE SEGURIDAD: `tapSelectVehicleCta` y `tapFinalConfirmCta` son taps de bajo nivel; NO deben llamarse
 * directo desde un spec. Solo `pbo/TripRequestPBO` los invoca, tras `assertConfirmed` (`{ confirmed: true }`).
 * `NewTripScreen` / `NewTripPBO` siguen siendo de solo lectura sobre el CTA (su unit lo verifica).
 *
 * Relevado del código (develop) y V1; pendiente de validar en vivo (login PAX bloqueado en emuladores por FCM):
 *  - CTA 1 (home): `ion-col.travel-btn-confirm`, es «Seleccionar Vehículo» / en «Select Vehicle»
 *    (`home.button_select_vehicle`). `showTravel()` (home.page.ts:1593) -> `drawTravel()` simula y navega a
 *    `/navigator/travel-info` (home.page.ts:1853): NO crea el viaje (en 2.5.17 se llamaba «Viajo Ahora»).
 *  - CTA 2 (travel-info): `.travel-confirm button.travel-btn-confirm` (travel-info.page.html:~215, `(click)="resolve()"`)
 *    con texto «Viajo Ahora» / «Book Now» + vehículo + precio; en V1 (2.5.17) era `ion-col.travel-btn-confirm`.
 *    `resolve()` -> `createTravel()` (travel-info.page.ts:503/694): ESTE paso crea el viaje. Éxito: navega a
 *    `/navigator/DriverAvailablePages` (travel-info.page.ts:783) = «Buscando servicio...» + «Cancelar Viaje» (V1).
 *  - «Ya tiene un viaje creado»: `http_error_code.passenger_unavailable` (es «Ya tiene un viaje creado», en «You
 *    already have a trip created»); el catch de `createTravel` lo muestra con `messageService.showDialog(error.message)`
 *    (travel-info.page.ts:875). V1 lo detectó como `app-confirm-modal` con botón «Aceptar».
 *  - Límite de crédito: `errorCode === 'LIMIT_EXCEEDED'` -> `showConfirmModal` (travel-info.page.ts:~821-852) con
 *    `home.alert_warning.checking_account_limit_type.exceeded` («Su saldo excede la cuenta corriente configurada…» /
 *    «Your balance exceeds the configured credit account…»), botones «Llamar» (marca a la Cia.) y «Aceptar»
 *    (`btn-outlined-red`, cancela). CUIDADO: el botón primario es «Llamar»; para cerrar se usa solo «Aceptar».
 *  - Código del viaje: formato `<n>-<letra minúscula>` (p. ej. `4885-a`); en 2.5.17 no siempre se muestra.
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver, webUrl } from './passengerWeb.js';

export type BlockingKind = 'blocked-active-trip' | 'credit-limit';
export type CtaState = { present: boolean; visible: boolean; enabled: boolean; text: string };
export type DialogInfo = { text: string; kind: BlockingKind | null };

export const TRIP_CONFIRM_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo: CTA del home (va a travel-info)
  selectVehicleCta: defineLocator({
    id: 'passenger.tripConfirm.selectVehicleCta',
    web: ['ion-col.travel-btn-confirm', '.travel-confirm ion-col.travel-btn-confirm']
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo: CTA final de travel-info (CREA el viaje)
  finalCta: defineLocator({
    id: 'passenger.tripConfirm.finalCta',
    web: [
      '.travel-confirm button.travel-btn-confirm',
      'button.travel-btn-confirm',
      'ion-col.travel-btn-confirm'
    ]
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo: contenedores de diálogos/avisos
  dialogs: defineLocator({
    id: 'passenger.tripConfirm.dialogs',
    web: 'app-confirm-modal, ion-alert, ion-toast, ion-modal, .alert-wrapper, .toast-wrapper'
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo: botones dentro de un diálogo
  dialogButtons: defineLocator({
    id: 'passenger.tripConfirm.dialogButtons',
    web: 'button, ion-button'
  })
} as const satisfies Record<string, Locator>;

/** Textos (es/en, normalizados) de cada CTA y de los botones de cierre; el texto es i18n de la app. */
export const SELECT_VEHICLE_TEXTS = ['seleccionar veh', 'select vehicle'] as const;
export const FINAL_CTA_TEXTS = ['viajo', 'book now'] as const;
/** Botones que SOLO cierran el aviso. «Llamar»/«Call» marca a la Cia. y nunca se toca. */
export const DISMISS_BUTTON_TEXTS = ['aceptar', 'accept', 'ok'] as const;
export const FORBIDDEN_BUTTON_TEXTS = ['llamar', 'call'] as const;

// `passenger_unavailable` («Ya tiene un viaje creado») y `passenger_already_traveling` (http_error_code, es/en.json):
// ambos son el bloqueo del backend por viaje activo; el texto distingue cuál llegó.
const ACTIVE_TRIP_PATTERNS = [
  /ya tiene un viaje creado/,
  /you already have a trip created/,
  /no se puede solicitar un nuevo viaje en este momento/,
  /cannot request a new travel in this moment/
];
const CREDIT_LIMIT_PATTERNS = [
  /excede la cuenta corriente/,
  /cuenta corriente excedio el limite/,
  /exceeds the configured credit account/,
  /credit account exceeded the configured limit/,
  /limit.*exceed/,
  /limite.*excedid/,
  /credit.*limit/,
  /saldo.*insuficient/
];

/** Pura: clasifica el texto de un diálogo (es/en) como bloqueo por viaje activo, límite de crédito o ninguno. */
export function classifyBlockingText(text: string): BlockingKind | null {
  const t = normalizeForMatch(text);
  if (ACTIVE_TRIP_PATTERNS.some((p) => p.test(t))) return 'blocked-active-trip';
  if (CREDIT_LIMIT_PATTERNS.some((p) => p.test(t))) return 'credit-limit';
  return null;
}

/** Pura: el texto contiene alguno de los fragmentos (normalizado). */
export function textIncludesAny(text: string, fragments: readonly string[]): boolean {
  const t = normalizeForMatch(text);
  return fragments.some((f) => t.includes(f));
}

/** Pura: el botón sirve para cerrar el aviso (etiqueta == «Aceptar»/«Accept»/«Ok», nunca «Llamar»). */
export function isDismissButtonLabel(label: string): boolean {
  const t = normalizeForMatch(label);
  if (FORBIDDEN_BUTTON_TEXTS.some((f) => t.includes(f))) return false;
  return DISMISS_BUTTON_TEXTS.some((d) => t === d);
}

// El código del viaje del pax usa letra MINÚSCULA (p. ej. «4885-a»).
const TRIP_CODE_RE = /\b(\d{3,}-[a-z])\b/g;
const TRAVEL_ID_RE = /travelId["'=:\s]+(\d+)/i;

/** Pura: todos los códigos de viaje `<n>-<letra>` presentes en el texto. */
export function collectTripCodes(haystack: string): string[] {
  return [...new Set([...haystack.matchAll(TRIP_CODE_RE)].map((m) => m[1]!))];
}

/** Pura: `travelId` numérico en el texto (URL/HTML), o `null`. */
export function extractTravelId(haystack: string): string | null {
  return TRAVEL_ID_RE.exec(haystack)?.[1] ?? null;
}

/** Pura: ¿el viaje quedó creado? Navega a `DriverAvailablePages` o muestra «Buscando servicio» / «Cancelar Viaje». */
export function isTripCreatedSignal(url: string, visibleText: string): boolean {
  if (/DriverAvailablePages/i.test(url)) return true;
  const t = normalizeForMatch(visibleText);
  return (
    t.includes('cancelar viaje') ||
    t.includes('cancel trip') ||
    t.includes('buscando servicio') ||
    t.includes('we are looking for vehicles')
  );
}

/** Pura: ¿la URL es `travel-info`? */
export const isTripInfoUrl = (url: string): boolean => /travel-info/i.test(url);

export class PassengerTripConfirmScreen {
  constructor(private readonly session: MobileSession) {}

  private async visibleElements(locator: Locator): Promise<WebdriverIO.Element[]> {
    const driver = await webDriver(this.session);
    for (const selector of resolveWebSelectors(locator)) {
      let found: WebdriverIO.Element[] = [];
      try {
        found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
      } catch {
        found = [];
      }
      const visible: WebdriverIO.Element[] = [];
      for (const el of found) if (await el.isDisplayed().catch(() => false)) visible.push(el);
      if (visible.length > 0) return visible;
    }
    return [];
  }

  /** Primer elemento visible del locator cuyo texto contiene alguno de los fragmentos. */
  private async findByText(
    locator: Locator,
    fragments: readonly string[]
  ): Promise<WebdriverIO.Element | null> {
    for (const el of await this.visibleElements(locator)) {
      const label = String(await el.getText().catch(() => ''));
      if (textIncludesAny(label, fragments)) return el;
    }
    return null;
  }

  /** `true` si la WebView está en `travel-info`. */
  async isTripInfoShown(): Promise<boolean> {
    return isTripInfoUrl(await webUrl(this.session));
  }

  /** SOLO LECTURA del CTA final de `travel-info` (presente/visible/habilitado/texto). No lo toca. */
  async readFinalCta(): Promise<CtaState> {
    const driver = await webDriver(this.session);
    return driver
      .execute<CtaState, [string[]]>((sels: string[]) => {
        for (const s of sels) {
          const el = document.querySelector(s) as HTMLElement | null;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
          const disabled =
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none';
          return {
            present: true,
            visible,
            enabled: visible && !disabled,
            text: String(el.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim()
          };
        }
        return { present: false, visible: false, enabled: false, text: '' };
      }, resolveWebSelectors(TRIP_CONFIRM_LOCATORS.finalCta))
      .catch(() => ({ present: false, visible: false, enabled: false, text: '' }));
  }

  /**
   * Tap NATIVO (click real de WebdriverIO) del CTA «Seleccionar Vehículo» del home. IRREVERSIBLE-ADYACENTE: solo
   * lo llama `TripRequestPBO` tras la compuerta. `false` si no hay CTA visible con ese texto.
   */
  async tapSelectVehicleCta(): Promise<boolean> {
    const cta = await this.findByText(TRIP_CONFIRM_LOCATORS.selectVehicleCta, SELECT_VEHICLE_TEXTS);
    if (!cta) return false;
    try {
      await cta.click();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Tap NATIVO del CTA final «Viajo Ahora» de `travel-info`: CREA UN VIAJE REAL. Solo lo llama `TripRequestPBO`
   * tras la compuerta `{ confirmed: true }`. `false` si no hay CTA visible con ese texto.
   */
  async tapFinalConfirmCta(): Promise<boolean> {
    const cta = await this.findByText(TRIP_CONFIRM_LOCATORS.finalCta, FINAL_CTA_TEXTS);
    if (!cta) return false;
    try {
      await cta.click();
      return true;
    } catch {
      return false;
    }
  }

  /** Diálogos/avisos visibles, con su clasificación (bloqueo por viaje activo, límite de crédito o `null`). */
  async readDialogs(): Promise<DialogInfo[]> {
    const out: DialogInfo[] = [];
    for (const el of await this.visibleElements(TRIP_CONFIRM_LOCATORS.dialogs)) {
      const text = String(await el.getText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (text) out.push({ text, kind: classifyBlockingText(text) });
    }
    return out;
  }

  /**
   * Cierra el diálogo de bloqueo de tipo `kind` tocando SOLO «Aceptar»/«Accept»/«Ok» (nunca «Llamar»).
   * `false` si no hay tal diálogo o no tiene botón de cierre visible.
   */
  async dismissBlockingDialog(kind: BlockingKind): Promise<boolean> {
    for (const dialog of await this.visibleElements(TRIP_CONFIRM_LOCATORS.dialogs)) {
      const text = String(await dialog.getText().catch(() => ''));
      if (classifyBlockingText(text) !== kind) continue;
      const buttons = Array.from(
        (await dialog.$$(
          resolveWebSelectors(TRIP_CONFIRM_LOCATORS.dialogButtons)[0]!
        )) as Iterable<WebdriverIO.Element>
      );
      for (const button of buttons) {
        if (!(await button.isDisplayed().catch(() => false))) continue;
        if (!isDismissButtonLabel(String(await button.getText().catch(() => '')))) continue;
        try {
          await button.click();
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  /** URL + texto visible + HTML acotado (el código del viaje a veces solo está en atributos/nodos del HTML). */
  async readTripHaystack(): Promise<string> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string, []>(() => {
        const href = window.location?.href ?? '';
        const text = document.body ? (document.body as HTMLElement).innerText : '';
        const html = document.documentElement ? document.documentElement.outerHTML : '';
        return `${href}\n${text}\n${html}`.slice(0, 200_000);
      })
      .catch(() => '');
  }

  /** `true` si la app ya muestra el estado de viaje creado («Buscando servicio…» / `DriverAvailablePages`). */
  async isTripCreated(): Promise<boolean> {
    const driver = await webDriver(this.session);
    const url = await webUrl(this.session);
    const text = await driver
      .execute<string, []>(() => String(document.body?.innerText ?? ''))
      .catch(() => '');
    return isTripCreatedSignal(url, text);
  }
}
