// tests/helpers/cc-delta.ts
// Delta de libros de cuenta corriente (CC cliente, libro de chofer, libro de propietario).
// Regla del plan (W1-4): se comparan DELTAS entre dos fotos tomadas por el mismo test, nunca saldos
// absolutos (otras corridas y el job WA_CHECKINGACCOUNT tocan las mismas CC).
//
// Convencion de signo (medida, ver docs del plan): el `balance` que devuelve la API de la CC de
// CLIENTE tiene signo OPUESTO a CHECKINGACCOUNT.BALANCE de la base (BALANCE = LIMITE - DEBITSUM +
// CREDITSUM). `snapshotClientCc` lo invierte para que todo saldo normalizado viva en convencion DB.
// Los libros de chofer/propietario devuelven CHECKINGACCOUNTFORDRIVER/OWNER.BALANCE sin inversion
// (DriverToResponseDTOMapper.toCheckingAccountForDriverDTO usa getBalance() directo).
import type {
  CheckingAccountRow,
  DriverBookRow,
  OwnerBookRow
} from '../api/clients/checkingAccount.client.js';

/** Movimiento normalizado: debit/credit nunca null, concepto como texto. */
export type CcMovement = {
  /** Clave de identidad (id del libro cuando existe; si no, compuesta por campos de la fila). */
  key: string;
  /** Id de viaje cuando el libro lo informa (solo CC de cliente); null en libros chofer/propietario. */
  travelId: number | null;
  concept: string;
  debit: number;
  credit: number;
};

export type CcSnapshot = {
  rows: CcMovement[];
  /** Saldo en convencion DB (CHECKINGACCOUNT.BALANCE); null si la fuente no lo informa. */
  balance: number | null;
};

export type CcDelta = {
  /** Movimientos presentes en `after` que no estaban en `before`. */
  added: CcMovement[];
  debitDelta: number;
  creditDelta: number;
  /** after.balance - before.balance en convencion DB; null si algun saldo falta. */
  balanceDelta: number | null;
  /** Agrupa `added` por travelId (los sin viaje van bajo la clave `null`). */
  byTravel: Map<number | null, CcMovement[]>;
};

const cents = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number | null | undefined): number => (typeof n === 'number' ? n : 0);

/** Foto de la CC de cliente. `apiBalance` es el `balance` de la API (signo opuesto al de la DB). */
export function snapshotClientCc(
  rows: readonly CheckingAccountRow[],
  apiBalance: number | null
): CcSnapshot {
  return {
    rows: rows.map((r) => ({
      key: ['c', r.creationDate, r.travelId, r.concept, r.debit, r.credit, r.multiTripSeq].join(
        '|'
      ),
      travelId: r.travelId ?? null,
      concept: r.concept ?? '',
      debit: num(r.debit),
      credit: num(r.credit)
    })),
    balance: apiBalance === null ? null : cents(-apiBalance)
  };
}

/** Foto de un libro de chofer o propietario: `amount` = debito, `paid` = credito, id propio. */
export function snapshotBook(
  rows: ReadonlyArray<DriverBookRow | OwnerBookRow>,
  balance: number | null
): CcSnapshot {
  return {
    rows: rows.map((r) => ({
      key: ['b', r.id].join('|'),
      travelId: null,
      concept: r.checkingAccountCode ?? '',
      debit: num(r.amount),
      credit: num(r.paid)
    })),
    balance: balance === null ? null : cents(balance)
  };
}

/**
 * Movimientos nuevos y delta de saldo entre dos fotos. Compara por multiconjunto de claves, de modo
 * que dos filas identicas (mismo viaje, concepto e importe) cuentan por separado: si `after` tiene
 * una mas que `before`, esa es la nueva. Una fila que desaparece NO resta: se informa solo lo agregado.
 */
export function deltaMovements(before: CcSnapshot, after: CcSnapshot): CcDelta {
  const remaining = new Map<string, number>();
  for (const row of before.rows) remaining.set(row.key, (remaining.get(row.key) ?? 0) + 1);

  const added: CcMovement[] = [];
  for (const row of after.rows) {
    const left = remaining.get(row.key) ?? 0;
    if (left > 0) remaining.set(row.key, left - 1);
    else added.push(row);
  }

  const byTravel = new Map<number | null, CcMovement[]>();
  for (const row of added) {
    const list = byTravel.get(row.travelId) ?? [];
    list.push(row);
    byTravel.set(row.travelId, list);
  }

  return {
    added,
    debitDelta: cents(added.reduce((sum, r) => sum + r.debit, 0)),
    creditDelta: cents(added.reduce((sum, r) => sum + r.credit, 0)),
    balanceDelta:
      before.balance === null || after.balance === null
        ? null
        : cents(after.balance - before.balance),
    byTravel
  };
}
