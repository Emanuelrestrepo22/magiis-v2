// tests/specs/trips/new-trip-ui-contract.spec.ts
// Contrato de UI de Nuevo Viaje: comportamiento del formulario que NO forma parte de la
// matriz QA manual (avisos del typeahead, reset del formulario, dialogo de notas). Complementa
// new-trip.spec.ts, que cubre 1:1 los Xray Tests de MG-19.
//
// TRAZABILIDAD PARCIAL — la premisa original de este archivo era "ninguno de estos casos existe
// en el catalogo manual, asi que ninguno lleva key TM". La Ronda 2 del catalogo (ATR TM-830)
// dejo eso a medias: DOS de estos tests cubren casos que ahora si existen en Xray y por eso
// llevan `makeAnnotate`. Los otros cuatro siguen siendo checks de ingenieria sin key: se
// agrupan bajo la Historia con el tag @MG-19, que scripts/extract-tc-map.ts reconoce.
// Cruce completo: docs/qa/mg19-new-trip/TM-830-COBERTURA-Y-PLAN.md.
//
// Ninguno muta el entorno — el alta real vive en new-trip-happy-path.spec.ts. Locale fijo
// en-US: los avisos se aseveran en su literal EN.
// Contexto completo: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
import { test, expect, attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

// Xray Tests del ATR TM-830 (Ronda 2) que estos casos ya cubrian sin saberlo.
// Constantes sueltas a proposito: ver la nota de new-trip.spec.ts sobre extract-tc-map.ts.
const TM_TC215 = 'TM-789';
const TM_TC244 = 'TM-819';
const TM_TC227 = 'TM-802';

/** Texto con el que se busca un cliente. «federico» ya no existe en TEST; el cliente «test» tiene Pick-Up registrado. */
const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';

test.describe('@P1 @functional @MG-19 Nuevo Viaje - contrato de UI', () => {
  // Alta de viaje golpea clientes y tipos de servicio; latencia variable.

  test('Las opciones de ruta están habilitadas y la hora trae un valor por defecto', async ({
    page
  }, testInfo) => {
    const p = new NewTripPage(page);
    await p.goto();
    await p.expectMainSectionsReady();

    // Los tres controles de preferencia de ruta no dependen del cliente: acá se afirma que
    // están habilitados. Su estado inicial (marcado o no) NO es un valor fijo del front sino el
    // parámetro del carrier, y lo cubre TM-501 (new-trip-carrier-defaults.spec.ts); afirmarlo
    // aquí como "sin marcar" hacía al test inestable cuando otra corrida cambiaba ese parámetro.
    await expect(p.avoidTollsCheckbox).toBeEnabled();
    await expect(p.avoidHighwaysCheckbox).toBeEnabled();
    await expect(p.fastestRouteSwitch).toBeEnabled();

    await expect(p.tripTimeValue).toBeVisible();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'opciones-de-ruta-por-defecto',
      comment: `Medido: «evitar peaje», «evitar autopistas» y «ruta más rápida» habilitados (su estado inicial lo cubre TM-501); la hora por defecto es visible.`
    });
  });

  test('TC215 El typeahead de cliente exige un minimo de caracteres y avisa cuando no hay resultados', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC215, ROUTE)('TC215', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();

    // Con 2 caracteres el combo no consulta al backend: responde con un aviso, no con datos.
    await p.searchClient('qa');
    await expect(p.dropdownNotice).toBeVisible();
    await expect(p.dropdownNotice).toHaveText('Type at least 3 characters to search');

    // Con 3+ caracteres si consulta, y avisa cuando el backend no devuelve nada.
    await p.searchClient('qa_e2e_inexistente');
    await expect(p.dropdownNotice).toBeVisible();
    await expect(p.dropdownNotice).toHaveText('No users found');

    // "SIN ERRORES" (segunda mitad de TC215): se prueba por RECUPERACION, no por ausencia de
    // toast. `BasePage.toastMessage()` ancla a selectores genericos (.toast-message,
    // .mat-snack-bar-container, .p-toast-message) que NO fueron observados en esta pantalla:
    // aseverarlos en cero pasaria siempre sin probar nada. Que el combo siga sirviendo despues
    // del estado vacio es la evidencia real de que no quedo en error.
    // Ademas da el par de control de `dropdownNotice` en los dos sentidos dentro del test:
    // con aviso arriba, sin aviso aca. Con el aviso en cero, las opciones que quedan son datos
    // reales (el aviso de ng-select tambien tiene role="option").
    await p.searchClient(CLIENT_QUERY);
    await expect(
      p.dropdownNotice,
      'el estado vacio no debe persistir tras una busqueda valida'
    ).toHaveCount(0);
    await expect(
      p.dropdownOptions,
      'el typeahead debe seguir devolviendo clientes despues del estado vacio'
    ).not.toHaveCount(0);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'typeahead-cliente-avisos',
      comment: `Medido: con 2 caracteres el aviso dice «Type at least 3 characters to search»; con «qa_e2e_inexistente» dice «No users found»; tras buscar «${CLIENT_QUERY}» el aviso desaparece (0) y hay opciones de cliente.`
    });
  });

  test('Limpiar el formulario con datos cargados pide confirmacion antes de descartar', async ({
    page
  }, testInfo) => {
    const p = new NewTripPage(page);
    await p.goto();

    // Los defaults se leen de la pantalla: dependen del carrier y del reloj.
    const horaPorDefecto = (await p.tripTimeValue.innerText()).trim();
    const fechaPorDefecto = await p.tripDateInput.inputValue();

    await p.selectClient(CLIENT_QUERY);
    await expect(p.resolvedOriginValue).toHaveCount(1);
    await p.avoidTollsCheckbox.check();
    await p.fastestRouteSwitch.check();
    await p.tripDateInput.fill('12/25/2026');

    // "Keep editing" descarta el popup y deja el formulario intacto.
    await p.requestClearForm();
    await expect(p.clearConfirmDialog).toBeVisible();
    await expect(p.clearConfirmDialog).toContainText('Clear the new trip?');
    await p.keepEditing();

    await expect(p.avoidTollsCheckbox).toBeChecked();
    await expect(p.tripDateInput).toHaveValue('12/25/2026');
    await expect(p.resolvedOriginValue).toHaveCount(1);

    // Confirmar si descarta todo y devuelve el formulario a cero.
    await p.clearForm();

    await expect(p.avoidTollsCheckbox).not.toBeChecked();
    await expect(p.fastestRouteSwitch).not.toBeChecked();
    await expect(p.tripDateInput).toHaveValue(fechaPorDefecto);
    await expect(p.tripTimeValue).toHaveText(horaPorDefecto);
    await expect(p.resolvedOriginValue).toHaveCount(0);
    await expect(p.originInput).toBeDisabled();
    await expect(p.serviceTypeSelect).toHaveCount(0);
    // NO se asevera el metodo de pago: su estado tras el reset no quedo caracterizado dentro
    // de esta secuencia. Detalle: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'limpiar-con-confirmacion',
      comment: `Medido: con datos cargados, «limpiar» abre el diálogo «Clear the new trip?»; «Keep editing» conserva peaje marcado y fecha 12/25/2026; confirmar restaura fecha «${fechaPorDefecto}», hora «${horaPorDefecto}», sin origen y con el origen deshabilitado.`
    });
  });

  test('Con el formulario en cero, limpiarlo no pide confirmacion', async ({ page }, testInfo) => {
    const p = new NewTripPage(page);
    await p.goto();
    // Sin esta espera el test es flaky: `check()` llega antes de que termine el init asincrono
    // de la pantalla y el formulario se re-patchea encima, dejando el checkbox `ng-dirty` pero
    // unchecked. Medido 2026-09-08, evidencia en
    // docs/analysis/mg19-evidence/ui-contract-clear-pristino-flaky-2026-09-08.md.
    // Era el unico test del archivo que no pasaba por este gate.
    await p.expectMainSectionsReady();

    // Sin cliente no hay nada cargado que perder: el borrado es directo, sin popup.
    await p.avoidTollsCheckbox.check();
    await expect(p.avoidTollsCheckbox).toBeChecked();

    await p.requestClearForm();
    await expect(p.clearConfirmDialog).toHaveCount(0);
    await expect(p.avoidTollsCheckbox).not.toBeChecked();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'limpiar-sin-confirmacion',
      comment: `Medido: sin cliente, tras marcar «evitar peaje» y pulsar limpiar no aparece diálogo de confirmación (0) y el checkbox vuelve a desmarcado.`
    });
  });

  test('El dialogo de notas del viaje ofrece General, Pick-Up y nota privada', async ({
    page
  }, testInfo) => {
    const p = new NewTripPage(page);
    await p.goto();

    await p.openNotes();

    await expect(
      p.notesDialog.getByRole('heading', { name: /trip notes|notas del viaje/i })
    ).toBeVisible();
    await expect(p.noteField('general')).toBeVisible();
    await expect(p.noteField('pickUp')).toBeVisible();
    await expect(p.noteField('private')).toBeVisible();

    // NO se asevera `textarea` toHaveCount(3). En ESTE estado (formulario sin destino commiteado)
    // el conteo real es 3, pero son CUATRO los tipos de nota: la de destino aparece al commitear
    // el destino. Fijar el 3 aca convertiria una condicion de render en el contrato de la pantalla.
    // El cuarto campo se cubre en TC227 (ver el TODO del final).
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'dialogo-de-notas',
      comment: `Medido: el diálogo «Trip notes» muestra los campos General, Pick-Up y nota privada.`,
      locator: p.notesDialog
    });
    await p.discardNotes();
  });

  test('TC244 Una nota confirmada reemplaza el boton por la tarjeta y la edicion pasa a la tarjeta', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC244, ROUTE)('TC244', 'HP');
    const p = new NewTripPage(page);
    await p.goto();

    const nota = 'qa_e2e nota general del viaje';
    await p.addNotes({ general: nota });

    await expect(p.notesCard).toBeVisible();
    await expect(p.savedNote('general')).toHaveText(nota);
    await expect(p.addNoteButton).toHaveCount(0);

    // "LA EDICION PASA A LA TARJETA" (segunda mitad de TC244): con "Add Note" fuera del DOM, el
    // lapiz de la tarjeta es la unica via para volver al modal. Se prueba el efecto completo —
    // reabre el modal Y trae la nota ya cargada — no solo que el boton exista.
    await p.editNotesFromCard();
    await expect(p.noteField('general')).toHaveValue(nota);

    const editada = `${nota} (editada)`;
    await p.noteField('general').fill(editada);
    await p.notesDialog.getByRole('button', { name: /^(aceptar|accept)$/i }).click();
    await expect(p.notesDialog).toBeHidden({ timeout: 15_000 });
    await expect(p.savedNote('general')).toHaveText(editada);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'nota-tarjeta-edicion',
      comment: `Medido: tras confirmar la nota «${nota}» se muestra la tarjeta de notas con ese texto y el botón «Add Note» desaparece (0); el lápiz de la tarjeta reabre el modal con la nota cargada y la edición «${editada}» queda en la tarjeta.`
    });
  });

  test('TC227 Se pueden cargar los cuatro tipos de nota y la tarjeta los muestra identificados', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC227, ROUTE)('TC227', 'HP');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillFirstDestination('Centro');
    await expect(p.resolvedDestinationValue).toHaveCount(1);

    // Sin este paso el cuarto campo no existe: la nota de Drop-Off la genera un *ngFor sobre el
    // FormArray de destinos, y el destino entra al array recien al pulsar "Add". Tenerlo
    // resuelto en la fila no alcanza — es lo que hizo leer este caso como un defecto el 08/09.
    await p.addStop();

    await p.openNotes();
    await expect(
      p.notesDialog.locator('textarea'),
      'con el destino commiteado deben ofrecerse los CUATRO tipos de nota'
    ).toHaveCount(4);
    await expect(p.noteField('general')).toBeVisible();
    await expect(p.noteField('pickUp')).toBeVisible();
    await expect(p.noteField('dropOff')).toBeVisible();
    await expect(p.noteField('private')).toBeVisible();
    await p.discardNotes();

    // "Se pueden CARGAR los cuatro" — se llenan los cuatro y se confirma.
    const notas = {
      general: 'qa_e2e nota general',
      pickUp: 'qa_e2e nota de pickup',
      dropOff: 'qa_e2e nota de dropoff',
      private: 'qa_e2e nota privada'
    };
    await p.addNotes(notas);

    // "La tarjeta los muestra IDENTIFICADOS": cada valor acompanado de su etiqueta. Se asevera
    // por texto y no por las clases `.tnc-label--<kind>`: solo estan observadas en vivo las de
    // general y origin, y inventar los sufijos de dest/driver seria adivinar.
    await expect(p.notesCard).toBeVisible();
    for (const valor of Object.values(notas)) {
      await expect(p.notesCard, `la tarjeta debe mostrar "${valor}"`).toContainText(valor);
    }
    for (const etiqueta of ['General', 'Pick-Up', 'Drop-Off', 'Private']) {
      await expect(p.notesCard, `la tarjeta debe identificar "${etiqueta}"`).toContainText(
        etiqueta
      );
    }
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'cuatro-tipos-de-nota',
      comment: `Medido: con el destino commiteado el modal ofrece 4 textareas (General, Pick-Up, Drop-Off, Private); tras cargar los cuatro la tarjeta muestra los cuatro textos con sus etiquetas General, Pick-Up, Drop-Off y Private.`
    });
  });
});
