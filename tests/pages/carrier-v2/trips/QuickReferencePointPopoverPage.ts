// tests/pages/carrier-v2/trips/QuickReferencePointPopoverPage.ts
// MG-1132 · PK-3 — puntero de mapa y popover «Guardar como punto de referencia» de Nuevo Viaje
// (MG-1761). Selectores MEDIDOS en TEST el 19/11/2026 (front v2.0.22, locale en-US, cliente
// «Stripe, Cliente» del carrier 1521):
//   - Filas de ruta y puntero: ver NewTripPage (`placeRow`, `pointerButtonFor`, `armPointerAndClick`).
//   - Mapa de Nuevo Viaje = Google Maps (`.nt-map-wrapper .map-container`), NO Leaflet: el click va por
//     `tests/utils/googleMap.ts`.
//   - Popover: `.nt-waypoint-popover` (role=dialog) con `#ntWaypointName` (maxlength 50),
//     `#ntWaypointReference` (textarea, maxlength 240), `#ntWaypointCancel` y `#ntWaypointSave`.
//   - Toasts: SweetAlert2 (`.swal2-popup`), igual que el ABM de Otros Costos.
// El puntero (`armPointerAndClick`) y las filas de ruta viven en NewTripPage (PK-2/PK-3); este POM
// solo modela el popover. Sin aserciones de negocio:
// devuelve lo observado y el spec asevera (tests/helpers/pom-no-business-asserts.unit.ts).
import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/** Alta observada del popover: request real, status y cuerpo de `POST carriers/{id}/waypoint`. */
export type PopoverSaveResult = {
  status: number;
  requestBody: { name: string; reference: string | null; latitude: number; longitude: number };
  body: {
    waypoint: { id: number; name: string; reference: string | null; placeId: string };
    warnings: string[];
  };
};

/** `POST carriers/{id}/waypoint` (sin id al final), con o sin query. */
export const WAYPOINT_CREATE_URL = /(?:^|\/)carriers\/\d+\/waypoint(?:\?.*)?$/;

export class QuickReferencePointPopoverPage {
  readonly popover: Locator;
  readonly title: Locator;
  readonly nameInput: Locator;
  readonly referenceInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  /** Indicador de carga de «Save» mientras el alta esta en vuelo (`.spinner-border`). */
  readonly saveSpinner: Locator;
  /** Todos los toasts SweetAlert2 visibles. */
  readonly swalToasts: Locator;

  constructor(private readonly page: Page) {
    this.popover = page.locator('.nt-waypoint-popover');
    this.title = this.popover.locator('#ntWaypointPopoverTitle');
    this.nameInput = this.popover.locator('#ntWaypointName');
    this.referenceInput = this.popover.locator('#ntWaypointReference');
    this.saveButton = this.popover.locator('#ntWaypointSave');
    this.cancelButton = this.popover.locator('#ntWaypointCancel');
    this.saveSpinner = this.saveButton.locator('.spinner-border');
    this.swalToasts = page.locator('.swal2-popup');
  }

  /** Toast SweetAlert2 cuyo texto cumple `text` (se asevera en el spec con `toBeVisible`). */
  toast(text: RegExp): Locator {
    return this.swalToasts.filter({ hasText: text });
  }

  /** Escribe Nombre y Referencia (opcional) en el popover abierto. `fill` escribe el texto completo (el límite de maxlength no está medido para `fill`). */
  async fill({ name, reference }: { name: string; reference?: string }): Promise<void> {
    await this.nameInput.fill(name);
    if (reference !== undefined) await this.referenceInput.fill(reference);
  }

  /** Espera el alta real (`POST carriers/{id}/waypoint`) que dispare `trigger`. */
  async captureCreate(trigger: () => Promise<void>): Promise<PopoverSaveResult> {
    const responsePromise = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && WAYPOINT_CREATE_URL.test(r.url()),
      { timeout: 20_000 }
    );
    responsePromise.catch(() => undefined);
    await trigger();
    const response: Response = await responsePromise;
    return {
      status: response.status(),
      requestBody: response.request().postDataJSON() as PopoverSaveResult['requestBody'],
      body: (await response.json()) as PopoverSaveResult['body']
    };
  }

  /** Nombre (+ Referencia) y «Save» con UN click; devuelve el alta observada. */
  async fillAndSave(input: { name: string; reference?: string }): Promise<PopoverSaveResult> {
    await this.fill(input);
    return this.captureCreate(() => this.saveButton.click());
  }

  /** Guarda con el popover abierto y confirma que se cerro (guarda tecnica de estado de la UI). */
  async expectClosed(): Promise<void> {
    await expect(this.popover).toBeHidden();
  }
}
