/**
 * Selectores de las superficies de dirección de App PAX (MG-116).
 *
 * Estado de cada uno (25/11/2026):
 *  - «PROBADO UAT v2.5.19»: salió del censo en vivo de V1 (18/08/2026) Y el template de `develop` no cambió.
 *  - «código»: lo ajustó/relevó V2 contra `magiis-mobile-passenger-v2@develop`; sin validar en vivo (login PAX
 *    bloqueado en emuladores por FCM; validar en dispositivo físico).
 * Los placeholders llevan ESPACIO FINAL: `{{ label | translate }} {{ index }}` con `index` vacío.
 */

import { defineLocator } from '../../../../core/Locator.js';

/** PROBADO UAT v2.5.19 · develop: `travel-edit-input` placeholder = `commons.label_from` + ' ' + index('') */
export const ORIGIN_SELECTOR = 'input[placeholder="Origen "]';
/** PROBADO UAT v2.5.19 · develop: `commons.label_to` + ' ' */
export const DESTINATION_SELECTOR = 'input[placeholder="Destino "]';
/** PROBADO UAT v2.5.19 · develop: `commons.label_new_to` = «Agregar otro destino» + ' ' */
export const STOP_SELECTOR = 'input[placeholder="Agregar otro destino "]';
/** PROBADO UAT v2.5.19 · develop: `ion-input[name=input-from]` de `app-addresses` (el nativo hereda `name`) */
export const PROFILE_ADDRESS_SELECTOR = 'app-addresses input[name="input-from"]';

export const SURFACE_LOCATORS = {
  // PROBADO UAT v2.5.19 · develop sin cambios
  homeOrigin: defineLocator({ id: 'passenger.surface.s1.origin', web: ORIGIN_SELECTOR }),
  homeStop: defineLocator({ id: 'passenger.surface.s3.stop', web: STOP_SELECTOR }),
  // código: S5 resuelve en vivo la fila editable del home; el locator lista las filas candidatas
  homeOneWay: defineLocator({
    id: 'passenger.surface.s5.oneWayField',
    web: [DESTINATION_SELECTOR, ORIGIN_SELECTOR]
  }),
  // PROBADO UAT v2.5.19: `travel-edit` monta las mismas filas del home; se toma la que esté editable
  scheduledEdit: defineLocator({
    id: 'passenger.surface.s6.editField',
    web: [STOP_SELECTOR, DESTINATION_SELECTOR, ORIGIN_SELECTOR, 'input[name="input-from"]']
  }),
  profileAddress: defineLocator({
    id: 'passenger.surface.s7.address',
    web: [PROFILE_ADDRESS_SELECTOR, 'input[name="input-from"]']
  }),
  // PROBADO UAT v2.5.19 · develop: `button.travelHistory-btn.travel-first-btns-one-way` (clase `active`), «Solo Ida»
  tripTypeButton: defineLocator({
    id: 'passenger.surface.tripTypeButton',
    web: 'button.travelHistory-btn'
  }),
  // PROBADO UAT v2.5.19 · develop: `ion-tab-button` «Inicio» / «Actividad» / «Mi cuenta» (`navigator.*`)
  tabButton: defineLocator({ id: 'passenger.surface.tabButton', web: 'ion-tab-button, ion-label' }),
  // PROBADO UAT v2.5.19 · develop: `ion-segment-button` «Programados» (`travel_list.travel_schedule`)
  scheduledSegment: defineLocator({
    id: 'passenger.surface.scheduledSegment',
    web: 'ion-segment-button, ion-label'
  }),
  // PROBADO UAT v2.5.19 · develop: `ion-col.col-edit > div.edit` (SIN texto: el rótulo es un SVG). NO tocar
  // `button.btn.outline` del mismo `ion-row.cancel-row`: es «Cancelar viaje».
  scheduledEditIcon: defineLocator({
    id: 'passenger.surface.scheduledEditIcon',
    web: ['ion-col.col-edit div.edit', 'div.edit']
  }),
  // código: ítem «Mis Direcciones» del MENÚ LATERAL (`/AddressesPage`). NO es el botón homónimo del home
  // (`button.travelHistory-btn.additional-btns-btn`), que es un atajo para elegir un destino guardado.
  menuAddresses: defineLocator({
    id: 'passenger.surface.menuAddresses',
    web: 'ion-menu ion-item'
  }),
  // PROBADO UAT v2.5.19 · develop: `ion-item#inputAddressType > ion-select` (popover)
  addressTypeSelect: defineLocator({
    id: 'passenger.surface.addressTypeSelect',
    web: ['#inputAddressType', 'ion-select']
  }),
  // PROBADO UAT v2.5.19 · develop: `ion-item.prediction-item` con `(mousedown)` => click real
  prediction: defineLocator({
    id: 'passenger.surface.prediction',
    web: 'ion-item.prediction-item'
  })
} as const;

export const HOME_URL_RE = /HomePage/i;
export const TRAVEL_EDIT_URL_RE = /travel-edit/i;
export const ADDRESSES_URL_RE = /AddressesPage/i;
