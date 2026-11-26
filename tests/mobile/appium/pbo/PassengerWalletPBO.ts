/**
 * PassengerWalletPBO — billetera del pasajero desde la app (PAX): abrirla, leerla, agregar UNA tarjeta de prueba y
 * eliminar SOLO la tarjeta que esta misma corrida agregó. Compone `SideMenuScreen`, `WalletScreen`,
 * `WalletCardRowsScreen` y `WalletCardFormScreen`; NO tiene locators ni lee `process.env`.
 *
 * Seguridad (la cuenta PAX de TEST es compartida y trae tarjetas ajenas):
 *  - `addCard` y `deleteOwnCard` son IRREVERSIBLES y exigen `{ confirmed: true }` (`assertConfirmed`) antes de leer
 *    o tocar la pantalla.
 *  - `addCard` solo sigue si el last4 NO está en la lista (no hay forma de probar la propiedad de una tarjeta que ya
 *    estaba) y registra ese last4 como «agregado por esta corrida» justo antes de tocar «Guardar».
 *  - `deleteOwnCard` rechaza cualquier last4 que NO haya registrado `addCard` en esta misma instancia, cualquier
 *    last4 repetido y cualquier tarjeta «Principal» (salvo que sea la única fila). No existe «borrar todas» ni
 *    «borrar la primera» (V1 tenía `cleanWallet` / `deleteAllVisibleCards` / `deleteFirstVisibleCard`: NO se portaron).
 *  - En develop eliminar NO pide confirmación (el tap en el tacho elimina): por eso el único freno es este PBO.
 *
 * Relevado del código (`magiis-mobile-passenger-v2@develop`); validación en vivo pendiente (login PAX bloqueado por
 * FCM en emuladores).
 */

import type { MobileSession } from '../core/MobileSession.js';
import { tryUntil } from '../core/Waits.js';
import { SideMenuScreen } from '../screens/passenger/SideMenuScreen.js';
import {
  WalletCardFormScreen,
  type WalletCardInput
} from '../screens/passenger/WalletCardFormScreen.js';
import {
  WalletCardRowsScreen,
  type TrashResult
} from '../screens/passenger/WalletCardRowsScreen.js';
import { WalletScreen, type AddButtonInfo } from '../screens/passenger/WalletScreen.js';
import {
  isAddSuccessText,
  isWalletUrl,
  last4Of,
  parseRemovalToast,
  sameLast4Multiset,
  type WalletCardRow
} from '../screens/passenger/walletParsing.js';
import {
  assertConfirmed,
  IrreversibleNotConfirmedError,
  type IrreversibleOptions
} from './OfferPBO.js';

export { IrreversibleNotConfirmedError };
export type { IrreversibleOptions, WalletCardInput };

// ───────────────────────────── errores ─────────────────────────────

/** No se pudo llegar a la pantalla «Billetera» o no terminó de cargar. No se tocó ninguna tarjeta. */
export class WalletNotReachableError extends Error {
  constructor(detail: string) {
    super(`[PassengerWalletPBO] no se pudo abrir la billetera: ${detail}.`);
    this.name = 'WalletNotReachableError';
  }
}

/** El last4 de prueba YA estaba en la billetera: no se puede probar que sea nuestra, no se agrega ni se borra. */
export class WalletOwnershipError extends Error {
  constructor(readonly last4: string) {
    super(
      `[PassengerWalletPBO] ya existe una tarjeta terminada en ${last4}: no se puede probar que sea de esta corrida. ` +
        'No se agregó ni se eliminó nada.'
    );
    this.name = 'WalletOwnershipError';
  }
}

export type WalletAddStage =
  | 'add-button'
  | 'form-open'
  | 'gateway'
  | 'fill'
  | 'save'
  | 'rejected'
  | '3ds'
  | 'not-listed'
  | 'unexpected-change';

/** El alta falló en `stage`. Si ya se tocó «Guardar», la tarjeta PUEDE existir (el spec limpia en `finally`). */
export class WalletAddFailedError extends Error {
  constructor(
    readonly stage: WalletAddStage,
    detail: string
  ) {
    super(`[PassengerWalletPBO] el alta de la tarjeta falló en «${stage}»: ${detail}.`);
    this.name = 'WalletAddFailedError';
  }
}

export type WalletDeleteRefusal = 'not-owned' | 'ambiguous' | 'default-refused';

/** Eliminación rechazada ANTES de tocar nada. */
export class WalletDeleteRefusedError extends Error {
  constructor(
    readonly reason: WalletDeleteRefusal,
    readonly last4: string
  ) {
    super(
      `[PassengerWalletPBO] no se elimina la tarjeta terminada en ${last4}: ${
        reason === 'not-owned'
          ? 'no la agregó esta corrida'
          : reason === 'ambiguous'
            ? 'hay más de una fila con ese last4'
            : 'es la tarjeta Principal y hay otras'
      }.`
    );
    this.name = 'WalletDeleteRefusedError';
  }
}

/** Se tocó (o se intentó tocar) el tacho pero la baja no se pudo confirmar. */
export class WalletDeleteFailedError extends Error {
  constructor(
    readonly last4: string,
    detail: string
  ) {
    super(
      `[PassengerWalletPBO] la baja de la tarjeta terminada en ${last4} no se confirmó: ${detail}.`
    );
    this.name = 'WalletDeleteFailedError';
  }
}

// ───────────────────────────── plan puro ─────────────────────────────

export type WalletWriteRunInput = {
  /** Opt-in explícito (`PAX_WALLET_WRITE=1`), leído por el SPEC y pasado como booleano. */
  gateOpen: boolean;
  /** Entorno de la app (`test`|`uat`|`prod`|...). Las escrituras solo corren en `test`. */
  environment: string;
  /** last4 de las tarjetas que la billetera ya muestra (pre-chequeo de solo lectura). */
  existingLast4: readonly string[];
  /** last4 de la tarjeta de prueba que se agregaría. */
  testCardLast4: string;
  /** Cantidad de tarjetas visibles. */
  cardCount: number;
  /** Tope de tarjetas si se conoce (la app no define uno en develop; `undefined` = sin tope conocido). */
  maxCards?: number;
};
export type WalletWriteRunPlan = { proceed: true } | { proceed: false; reason: string };

/**
 * Pura: decide si el spec puede AGREGAR (y luego eliminar) la tarjeta de prueba. Cerrada ante cualquier faltante,
 * con el motivo. Una tarjeta con el mismo last4 ya presente es ajena (o resto de una corrida anterior): NUNCA se
 * agrega ni se elimina.
 */
export function planWalletWriteRun(input: WalletWriteRunInput): WalletWriteRunPlan {
  const missing: string[] = [];
  if (input.gateOpen !== true) missing.push('la compuerta explícita (opt-in) no está abierta');
  if (input.environment !== 'test') {
    missing.push(
      `el entorno es «${input.environment}» y los flujos de escritura solo corren en test`
    );
  }
  if (input.existingLast4.includes(input.testCardLast4)) {
    missing.push(
      `ya existe una tarjeta terminada en ${input.testCardLast4} y no se puede probar que sea de esta corrida`
    );
  }
  if (typeof input.maxCards === 'number' && input.cardCount >= input.maxCards) {
    missing.push(
      `la billetera ya está en el tope de ${input.maxCards} tarjetas (hay ${input.cardCount})`
    );
  }
  return missing.length === 0
    ? { proceed: true }
    : {
        proceed: false,
        reason: `No se agrega ni se elimina ninguna tarjeta: ${missing.join(' y ')}.`
      };
}

export type CardDeletePlan =
  | { action: 'delete'; index: number; allowDefault: boolean }
  | { action: 'absent' }
  | { action: 'refuse'; reason: Exclude<WalletDeleteRefusal, 'not-owned'> };

/**
 * Pura: decide si se puede eliminar la fila con `last4`. `absent` si no está; `refuse` si hay más de una fila con ese
 * last4 o si es «Principal» y hay otras tarjetas. Una «Principal» que es la ÚNICA fila se permite (el alta en una
 * billetera vacía puede dejarla como principal).
 */
export function planCardDelete(rows: readonly WalletCardRow[], last4: string): CardDeletePlan {
  const matches = rows.filter((r) => r.last4 === last4);
  if (matches.length === 0) return { action: 'absent' };
  if (matches.length > 1) return { action: 'refuse', reason: 'ambiguous' };
  const row = matches[0]!;
  if (row.isDefault && rows.length > 1) return { action: 'refuse', reason: 'default-refused' };
  return { action: 'delete', index: row.index, allowDefault: row.isDefault };
}

// ───────────────────────────── PBO ─────────────────────────────

export type WalletSnapshot = {
  url: string;
  onWallet: boolean;
  rows: WalletCardRow[];
  emptyVisible: boolean;
  addButtons: AddButtonInfo[];
};

export type WalletPboDeps = {
  menu: Pick<SideMenuScreen, 'open'>;
  wallet: Pick<
    WalletScreen,
    'url' | 'tapMenuEntry' | 'readAddButtons' | 'tapAdd' | 'isEmptyStateVisible' | 'readToasts'
  >;
  rows: Pick<WalletCardRowsScreen, 'readRows' | 'tapTrashAt'>;
  form: Pick<
    WalletCardFormScreen,
    'isOpen' | 'kind' | 'dismiss' | 'fillStripe' | 'isSaveEnabled' | 'tapSave' | 'readOutcome'
  >;
};

export type WalletAddResult = {
  last4: string;
  before: WalletSnapshot;
  after: WalletSnapshot;
  /** Toast de alta visto (informativo; `null` si no se alcanzó a leer). */
  toast: string | null;
};

export type WalletDeleteResult =
  | { removed: false; reason: 'absent' }
  | { removed: true; before: WalletSnapshot; remaining: WalletCardRow[]; toast: string | null };

const signature = (s: WalletSnapshot): string =>
  JSON.stringify([s.onWallet, s.emptyVisible, s.rows.map((r) => [r.label, r.isDefault])]);

export class PassengerWalletPBO {
  private readonly log: (message: string) => void;
  private readonly pollIntervalMs: number;
  private readonly timeoutScale: number;
  /** last4 que ESTA instancia agregó (o estuvo a punto de agregar): los únicos eliminables. */
  private readonly owned = new Set<string>();

  constructor(
    private readonly deps: WalletPboDeps,
    options: {
      log?: (message: string) => void;
      pollIntervalMs?: number;
      timeoutScale?: number;
    } = {}
  ) {
    this.log = options.log ?? ((m) => console.info(m));
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.timeoutScale = options.timeoutScale ?? 1;
  }

  /** Escala los topes internos de espera (solo los unit los reducen). */
  private t(ms: number): number {
    return Math.max(1, Math.round(ms * this.timeoutScale));
  }

  static forSession(session: MobileSession, log?: (message: string) => void): PassengerWalletPBO {
    return new PassengerWalletPBO(
      {
        menu: new SideMenuScreen(session),
        wallet: new WalletScreen(session),
        rows: new WalletCardRowsScreen(session),
        form: new WalletCardFormScreen(session)
      },
      { log }
    );
  }

  /** last4 que esta instancia puede eliminar. */
  get ownedLast4(): string[] {
    return [...this.owned];
  }

  /** SOLO LECTURA: una lectura instantánea de la pantalla. */
  async readSnapshot(): Promise<WalletSnapshot> {
    const url = await this.deps.wallet.url();
    const [rows, emptyVisible, addButtons] = await Promise.all([
      this.deps.rows.readRows(),
      this.deps.wallet.isEmptyStateVisible(),
      this.deps.wallet.readAddButtons()
    ]);
    return { url, onWallet: isWalletUrl(url), rows, emptyVisible, addButtons };
  }

  /**
   * SOLO LECTURA: espera una lectura ESTABLE (`stableReads` seguidas iguales con filas o estado vacío). El estado
   * vacío se pinta antes de que lleguen las tarjetas (`cardList` arranca en `[]`): por eso no se confía en una sola
   * lectura.
   */
  async readStableSnapshot(
    options: { timeoutMs?: number; stableReads?: number } = {}
  ): Promise<WalletSnapshot> {
    const stableReads = options.stableReads ?? 3;
    let last: WalletSnapshot | null = null;
    let streak = 0;
    const stable = await tryUntil(
      async () => {
        const s = await this.readSnapshot();
        streak = last && signature(last) === signature(s) ? streak + 1 : 1;
        last = s;
        return s.onWallet && (s.rows.length > 0 || s.emptyVisible) && streak >= stableReads
          ? s
          : null;
      },
      {
        timeout: options.timeoutMs ?? 20_000,
        interval: this.pollIntervalMs,
        label: 'lectura estable de la billetera'
      }
    );
    if (!stable) {
      const s = last as WalletSnapshot | null;
      throw new WalletNotReachableError(
        `la pantalla no se estabilizó (url: ${s?.url || 'n/d'}, filas: ${s?.rows.length ?? 'n/d'}, vacío: ${s?.emptyVisible ?? 'n/d'})`
      );
    }
    return stable;
  }

  /** Cierra el formulario de alta si quedó abierto (flecha atrás, sin guardar; reversible). */
  async closeFormIfOpen(): Promise<boolean> {
    if (!(await this.deps.form.isOpen())) return false;
    return this.deps.form.dismiss();
  }

  /** Abre «Billetera» desde el menú lateral (si ya está en `/cards`, solo lee). Devuelve una lectura estable. */
  async openWallet(options: { timeoutMs?: number } = {}): Promise<WalletSnapshot> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!isWalletUrl(await this.deps.wallet.url())) {
      let entry: Awaited<ReturnType<WalletScreen['tapMenuEntry']>> = 'not-found';
      const tapped = await tryUntil(
        async () => {
          await this.deps.menu.open();
          entry = await this.deps.wallet.tapMenuEntry();
          if (entry === 'disabled') return 'disabled';
          return entry === 'tapped' ? 'tapped' : null;
        },
        { timeout: 15_000, interval: this.pollIntervalMs, label: 'ítem «Billetera» del menú' }
      );
      if (tapped === 'disabled') {
        throw new WalletNotReachableError(
          'el ítem «Billetera» está deshabilitado (el carrier activo no tiene mpMagiisPublicKey)'
        );
      }
      if (!tapped) throw new WalletNotReachableError(`no se pudo tocar «Billetera» (${entry})`);
      const arrived = await tryUntil(async () => isWalletUrl(await this.deps.wallet.url()), {
        timeout: 15_000,
        interval: this.pollIntervalMs,
        label: 'URL /cards'
      });
      if (!arrived) throw new WalletNotReachableError('la app no navegó a /cards');
    }
    return this.readStableSnapshot({ timeoutMs });
  }

  /**
   * Agrega UNA tarjeta de prueba por el formulario de Stripe (IRREVERSIBLE: crea la tarjeta). Exige
   * `{ confirmed: true }` y que el last4 NO esté ya en la lista. Devuelve tras ver la tarjeta en la lista y
   * comprobar que las demás no cambiaron. No maneja 3DS (usar tarjetas sin desafío): ante un desafío falla con
   * `stage: '3ds'`. El last4 queda registrado como propio justo antes de tocar «Guardar».
   */
  async addCard(
    card: WalletCardInput,
    options: IrreversibleOptions,
    extra: { timeoutMs?: number } = {}
  ): Promise<WalletAddResult> {
    assertConfirmed(options, 'Agregar una tarjeta a la billetera');
    const timeoutMs = extra.timeoutMs ?? 45_000;
    const last4 = last4Of(card.number);
    if (!last4)
      throw new WalletAddFailedError('add-button', 'el número de tarjeta no tiene 4 dígitos');

    const before = await this.readStableSnapshot();
    if (before.rows.some((r) => r.last4 === last4)) throw new WalletOwnershipError(last4);

    const tapped = await this.deps.wallet.tapAdd();
    if (tapped !== 'tapped') {
      throw new WalletAddFailedError(
        'add-button',
        tapped === 'disabled'
          ? 'el botón «Agregar» está deshabilitado (país distinto al del carrier activo)'
          : 'no se encontró el botón «Agregar»'
      );
    }
    const opened = await tryUntil(() => this.deps.form.isOpen(), {
      timeout: this.t(20_000),
      interval: this.pollIntervalMs,
      label: 'formulario de tarjeta'
    });
    if (!opened) throw new WalletAddFailedError('form-open', 'el formulario no se abrió');

    const kind = await tryUntil(
      async () => {
        const k = await this.deps.form.kind();
        return k === 'none' ? null : k;
      },
      { timeout: this.t(20_000), interval: this.pollIntervalMs, label: 'tipo de formulario' }
    );
    if (kind !== 'stripe') {
      await this.deps.form.dismiss();
      throw new WalletAddFailedError(
        'gateway',
        kind === 'native'
          ? 'el carrier activo no usa Stripe (formulario nativo): fuera de alcance'
          : 'el formulario no terminó de montar'
      );
    }

    try {
      await this.deps.form.fillStripe(card);
    } catch (error) {
      await this.deps.form.dismiss();
      throw new WalletAddFailedError(
        'fill',
        error instanceof Error ? error.message : String(error)
      );
    }
    const enabled = await tryUntil(() => this.deps.form.isSaveEnabled(), {
      timeout: this.t(10_000),
      interval: this.pollIntervalMs,
      label: '«Guardar» habilitado'
    });
    if (!enabled) {
      await this.deps.form.dismiss();
      throw new WalletAddFailedError('save', '«Guardar» no se habilitó con el formulario completo');
    }

    // A partir de acá la tarjeta PUEDE existir: queda registrada como propia para poder limpiarla.
    this.owned.add(last4);
    const saved = await this.deps.form.tapSave();
    if (saved !== 'tapped')
      throw new WalletAddFailedError('save', `no se pudo tocar «Guardar» (${saved})`);

    const outcome = await tryUntil(
      async () => {
        const o = await this.deps.form.readOutcome();
        return o.state === 'open' ? null : o;
      },
      { timeout: this.t(timeoutMs), interval: this.pollIntervalMs, label: 'resultado del alta' }
    );
    if (!outcome) throw new WalletAddFailedError('save', 'el formulario no respondió al submit');
    if (outcome.state === 'error') throw new WalletAddFailedError('rejected', outcome.text);
    if (outcome.state === 'challenge') {
      throw new WalletAddFailedError(
        '3ds',
        'Stripe pidió un desafío 3DS (usar una tarjeta sin 3DS)'
      );
    }

    const listed = await tryUntil(
      async () => (await this.deps.rows.readRows()).some((r) => r.last4 === last4),
      {
        timeout: this.t(20_000),
        interval: this.pollIntervalMs,
        label: `tarjeta ${last4} en la lista`
      }
    );
    if (!listed)
      throw new WalletAddFailedError('not-listed', `la tarjeta ${last4} no apareció en la lista`);

    const after = await this.readStableSnapshot();
    const others = after.rows.filter((r) => r.last4 !== last4);
    const added = after.rows.length - before.rows.length;
    if (added !== 1 || !sameLast4Multiset(others, before.rows)) {
      throw new WalletAddFailedError(
        'unexpected-change',
        `el alta debía sumar exactamente 1 fila sin alterar las demás (antes ${before.rows.length}, después ${after.rows.length})`
      );
    }
    const toasts = await this.deps.wallet.readToasts();
    const toast = toasts.find(isAddSuccessText) ?? null;
    this.log(`[PassengerWalletPBO] Tarjeta ${last4} agregada (toast: ${toast ?? 'n/d'}).`);
    return { last4, before, after, toast };
  }

  /**
   * Elimina la tarjeta `last4` SI Y SOLO SI la agregó esta instancia (IRREVERSIBLE; en develop no hay diálogo de
   * confirmación). Exige `{ confirmed: true }`. `{ removed: false, reason: 'absent' }` si ya no está (idempotente
   * para el `finally`). Rechaza last4 repetido o «Principal» con otras tarjetas. Devuelve tras ver desaparecer la
   * fila y comprobar que las demás no cambiaron.
   */
  async deleteOwnCard(
    last4: string,
    options: IrreversibleOptions,
    extra: { timeoutMs?: number } = {}
  ): Promise<WalletDeleteResult> {
    assertConfirmed(options, `Eliminar la tarjeta terminada en ${last4} de la billetera`);
    if (!this.owned.has(last4)) throw new WalletDeleteRefusedError('not-owned', last4);

    const before = await this.readStableSnapshot();
    const plan = planCardDelete(before.rows, last4);
    if (plan.action === 'absent') return { removed: false, reason: 'absent' };
    if (plan.action === 'refuse') throw new WalletDeleteRefusedError(plan.reason, last4);

    const result: TrashResult = await this.deps.rows.tapTrashAt(
      plan.index,
      last4,
      plan.allowDefault
    );
    if (result === 'ambiguous' || result === 'default-refused') {
      throw new WalletDeleteRefusedError(result, last4);
    }
    if (result !== 'tapped') {
      throw new WalletDeleteFailedError(last4, `no se tocó el tacho (${result})`);
    }

    const remaining = await tryUntil(
      async () => {
        const rows = await this.deps.rows.readRows();
        return rows.some((r) => r.last4 === last4) ? null : rows;
      },
      {
        timeout: extra.timeoutMs ?? 20_000,
        interval: this.pollIntervalMs,
        label: `baja de la tarjeta ${last4}`
      }
    );
    if (!remaining) throw new WalletDeleteFailedError(last4, 'la fila sigue en la lista');
    const expected = before.rows.filter((r) => r.last4 !== last4);
    if (!sameLast4Multiset(remaining, expected)) {
      throw new WalletDeleteFailedError(
        last4,
        `las demás tarjetas cambiaron (esperadas ${expected.length}, vistas ${remaining.length})`
      );
    }
    const toasts = await this.deps.wallet.readToasts();
    const toast = toasts.find((t) => parseRemovalToast(t) === last4) ?? null;
    this.log(`[PassengerWalletPBO] Tarjeta ${last4} eliminada (toast: ${toast ?? 'n/d'}).`);
    return { removed: true, before, remaining, toast };
  }
}
