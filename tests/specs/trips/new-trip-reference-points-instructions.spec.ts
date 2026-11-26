// tests/specs/trips/new-trip-reference-points-instructions.spec.ts
// MG-1132 · ATP TM-1841 · PK-2 «Buscador en Nuevo Viaje» (parte 2) — TM-1755, TM-1793, TM-1794
// (1 test() = 1 Test de Xray). La REFERENCIA de un punto se copia a las indicaciones del lugar al
// elegirlo; se reemplaza/vacia al cambiar el lugar y una indicacion editada a mano se conserva.
// Las indicaciones se leen en los DOS sitios de la pantalla: (A) modal del reloj «Wait Time On …»
// (textarea Instructions) y (B) tarjeta NOTE. Hibrido: puntos propios por API (`waypointsApi`, «QA AUTO
// <runId> …», limpieza por id propio en el fixture), buscador por la UI real de Nuevo Viaje (carrier 1521,
// atajo «Marcela Usa»). NO crea viajes (la cotizacion `simulateAll` no persiste nada). TEST (D2), UI en EN.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/new-trip-reference-points-instructions.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import type { Page } from '@playwright/test';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = '/carrier/#/travel/create';
const GOOGLE_TEXT = '1200 Brickell Ave';

test.skip(
  process.env.WAYPOINTS_CREATE_DATA !== '1',
  'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
);
test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
// SIN retries: cada intento crea datos reales y un reintento taparia la falla del primero.
test.describe.configure({ timeout: 240_000, retries: 0 });

// Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con mas de 24 h.
test.beforeAll(async ({ carrierApi, carrierSession }) => {
  await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
});

const shortcutOf = (): string => (DATA as NonNullable<typeof DATA>).primary.shortcut;

/** Nuevo Viaje limpio con el atajo del perfil primario; si ya estaba abierto, descarta el borrador. */
async function openNewTrip(page: Page): Promise<NewTripPage> {
  // Un goto a la misma ruta con hash no recarga la SPA: se parte de una pagina en blanco.
  const reopened = page.url().includes('travel/create');
  if (reopened) await page.goto('about:blank');
  const trip = new NewTripPage(page);
  await trip.goto();
  // Al reabrir, la app ofrece retomar el borrador del viaje anterior: se descarta (formulario limpio).
  if (reopened) await page.getByRole('button', { name: 'Start Over' }).click();
  await trip.pickPassengerShortcut(shortcutOf());
  return trip;
}

const spot = (index: number): { latitude: number; longitude: number } =>
  toWaypointCoords({ lat: MIAMI.downtown.lat + (index + 10) * 0.0006, lng: MIAMI.downtown.lng });

/** Referencia de exactamente `length` caracteres con ñ y tildes. */
function referenceOf(length: number, seed: string): string {
  const filler = ' ñandú áéíóú';
  let text = seed;
  while (text.length < length) text += filler;
  return text.slice(0, length).trimEnd().padEnd(length, 'x');
}

test.describe('@P2 @functional @migration MG-1132 indicaciones del lugar y puntos de referencia en Nuevo Viaje', () => {
  test('TM-1755: debería copiar la referencia completa del punto a las indicaciones del lugar y dejarlas vacías si el punto no tiene referencia', async ({
    page,
    waypointsApi,
    runId,
    nameFor
  }, testInfo) => {
    // Acredita TM-1755 y, por la fila multilinea y la de 240, TM-1759. NO acredita TM-1756: no cubre el
    // reescrito de una indicacion escrita a mano al volver a elegir un punto sin referencia (TC31 pasos 3 y 4).
    makeAnnotate('TM-1755', ROUTE)('TC30', 'EP');
    const tail = runId.slice(-4);
    const rows = [
      {
        kind: 'referencia corta',
        label: `Ra${tail}`,
        reference: `Portón verde, tocar timbre ${tail}`
      },
      {
        kind: 'referencia multilínea',
        label: `Rb${tail}`,
        reference: `Entrada por calle lateral ${tail}\nPedir por guardia\nPiso 2`
      },
      {
        kind: 'referencia de 240 caracteres',
        label: `Rc${tail}`,
        reference: referenceOf(240, `R240 ${tail} `)
      },
      { kind: 'sin referencia', label: `Rd${tail}`, reference: null }
    ];
    const created = [] as Array<{ placeId: string; name: string }>;
    for (const [index, row] of rows.entries()) {
      const name = nameFor(row.label);
      const result = await waypointsApi.create({ name, reference: row.reference, ...spot(index) });
      created.push({ placeId: result.waypoint.placeId, name });
    }

    const measured: string[] = [];
    for (const [index, row] of rows.entries()) {
      const trip = await openNewTrip(page);
      const picked = await trip.pickReferencePoint('origin', row.label, created[index].placeId);
      expect(picked.outboundCalls, `${row.kind}: sin llamadas a Google al elegir el punto`).toEqual(
        []
      );
      // Pasos 1 y 2 de TC30: la referencia viaja en la respuesta y como texto emergente de la opcion.
      expect(picked.item.reference, `${row.kind}: reference en la respuesta`).toBe(row.reference);
      expect(picked.optionTitle ?? '', `${row.kind}: texto emergente de la opcion`).toBe(
        row.reference ?? ''
      );
      if (row.reference !== null) {
        await trip.expectInstruction('origin', row.reference);
        await trip.expectNoteCard('origin', row.reference);
      } else {
        // El control positivo son las tres filas anteriores: A y B reflejan la referencia cuando existe.
        await trip.expectInstruction('origin', '');
        await expect(
          trip.noteCardRow('origin'),
          `${row.kind}: la tarjeta NOTE (B) no tiene fila de origen`
        ).toHaveCount(0);
      }
      measured.push(`${row.kind}: A = B = ${row.reference?.length ?? 0} caracteres`);

      if (index === 0) {
        // Parada: la referencia se copia solo a la parada elegida y las del origen no cambian.
        const destination = created[3];
        await trip.pickReferencePoint('destination', rows[3].label, destination.placeId);
        await trip.addStop();
        await trip.pickReferencePoint({ stop: 1 }, row.label.slice(0, -1), created[0].placeId);
        await trip.expectInstruction({ stop: 1 }, row.reference as string);
        await trip.expectNoteCard({ stop: 1 }, row.reference as string);
        await trip.expectInstruction('origin', row.reference as string);
        await trip.expectInstruction('destination', '');
        measured.push('Parada 1: A y B = referencia; Origen sin cambios; Destino vacío');
      }
    }

    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1755-indicaciones',
      comment:
        `Nuevo Viaje (carrier 1521, ${ENV}): ${measured.join(' | ')}. ` +
        'El modal del reloj (A) y la tarjeta NOTE (B) coinciden con la referencia del punto, que además viaja en la respuesta y en el texto emergente; sin referencia no se copia nada.'
    });
  });

  test('TM-1793: debería vaciar las indicaciones al reemplazar el lugar por una dirección de Google o por otro punto sin referencia', async ({
    page,
    waypointsApi,
    runId,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1793', ROUTE)('TC22', 'EP');
    const tail = runId.slice(-4);
    const reference = `Tranquera QA ${tail}`;
    const withRef = nameFor(`Sa${tail}`);
    const withoutRef = nameFor(`Sb${tail}`);
    const a = await waypointsApi.create({ name: withRef, reference, ...spot(0) });
    const b = await waypointsApi.create({ name: withoutRef, reference: null, ...spot(1) });

    // Fila a · Origen · escenario 1: reemplazo por una direccion de Google (estable «1200 Brickell Ave»).
    let trip = await openNewTrip(page);
    await trip.pickReferencePoint('origin', `Sa${tail}`, a.waypoint.placeId);
    await trip.expectInstruction('origin', reference); // control positivo
    await trip.pickGoogleAddress('origin', GOOGLE_TEXT);
    await expect(
      trip.noteCardRow('origin'),
      'fila a: tras el reemplazo la tarjeta NOTE no tiene fila de origen'
    ).toHaveCount(0, { timeout: 15_000 });
    await trip.expectInstruction('origin', '');

    // Fila a · Origen · escenario 2: reemplazo por otro punto SIN referencia.
    trip = await openNewTrip(page);
    await trip.pickReferencePoint('origin', `Sa${tail}`, a.waypoint.placeId);
    await trip.expectInstruction('origin', reference); // control positivo
    await trip.pickReferencePoint('origin', `Sb${tail}`, b.waypoint.placeId);
    await expect(
      trip.noteCardRow('origin'),
      'fila a: tras el reemplazo la tarjeta NOTE no tiene fila de origen'
    ).toHaveCount(0, { timeout: 15_000 });
    await trip.expectInstruction('origin', '');
    expect(await trip.placeValue('origin')).toBe(withoutRef);

    // Fila b · parada intermedia: se carga el Destino con el punto sin referencia para habilitar la parada.
    trip = await openNewTrip(page);
    await trip.pickReferencePoint('destination', `Sb${tail}`, b.waypoint.placeId);
    await trip.addStop();
    await trip.pickReferencePoint({ stop: 1 }, `Sa${tail}`, a.waypoint.placeId);
    await trip.expectInstruction({ stop: 1 }, reference); // control positivo
    await trip.pickGoogleAddress({ stop: 1 }, GOOGLE_TEXT);
    await expect(
      trip.noteCardRow({ stop: 1 }),
      'fila b: tras el reemplazo la tarjeta NOTE no tiene fila de la parada'
    ).toHaveCount(0, { timeout: 15_000 });
    await trip.expectInstruction({ stop: 1 }, '');
    await trip.expectInstruction('destination', ''); // el destino (sin referencia) no cambia

    testInfo.annotations.push({
      type: 'observation',
      description:
        'paso 4 de TC22 (puntero + clic + Cancelar sobre otro punto valido) no automatizado: depende del POM del puntero de PK-3; se agrega al integrarlo'
    });
    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1793-indicaciones-vacias',
      comment:
        `Nuevo Viaje (carrier 1521, ${ENV}): el punto «${withRef}» copió «${reference}» a las indicaciones. Fila a (Origen): al reemplazarlo por «${GOOGLE_TEXT}» (Google) y, en otra corrida del formulario, ` +
        `por «${withoutRef}» (sin referencia), la tarjeta NOTE perdió la fila de origen y el modal del reloj abrió vacío. Fila b (Parada 1): ídem con Google. ` +
        'Paso 4 (puntero + Cancelar) pendiente del POM de PK-3.'
    });
  });

  test('TM-1794: debería conservar la indicación editada a mano al reemplazar el lugar', async ({
    page,
    waypointsApi,
    runId,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1794', ROUTE)('TC23', 'ST');
    const tail = runId.slice(-4);
    const original = `Original QA ${tail}`;
    const edited = `Editada a mano QA ${tail}`;
    const name = nameFor(`Ta${tail}`);
    const created = await waypointsApi.create({ name, reference: original, ...spot(2) });

    const trip = await openNewTrip(page);
    await trip.pickReferencePoint('origin', `Ta${tail}`, created.waypoint.placeId);
    await trip.expectInstruction('origin', original); // precondicion
    await trip.writeInstruction('origin', edited);
    await trip.expectInstruction('origin', edited);
    const cardBefore = (await trip.readNoteCard('origin')).trim();

    await trip.pickGoogleAddress('origin', GOOGLE_TEXT);

    // Oraculo decisivo: lo que viaja al backend en la cotizacion (instruccion del origen).
    await trip.toggleOpenDestination();
    const body = await trip.selectVehicleAndCaptureSimulateAllBody();
    const origin = body.origin as Record<string, unknown> | undefined;
    expect(origin, 'simulateAll debe traer el origen').toBeDefined();
    expect(typeof origin?.placeId, 'simulateAll: el origen trae placeId').toBe('string');
    // El origen que viaja es la direccion de Google, no el punto reemplazado (sin esto el oraculo pasaria en vacio).
    expect(
      origin?.placeId,
      'simulateAll: el origen es la direccion de Google, no el punto'
    ).not.toBe(created.waypoint.placeId);
    expect(
      String(origin?.placeId),
      'simulateAll: el origen no es un punto de referencia'
    ).not.toMatch(/^MGWP-/);
    expect(
      origin?.specialInstruction,
      'simulateAll: la indicación editada viaja en el origen'
    ).toBe(edited);

    // (A) y (B) tras reemplazar el lugar: hallazgo H3 de MG-1761, pregunta Q-1761-8 abierta con Dev. Se mide y
    // se registra SIEMPRE como observacion (no se asevera); el oraculo decisivo es lo que viaja en simulateAll.
    const modalAfter = await trip.readInstruction('origin');
    const cardAfter = (await trip.readNoteCard('origin')).trim();
    testInfo.annotations.push({
      type: 'observation',
      description: `H3 / Q-1761-8 abierta: tarjeta NOTE (B) antes de reemplazar = «${cardBefore}»; tras reemplazar: modal (A) = «${modalAfter}», tarjeta NOTE (B) = «${cardAfter}»; simulateAll lleva «${String(origin?.specialInstruction)}»`
    });

    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1794-indicacion-conservada',
      comment:
        `Nuevo Viaje (carrier 1521, ${ENV}): el punto «${name}» copió «${original}»; se editó a mano a «${edited}» y el Origen se reemplazó ` +
        `por «${GOOGLE_TEXT}» (Google). La cotización (simulateAll) llevó origen = dirección de Google (no MGWP) con specialInstruction = «${String(origin?.specialInstruction)}». ` +
        `Tras reemplazar: modal (A) = «${modalAfter}», tarjeta NOTE (B) = «${cardAfter}» (H3 / Q-1761-8 abierta con Dev; PASSED = la cotización conserva la indicación editada).`
    });
  });
});
