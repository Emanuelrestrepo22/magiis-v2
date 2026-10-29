// tests/steps/trips/editAfterSurrender.steps.ts
// Pasos de la edicion de precio de un viaje ya rendido (PB-1 modelo A, plan carrier Francia etapa 4).
// Atomicos (la secuencia la orquesta el spec). La edicion la hace la UI (TripEditPage, gateada por
// FR_EDIT_AFTER_SURRENDER=1); aqui solo se lee por API antes/despues; el spec aserta.
// La lectura de TRAVEL_MODIFICATIONS / TRAVELSSURRENDER / MOVEMENT es oraculo de DB (tests/db,
// fuera de este archivo).
import type { Page } from '@playwright/test';
import type { TravelsClient } from '../../api/clients/travels.client.js';
import {
  TripEditPage,
  type FinalPriceEditResult
} from '../../pages/carrier-v2/trips/TripEditPage.js';

export class EditAfterSurrenderFlow {
  constructor(private readonly travels: TravelsClient) {}

  /** Venta final del viaje (`amount` del detalle) por API, tal como la devuelve el backend (el spec la juzga). */
  async readFinalSale(travelId: number): Promise<number | null | undefined> {
    return (await this.travels.getDetail(travelId)).amount;
  }

  /** IRREVERSIBLE (gate en el POM): edita la tarifa por UI y devuelve lo observado en red. */
  async editFinalPrice(params: {
    page: Page;
    travelId: number;
    newAmount: number;
    reason: string;
  }): Promise<FinalPriceEditResult> {
    const { page, ...edit } = params;
    return new TripEditPage(page).updateFinalPrice(edit);
  }
}
