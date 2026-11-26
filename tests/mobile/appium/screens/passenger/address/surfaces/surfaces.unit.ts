// Unit de la navegación de las superficies de dirección PAX con un SurfacePort fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/address/surfaces/surfaces.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HomeOneWaySurface } from './HomeOneWaySurface.js';
import { HomeOriginSurface } from './HomeOriginSurface.js';
import { HomeStopSurface } from './HomeStopSurface.js';
import { ProfileAddressSurface } from './ProfileAddressSurface.js';
import { ScheduledTripEditSurface } from './ScheduledTripEditSurface.js';
import {
  clearField,
  ensureEditable,
  firstEditable,
  goHome,
  placeholderSelector
} from './surfaceSteps.js';
import { ORIGIN_SELECTOR, DESTINATION_SELECTOR, STOP_SELECTOR } from './surfaceLocators.js';
import type { FieldState, RowTapKind, SurfacePort } from './types.js';

const HOME = 'https://localhost/navigator/HomePage';
const EDIT = 'https://localhost/travel-edit';
const ADDR = 'https://localhost/AddressesPage';

/** Mundo scriptable: cada método registra la llamada y responde según `w`. Sin esperas reales. */
type World = {
  url: string;
  /** Qué hace tocar la flecha de retroceso: URL destino (o null = no hay flecha). */
  backTo: string | null;
  /** `tapByText` por `${selectorContains}|${needle}` -> resultado y URL a la que navega. */
  taps: Record<string, { ok: boolean; goto?: string }>;
  /** Selector -> estado; `tapField` lo pasa a editable cuando `kind` ∈ editableOn. */
  fields: Record<string, FieldState>;
  editableOn: RowTapKind[];
  tapCss: { ok: boolean; goto?: string };
  menuOpens: boolean;
  tripTypeActive: boolean;
  editablePlaceholder: string | null;
  stopPlaceholder: string | null;
  addressType: string;
  pickedType: string;
  profileInput: string | null;
};

const baseWorld = (over: Partial<World> = {}): World => ({
  url: HOME,
  backTo: null,
  taps: {},
  fields: {},
  editableOn: ['text'],
  tapCss: { ok: false },
  menuOpens: true,
  tripTypeActive: true,
  editablePlaceholder: null,
  stopPlaceholder: null,
  addressType: '',
  pickedType: '',
  profileInput: null,
  ...over
});

function fakePort(w: World): { port: SurfacePort; log: string[] } {
  const log: string[] = [];
  const port: SurfacePort = {
    url: async () => w.url,
    pause: async () => undefined,
    tapByText: async (selector, needle) => {
      log.push(`text:${needle}`);
      const hit = Object.entries(w.taps).find(([k]) => {
        const [sel, n] = k.split('|');
        return selector.includes(sel!) && n === needle;
      });
      if (!hit) return false;
      if (hit[1].goto) w.url = hit[1].goto;
      return hit[1].ok;
    },
    tapCss: async (selector) => {
      log.push(`css:${selector}`);
      if (w.tapCss.ok && w.tapCss.goto) w.url = w.tapCss.goto;
      return w.tapCss.ok;
    },
    tapBackArrow: async () => {
      log.push('back');
      if (w.backTo === null) return false;
      w.url = w.backTo;
      return true;
    },
    openSideMenu: async () => {
      log.push('menu');
      return w.menuOpens;
    },
    fieldState: async (sel) => w.fields[sel] ?? { present: false, readOnly: false, value: '' },
    tapField: async (sel, kind) => {
      log.push(`tapField:${kind}`);
      const f = w.fields[sel];
      if (!f?.present) return false;
      if (w.editableOn.includes(kind)) f.readOnly = false;
      return true;
    },
    setValue: async (sel, value) => {
      log.push(`set:${sel}=${value}`);
      return Boolean(w.fields[sel]?.present);
    },
    findEditablePlaceholder: async () => w.editablePlaceholder,
    findPlaceholderStartingWith: async () => w.stopPlaceholder,
    isTripTypeActive: async () => w.tripTypeActive,
    readAddressType: async () => w.addressType,
    pickFirstAddressTypeOption: async () => w.pickedType,
    findProfileAddressInput: async () => w.profileInput
  };
  return { port, log };
}

const field = (readOnly: boolean): FieldState => ({ present: true, readOnly, value: '' });

test('goHome: ya en el home no toca nada; desde una página interna usa la flecha', async () => {
  const a = fakePort(baseWorld());
  assert.equal(await goHome(a.port), true);
  assert.deepEqual(a.log, []);

  const b = fakePort(baseWorld({ url: ADDR, backTo: HOME }));
  assert.equal(await goHome(b.port), true);
  assert.deepEqual(b.log, ['back']);
});

test('goHome: sin flecha prueba la pestaña «Inicio»; si tampoco, devuelve false', async () => {
  const ok = fakePort(
    baseWorld({ url: EDIT, taps: { 'ion-tab-button|inicio': { ok: true, goto: HOME } } })
  );
  assert.equal(await goHome(ok.port), true);
  const ko = fakePort(baseWorld({ url: EDIT }));
  assert.equal(await goHome(ko.port), false);
});

test('ensureEditable: editable no toca; readonly prueba texto -> fila -> input; sin campo = false', async () => {
  const ready = fakePort(baseWorld({ fields: { [ORIGIN_SELECTOR]: field(false) } }));
  assert.equal(await ensureEditable(ready.port, ORIGIN_SELECTOR), true);
  assert.deepEqual(ready.log, []);

  const rowOnly = fakePort(
    baseWorld({ fields: { [ORIGIN_SELECTOR]: field(true) }, editableOn: ['row'] })
  );
  assert.equal(await ensureEditable(rowOnly.port, ORIGIN_SELECTOR), true);
  assert.deepEqual(rowOnly.log, ['tapField:text', 'tapField:row']);

  const never = fakePort(baseWorld({ fields: { [ORIGIN_SELECTOR]: field(true) }, editableOn: [] }));
  assert.equal(await ensureEditable(never.port, ORIGIN_SELECTOR), false);
  assert.deepEqual(never.log, ['tapField:text', 'tapField:row', 'tapField:input']);

  const absent = fakePort(baseWorld());
  assert.equal(await ensureEditable(absent.port, ORIGIN_SELECTOR), false);
});

test('ensureEditable: nunca se ofrece un tap sobre el icono lateral (sólo text/row/input)', async () => {
  const w = fakePort(baseWorld({ fields: { [ORIGIN_SELECTOR]: field(true) }, editableOn: [] }));
  await ensureEditable(w.port, ORIGIN_SELECTOR);
  assert.ok(w.log.every((l) => /^tapField:(text|row|input)$/.test(l)));
});

test('firstEditable devuelve el primero habilitable y clearField es no-op sin selector', async () => {
  const w = fakePort(
    baseWorld({
      fields: { [DESTINATION_SELECTOR]: field(true), [ORIGIN_SELECTOR]: field(false) },
      editableOn: []
    })
  );
  assert.equal(
    await firstEditable(w.port, [DESTINATION_SELECTOR, ORIGIN_SELECTOR]),
    ORIGIN_SELECTOR
  );
  await clearField(w.port, '');
  assert.ok(!w.log.some((l) => l.startsWith('set:')));
});

test('placeholderSelector conserva el espacio final del placeholder', () => {
  assert.equal(
    placeholderSelector('Agregar otro destino '),
    'input[placeholder="Agregar otro destino "]'
  );
});

test('S1: alcanzable con el origen editable; inalcanzable con motivo si no hay home o campo', async () => {
  const s = new HomeOriginSurface();
  const ok = await s.navigate(
    fakePort(baseWorld({ fields: { [ORIGIN_SELECTOR]: field(false) } })).port
  );
  assert.deepEqual([ok.reachable, ok.reachable && ok.fieldSelector], [true, ORIGIN_SELECTOR]);

  const noHome = await s.navigate(fakePort(baseWorld({ url: ADDR })).port);
  assert.equal(noHome.reachable, false);
  assert.match(noHome.reachable ? '' : noHome.reason, /home/);

  const noField = await s.navigate(fakePort(baseWorld()).port);
  assert.match(noField.reachable ? '' : noField.reason, /Origen/);
});

test('S1: cleanup limpia el campo de origen', async () => {
  const w = fakePort(baseWorld({ fields: { [ORIGIN_SELECTOR]: field(false) } }));
  await new HomeOriginSurface().cleanup(w.port);
  assert.deepEqual(w.log, [`set:${ORIGIN_SELECTOR}=`]);
});

test('S3: sin semilla no navega; con semilla fija el destino, elige predicción y resuelve el placeholder exacto', async () => {
  const none = await new HomeStopSurface('  ').navigate(fakePort(baseWorld()).port);
  assert.match(none.reachable ? '' : none.reason, /semilla/);

  const w = fakePort(
    baseWorld({
      fields: { [DESTINATION_SELECTOR]: field(false) },
      taps: { 'prediction-item|': { ok: true } },
      stopPlaceholder: 'Agregar otro destino '
    })
  );
  const r = await new HomeStopSurface('Av. Corrientes 1000').navigate(w.port);
  assert.deepEqual([r.reachable, r.reachable && r.fieldSelector], [true, STOP_SELECTOR]);
  assert.ok(w.log.includes(`set:${DESTINATION_SELECTOR}=Av. Corrientes 1000`));
  assert.ok(w.log.includes('text:'));
});

test('S3: si la fila de parada no aparece, motivo menciona allowStops (dato del carrier, no defecto)', async () => {
  const w = fakePort(baseWorld({ fields: { [DESTINATION_SELECTOR]: field(false) } }));
  const r = await new HomeStopSurface('Calle 1').navigate(w.port);
  assert.equal(r.reachable, false);
  assert.match(r.reachable ? '' : r.reason, /allowStops/);
});

test('S5: sin botón «Solo Ida» o sin quedar activo es inalcanzable; con fila editable resuelve el campo vivo', async () => {
  const noBtn = await new HomeOneWaySurface().navigate(fakePort(baseWorld()).port);
  assert.match(noBtn.reachable ? '' : noBtn.reason, /no ofrece/);

  const taps = { 'travelHistory-btn|solo ida': { ok: true } };
  const inactive = await new HomeOneWaySurface().navigate(
    fakePort(baseWorld({ taps, tripTypeActive: false })).port
  );
  assert.match(inactive.reachable ? '' : inactive.reason, /activo/);

  const live = await new HomeOneWaySurface().navigate(
    fakePort(baseWorld({ taps, editablePlaceholder: 'Destino ' })).port
  );
  assert.deepEqual(
    [live.reachable, live.reachable && live.fieldSelector],
    [true, DESTINATION_SELECTOR]
  );
});

test('S5: sin fila editable viva cae a tocar Destino y luego Origen', async () => {
  const w = fakePort(
    baseWorld({
      taps: { 'travelHistory-btn|solo ida': { ok: true } },
      fields: { [DESTINATION_SELECTOR]: field(true), [ORIGIN_SELECTOR]: field(true) },
      editableOn: []
    })
  );
  const r = await new HomeOneWaySurface().navigate(w.port);
  assert.equal(r.reachable, false);
  assert.match(r.reachable ? '' : r.reason, /editable/);
});

test('S6: sin pestaña, sin viajes programados o sin abrir travel-edit => motivo; nunca toca «Cancelar»', async () => {
  const s = () => new ScheduledTripEditSurface();
  const noTab = await s().navigate(fakePort(baseWorld()).port);
  assert.match(noTab.reachable ? '' : noTab.reason, /Actividad/);

  const tabs = {
    'ion-tab-button|actividad': { ok: true },
    'ion-segment-button|programados': { ok: true }
  };
  const w = fakePort(baseWorld({ taps: tabs }));
  const noTrips = await s().navigate(w.port);
  assert.match(noTrips.reachable ? '' : noTrips.reason, /programado/);
  assert.ok(w.log.some((l) => l.startsWith('css:ion-col.col-edit div.edit')));
  assert.ok(!w.log.some((l) => /cancel|outline/i.test(l)));

  const noOpen = await s().navigate(fakePort(baseWorld({ taps: tabs, tapCss: { ok: true } })).port);
  assert.match(noOpen.reachable ? '' : noOpen.reason, /travel-edit/);
});

test('S6: llega a travel-edit, toma la primera fila editable y el cleanup sale sin guardar', async () => {
  const w = fakePort(
    baseWorld({
      taps: {
        'ion-tab-button|actividad': { ok: true },
        'ion-segment-button|programados': { ok: true }
      },
      tapCss: { ok: true, goto: EDIT },
      fields: { [STOP_SELECTOR]: field(false) },
      backTo: HOME
    })
  );
  const surface = new ScheduledTripEditSurface();
  const r = await surface.navigate(w.port);
  assert.deepEqual([r.reachable, r.reachable && r.fieldSelector], [true, STOP_SELECTOR]);
  await surface.cleanup(w.port);
  assert.deepEqual(w.log.slice(-2), [`set:${STOP_SELECTOR}=`, 'back']);
});

test('S6: si ya está en travel-edit no recorre Actividad/Programados', async () => {
  const w = fakePort(baseWorld({ url: EDIT, fields: { [ORIGIN_SELECTOR]: field(false) } }));
  const r = await new ScheduledTripEditSurface().navigate(w.port);
  assert.equal(r.reachable, true);
  assert.ok(!w.log.some((l) => l.startsWith('text:')));
});

test('S7: menú lateral -> «Mis Direcciones» -> Tipo -> input; el homónimo del home no se toca', async () => {
  const w = fakePort(
    baseWorld({
      taps: { 'ion-menu ion-item|direccion': { ok: true, goto: ADDR } },
      pickedType: 'Otro',
      profileInput: 'input[name="input-from"]'
    })
  );
  const surface = new ProfileAddressSurface();
  const r = await surface.navigate(w.port);
  assert.equal(r.reachable, true);
  assert.equal(surface.chosenType, 'Otro');
  assert.deepEqual(w.log.slice(0, 2), ['menu', 'text:direccion']);
});

test('S7: Tipo ya elegido no se vuelve a elegir; sin Tipo posible o sin menú => motivo', async () => {
  const already = fakePort(
    baseWorld({ url: ADDR, addressType: 'HOME', profileInput: 'input[name="input-from"]' })
  );
  const ok = await new ProfileAddressSurface().navigate(already.port);
  assert.equal(ok.reachable, true);

  const noType = await new ProfileAddressSurface().navigate(
    fakePort(baseWorld({ url: ADDR, profileInput: 'x' })).port
  );
  assert.match(noType.reachable ? '' : noType.reason, /Tipo/);

  const noMenu = await new ProfileAddressSurface().navigate(
    fakePort(baseWorld({ menuOpens: false })).port
  );
  assert.match(noMenu.reachable ? '' : noMenu.reason, /menú/);

  const noInput = await new ProfileAddressSurface().navigate(
    fakePort(baseWorld({ url: ADDR, addressType: 'WORK' })).port
  );
  assert.match(noInput.reachable ? '' : noInput.reason, /input de Dirección/);
});

test('S7: cleanup sale con la flecha, sin guardar', async () => {
  const w = fakePort(baseWorld({ url: ADDR, backTo: HOME }));
  await new ProfileAddressSurface().cleanup(w.port);
  assert.ok(w.log.includes('back'));
  assert.ok(!w.log.some((l) => /guardar|save/i.test(l)));
});
