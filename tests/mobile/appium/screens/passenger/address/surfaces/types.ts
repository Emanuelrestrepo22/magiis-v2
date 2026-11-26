/**
 * Contrato común de las SUPERFICIES de dirección de la app Pasajero (MG-116): dónde vive un campo de dirección y
 * cómo llegar. Una superficie sabe tres cosas y nada más: llegar (`navigate`), decir cuál es su input
 * (`fieldSelector` del resultado) y dejar la app lista para la siguiente (`cleanup`). La CONDUCTA del campo la
 * mide el probe (P-41, `screens/passenger/address/probes/`), que es el mismo para todas.
 *
 * Una superficie NO alcanzable devuelve un `reason`: el llamador lo traduce a skip/NO_EJERCIDO, NUNCA a defecto.
 *
 * Las superficies no tocan Appium directo: hablan con un `SurfacePort` (implementado en `SurfaceWeb.ts`), por eso
 * su lógica de navegación se prueba con dobles sin dispositivo.
 *
 * Interfaz mínima que se espera del probe (P-41): consumir `SurfaceReach` (`fieldSelector`) y llamar `cleanup`.
 */

import type { Locator } from '../../../../core/Locator.js';

/** Superficies de V1 que se migran (S2 y S4 de V1 quedan fuera: S2 es `Destino` fijo y S4 un tipo de viaje). */
export type SurfaceId = 'S1' | 'S3' | 'S5' | 'S6' | 'S7';

/** Estado de un input leído del DOM. */
export type FieldState = { present: boolean; readOnly: boolean; value: string };

/** Punto en coordenadas CSS del WebView (`vw`/`vh` = viewport, para mapear a pantalla). */
export type CssPoint = { x: number; y: number; vw: number; vh: number };

/** Qué parte de la fila se toca para volverla editable (nunca el icono lateral: es una papelera). */
export type RowTapKind = 'text' | 'row' | 'input';

/** Operaciones de WebView que necesitan las superficies (inyectable: real en `SurfaceWeb.ts`, doble en unit). */
export interface SurfacePort {
  /** URL actual del WebView ('' si no se pudo leer). */
  url(): Promise<string>;
  /** Toca (click real) el primer elemento VISIBLE de `selector` cuyo texto contiene `needle` (vacío = cualquiera). */
  tapByText(selector: string, needle: string, timeoutMs?: number): Promise<boolean>;
  /** Toca de forma nativa el primer elemento visible de `selector` (lo trae a la vista antes). */
  tapCss(selector: string): Promise<boolean>;
  /** Toca la flecha de retroceso del encabezado (única salida de las páginas internas). */
  tapBackArrow(): Promise<boolean>;
  /** Abre el menú lateral (la pestaña «Mi cuenta» es su toggle). */
  openSideMenu(): Promise<boolean>;
  fieldState(selector: string): Promise<FieldState>;
  /** Toca la fila del input (parte `kind`) con un tap nativo. `false` si no hay fila visible. */
  tapField(selector: string, kind: RowTapKind): Promise<boolean>;
  /** Asigna el valor y dispara `input`/`ionInput` (como V1). `false` si no hay input visible o está deshabilitado. */
  setValue(selector: string, value: string): Promise<boolean>;
  /** Primer input visible, no `readonly` ni `disabled`, cuyo placeholder cumple `placeholderPattern` (regex). */
  findEditablePlaceholder(placeholderPattern: string): Promise<string | null>;
  /** Placeholder EXACTO (con su espacio final) del primer input visible que empieza con `prefix`. */
  findPlaceholderStartingWith(prefix: string): Promise<string | null>;
  /** El botón `button.travelHistory-btn` con ese texto está marcado `active`. */
  isTripTypeActive(needle: string): Promise<boolean>;
  /** `ion-select` de Tipo: valor actual ('' si no tiene). */
  readAddressType(): Promise<string>;
  /** Abre el popover del Tipo y elige la PRIMERA opción visible; devuelve su rótulo ('' si no hubo). */
  pickFirstAddressTypeOption(): Promise<string>;
  /** Primer input visible por `name` (`input-from`) o por placeholder (dirección/lugar/domicilio), como selector. */
  findProfileAddressInput(): Promise<string | null>;
  pause(ms: number): Promise<void>;
}

export type SurfaceReach =
  | { reachable: true; fieldSelector: string; detail: string }
  | { reachable: false; reason: string };

export interface AddressSurface {
  readonly id: SurfaceId;
  readonly label: string;
  /** Locator del campo cuando es fijo (S1, S3, S7); en S5/S6 el campo se resuelve en vivo (`fieldSelector`). */
  readonly fieldLocator: Locator;
  /** Llega a la superficie. NO guarda ni confirma nada. */
  navigate(port: SurfacePort): Promise<SurfaceReach>;
  /** Deja la app en un estado del que la siguiente superficie pueda arrancar (sin guardar). */
  cleanup(port: SurfacePort): Promise<void>;
}
