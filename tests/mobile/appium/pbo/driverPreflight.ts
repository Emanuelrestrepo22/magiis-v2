/**
 * Pre-flight del Driver app antes de un viaje real (parte ligada al driver Appium).
 *
 * Lee el estado de la app (solo lectura), hace login SOLO si está deslogueada y evalúa con las reglas
 * puras de `data/driverPreflightRules.ts`. Las credenciales llegan en la expectativa; nunca se imprimen.
 */

import type { Browser } from 'webdriverio';
import {
  evaluateDriverPreflight,
  type DriverPreflightExpectation,
  type DriverPreflightSnapshot
} from '../data/driverPreflightRules.js';

/** Lee el estado actual de la app (solo lectura) y deja el contexto en WEBVIEW. */
export async function captureDriverPreflightSnapshot(
  driver: Browser
): Promise<DriverPreflightSnapshot> {
  const foregroundPackage = await driver.getCurrentPackage().catch(() => '');
  const contexts = (await driver.getContexts().catch(() => [])) as unknown[];
  const webview = contexts
    .map((c) => (typeof c === 'string' ? c : ((c as { id?: string }).id ?? '')))
    .find((c) => c.startsWith('WEBVIEW'));
  if (!webview) return { foregroundPackage, webUrl: '', headerTexts: [], loggedOut: false };

  await driver.switchContext(webview);
  const info = await driver
    .execute(() => {
      const texts: string[] = [];
      document
        .querySelectorAll(
          'page-home ion-header *, page-home .header *, ion-header *, [class*="driver-name"], [class*="user-name"]'
        )
        .forEach((el) => {
          const t = String((el as HTMLElement).innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          if (t && t.length < 60) texts.push(t);
        });
      const pwd = document.querySelector('input[type="password"]') as HTMLElement | null;
      const loggedOut = !!pwd && pwd.offsetParent !== null;
      return { url: window.location.href, texts: Array.from(new Set(texts)), loggedOut };
    })
    .catch(() => ({ url: '', texts: [] as string[], loggedOut: false }));

  return {
    foregroundPackage,
    webUrl: info.url,
    headerTexts: info.texts,
    loggedOut: info.loggedOut
  };
}

/** Login por WebView (ion-input con shadow DOM). Solo se invoca si la app está deslogueada. */
async function loginDriver(driver: Browser, email: string, password: string): Promise<boolean> {
  const result = await driver
    .execute(
      (em: string, pw: string): string => {
        const set = (host: Element | null, val: string): boolean => {
          if (!host) return false;
          const inner = (host.querySelector('input') ||
            (host as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot?.querySelector(
              'input'
            )) as HTMLInputElement | null;
          if (!inner) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(inner, val);
          inner.dispatchEvent(new Event('input', { bubbles: true }));
          inner.dispatchEvent(new Event('change', { bubbles: true }));
          host.dispatchEvent(
            new CustomEvent('ionInput', { bubbles: true, detail: { value: val } })
          );
          host.dispatchEvent(
            new CustomEvent('ionChange', { bubbles: true, detail: { value: val } })
          );
          return true;
        };
        const ions = Array.from(document.querySelectorAll('ion-input')) as HTMLElement[];
        let emailHost: Element | null = null;
        let passHost: Element | null = null;
        for (const ion of ions) {
          const inner = ion.querySelector('input') || ion.shadowRoot?.querySelector('input');
          const type = inner?.getAttribute('type') || ion.getAttribute('type') || '';
          if (/password/i.test(type)) passHost = ion;
          else if (!emailHost) emailHost = ion;
        }
        const okE = set(emailHost, em);
        const okP = set(passHost, pw);
        const btn = (
          Array.from(
            document.querySelectorAll('button, [role="button"], ion-button')
          ) as HTMLElement[]
        ).find(
          (b) =>
            /entrar|ingresar|login|iniciar/i.test((b.innerText || b.textContent || '').trim()) &&
            b.offsetParent !== null
        );
        if (!okE || !okP || !btn) return 'incomplete';
        btn.click();
        return 'submitted';
      },
      email,
      password
    )
    .catch(() => 'error');
  return result === 'submitted';
}

export type DriverPreflightOptions = {
  /** Se ejecuta tras un login exitoso (ej: cerrar el overlay /pre-home) antes de re-verificar. */
  afterLogin?: () => Promise<unknown>;
  loginTimeoutMs?: number;
  /** Envío del formulario de login (true = quedó enviado). Default: `loginDriver` embebido. */
  login?: (email: string, password: string) => Promise<boolean>;
  /**
   * Tope (ms) para esperar que el header del home pinte el nombre cuando todavía está vacío. Tras relanzar la app
   * el header tarda en renderizar y una lectura inmediata daba «chofer no coincide» en falso (medido 24/11/2026).
   * Si el header ya tiene texto y no es el chofer esperado, se aborta sin esperar. Default 15 000; 0 = sin espera.
   */
  identitySettleMs?: number;
};

/**
 * Pre-flight completo. Orden: (1) lee el estado; (2) SOLO si la app está deslogueada, hace login con
 * `expected.credentials`; (3) evalúa app/chofer/viaje y lanza con todas las violaciones si hay alguna.
 */
export async function assertDriverPreflight(
  driver: Browser,
  expected: DriverPreflightExpectation,
  options: DriverPreflightOptions = {}
): Promise<DriverPreflightSnapshot> {
  let snapshot = await captureDriverPreflightSnapshot(driver);

  if (snapshot.loggedOut && snapshot.foregroundPackage === expected.appPackage) {
    const email = expected.credentials?.email;
    const password = expected.credentials?.password;
    if (!email || !password) {
      throw new Error('App deslogueada y la expectativa no trae credenciales del chofer.');
    }
    const submit = options.login ?? ((em: string, pw: string) => loginDriver(driver, em, pw));
    if (!(await submit(email, password))) {
      throw new Error(
        'Pre-flight del Driver abortado: no se pudo completar el formulario de login.'
      );
    }
    const deadline = Date.now() + (options.loginTimeoutMs ?? 40_000);
    do {
      await driver.pause(1_000);
      if (options.afterLogin) await options.afterLogin().catch(() => undefined);
      snapshot = await captureDriverPreflightSnapshot(driver);
    } while (snapshot.loggedOut && Date.now() < deadline);
  }

  let violations = evaluateDriverPreflight(snapshot, expected);
  const settleDeadline = Date.now() + (options.identitySettleMs ?? 15_000);
  const headerEmpty = (s: DriverPreflightSnapshot): boolean =>
    s.headerTexts.every((t) => t.trim() === '');
  while (violations.length > 0 && headerEmpty(snapshot) && Date.now() < settleDeadline) {
    await driver.pause(1_000);
    snapshot = await captureDriverPreflightSnapshot(driver);
    violations = evaluateDriverPreflight(snapshot, expected);
  }
  if (violations.length > 0) {
    throw new Error(`Pre-flight del Driver abortado: ${violations.join('; ')}.`);
  }
  return snapshot;
}
