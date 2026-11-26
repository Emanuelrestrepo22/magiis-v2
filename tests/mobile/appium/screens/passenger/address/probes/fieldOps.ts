/**
 * fieldOps — operaciones DOM sobre el input de dirección, agnósticas de la pantalla (parametrizadas por `driver` +
 * selector). Es lo que V1 tenía como métodos privados de `AddressFieldProbe`.
 *
 * Son scripts que se ejecutan DENTRO del WebView; cada función deja el contexto en WEBVIEW (`ensureWebView`). Se
 * escribe con el setter nativo + eventos `input`/`ionInput` (Ionic) y se SELLA el instante de la pulsación en el
 * propio reloj de la página.
 */

import type { Browser } from 'webdriverio';
import { switchToWebView } from '../../../../core/WebViewNetworkCaptureTypes.js';
import { sleep, tryUntil } from '../../../../core/Waits.js';

type StampWindow = {
  __mgLastKeystrokeAt?: number;
  __mgKeyStamps?: number[];
  __mgKeyDone?: boolean;
};

/** Deja el driver en el contexto WEBVIEW. `false` si no hay WebView. */
export async function ensureWebView(driver: Browser): Promise<boolean> {
  return (await switchToWebView(driver)) !== null;
}

/** Enfoca el primer input visible y dispara `ionFocus`. `false` si no hay input visible. */
export async function focusField(driver: Browser, selector: string): Promise<boolean> {
  await ensureWebView(driver);
  const ok = (await driver.execute((sel: string) => {
    const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
    const input = Array.from(document.querySelectorAll(sel)).filter(visible)[0] as
      | HTMLInputElement
      | undefined;
    if (!input) return false;
    input.focus();
    input.dispatchEvent(new Event('ionFocus', { bubbles: true, composed: true } as EventInit));
    input.click();
    return true;
  }, selector)) as boolean;
  // Ionic hidrata el foco de forma asíncrona y no hay condición observable más barata que esta pausa corta.
  await sleep(1400);
  return ok;
}

/**
 * Escribe `value` y CONFIRMA leyendo de vuelta que quedó. Devuelve `false` si el campo no existe, es readonly /
 * disabled, o no retuvo el valor.
 *
 * El read-back es load-bearing: las conductas que se miden por AUSENCIA de requests (B4, B6) darían PASS sobre un
 * campo MUERTO (cero requests es justo lo que produce un campo inerte).
 */
export async function typeText(driver: Browser, selector: string, value: string): Promise<boolean> {
  await ensureWebView(driver);
  return (await driver.execute(
    (sel: string, v: string) => {
      const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
      const input = Array.from(document.querySelectorAll(sel)).filter(visible)[0] as
        | HTMLInputElement
        | undefined;
      if (!input) return false;
      if (input.readOnly || input.disabled) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('ionInput', { bubbles: true, composed: true } as EventInit));
      (window as unknown as StampWindow).__mgLastKeystrokeAt = Date.now();
      return input.value === v;
    },
    selector,
    value
  )) as boolean;
}

/** Valor actual del campo; `''` si no se pudo leer (nunca lanza). */
export async function readValue(driver: Browser, selector: string): Promise<string> {
  await ensureWebView(driver);
  return (await driver
    .execute((sel: string) => {
      const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
      const input = Array.from(document.querySelectorAll(sel)).filter(visible)[0] as
        | HTMLInputElement
        | undefined;
      return input ? String(input.value ?? '') : '';
    }, selector)
    .catch(() => '')) as string;
}

/** `true` si el input existe, es visible y no está readonly ni deshabilitado. */
export async function isEditable(driver: Browser, selector: string): Promise<boolean> {
  await ensureWebView(driver);
  return (await driver
    .execute((sel: string) => {
      const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
      const input = Array.from(document.querySelectorAll(sel)).filter(visible)[0] as
        | HTMLInputElement
        | undefined;
      return !!input && !input.readOnly && !input.disabled;
    }, selector)
    .catch(() => false)) as boolean;
}

export type BurstStamps = {
  /** La secuencia arrancó (input visible y editable). */
  started: boolean;
  /** La propia página terminó de agendar todas las pulsaciones. */
  completed: boolean;
  /** `Date.now()` de la página por cada pulsación. */
  stamps: number[];
};

/**
 * Teclea `full.slice(0, n)` para n = `fromLength`..`full.length`, una pulsación cada `gapMs`, AGENDADA DENTRO DE LA
 * PÁGINA con `setTimeout`, y sella cada una. El intervalo lo controla el WebView (no hay un round-trip WebDriver por
 * tecla) y queda como dato medido: la premisa «pulsaciones más rápidas que la ventana de debounce» deja de ser un
 * supuesto.
 *
 * MECANISMO: los eventos `input` son sintéticos (no pasan por el teclado real). Para debounce / conteo de requests
 * es válido (el producto escucha `ionInput`), pero un hallazgo debe confirmarse con tipeo real antes de reportarse.
 */
export async function typeBurst(
  driver: Browser,
  selector: string,
  full: string,
  fromLength: number,
  gapMs: number
): Promise<BurstStamps> {
  await ensureWebView(driver);
  const started = (await driver.execute(
    (sel: string, text: string, from: number, gap: number) => {
      const w = window as unknown as StampWindow;
      w.__mgKeyStamps = [];
      w.__mgKeyDone = false;
      const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
      const input = Array.from(document.querySelectorAll(sel)).filter(visible)[0] as
        | HTMLInputElement
        | undefined;
      if (!input || input.readOnly || input.disabled) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      let i = from;
      const step = (): void => {
        setter?.call(input, text.slice(0, i));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('ionInput', { bubbles: true, composed: true } as EventInit));
        (w.__mgKeyStamps as number[]).push(Date.now());
        w.__mgLastKeystrokeAt = Date.now();
        i += 1;
        if (i <= text.length) setTimeout(step, gap);
        else w.__mgKeyDone = true;
      };
      step();
      return true;
    },
    selector,
    full,
    fromLength,
    gapMs
  )) as boolean;

  if (!started) return { started: false, completed: false, stamps: [] };

  const expected = full.length - fromLength + 1;
  const completed = await tryUntil(
    async () =>
      (await driver
        .execute(() => (window as unknown as StampWindow).__mgKeyDone === true)
        .catch(() => false)) as boolean,
    { timeout: expected * gapMs + 15_000, interval: 250, label: 'ráfaga de pulsaciones completa' }
  );
  const stamps = (await driver
    .execute(() => (window as unknown as StampWindow).__mgKeyStamps ?? [])
    .catch(() => [] as number[])) as number[];
  return { started: true, completed: completed === true, stamps };
}

/** Vacía el campo con una escritura de `''` (la captura la limpia el llamador con `resetCapture`). */
export async function clearField(driver: Browser, selector: string): Promise<void> {
  await typeText(driver, selector, '');
  await sleep(600);
}
