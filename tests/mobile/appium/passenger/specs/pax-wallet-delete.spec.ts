/**
 * PAX-WALLET-DELETE — validar la baja de una tarjeta desde la billetera de la app Pasajero (P-31): se agrega UNA
 * tarjeta de prueba de Stripe (precondición) y se elimina desde su fila.
 *
 * QUÉ AFIRMA
 *   Tras agregar una tarjeta de prueba (Visa débito, sin 3DS, last4 distinto de 4242 y distinto del de
 *   `pax-wallet-management`), eliminarla desde su fila (tacho) hace que: (1) desaparezca de la lista, (2) la cantidad
 *   de filas vuelva a la anterior, y (3) las demás tarjetas queden exactamente como estaban (mismos last4 y la misma
 *   marca de «Principal»).
 *
 * PLAN DE CORRIDA
 *   Comando:    PAX_WALLET_WRITE=1 ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-wallet-delete.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser test),
 *               ANDROID_UDID, ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`),
 *               PAX_WALLET_WRITE=1 (compuerta; se lee SOLO acá) y PAX_WALLET_MAX_CARDS (opcional: tope de tarjetas).
 *   Precondición: el carrier activo del pasajero usa Stripe (con formulario nativo el spec falla en la etapa «gateway»
 *               sin guardar nada) y la billetera NO tiene ya una tarjeta con el last4 de prueba ni está en el tope; si
 *               la tiene, se saltea (no se puede probar que sea de esta corrida) y no toca nada.
 *   Efectos:    CREA 1 tarjeta (vía `PassengerWalletPBO.addCard({ confirmed: true })`) y la ELIMINA (vía
 *               `deleteOwnCard({ confirmed: true })`, que solo acepta el last4 que agregó esa misma instancia). El
 *               `finally` intenta eliminarla SIEMPRE que se haya llegado a tocar «Guardar»; si falla, el spec falla con
 *               el last4 y pide ELIMINARLA MANUALMENTE desde la app. No existe «borrar todas» ni «borrar la primera»: nunca
 *               se toca otra tarjeta ni la «Principal». En develop eliminar NO pide confirmación (un tap en el tacho
 *               elimina). Sin PAX_WALLET_WRITE=1, o con ENV distinto de test, se saltea con motivo y no crea nada.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM (ver
 *               `pax-login.spec.ts`); locators y flujo relevados del código (develop) y V1. Validación en vivo pendiente.
 *   Fuera de alcance: tarjetas con 3DS (V1 usaba una 3DS), otras pasarelas (MercadoPago, EBIZ, Authorize), eliminar la
 *               tarjeta Principal, trifuerza DB (conteo en Oracle).
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { WALLET_CARD_DELETE } from '../../data/stripeTestCards.js';
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

const CARD = WALLET_CARD_DELETE;

test.describe('@mobile @no-xray App Pasajero · baja de tarjeta de la billetera', () => {
  test.describe.configure({ timeout: 420_000 });

  test('PAX-WALLET-DELETE · Validar que al eliminar una tarjeta agregada por la prueba desaparece de la billetera y las demás tarjetas no cambian', async ({}, testInfo) => {
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
      const opened = await openWalletSpec('pax-wallet-delete', (reason) => test.skip(true, reason));
      ctx = opened.ctx;
      wallet = opened.wallet;

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

      // Precondición: agregar la tarjeta de prueba y verla en la lista.
      try {
        cardMayExist = true;
        await wallet.addCard(
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
      const withCard = await wallet.readStableSnapshot();
      await ctx.evidence.capture('02-tarjeta-agregada');
      expect(
        withCard.rows.map((r) => r.last4),
        'precondición: la tarjeta de prueba está en la lista'
      ).toContain(CARD.last4);

      // Baja desde la fila (tacho). En develop no hay diálogo de confirmación.
      const removed = await wallet.deleteOwnCard(CARD.last4, { confirmed: true });
      await ctx.evidence.capture('03-tarjeta-eliminada');
      expect(removed.removed, 'la baja se confirmó').toBe(true);

      const after = await wallet.readStableSnapshot();
      expect(
        after.rows.map((r) => r.last4),
        'la tarjeta eliminada desaparece de la lista'
      ).not.toContain(CARD.last4);
      expect(after.rows, 'la cantidad de filas vuelve a la anterior').toHaveLength(
        before.rows.length
      );
      expect(
        after.rows.map((r) => `${r.last4}|${r.isDefault}`).sort(),
        'las demás tarjetas quedan exactamente como estaban (last4 y «Principal»)'
      ).toEqual(before.rows.map((r) => `${r.last4}|${r.isDefault}`).sort());
      expect(after.emptyVisible, 'el estado vacío solo se ve si no queda ninguna tarjeta').toBe(
        before.rows.length === 0
      );
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
