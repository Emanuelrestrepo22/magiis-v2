// tests/pages/carrier-v2/trips/PlaceFields.ts
// Campos de lugar (Origen / Destino / paradas) de Nuevo Viaje y de la edicion de un viaje programado
// (MG-1132 PK-5, ATP TM-1841). Archivo PROPIO de PK-5: replica con la MISMA firma los metodos que PK-2
// agrego a `NewTripPage` (typeInPlaceField, optionsOf, pickReferencePoint, pickGoogleAddress,
// readInstruction, readNoteCard, placeValue) porque `NewTripPage.ts` era de PK-2 y no estaba integrado.
// Integrado: los tipos `PlaceField`/`PlaceOption` viven aca y `NewTripPage` los re-exporta; los METODOS
// siguen duplicados (disposicion `edit` solo aca; esperas de asentado con criterio distinto): pendiente.
//
// Dos disposiciones (medido en TEST v2.0.22, 19/11/2026):
// - `new`  (Nuevo Viaje): filas `.trip-address-row.origin|destiny|stop`; reloj `.btn-wait-time`.
// - `edit` (Detalle en modo edicion `?mode=Edit`, `app-route-editor`): filas `.route-row--origin|destination`;
//   reloj = primer boton `.route-action` con icono `ri-time-line`; tarjeta NOTE con `.tnc-label--destination`.
// En ambas, cada opcion del desplegable es `.place-option` con `.place-option__label` y, si es punto propio
// del carrier, `.place-option__badge`.
import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import type { AutocompleteItem } from '../../../api/clients/places.client.js';
import { watchPlacesTraffic } from '../../../utils/networkWatch.js';

/** Campo de lugar: origen, primer destino o parada N (1-based). */
export type PlaceField = 'origin' | 'destination' | { stop: number };
/** Opcion del desplegable de lugares. */
export type PlaceOption = { text: string; hasBadge: boolean };
export type PlaceLayout = 'new' | 'edit';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ROW_SELECTOR: Record<PlaceLayout, { origin: string; destination: string; stop: string }> = {
  new: {
    origin: '.trip-address-row.origin',
    destination: '.trip-address-row.destiny',
    stop: '.trip-address-row.stop'
  },
  edit: {
    origin: '.route-row--origin',
    destination: '.route-row--destination',
    stop: '.route-row--stop'
  }
};

export class PlaceFields {
  readonly referenceBadge: Locator;
  /** Modal abierto (reloj de espera/indicaciones o notas del viaje). */
  readonly dialog: Locator;

  constructor(
    private readonly page: Page,
    private readonly layout: PlaceLayout = 'new'
  ) {
    this.referenceBadge = page.locator('.place-option__badge');
    this.dialog = page.getByRole('dialog').first();
  }

  private get placeOptions(): Locator {
    return this.page.locator('.ng-dropdown-panel .ng-option:not(.ng-option-disabled)');
  }

  placeRow(field: PlaceField): Locator {
    const sel = ROW_SELECTOR[this.layout];
    if (field === 'origin') return this.page.locator(sel.origin);
    if (field === 'destination') return this.page.locator(sel.destination).first();
    return this.page.locator(sel.stop).nth(field.stop - 1);
  }

  private placeInput(field: PlaceField): Locator {
    return this.placeRow(field).getByRole('combobox').first();
  }

  /**
   * Spinners de resolucion de lugar de TODAS las filas (0 = asentado): como PK-2, global y no por campo, porque
   * un spinner de otra fila tambien indica una resolucion en curso.
   */
  private get spinners(): Locator {
    return this.page.locator(
      this.layout === 'new'
        ? '.trip-address-row .ng-spinner-loader'
        : '.route-row .ng-spinner-loader'
    );
  }

  /** Texto del chip resuelto del campo (vacio si no hay valor). */
  async placeValue(field: PlaceField): Promise<string> {
    const chip = this.placeRow(field).locator('.ng-value-label');
    return (await chip.count()) === 0 ? '' : ((await chip.first().textContent()) ?? '').trim();
  }

  /** Vacia el campo con el boton de limpiar del ng-select. */
  async clearField(field: PlaceField): Promise<void> {
    const host = this.placeRow(field).locator('ng-select').first();
    await host.hover();
    await host.locator('.ng-clear-wrapper').click();
    await expect(
      this.placeRow(field).locator('.ng-value-label'),
      'el campo debe quedar vacio'
    ).toHaveCount(0);
  }

  /**
   * Escribe `text` y espera la RESPUESTA de `places/autocomplete` de ese texto. Devuelve las opciones
   * pintadas, la respuesta cruda y la URL del request (para asertar `address` y `carrierId`).
   */
  async typeInPlaceField(
    field: PlaceField,
    text: string
  ): Promise<{ options: PlaceOption[]; autocomplete: AutocompleteItem[]; requestUrl: string }> {
    const input = this.placeInput(field);
    await input.click();
    // ng-select ignora un termino igual al anterior (distinctUntilChanged): un caracter intermedio, bajo el
    // minimo y sin request, garantiza que `text` sea un termino nuevo.
    await input.fill('x');
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.request().method() === 'GET' &&
          /\/places\/autocomplete\?/.test(res.url()) &&
          new URL(res.url()).searchParams.get('address') === text,
        { timeout: 25_000 }
      ),
      input.fill(text)
    ]);
    const autocomplete = (await response.json()) as AutocompleteItem[];
    if (autocomplete.length > 0) {
      await expect(
        this.placeOptions.first(),
        'el desplegable debe pintar las opciones'
      ).toBeVisible({ timeout: 15_000 });
      await expect(this.placeOptions).toHaveCount(autocomplete.length, { timeout: 15_000 });
    }
    return { options: await this.optionsOf(field), autocomplete, requestUrl: response.url() };
  }

  /** Opciones del desplegable abierto, en orden: texto de la etiqueta y si lleva el badge. */
  async optionsOf(_field: PlaceField): Promise<PlaceOption[]> {
    return this.placeOptions.evaluateAll((els) =>
      els.map((el) => ({
        text: (
          el.querySelector('.place-option__label')?.textContent ??
          el.textContent ??
          ''
        ).trim(),
        hasBadge: el.querySelector('.place-option__badge') !== null
      }))
    );
  }

  /**
   * Escribe `text` y elige el punto propio cuyo `placeId` devolvio el alta (la opcion se identifica por
   * su etiqueta = `mainText` del item con ese placeId, nunca por posicion). Asentado = chip con el nombre
   * del punto y sin spinner; un punto propio NO emite `getPlace`. Devuelve las llamadas vigiladas (getPlace
   * / Google, criterio falla cerrado) observadas desde el clic hasta el asentado.
   */
  async pickReferencePoint(
    field: PlaceField,
    text: string,
    placeId: string
  ): Promise<{
    outboundCalls: string[];
    autocomplete: AutocompleteItem[];
    options: PlaceOption[];
    requestUrl: string;
  }> {
    const { autocomplete, requestUrl, options } = await this.typeInPlaceField(field, text);
    const item = autocomplete.find((i) => i.placeId === placeId);
    if (!item) {
      throw new Error(`la respuesta de autocomplete no trae el placeId propio ${placeId}`);
    }
    const option = this.placeOptions.filter({
      has: this.page.locator('.place-option__label', { hasText: item.mainText })
    });
    const watch = watchPlacesTraffic(this.page);
    try {
      const mark = watch.mark();
      await option.first().click();
      await expect(this.placeRow(field).locator('.ng-value-label')).toHaveText(item.mainText, {
        timeout: 15_000
      });
      await expect(this.spinners, 'sin spinner tras elegir el punto').toHaveCount(0, {
        timeout: 15_000
      });
      return { outboundCalls: watch.since(mark), autocomplete, options, requestUrl };
    } finally {
      watch.dispose();
    }
  }

  /**
   * Elige la primera opcion SIN badge (direccion de Google) cuyo texto contiene `text`. Asentado = respuesta
   * 200 de `places/getPlace`, chip con el texto elegido y sin spinner.
   */
  async pickGoogleAddress(
    field: PlaceField,
    text: string
  ): Promise<{ outboundCalls: string[]; chip: string }> {
    await this.typeInPlaceField(field, text);
    const option = this.placeOptions
      .filter({ hasNot: this.page.locator('.place-option__badge') })
      .filter({ hasText: new RegExp(escapeRegExp(text), 'i') })
      .first();
    await expect(option, `debe haber una opcion de Google para «${text}»`).toBeVisible();
    // Asentado como PK-2: respuesta de getPlace?placeId= (error explicito si no es 200), chip con el texto NUEVO
    // y ningun spinner de resolucion.
    const resolved: Promise<Response> = this.page.waitForResponse(
      (r) => /\/places\/getPlace\?placeId=/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 30_000 }
    );
    resolved.catch(() => undefined);
    const watch = watchPlacesTraffic(this.page);
    try {
      const mark = watch.mark();
      await option.click();
      const response = await resolved;
      if (response.status() !== 200) {
        throw new Error(`places/getPlace respondio ${response.status()} al elegir la direccion`);
      }
      await expect(this.placeRow(field).locator('.ng-value-label')).toHaveText(
        new RegExp(escapeRegExp(text), 'i'),
        { timeout: 15_000 }
      );
      await expect(this.spinners, 'sin spinner tras elegir la direccion').toHaveCount(0, {
        timeout: 20_000
      });
      return { outboundCalls: watch.since(mark), chip: await this.placeValue(field) };
    } finally {
      watch.dispose();
    }
  }

  private clockButton(field: PlaceField): Locator {
    if (this.layout === 'new') return this.placeRow(field).locator('.btn-wait-time');
    return this.placeRow(field).locator('.route-row__actions button:has(i.ri-time-line)').first();
  }

  /** (A) Indicaciones del lugar en el modal del reloj. Abre y cancela el modal. */
  async readInstruction(field: PlaceField): Promise<string> {
    await this.clockButton(field).click();
    await expect(this.dialog).toBeVisible({ timeout: 15_000 });
    const value = await this.dialog
      .getByRole('textbox', { name: /instructions|indicaciones/i })
      .inputValue();
    await this.dialog.getByRole('button', { name: /^(cancel|cancelar)$/i }).click();
    await expect(this.dialog).toBeHidden({ timeout: 15_000 });
    return value;
  }

  /** Fila de la tarjeta NOTE (B) del campo; 0 filas = sin indicacion. */
  noteCardRow(field: PlaceField): Locator {
    const rows = this.page.locator('app-trip-notes-display .tnc-row');
    if (field === 'origin') return rows.filter({ has: this.page.locator('.tnc-label--origin') });
    if (field === 'destination') {
      return this.layout === 'edit'
        ? rows.filter({ has: this.page.locator('.tnc-label--destination') })
        : rows.filter({ hasText: /drop-?off|destino/i });
    }
    return rows.filter({
      has: this.page.locator('.tnc-label--stop', {
        hasText: new RegExp(`(stop|parada)\\s*${field.stop}\\b`, 'i')
      })
    });
  }

  /** (B) Valor de la tarjeta NOTE del campo; cadena vacia si la fila no existe. */
  async readNoteCard(field: PlaceField): Promise<string> {
    const row = this.noteCardRow(field);
    return (await row.count()) === 0 ? '' : await row.locator('.tnc-value').first().innerText();
  }
}
