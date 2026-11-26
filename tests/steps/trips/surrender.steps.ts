// tests/steps/trips/surrender.steps.ts
// Pasos reusables de la rendicion de un lote (plan carrier Francia, etapa 3a/3b).
// Reglas: cada metodo es atomico (ninguno llama a otro; la secuencia la orquesta el spec); la
// lectura nunca escribe; la confirmacion esta gateada por FR_CONFIRM_SURRENDER=1 en el POM.
import type { Page } from '@playwright/test';
import type {
  SurrenderBatch,
  SurrenderClient,
  SurrenderReceiptDownload
} from '../../api/clients/surrender.client.js';
import {
  SurrenderPage,
  type SurrenderUiPreview
} from '../../pages/carrier-v2/pay/SurrenderPage.js';
import { previewTravelIds } from '../../helpers/surrender-oracle.js';

export class SurrenderFlow {
  readonly surrenderPage: SurrenderPage;

  constructor(
    page: Page,
    private readonly client: SurrenderClient
  ) {
    this.surrenderPage = new SurrenderPage(page);
  }

  /** UI: abre pendientes, entra al lote y lee la vista previa (solo lectura). */
  async readUiPreview(batch: SurrenderBatch): Promise<SurrenderUiPreview> {
    await this.surrenderPage.openPending();
    await this.surrenderPage.selectBatch(batch);
    return this.surrenderPage.readPreview();
  }

  /** API: ids del lote por GET toSurrend (solo lectura). */
  async readApiBatchIds(batch: SurrenderBatch): Promise<number[]> {
    const preview = await this.client.preview(batch);
    return previewTravelIds(preview.rows);
  }

  /** IRREVERSIBLE (gate FR_CONFIRM_SURRENDER=1 dentro del POM): confirma y devuelve el status. */
  async confirm(): Promise<number> {
    return this.surrenderPage.confirm();
  }

  /** Body JSON que el front mando en el POST del confirm() (importes de la rendicion; solo lectura). */
  readConfirmBody(): Record<string, unknown> | null {
    return this.surrenderPage.readConfirmRequestBody();
  }

  /** Comprobante de la rendicion: el PDF del confirm() y la copia guardada (solo lectura). */
  async readReceipt(surrenderId: number): Promise<SurrenderReceiptFacts> {
    const stored = await this.client.downloadReceipt(surrenderId);
    return { inline: this.surrenderPage.readConfirmReceipt(), stored };
  }
}

export type SurrenderReceiptFacts = {
  inline: Buffer | null;
  stored: SurrenderReceiptDownload;
};
