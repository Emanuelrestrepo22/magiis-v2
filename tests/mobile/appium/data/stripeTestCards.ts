/**
 * Tarjetas de PRUEBA de Stripe para la billetera PAX (solo números públicos de https://stripe.com/docs/testing;
 * ningún dato real). Datos puros: el spec elige la tarjeta; ninguna lógica por carrier.
 *
 * Criterios de elección (cuenta PAX de TEST compartida):
 *  - SIN 3DS (el alta no maneja desafíos) y sin rechazo.
 *  - last4 improbable en una cuenta compartida: NO se usa 4242 (la tarjeta de prueba más común). Cada spec usa un
 *    last4 DISTINTO para que, si uno deja un resto, el otro lo vea como ajeno y se saltee en vez de borrarlo.
 *  - El titular solo puede tener letras/espacios (validación de la app: `[a-zA-Z-' ]+`, máx. 30).
 */

export type StripeTestCard = {
  /** Clave estable para citar la tarjeta en logs. */
  id: string;
  number: string;
  last4: string;
  expiry: string;
  cvc: string;
  holderName: string;
  /** Marca esperada en la fila de la billetera (informativo). */
  brand: string;
  threeDs: false;
};

const make = (id: string, number: string, brand: string): StripeTestCard => ({
  id,
  number,
  last4: number.slice(-4),
  expiry: '12/34',
  cvc: '123',
  holderName: 'QA Wallet Test',
  brand,
  threeDs: false
});

/** `pax-wallet-management`: Mastercard débito de prueba (5200 8282 8282 8210). */
export const WALLET_CARD_MANAGEMENT: StripeTestCard = make(
  'mastercard_debit',
  '5200828282828210',
  'MASTERCARD'
);

/** `pax-wallet-delete`: Visa débito de prueba (4000 0566 5566 5556). */
export const WALLET_CARD_DELETE: StripeTestCard = make('visa_debit', '4000056655665556', 'VISA');

export const WALLET_TEST_CARDS: readonly StripeTestCard[] = [
  WALLET_CARD_MANAGEMENT,
  WALLET_CARD_DELETE
];

/** Pura: algoritmo de Luhn (valida que el PAN de prueba esté bien formado). */
export function passesLuhn(pan: string): boolean {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
