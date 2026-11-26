/**
 * PAX-GATEWAY-BUSINESS-NO3DS — pedir un viaje desde la app Pasajero en modo Compañía (business/colaborador) con una
 * tarjeta EXISTENTE sin 3DS (Stripe, solo TEST) y verificar que el viaje queda «Buscando servicio» con la tarjeta
 * elegida (P-51). Reemplaza a `apppax-business-no3ds.e2e.spec.ts` de V1 (casos origen: TC-PAX-BIZ-03 / TC-PAX-BIZ-04).
 *
 * QUÉ AFIRMA
 *   T1. En modo Compañía la app llega a `travel-info` y deja elegida la tarjeta pedida (últimos 4) como método de pago.
 *   T2. Tras «Viajo Ahora» el viaje se crea y la app muestra SEARCHING_DRIVER con el botón «Cancelar Viaje».
 *   (El escenario «conductor asignado» está declarado pero inactivo: necesita al actor Chofer.)
 *
 * PLAN DE CORRIDA
 *   Comando:    GATEWAY_E2E=1 PAX_TRIP_CREATE=1 ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-gateway-business-no3ds.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser test),
 *               ANDROID_UDID, ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`),
 *               GATEWAY_E2E=1 y PAX_TRIP_CREATE=1 (compuertas; se leen SOLO acá),
 *               PAX_GATEWAY_CARD_LAST4 (opcional; por defecto los últimos 4 de la Visa de prueba de Stripe) y
 *               PAX_NEWTRIP_REGION (opcional, AR|US|FR).
 *   Precondición: la cuenta PAX tiene YA en la billetera (perfil corporativo) una tarjeta de prueba sin 3DS con esos
 *               últimos 4 y el interruptor de modo habilitado. Si ya hay un viaje activo, o la tarjeta no está, o el
 *               modo no está disponible, se saltea con motivo (ese viaje/tarjeta es ajeno y NUNCA se toca).
 *   Efectos:    CREA 1 viaje real en TEST (con la tarjeta elegida; posible autorización en Stripe TEST) y lo CANCELA
 *               en el `finally` vía `TripCancelPBO` (envuelto por `PassengerJourneyPBO.cancelCreatedTrip`); si la
 *               cancelación falla, el spec falla con el código del viaje y pide cancelarlo MANUALMENTE desde Carrier
 *               web. Puede cambiar el modo de perfil de la app (local al dispositivo) y lo restaura al final. NO
 *               agrega ni elimina tarjetas. Sin las dos compuertas, con ENV distinto de test o con escenario
 *               inactivo se saltea y no se crea nada.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM
 *               (ver `pax-login.spec.ts`); locators y flujo relevados del código (develop) y de V1. Validación en
 *               vivo pendiente.
 *   Fuera de alcance: 3DS, hold y su liberación, otras pasarelas (MercadoPago, EBIZ, Authorize), fase del Chofer
 *               (asignación/viaje en curso/cobro: handoff futuro con el actor Chofer), trifuerza DB, alta de
 *               tarjeta propia de la corrida (requiere volver de la billetera al home).
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test } from '@playwright/test';
import { defineGatewaySpec } from './pax-gateway-runner.js';

test.describe('@mobile @no-xray @gateway App Pasajero · viaje con pasarela sin 3DS (Compañía)', () => {
  test.describe.configure({ timeout: 420_000 });

  defineGatewaySpec('company', {
    gatewayGateOpen: process.env.GATEWAY_E2E === '1',
    tripGateOpen: process.env.PAX_TRIP_CREATE === '1',
    cardLast4Raw: process.env.PAX_GATEWAY_CARD_LAST4,
    region: process.env.PAX_NEWTRIP_REGION,
    appiumConfigured: Boolean(process.env.APPIUM_SERVER_URL)
  });
});
