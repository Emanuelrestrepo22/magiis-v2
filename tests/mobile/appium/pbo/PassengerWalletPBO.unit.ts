// Unit de PassengerWalletPBO con screens fake (sin Appium): plan de escritura, plan de baja, gate de
// irreversibilidad, propiedad de la tarjeta y comprobación de «las demás no cambiaron».
// Run: npx tsx --test tests/mobile/appium/pbo/PassengerWalletPBO.unit.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FormOutcome } from '../screens/passenger/WalletCardFormScreen.js';
import type { TrashResult } from '../screens/passenger/WalletCardRowsScreen.js';
import type { WalletCardRow } from '../screens/passenger/walletParsing.js';
import {
  IrreversibleNotConfirmedError,
  PassengerWalletPBO,
  WalletAddFailedError,
  WalletDeleteFailedError,
  WalletDeleteRefusedError,
  WalletOwnershipError,
  planCardDelete,
  planWalletWriteRun,
  type WalletCardInput,
  type WalletPboDeps
} from './PassengerWalletPBO.js';

const row = (index: number, last4: string, isDefault = false): WalletCardRow => ({
  index,
  label: `VISA ...${last4}`,
  brand: 'VISA',
  last4,
  isDefault,
  expired: false
});

const CARD: WalletCardInput = {
  number: '5200828282828210',
  expiry: '12/34',
  cvc: '123',
  holderName: 'QA Wallet Test'
};
const OTHERS = [row(0, '1111', true), row(1, '2222')];

// ───────── planWalletWriteRun ─────────

const baseInput = {
  gateOpen: true,
  environment: 'test',
  existingLast4: ['1111', '2222'],
  testCardLast4: '8210',
  cardCount: 2
};

test('plan: todo en regla -> proceed', () => {
  assert.deepEqual(planWalletWriteRun(baseInput), { proceed: true });
});

test('plan: compuerta cerrada, entorno uat/prod -> no procede, con motivo', () => {
  const closed = planWalletWriteRun({ ...baseInput, gateOpen: false });
  assert.equal(closed.proceed, false);
  assert.match(closed.proceed ? '' : closed.reason, /compuerta explícita/);
  for (const environment of ['uat', 'prod', 'production', '']) {
    const p = planWalletWriteRun({ ...baseInput, environment });
    assert.equal(p.proceed, false, environment);
    assert.match(p.proceed ? '' : p.reason, /solo corren en test/);
  }
});

test('plan: ya existe una tarjeta con el last4 de prueba -> se saltea (no se puede probar propiedad)', () => {
  const p = planWalletWriteRun({ ...baseInput, existingLast4: ['1111', '8210'] });
  assert.equal(p.proceed, false);
  assert.match(p.proceed ? '' : p.reason, /terminada en 8210/);
});

test('plan: billetera en el tope -> se saltea; sin tope conocido -> procede', () => {
  const atLimit = planWalletWriteRun({ ...baseInput, maxCards: 2 });
  assert.equal(atLimit.proceed, false);
  assert.match(atLimit.proceed ? '' : atLimit.reason, /tope de 2 tarjetas/);
  assert.deepEqual(planWalletWriteRun({ ...baseInput, maxCards: 3 }), { proceed: true });
  assert.deepEqual(planWalletWriteRun({ ...baseInput, cardCount: 40 }), { proceed: true });
});

test('plan: acumula todos los motivos', () => {
  const p = planWalletWriteRun({
    ...baseInput,
    gateOpen: false,
    environment: 'uat',
    existingLast4: ['8210']
  });
  assert.equal(p.proceed, false);
  const reason = p.proceed ? '' : p.reason;
  assert.match(reason, /compuerta/);
  assert.match(reason, /uat/);
  assert.match(reason, /8210/);
});

// ───────── planCardDelete ─────────

test('planCardDelete: delete / absent / ambiguous / default con otras / default única', () => {
  assert.deepEqual(planCardDelete([...OTHERS, row(2, '8210')], '8210'), {
    action: 'delete',
    index: 2,
    allowDefault: false
  });
  assert.deepEqual(planCardDelete(OTHERS, '8210'), { action: 'absent' });
  assert.deepEqual(planCardDelete([row(0, '8210'), row(1, '8210')], '8210'), {
    action: 'refuse',
    reason: 'ambiguous'
  });
  assert.deepEqual(planCardDelete([row(0, '1111'), row(1, '8210', true)], '8210'), {
    action: 'refuse',
    reason: 'default-refused'
  });
  assert.deepEqual(planCardDelete([row(0, '8210', true)], '8210'), {
    action: 'delete',
    index: 0,
    allowDefault: true
  });
});

// ───────── PBO con fakes ─────────

type Sim = {
  rows: WalletCardRow[];
  formOpen: boolean;
  kind: 'stripe' | 'native' | 'none';
  outcome: FormOutcome;
  saveEnabled: boolean;
  trash: TrashResult;
  /** El tacho realmente borra la fila (si `trash === 'tapped'`). */
  trashRemoves: boolean;
  /** Tras guardar, la tarjeta aparece en la lista. */
  addListed: boolean;
  /** Tras guardar, además aparece una fila extra ajena (alta rara). */
  addExtraRow: boolean;
  calls: string[];
};

function build(over: Partial<Sim> = {}) {
  const sim: Sim = {
    rows: OTHERS.map((r) => ({ ...r })),
    formOpen: false,
    kind: 'stripe',
    outcome: { state: 'closed' },
    saveEnabled: true,
    trash: 'tapped',
    trashRemoves: true,
    addListed: true,
    addExtraRow: false,
    calls: [],
    ...over
  };
  const reindex = (): void => sim.rows.forEach((r, i) => (r.index = i));
  const deps: WalletPboDeps = {
    menu: { open: async () => true },
    wallet: {
      url: async () => 'http://x/cards',
      tapMenuEntry: async () => 'tapped',
      readAddButtons: async () => [{ label: 'AGREGAR', enabled: true }],
      tapAdd: async () => {
        sim.calls.push('tapAdd');
        sim.formOpen = true;
        return 'tapped';
      },
      isEmptyStateVisible: async () => sim.rows.length === 0,
      readToasts: async () => []
    },
    rows: {
      readRows: async () => sim.rows.map((r) => ({ ...r })),
      tapTrashAt: async (index, last4, allowDefault) => {
        sim.calls.push(`trash:${index}:${last4}:${allowDefault}`);
        if (sim.trash === 'tapped' && sim.trashRemoves) {
          sim.rows = sim.rows.filter((r) => r.index !== index);
          reindex();
        }
        return sim.trash;
      }
    },
    form: {
      isOpen: async () => sim.formOpen,
      kind: async () => sim.kind,
      dismiss: async () => {
        sim.calls.push('dismiss');
        sim.formOpen = false;
        return true;
      },
      fillStripe: async () => void sim.calls.push('fill'),
      isSaveEnabled: async () => sim.saveEnabled,
      tapSave: async () => {
        sim.calls.push('save');
        if (sim.addListed) {
          sim.rows.push(row(sim.rows.length, '8210'));
          if (sim.addExtraRow) sim.rows.push(row(sim.rows.length, '9999'));
          reindex();
        }
        sim.formOpen = false;
        return 'tapped';
      },
      readOutcome: async () => sim.outcome
    }
  };
  return {
    pbo: new PassengerWalletPBO(deps, {
      log: () => undefined,
      pollIntervalMs: 1,
      timeoutScale: 0.005
    }),
    sim
  };
}

test('gate: addCard y deleteOwnCard sin { confirmed: true } lanzan ANTES de tocar nada', async () => {
  const { pbo, sim } = build();
  await assert.rejects(
    () => pbo.addCard(CARD, { confirmed: false }),
    IrreversibleNotConfirmedError
  );
  await assert.rejects(
    () => pbo.addCard(CARD, undefined as unknown as { confirmed: boolean }),
    IrreversibleNotConfirmedError
  );
  await assert.rejects(
    () => pbo.deleteOwnCard('8210', { confirmed: 'yes' } as unknown as { confirmed: boolean }),
    IrreversibleNotConfirmedError
  );
  assert.deepEqual(sim.calls, []);
});

test('alta feliz: AGREGAR -> llenar -> Guardar -> aparece sumando 1 fila, sin alterar las demás', async () => {
  const { pbo, sim } = build();
  const r = await pbo.addCard(CARD, { confirmed: true });
  assert.equal(r.last4, '8210');
  assert.equal(r.after.rows.length, r.before.rows.length + 1);
  assert.deepEqual(sim.calls, ['tapAdd', 'fill', 'save']);
  assert.deepEqual(pbo.ownedLast4, ['8210']);
});

test('alta: last4 ya presente -> WalletOwnershipError sin abrir el formulario ni registrar propiedad', async () => {
  const { pbo, sim } = build({ rows: [...OTHERS.map((r) => ({ ...r })), row(2, '8210')] });
  await assert.rejects(() => pbo.addCard(CARD, { confirmed: true }), WalletOwnershipError);
  assert.deepEqual(sim.calls, []);
  assert.deepEqual(pbo.ownedLast4, []);
});

test('alta: pasarela no Stripe -> falla en gateway, cierra el formulario y NO guarda', async () => {
  const { pbo, sim } = build({ kind: 'native' });
  await assert.rejects(
    () => pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) => e instanceof WalletAddFailedError && e.stage === 'gateway'
  );
  assert.ok(sim.calls.includes('dismiss') && !sim.calls.includes('save'));
  assert.deepEqual(pbo.ownedLast4, []);
});

test('alta: «Guardar» no se habilita -> no se guarda ni se registra propiedad', async () => {
  const { pbo, sim } = build({ saveEnabled: false });
  await assert.rejects(
    () => pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) => e instanceof WalletAddFailedError && e.stage === 'save'
  );
  assert.ok(!sim.calls.includes('save'));
  assert.deepEqual(pbo.ownedLast4, []);
});

test('alta: rechazo de Stripe / 3DS -> falla con la etapa y deja la propiedad registrada para limpiar', async () => {
  const rejected = build({
    outcome: { state: 'error', text: 'Your card was declined' },
    addListed: false
  });
  await assert.rejects(
    () => rejected.pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) => e instanceof WalletAddFailedError && e.stage === 'rejected'
  );
  assert.deepEqual(rejected.pbo.ownedLast4, ['8210']);
  const ds = build({ outcome: { state: 'challenge' }, addListed: false });
  await assert.rejects(
    () => ds.pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) => e instanceof WalletAddFailedError && e.stage === '3ds'
  );
});

test('alta: no aparece en la lista -> not-listed', async () => {
  const { pbo } = build({ addListed: false });
  await assert.rejects(
    () => pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) =>
      e instanceof WalletAddFailedError && (e.stage === 'not-listed' || e.stage === 'save')
  );
});

test('alta: una fila extra ajena -> unexpected-change', async () => {
  const { pbo } = build({ addExtraRow: true });
  await assert.rejects(
    () => pbo.addCard(CARD, { confirmed: true }),
    (e: unknown) => e instanceof WalletAddFailedError && e.stage === 'unexpected-change'
  );
});

test('baja: rechaza un last4 que esta instancia NO agregó (aunque exista en la lista)', async () => {
  const { pbo, sim } = build();
  await assert.rejects(
    () => pbo.deleteOwnCard('2222', { confirmed: true }),
    (e: unknown) => e instanceof WalletDeleteRefusedError && e.reason === 'not-owned'
  );
  assert.ok(!sim.calls.some((c) => c.startsWith('trash')));
  assert.equal(sim.rows.length, 2);
});

test('flujo completo: alta + baja deja las tarjetas ajenas exactamente como estaban', async () => {
  const { pbo, sim } = build();
  const added = await pbo.addCard(CARD, { confirmed: true });
  const removed = await pbo.deleteOwnCard('8210', { confirmed: true });
  assert.equal(removed.removed, true);
  assert.deepEqual(
    sim.rows.map((r) => r.last4),
    added.before.rows.map((r) => r.last4)
  );
  assert.ok(sim.calls.includes('trash:2:8210:false'));
});

test('baja: idempotente si la tarjeta ya no está (finally tras una baja exitosa)', async () => {
  const { pbo, sim } = build();
  await pbo.addCard(CARD, { confirmed: true });
  await pbo.deleteOwnCard('8210', { confirmed: true });
  const again = await pbo.deleteOwnCard('8210', { confirmed: true });
  assert.deepEqual(again, { removed: false, reason: 'absent' });
  assert.equal(sim.calls.filter((c) => c.startsWith('trash')).length, 1);
});

test('baja: si la tarjeta propia quedó como Principal con otras -> rechaza sin tocar', async () => {
  const { pbo, sim } = build();
  await pbo.addCard(CARD, { confirmed: true });
  sim.rows[2]!.isDefault = true;
  await assert.rejects(
    () => pbo.deleteOwnCard('8210', { confirmed: true }),
    (e: unknown) => e instanceof WalletDeleteRefusedError && e.reason === 'default-refused'
  );
  assert.ok(!sim.calls.some((c) => c.startsWith('trash')));
});

test('baja: el tacho no borra -> WalletDeleteFailedError', async () => {
  const { pbo } = build({ trashRemoves: false });
  await pbo.addCard(CARD, { confirmed: true });
  await assert.rejects(
    () => pbo.deleteOwnCard('8210', { confirmed: true }, { timeoutMs: 20 }),
    WalletDeleteFailedError
  );
});

test('baja: la verificación en el DOM rechaza (mismatch) -> falla sin asumir que borró', async () => {
  const { pbo } = build({ trash: 'mismatch' });
  await pbo.addCard(CARD, { confirmed: true });
  await assert.rejects(
    () => pbo.deleteOwnCard('8210', { confirmed: true }),
    WalletDeleteFailedError
  );
});

test('baja: si cambian las demás tarjetas al borrar -> WalletDeleteFailedError', async () => {
  const { pbo, sim } = build();
  await pbo.addCard(CARD, { confirmed: true });
  // simula que la app, además de la nuestra, perdió otra
  const original = sim.rows.slice();
  sim.trashRemoves = false;
  const reads = original.filter((r) => r.last4 === '1111');
  // el tacho «borra» devolviendo solo una de las ajenas
  const deps = (pbo as unknown as { deps: WalletPboDeps }).deps;
  deps.rows.tapTrashAt = async () => {
    sim.rows = reads.map((r, i) => ({ ...r, index: i }));
    return 'tapped';
  };
  await assert.rejects(
    () => pbo.deleteOwnCard('8210', { confirmed: true }),
    (e: unknown) =>
      e instanceof WalletDeleteFailedError && /demás tarjetas cambiaron/.test(e.message)
  );
});
