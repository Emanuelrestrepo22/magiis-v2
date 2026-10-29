// tests/specs/trips/new-trip-open-destination-units.spec.ts
// MG-1192 · TC4 · TM-1343 — «Distancia Teórica Dest. Abierto» de Nuevo Viaje (Destino Abierto)
// muestra el MISMO número y la MISMA unidad que el parámetro «Theoretical Distance Open Dest.» de
// Configuración › Parámetros, y ambos son `totalDistanceOpenTrip` (km) convertido a la unidad del
// carrier (millas a 3 decimales / km sin convertir).
//
// ORÁCULO: `GET /carriers/{id}/parameters` (`totalDistanceOpenTrip`), observado pasivamente. SOLO
// LECTURA: no se toca «Guardar» de Parámetros, no se completa origen ni pickup y NO se envía el
// viaje; el cliente solo se elige para habilitar el switch (cliente de prueba, ver mg1189.ts).
//
// Filas por ambiente (docs/qa/unidades-medida-mg1189/PROGRESO-RONDA1.md):
//   uat  · 1481 · valor 956 625,992645 km  ⇒ «594421.311 Mi» en Parámetros y en Nuevo Viaje.
//   test · 1521 · valor 0                  ⇒ el renglón de distancia NO aparece en Nuevo Viaje.
//   test · 1040 · valor 4 km (métrico)     ⇒ test.fixme: H-4 (ver más abajo).
//
// DEFECTO CONOCIDO H-4 (abierto, intermitente — TM-1310 / TM-1317): Parámetros es un iframe de la V1
// y en un carrier MÉTRICO a veces muestra el valor convertido a millas bajo el rótulo «Km». Medido
// el 07/10/2026 en TEST con el carrier 1040: API 4 km, Nuevo Viaje «4 km», Parámetros «2.485 Km».
// El esperado NO se relaja: la fila métrica queda `fixme` con ese motivo hasta que se corrija H-4
// o Parámetros migre a V2.
//
// Ejecutar: npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//   tests/specs/trips/new-trip-open-destination-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { SettingsParametersPage } from '../../pages/carrier-v2/settings/SettingsParametersPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { expectDisplayedDistance } from '../../utils/unitsAssert.js';
import { unitLabel, type DistanceReading, type UnitSystem } from '../../utils/units.js';

const ROUTE = '/carrier/#/travel/create';
const TM_1343 = 'TM-1343';

const H4_REASON =
  'H-4 abierto (intermitente): Parámetros (iframe V1) de un carrier métrico muestra millas bajo «Km» ' +
  '(1040: 4 km → «2.485 Km», medido el 07/10/2026 en TEST; ver TM-1310 / TM-1317). Quitar el fixme ' +
  'cuando se corrija H-4 o Parámetros migre a V2.';

interface OpenDestinationLine {
  newTrip: NewTripPage;
  carrierKey: string;
  language: 'en' | 'es';
  rawKm: number;
  system: UnitSystem;
  /** Lo que mostró Parámetros: Nuevo Viaje debe coincidir exactamente. */
  parametersReading: DistanceReading;
}

/**
 * Verifica el renglón «Distancia Teórica Dest. Abierto» de Nuevo Viaje y devuelve la medición:
 * con el parámetro > 0 muestra el crudo convertido (igual a Parámetros); con 0 el renglón no se
 * muestra (la nota sigue con la reserva, así que la ausencia no es vacua).
 */
async function expectOpenDestinationLine(line: OpenDestinationLine): Promise<string> {
  const { newTrip, carrierKey, language, rawKm, system, parametersReading } = line;
  const tag = language.toUpperCase();
  if (rawKm <= 0) {
    await expect(async () => expect(await newTrip.readOpenDestinationDistance()).toBeNull()).toPass(
      {
        timeout: 10_000
      }
    );
    expect(parametersReading.value, 'Parámetros debe mostrar 0').toBe(0);
    return `${tag}: sin renglón de distancia`;
  }
  const reading = await expectDisplayedDistance({
    label: `Nuevo Viaje ${tag} · ${carrierKey}`,
    read: () => newTrip.readOpenDestinationDistance(),
    readText: async () => (await newTrip.openDestinationNote.innerText()).replace(/\s+/g, ' '),
    rawKm,
    system,
    decimals: 3
  });
  expect(
    reading,
    `Nuevo Viaje (${tag}) debe mostrar el mismo número y unidad que Parámetros`
  ).toEqual(parametersReading);
  return `${tag}: ${reading.value} ${reading.unit}`;
}

test.describe('@P1 @functional MG-1192 Nuevo Viaje - Distancia teórica de Destino Abierto en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    test(`TM-1343: debería mostrar en Nuevo Viaje la misma distancia teórica de Destino Abierto que Parámetros, en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      test.fixme(carrier.system === 'metric', H4_REASON);
      makeAnnotate(TM_1343, ROUTE)('TC4', 'HP');
      // Dos páginas del mismo carrier: Parámetros es un iframe de la V1 y navegar de ahí a Nuevo
      // Viaje por hash deja el iframe montado (el gate `migrated` lo toma por la V1).
      const parametersPage = await carrierPage(carrier.region);
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const parameters = new SettingsParametersPage(parametersPage);
      const newTrip = new NewTripPage(page);

      // 1) Parámetros: el valor crudo (km) y lo que muestra el iframe.
      const rawKm = await parameters.gotoAndCaptureOpenDestinationKm();
      expect(
        Number.isFinite(rawKm),
        `precondición: GET parameters de ${carrier.key} debe traer totalDistanceOpenTrip`
      ).toBe(true);
      await parameters.openAutomaticAssignment();
      const parametersReading = await expectDisplayedDistance({
        label: `Parámetros · ${carrier.key}`,
        read: () => parameters.readOpenDestinationDistance(),
        readText: async () =>
          `${await parameters.openDestinationInput.inputValue()} ${await parameters.openDestinationUnit.innerText()}`,
        rawKm,
        system: carrier.system,
        decimals: 3
      });

      // 2) Nuevo Viaje con Destino Abierto: cliente de prueba + switch; NO se envía nada.
      await newTrip.goto();
      await newTrip.selectClient(carrier.clientQuery);
      await expect(newTrip.openDestinationSwitch).toBeEnabled({ timeout: 20_000 });
      await newTrip.toggleOpenDestination();
      await expect(
        newTrip.openDestinationNote,
        'con Destino Abierto activo debe verse la nota de reserva del carrier'
      ).toBeVisible({ timeout: 20_000 });

      const measured: string[] = [];
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);
        measured.push(
          await expectOpenDestinationLine({
            newTrip,
            carrierKey: carrier.key,
            language,
            rawKm,
            system: carrier.system,
            parametersReading
          })
        );
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `destino-abierto-distancia-teorica-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}). GET parameters: totalDistanceOpenTrip = ${rawKm} km. ` +
          `Parámetros (iframe V1) muestra ${parametersReading.value} ${parametersReading.unit}; ` +
          `Nuevo Viaje con Destino Abierto muestra ${measured.join(' · ')} (cliente «${carrier.clientQuery}», sin pickup, sin enviar, sin guardar).`
      });
    });
  }
});
