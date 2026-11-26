/**
 * PAX-WALLET-MANAGEMENT — validar la billetera del pasajero en la app (P-31): lectura de solo lectura (T1) y alta +
 * baja de UNA tarjeta de prueba de Stripe (T2, con compuerta).
 *
 * QUÉ AFIRMA
 *   T1 (solo lectura, sin compuerta). Desde el menú lateral «Billetera» abre `/cards` y la pantalla se renderiza con
 *       una de dos cosas: la lista de tarjetas (cada fila con su last4) o el estado vacío. Registra la cantidad y los
 *       last4 visibles. No crea ni toca nada.
 *   T2 (escritura, compuerta). Agrega UNA tarjeta de prueba (Mastercard débito, sin 3DS, last4 distinto de 4242) por el
 *       formulario de Stripe: queda listada por su last4, suma exactamente 1 fila y las demás no cambian. Luego elimina
 *       SOLO esa tarjeta y las demás quedan como estaban.
 *
 * PLAN DE CORRIDA
 *   Comando T1:  ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-wallet-management.spec.ts -g "T1"
 *   Comando T2:  PAX_WALLET_WRITE=1 ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-wallet-management.spec.ts -g "T2"
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (T2: debe ser test),
 *               ANDROID_UDID, ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`),
 *               PAX_WALLET_WRITE=1 (compuerta de T2; se lee SOLO acá) y PAX_WALLET_MAX_CARDS (opcional: tope de
 *               tarjetas; la app no define uno en develop).
 *   Precondición T2: el carrier activo del pasajero usa Stripe (si el formulario es nativo —MercadoPago/EBIZ/
 *               Authorize— el spec falla en la etapa «gateway» sin guardar nada) y la billetera NO tiene ya una tarjeta
 *               con el last4 de prueba ni está en el tope. En ese caso se saltea: no se puede probar que la tarjeta
 *               sea de esta corrida, así que nunca se agrega ni se elimina.
 *   Efectos:    T1 ninguno. T2 CREA 1 tarjeta (vía `PassengerWalletPBO.addCard({ confirmed: true })`) y la ELIMINA (vía
 *               `deleteOwnCard({ confirmed: true })`, que solo acepta el last4 que agregó esa misma instancia). El
 *               `finally` intenta eliminarla SIEMPRE que se haya llegado a tocar «Guardar»; si falla, el spec falla con
 *               el last4 y pide ELIMINARLA MANUALMENTE desde la app. Nunca se toca otra tarjeta, ni la «Principal», ni se
 *               marca la nueva como principal. En develop eliminar NO pide confirmación (un tap en el tacho elimina).
 *               Sin PAX_WALLET_WRITE=1, o con ENV distinto de test, T2 se saltea con motivo y no crea nada.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM (ver
 *               `pax-login.spec.ts`); locators y flujo relevados del código (develop) y V1. Validación en vivo pendiente.
 *   Fuera de alcance: tarjetas con 3DS, otras pasarelas (MercadoPago, EBIZ, Authorize), cambiar la tarjeta Principal,
 *               billetera con tarjeta elegida desde `travel-info`, trifuerza DB (conteo en Oracle).
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { WALLET_CARD_MANAGEMENT } from '../../data/stripeTestCards.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  type PassengerSpecContext
} from '../../harness/PassengerSpecKit.js';
import {
  openWalletSpec,
  parseMaxCards,
  WALLET_MAX_CARDS_ENV,
  WALLET_WRITE_GATE_ENV
} from '../../harness/PassengerWalletKit.js';
import {
  WalletOwnershipError,
  planWalletWriteRun,
  type PassengerWalletPBO
} from '../../pbo/PassengerWalletPBO.js';

const CARD = WALLET_CARD_MANAGEMENT;

test.describe('@mobile @no-xray App Pasajero · billetera', () => {
  test.describe.configure({ timeout: 420_000 });

  test('PAX-WALLET-READ · T1 Validar que «Billetera» abre y muestra la lista de tarjetas o el estado vacío', async ({}, testInfo) => {
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getPassengerAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');

    let ctx: PassengerSpecContext | null = null;
    try {
      const opened = await openWalletSpec('pax-wallet-read', (reason) => test.skip(true, reason));
      ctx = opened.ctx;
      const snapshot = await opened.wallet.openWallet({ timeoutMs: 45_000 });
      await ctx.evidence.capture('01-billetera');
      const last4s = snapshot.rows.map((r) => r.last4);
      ctx.log(
        `Billetera: ${snapshot.rows.length} tarjeta(s) [${last4s.join(', ')}] · vacío=${snapshot.emptyVisible}.`
      );
      expect(snapshot.onWallet, 'T1: la app está en /cards').toBe(true);
      expect(
        snapshot.rows.length > 0 || snapshot.emptyVisible,
        'T1: se ve la lista de tarjetas o el estado vacío'
      ).toBe(true);
      if (snapshot.rows.length > 0) {
        expect(snapshot.emptyVisible, 'T1: con tarjetas no se muestra el estado vacío').toBe(false);
        expect(
          snapshot.rows.every((r) => /^\d{4}$/.test(r.last4)),
          'T1: cada fila identifica su tarjeta por 4 dígitos'
        ).toBe(true);
      }
    } finally {
      if (ctx) await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
    }
  });

  test('PAX-WALLET-ADD-DELETE · T2 Validar que una tarjeta de prueba agregada aparece en la billetera y que al eliminarla las demás quedan intactas', async ({}, testInfo) => {
    // Compuertas ANTES de abrir la sesión: sin ellas no se hace nada en el dispositivo.
    const gateOpen = process.env[WALLET_WRITE_GATE_ENV] === '1';
    test.skip(
      !gateOpen,
      `Compuerta cerrada: definir ${WALLET_WRITE_GATE_ENV}=1 para agregar (y eliminar) UNA tarjeta de prueba en TEST. No se creó ninguna tarjeta.`
    );
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getPassengerAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');
    test.skip(
      config.environment !== 'test',
      `Este spec crea y elimina una tarjeta: solo corre con ENV=test (entorno actual: ${config.environment}). No se creó ninguna tarjeta.`
    );

    let ctx: PassengerSpecContext | null = null;
    let wallet: PassengerWalletPBO | null = null;
    // `true` desde que el PBO registra la tarjeta como propia (justo antes de «Guardar»).
    let cardMayExist = false;
    try {
      const opened = await openWalletSpec('pax-wallet-management', (reason) =>
        test.skip(true, reason)
      );
      ctx = opened.ctx;
      wallet = opened.wallet;
      const { log } = ctx;

      // Pre-chequeo de SOLO LECTURA: nada se escribe si no se puede probar la propiedad de la tarjeta.
      const before = await wallet.openWallet({ timeoutMs: 45_000 });
      await ctx.evidence.capture('01-billetera-antes');
      const plan = planWalletWriteRun({
        gateOpen,
        environment: config.environment,
        existingLast4: before.rows.map((r) => r.last4),
        testCardLast4: CARD.last4,
        cardCount: before.rows.length,
        maxCards: parseMaxCards(process.env[WALLET_MAX_CARDS_ENV])
      });
      test.skip(!plan.proceed, plan.proceed ? '' : plan.reason);
      log(
        `Antes: ${before.rows.length} tarjeta(s) [${before.rows.map((r) => r.last4).join(', ')}]; se agrega ${CARD.id} (${CARD.last4}).`
      );

      // T2a — alta: queda listada, suma 1 fila y las demás no cambian (lo exige el PBO; se re-afirma acá).
      let added;
      try {
        cardMayExist = true;
        added = await wallet.addCard(
          {
            number: CARD.number,
            expiry: CARD.expiry,
            cvc: CARD.cvc,
            holderName: CARD.holderName
          },
          { confirmed: true }
        );
      } catch (error) {
        if (error instanceof WalletOwnershipError) cardMayExist = false;
        throw error;
      }
      await ctx.evidence.capture('02-tarjeta-agregada');
      expect(
        added.after.rows.map((r) => r.last4),
        'T2: la tarjeta de prueba aparece en la lista por su last4'
      ).toContain(CARD.last4);
      expect(added.after.rows, 'T2: el alta suma exactamente 1 fila').toHaveLength(
        before.rows.length + 1
      );

      // T2b — baja: SOLO la tarjeta agregada; las demás quedan como estaban (last4 y marca de «Principal»).
      const removed = await wallet.deleteOwnCard(CARD.last4, { confirmed: true });
      await ctx.evidence.capture('03-tarjeta-eliminada');
      expect(removed.removed, 'T2: la tarjeta de prueba se eliminó').toBe(true);
      if (removed.removed) {
        expect(
          removed.remaining.map((r) => `${r.last4}|${r.isDefault}`).sort(),
          'T2: las demás tarjetas quedan exactamente como estaban'
        ).toEqual(before.rows.map((r) => `${r.last4}|${r.isDefault}`).sort());
      }
    } finally {
      let cleanupError: Error | null = null;
      if (cardMayExist && wallet) {
        try {
          await wallet.closeFormIfOpen();
          await wallet.openWallet({ timeoutMs: 45_000 });
          const result = await wallet.deleteOwnCard(CARD.last4, { confirmed: true });
          if (result.removed) ctx?.log(`Limpieza: tarjeta ${CARD.last4} eliminada en el finally.`);
        } catch (error) {
          cleanupError = new Error(
            `NO SE PUDO ELIMINAR la tarjeta de prueba terminada en ${CARD.last4} creada por este spec: ` +
              `${error instanceof Error ? error.message : String(error)} ` +
              'ELIMINARLA MANUALMENTE desde la app (Billetera: deslizar la fila y tocar el tacho).'
          );
        }
      }
      if (ctx) await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
      if (cleanupError) throw cleanupError;
    }
  });
});
