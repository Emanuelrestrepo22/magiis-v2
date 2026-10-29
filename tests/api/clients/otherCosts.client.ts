// tests/api/clients/otherCosts.client.ts
// Cliente de Otros Costos del carrier (precondiciones y oraculo de catalogo; no es objetivo de test).
// Endpoints (front v2.0.17, rutas relativas a src/app/):
// - search: POST carriers/{carrierId}/otherCosts/search
//   body del ABM {carrierId, name:'', type:'', apply:null, serviceTypeId:null}
//   (pages/carrier/settings/otherCosts/settings-otherCosts.component.ts:272-273).
// - new:    POST carriers/{carrierId}/otherCosts/new (settings-otherCosts.component.ts:707-711);
//   la respuesta trae el concepto creado con su id (captura de red F1-R24P-TM996-network-body.md).
// - delete: POST carriers/{carrierId}/otherCosts/delete body {carrierId, id, userId}
//   (settings-otherCosts.component.ts:767-772).
// Guardas: solo crea y borra conceptos con el prefijo de la automatizacion y NUNCA toca los
// conceptos preexistentes 27, 34 y 38 del carrier 1481.
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendOk, type CarrierSession } from './carrierSession.js';
import {
  isSweepCandidate,
  OTHER_COST_NAME_PREFIX,
  type OtherCostApply,
  type OtherCostPayload
} from '../../fixtures/factories/otherCostFactory.js';

/** Conceptos preexistentes del carrier 1481 que la automatizacion nunca edita ni borra. */
export const PROTECTED_OTHER_COST_IDS: readonly number[] = [27, 34, 38];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fila de `otherCosts/search` (y respuesta de `new`). */
export type OtherCostItem = {
  id: number;
  concept: string;
  conceptType: string;
  conceptValue: number | null;
  maxValue: number | null;
  apply: OtherCostApply[];
  isCommisionable: boolean;
  isByCost: boolean;
  conceptValueCost: number | null;
  maxCostValue: number | null;
  currency: { currencyId: number; code: string; symbol: string } | null;
  [extra: string]: unknown;
};

function assertOwnedName(name: string): void {
  if (!name.startsWith(OTHER_COST_NAME_PREFIX)) {
    throw new Error(
      `[otherCosts] el concepto «${name}» no tiene el prefijo «${OTHER_COST_NAME_PREFIX}»: no se toca`
    );
  }
}

function assertNotProtected(id: number): void {
  if (PROTECTED_OTHER_COST_IDS.includes(id)) {
    throw new Error(`[otherCosts] el concepto ${id} es preexistente y protegido: no se toca`);
  }
}

export class OtherCostsClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  private path(action: 'search' | 'new' | 'delete'): string {
    return `carriers/${this.session.carrierId}/otherCosts/${action}`;
  }

  /** Catalogo completo del carrier (solo lectura). */
  async search(): Promise<OtherCostItem[]> {
    const response = await sendOk('otherCosts/search', () =>
      this.api.post(this.path('search'), {
        data: {
          carrierId: String(this.session.carrierId),
          name: '',
          type: '',
          apply: null,
          serviceTypeId: null
        }
      })
    );
    const body = await readJson<unknown>(response);
    if (!Array.isArray(body)) {
      throw new Error('[otherCosts] search no devolvio un array');
    }
    return body as OtherCostItem[];
  }

  /** Busca un concepto por nombre exacto; falla si hay mas de uno con ese nombre. */
  async findByName(name: string): Promise<OtherCostItem | null> {
    const matches = (await this.search()).filter((item) => item.concept === name);
    if (matches.length > 1) {
      throw new Error(`[otherCosts] hay ${matches.length} conceptos con el nombre «${name}»`);
    }
    return matches[0] ?? null;
  }

  /**
   * Crea un concepto (payload de otherCostFactory) y devuelve la fila creada.
   * Usa el id de la respuesta; si no viniera, lo resuelve con search por nombre exacto.
   */
  async create(payload: OtherCostPayload): Promise<OtherCostItem> {
    assertOwnedName(payload.name);
    if (payload.carrierId !== this.session.carrierId) {
      throw new Error('[otherCosts] el carrierId del payload no es el de la sesion');
    }
    const response = await sendOk('otherCosts/new', () =>
      this.api.post(this.path('new'), { data: payload })
    );
    const created = await readJson<Partial<OtherCostItem>>(response);
    if (created && typeof created.id === 'number' && created.concept === payload.name) {
      return created as OtherCostItem;
    }
    const found = await this.findByName(payload.name);
    if (!found) {
      throw new Error(`[otherCosts] new respondio OK pero «${payload.name}» no aparece en search`);
    }
    return found;
  }

  /**
   * Da de baja un concepto propio. Antes confirma por search que el id existe y lleva el prefijo.
   * Devuelve false si el concepto ya no estaba (limpieza idempotente).
   */
  async remove(id: number): Promise<boolean> {
    assertNotProtected(id);
    const current = (await this.search()).find((item) => item.id === id);
    if (!current) return false;
    assertOwnedName(current.concept);
    await sendOk('otherCosts/delete', () =>
      this.api.post(this.path('delete'), {
        data: { carrierId: this.session.carrierId, id, userId: this.session.subUserId }
      })
    );
    return true;
  }

  /**
   * Borra conceptos de la automatizacion con mas de `olderThanMs` (default 24 h), leyendo la
   * edad del runId del nombre. Nunca toca nombres sin el formato de otherCostFactory.
   */
  async sweep(olderThanMs: number = DAY_MS, now: number = Date.now()): Promise<number[]> {
    const stale = (await this.search()).filter(
      (item) =>
        !PROTECTED_OTHER_COST_IDS.includes(item.id) &&
        isSweepCandidate(item.concept, now, olderThanMs)
    );
    const removed: number[] = [];
    for (const item of stale) {
      if (await this.remove(item.id)) removed.push(item.id);
    }
    return removed;
  }
}
