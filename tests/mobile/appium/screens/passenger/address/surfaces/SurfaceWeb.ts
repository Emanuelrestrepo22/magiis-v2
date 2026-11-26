/**
 * SurfaceWeb — implementación real de `SurfacePort` sobre `MobileSession` (WebView de la app Pasajero).
 * Portado de los helpers de V1 `homeSurfaces.ts` (selectores y gestos PROBADOS en UAT v2.5.19). Sin lógica de
 * decisión: sólo gestos y lecturas de DOM. Sin aserciones.
 *
 * Gestos: `.click()` DOM no dispara los handlers de Ionic en esta app; se usa click real de WebdriverIO
 * (`tapByText`, genera `mousedown`) o tap nativo en coordenadas CSS mapeadas a pantalla (`tapAtCssPoint`).
 * Validación en vivo pendiente en dispositivo físico (V1 calibró en Samsung A05; emulador = no concluyente).
 */

import { resolveWebSelectors } from '../../../../core/Locator.js';
import type { MobileSession } from '../../../../core/MobileSession.js';
import { sleep } from '../../../../core/Waits.js';
import { SideMenuScreen } from '../../SideMenuScreen.js';
import { webDriver, webUrl } from '../../passengerWeb.js';
import { SURFACE_LOCATORS } from './surfaceLocators.js';
import type { CssPoint, FieldState, RowTapKind, SurfacePort } from './types.js';

type Tappable = {
  isDisplayed: () => Promise<boolean>;
  getText: () => Promise<string>;
  click: () => Promise<void>;
};

export function surfacePortFor(session: MobileSession): SurfacePort {
  return new SurfaceWeb(session);
}

class SurfaceWeb implements SurfacePort {
  constructor(private readonly session: MobileSession) {}

  url(): Promise<string> {
    return webUrl(this.session);
  }

  pause(ms: number): Promise<void> {
    return sleep(ms);
  }

  async tapByText(selector: string, needle: string, timeoutMs = 8000): Promise<boolean> {
    const driver = await webDriver(this.session);
    const target = needle.toLowerCase();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let els: Tappable[] = [];
      try {
        els = Array.from((await driver.$$(selector)) as unknown as Iterable<Tappable>);
      } catch {
        els = [];
      }
      for (const el of els) {
        try {
          if (!(await el.isDisplayed())) continue;
          if (!(await el.getText()).toLowerCase().includes(target)) continue;
          await el.click();
          await sleep(1800);
          return true;
        } catch {
          // el elemento se re-renderizó: se sigue con el próximo
        }
      }
      await sleep(300);
    }
    return false;
  }

  async tapCss(selector: string): Promise<boolean> {
    const driver = await webDriver(this.session);
    const rect = await driver
      .execute<CssPoint | null, [string]>((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const el = Array.from(document.querySelectorAll(sel)).filter(vis)[0] as
          | HTMLElement
          | undefined;
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return {
          x: b.left + b.width / 2,
          y: b.top + b.height / 2,
          vw: window.innerWidth,
          vh: window.innerHeight
        };
      }, selector)
      .catch(() => null);
    if (!rect) return false;
    await this.tapAtCssPoint(rect);
    return true;
  }

  async tapBackArrow(): Promise<boolean> {
    const driver = await webDriver(this.session);
    const tapped = await driver
      .execute<boolean, [string]>((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const el = Array.from(document.querySelectorAll(sel))
          .filter(vis)
          .find((e) => {
            const n = `${e.getAttribute('name') ?? ''} ${e.getAttribute('ng-reflect-name') ?? ''} ${e.className} ${e.getAttribute('aria-label') ?? ''}`;
            return /arrow-back|arrow_back|chevron-back|back-button/i.test(n);
          }) as HTMLElement | undefined;
        if (!el) return false;
        el.click();
        return true;
      }, 'ion-back-button, ion-icon, .arrow-back, ion-buttons ion-button')
      .catch(() => false);
    if (tapped) await sleep(1800);
    return tapped;
  }

  openSideMenu(): Promise<boolean> {
    return new SideMenuScreen(this.session).open();
  }

  async fieldState(selector: string): Promise<FieldState> {
    const driver = await webDriver(this.session);
    return driver
      .execute<FieldState, [string]>((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const t = Array.from(document.querySelectorAll(sel)).filter(vis)[0] as
          | HTMLInputElement
          | undefined;
        return t
          ? { present: true, readOnly: t.readOnly || t.disabled, value: t.value ?? '' }
          : { present: false, readOnly: false, value: '' };
      }, selector)
      .catch(() => ({ present: false, readOnly: false, value: '' }));
  }

  async tapField(selector: string, kind: RowTapKind): Promise<boolean> {
    const driver = await webDriver(this.session);
    const rect = await driver
      .execute<CssPoint | null, [string, string]>(
        (sel: string, k: string) => {
          const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
          const input = Array.from(document.querySelectorAll(sel)).filter(vis)[0] as
            | HTMLElement
            | undefined;
          if (!input) return null;
          let target: HTMLElement | null = input;
          if (k === 'row') {
            target = input.closest('ion-item, ion-row, .travel-edit-input') as HTMLElement | null;
          }
          if (!target) return null;
          const r = target.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;
          // 'text': TERCIO IZQUIERDO, lejos del icono de acción (papelera) que vive a la derecha.
          const x = k === 'text' ? r.left + r.width * 0.25 : r.left + r.width / 2;
          return { x, y: r.top + r.height / 2, vw: window.innerWidth, vh: window.innerHeight };
        },
        selector,
        kind
      )
      .catch(() => null);
    if (!rect) return false;
    await this.tapAtCssPoint(rect);
    return true;
  }

  async setValue(selector: string, value: string): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string, string]>(
        (sel: string, v: string) => {
          const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
          const t = Array.from(document.querySelectorAll(sel)).filter(vis)[0] as
            | HTMLInputElement
            | undefined;
          if (!t || t.disabled) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(t, v);
          t.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          t.dispatchEvent(new Event('ionInput', { bubbles: true, composed: true } as EventInit));
          return true;
        },
        selector,
        value
      )
      .catch(() => false);
  }

  async findEditablePlaceholder(placeholderPattern: string): Promise<string | null> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string | null, [string]>((pattern: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const re = new RegExp(pattern, 'i');
        const hit = (Array.from(document.querySelectorAll('input')) as HTMLInputElement[])
          .filter(vis)
          .filter((i) => re.test(i.placeholder ?? ''))
          .find((i) => !i.readOnly && !i.disabled);
        return hit ? hit.placeholder : null;
      }, placeholderPattern)
      .catch(() => null);
  }

  async findPlaceholderStartingWith(prefix: string): Promise<string | null> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string | null, [string]>((p: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const hit = (Array.from(document.querySelectorAll('input')) as HTMLInputElement[])
          .filter(vis)
          .find((i) => (i.placeholder ?? '').trim().toLowerCase().startsWith(p.toLowerCase()));
        return hit ? hit.placeholder : null;
      }, prefix)
      .catch(() => null);
  }

  async isTripTypeActive(needle: string): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string, string]>(
        (sel: string, n: string) => {
          const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
          const hit = Array.from(document.querySelectorAll(sel))
            .filter(vis)
            .find((e) => (e.textContent ?? '').toLowerCase().includes(n.toLowerCase()));
          return hit ? String(hit.className ?? '').includes('active') : false;
        },
        resolveWebSelectors(SURFACE_LOCATORS.tripTypeButton)[0]!,
        needle
      )
      .catch(() => false);
  }

  async readAddressType(): Promise<string> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string, []>(() => {
        const el = document.querySelector('#inputAddressType ion-select, ion-select') as
          | (HTMLElement & { value?: unknown })
          | null;
        return el && el.value ? String(el.value) : '';
      })
      .catch(() => '');
  }

  async pickFirstAddressTypeOption(): Promise<string> {
    await this.tapByText('#inputAddressType, ion-select, ion-item', 'tipo', 5000);
    await sleep(1800);
    const driver = await webDriver(this.session);
    return driver
      .execute<string, []>(() => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const opt = Array.from(
          document.querySelectorAll(
            'ion-select-popover ion-item, ion-popover ion-item, ion-radio, ion-select-option'
          )
        ).filter(vis)[0] as HTMLElement | undefined;
        if (!opt) return '';
        const label = (opt.textContent ?? '').trim();
        opt.click();
        return label || 'opcion-1';
      })
      .catch(() => '');
  }

  async findProfileAddressInput(): Promise<string | null> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string | null, []>(() => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const inputs = (
          Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
        ).filter(vis);
        // `name="input-from"` es el del lugar; `name="input-name"` el del nombre de la dirección.
        if (inputs.some((i) => (i.getAttribute('name') ?? '') === 'input-from')) {
          return 'input[name="input-from"]';
        }
        const byPlaceholder = inputs.find((i) =>
          /direcci|lugar|domicilio|address/i.test(i.placeholder ?? '')
        );
        return byPlaceholder
          ? `input[placeholder=${JSON.stringify(byPlaceholder.placeholder)}]`
          : null;
      })
      .catch(() => null);
  }

  /** Tap NATIVO en un punto CSS del WebView (mapeado a pantalla); vuelve al contexto WEBVIEW al terminar. */
  private async tapAtCssPoint(rect: CssPoint): Promise<void> {
    const driver = this.session.driver;
    await this.session.switchContext('native');
    try {
      let ox = 0;
      let oy = 0;
      let sw = 0;
      let sh = 0;
      try {
        const wv = (await driver.$('//android.webkit.WebView')) as unknown as {
          getLocation: () => Promise<{ x: number; y: number }>;
          getSize: () => Promise<{ width: number; height: number }>;
        };
        const loc = await wv.getLocation();
        const sz = await wv.getSize();
        ox = loc.x;
        oy = loc.y;
        sw = sz.width;
        sh = sz.height;
      } catch {
        sw = 0;
      }
      if (!sw || !sh) {
        const size = await driver.getWindowSize();
        sw = size.width;
        sh = size.height;
      }
      const x = Math.round(ox + rect.x * (sw / rect.vw));
      const y = Math.round(oy + rect.y * (sh / rect.vh));
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 120 },
            { type: 'pointerUp', button: 0 }
          ]
        }
      ]);
      await driver.releaseActions().catch(() => undefined);
    } finally {
      await this.session.switchContext('webview');
    }
    await sleep(1200);
  }
}
