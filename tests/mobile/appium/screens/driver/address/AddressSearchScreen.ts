/**
 * AddressSearchScreen (POM) — buscador de direcciones de la app Chofer (MG-117): modal «Buscar dirección»
 * (`app-travel-edit-search`) al que se llega desde «Editar viaje» (`app-travel-edit`) con un VIAJE EN CURSO.
 * Solo locators + gestos atómicos + lecturas de DOM. Sin aserciones ni veredictos (viven en `driverAddressVerdicts`).
 *
 * ESTADO DE LOS SELECTORES (contrastados con `magiis-mobile-driver-v2@develop`, leído 25/11/2026):
 *   - «código»      = confirmado en el HTML/TS de develop, todavía sin ver en vivo en este build.
 *   - «PROBADO UAT» = además lo usó V1 en la campaña MG-117 (UAT `com.magiis.app.uat.driver` 2.6.15).
 *   Ver la tabla por selector en cada constante. El resultado de la corrida en vivo (D-18/19) actualiza esta columna
 *   en `docs/analysis/appium-migration/D-18-19-direcciones-chofer.md`.
 *
 * Reutiliza, sin duplicar, el puerto de gestos de las superficies de PAX (`surfacePortFor`: tap NATIVO anclado al
 * rect del WebView, `fieldState`): es agnóstico del actor, recibe cualquier `MobileSession`. NO se editan las probes
 * de PAX: este screen solo cumple su contrato `AddressFieldTarget`.
 *
 * Gesto: en Ionic el `click()` de DOM NO dispara el handler del lápiz ni de las filas; se usa tap NATIVO.
 */

import type { Browser } from 'webdriverio';
import type { MobileSession } from '../../../core/MobileSession.js';
import { sleep } from '../../../core/Waits.js';
import type { AddressFieldTarget } from '../../passenger/address/probes/types.js';
import { surfacePortFor } from '../../passenger/address/surfaces/index.js';
import type { SurfacePort } from '../../passenger/address/surfaces/index.js';
import { webDriver, webUrl } from '../driverWeb.js';
import { isInProgressUrl } from '../TripInProgressScreen.js';

/** Selectores del buscador (CSS del WebView). Estado: ver cabecera. */
export const ADDRESS_SEARCH_SELECTORS = {
  /** Lápiz «Editar viaje» de `travel-in-progress.html` (`div.edit.action-container`). PROBADO UAT. */
  editPencil: 'div.edit.action-container',
  /** Modal «Editar viaje» (`app-travel-edit`). código. */
  editHost: 'app-travel-edit',
  /**
   * Fila de DESTINO del modal «Editar viaje»: el último `travel-edit-input` (ionFocus abre el buscador; su input es
   * readonly). Primero la estructura (código), después el placeholder «Destino» de V1 (PROBADO UAT, solo locale es).
   */
  destinationRow:
    'app-travel-edit .wrapper > travel-edit-input:last-of-type input, input[placeholder*="estino"]',
  /** Host del modal de búsqueda (`travel-edit-search.ts`, selector `app-travel-edit-search`). código. */
  searchHost: 'app-travel-edit-search',
  /**
   * Input EDITABLE del buscador (`<ion-input #input ...>` en `.search`). V1 usó `input` filtrando no-readonly
   * (PROBADO UAT); acá se acota al host para no confundirlo con los inputs readonly del modal de edición. código.
   */
  searchInput: 'app-travel-edit-search ion-input input',
  /** Fila de predicción (`ion-item.prediction-item`, `*ngFor` sobre `item.predictions`). PROBADO UAT. */
  predictionRow: 'app-travel-edit-search ion-item.prediction-item, ion-item.prediction-item',
  /** Flecha de volver del buscador (`onCancel()`): primer botón del encabezado `.input-location-search`. código. */
  searchBack: 'app-travel-edit-search .input-location-search button',
  /** Botón «Cancelar» del pie de «Editar viaje» (`close()`, `button.btn-outlined-red`). código. */
  editCancel: 'app-travel-edit ion-footer button.btn-outlined-red',
  /** Indicadores de carga del buscador (`.loading-container` con `ion-spinner`). código. */
  loaders: 'ion-loading, .loading-wrapper, ion-spinner, .spinner, .loading-container',
  /** Avisos de error visibles. PROBADO UAT. */
  errors: 'ion-toast, ion-alert, .error, .alert, [role="alert"]'
} as const;

export type AddressSearchReach =
  | { reachable: true; fieldSelector: string; detail: string }
  | { reachable: false; reason: string };

/** Pura: ¿la URL es la de «Editar viaje» o la de un viaje en curso (de donde se llega al buscador)? */
export function isTripContextUrl(url: string): boolean {
  return isInProgressUrl(url) || /travel-edit/i.test(url);
}

export class AddressSearchScreen {
  private readonly port: SurfacePort;

  constructor(private readonly session: MobileSession) {
    this.port = surfacePortFor(session);
  }

  private web(): Promise<Browser> {
    return webDriver(this.session);
  }

  url(): Promise<string> {
    return webUrl(this.session);
  }

  /** ¿Hay un viaje en curso (o su edición) en pantalla? Solo lectura. */
  async isInTripContext(): Promise<boolean> {
    return isTripContextUrl(await this.url());
  }

  /** Cuántos inputs editables (no readonly, visibles) del buscador hay abiertos. >1 invalida toda medición de frecuencia. */
  async openSearchFields(): Promise<number> {
    const driver = await this.web();
    return driver
      .execute((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        return Array.from(document.querySelectorAll(sel))
          .filter(vis)
          .filter((e) => !(e as HTMLInputElement).readOnly).length;
      }, ADDRESS_SEARCH_SELECTORS.searchInput)
      .catch(() => 0);
  }

  /**
   * Lleva la app hasta el buscador: viaje en curso -> lápiz -> fila de destino. NO guarda ni confirma nada.
   * Sin viaje en curso devuelve `reachable:false` con el motivo (el spec lo convierte en skip, nunca en verde).
   */
  async reachSearch(): Promise<AddressSearchReach> {
    if ((await this.openSearchFields()) === 1) {
      return {
        reachable: true,
        fieldSelector: ADDRESS_SEARCH_SELECTORS.searchInput,
        detail: 'buscador ya abierto'
      };
    }
    const url = await this.url();
    if (!isTripContextUrl(url)) {
      return {
        reachable: false,
        reason: `El chofer no está en un viaje en curso (URL: ${url || 'sin URL'}): el buscador vive dentro de «Editar viaje».`
      };
    }
    // El modal «Editar viaje» se abre con el lápiz (el click de DOM no lo dispara). Si ya está abierto, se omite.
    if (!/travel-edit/i.test(url) && !(await this.isVisible(ADDRESS_SEARCH_SELECTORS.editHost))) {
      if (!(await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.editPencil))) {
        return {
          reachable: false,
          reason:
            'Viaje en curso sin lápiz de edición visible (`div.edit.action-container`): viaje con costo fijo, alquiler o afiliado no permite editar.'
        };
      }
    }
    await sleep(1200);
    if (!(await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.destinationRow))) {
      return { reachable: false, reason: 'No se encontró la fila de destino en «Editar viaje».' };
    }
    await sleep(1200);
    const open = await this.openSearchFields();
    return open === 1
      ? {
          reachable: true,
          fieldSelector: ADDRESS_SEARCH_SELECTORS.searchInput,
          detail: 'viaje en curso -> lápiz -> destino'
        }
      : {
          reachable: false,
          reason: `Tras tocar el destino hay ${open} buscadores editables (se esperaba 1).`
        };
  }

  /** Contrato `AddressFieldTarget` de las probes de PAX, sobre el buscador del Chofer. */
  fieldTarget(): AddressFieldTarget {
    return {
      id: 'D1',
      label: 'App Chofer · Editar viaje › Destino',
      driver: this.session.driver,
      fieldSelector: () => ADDRESS_SEARCH_SELECTORS.searchInput,
      selectFirstPrediction: () => this.selectFirstPrediction()
    };
  }

  /**
   * Toca la primera predicción con tap NATIVO. Devuelve su texto, o `null` si no había ninguna. En la app la
   * selección CIERRA el buscador (`modalController.dismiss(place)`) y solo cambia el borrador de «Editar viaje»:
   * no se guarda nada hasta «Confirmar», que este screen nunca toca.
   */
  async selectFirstPrediction(): Promise<string | null> {
    const driver = await this.web();
    const label = await driver
      .execute((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        const row = Array.from(document.querySelectorAll(sel)).filter(vis)[0] as
          | HTMLElement
          | undefined;
        return row ? (row.textContent ?? '').trim().slice(0, 120) : null;
      }, ADDRESS_SEARCH_SELECTORS.predictionRow)
      .catch(() => null);
    if (label === null) return null;
    if (!(await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.predictionRow))) return null;
    return label || 'primera predicción';
  }

  /** Reabre el buscador desde «Editar viaje» (tras seleccionar se cierra). */
  async reopenFromEdit(): Promise<boolean> {
    if (!(await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.destinationRow))) return false;
    await sleep(1200);
    return (await this.openSearchFields()) === 1;
  }

  async predictionRows(): Promise<number> {
    return this.countVisible(ADDRESS_SEARCH_SELECTORS.predictionRow);
  }

  /** Etiquetas de los indicadores de carga visibles (vacío = ninguno). */
  async visibleLoaders(): Promise<string[]> {
    const driver = await this.web();
    return driver
      .execute((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        return Array.from(document.querySelectorAll(sel))
          .filter(vis)
          .map((e) => e.tagName.toLowerCase());
      }, ADDRESS_SEARCH_SELECTORS.loaders)
      .catch(() => [] as string[]);
  }

  /** Textos (recortados) de los avisos de error visibles. */
  async visibleErrors(): Promise<string[]> {
    const driver = await this.web();
    return driver
      .execute((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        return Array.from(document.querySelectorAll(sel))
          .filter(vis)
          .map((e) => (e.textContent ?? '').trim().slice(0, 140))
          .filter(Boolean);
      }, ADDRESS_SEARCH_SELECTORS.errors)
      .catch(() => [] as string[]);
  }

  /**
   * Sale SIN guardar: cierra el buscador (flecha) y cancela «Editar viaje». Nunca toca «Confirmar». Mejor esfuerzo:
   * no lanza (corre en `finally`).
   */
  async leaveWithoutSaving(): Promise<void> {
    try {
      if ((await this.countVisible(ADDRESS_SEARCH_SELECTORS.searchHost)) > 0) {
        await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.searchBack);
        await sleep(1200);
      }
      if (await this.isVisible(ADDRESS_SEARCH_SELECTORS.editHost)) {
        await this.port.tapCss(ADDRESS_SEARCH_SELECTORS.editCancel);
        await sleep(1200);
      }
    } catch {
      // limpieza de mejor esfuerzo
    }
  }

  private async countVisible(selector: string): Promise<number> {
    const driver = await this.web();
    return driver
      .execute((sel: string) => {
        const vis = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
        return Array.from(document.querySelectorAll(sel)).filter(vis).length;
      }, selector)
      .catch(() => 0);
  }

  private async isVisible(selector: string): Promise<boolean> {
    return (await this.countVisible(selector)) > 0;
  }
}
