// tests/config/storage-state-locale.ts
// Normaliza el idioma grabado en un storageState de Playwright.
//
// El portal Carrier V2 persiste el idioma en localStorage 'carrier-31'
// (StorageKeyEnum.defaultLanguage, IdentityService) con los valores 'en-us' | 'es-ar'
// (LanguageDropdownComponent.listLang), y el cookie 'lang' con los mismos valores decide el
// texto inicial del boton del header. Un storageState guardado tras un login humano en un SO
// en espanol trae 'es-ar' y pisa el locale del config. Funcion de IO sincrona, sin red.
import { readFileSync, writeFileSync } from 'node:fs';

export type SuiteLanguage = 'en' | 'es';

/** Clave de localStorage donde el portal guarda el idioma (StorageKeyEnum.defaultLanguage = 31). */
export const LANGUAGE_STORAGE_KEY = 'carrier-31';
/** Cookie que lee LanguageDropdownComponent.ngOnInit para pintar el boton EN/ES. */
export const LANGUAGE_COOKIE_NAME = 'lang';

const APP_VALUE: Record<SuiteLanguage, string> = { en: 'en-us', es: 'es-ar' };

type StorageStateShape = {
  cookies?: Array<{ name: string; value: string }>;
  origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
};

export type NormalizeResult = { changed: boolean; previous: string | null };

/**
 * Reescribe `carrier-31` (y el cookie `lang`, si existe) al idioma pedido. Solo toca entradas
 * ya presentes: no inventa claves ni origins. `previous` es el primer valor distinto que habia
 * (nunca otras claves: el storageState contiene el token de sesion).
 */
export function normalizeStorageStateLanguage(
  path: string,
  language: SuiteLanguage = 'en'
): NormalizeResult {
  const target = APP_VALUE[language];
  const state = JSON.parse(readFileSync(path, 'utf8')) as StorageStateShape;
  let previous: string | null = null;
  let changed = false;

  const entries = [
    ...(state.origins ?? []).flatMap((o) =>
      (o.localStorage ?? []).filter((e) => e.name === LANGUAGE_STORAGE_KEY)
    ),
    ...(state.cookies ?? []).filter((c) => c.name === LANGUAGE_COOKIE_NAME)
  ];
  for (const entry of entries) {
    if (entry.value === target) continue;
    previous ??= entry.value;
    entry.value = target;
    changed = true;
  }

  if (changed) writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
  return { changed, previous };
}
