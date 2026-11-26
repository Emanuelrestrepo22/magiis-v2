// tests/steps/places/addressSearchScreens.steps.ts
// MG-1132 · PK-2 · TM-1748 — abre el buscador de direcciones (`app-input-search-place`) de las cuatro
// pantallas que NO usan puntos de referencia: Clientes (Nuevo cliente › Direccion), Sucursales (modal
// «Create a Branch» › Address), Mi Compania (Preferencias › Main Address) y Areas (modal «New Area» ›
// Representative Point, que se habilita recien con un poligono dibujado). Medido en TEST v2.0.22 el
// 19/11/2026, carrier 1521, textos en EN.
// SOLO LECTURA: nunca guarda. `closeAddressScreen` cancela el modal si lo hay.
import { expect, type Locator, type Page } from '@playwright/test';

export type AddressScreen = 'clients' | 'branches' | 'company' | 'areas';

export const ADDRESS_SCREENS: readonly AddressScreen[] = [
  'clients',
  'branches',
  'company',
  'areas'
];

export const ADDRESS_SCREEN_LABEL: Record<AddressScreen, string> = {
  clients: 'Clientes › Nuevo cliente › Dirección',
  branches: 'Sucursales › Agregar sucursal › Dirección',
  company: 'Mi Compañía › Dirección principal',
  areas: 'Áreas › Nueva área › Punto representativo'
};

/** Dibuja un poligono cuadrado sobre `#mapDraw` esperando cada vertice (observable, sin esperas fijas). */
/**
 * Centra el mapa Leaflet de `mapRoot` en `center` (necesita `installMapHook(page)` ANTES de navegar). Sin animacion:
 * `setView` con `animate: false` mueve el mapa de forma sincronica y el centro leido despues lo confirma.
 */
async function centerLeafletMap(
  mapRoot: Locator,
  center: { lat: number; lng: number; zoom: number }
): Promise<void> {
  const reached = await mapRoot.evaluate((el, target) => {
    const w = window as unknown as {
      __maps?: Array<{
        getContainer(): HTMLElement;
        getCenter(): { lat: number; lng: number };
        setView(c: [number, number], z: number, o: { animate: boolean }): void;
      }>;
    };
    const map = (w.__maps ?? []).find((m) => m.getContainer() === el);
    if (!map) return null;
    map.setView([target.lat, target.lng], target.zoom, { animate: false });
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }, center);
  if (!reached) {
    throw new Error(
      'el mapa de Areas no esta registrado: falta installMapHook(page) antes de navegar'
    );
  }
  if (Math.abs(reached.lat - center.lat) >= 1e-4 || Math.abs(reached.lng - center.lng) >= 1e-4) {
    throw new Error(
      `el mapa de Areas no quedo centrado en la vista pedida (centro leido ${reached.lat},${reached.lng})`
    );
  }
}

async function drawPolygon(
  page: Page,
  center?: { lat: number; lng: number; zoom: number }
): Promise<void> {
  const map = page.locator('#mapDraw');
  await expect(map).toBeVisible({ timeout: 15_000 });
  // El modal anima su entrada: se espera a que el contenedor tenga caja estable antes de medir.
  let previous = '';
  await expect
    .poll(
      async () => {
        const key = JSON.stringify(await map.boundingBox());
        const stable = key === previous;
        previous = key;
        return stable;
      },
      { intervals: [400], timeout: 10_000 }
    )
    .toBe(true);
  if (center) await centerLeafletMap(map, center);
  await page.locator('.leaflet-draw-draw-polygon').click();
  const box = await map.boundingBox();
  if (!box) throw new Error('el mapa de dibujo de Areas no tiene caja');
  const vertices = map.locator('.leaflet-editing-icon');
  const corners = [
    [0.35, 0.35],
    [0.65, 0.35],
    [0.65, 0.65],
    [0.35, 0.65]
  ];
  let count = 0;
  for (const [fx, fy] of corners) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.click(x, y);
    count += 1;
    await expect(vertices).toHaveCount(count);
  }
  // Cierra el poligono clickeando el primer vertice.
  await vertices.first().click();
}

/** Abre la pantalla y devuelve el combobox de direccion listo para escribir (habilitado). */
export async function openAddressSearch(
  page: Page,
  screen: AddressScreen,
  areaCenter?: { lat: number; lng: number; zoom: number }
): Promise<Locator> {
  let field: Locator;
  switch (screen) {
    case 'clients':
      await page.goto('/carrier/#/client/create', { waitUntil: 'domcontentloaded' });
      field = page.locator('app-input-search-place').first().getByRole('combobox');
      break;
    case 'branches':
      await page.goto('/carrier/#/settings/branches/list', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /add branch/i }).click();
      field = page.locator('ngb-modal-window app-input-search-place').getByRole('combobox');
      break;
    case 'company':
      // Se registra ANTES de navegar el GET que carga las preferencias del carrier.
      const preferences = page.waitForResponse(
        (res) => res.request().method() === 'GET' && /\/carriers\/\d+\/preferences/.test(res.url()),
        { timeout: 30_000 }
      );
      await page.goto('/carrier/#/settings/preferences', { waitUntil: 'domcontentloaded' });
      const preferencesStatus = (await preferences).status();
      if (preferencesStatus !== 200) {
        throw new Error(`GET de preferencias del carrier respondio ${preferencesStatus}`);
      }
      // Buscador de «Main Address» (anclado por su etiqueta, no por posicion).
      field = page
        .locator(
          "xpath=//*[normalize-space(text())='Main Address *' or normalize-space(.)='Main Address *']"
        )
        .first()
        .locator('xpath=following::app-input-search-place[1]')
        .getByRole('combobox');
      // Ademas de la respuesta, el formulario repone el valor despues de pintar: se espera a que el campo
      // muestre su direccion guardada antes de interactuar (si no, la seleccion se pisa).
      await expect(
        field.locator('xpath=ancestor::app-input-search-place').locator('.ng-value-label'),
        'Mi Compañía debe haber cargado su dirección principal guardada'
      ).toHaveText(/\S/, { timeout: 30_000 });
      break;
    case 'areas':
      await page.goto('/carrier/#/settings/areas/list', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /add area/i }).click();
      await drawPolygon(page, areaCenter);
      field = page.locator('app-input-search-place').getByRole('combobox');
      break;
  }
  await expect(
    field,
    `el buscador de ${ADDRESS_SCREEN_LABEL[screen]} debe estar habilitado`
  ).toBeEnabled({
    timeout: 30_000
  });
  return field;
}

/**
 * Sale de la pantalla SIN guardar: cancela el modal abierto (sucursales, areas); en Clientes y Mi Compania
 * (formularios que quedan sucios tras elegir una direccion) navega a otra ruta y descarta el cambio en el
 * dialogo «Discard changes?» si la app lo pide (es una guarda del formulario, no una regla de negocio).
 */
export async function closeAddressScreen(page: Page, screen: AddressScreen): Promise<void> {
  if (screen === 'clients' || screen === 'company') {
    await page.goto('/carrier/#/client/list', { waitUntil: 'domcontentloaded' });
    // Tras elegir una direccion el formulario queda sucio: se espera el estado (dialogo de descarte O la lista) y
    // solo si aparece el dialogo se acepta; sin espera fija y sin tragar errores.
    const discard = page.getByRole('button', { name: /yes, discard/i });
    const listHeading = page.getByRole('heading', {
      name: /customer\s*\/\s*passenger management/i
    });
    await expect(discard.or(listHeading).first()).toBeVisible({ timeout: 30_000 });
    if (await discard.isVisible()) {
      await discard.click();
      await expect(listHeading).toBeVisible({ timeout: 30_000 });
    }
    return;
  }
  await page.keyboard.press('Escape');
  const modal = page.locator('ngb-modal-window');
  if ((await modal.count()) > 0) {
    await modal
      .getByRole('button', { name: /^(cancel|cancelar)$/i })
      .first()
      .click();
    await expect(modal).toBeHidden({ timeout: 10_000 });
  }
}
